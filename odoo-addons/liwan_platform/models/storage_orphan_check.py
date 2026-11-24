# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Compare the attachment storage with the records that reference it, and report the difference.

This is a report, not a garbage collector: it deletes nothing, and orphan bytes are not counted against the
tenant's ``storage.limit_mb``. The pinned OCA ``fs.file.gc`` autovacuum stays the only deleter.

An object under the storage's root is an *orphan* when its key is neither an attachment's path (``store_fname``
is ``<code>://<path>``) nor a pending ``fs.file.gc`` mark, and its last modification is older than
``GRACE_HOURS``: a younger object may still belong to a transaction that has not committed. The reverse
direction is reported too: a ``store_fname`` with no object is *missing* (the symptom of OCA/storage #660, where
a failed delete removes its mark and never retries).

Why the listing is not trusted blindly, verified in the pinned sources:
- fsspec's ``walk`` skips a subtree whose listing fails unless ``on_error='raise'``
  (``fsspec/spec.py``, ``AbstractFileSystem.walk``), so the walk is asked to raise instead of returning a partial
  tree;
- s3fs keeps requesting ``list_objects_v2`` pages while ``IsTruncated`` and raises on a failed page rather than
  returning a truncated listing (``s3fs/core.py``, ``_list_pages``);
- an entry without a size or a modification time is the remaining incomplete case, and the run records
  ``incomplete`` instead of guessing an age.
Every failure records its state on a run row committed on its own cursor (so the cron's rollback cannot take it
with it), logs the state and counts only, and raises. A failed run writes no orphan row, and no exception text,
storage option or credential reaches a field or a log line.
"""
import logging
from datetime import datetime, timedelta, timezone

from odoo import api, fields, models

from odoo.addons.liwan_platform.models.bigint import BigInteger

_logger = logging.getLogger(__name__)

# An object younger than this may belong to a transaction that has not committed yet, so it is not reported.
GRACE_HOURS = 48
# Run rows kept per storage, oldest first out; the object rows of a removed run go with it.
KEPT_RUNS = 30


class StorageCheckFailure(Exception):
    """The listing cannot be trusted, so the run reports its state and no counts."""

    state = None


class StorageUnreachable(StorageCheckFailure):
    state = 'unreachable'


class StorageAuthFailed(StorageCheckFailure):
    state = 'auth_failed'


class ListingIncomplete(StorageCheckFailure):
    state = 'incomplete'


class LiwanStorageOrphanCheck(models.Model):
    _name = 'liwan.storage.orphan.check'
    _description = 'LiwanOS attachment storage orphan check run'
    _liwan_scope = 'tenant'
    _order = 'checked_at desc, id desc'

    fs_storage_code = fields.Char(required=True, readonly=True)
    state = fields.Selection(
        [('ok', 'OK'), ('orphans_found', 'Orphans found'), ('unreachable', 'Unreachable'),
         ('auth_failed', 'Authentication failed'), ('incomplete', 'Listing incomplete')],
        required=True,
        readonly=True,
    )
    objects_listed = fields.Integer(readonly=True, default=0)
    orphan_count = fields.Integer(readonly=True, default=0)
    orphan_bytes = BigInteger(readonly=True, default=0)
    missing_count = fields.Integer(readonly=True, default=0)
    checked_at = fields.Datetime(required=True, readonly=True, default=fields.Datetime.now)
    object_ids = fields.One2many('liwan.storage.orphan.object', 'check_id', readonly=True)

    @api.model
    def _liwan_cron_check_orphans(self):
        storage = self._liwan_attachment_storage()
        if storage:
            self._liwan_check(storage)

    @api.model
    def _liwan_attachment_storage(self):
        """The one storage attachments are written to; without it the check has nothing to compare."""
        return self.env['fs.storage'].search([('use_as_default_for_attachments', '=', True)], limit=1)

    @api.model
    def _liwan_check(self, storage):
        """One run: record what the listing and the records disagree on, then keep the last ``KEPT_RUNS``."""
        storage.ensure_one()
        try:
            objects = self._liwan_list_objects(storage)
        except StorageCheckFailure as failure:
            self._liwan_store_failure(storage, failure)
            _logger.warning(
                'storage %s orphan check %s: no counts, nothing reported', storage.code, failure.state,
            )
            raise

        stored = self._liwan_stored_paths(storage)
        pending = self._liwan_pending_paths(storage)
        # The storage writes its own connection marker at the root (fs_storage.py, _marker_file_check_connection).
        marker = storage._get_marker_file_name()
        now = fields.Datetime.now()
        grace_start = now - timedelta(hours=GRACE_HOURS)
        orphans = [
            (key, size, modified)
            for key, (size, modified) in objects.items()
            if key != marker and key not in stored and key not in pending and modified <= grace_start
        ]
        missing = sum(1 for path in stored if path not in objects)
        run = self.create({
            'fs_storage_code': storage.code,
            'state': 'orphans_found' if orphans else 'ok',
            'objects_listed': len(objects),
            'orphan_count': len(orphans),
            'orphan_bytes': sum(size for _key, size, _modified in orphans),
            'missing_count': missing,
            'checked_at': now,
        })
        if orphans:
            self.env['liwan.storage.orphan.object'].create([
                {'check_id': run.id, 'key': key, 'size': size, 'last_modified': modified}
                for key, size, modified in orphans
            ])
        self._liwan_trim_runs(storage.code)
        if orphans or missing:
            _logger.warning(
                'storage %s orphan check %s: %s objects listed, %s orphan objects (%s bytes), %s missing',
                storage.code, run.state, run.objects_listed, run.orphan_count, run.orphan_bytes, run.missing_count,
            )
        return run

    @api.model
    def _liwan_stored_paths(self, storage):
        """The keys attachments of this storage reference, archived ones included."""
        prefix = f'{storage.code}://'
        attachments = self.env['ir.attachment'].with_context(active_test=False).search([
            ('fs_storage_code', '=', storage.code),
        ])
        return {
            store_fname[len(prefix):]
            for store_fname in attachments.mapped('store_fname')
            if store_fname and store_fname.startswith(prefix)
        }

    @api.model
    def _liwan_pending_paths(self, storage):
        """The keys already waiting for ``fs.file.gc``: a rolled-back transaction's object is not an orphan yet."""
        prefix = f'{storage.code}://'
        marks = self.env['fs.file.gc'].search([('fs_storage_code', '=', storage.code)])
        return {
            store_fname[len(prefix):]
            for store_fname in marks.mapped('store_fname')
            if store_fname and store_fname.startswith(prefix)
        }

    @api.model
    def _liwan_list_objects(self, storage):
        """``{key: (size, last_modified)}`` for every object under the storage root, or a typed failure."""
        if not storage.get_directory_path():
            # Without a root the filesystem would list the bucket itself, which is not this tenant's tree.
            raise ListingIncomplete()
        objects = {}
        for _root, _directories, files in self._liwan_walk(storage):
            for info in files.values():
                key = info.get('name')
                size = info.get('size')
                modified = self._liwan_modified(info)
                if not key or not isinstance(size, int) or modified is None:
                    raise ListingIncomplete()
                objects[key] = (size, modified)
        return objects

    @api.model
    def _liwan_walk(self, storage):
        """The complete walk, with a failed subtree raised instead of silently omitted."""
        try:
            return list(storage.fs.walk('', detail=True, on_error='raise'))
        except PermissionError:
            raise StorageAuthFailed() from None
        except Exception:  # noqa: BLE001 - a botocore connection error is not an OSError, and its text may hold a secret
            raise StorageUnreachable() from None

    @staticmethod
    def _liwan_modified(info):
        """The last modification as naive UTC, from the field each protocol provides (``mtime`` / ``LastModified``)."""
        value = info.get('mtime')
        if value is None:
            value = info.get('LastModified')
        if isinstance(value, datetime):
            return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc).replace(tzinfo=None)
        return None

    @api.model
    def _liwan_store_failure(self, storage, failure):
        """Record the failed run on its own committed cursor, because the cron's rollback would take it with it.

        The pinned ``fs.file.gc`` opens a second cursor for the same reason. Only the state is stored: never the
        exception text, which can carry a signed request or a credential.
        """
        values = {
            'fs_storage_code': storage.code,
            'state': failure.state,
            'checked_at': fields.Datetime.now(),
        }
        with self.env.registry.cursor() as cursor:
            env = api.Environment(cursor, self.env.uid, self.env.context)
            runs = env[self._name]
            run = runs.create(values)
            runs._liwan_trim_runs(storage.code)
            return run

    @api.model
    def _liwan_trim_runs(self, storage_code):
        stale = self.search([('fs_storage_code', '=', storage_code)], offset=KEPT_RUNS)
        stale.unlink()


class LiwanStorageOrphanObject(models.Model):
    _name = 'liwan.storage.orphan.object'
    _description = 'LiwanOS attachment storage orphan object'
    _liwan_scope = 'tenant'
    _order = 'check_id, key'

    check_id = fields.Many2one('liwan.storage.orphan.check', required=True, ondelete='cascade', index=True)
    key = fields.Char(required=True, readonly=True)
    size = BigInteger(readonly=True, default=0)
    last_modified = fields.Datetime(readonly=True)
