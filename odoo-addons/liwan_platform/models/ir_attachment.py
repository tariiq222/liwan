# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError
from odoo.tools import human_size

from .entitlement_service_storage import STORAGE_FLAG
from .read_only_guard import SETTLE_MARKER
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_core.models.protected_write import marked

ELIGIBILITY_FIELDS = frozenset({'type', 'res_model', 'res_field', 'res_id', 'url', 'public', 'mimetype'})
CONTENT_FIELDS = frozenset({'raw', 'datas'})
COMPANY_IMAGES = frozenset({'image_1920', 'image_1024', 'image_512', 'image_256', 'image_128'})
ASSET_MIMETYPES = frozenset({'text/css', 'text/xml', 'application/javascript', 'application/json'})
ASSET_SETTLE_PENDING = 'liwan_platform.asset_storage_settle'
NATIVE_INVERSE = 'liwan_platform.attachment_native_inverse'


class StorageProtectedBinary(fields.Binary):
    """Apply the file policy when native Binary returns a value, even from a warm cache."""

    def __get__(self, record, owner=None):
        if record is not None and len(record) == 1 and record.id and self._liwan_size_requested(record):
            return human_size(record.file_size)
        return super().__get__(record, owner)

    def _liwan_size_requested(self, record):
        return record.env.context.get('bin_size') or record.env.context.get(f'bin_size_{self.name}')

    def convert_to_record(self, value, record):
        if (
            len(record) == 1 and record.id and not self._liwan_size_requested(record)
            and record.id not in record.env.cr.precommit.data.get(NATIVE_INVERSE, ())
        ):
            record._liwan_assert_storage_readable()
        return super().convert_to_record(value, record)


