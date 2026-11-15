# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.controllers.common import ApiError, parse_bool_arg


@tagged('post_install', '-at_install', 'liwan')
class TestParseBoolArg(TransactionCase):

    def test_an_absent_argument_gives_the_default(self):
        self.assertIs(parse_bool_arg({}, 'mine'), False)
        self.assertIs(parse_bool_arg({}, 'mine', default=True), True)

    def test_true_and_false_give_booleans(self):
        self.assertIs(parse_bool_arg({'mine': 'true'}, 'mine', default=False), True)
        self.assertIs(parse_bool_arg({'mine': 'false'}, 'mine', default=True), False)

    def test_anything_else_is_a_422_naming_the_field(self):
        for value in ('yes', 'True', '1', '', ' true'):
            with self.subTest(value=value), self.assertRaises(ApiError) as caught:
                parse_bool_arg({'mine': value}, 'mine')
            error = caught.exception
            self.assertEqual((error.status, error.code, error.field), (422, 'invalid', 'mine'))
