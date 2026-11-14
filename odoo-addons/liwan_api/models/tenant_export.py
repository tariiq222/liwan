# Part of Odoo. See LICENSE file for full copyright and licensing details.
import copy
import datetime
import logging
import re
import secrets
import shutil
import time
from pathlib import Path

from odoo import api, fields, models, release, tools
from odoo.modules import module

from . import tenant_export_archive as archive
from .tenant_export_access import TENANT_EXPORT
from .tenant_export_log import KIND_BUILT, KIND_DOWNLOAD, KIND_REQUEST
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

_logger = logging.getLogger(__name__)

STATE_REQUESTED = 'requested'
STATE_RUNNING = 'running'
STATE_DONE = 'done'
STATE_FAILED = 'failed'
STATE_EXPIRED = 'expired'
ACTIVE_STATES = (STATE_REQUESTED, STATE_RUNNING)
# A finished export is kept this long, then deleted; it sits outside the attachment store (and its storage count).
RETENTION = datetime.timedelta(days=7)
# One request per tenant per day: a build loads the whole tenant and copies its files onto the vendor's disk. A failed
# build does not use the allowance.
COOLDOWN = datetime.timedelta(hours=24)
# A job that is not finished this long after it was requested fails, so a build that cannot progress frees the slot.
MAX_AGE = datetime.timedelta(days=3)
# A step that raises is retried on the next run this many times before the job fails.
MAX_ATTEMPTS = 3
# One cron run stops after this many seconds, or when the cron says less than MARGIN seconds remain, and the next run
# continues from the committed progress (the default cron time limit is 120 s).
RUN_BUDGET = 60
MARGIN = 25
EXPORT_DIR = 'tenant_exports'
ARCHIVE_NAME = re.compile(r'\d+-[0-9a-f]{16}')
# Disk guard: the build needs room for the files it copies, a share of the database size for the spreadsheets, and this
# margin; below that it fails before writing anything.
DISK_MARGIN = 1 << 30
DATABASE_SHARE = 2

FAIL_DISK = 'insufficient_disk'
FAIL_BUILD = 'build_failed'
FAIL_TIMEOUT = 'timeout'
FAIL_REQUESTER = 'requester_not_authorized'
FAILURE_MESSAGES = {
    FAIL_DISK: 'There is not enough free disk space to build the export now. Try again later.',
    FAIL_BUILD: 'The export could not be completed. Try again later, and contact support if it fails again.',
    FAIL_TIMEOUT: 'The export did not finish in time. Try again later.',
    FAIL_REQUESTER: 'The account that asked for the export no longer holds the permission to export.',
}


def refuse(code, message, status, details=None):
    """Raise the structured error of the export routes."""
    raise LiwanAccessRule(code, message, status=status, details=details)


