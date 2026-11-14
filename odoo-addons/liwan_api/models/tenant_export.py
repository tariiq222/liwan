# Part of Odoo. See LICENSE file for full copyright and licensing details.
import datetime
import logging
import re
import secrets
from pathlib import Path

from odoo import api, fields, models, release, tools
from odoo.modules import module

from .tenant_export_archive import build_archive
from .tenant_export_log import KIND_BUILT, KIND_DOWNLOAD, KIND_REQUEST
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

_logger = logging.getLogger(__name__)

STATE_REQUESTED = 'requested'
STATE_RUNNING = 'running'
STATE_DONE = 'done'
STATE_FAILED = 'failed'
STATE_EXPIRED = 'expired'
ACTIVE_STATES = (STATE_REQUESTED, STATE_RUNNING)
# A finished archive is kept this long, then deleted; it sits outside the attachment store (and its storage count).
RETENTION = datetime.timedelta(days=7)
# A running job whose worker died (restart, killed cron) is failed after this, so it cannot block the next request.
STALE_AFTER = datetime.timedelta(hours=2)
EXPORT_DIR = 'tenant_exports'
ARCHIVE_NAME = re.compile(r'\d+-[0-9a-f]{16}\.zip')
FAILURE_MAX = 300


def refuse(code, message, status):
    """Raise the structured error of the export routes."""
    raise LiwanAccessRule(code, message, status=status)


