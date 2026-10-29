# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import CATALOG_ID, FakeMeta, WebVueCatalogCase, meta_response

CREATE = {
    'channel_id': None, 'meta_catalog_id': CATALOG_ID, 'connect': True, 'brand': 'Acme', 'default_link': None,
    'prices_include_tax': True,
}


@tagged('post_install', '-at_install', 'webvue')
class TestCatalogApi(WebVueCatalogCase):

    def create(self, meta, **overrides):
        with meta.patch():
            return self.api('POST', '/api/v1/inbox/catalogs', {**CREATE, 'channel_id': self.channel.id, **overrides})

    def test_connect_checks_the_vertical_and_connects_the_account(self):
        self.login_user(self.manager)
        meta = FakeMeta()
        response = self.create(meta)
        self.assertEqual(response.status_code, 201, response.text)
        data = response.json()
        self.assertEqual((data['meta_catalog_id'], data['name'], data['brand'], data['state']), (CATALOG_ID, 'Shop', 'Acme', 'connected'))
        self.assertEqual(meta.bodies('200000000001/product_catalogs')[-1], {'catalog_id': CATALOG_ID})
        self.assertEqual(data['counts'], {'items': 0, 'synced': 0, 'pending': 0, 'error': 0, 'rejected': 0})
        self.assertEqual([c['id'] for c in data['channels']], [self.channel.id])

    def test_a_catalog_that_is_not_commerce_is_refused(self):
        self.login_user(self.manager)
        response = self.create(FakeMeta({f'GET {CATALOG_ID}': {'id': CATALOG_ID, 'name': 'x', 'vertical': 'hotels'}}))
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['field'], 'meta_catalog_id')

    def test_connect_false_needs_an_already_connected_catalog(self):
        self.login_user(self.manager)
        meta = FakeMeta({'GET 200000000001/product_catalogs': {'data': []}})
        self.assertError(self.create(meta, connect=False), 422, 'invalid')
        self.assertEqual(self.create(FakeMeta(), connect=False).status_code, 201)

    def test_a_second_catalog_for_the_account_conflicts(self):
        self.login_user(self.manager)
        self.assertEqual(self.create(FakeMeta()).status_code, 201)
        self.assertError(self.create(FakeMeta()), 409, 'conflict')

    def test_a_permission_error_is_explained(self):
        self.login_user(self.manager)
        denied = meta_response(403, {'error': {'message': '(#200) permission', 'code': 200}})
        response = self.create(FakeMeta({f'GET {CATALOG_ID}': denied}))
        self.assertError(response, 422, 'provider_permission')
        self.assertIn('catalog_management', response.json()['message'])

    def test_validation(self):
        self.login_user(self.manager)
        for overrides in ({'meta_catalog_id': 'abc'}, {'brand': ''}, {'default_link': 'http://x.test'}, {'connect': 'yes'}, {'extra': 1}):
            with self.subTest(overrides=overrides):
                self.assertError(self.create(FakeMeta(), **overrides), 422, 'invalid')

    def test_the_catalog_manager_capability_works_alone_and_a_reply_only_agent_is_refused(self):
        self.login_user(self.catalog_only)
        self.assertEqual(self.create(FakeMeta()).status_code, 201)
        self.assertEqual(self.get('/api/v1/inbox/catalogs').json()['total'], 1)
        self.login_user(self.agent)
        self.assertError(self.get('/api/v1/inbox/catalogs'), 403, 'forbidden')
        self.assertError(self.create(FakeMeta()), 403, 'forbidden')

    def test_patch_resyncs_the_items_and_delete_keeps_orders(self):
        catalog = self.make_catalog()
        item = self.synced(self.make_item(catalog))
        self.login_user(self.manager)
        response = self.api('PATCH', f'/api/v1/inbox/catalogs/{catalog.id}', {'brand': 'New'})
        self.assertEqual(response.json()['brand'], 'New')
        self.assertEqual(item.sync_state, 'pending')
        self.assertError(self.api('PATCH', f'/api/v1/inbox/catalogs/{catalog.id}', {}), 422, 'invalid')
        self.assertEqual(self.api('POST', f'/api/v1/inbox/catalogs/{catalog.id}/sync').status_code, 202)
        self.assertEqual(self.api('DELETE', f'/api/v1/inbox/catalogs/{catalog.id}').status_code, 204)
        self.assertFalse(catalog.exists())

    def test_another_company_is_a_404(self):
        other = self.env['res.company'].create({'name': 'Other'})
        self.make_channel(phone_id='100000000007', business_account_id='200000000007', owner_company_id=other.id)
        catalog = self.make_catalog(business_account_id='200000000007', company_id=other.id)
        self.login_user(self.manager)
        self.assertError(self.get(f'/api/v1/inbox/catalogs/{catalog.id}'), 404, 'not_found')

    def test_channel_commerce_reads_and_switches_at_meta_first(self):
        catalog = self.make_catalog()
        self.login_user(self.manager)
        meta = FakeMeta()
        with meta.patch():
            data = self.get(f'/api/v1/inbox/channels/{self.channel.id}/commerce').json()
        self.assertEqual((data['catalog']['id'], data['cart_enabled'], data['catalog_visible']), (catalog.id, True, False))
        with meta.patch():
            data = self.api('PATCH', f'/api/v1/inbox/channels/{self.channel.id}/commerce', {'catalog_visible': True}).json()
        self.assertEqual((data['cart_enabled'], data['catalog_visible']), (True, True))
        failing = FakeMeta({'POST 100000000001/whatsapp_commerce_settings': meta_response(500, {})})
        with failing.patch():
            response = self.api('PATCH', f'/api/v1/inbox/channels/{self.channel.id}/commerce', {'cart_enabled': False})
        self.assertError(response, 422, 'invalid')
        self.assertTrue(self.reload(self.channel).commerce_cart_enabled)

    def test_channel_commerce_without_a_catalog_is_empty_and_not_writable(self):
        self.login_user(self.manager)
        data = self.get(f'/api/v1/inbox/channels/{self.channel.id}/commerce').json()
        self.assertEqual(data, {'channel_id': self.channel.id, 'catalog': None, 'cart_enabled': None, 'catalog_visible': None})
        self.assertError(self.api('PATCH', f'/api/v1/inbox/channels/{self.channel.id}/commerce', {'cart_enabled': True}), 409, 'no_catalog')
