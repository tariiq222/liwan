# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from odoo.addons.webvue_hr.rules import WebVueHrRule


class HrPayslip(models.Model):
    _inherit = 'hr.payslip'

    webvue_department_id = fields.Many2one(
        'hr.department', string='Department', readonly=True, copy=False,
        help='The department of the contract version in force on the last paid day, snapshotted when the payslip is computed.',
    )

    def get_current_contract_dict(self, contract, contracts):
        """Add the Saudi payslip values the structure rules read as ``current_contract.<key>``.

        Only payslips of the company's payroll structure get them: other structures read none of these keys.
        """
        values = super().get_current_contract_dict(contract, contracts)
        settings = self.env['webvue.hr.payroll.settings']._webvue_for_company(self.company_id)
        if self.struct_id != settings.structure_id:
            return values
        return {**values, **self.env['webvue.hr.payroll.calculator']._webvue_payslip_values(self)}

    def _webvue_refuse_saudi_rules_outside(self):
        """Refuse a structure that uses the Saudi rules but is not the company's: they would read zeros."""
        saudi_rule = self.env.ref('webvue_hr.rule_net')
        if saudi_rule not in self.struct_id.get_structure_with_parents().rule_ids:
            return
        code = 'payroll_structure_mismatch'
        raise WebVueHrRule(
            code,
            self.env._('The payslip structure uses the Saudi payroll rules but is not the payroll structure of the company.'),
            field='employee_id', details={'employee_id': self.employee_id.id, 'structure_id': self.struct_id.id},
        )

    def _webvue_check_structure_and_contract(self):
        """Fail loudly before the engine silently skips a payslip: wrong Saudi structure or no contract."""
        settings = self.env['webvue.hr.payroll.settings']._webvue_for_company(self.company_id)
        if self.struct_id == settings.structure_id:
            self.env['webvue.hr.payroll.calculator']._webvue_require_contract(self)
        else:
            self._webvue_refuse_saudi_rules_outside()

    def compute_sheet(self):
        for payslip in self:
            payslip._webvue_check_structure_and_contract()
            payslip.webvue_department_id = payslip.contract_id.department_id
        return super().compute_sheet()

    def _webvue_period_version(self):
        """The employee version in force on the last paid day of the period.

        The payslip carries this single version, so a mid-month version change never doubles the basic.
        """
        self.ensure_one()
        last_day = min(day for day in (self.date_to, self.employee_id.departure_date) if day)
        versions = self.env['hr.version'].search([('employee_id', '=', self.employee_id.id)], order='date_version')
        in_force = versions.filtered(lambda version: version.date_version <= last_day)
        return in_force[-1:] or versions[:1]
