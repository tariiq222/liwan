# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one product check every consumer line shares: pick right, existence, company fence, variants."""
from odoo import Command
from odoo.tests import tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_products.tests.common import ProductsCase

FIELD = 'lines[0].product_id'


@tagged('post_install', '-at_install', 'liwan')
class TestProductsUsableProduct(ProductsCase):

    def setUp(self):
        super().setUp()
        staff = self.env['liwan.products.service'].with_user(self.root_staff).with_company(self.root_company)
        self.product = staff._liwan_create({'name': 'Usable', 'type': 'service', 'list_price': 10})
        self.service = staff

    def assertRefusedOn(self, status, code, field, *args, **kwargs):
        with self.assertRaises(LiwanAccessRule) as caught:
            self.service._liwan_usable_product(*args, **kwargs)
        self.assertEqual((caught.exception.status, caught.exception.code), (status, code))
        self.assertEqual(caught.exception.field, field)

    def test_a_pick_holder_gets_the_product_of_its_company(self):
        self.assertEqual(self.service._liwan_usable_product(self.product.id, self.root_company, FIELD), self.product)

    def test_a_caller_who_may_not_pick_is_refused(self):
        nobody = self.env['liwan.products.service'].with_user(self.nobody).with_company(self.branch_a)
        with self.assertRaises(LiwanAccessRule) as caught:
            nobody._liwan_usable_product(self.product.id, self.branch_a, FIELD)
        self.assertEqual((caught.exception.status, caught.exception.code), (403, 'forbidden'))

    def test_a_missing_product_is_invalid_on_the_callers_field(self):
        self.assertRefusedOn(422, 'invalid', FIELD, 0, self.root_company, FIELD)

    def test_a_product_that_is_not_a_service_product_is_missing(self):
        plain = self.env['product.template'].create({'name': 'Plain', 'type': 'service'})
        self.assertRefusedOn(422, 'invalid', FIELD, plain.id, self.root_company, FIELD)

    def test_a_product_of_another_company_is_refused(self):
        self.settings.sharing = 'branch'
        branch = self.env['liwan.products.service'].with_user(self.a_staff).with_company(self.branch_a)
        own = branch._liwan_create({'name': 'Branch A only', 'type': 'service'})
        self.assertEqual(own.company_id, self.branch_a)
        self.assertRefusedOn(422, 'invalid', FIELD, own.id, self.branch_b, FIELD)
        self.assertEqual(branch._liwan_usable_product(own.id, self.branch_a, FIELD), own)

    def test_a_product_of_an_ancestor_company_is_usable(self):
        self.assertEqual(self.service._liwan_usable_product(self.product.id, self.branch_a, FIELD), self.product)

    def test_an_archived_product_needs_include_archived(self):
        self.service._liwan_archive(self.product)
        self.assertRefusedOn(422, 'invalid', FIELD, self.product.id, self.root_company, FIELD)
        archived = self.service._liwan_usable_product(
            self.product.id, self.root_company, FIELD, include_archived=True,
        )
        self.assertEqual(archived, self.product)

    def test_a_product_with_variants_is_refused(self):
        attribute = self.env['product.attribute'].create({
            'name': 'Size', 'create_variant': 'always',
            'value_ids': [Command.create({'name': 'S'}), Command.create({'name': 'L'})],
        })
        many = self.product.sudo()
        many.write({'attribute_line_ids': [Command.create({
            'attribute_id': attribute.id, 'value_ids': [Command.set(attribute.value_ids.ids)],
        })]})
        self.assertGreater(len(many.product_variant_ids), 1)
        self.assertRefusedOn(422, 'invalid', FIELD, self.product.id, self.root_company, FIELD)
