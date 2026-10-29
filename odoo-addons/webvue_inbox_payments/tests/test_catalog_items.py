# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import WebVueCatalogCase, upload


@tagged('post_install', '-at_install', 'webvue')
class TestCatalogItems(WebVueCatalogCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.catalog = cls.make_catalog()
        cls.items = f'/api/v1/inbox/catalogs/{cls.catalog.id}/items'

    def setUp(self):
        super().setUp()
        self.login_user(self.manager)

    def new_product(self, **overrides):
        return {'name': 'Mug', 'description': 'A mug', 'list_price': 25.5, 'image': upload(), **overrides}

    def test_an_existing_product_is_listed_with_its_reference_as_retailer_id(self):
        response = self.api('POST', self.items, {'product_id': self.product.id})
        self.assertEqual(response.status_code, 201, response.text)
        data = response.json()
        self.assertEqual((data['product_retailer_id'], data['sync_state'], data['listed']), ('SHIRT-1', 'pending', True))
        self.assertEqual((data['list_price'], data['image']['width']), (100.0, 600))
        self.assertTrue(data['image']['url'].startswith('https://tenant.example.test/api/v1/public/inbox/catalog/images/'))
        second = self.api('POST', self.items, {'product_id': self.product2.id}).json()
        self.assertEqual(second['product_retailer_id'], f'wv-{self.product2.id}')

    def test_a_product_without_an_image_or_listed_twice_is_refused(self):
        bare = self.env['product.product'].create({'name': 'Bare', 'type': 'consu'})
        response = self.api('POST', self.items, {'product_id': bare.id})
        self.assertError(response, 422, 'invalid')
        self.api('POST', self.items, {'product_id': self.product.id})
        self.assertError(self.api('POST', self.items, {'product_id': self.product.id}), 422, 'invalid')

    def test_a_new_product_is_made_for_the_catalog(self):
        response = self.api('POST', self.items, {'product': self.new_product(), 'availability': 'out_of_stock'})
        self.assertEqual(response.status_code, 201, response.text)
        data = response.json()
        product = self.env['product.product'].browse(data['product']['id'])
        self.assertTrue(product.product_tmpl_id.webvue_inbox_catalog)
        self.assertEqual((data['name'], data['list_price'], data['availability']), ('Mug', 25.5, 'out_of_stock'))

    def test_new_product_images_are_checked(self):
        for image in (upload((499, 800)), upload(mimetype='image/gif'), {**upload(), 'data': '!!!'}, {**upload(fmt='JPEG'), 'mimetype': 'image/png'}):
            with self.subTest(image=image['mimetype']):
                response = self.api('POST', self.items, {'product': self.new_product(image=image)})
                self.assertError(response, 422, 'invalid')
                self.assertEqual(response.json()['field'], 'product.image')
        self.assertEqual(self.api('POST', self.items, {'product': self.new_product(image=upload(fmt='JPEG'))}).status_code, 201)

    def test_body_rules(self):
        for payload in ({}, {'product_id': self.product.id, 'product': self.new_product()}, {'product_id': self.product.id, 'x': 1},
                        {'product_id': self.product.id, 'product_retailer_id': 'bad id'}, {'product_id': self.product.id, 'availability': 'x'}):
            with self.subTest(payload=payload):
                self.assertError(self.api('POST', self.items, payload), 422, 'invalid')

    def test_the_retailer_id_is_fixed_once_synced(self):
        item = self.make_item(self.catalog)
        path = f'/api/v1/inbox/catalog-items/{item.id}'
        self.assertEqual(self.api('PATCH', path, {'product_retailer_id': 'OTHER-1'}).json()['product_retailer_id'], 'OTHER-1')
        self.synced(item)
        self.assertError(self.api('PATCH', path, {'product_retailer_id': 'OTHER-2'}), 422, 'invalid')
        self.assertEqual(self.api('PATCH', path, {'product_retailer_id': 'OTHER-1', 'availability': 'out_of_stock'}).status_code, 200)

    def test_only_a_catalog_made_product_is_edited(self):
        item = self.synced(self.make_item(self.catalog))
        path = f'/api/v1/inbox/catalog-items/{item.id}'
        self.assertError(self.api('PATCH', path, {'product': {'name': 'Renamed'}}), 422, 'invalid')
        made = self.api('POST', self.items, {'product': self.new_product()}).json()
        self.synced(self.env['webvue.inbox.catalog.item'].browse(made['id']))
        response = self.api('PATCH', f"/api/v1/inbox/catalog-items/{made['id']}", {'product': {'name': 'Big mug', 'list_price': 30}})
        self.assertEqual((response.json()['name'], response.json()['sync_state']), ('Big mug', 'pending'))

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

    def test_a_new_product_belongs_to_the_catalog_company_and_other_companies_do_not_see_it(self):
        made = self.api('POST', self.items, {'product': self.new_product()}).json()
        product = self.env['product.product'].browse(made['product']['id'])
        self.assertEqual(product.company_id, self.catalog.company_id)
        other = self.env['res.company'].create({'name': 'Other'})
        self.manager.company_ids = [Command.link(other.id)]
        elsewhere = self.env['product.product'].with_user(self.manager).with_context(allowed_company_ids=[other.id])
        self.assertFalse(elsewhere.search([('id', '=', product.id)]))

    def test_the_products_route_lists_saleable_products_of_the_company(self):
        self.make_item(self.catalog)
        other = self.env['res.company'].create({'name': 'Other'})
        foreign = self.env['product.product'].create({'name': 'Foreign hat', 'type': 'consu', 'company_id': other.id})
        self.env['product.product'].create({'name': 'Bare hat', 'type': 'consu'})
        unsaleable = self.env['product.product'].create({'name': 'Internal hat', 'type': 'consu', 'sale_ok': False})
        data = self.get(f'/api/v1/inbox/catalogs/{self.catalog.id}/products?q=hat').json()
        by_name = {row['name']: row for row in data['items']}
        self.assertIn('Hat', by_name)
        self.assertEqual((by_name['Bare hat']['has_image'], by_name['Bare hat']['listed']), (False, False))
        self.assertNotIn(foreign.name, by_name)
        self.assertNotIn(unsaleable.name, by_name)
        listed = {row['name']: row for row in self.get(f'/api/v1/inbox/catalogs/{self.catalog.id}/products?q=shirt').json()['items']}
        self.assertEqual((listed['Shirt']['listed'], listed['Shirt']['has_image'], listed['Shirt']['list_price']), (True, True, 100.0))
        self.assertEqual(set(listed['Shirt']), {'id', 'name', 'list_price', 'currency', 'has_image', 'listed'})
        self.login_user(self.agent)
        self.assertError(self.get(f'/api/v1/inbox/catalogs/{self.catalog.id}/products'), 403, 'forbidden')

    def test_a_catalog_manager_changes_only_catalog_products_through_the_orm(self):
        made = self.api('POST', self.items, {'product': self.new_product()}).json()
        catalog_product = self.env['product.product'].browse(made['product']['id'])
        catalog_product.with_user(self.manager).write({'description_sale': 'ok'})
        with self.assertRaises(AccessError):
            self.product.with_user(self.manager).write({'name': 'Hacked'})
        with self.assertRaises(AccessError):
            self.product.product_tmpl_id.with_user(self.manager).write({'list_price': 1})
        self.assertEqual(self.product.with_user(self.manager).name, 'Shirt')  # reading stays open

    def test_the_catalog_feature_is_enforced_on_the_routes(self):
        with self.without_catalog():
            self.assertError(self.api('POST', self.items, {'product_id': self.product.id}), 403, 'feature_not_included')
