# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date
from decimal import Decimal

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_hr.models.payroll_math import (
    day_amount,
    overlap_days,
    paid_days,
)

NOVEMBER = (date(2026, 11, 1), date(2026, 11, 30))


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollDayMath(TransactionCase):

    def test_paid_days(self):
        november = date(2026, 11, 1), date(2026, 11, 30)
        december = date(2026, 12, 1), date(2026, 12, 31)
        february = date(2027, 2, 1), date(2027, 2, 28)
        self.assertEqual(paid_days(*november, date(2026, 11, 16), None, None, 30), 15)
        self.assertEqual(paid_days(*december, date(2026, 1, 1), None, None, 30), 30)
        self.assertEqual(paid_days(*february, date(2026, 1, 1), None, None, 30), 30)
        self.assertEqual(paid_days(*february, date(2027, 2, 15), None, None, 30), 14)
        self.assertEqual(paid_days(*december, date(2026, 1, 1), None, date(2026, 12, 10), 30), 10)
        self.assertEqual(paid_days(*november, date(2026, 1, 1), date(2026, 10, 31), None, 30), 0)

    def test_overlap_days(self):
        self.assertEqual(overlap_days(date(2026, 11, 20), date(2026, 11, 22), *NOVEMBER), Decimal(3))
        self.assertEqual(overlap_days(date(2026, 11, 28), date(2026, 12, 3), *NOVEMBER), Decimal(3))
        self.assertEqual(
            overlap_days(date(2026, 11, 20), date(2026, 11, 20), *NOVEMBER, half_day=True), Decimal('0.5'))
        self.assertEqual(overlap_days(date(2026, 10, 10), date(2026, 10, 12), *NOVEMBER), Decimal(0))

    def test_day_amount(self):
        self.assertEqual(day_amount(Decimal(12000), Decimal(3), 30), Decimal('1200.00'))
        self.assertEqual(day_amount(Decimal(10000), Decimal(1), 30), Decimal('333.33'))
