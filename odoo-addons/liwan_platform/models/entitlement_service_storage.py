# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError, MissingError

from .entitlement_service_seats import BRANCH_LIMIT, USER_LIMIT
from .read_only_guard import _owner_path
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
    def _liwan_storage_inventory(self, limit, offset, *, blocked):
        """Return only attachments and owning records the current company can read."""
        company = self.env.company
        Attachment = self.env['ir.attachment'].with_context(allowed_company_ids=[company.id])
        domain = [
            ('company_id', '=', company.id), ('type', '=', 'binary'), ('file_size', '>', 0),
            # Keep native field-backed attachments out of the customer inventory. Their
            # owners may grant an attachment record read without exposing the underlying field.
            ('res_field', '=', False),
        ]
        projected = set(self._liwan_storage_plan()[0].ids) if self._liwan_post_trial_due() else None
        if projected is None and blocked is not None:
            domain.append((STORAGE_FLAG, '=', blocked))
        visible = []
        total = 0
        batch_size = 200
        after_id = None
        while True:
            batch_domain = domain + [('id', '<', after_id)] if after_id is not None else domain
            batch = Attachment.search_fetch(
                batch_domain, STORAGE_METADATA + ('name', 'create_date'), limit=batch_size, order='id desc',
            )
            for row in batch:
                is_blocked = row.liwan_storage_blocked if projected is None else row.id in projected
                if blocked is not None and is_blocked != blocked:
                    continue
                if not self._liwan_storage_inventory_visible(row, company):
                    continue
                if offset <= total < offset + limit:
                    visible.append((row, is_blocked))
                total += 1
            if len(batch) < batch_size:
                return visible, total
            after_id = batch[-1].id

    @api.model
    def _liwan_storage_inventory_visible(self, attachment, company):
        try:
            if attachment._liwan_storage_system_file():
                return False
            if not attachment.res_id:
                return attachment.create_uid == attachment.env.user and bool(attachment.read(['id']))
            if attachment.res_model not in attachment.env:
                return False
            parent = attachment.env[attachment.res_model].browse(attachment.res_id).exists()
            if not parent:
                return False
            parent.check_access('read')
            if parent._name == 'res.company':
                owner = parent
            else:
                path = _owner_path(parent)
                owner = parent.mapped(path) if path else False
            if owner and owner != company:
                return False
            # App-specific read overrides (notably canonical DMS file checks) still run.
            return bool(attachment.read(['id']))
        except (AccessError, MissingError):
            return False

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
