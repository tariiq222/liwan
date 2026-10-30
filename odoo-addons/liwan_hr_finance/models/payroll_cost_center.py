# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError


class LiwanHrPayrollCostCenter(models.Model):
    """The analytic account (cost center) a department's payroll cost is booked to."""

    _name = 'liwan.hr.payroll.cost.center'
    _description = 'LiwanOS HR payroll department cost center'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    department_id = fields.Many2one('hr.department', required=True, index=True, ondelete='cascade')
    analytic_account_id = fields.Many2one('account.analytic.account', ondelete='restrict')

    _department_unique = models.Constraint(
        'UNIQUE(company_id, department_id)', 'a department has one payroll cost center',
    )

    @api.constrains('company_id', 'department_id', 'analytic_account_id')
    def _check_company_records(self):
        for center in self:
            if center.department_id.company_id != center.company_id:
                raise ValidationError(self.env._('The department must belong to the company.'))
            if center.analytic_account_id and center.analytic_account_id.company_id != center.company_id:
                raise ValidationError(self.env._('The cost center must belong to the company.'))
