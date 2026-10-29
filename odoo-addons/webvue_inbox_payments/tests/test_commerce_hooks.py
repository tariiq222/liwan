# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import CATALOG_ID, WebVueCatalogCase


@tagged('post_install', '-at_install', 'webvue')
class TestCommerceHooks(WebVueCatalogCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.catalog = cls.make_catalog()
        cls.ok = cls.synced(cls.make_item(cls.catalog))
        cls.pending = cls.make_item(cls.catalog, cls.product2)
        cls.conversation = cls.make_conversation()

    def setUp(self):
        super().setUp()
        self.login_user(self.agent)

    def picker(self, query='', conversation=None):
        return self.get(f'/api/v1/inbox/conversations/{(conversation or self.conversation).id}/catalog-items{query}')

    def test_the_picker_lists_only_listed_synced_and_not_rejected_items(self):
        rejected = self.synced(self.make_item(self.catalog, self.image_product('Rejected', 5.0)))
        rejected.review_status = 'rejected'
        data = self.picker().json()
        self.assertEqual([item['product_retailer_id'] for item in data['items']], ['SHIRT-1'])
        self.assertEqual(set(data['items'][0]), {
            'id', 'product_retailer_id', 'name', 'price', 'currency', 'availability', 'image_url',
        })
        self.ok.listed = False
        self.assertEqual(self.picker().json()['total'], 0)

    def test_the_picker_needs_a_catalog_and_a_visible_conversation(self):
        self.catalog.unlink()
        self.assertError(self.picker(), 409, 'no_catalog')
        self.assertError(self.get('/api/v1/inbox/conversations/999999/catalog-items'), 404, 'not_found')

    def reply(self, content):
        return self.api('POST', f'/api/v1/inbox/conversations/{self.conversation.id}/messages', {'commerce': content})

    def test_a_reply_with_an_unknown_or_unsynced_product_is_refused(self):
        product = {'type': 'product', 'body': None, 'footer': None, 'product_retailer_id': 'nope'}
        response = self.reply(product)
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['field'], 'commerce')
        self.assertError(self.reply({**product, 'product_retailer_id': self.pending.retailer_id}), 422, 'invalid')

    def test_a_product_reply_is_queued_with_the_catalog_and_the_thread_shows_the_product(self):
        response = self.reply({'type': 'product', 'body': 'Look', 'footer': None, 'product_retailer_id': 'SHIRT-1'})
        self.assertEqual(response.status_code, 200, response.text)
        message = response.json()
        self.assertEqual(message['kind'], 'product')
        self.assertIsNone(message['interactive'])
        commerce = message['commerce']
        self.assertEqual((commerce['type'], commerce['catalog_id']), ('sent', CATALOG_ID))
        self.assertEqual(commerce['products'][0]['product']['name'], 'Shirt')
        self.assertEqual(commerce['products'][0]['product']['catalog_item_id'], self.ok.id)
        stored = self.env['webvue.inbox.message'].browse(message['id'])
        self.assertEqual((stored.catalog_id, stored.option_ids.title), (CATALOG_ID, 'Shirt'))

    def test_a_closed_window_refuses_products(self):
        late = self.make_conversation(minutes_ago=25 * 60)
        response = self.api('POST', f'/api/v1/inbox/conversations/{late.id}/messages', {
            'commerce': {'type': 'catalog_message', 'body': 'All', 'footer': None, 'thumbnail_product_retailer_id': None},
        })
        self.assertError(response, 422, 'invalid')

    def test_the_channel_catalog_is_the_one_of_its_account(self):
        self.assertEqual(self.channel._webvue_catalog_id(), CATALOG_ID)
        other = self.make_channel(phone_id='100000000002', business_account_id='200000000002')
        self.assertFalse(other._webvue_catalog_id())

    def test_channel_commerce_is_readable_by_a_reply_agent_from_the_mirror(self):
        data = self.get(f'/api/v1/inbox/channels/{self.channel.id}/commerce').json()
        self.assertEqual((data['catalog']['id'], data['cart_enabled']), (self.catalog.id, None))
