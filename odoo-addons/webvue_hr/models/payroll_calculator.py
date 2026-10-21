# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import Decimal

from odoo import api, models

from .payroll_math import (
    PayrollMathError,
    day_amount,
    gosi_amounts,
    money,
    nationality_class,
    overlap_days,
    paid_days,
)
from odoo.addons.webvue_hr.rules import WebVueHrRule

ABSENCE_INPUT = 'WV_ABSENCE_DAYS'
NO_AMOUNTS = (Decimal(0), Decimal(0))


class WebVueHrPayrollCalculator(models.AbstractModel):
    """The Saudi payroll arithmetic applied to ORM records. Pure rules live in ``payroll_math``."""

    _name = 'webvue.hr.payroll.calculator'
    _description = 'WebVue HR payroll calculator'

    @api.model
    def _webvue_gosi(self, employee, compensation, day, ratio):
        """GOSI contributions of one employee for the part ``ratio`` of a month ending on ``day``.

        Returns the nationality class, the contributory wage and per branch ``(employee, employer)``.
        """
        country = employee.current_version_id.country_id
        try:
            gosi_class = nationality_class(country.code, compensation.gosi_registration_date)
        except PayrollMathError as error:
            raise WebVueHrRule(
                error.code, self.env._('Payroll cannot compute GOSI: %(code)s', code=error.code),
                field='employee_id', details={'employee_id': employee.id},
            ) from error
        rates = self.env['webvue.hr.gosi.rate']._webvue_rates_for(gosi_class, day)
        if not rates:
            code = 'gosi_rate_missing'
            raise WebVueHrRule(
                code,
                self.env._('No GOSI rate is defined for the class %(cls)s on %(day)s.', cls=gosi_class, day=day),
                field='employee_id',
                details={'employee_id': employee.id, 'nationality_class': gosi_class},
            )
        base = compensation._webvue_gosi_base()
        branches = gosi_amounts(base, {branch: row._webvue_as_rate() for branch, row in rates.items()}, Decimal(ratio))
        return {
            'nationality_class': gosi_class,
            'branches': branches,
            'employee_total': sum((employee_part for employee_part, _ in branches.values()), Decimal(0)),
            'employer_total': sum((employer_part for _, employer_part in branches.values()), Decimal(0)),
        }

    @api.model
    def _webvue_payslip_values(self, payslip):
        """The values the salary rules of the Saudi structure read as ``current_contract.<key>``.

        Money is rounded half-up before it leaves as a float; deductions the structure shows as
        negative lines (``absence``, ``unpaid``) are already negative, GOSI shares are positive.
        """
        payslip.ensure_one()
        calculator = self.with_company(payslip.company_id)
        employee = payslip.employee_id
        version = payslip.contract_id
        self._webvue_require_contract(payslip)
        settings = self.env['webvue.hr.payroll.settings']._webvue_for_company(payslip.company_id)
        divisor = settings.day_divisor
        compensation = calculator._webvue_compensation(employee)
        window_start = max(payslip.date_from, version.contract_date_start)
        window_end = min(
            day for day in (payslip.date_to, version.contract_date_end, employee.departure_date) if day
        )
        days = paid_days(
            payslip.date_from, payslip.date_to, version.contract_date_start,
            version.contract_date_end, employee.departure_date, divisor,
        )
        unpaid_days = min(
            calculator._webvue_unpaid_days(employee, settings, window_start, window_end), Decimal(days),
        )
        absence_days = min(calculator._webvue_absence_days(payslip), Decimal(days) - unpaid_days)
        fixed_wage = compensation._webvue_fixed_wage()
        ratio = Decimal(days) / divisor
        gosi = calculator._webvue_gosi(employee, compensation, payslip.date_to, ratio)['branches']
        return {key: float(value) for key, value in {
            'basic': self._webvue_earning(compensation.basic_wage, days, divisor),
            'housing': self._webvue_earning(compensation.housing_allowance, days, divisor),
            'transport': self._webvue_earning(compensation.transport_allowance, days, divisor),
            'other': self._webvue_earning(compensation.other_allowance, days, divisor),
            'absence': -day_amount(fixed_wage, absence_days, divisor),
            'unpaid': -day_amount(fixed_wage, unpaid_days, divisor),
            'gosi_base': money(compensation._webvue_gosi_base() * ratio),
            'gosi_ee_annuities': gosi.get('annuities', NO_AMOUNTS)[0],
            'gosi_ee_saned': gosi.get('saned', NO_AMOUNTS)[0],
            'gosi_er_annuities': gosi.get('annuities', NO_AMOUNTS)[1],
            'gosi_er_saned': gosi.get('saned', NO_AMOUNTS)[1],
            'gosi_er_hazards': gosi.get('hazards', NO_AMOUNTS)[1],
            'eos': 0,
            'leave_encashment': 0,
            'settlement_deduction': 0,
            'paid_days': days,
            'unpaid_days': unpaid_days,
        }.items()}

    @api.model
    def _webvue_require_contract(self, payslip):
        """The payslip needs a version of a contract that starts on a date: the engine skips it silently otherwise."""
        if payslip.contract_id.contract_date_start:
            return
        code = 'contract_missing'
        raise WebVueHrRule(
            code,
            self.env._('%(name)s has no contract starting on a date.', name=payslip.employee_id.name),
            field='employee_id', details={'employee_id': payslip.employee_id.id},
        )

    @api.model
    def _webvue_earning(self, monthly, days, divisor):
        return money(Decimal(str(monthly)) * days / divisor)

    @api.model
    def _webvue_compensation(self, employee):
        compensation = self.env['webvue.hr.compensation'].search([('employee_id', '=', employee.id)], limit=1)
        if not compensation:
            code = 'compensation_missing'
            raise WebVueHrRule(
                code,
                self.env._('%(name)s has no compensation record.', name=employee.name),
                field='employee_id', details={'employee_id': employee.id},
            )
        return compensation

    @api.model
    def _webvue_unpaid_days(self, employee, settings, window_start, window_end):
        """Calendar days of validated unpaid leave inside the contract window of the month."""
        if window_end < window_start:
            return Decimal(0)
        leaves = self.env['hr.leave'].search([
            ('employee_id', '=', employee.id),
            ('state', '=', 'validate'),
            ('holiday_status_id', 'in', settings.unpaid_leave_type_ids.ids),
            ('request_date_from', '<=', window_end),
            ('request_date_to', '>=', window_start),
        ])
        return sum((self._webvue_leave_days(leave, window_start, window_end) for leave in leaves), Decimal(0))

    @api.model
    def _webvue_leave_days(self, leave, window_start, window_end):
        """Calendar days of a leave in the window; a part-day hour leave counts its own fraction of a day."""
        part_day = (
            leave.request_unit_hours and not leave.request_unit_half
            and leave.request_date_from == leave.request_date_to and leave.number_of_days < 1
        )
        if part_day:
            inside = window_start <= leave.request_date_from <= window_end
            return Decimal(str(leave.number_of_days)) if inside else Decimal(0)
        return overlap_days(
            leave.request_date_from, leave.request_date_to, window_start, window_end, leave.request_unit_half,
        )

    @api.model
    def _webvue_absence_days(self, payslip):
        entered = sum(
            Decimal(str(line.amount)) for line in payslip.input_line_ids if line.code == ABSENCE_INPUT
        )
        return max(entered, Decimal(0))
