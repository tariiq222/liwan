# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueAppointmentsRecord(models.Model):
    _name = 'webvue.appointments.record'
    _description = 'Appointments record'
    _webvue_scope = 'company'
    _order = 'name, id'

    name = fields.Char(required=True)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )
