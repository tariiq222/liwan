# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .entitlement_service_seats import BRANCH_LIMIT, USER_LIMIT
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

STORAGE_LIMIT = 'storage.limit_mb'
BYTES_PER_MIB = 1048576
STORAGE_FLAG = 'liwan_storage_blocked'
STORAGE_METADATA = ('file_size', 'type', 'res_model', 'res_field', 'res_id', 'url', 'create_uid', STORAGE_FLAG)


class LiwanEntitlementStorage(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_storage_plan(self):
        """Return the expected blocked ids and the records whose persisted flags need changing."""
        limit = self._liwan_limit_value(STORAGE_LIMIT)
        if limit is not None and (type(limit) is not int or limit < 0):
            msg = 'tenant_configuration_invalid'
            raise LiwanAccessRule(msg, 'tenant storage limit is invalid', status=503)
        # File ownership rules must not hide bytes from tenant-wide storage accounting. Only
        # metadata leaves this search; content and record identities never leave this service.
        attachments_sudo = self.env['ir.attachment'].sudo()
        domain = [(STORAGE_FLAG, '=', True)] if limit is None else [
            '|', (STORAGE_FLAG, '=', True), '&', ('type', '=', 'binary'), ('file_size', '>', 0),
        ]
        tracked = attachments_sudo.search_fetch(domain, STORAGE_METADATA, order='create_date, id')
        blocked = set()
        if limit is not None:
            eligible = tracked.filtered(lambda row: row.type == 'binary' and row.file_size > 0)
            system = eligible.filtered(lambda row: row._liwan_storage_system_file())
            available = limit * BYTES_PER_MIB - sum(system.mapped('file_size'))
            for attachment in eligible - system:
                available -= attachment.file_size
                if available < 0:
                    blocked.add(attachment.id)
        return (
            tracked.browse(blocked),
            tracked.filtered(lambda row: row.id in blocked and not row.liwan_storage_blocked),
            tracked.filtered(lambda row: row.id not in blocked and row.liwan_storage_blocked),
        )

    @api.model
    def _liwan_settle_storage(self):
        profile = self._liwan_profile()
        profile._liwan_lock()
        _blocked, close, reopen = self._liwan_storage_plan()
        self._liwan_apply_flags(close, {STORAGE_FLAG: True})
        self._liwan_apply_flags(reopen, {STORAGE_FLAG: False})
        return bool(close or reopen)

    @api.model
    def _liwan_excess_capabilities(self):
        return frozenset({USER_LIMIT, BRANCH_LIMIT, STORAGE_LIMIT})

    @api.model
    def _liwan_excess_is_settled(self):
        if self._liwan_post_trial_due() or any(
            limit is not None and (type(limit) is not int or limit < 0)
            for limit in (self._liwan_limit_value(key) for key in self._liwan_excess_capabilities())
        ):
            return False
        _blocked, close, reopen = self._liwan_storage_plan()
        users = self._liwan_user_flag_changes()
        branches = self._liwan_branch_flag_changes()
        return not (close or reopen or any(users) or any(branches))

    @api.model
    def _liwan_blocked_storage_bytes(self):
        blocked, _close, _reopen = self._liwan_storage_plan()
        return sum(blocked.mapped('file_size'))

    @api.model
    def _liwan_excess_counts(self):
        counts = super()._liwan_excess_counts()
        blocked_bytes = self._liwan_blocked_storage_bytes()
        return {**counts, STORAGE_LIMIT: -(-blocked_bytes // BYTES_PER_MIB)}
