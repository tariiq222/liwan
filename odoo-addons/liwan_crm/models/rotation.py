# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanCrmRotation(models.Model):
    """Where one company's round robin stands: the agent who took the last opportunity."""

    _name = 'liwan.crm.rotation'
    _description = 'LiwanOS CRM rotation'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    last_user_id = fields.Many2one('res.users', ondelete='set null')

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one CRM rotation record')
