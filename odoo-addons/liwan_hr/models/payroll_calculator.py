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
    reported_gosi_wage,
)
from odoo.addons.liwan_hr.rules import LiwanHrRule

ABSENCE_INPUT = 'WV_ABSENCE_DAYS'
NO_AMOUNTS = (Decimal(0), Decimal(0))
SETTLEMENT_KEYS = ('award', 'leave_amount', 'open_deductions')


class LiwanHrPayrollCalculator(models.AbstractModel):
    """The Saudi payroll arithmetic applied to ORM records. Pure rules live in ``payroll_math``."""

    _name = 'liwan.hr.payroll.calculator'
    _description = 'LiwanOS HR payroll calculator'

    @api.model
    def _liwan_gosi_class(self, employee, compensation):
        """The GOSI class of an employee; a missing nationality or registration date is a structured 422."""
        try:
            return nationality_class(employee.current_version_id.country_id.code, compensation.gosi_registration_date)
        except PayrollMathError as error:
            raise LiwanHrRule(
                error.code, self.env._('Payroll cannot compute GOSI: %(code)s', code=error.code),
                field='employee_id', details={'employee_id': employee.id},
            ) from error

    @api.model
    def _liwan_gosi(self, employee, compensation, day, ratio):
        """GOSI contributions of one employee for the part ``ratio`` of a month ending on ``day``.

        Returns the nationality class, the contributory wage and per branch ``(employee, employer)``.
        """
        gosi_class = self._liwan_gosi_class(employee, compensation)
        rates = self.env['liwan.hr.gosi.rate']._liwan_rates_for(gosi_class, day)
        if not rates:
            code = 'gosi_rate_missing'
            raise LiwanHrRule(
                code,
                self.env._('No GOSI rate is defined for the class %(cls)s on %(day)s.', cls=gosi_class, day=day),
                field='employee_id',
                details={'employee_id': employee.id, 'nationality_class': gosi_class},
            )
        base = compensation._liwan_gosi_base()
        branches = gosi_amounts(base, {branch: row._liwan_as_rate() for branch, row in rates.items()}, Decimal(ratio))
        table = {branch: row._liwan_as_rate() for branch, row in rates.items()}
        return {
            'nationality_class': gosi_class,
            'contributory_wage': reported_gosi_wage(base, table, Decimal(ratio)),
            'branches': branches,
            'employee_total': sum((employee_part for employee_part, _ in branches.values()), Decimal(0)),
            'employer_total': sum((employer_part for _, employer_part in branches.values()), Decimal(0)),
        }

    @api.model
    def _liwan_payslip_values(self, payslip):
        """The values the salary rules of the Saudi structure read as ``current_contract.<key>``.

        Money is rounded half-up before it leaves as a float; deductions the structure shows as
        negative lines (``absence``, ``unpaid``) are already negative, GOSI shares are positive.
        """
        payslip.ensure_one()
        calculator = self.with_company(payslip.company_id)
        employee = payslip.employee_id
        version = payslip.contract_id
        self._liwan_require_contract(payslip)
        settings = self.env['liwan.hr.payroll.settings']._liwan_for_company(payslip.company_id)
        divisor = settings.day_divisor
        compensation = calculator._liwan_compensation(employee)
        window_start = max(payslip.date_from, version.contract_date_start)
        window_end = min(
            day for day in (payslip.date_to, version.contract_date_end, employee.departure_date) if day
        )
        days = calculator._liwan_paid_days(payslip)
        unpaid_days = min(
            calculator._liwan_unpaid_days(employee, settings, window_start, window_end), Decimal(days),
        )
        absence_days = min(calculator._liwan_absence_days(payslip), Decimal(days) - unpaid_days)
        fixed_wage = compensation._liwan_fixed_wage()
        ratio = Decimal(days) / divisor
        gosi_result = calculator._liwan_gosi(employee, compensation, payslip.date_to, ratio)
        gosi = gosi_result['branches']
        settlement = calculator._liwan_settlement_amounts(payslip)
        return {key: float(value) for key, value in {
            'basic': self._liwan_earning(compensation.basic_wage, days, divisor),
            'housing': self._liwan_earning(compensation.housing_allowance, days, divisor),
            'transport': self._liwan_earning(compensation.transport_allowance, days, divisor),
            'other': self._liwan_earning(compensation.other_allowance, days, divisor),
            'absence': -day_amount(fixed_wage, absence_days, divisor),
            'unpaid': -day_amount(fixed_wage, unpaid_days, divisor),
            'gosi_wage': gosi_result['contributory_wage'],
            'gosi_ee_annuities': gosi.get('annuities', NO_AMOUNTS)[0],
            'gosi_ee_saned': gosi.get('saned', NO_AMOUNTS)[0],
            'gosi_er_annuities': gosi.get('annuities', NO_AMOUNTS)[1],
            'gosi_er_saned': gosi.get('saned', NO_AMOUNTS)[1],
            'gosi_er_hazards': gosi.get('hazards', NO_AMOUNTS)[1],
            'eos': settlement['award'],
            'leave_encashment': settlement['leave_amount'],
            'settlement_deduction': settlement['open_deductions'],
            'paid_days': days,
            'unpaid_days': unpaid_days,
        }.items()}

    @api.model
    def _liwan_settlement_amounts(self, payslip):
        """Award, leave encashment and open deductions of the confirmed settlement that falls in the payslip's month.

        Only the settlement dated like the employee's current departure is read: another one is history, and
        approval refuses a leaver whose current departure has none.
        """
        employee = payslip.employee_id
        settlement = self.env['liwan.hr.payroll.eos.settlement'].search([
            ('employee_id', '=', employee.id),
            ('state', '=', 'confirmed'),
            ('departure_date', '=', employee.departure_date),
            ('departure_date', '>=', payslip.date_from),
            ('departure_date', '<=', payslip.date_to),
        ], limit=1)
        if not settlement:
            return dict.fromkeys(SETTLEMENT_KEYS, 0)
        return {key: money(Decimal(str(settlement[key]))) for key in SETTLEMENT_KEYS}

    @api.model
    def _liwan_paid_days(self, payslip):
        """Days of the period the employee is under contract, capped by the day divisor."""
        employee = payslip.employee_id
        version = payslip.contract_id
        settings = self.env['liwan.hr.payroll.settings']._liwan_for_company(payslip.company_id)
        return paid_days(
            payslip.date_from, payslip.date_to, version.contract_date_start,
            version.contract_date_end, employee.departure_date, settings.day_divisor,
        )

    @api.model
    def _liwan_require_contract(self, payslip):
        """The payslip needs a version of a contract that starts on a date: the engine skips it silently otherwise."""
        if payslip.contract_id.contract_date_start:
            return
        code = 'contract_missing'
        raise LiwanHrRule(
            code,
            self.env._('%(name)s has no contract starting on a date.', name=payslip.employee_id.name),
            field='employee_id', details={'employee_id': payslip.employee_id.id},
        )

    @api.model
    def _liwan_earning(self, monthly, days, divisor):
        return money(Decimal(str(monthly)) * days / divisor)

    @api.model
    def _liwan_compensation(self, employee):
        compensation = self.env['liwan.hr.compensation'].search([('employee_id', '=', employee.id)], limit=1)
        if not compensation:
            code = 'compensation_missing'
            raise LiwanHrRule(
                code,
                self.env._('%(name)s has no compensation record.', name=employee.name),
                field='employee_id', details={'employee_id': employee.id},
            )
        return compensation

    @api.model
    def _liwan_unpaid_days(self, employee, settings, window_start, window_end):
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
        return sum((self._liwan_leave_days(leave, window_start, window_end) for leave in leaves), Decimal(0))

    @api.model
    def _liwan_leave_days(self, leave, window_start, window_end):
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
    def _liwan_absence_days(self, payslip):
        entered = sum(
            Decimal(str(line.amount)) for line in payslip.input_line_ids if line.code == ABSENCE_INPUT
        )
        return max(entered, Decimal(0))
