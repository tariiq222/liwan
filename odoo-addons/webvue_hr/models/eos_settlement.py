# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import Decimal

from odoo import fields, models

from .eos_case import EOS_CASE_SELECTION
from .payroll_math import day_amount, eos_award, money, service_years
from odoo.addons.webvue_hr.rules import WebVueHrRule

TRANSITION_FORBIDDEN = 'transition_forbidden'
EOS_CASE_MISSING = 'eos_case_missing'


class WebVueHrPayrollEosSettlement(models.Model):
    """The final settlement of one leaver: end-of-service award, leave encashment and open deductions.

    The figures are snapshots. A confirmed settlement is locked and the payslip of the departure month
    reads its award, encashment and deduction from it.
    """

    _name = 'webvue.hr.payroll.eos.settlement'
    _description = 'WebVue HR end-of-service settlement'
    _webvue_scope = 'company'

    employee_id = fields.Many2one('hr.employee', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='employee_id.company_id', store=True, index=True)
    currency_id = fields.Many2one(related='company_id.currency_id')
    departure_date = fields.Date(
        help='The departure date of the employee when the settlement was computed: a later edit of the '
             'departure shows as a mismatch.',
    )
    case = fields.Selection(EOS_CASE_SELECTION, required=True)
    service_years = fields.Float(digits=(8, 4))
    eos_wage = fields.Monetary()
    award = fields.Monetary()
    leave_days = fields.Float()
    leave_amount = fields.Monetary()
    open_deductions = fields.Monetary()
    total = fields.Monetary()
    state = fields.Selection([('draft', 'Draft'), ('confirmed', 'Confirmed')], required=True, default='draft')

    _employee_unique = models.Constraint('UNIQUE(employee_id)', 'an employee has one final settlement')
    _deductions_valid = models.Constraint('CHECK(open_deductions >= 0)', 'open deductions must not be negative')

    def _webvue_estimate(self, employee, day, case):
        """The settlement figures of ``employee`` leaving on ``day`` in ``case``, as Decimals."""
        calculator = self.env['webvue.hr.payroll.calculator']
        # The stock first-contract-date helper is HR-user only; the payroll reader reads the versions instead.
        starts = self.env['hr.version'].search([
            ('employee_id', '=', employee.id), ('contract_date_start', '!=', False),
        ]).mapped('contract_date_start')
        start = min(starts, default=False)
        if not start:
            code = 'contract_missing'
            raise WebVueHrRule(
                code, self.env._('%(name)s has no contract starting on a date.', name=employee.name),
                field='employee_id', details={'employee_id': employee.id},
            )
        wage = calculator._webvue_compensation(employee)._webvue_fixed_wage()
        years = service_years(start, day)
        settings = self.env['webvue.hr.payroll.settings']._webvue_for_company(employee.company_id)
        leave_days = self._webvue_leave_days(employee, settings, day)
        return {
            'start_date': start,
            'end_date': day,
            'service_years': years,
            'eos_wage': wage,
            'case': case,
            'award': eos_award(wage, years, case),
            'leave_days': leave_days,
            'leave_amount': day_amount(wage, leave_days, settings.day_divisor),
        }

    def _webvue_leave_days(self, employee, settings, day):
        """The annual leave balance on ``day`` including requested leave; a negative balance pays nothing."""
        leave_type = settings.annual_leave_type_id
        if not leave_type:
            code = 'annual_leave_type_missing'
            raise WebVueHrRule(
                code, self.env._('Choose the annual leave type in the payroll settings first.'),
                field='annual_leave_type_id',
            )
        data = leave_type.with_context(allowed_company_ids=[employee.company_id.id]).get_allocation_data(
            employee, target_date=day,
        )[employee]
        remaining = next((info['virtual_remaining_leaves'] for _name, info, _req, type_id in data if type_id == leave_type.id), 0)
        return max(Decimal(str(remaining)), Decimal(0))

    def _webvue_resolve_case(self, employee, case):
        """The explicit case, else the one the departure reason maps to; neither → 422 ``eos_case_missing``."""
        resolved = case or self.env['webvue.hr.payroll.eos.case']._webvue_case_for(
            employee.departure_reason_id, employee.company_id,
        )
        if not resolved:
            raise WebVueHrRule(
                EOS_CASE_MISSING,
                self.env._('Choose the end-of-service case: the departure reason of %(name)s has no mapping.', name=employee.name),
                field='case', details={'employee_id': employee.id},
            )
        return resolved

    def _webvue_values(self, employee, case, open_deductions):
        """Field values of a settlement of ``employee`` on the day they leave."""
        if not employee.departure_date:
            code = 'departure_missing'
            raise WebVueHrRule(
                code, self.env._('%(name)s has no departure date.', name=employee.name),
                field='departure_date', details={'employee_id': employee.id},
            )
        deductions = money(Decimal(str(open_deductions)))
        estimate = self._webvue_estimate(employee, employee.departure_date, case)
        return {
            'departure_date': employee.departure_date,
            'case': case,
            'service_years': float(estimate['service_years']),
            'eos_wage': float(estimate['eos_wage']),
            'award': float(estimate['award']),
            'leave_days': float(estimate['leave_days']),
            'leave_amount': float(estimate['leave_amount']),
            'open_deductions': float(deductions),
            'total': float(estimate['award'] + estimate['leave_amount'] - deductions),
        }

    def _webvue_save_draft(self, employee, case, open_deductions):
        """Create or recompute the draft settlement of ``employee``; a confirmed one is locked (403)."""
        settlement = self.search([('employee_id', '=', employee.id)], limit=1)
        if settlement.state == 'confirmed':
            raise WebVueHrRule(
                TRANSITION_FORBIDDEN, self.env._('A confirmed settlement cannot be changed.'), field='state', status=403,
            )
        if open_deductions is None:
            open_deductions = settlement.open_deductions
        values = self._webvue_values(employee, self._webvue_resolve_case(employee, case or settlement.case), open_deductions)
        if settlement:
            settlement.write(values)
            return settlement
        return self.create({'employee_id': employee.id, **values})

    def _webvue_confirm(self):
        """Recompute against today's balance and departure, then lock. The caller never settles their own pay."""
        self.ensure_one()
        if self.state == 'confirmed':
            raise WebVueHrRule(
                TRANSITION_FORBIDDEN, self.env._('The settlement is already confirmed.'), field='state', status=403,
            )
        if self.employee_id.user_id == self.env.user:
            raise WebVueHrRule(
                TRANSITION_FORBIDDEN, self.env._('You cannot confirm your own settlement.'),
                field='employee_id', status=403, details={'employee_id': self.employee_id.id},
            )
        self.write({**self._webvue_values(self.employee_id, self.case, self.open_deductions), 'state': 'confirmed'})

    def _webvue_departure_mismatch(self):
        self.ensure_one()
        return self.departure_date != self.employee_id.departure_date
