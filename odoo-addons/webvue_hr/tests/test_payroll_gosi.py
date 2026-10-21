# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date
from decimal import Decimal

from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_hr.models.payroll_math import (
    PayrollMathError,
    contributory_wage,
    gosi_amounts,
    nationality_class,
)
from odoo.addons.webvue_hr.rules import WebVueHrRule


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollGosi(TransactionCase):

    def _amounts(self, cls, day, base, ratio=Decimal(1)):
        rates = self.env['webvue.hr.gosi.rate']._webvue_rates_for(cls, day)
        table = {branch: row._webvue_as_rate() for branch, row in rates.items()}
        return gosi_amounts(Decimal(base), table, ratio)

    def _totals(self, amounts):
        return (
            sum(employee for employee, _ in amounts.values()),
            sum(employer for _, employer in amounts.values()),
        )

    def test_nationality_class_boundaries(self):
        self.assertEqual(nationality_class('SA', date(2024, 7, 2)), 'saudi_before_2024')
        self.assertEqual(nationality_class('SA', date(2024, 7, 3)), 'saudi_from_2024')
        self.assertEqual(nationality_class('AE', None), 'gcc')
        self.assertEqual(nationality_class('EG', None), 'non_saudi')
        with self.assertRaises(PayrollMathError) as missing:
            nationality_class('SA', None)
        self.assertEqual(missing.exception.code, 'gosi_registration_missing')
        with self.assertRaises(PayrollMathError) as unknown:
            nationality_class(None, None)
        self.assertEqual(unknown.exception.code, 'nationality_missing')

    def test_contributory_wage_caps(self):
        self.assertEqual(contributory_wage(Decimal(1200), Decimal(1500), Decimal(45000)), Decimal(1500))
        self.assertEqual(contributory_wage(Decimal(60000), Decimal(1500), Decimal(45000)), Decimal(45000))
        self.assertEqual(contributory_wage(Decimal(12500), Decimal(1500), Decimal(45000)), Decimal(12500))

    def test_rate_lookup_by_date(self):
        rates = self.env['webvue.hr.gosi.rate']
        later = rates._webvue_rates_for('saudi_from_2024', date(2026, 11, 30))['annuities']
        earlier = rates._webvue_rates_for('saudi_from_2024', date(2026, 6, 30))['annuities']
        self.assertEqual((later.employee_rate, later.employer_rate), (10.0, 10.0))
        self.assertEqual((earlier.employee_rate, earlier.employer_rate), (9.5, 9.5))

    def test_gosi_amounts_per_class(self):
        day = date(2026, 11, 30)
        self.assertEqual(
            self._totals(self._amounts('saudi_before_2024', day, 12500)),
            (Decimal('1218.75'), Decimal('1468.75')),
        )
        self.assertEqual(
            self._totals(self._amounts('saudi_from_2024', day, 12500)),
            (Decimal('1343.75'), Decimal('1593.75')),
        )
        self.assertEqual(
            self._totals(self._amounts('non_saudi', day, 7500)),
            (Decimal('0.00'), Decimal('150.00')),
        )
        self.assertEqual(self._totals(self._amounts('saudi_before_2024', day, 60000))[0], Decimal('4387.50'))

    def test_proration_applies_after_the_cap(self):
        amounts = self._amounts('saudi_before_2024', date(2026, 11, 30), 60000, Decimal('0.5'))
        self.assertEqual(self._totals(amounts)[0], Decimal('2193.75'))

    def test_gcc_without_rows_refuses_with_employee(self):
        employee = self.env['hr.employee'].create({'name': 'Gulf Hand'})
        employee.version_id.write({'country_id': self.env.ref('base.ae').id})
        compensation = self.env['webvue.hr.compensation'].create({'employee_id': employee.id, 'basic_wage': 5000})
        with self.assertRaises(WebVueHrRule) as refusal:
            self.env['webvue.hr.payroll.calculator']._webvue_gosi(
                employee, compensation, date(2026, 11, 30), Decimal(1),
            )
        self.assertEqual(refusal.exception.code, 'gosi_rate_missing')
        self.assertEqual(refusal.exception.details['nationality_class'], 'gcc')
        self.assertEqual(refusal.exception.details['employee_id'], employee.id)

    def test_calculator_totals_a_saudi_employee(self):
        employee = self.env['hr.employee'].create({'name': 'Layla Old'})
        employee.version_id.write({'country_id': self.env.ref('base.sa').id})
        compensation = self.env['webvue.hr.compensation'].create({
            'employee_id': employee.id, 'basic_wage': 10000, 'housing_allowance': 2500,
            'transport_allowance': 1000, 'gosi_registration_date': date(2020, 1, 1),
        })
        result = self.env['webvue.hr.payroll.calculator']._webvue_gosi(
            employee, compensation, date(2026, 11, 30), Decimal(1),
        )
        self.assertEqual(result['nationality_class'], 'saudi_before_2024')
        self.assertEqual(result['employee_total'], Decimal('1218.75'))
        self.assertEqual(result['employer_total'], Decimal('1468.75'))

    def test_company_row_overrides_shared_row_of_same_date(self):
        shared = self.env['webvue.hr.gosi.rate']._webvue_rates_for('non_saudi', date(2026, 1, 1))['hazards']
        own = self.env['webvue.hr.gosi.rate'].create({
            'company_id': self.env.company.id, 'branch': 'hazards', 'nationality_class': 'non_saudi',
            'date_from': shared.date_from, 'employee_rate': 0, 'employer_rate': 3,
            'wage_min': 1500, 'wage_max': 45000,
        })
        found = self.env['webvue.hr.gosi.rate']._webvue_rates_for('non_saudi', date(2026, 1, 1))['hazards']
        self.assertEqual(found, own)
