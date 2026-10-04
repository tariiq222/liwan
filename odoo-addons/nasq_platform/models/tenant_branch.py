# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqTenantBranch(models.Model):
    _name = 'nasq.tenant.branch'
    _description = 'Nasq tenant commercial branch'
    _nasq_scope = 'company'
    _check_company_auto = True

    branch_uid = fields.Char(required=True, index=True)
    company_id = fields.Many2one(
        'res.company', required=True, ondelete='restrict', index=True,
    )
    operation_id = fields.Char(required=True)
    target_revision_id = fields.Char()
    state = fields.Selection(
        [('active', 'Active'), ('archived', 'Archived')],
        default='active', required=True,
    )

    _branch_uid_unique = models.Constraint(
        'UNIQUE(branch_uid)', 'nasq branch uid must be unique',
    )
    _company_unique = models.Constraint(
        'UNIQUE(company_id)', 'a company can be bound to one nasq branch',
    )
