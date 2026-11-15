# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import parse_iso_date


@tagged('post_install', '-at_install', 'liwan')
class TestParseIsoDate(TransactionCase):

    def test_a_calendar_day_is_parsed(self):
        self.assertEqual(parse_iso_date('2027-01-31', 'validity_date'), date(2027, 1, 31))

    def test_none_passes_through(self):
        self.assertIsNone(parse_iso_date(None, 'validity_date'))

    def test_anything_else_is_a_422_naming_the_field(self):
        for value in ('2027-13-01', '2027-02-30', '20270131', '2027-1-31', '2027-01-31T00:00:00', '', 5, True, ['2027-01-31']):
            with self.subTest(value=value), self.assertRaises(ApiError) as caught:
                parse_iso_date(value, 'validity_date')
            error = caught.exception
            self.assertEqual((error.status, error.code, error.field), (422, 'invalid', 'validity_date'))
            self.assertEqual(error.message, 'validity_date must be YYYY-MM-DD or null')
