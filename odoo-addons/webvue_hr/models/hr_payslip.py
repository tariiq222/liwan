# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import Decimal

from odoo import fields, models

from .payroll_math import money
from odoo.addons.webvue_hr.rules import WebVueHrRule

# Line codes of the Saudi structure (data/hr_payroll_structure_data.xml) that make up the figures
# a payslip shows. Deductions are negative lines, the employer share is a positive statistical line.
EARNING_CODES = ('BASIC', 'HOUSING', 'TRANSPORT', 'OTHER', 'OVERTIME', 'BONUS', 'EOS', 'LEAVE_ENC')
GOSI_EMPLOYEE_CODES = ('GOSI_EE_ANN', 'GOSI_EE_SANED')
DEDUCTION_CODES = (
    'ABSENCE', 'UNPAID', 'DEDUCTION', 'ADVANCE', 'SETTLEMENT_DED', *GOSI_EMPLOYEE_CODES,
)
GOSI_EMPLOYER_CODES = ('GOSI_ER_ANN', 'GOSI_ER_SANED', 'GOSI_ER_OH')
NET_CODE = 'NET'
# The five payslip inputs a payroll officer enters, by wire key; the values are engine input codes.
INPUT_CODES = {
    'overtime_amount': 'WV_OVERTIME',
    'absence_days': 'WV_ABSENCE_DAYS',
    'bonus_amount': 'WV_BONUS',
    'deduction_amount': 'WV_DEDUCTION',
    'advance_recovery_amount': 'WV_ADVANCE',
}
AMOUNT_KEYS = ('gross', 'deductions', 'gosi_employee', 'gosi_employer', 'net')


class HrPayslip(models.Model):
    _inherit = 'hr.payslip'

    webvue_department_id = fields.Many2one(
        'hr.department', string='Department', readonly=True, copy=False,
        help='The department of the contract version in force on the last paid day, snapshotted when the payslip is computed.',
    )
    webvue_paid_days = fields.Integer(
        string='Paid days', readonly=True, copy=False,
        help='Days of the period under contract, snapshotted when the payslip is created and computed: '
             'the employee reads it on their own payslip without access to the contract.',
    )

    webvue_gosi_class = fields.Selection(
        selection=lambda self: self.env['webvue.hr.gosi.rate']._fields['nationality_class'].selection,
        string='GOSI class', readonly=True, copy=False,
        help='The GOSI nationality class used when the payslip was computed: the GOSI statement of an approved '
             'run reads it instead of the live nationality and registration date.',
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
            payslip._webvue_snapshot_paid_days()
            payslip._webvue_snapshot_gosi_class()
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

    def _webvue_amounts(self):
        """``{payslip_id: {gross, deductions, gosi_employee, gosi_employer, net}}`` from the computed lines.

        Deductions and the employee GOSI share are positive figures. A payslip without lines is all zeros.
        """
        by_code = {slip_id: {} for slip_id in self.ids}
        groups = self.env['hr.payslip.line']._read_group(
            [('slip_id', 'in', self.ids)], ['slip_id', 'code'], ['total:sum'],
        )
        for slip, code, total in groups:
            by_code[slip.id][code] = Decimal(str(total))

        def amount(codes, lines):
            return sum((lines.get(code, Decimal(0)) for code in codes), Decimal(0))

        return {
            slip_id: {key: float(money(value)) for key, value in {
                'gross': amount(EARNING_CODES, lines),
                'deductions': -amount(DEDUCTION_CODES, lines),
                'gosi_employee': -amount(GOSI_EMPLOYEE_CODES, lines),
                'gosi_employer': amount(GOSI_EMPLOYER_CODES, lines),
                'net': amount((NET_CODE,), lines),
            }.items()}
            for slip_id, lines in by_code.items()
        }

    def _webvue_inputs(self):
        """The five entered inputs by wire key; an input line the payslip lacks reads as zero."""
        self.ensure_one()
        entered = {line.code: line.amount for line in self.input_line_ids}
        return {key: entered.get(code, 0) for key, code in INPUT_CODES.items()}

    def _webvue_snapshot_paid_days(self):
        """Store the days of the period under contract, 0 for a payslip whose version has no start date."""
        calculator = self.env['webvue.hr.payroll.calculator']
        for payslip in self:
            has_start = payslip.contract_id.contract_date_start
            payslip.webvue_paid_days = calculator._webvue_paid_days(payslip) if has_start else 0

    def _webvue_snapshot_gosi_class(self):
        """Store the GOSI class of a payslip of the company's payroll structure (other structures have none)."""
        calculator = self.env['webvue.hr.payroll.calculator']
        for payslip in self:
            settings = self.env['webvue.hr.payroll.settings']._webvue_for_company(payslip.company_id)
            if payslip.struct_id == settings.structure_id:
                compensation = calculator._webvue_compensation(payslip.employee_id)
                payslip.webvue_gosi_class = calculator._webvue_gosi_class(payslip.employee_id, compensation)

    def _webvue_iban_missing(self):
        """Ids of the payslips whose employee has no IBAN on the compensation record."""
        with_iban = self.env['webvue.hr.compensation'].search([
            ('employee_id', 'in', self.employee_id.ids), ('iban', '!=', False),
        ]).employee_id
        return {slip.id for slip in self if slip.employee_id not in with_iban}
