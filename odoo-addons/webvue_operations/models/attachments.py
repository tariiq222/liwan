# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError


class OperationsAttachment(models.Model):
    _inherit = 'ir.attachment'

    @api.model
    def _operations_attachment_guard(self, model, res_id, public=False):
        if model == 'webvue.operation.request' and res_id:
            if public:
                raise AccessError(self.env._('Operation attachments cannot be public.'))
            document = self.env[model].browse(res_id).exists()
            if not document:
                raise AccessError(self.env._('The request does not exist.'))
            document.check_access('read')
            document.lock_for_update(allow_referencing=True)
            document.invalidate_recordset()
            document._editable()

    @api.model_create_multi
    def create(self, vals_list):
        defaults = self.default_get(['res_model', 'res_id', 'public'])
        prepared = [{**defaults, **vals} for vals in vals_list]
        for vals in prepared:
            self._operations_attachment_guard(vals.get('res_model'), vals.get('res_id'), vals.get('public', False))
        return super().create(prepared)

    def write(self, vals):
        for attachment in self:
            self._operations_attachment_guard(attachment.res_model, attachment.res_id, vals.get('public', attachment.public))
            self._operations_attachment_guard(vals.get('res_model', attachment.res_model), vals.get('res_id', attachment.res_id), vals.get('public', attachment.public))
        return super().write(vals)

    def unlink(self):
        for attachment in self:
            self._operations_attachment_guard(attachment.res_model, attachment.res_id)
        return super().unlink()
