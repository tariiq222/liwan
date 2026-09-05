# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqHrDocument(models.Model):
    _name = 'nasq.hr.document'
    _description = 'HR Document'
    _check_company_auto = True

    name = fields.Char(required=True)
    body = fields.Html()
    attachment_ids = fields.Many2many('ir.attachment')
    department_id = fields.Many2one(
        'hr.department',
        required=True,
        index=True,
        ondelete='restrict',
        check_company=True,
    )
    company_id = fields.Many2one(
        'res.company',
        required=True,
        default=lambda self: self.env.company,
        index=True,
    )
