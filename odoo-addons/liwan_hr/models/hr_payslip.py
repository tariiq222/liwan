# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import Decimal

from markupsafe import Markup

from odoo import fields, models
from odoo.tools.misc import format_amount

from .payroll_math import money
from odoo.addons.liwan_hr.rules import LiwanHrRule

# Line codes of the Saudi structure (data/hr_payroll_structure_data.xml) that make up the figures
# a payslip shows. Deductions are negative lines, the employer share is a positive statistical line.
OTHER_ALLOWANCE_CODES = ('TRANSPORT', 'OTHER', 'OVERTIME', 'BONUS', 'EOS', 'LEAVE_ENC')
EARNING_CODES = ('BASIC', 'HOUSING', *OTHER_ALLOWANCE_CODES)
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
# The payslip value each salary rule of the Saudi structure reads (``current_contract.<key>``) and the sign of its
# line: a stored line differs from this when what it was computed from has changed since.
RULE_VALUE_KEYS = {
    'BASIC': ('basic', 1), 'HOUSING': ('housing', 1), 'TRANSPORT': ('transport', 1), 'OTHER': ('other', 1),
    'EOS': ('eos', 1), 'LEAVE_ENC': ('leave_encashment', 1),
    'ABSENCE': ('absence', 1), 'UNPAID': ('unpaid', 1), 'SETTLEMENT_DED': ('settlement_deduction', -1),
    'GOSI_EE_ANN': ('gosi_ee_annuities', -1), 'GOSI_EE_SANED': ('gosi_ee_saned', -1),
    'GOSI_ER_ANN': ('gosi_er_annuities', 1), 'GOSI_ER_SANED': ('gosi_er_saned', 1), 'GOSI_ER_OH': ('gosi_er_hazards', 1),
}


