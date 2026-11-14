# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanCatalogCase


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogItems(LiwanCatalogCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.catalog = cls.make_catalog()
        cls.items = f'/api/v1/inbox/catalogs/{cls.catalog.id}/items'

    def setUp(self):
        super().setUp()
        self.login_user(self.manager)

    def test_a_service_product_is_listed_with_its_reference_as_retailer_id(self):
        response = self.api('POST', self.items, {'product_id': self.product.product_tmpl_id.id, 'availability': 'out_of_stock'})
        self.assertEqual(response.status_code, 201, response.text)
        data = response.json()
        self.assertEqual((data['product_retailer_id'], data['sync_state'], data['listed']), ('SHIRT-1', 'pending', True))
        self.assertEqual((data['list_price'], data['price'], data['availability']), (100.0, 100.0, 'out_of_stock'))
        self.assertEqual(data['image']['width'], 600)
        self.assertEqual(data['product']['id'], self.product.product_tmpl_id.id)
        self.assertTrue(data['image']['url'].startswith('https://tenant.example.test/api/v1/public/inbox/catalog/images/'))
        second = self.api('POST', self.items, {'product_id': self.product2.product_tmpl_id.id}).json()
        self.assertEqual(second['product_retailer_id'], f'wv-{self.product2.id}')

    def test_a_product_without_an_image_or_listed_twice_is_refused(self):
        bare = self.image_product('Bare', 10.0, image_1920=False)
        self.assertError(self.api('POST', self.items, {'product_id': bare.product_tmpl_id.id}), 422, 'invalid')
        self.api('POST', self.items, {'product_id': self.product.product_tmpl_id.id})
        self.assertError(self.api('POST', self.items, {'product_id': self.product.product_tmpl_id.id}), 422, 'invalid')

    def test_the_catalog_no_longer_creates_or_edits_products(self):
        for payload in ({'product': {'name': 'Mug'}}, {'product': {'name': 'Mug'}, 'product_id': self.product.product_tmpl_id.id}):
            with self.subTest(payload=payload):
                self.assertError(self.api('POST', self.items, payload), 422, 'invalid')
        item = self.make_item(self.catalog)
        self.assertError(self.api('PATCH', f'/api/v1/inbox/catalog-items/{item.id}', {'product': {'name': 'Renamed'}}), 422, 'invalid')
        self.assertEqual(self.get(f'/api/v1/inbox/catalogs/{self.catalog.id}/products').status_code, 404)

    def test_body_rules(self):
        product_id = self.product.product_tmpl_id.id
        for payload in ({}, {'product_id': product_id, 'x': 1}, {'product_id': 'a'}, {'product_retailer_id': 'RET-1'},
                        {'product_id': product_id, 'product_retailer_id': 'bad id'}, {'product_id': product_id, 'availability': 'x'}):
            with self.subTest(payload=payload):
                self.assertError(self.api('POST', self.items, payload), 422, 'invalid')

    def test_the_retailer_id_is_fixed_once_synced(self):
        item = self.make_item(self.catalog)
        path = f'/api/v1/inbox/catalog-items/{item.id}'
        self.assertEqual(self.api('PATCH', path, {'product_retailer_id': 'OTHER-1'}).json()['product_retailer_id'], 'OTHER-1')
        self.synced(item)
        self.assertError(self.api('PATCH', path, {'product_retailer_id': 'OTHER-2'}), 422, 'invalid')
        self.assertEqual(self.api('PATCH', path, {'product_retailer_id': 'OTHER-1', 'availability': 'out_of_stock'}).status_code, 200)

    def test_unlisting_and_deleting_remove_the_item_at_meta(self):
        item = self.synced(self.make_item(self.catalog))
        path = f'/api/v1/inbox/catalog-items/{item.id}'
        self.assertEqual(self.api('PATCH', path, {'listed': False}).json()['sync_state'], 'removing')
        self.assertEqual(self.api('DELETE', path).status_code, 204)
        self.assertEqual((item.active, item.sync_state), (False, 'removing'))
        never = self.make_item(self.catalog, self.product2)
        self.assertEqual(self.api('DELETE', f'/api/v1/inbox/catalog-items/{never.id}').status_code, 204)
        self.assertFalse(never.exists())

    def test_the_list_filters(self):
        self.synced(self.make_item(self.catalog))
        self.make_item(self.catalog, self.product2)
        self.assertEqual(self.get(f'{self.items}?sync_state=synced').json()['total'], 1)
        self.assertEqual(self.get(f'{self.items}?q=hat').json()['total'], 1)
        self.assertEqual(self.get(f'{self.items}?listed=false').json()['total'], 0)
        self.assertError(self.get(f'{self.items}?sync_state=bogus'), 422, 'invalid')

    def test_a_reply_only_agent_cannot_manage_items(self):
        self.login_user(self.agent)
        self.assertError(self.api('POST', self.items, {'product_id': self.product.id}), 403, 'forbidden')

    def test_the_retailer_id_is_fixed_once_anything_was_pushed(self):
        for index, values in enumerate(({'pushed_hash': 'h'}, {'synced_hash': 'h'}, {'sync_state': 'syncing'})):
            with self.subTest(values=values):
                item = self.make_item(self.catalog, self.image_product(f'Pushed {index}', 1.0))
                item.write(values)
                path = f'/api/v1/inbox/catalog-items/{item.id}'
                self.assertError(self.api('PATCH', path, {'product_retailer_id': 'CHANGED-1'}), 422, 'invalid')
