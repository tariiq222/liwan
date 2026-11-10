# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanTenantBranch(models.Model):
    _name = 'liwan.tenant.branch'
    _description = 'LiwanOS tenant commercial branch'
    _liwan_scope = 'company'
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
    # A branch above the purchased `branches.extra_limit` stays active and readable but takes no writes
    # (`read_only_guard`). `seat_choice` is who decided: the settle, or the customer who picked it, and
    # `restore_priority` is the customer's order for reopening branches when capacity grows (0 = not set).
    read_only = fields.Boolean(default=False, required=True, copy=False)
    seat_choice = fields.Selection(
        [('auto', 'Automatic'), ('customer', 'Customer')], default='auto', required=True, copy=False,
    )
    restore_priority = fields.Integer(default=0, required=True, copy=False)

    _branch_uid_unique = models.Constraint(
        'UNIQUE(branch_uid)', 'liwan branch uid must be unique',
    )
    _company_unique = models.Constraint(
        'UNIQUE(company_id)', 'a company can be bound to one liwan branch',
    )
    _restore_priority_positive = models.Constraint(
        'CHECK(restore_priority >= 0)', 'liwan branch restore priority cannot be negative',
    )