class HrPayslip(models.Model):
    _inherit = 'hr.payslip'

    liwan_department_id = fields.Many2one(
        'hr.department', string='Department', readonly=True, copy=False,
        help='The department of the contract version in force on the last paid day, snapshotted when the payslip is computed.',
    )
    liwan_paid_days = fields.Integer(
        string='Paid days', readonly=True, copy=False,
        help='Days of the period under contract, snapshotted when the payslip is created and computed: '
             'the employee reads it on their own payslip without access to the contract.',
    )

    liwan_gosi_class = fields.Selection(
        selection=lambda self: self.env['liwan.hr.gosi.rate']._fields['nationality_class'].selection,
        string='GOSI class', readonly=True, copy=False,
        help='The GOSI nationality class used when the payslip was computed: the GOSI statement of an approved '
             'run reads it instead of the live nationality and registration date.',
    )

    def get_current_contract_dict(self, contract, contracts):
        """Add the Saudi payslip values the structure rules read as ``current_contract.<key>``.

        Only payslips of the company's payroll structure get them: other structures read none of these keys.
        """
        values = super().get_current_contract_dict(contract, contracts)
        settings = self.env['liwan.hr.payroll.settings']._liwan_for_company(self.company_id)
        if self.struct_id != settings.structure_id:
            return values
        return {**values, **self.env['liwan.hr.payroll.calculator']._liwan_payslip_values(self)}

    def _liwan_refuse_saudi_rules_outside(self):
        """Refuse a structure that uses the Saudi rules but is not the company's: they would read zeros."""
        saudi_rule = self.env.ref('liwan_hr.rule_net')
        if saudi_rule not in self.struct_id.get_structure_with_parents().rule_ids:
            return
        code = 'payroll_structure_mismatch'
        raise LiwanHrRule(
            code,
            self.env._('The payslip structure uses the Saudi payroll rules but is not the payroll structure of the company.'),
            field='employee_id', details={'employee_id': self.employee_id.id, 'structure_id': self.struct_id.id},
        )

    def _liwan_check_structure_and_contract(self):
        """Fail loudly before the engine silently skips a payslip: wrong Saudi structure or no contract."""
        settings = self.env['liwan.hr.payroll.settings']._liwan_for_company(self.company_id)
        if self.struct_id == settings.structure_id:
            self.env['liwan.hr.payroll.calculator']._liwan_require_contract(self)
        else:
            self._liwan_refuse_saudi_rules_outside()

    def compute_sheet(self):
        for payslip in self:
            payslip._liwan_check_structure_and_contract()
            payslip.liwan_department_id = payslip.contract_id.department_id
            payslip._liwan_snapshot_paid_days()
            payslip._liwan_snapshot_gosi_class()
        return super().compute_sheet()

    def _liwan_period_version(self):
        """The employee version in force on the last paid day of the period.

        The payslip carries this single version, so a mid-month version change never doubles the basic.
        """
        self.ensure_one()
        last_day = min(day for day in (self.date_to, self.employee_id.departure_date) if day)
        versions = self.env['hr.version'].search([('employee_id', '=', self.employee_id.id)], order='date_version')
        in_force = versions.filtered(lambda version: version.date_version <= last_day)
        return in_force[-1:] or versions[:1]

    def _liwan_mail_final_payslips(self):
        """Mail the payslip of an employee whose service ended with this month to the personal email on record.

        A leaver's account is closed when the employee is archived, so the last payslip would otherwise never
        reach them. Called once, when the run is approved.
        """
        for slip in self:
            employee = slip.employee_id
            if not employee.departure_date or employee.departure_date > slip.date_to:
                continue
            # `private_email` is readable by HR users only, which a payroll approver is not.
            address = (employee.sudo().private_email or '').strip()
            if address:
                slip._liwan_queue_payslip_mail(address)

    def _liwan_queue_payslip_mail(self, address):
        self.ensure_one()
        amounts = self._liwan_amounts()[self.id]
        currency = self.company_id.currency_id
        lines = self.line_ids.filtered(
            lambda line: line.appears_on_payslip and line.code not in (NET_CODE, *GOSI_EMPLOYER_CODES) and line.total,
        ).sorted('sequence')
        rows = Markup('').join(
            Markup('<tr><td>{}</td><td>{}</td></tr>').format(line.name, format_amount(self.env, line.total, currency))
            for line in lines
        )
        body = Markup('<p>{greeting}</p><table>{rows}<tr><th>{net_label}</th><th>{net}</th></tr></table>').format(
            greeting=self.env._('Dear %(name)s, your final payslip for %(month)s from %(company)s is below.',
                                name=self.employee_id.name, month=self.date_from.strftime('%Y-%m'), company=self.company_id.name),
            rows=rows, net_label=self.env._('Net pay'), net=format_amount(self.env, amounts['net'], currency),
        )
        # Mailing needs the outgoing-mail right, which no payroll capability carries.
        self.env['mail.mail'].sudo().create({
            'subject': self.env._('Your final payslip for %(month)s', month=self.date_from.strftime('%Y-%m')),
            'body_html': body,
            'email_to': address,
            'author_id': self.env.user.partner_id.id,
            'auto_delete': True,
        })

    def _liwan_amounts(self):
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

    def _liwan_inputs(self):
        """The five entered inputs by wire key; an input line the payslip lacks reads as zero."""
        self.ensure_one()
        entered = {line.code: line.amount for line in self.input_line_ids}
        return {key: entered.get(code, 0) for key, code in INPUT_CODES.items()}

    def _liwan_snapshot_paid_days(self):
        """Store the days of the period under contract, 0 for a payslip whose version has no start date."""
        calculator = self.env['liwan.hr.payroll.calculator']
        for payslip in self:
            has_start = payslip.contract_id.contract_date_start
            payslip.liwan_paid_days = calculator._liwan_paid_days(payslip) if has_start else 0

    def _liwan_snapshot_gosi_class(self):
        """Store the GOSI class of a payslip of the company's payroll structure (other structures have none)."""
        calculator = self.env['liwan.hr.payroll.calculator']
        for payslip in self:
            settings = self.env['liwan.hr.payroll.settings']._liwan_for_company(payslip.company_id)
            if payslip.struct_id == settings.structure_id:
                compensation = calculator._liwan_compensation(payslip.employee_id)
                payslip.liwan_gosi_class = calculator._liwan_gosi_class(payslip.employee_id, compensation)

    def _liwan_paid_iban(self):
        """``{payslip_id: IBAN}``: the live compensation IBAN of an editable run, the approval snapshot of a fixed one.

        One helper decides where the IBAN of a payslip comes from, so the approval blocker, the run warnings and
        the payslip rows never disagree with each other. A payslip outside a run, or in a run whose state can still
        change, reads the compensation; a fixed run reads the ``liwan.hr.payslip.payment`` row stored at approval
        (owner decisions D-4 and D-10). The salary files do not call it: they read that row directly, which for the
        fixed runs they serve is the same value.
        """
        fixed = self.filtered(lambda slip: slip.payslip_run_id and not slip.payslip_run_id._liwan_is_editable())
        live = self - fixed
        compensations = self.env['liwan.hr.compensation'].search([('employee_id', 'in', live.employee_id.ids)])
        by_employee = {record.employee_id.id: record.iban for record in compensations}
        snapshots = self.env['liwan.hr.payslip.payment']._liwan_by_payslip(fixed)
        paid = {slip.id: snapshots[slip.id].iban if slip.id in snapshots else '' for slip in fixed}
        paid.update({slip.id: by_employee.get(slip.employee_id.id) for slip in live})
        return {slip.id: paid[slip.id] or '' for slip in self}

    def _liwan_iban_missing(self):
        """Ids of the payslips to be paid to an employee who has no IBAN recorded.

        A payslip is to be paid while it is not computed yet (its net is unknown) or when its net is positive; a
        computed zero net pays nothing and needs no IBAN (owner decision D-10). The IBAN is the live one while the
        run can still change and the snapshot stored at approval once it is fixed (owner decision D-4).
        """
        with_iban = self._liwan_paid_iban()
        amounts = self._liwan_amounts()
        return {
            slip.id for slip in self
            if not with_iban[slip.id] and (slip.state == 'draft' or amounts[slip.id]['net'] > 0)
        }
