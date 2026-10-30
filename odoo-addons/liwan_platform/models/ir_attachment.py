# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii

from odoo import api, models


class LiwanPlatformIrAttachment(models.Model):
    _inherit = 'ir.attachment'

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
        extra = sum(self._liwan_vals_bytes(vals) for vals in vals_list)
        if extra:
            self.env['liwan.entitlement.service']._liwan_claim_storage(extra)
        return super().create(vals_list)

    def write(self, vals):
        extra = 0
        if 'raw' in vals or 'datas' in vals or vals.get('type') == 'url':
            new_size = self._liwan_vals_bytes(vals)
            extra = sum(new_size - attachment.file_size for attachment in self)
        if extra:
            self.env['liwan.entitlement.service']._liwan_claim_storage(extra)
        return super().write(vals)

    def unlink(self):
        size = sum(self.mapped('file_size'))
        result = super().unlink()
        if size:
            self.env['liwan.entitlement.service']._liwan_claim_storage(-size)
        return result
