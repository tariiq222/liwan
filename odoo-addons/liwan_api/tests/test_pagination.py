# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_api.controllers.common import (
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
    ApiError,
    parse_page,
)
from odoo.addons.liwan_api.tests.common import LiwanApiCase


@tagged('post_install', '-at_install', 'liwan')
class TestPaginationContract(LiwanApiCase):

    def test_missing_values_use_the_standard_page(self):
        self.assertEqual(parse_page({}), (DEFAULT_PAGE_LIMIT, 0))

    def test_explicit_zero_limit_keeps_the_default(self):
        self.assertEqual(parse_page({'limit': '0', 'offset': '10'}), (DEFAULT_PAGE_LIMIT, 10))

    def test_limit_is_capped_and_offset_is_preserved(self):
        self.assertEqual(parse_page({'limit': '500', 'offset': '3'}), (MAX_PAGE_LIMIT, 3))

    def test_route_may_lower_the_cap_but_not_silently_raise_it(self):
        self.assertEqual(parse_page({'limit': '80'}, default=20, maximum=50), (50, 0))

    def test_invalid_page_is_a_field_error(self):
        with self.assertRaises(ApiError) as caught:
            parse_page({'limit': '-1'})
        self.assertEqual(caught.exception.status, 422)
        self.assertEqual(caught.exception.code, 'invalid')
        self.assertEqual(caught.exception.field, 'limit')
