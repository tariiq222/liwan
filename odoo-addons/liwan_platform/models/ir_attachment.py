# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii

from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.tools import human_size

from .entitlement_service_storage import STORAGE_FLAG
from .read_only_guard import SETTLE_MARKER
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

ELIGIBILITY_FIELDS = frozenset({'type', 'res_model', 'res_field', 'res_id', 'url'})


class StorageProtectedBinary(fields.Binary):
    """Apply the file policy when native Binary returns a value, even from a warm cache."""

    def __get__(self, record, owner=None):
        if record is not None and len(record) == 1 and record.id and self._liwan_size_requested(record):
            return human_size(record.file_size)
        return super().__get__(record, owner)

    def _liwan_size_requested(self, record):
        return record.env.context.get('bin_size') or record.env.context.get(f'bin_size_{self.name}')

    def convert_to_record(self, value, record):
        if len(record) == 1 and record.id and not self._liwan_size_requested(record):
            record._liwan_assert_storage_readable()
        return super().convert_to_record(value, record)


class LiwanPlatformIrAttachment(models.Model):
    _inherit = 'ir.attachment'

    raw = StorageProtectedBinary()
    datas = StorageProtectedBinary()
    db_datas = StorageProtectedBinary()
    liwan_storage_blocked = fields.Boolean(default=False, readonly=True, copy=False)

    def _liwan_storage_record_ref(self):
        """Applications can supply an owner ref after the attachment's ordinary read checks."""
        return False

    def _liwan_storage_system_file(self):
        self.ensure_one()
        if self.res_model == 'res.company' and self.res_id and self.res_field in ('logo', 'logo_web'):
            return True
        # Stock Odoo's assetsbundle generates root-owned public bundles for ir.ui.view.
        return (
            self.create_uid._is_superuser() and self.res_model == 'ir.ui.view' and not self.res_id
            and bool(self.url and self.url.startswith('/web/assets/'))
        )

    def _liwan_assert_storage_readable(self):
        # Module loading can read stock attachments before the platform schema and singleton exist.
        if not self.env.registry.ready:
            return
        service = self.env['liwan.entitlement.service']
        if service._liwan_post_trial_due():
            blocked, _close, _reopen = service._liwan_storage_plan()
            refused = bool(blocked & self)
        else:
            refused = self.filtered('liwan_storage_blocked')
        if refused:
            msg = 'storage_excess_blocked'
            raise LiwanAccessRule(msg, status=403)

    def _to_http_stream(self):
        self._liwan_assert_storage_readable()
        return super()._to_http_stream()

    @api.model
    def _liwan_vals_bytes(self, vals):
        if vals.get('type') == 'url':
            return 0
        raw = vals.get('raw')
        if isinstance(raw, bytes):
            return len(raw)
        datas = vals.get('datas')
        if datas:
            try:
                return len(base64.b64decode(datas, validate=False))
            except (ValueError, TypeError, binascii.Error):
                return 0
        return int(vals.get('file_size') or 0)

    @api.model_create_multi
    def create(self, vals_list):
        if f'default_{STORAGE_FLAG}' in self.env.context or any(STORAGE_FLAG in vals for vals in vals_list):
            raise AccessError(self.env._('Only storage settlement may change availability.'))
        extra = sum(self._liwan_vals_bytes(vals) for vals in vals_list)
        if extra:
            self.env['liwan.entitlement.service']._liwan_claim_storage(extra)
        return super().create(vals_list)

    def write(self, vals):
        if STORAGE_FLAG in vals and (
            set(vals) != {STORAGE_FLAG} or not self.env.cr.precommit.data.get(SETTLE_MARKER)
        ):
            raise AccessError(self.env._('Only storage settlement may change availability.'))
        service = self.env['liwan.entitlement.service']
        extra = 0
        if 'raw' in vals or 'datas' in vals or vals.get('type') == 'url':
            new_size = self._liwan_vals_bytes(vals)
            extra = sum(new_size - attachment.file_size for attachment in self)
        eligibility_changed = bool(ELIGIBILITY_FIELDS.intersection(vals))
        if extra:
            service._liwan_claim_storage(extra)
        elif eligibility_changed:
            service._liwan_profile()._liwan_bump_quota_revision()
        result = super().write(vals)
        if extra < 0 or eligibility_changed:
            service._liwan_settle_storage()
        return result

    def unlink(self):
        size = sum(self.filtered(lambda row: row.type == 'binary').mapped('file_size'))
        service = self.env['liwan.entitlement.service']
        if size:
            service._liwan_claim_storage(-size)
        result = super().unlink()
        if size:
            service._liwan_settle_storage()
        return result
