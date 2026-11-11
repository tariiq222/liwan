# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.controllers.common import ApiError, parse_number

REJECTED = {
    'nan': float('nan'),
    'infinity': float('inf'),
    'negative infinity': float('-inf'),
    'true': True,
    'false': False,
    'numeric string': '5',
    'null': None,
    'list': [1],
    'negative': -0.5,
    'above the maximum': 10.5,
    'integer too large for a float': 10 ** 400,
}


@tagged('post_install', '-at_install', 'liwan')
class TestParseNumber(TransactionCase):

    def test_accepts_a_finite_number_inside_the_range_as_float(self):
        for value in (0, 3, 7.5, 10):
            with self.subTest(value=value):
                result = parse_number(value, 'days', maximum=10)
                self.assertEqual(result, value)
                self.assertIsInstance(result, float)

    def test_rejects_every_other_kind_naming_the_field(self):
        for label, value in REJECTED.items():
            with self.subTest(kind=label), self.assertRaises(ApiError) as caught:
                parse_number(value, 'days', maximum=10)
            self.assertEqual((caught.exception.status, caught.exception.code, caught.exception.field), (422, 'invalid', 'days'))

    def test_positive_refuses_zero(self):
        with self.assertRaises(ApiError) as caught:
            parse_number(0, 'days', maximum=10, positive=True)
        self.assertEqual(caught.exception.field, 'days')
