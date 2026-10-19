# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError


class Document(models.Model):
    _inherit = 'webvue.document'
    department_id = fields.Many2one(
        'hr.department', index=True, ondelete='restrict', check_company=True,
    )

    @api.model
    def _webvue_context_fields(self):
        return (*super()._webvue_context_fields(), 'department_id')

    def _webvue_check_department(self, value):
        if self.env.user._is_superuser():
            return
        self.env['webvue.document.links']._webvue_require_department_context(write=True)
        if not value:
            return
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            msg = 'invalid department context'
            raise AccessError(msg)
        department = self.env['hr.department'].search(
            [('id', '=', value), ('company_id', '=', self.env.company.id)],
        )
        if not department:
            msg = 'department context is not available'
            raise AccessError(msg)

    @api.model_create_multi
    def create(self, values):
        for item in values:
            if 'department_id' in item:
                self._webvue_check_department(item['department_id'])
        return super().create(values)

    def write(self, values):
        if 'department_id' in values:
            self._webvue_check_department(values['department_id'])
        return super().write(values)
