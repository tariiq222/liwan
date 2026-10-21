# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import Decimal

from odoo import api, models

from .payroll_math import PayrollMathError, gosi_amounts, nationality_class
from odoo.addons.webvue_hr.rules import WebVueHrRule


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
