# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The catalog on the shared products service: who creates a product, how an item is priced, which product an item lists."""
import base64

from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import LiwanCatalogCase, image_bytes
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_payments.tests.common import TAX_EXCLUDED, TAX_INCLUDED

PRODUCTS = '/api/v1/products'
MODES = ('saas', 'non_saas')
UNREGISTERED = 'unregistered'
# The three choices of an establishment: its price mode while registered for VAT, or no VAT registration at all.
CHOICES = (TAX_INCLUDED, TAX_EXCLUDED, UNREGISTERED)
# The same choices, with the amounts of one and of three units of a 115 product under a 15% tax.
EXPECTED = {
    TAX_INCLUDED: {1: (100.0, 15.0, 115.0), 3: (300.0, 45.0, 345.0)},
    TAX_EXCLUDED: {1: (115.0, 17.25, 132.25), 3: (345.0, 51.75, 396.75)},
    UNREGISTERED: {1: (115.0, 0.0, 115.0), 3: (345.0, 0.0, 345.0)},
}


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogProductRights(LiwanCatalogCase):
    """The catalog editor creates and edits no product: that is the products service's, and its capabilities."""

    def products_as(self, user):
        return self.env['liwan.products.service'].with_user(user)

    def test_a_catalog_manager_without_the_product_capabilities_cannot_create_or_write_a_product(self):
        product = self.products_as(self.manager)._liwan_create({'name': 'Shared service', 'type': 'service', 'list_price': 40})
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.login_user(self.catalog_only)
                self.assertError(self.api('POST', PRODUCTS, {'name': 'Mug', 'type': 'goods'}), 403, 'forbidden')
                for values in ({'name': 'Renamed'}, {'list_price': 1}):
                    self.assertError(self.api('PATCH', f'{PRODUCTS}/{product.id}', values), 403, 'forbidden')
                self.assertError(self.api('POST', f'{PRODUCTS}/{product.id}/archive'), 403, 'forbidden')
        orm = self.env(user=self.catalog_only)
        for model in ('product.template', 'product.product'):
            for values in ({'name': 'Plain'}, {'name': 'Marked', 'liwan_product': True}):
                with self.subTest(model=model, values=values), self.assertRaises(AccessError):
                    orm[model].create(values)
        with self.assertRaises(AccessError):
            product.with_user(self.catalog_only).write({'name': 'Direct'})
        with self.assertRaises(LiwanAccessRule):
            self.products_as(self.catalog_only)._liwan_create({'name': 'Mug', 'type': 'goods'})
        self.assertEqual(product.name, 'Shared service')

    def test_the_built_in_manager_creates_and_prices_a_product_through_the_service(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.login_user(self.manager)
                created = self.api('POST', PRODUCTS, {'name': f'Mug {mode}', 'type': 'goods', 'list_price': 25.5})
                self.assertEqual(created.status_code, 201, created.text)
                product = created.json()
                self.assertEqual((product['list_price'], product['company']), (25.5, None))
                priced = self.api('PATCH', f"{PRODUCTS}/{product['id']}", {'list_price': 30})
                self.assertEqual((priced.status_code, priced.json()['list_price']), (200, 30), priced.text)
        template = self.env['product.template'].browse(product['id'])
        with self.assertRaises(AccessError):
            template.with_user(self.manager).write({'name': 'Direct'})

    def test_a_catalog_manager_alone_picks_and_prices_the_products_of_the_service(self):
        product = self.products_as(self.manager)._liwan_create({'name': 'Pickable', 'type': 'service', 'list_price': 40})
        catalog = self.make_catalog()
        item = self.make_item(catalog, product.product_variant_id)
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.login_user(self.catalog_only)
                picked = self.api('GET', f'{PRODUCTS}/pick?q=Pickable')
                self.assertEqual(picked.status_code, 200, picked.text)
                self.assertEqual([row['id'] for row in picked.json()['items']], [product.id])
                shown = self.api('GET', f'/api/v1/inbox/catalog-items/{item.id}')
                self.assertEqual((shown.status_code, shown.json()['price']), (200, 40.0), shown.text)
                self.assertError(self.api('GET', PRODUCTS), 403, 'forbidden')

    def test_a_reader_of_the_conversations_sees_the_price_of_a_listed_item(self):
        item = self.make_item(self.make_catalog())
        item.invalidate_recordset(['price', 'unit_price', 'currency'])
        self.assertEqual(item.with_user(self.reader_only).price, 100.0)


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogItemFromAServiceProduct(LiwanCatalogCase):
    """An item is created from a service product the caller can pick, and from nothing else."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.catalog = cls.make_catalog()
        cls.items = f'/api/v1/inbox/catalogs/{cls.catalog.id}/items'

    def setUp(self):
        super().setUp()
        self.login_user(self.manager)

    def test_only_an_active_service_product_can_be_listed(self):
        plain = self.image_product('Plain stock product', 10.0, liwan_product=False)
        archived = self.image_product('Archived service', 10.0)
        archived.product_tmpl_id.active = False
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                for product in (plain, archived):
                    self.assertError(self.api('POST', self.items, {'product_id': product.product_tmpl_id.id}), 404, 'not_found')
                self.assertError(self.api('POST', self.items, {'product_id': 999999999}), 404, 'not_found')
        self.assertFalse(self.catalog.item_ids)
        self.assertEqual(self.api('POST', self.items, {'product_id': self.product.product_tmpl_id.id}).status_code, 201)

    def test_a_product_with_several_variants_is_refused(self):
        size = self.env['product.attribute'].create({
            'name': 'Size', 'value_ids': [Command.create({'name': 'S'}), Command.create({'name': 'M'})],
        })
        template = self.env['product.template'].create({
            'name': 'Tee', 'type': 'consu', 'list_price': 10, 'liwan_product': True,
            'image_1920': base64.b64encode(image_bytes()),
            'attribute_line_ids': [Command.create({'attribute_id': size.id, 'value_ids': [Command.set(size.value_ids.ids)]})],
        })
        self.assertEqual(template.product_variant_count, 2)
        self.assertError(self.api('POST', self.items, {'product_id': template.id}), 422, 'invalid')

    def test_a_product_of_a_company_the_session_cannot_see_is_not_found(self):
        branch = self.catalog_company('Catalog sibling')
        foreign = self.env['product.product'].create({
            'name': 'Sibling product', 'type': 'consu', 'company_id': branch.id, 'liwan_product': True,
            'image_1920': base64.b64encode(image_bytes()),
        })
        self.assertError(self.api('POST', self.items, {'product_id': foreign.product_tmpl_id.id}), 404, 'not_found')