class LiwanTenantExport(models.Model):
    """One run of the tenant data export: requested by an administrator, built by a cron in batches into a zip stored
    beside (not inside) the attachment store, downloadable until it expires.

    The archive is a plain file in the filestore folder ``tenant_exports``, so it is never an attachment: it does not
    count against the tenant's storage and the next export cannot include it. One export runs at a time.
    """
    _name = 'liwan.tenant.export'
    _description = 'LiwanOS tenant data export'
    _order = 'id desc'
    _liwan_scope = 'tenant'

    user_id = fields.Many2one('res.users', string='Requester', required=True, readonly=True, ondelete='restrict',
                              default=lambda self: self.env.user)
    state = fields.Selection(
        [(STATE_REQUESTED, 'Requested'), (STATE_RUNNING, 'Running'), (STATE_DONE, 'Done'),
         (STATE_FAILED, 'Failed'), (STATE_EXPIRED, 'Expired')],
        required=True, default=STATE_REQUESTED, readonly=True, index=True,
    )
    started_at = fields.Datetime(readonly=True)
    finished_at = fields.Datetime(readonly=True)
    expires_at = fields.Datetime(readonly=True)
    failure = fields.Char(readonly=True)
    archive_name = fields.Char(readonly=True)
    size_bytes = fields.Integer(readonly=True)
    counts = fields.Json(readonly=True)

    _liwan_one_active = models.UniqueIndex("((1)) WHERE state IN ('requested', 'running')")

    # ---- the request ----

    @api.model
    def _liwan_assert_may_export(self):
        """The export covers the whole tenant, so only a session on the root company that holds every company may take it."""
        service = self.env['liwan.entitlement.service']
        root = service._liwan_profile().root_company_id
        if self.env.company != root:
            refuse('forbidden', 'only the root company can export the tenant', 403)
        if not (root | service._liwan_branches().company_id) <= self.env.companies:
            refuse('session_does_not_cover_every_company', 'the session must cover every company of the tenant', 403)

    @api.model
    def _liwan_request(self):
        """Queue an export for the caller; 409 ``export_in_progress`` while another one is queued or running."""
        self._liwan_assert_may_export()
        # The profile row serialises two requests; the unique index is the backstop.
        self.env['liwan.entitlement.service']._liwan_profile()._liwan_lock()
        if self.search_count([('state', 'in', ACTIVE_STATES)]):
            refuse('export_in_progress', 'an export of this tenant is already running', 409)
        export = self.create({})
        self._liwan_log(export, KIND_REQUEST)
        return export

    @api.model
    def _liwan_recent(self, limit=10):
        self._liwan_assert_may_export()
        return self.search([], limit=limit)

    @api.model
    def _liwan_log(self, export, kind, counts=None):
        return self.env['liwan.tenant.export.log'].create({'export_id': export.id, 'kind': kind, 'counts': counts})

    # ---- the archive file ----

    @api.model
    def _liwan_dir(self):
        return Path(tools.config.filestore(self.env.cr.dbname)) / EXPORT_DIR

    def _liwan_path(self):
        self.ensure_one()
        if not self.archive_name or not ARCHIVE_NAME.fullmatch(self.archive_name):
            return None
        return self._liwan_dir() / self.archive_name

    def _liwan_delete_file(self):
        for export in self:
            path = export._liwan_path()
            if path:
                path.unlink(missing_ok=True)

    @api.model
    def _liwan_download(self, export_id):
        """``(path, filename)`` of a finished archive for the caller, logged; 404 ``not_found`` when there is none."""
        self._liwan_assert_may_export()
        export = self.browse(export_id).exists()
        path = export._liwan_path() if export else None
        if not export or export.state != STATE_DONE or not path or not path.is_file():
            refuse('not_found', 'the export is not available', 404)
        self._liwan_log(export, KIND_DOWNLOAD, export.counts)
        return path, f'liwan-export-{fields.Date.to_string(export.finished_at)}.zip'

    def unlink(self):
        self._liwan_delete_file()
        return super().unlink()

    # ---- the worker ----

    @api.model
    def _liwan_cron_run(self):
        """Fail a dead job, expire old archives, then build the oldest queued export."""
        self._liwan_fail_stale()
        self._liwan_expire()
        export = self.search([('state', '=', STATE_REQUESTED)], order='id', limit=1)
        if export:
            export._liwan_build()

    @api.model
    def _liwan_fail_stale(self):
        stale = self.search([
            ('state', '=', STATE_RUNNING), ('started_at', '<', fields.Datetime.now() - STALE_AFTER),
        ])
        stale._liwan_delete_file()
        stale.write({'state': STATE_FAILED, 'failure': 'interrupted: the worker stopped before the archive was finished'})

    @api.model
    def _liwan_expire(self):
        old = self.search([('state', '=', STATE_DONE), ('expires_at', '<', fields.Datetime.now())])
        old._liwan_delete_file()
        old.write({'state': STATE_EXPIRED, 'archive_name': False})

    def _liwan_build(self):
        self.ensure_one()
        directory = self._liwan_dir()
        directory.mkdir(parents=True, exist_ok=True)
        name = f'{self.id}-{secrets.token_hex(8)}.zip'
        self.write({'state': STATE_RUNNING, 'started_at': fields.Datetime.now(), 'archive_name': name})
        # The running state is committed before the long build, so a worker that dies leaves a visible, expiring trace
        # instead of a job that is silently retried for ever.
        self._liwan_checkpoint()
        export_id, path = self.id, directory / name
        try:
            with self.env.cr.savepoint():
                manifest = build_archive(self.env, path, self._liwan_tenant_name(), self._liwan_software_version())
        except Exception as error:
            _logger.exception('tenant export %s failed', export_id)
            path.unlink(missing_ok=True)
            reason = f'{type(error).__name__}: {error}'[:FAILURE_MAX]
            self.browse(export_id).write({'state': STATE_FAILED, 'failure': reason, 'archive_name': False})
            return
        counts = {
            'rows': {item['key']: item['rows'] for item in manifest['datasets']},
            'files': sum(item['files'] for item in manifest['datasets']),
            'not_included': len(manifest['not_included']),
        }
        finished = fields.Datetime.now()
        export = self.browse(export_id)
        export.write({
            'state': STATE_DONE, 'finished_at': finished, 'expires_at': finished + RETENTION,
            'size_bytes': path.stat().st_size, 'counts': counts,
        })
        self._liwan_log(export, KIND_BUILT, counts)
        export._liwan_notify_ready()

    def _liwan_checkpoint(self):
        """Commit the work so far (the cron's own batch commit); a test runs in one transaction and keeps it."""
        if not module.current_test:
            self.env.cr.commit()

    @api.model
    def _liwan_tenant_name(self):
        return self.env['liwan.entitlement.service']._liwan_profile().root_company_id.name

    @api.model
    def _liwan_software_version(self):
        module = self.env['ir.module.module'].search([('name', '=', 'liwan_api')], limit=1)
        return {'odoo': release.version, 'liwan': module.latest_version or ''}

    def _liwan_notify_ready(self):
        """Tell the requester the archive is ready; the notification service (a shared service above this addon) implements it."""