class LiwanTenantExport(models.Model):
    """One run of the tenant data export: requested by the system administrator of the root company, built by a cron in
    resumable steps into a directory of the filestore, streamed as one zip while it is downloadable.

    The files live in ``<filestore>/tenant_exports/<name>``, never in the attachment store, so they do not count against
    the tenant's storage and the next export cannot include them. The requester is kept as an id with no foreign key, so
    removing the account is never blocked.
    """
    _name = 'liwan.tenant.export'
    _description = 'LiwanOS tenant data export'
    _order = 'id desc'
    _liwan_scope = 'tenant'

    requester_id = fields.Integer(required=True, readonly=True, default=lambda self: self.env.user.id)
    state = fields.Selection(
        [(STATE_REQUESTED, 'Requested'), (STATE_RUNNING, 'Running'), (STATE_DONE, 'Done'),
         (STATE_FAILED, 'Failed'), (STATE_EXPIRED, 'Expired')],
        required=True, default=STATE_REQUESTED, readonly=True, index=True,
    )
    started_at = fields.Datetime(readonly=True)
    finished_at = fields.Datetime(readonly=True)
    expires_at = fields.Datetime(readonly=True)
    failure = fields.Char(readonly=True, help='A fixed failure code; the exception text is only in the server log.')
    archive_name = fields.Char(readonly=True)
    size_bytes = fields.Integer(readonly=True)
    counts = fields.Json(readonly=True)
    progress = fields.Json(readonly=True)
    steps_done = fields.Integer(readonly=True)
    steps_total = fields.Integer(readonly=True)
    attempts = fields.Integer(readonly=True)

    _liwan_one_active = models.UniqueIndex("((1)) WHERE state IN ('requested', 'running')")

    # ---- the request ----

    @api.model
    def _liwan_assert_may_export(self):
        """Only the system administrator of the root company: the capability is held in, and the session works in, the root.

        The export covers every company of the tenant, because the worker reads as the superuser identity of the cron.
        """
        service = self.env['liwan.entitlement.service']
        if self.env.company != service._liwan_profile().root_company_id:
            refuse('forbidden', 'only the root company can export the tenant', 403)
        if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, TENANT_EXPORT):
            refuse('forbidden', 'the tenant.export capability is required', 403)

    @api.model
    def _liwan_next_request_at(self):
        """When the next request is possible, or ``None`` now: one day after the last export that did not fail."""
        last = self.search([('state', '!=', STATE_FAILED)], limit=1)
        return last.create_date + COOLDOWN if last and last.create_date + COOLDOWN > fields.Datetime.now() else None

    @api.model
    def _liwan_request(self):
        """Queue an export for the caller: 409 while one runs, 429 ``export_cooldown`` within a day of the last one."""
        self._liwan_assert_may_export()
        # The profile row serialises two requests; the unique index is the backstop.
        self.env['liwan.entitlement.service']._liwan_profile()._liwan_lock()
        if self.search_count([('state', 'in', ACTIVE_STATES)]):
            refuse('export_in_progress', 'an export of this tenant is already running', 409)
        next_at = self._liwan_next_request_at()
        if next_at:
            refuse('export_cooldown', 'an export was requested in the last day', 429, {'next_request_at': next_at.isoformat() + 'Z'})
        export = self.create({})
        self._liwan_log(export, KIND_REQUEST)
        return export

    @api.model
    def _liwan_listing(self, limit=10):
        """``(latest exports, how many exist, when the next request is possible)``."""
        self._liwan_assert_may_export()
        return self.search([], limit=limit), self.search_count([]), self._liwan_next_request_at()

    @api.model
    def _liwan_log(self, export, kind, counts=None):
        return self.env['liwan.tenant.export.log'].create({'export_id': export.id, 'kind': kind, 'counts': counts})

    def _liwan_is_expired(self):
        self.ensure_one()
        return self.state == STATE_EXPIRED or (self.state == STATE_DONE and bool(self.expires_at) and self.expires_at < fields.Datetime.now())

    # ---- the files ----

    @api.model
    def _liwan_dir(self):
        return Path(tools.config.filestore(self.env.cr.dbname)) / EXPORT_DIR

    def _liwan_path(self):
        self.ensure_one()
        if not self.archive_name or not ARCHIVE_NAME.fullmatch(self.archive_name):
            return None
        return self._liwan_dir() / self.archive_name

    def _liwan_delete_files(self):
        for export in self:
            path = export._liwan_path()
            if path:
                shutil.rmtree(path, ignore_errors=True)

    @api.model
    def _liwan_download(self, export_id):
        """``(directory, filename)`` of a downloadable export for the caller, logged; 404 ``not_found`` otherwise.

        An export past ``expires_at`` is refused even when the expiry cron has not run yet.
        """
        self._liwan_assert_may_export()
        export = self.browse(export_id).exists()
        path = export._liwan_path() if export else None
        if not export or export.state != STATE_DONE or export._liwan_is_expired() or not path or not path.is_dir():
            refuse('not_found', 'the export is not available', 404)
        self._liwan_log(export, KIND_DOWNLOAD, export.counts)
        return path, f'liwan-export-{fields.Date.to_string(export.finished_at)}.zip'

    def unlink(self):
        self._liwan_delete_files()
        return super().unlink()

    # ---- the cron: expiry ----

    @api.model
    def _liwan_cron_expire(self):
        """Delete the files of expired exports and any directory no export refers to (a killed build's leftovers).

        It is a cron of its own, so a failing build can never stop an archive from being deleted.
        """
        old = self.search([('state', '=', STATE_DONE), ('expires_at', '<', fields.Datetime.now())])
        old._liwan_delete_files()
        old.write({'state': STATE_EXPIRED, 'archive_name': False})
        directory = self._liwan_dir()
        if directory.is_dir():
            for path in directory.iterdir():
                # Asked per directory, after it was listed: a build commits its name before it creates the directory
                # (``_liwan_begin``), so a directory that exists has its reference committed already, and an answer
                # taken earlier for the whole folder could miss a build that started in between.
                if not self.search_count([('archive_name', '=', path.name)]):
                    shutil.rmtree(path, ignore_errors=True)

    # ---- the cron: the build ----

    @api.model
    def _liwan_cron_build(self):
        """Continue the oldest unfinished export for a bounded time; the next run continues from the committed progress."""
        export = self.search([('state', 'in', ACTIVE_STATES)], order='id', limit=1)
        if export:
            export._liwan_advance(time.monotonic())

    def _liwan_requester(self):
        self.ensure_one()
        return self.env['res.users'].with_context(active_test=False).browse(self.requester_id).exists()

    def _liwan_requester_may_export(self):
        """The account that asked is still active and still holds the capability in the root company."""
        user = self._liwan_requester()
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        keys = self.env['liwan.access.service']._liwan_capability_keys(user, company=root) if user.active else ()
        return TENANT_EXPORT in keys

    def _liwan_advance(self, started):
        self.ensure_one()
        if self.create_date + MAX_AGE < fields.Datetime.now():
            return self._liwan_fail(FAIL_TIMEOUT)
        if not self._liwan_requester_may_export():
            return self._liwan_fail(FAIL_REQUESTER)
        if self.state == STATE_REQUESTED and not self._liwan_begin():
            return None
        datasets = {item['key']: item for item in archive.validated(self.env['liwan.tenant.export.hooks']._liwan_export_datasets())}
        root = self._liwan_path()
        while True:
            progress = copy.deepcopy(self.progress)
            try:
                with self.env.cr.savepoint():
                    more = archive.run_step(self.env, root, progress, datasets)
                    if not more and not progress['finalized']:
                        archive.verify_complete(root, progress)
                        archive.finalize(self.env, root, progress, datasets, self._liwan_tenant_name(), self._liwan_software_version())
                        progress['finalized'] = True
            except Exception:
                _logger.exception('tenant export %s: a step failed', self.id)
                self.attempts += 1
                if self.attempts >= MAX_ATTEMPTS:
                    return self._liwan_fail(FAIL_BUILD)
                self._liwan_checkpoint()
                return None
            self.write({
                'progress': progress, 'steps_done': archive.steps_done(progress), 'attempts': 0,
            })
            if progress['finalized']:
                return self._liwan_finish(progress)
            remaining = self._liwan_checkpoint()
            if remaining < MARGIN or time.monotonic() - started > RUN_BUDGET:
                return None

    def _liwan_begin(self):
        """First run of a job: check the disk, make the work directory, plan the steps. False when the job failed."""
        needed = self._liwan_data_size() + DISK_MARGIN
        directory = self._liwan_dir()
        directory.mkdir(parents=True, exist_ok=True)
        if self._liwan_free_bytes(directory) < needed:
            self._liwan_fail(FAIL_DISK)
            return False
        name = f'{self.id}-{secrets.token_hex(8)}'
        datasets = archive.validated(self.env['liwan.tenant.export.hooks']._liwan_export_datasets())
        progress = archive.new_progress(datasets)
        self.write({
            'state': STATE_RUNNING, 'started_at': fields.Datetime.now(), 'archive_name': name, 'progress': progress,
            'steps_done': 0, 'steps_total': archive.steps_total(progress),
        })
        # The name is committed before the directory exists, so the expiry cron never sees a directory without its job.
        self._liwan_checkpoint()
        (directory / name).mkdir()
        return True

    @api.model
    def _liwan_data_size(self):
        """What the build has to write: every stored file, plus a share of the database for the spreadsheets."""
        self.env.cr.execute('SELECT pg_database_size(current_database())')
        stored = self.env['liwan.entitlement.service']._liwan_profile().storage_used_bytes
        return stored + self.env.cr.fetchone()[0] // DATABASE_SHARE

    @api.model
    def _liwan_free_bytes(self, directory):
        return shutil.disk_usage(directory).free

    def _liwan_checkpoint(self):
        """Commit the progress made so far through the cron's own progress call; it answers the seconds this run has left.

        A test runs in one transaction that forbids a commit, so there it only reports unlimited time.
        """
        if module.current_test:
            return float('inf')
        return self.env['ir.cron']._commit_progress(1)

    def _liwan_finish(self, progress):
        finished = fields.Datetime.now()
        path = self._liwan_path()
        previous = self.search([('state', '=', STATE_DONE), ('id', '!=', self.id)])
        previous._liwan_delete_files()
        previous.write({'state': STATE_EXPIRED, 'archive_name': False})
        counts = {
            'rows': dict(progress['rows']), 'files': sum(progress['files'].values()),
            'file_bytes': sum(progress['files_bytes'].values()), 'overflow_cells': sum(progress['overflow'].values()),
        }
        self.write({
            'state': STATE_DONE, 'finished_at': finished, 'expires_at': finished + RETENTION,
            'size_bytes': sum(item.stat().st_size for item in path.rglob('*') if item.is_file()), 'counts': counts,
        })
        self._liwan_log(self, KIND_BUILT, counts)
        self._liwan_notify_safely()
        self._liwan_checkpoint()

    def _liwan_fail(self, code):
        """End the job with a fixed failure code, delete what it wrote and tell the requester."""
        self._liwan_delete_files()
        self.write({'state': STATE_FAILED, 'failure': code, 'archive_name': False, 'finished_at': fields.Datetime.now()})
        self._liwan_notify_safely()
        self._liwan_checkpoint()

    def _liwan_notify_safely(self):
        """The bell is a courtesy: if it fails the job keeps its state and the failure is logged."""
        try:
            with self.env.cr.savepoint():
                self._liwan_notify_outcome()
        except Exception:
            _logger.exception('tenant export %s: the notification could not be sent', self.id)

    @api.model
    def _liwan_tenant_name(self):
        return self.env['liwan.entitlement.service']._liwan_profile().root_company_id.name

    @api.model
    def _liwan_software_version(self):
        module_row = self.env['ir.module.module'].search([('name', '=', 'liwan_api')], limit=1)
        return {'odoo': release.version, 'liwan': module_row.latest_version or ''}

    def _liwan_notify_outcome(self):
        """Tell the requester how the export ended; the notification service (a shared service above this addon) implements it."""
