# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The quantity bound that the product price and every line of a document share."""
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_products.models.products_service import (
    MAX_QUANTITY,
    is_number,
    valid_quantity,
)


@tagged('post_install', '-at_install', 'liwan')
class TestProductsQuantity(TransactionCase):

    def test_a_quantity_is_a_number_above_zero_and_at_most_the_maximum(self):
        for value in (1, 0.001, 2.5, MAX_QUANTITY, float(MAX_QUANTITY)):
            with self.subTest(value=value):
                self.assertTrue(valid_quantity(value))

    def test_everything_else_is_not_a_quantity(self):
        for value in (0, -1, MAX_QUANTITY + 1, True, False, None, '1', [1], float('nan'), float('inf')):
            with self.subTest(value=value):
                self.assertFalse(valid_quantity(value))

    def test_a_number_is_never_a_boolean(self):
        self.assertTrue(is_number(3) and is_number(0.5))
        self.assertFalse(is_number(True) or is_number('3') or is_number(None))
