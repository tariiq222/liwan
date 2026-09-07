# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError


class IrAttachment(models.Model):
    _inherit = 'ir.attachment'

    @api.model
    def _nasq_check_identity_target(self, target):
        if self.env.is_system():
            return
        model, field, record_id = target.get('res_model'), target.get('res_field'), target.get('res_id')
        if not record_id:
            return
        protected = model == 'res.company' and field in {'logo', 'logo_web'}
        if model == 'res.partner' and field in {'image_1920', 'image_1024', 'image_512', 'image_256', 'image_128'}:
            protected = self.env['res.company']._nasq_has_company_partner([record_id])
        if protected:
            raise AccessError(self.env._('Only Odoo system administrators can change institution name and logo.'))

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_system():
            defaults = self.default_get(['res_model', 'res_field', 'res_id'])
            for vals in vals_list:
                self._nasq_check_identity_target({**defaults, **vals})
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_system():
            for attachment in self:
                target = {key: attachment[key] for key in ('res_model', 'res_field', 'res_id')}
                self._nasq_check_identity_target(target)
                self._nasq_check_identity_target({**target, **vals})
        return super().write(vals)

    def unlink(self):
        if not self.env.is_system():
            for attachment in self:
                self._nasq_check_identity_target({key: attachment[key] for key in ('res_model', 'res_field', 'res_id')})
        return super().unlink()