class LiwanPlatformIrAttachment(models.Model):
    _inherit = 'ir.attachment'

    raw = StorageProtectedBinary()
    datas = StorageProtectedBinary()
    db_datas = StorageProtectedBinary(copy=False)
    liwan_storage_blocked = fields.Boolean(default=False, readonly=True, copy=False)

    def _liwan_storage_record_ref(self):
        """Applications can supply an owner ref after the attachment's ordinary read checks."""
        return False

    @api.model
    def _liwan_generated_asset(self, values, owner):
        url = values.get('url')
        return (
            owner._is_superuser() and values.get('type', 'binary') == 'binary'
            and values.get('res_model') == 'ir.ui.view' and not values.get('res_id') and not values.get('res_field')
            and values.get('public') is True and values.get('mimetype') in ASSET_MIMETYPES
            and isinstance(url, str) and url.startswith('/web/assets/')
        )

    def _liwan_storage_system_file(self, company_partners):
        self.ensure_one()
        if self.res_model == 'res.partner' and self.res_field in COMPANY_IMAGES and self.res_id in company_partners:
            return True
        # Odoo reads language flags when constructing even a maintenance shell's environment.
        if self.res_model == 'res.lang' and self.res_id and self.res_field == 'flag_image':
            return self.create_uid._is_superuser()
        asset_fields = ('type', 'res_model', 'res_id', 'res_field', 'public', 'mimetype', 'url')
        return self._liwan_generated_asset({field: self[field] for field in asset_fields}, self.create_uid)

    def _liwan_assert_storage_readable(self):
        # Module loading can read stock attachments before the platform schema and singleton exist.
        if not self.env.registry.ready:
            return
        service = self.env['liwan.entitlement.service']
        if service._liwan_post_trial_due():
            refused = bool(service._liwan_storage_plan()[0].intersection(self.ids))
        else:
            refused = self.filtered('liwan_storage_blocked')
        if refused or self.filtered(lambda row: row.type == 'url' and row.file_size):
            msg = 'storage_excess_blocked'
            raise LiwanAccessRule(msg, status=403)

    def _to_http_stream(self):
        self._liwan_assert_storage_readable()
        return super()._to_http_stream()

    @api.model
    def _liwan_vals_bytes(self, vals):
        if 'db_datas' in vals or 'default_db_datas' in self.env.context:
            raise ValidationError(self.env._('Write attachment content through raw or datas.'))
        if vals.keys() >= CONTENT_FIELDS:
            raise ValidationError(self.env._('Supply only one attachment content representation.'))
        raw = vals.get('raw')
        if isinstance(raw, str):
            return len(raw.encode())
        if isinstance(raw, bytes):
            return len(raw)
        if raw is not None and raw is not False:
            raise ValidationError(self.env._('Raw attachment content must be bytes or text.'))
        datas = vals.get('datas')
        if datas:
            try:
                return len(base64.b64decode(datas, validate=False))
            except (ValueError, TypeError, binascii.Error) as error:
                raise ValidationError(self.env._('The attachment content is invalid.')) from error
        return 0

    def _set_attachment_data(self, asbytes):
        """Native inverses read their new cached input and set the physical metadata below our write hook."""
        service = self.env['liwan.entitlement.service']
        service._liwan_invalidate_storage_plan()
        try:
            with marked(self.env, {NATIVE_INVERSE: self.ids}):
                return super()._set_attachment_data(asbytes)
        finally:
            service._liwan_invalidate_storage_plan()

    @api.model_create_multi
    def create(self, vals_list):
        if f'default_{STORAGE_FLAG}' in self.env.context or any(STORAGE_FLAG in vals for vals in vals_list):
            raise AccessError(self.env._('Only storage settlement may change availability.'))
        if any(f'default_{field}' in self.env.context for field in CONTENT_FIELDS):
            raise ValidationError(self.env._('Supply attachment content as a create value.'))
        service = self.env['liwan.entitlement.service']
        ordinary_bytes = technical_bytes = 0
        for vals in vals_list:
            size = self._liwan_vals_bytes(vals)
            if size and vals.get('type', self.env.context.get('default_type')) == 'url':
                raise ValidationError(self.env._('A URL attachment cannot contain file bytes.'))
            if self._liwan_generated_asset(vals, self.env.user):
                technical_bytes += size
            else:
                ordinary_bytes += size
        if ordinary_bytes:
            service._liwan_claim_storage(ordinary_bytes + technical_bytes)
        elif technical_bytes and self.env.registry.ready:
            service._liwan_profile()._liwan_bump_quota_revision()
        service._liwan_invalidate_storage_plan()
        result = super().create(vals_list)
        service._liwan_invalidate_storage_plan()
        if technical_bytes and self.env.registry.ready:
            # Stock AssetsBundle removes the previous bundle after create using SQL.
            # Settle after that replacement, with the profile still locked.
            callbacks = self.env.cr.precommit
            if ASSET_SETTLE_PENDING not in callbacks.data:
                callbacks.data[ASSET_SETTLE_PENDING] = True
                callbacks.add(service._liwan_settle_storage)
        return result

    def write(self, vals):
        if STORAGE_FLAG in vals and (
            set(vals) != {STORAGE_FLAG} or not self.env.cr.precommit.data.get(SETTLE_MARKER)
        ):
            raise AccessError(self.env._('Only storage settlement may change availability.'))
        service = self.env['liwan.entitlement.service']
        size = self._liwan_vals_bytes(vals)
        content_changed = bool(CONTENT_FIELDS.intersection(vals))
        eligibility_changed = bool(ELIGIBILITY_FIELDS.intersection(vals))
        extra = 0
        if content_changed or 'type' in vals:
            for attachment in self:
                target_type = vals.get('type', attachment.type)
                target_size = size if content_changed else attachment.file_size
                if target_type == 'url' and target_size:
                    raise ValidationError(self.env._('A URL attachment cannot contain file bytes.'))
                previous = attachment.file_size if attachment.type == 'binary' else 0
                extra += (target_size if target_type == 'binary' else 0) - previous
        if extra:
            service._liwan_claim_storage(extra)
        elif eligibility_changed:
            service._liwan_profile()._liwan_bump_quota_revision()
        storage_changed = content_changed or eligibility_changed or STORAGE_FLAG in vals
        if storage_changed:
            service._liwan_invalidate_storage_plan()
        result = super().write(vals)
        if storage_changed:
            service._liwan_invalidate_storage_plan()
        if extra < 0 or eligibility_changed:
            service._liwan_settle_storage()
        return result

    def unlink(self):
        size = sum(self.filtered(lambda row: row.type == 'binary').mapped('file_size'))
        service = self.env['liwan.entitlement.service']
        if size:
            service._liwan_claim_storage(-size)
        service._liwan_invalidate_storage_plan()
        result = super().unlink()
        service._liwan_invalidate_storage_plan()
        if size:
            service._liwan_settle_storage()
        return result
