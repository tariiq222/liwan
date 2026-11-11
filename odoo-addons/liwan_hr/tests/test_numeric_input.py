# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.serializers.hr_leave import (
    MAX_ALLOCATION_DAYS,
    parse_allocation,
)
from odoo.addons.liwan_hr.serializers.shifts.hr_shift import _attendance_vals

BAD_NUMBERS = (float('nan'), float('inf'), float('-inf'), True, '5', -1, [5])
LINE = {'dayofweek': '0', 'day_period': 'morning', 'hour_from': 8, 'hour_to': 12}


@tagged('post_install', '-at_install', 'liwan')
class TestHrNumericInput(TransactionCase):

    def _allocation(self, days):
        return parse_allocation({
            'employee_id': 1, 'leave_type_id': 1, 'number_of_days': days,
            'date_from': date.today().isoformat(),
        })

    def test_allocation_days_accept_a_finite_positive_number(self):
        self.assertEqual(self._allocation(2.5)['number_of_days'], 2.5)

    def test_allocation_days_reject_every_unusable_value(self):
        for value in (*BAD_NUMBERS, 0, MAX_ALLOCATION_DAYS + 1):
            with self.subTest(value=value), self.assertRaises(ApiError) as caught:
                self._allocation(value)
            self.assertEqual((caught.exception.status, caught.exception.field), (422, 'number_of_days'))

    def test_shift_hours_reject_every_unusable_value(self):
        for field in ('hour_from', 'hour_to'):
            for value in (*BAD_NUMBERS, 25):
                with self.subTest(field=field, value=value), self.assertRaises(ApiError) as caught:
                    _attendance_vals({**LINE, field: value})
                self.assertEqual((caught.exception.status, caught.exception.field), (422, field))

    def test_shift_hours_accept_a_finite_range(self):
        self.assertEqual(_attendance_vals({**LINE, 'hour_from': 8.5})['hour_from'], 8.5)
