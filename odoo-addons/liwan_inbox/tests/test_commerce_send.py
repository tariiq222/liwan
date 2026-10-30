# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged

from .common import LiwanInboxCase
from .test_outbox import response
from odoo.addons.liwan_inbox.controllers import reply_parsing

CATALOG = '300000000001'
PRODUCT = {'type': 'product', 'body': 'Nice', 'footer': None, 'product_retailer_id': 'sku-1'}
LIST = {'type': 'product_list', 'header': 'Offers', 'body': 'Pick', 'footer': 'Today', 'sections': [
    {'title': 'Shirts', 'product_retailer_ids': ['sku-1', 'sku-2']}, {'title': 'Hats', 'product_retailer_ids': ['sku-3']},
]}
WHOLE = {'type': 'catalog_message', 'body': 'Our catalog', 'footer': None, 'thumbnail_product_retailer_id': 'sku-2'}


@tagged('post_install', '-at_install', 'liwan')
class TestCommerceSend(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation()

    def queue(self, content, catalog_id=CATALOG):
        values = reply_parsing.parse_commerce(content)
        return self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': values.pop('body'),
            'delivery_state': 'queued', 'next_attempt_at': fields.Datetime.now() - timedelta(seconds=1),
            'catalog_id': catalog_id, **values,
        })

    def sent(self, content):
        message = self.queue(content)
        type(self).sends = getattr(type(self), 'sends', 0) + 1
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': f'wamid.C{self.sends}'}]}))
        with patch.object(requests, 'request', mocked):
            self.env['liwan.inbox.message']._liwan_run_outbox()
        self.assertEqual(message.delivery_state, 'sent', message.error)
        return mocked.call_args.kwargs['json']['interactive']

    def test_a_product_payload(self):
        self.assertEqual(self.sent(PRODUCT), {
            'type': 'product', 'body': {'text': 'Nice'},
            'action': {'catalog_id': CATALOG, 'product_retailer_id': 'sku-1'},
        })

    def test_a_product_without_text_sends_no_body(self):
        interactive = self.sent({**PRODUCT, 'body': None})
        self.assertNotIn('body', interactive)

    def test_a_product_list_payload(self):
        self.assertEqual(self.sent(LIST), {
            'type': 'product_list', 'header': {'type': 'text', 'text': 'Offers'}, 'body': {'text': 'Pick'},
            'footer': {'text': 'Today'},
            'action': {'catalog_id': CATALOG, 'sections': [
                {'title': 'Shirts', 'product_items': [{'product_retailer_id': 'sku-1'}, {'product_retailer_id': 'sku-2'}]},
                {'title': 'Hats', 'product_items': [{'product_retailer_id': 'sku-3'}]},
            ]},
        })

    def test_a_catalog_message_payload(self):
        self.assertEqual(self.sent(WHOLE), {
            'type': 'catalog_message', 'body': {'text': 'Our catalog'},
            'action': {'name': 'catalog_message', 'parameters': {'thumbnail_product_retailer_id': 'sku-2'}},
        })
        self.assertEqual(self.sent({**WHOLE, 'thumbnail_product_retailer_id': None})['action'], {'name': 'catalog_message'})

    def test_the_content_round_trips_the_contract_shape(self):
        for content in (PRODUCT, {**PRODUCT, 'body': None}, LIST, WHOLE, {**WHOLE, 'thumbnail_product_retailer_id': None}):
            with self.subTest(content=content):
                self.assertEqual(self.queue(content)._liwan_commerce(), content)

    def test_a_message_without_a_catalog_fails_without_calling_meta(self):
        message = self.queue(PRODUCT, catalog_id=False)
        self.run_outbox_offline()
        self.assertEqual((message.delivery_state, message.attempts), ('failed', 1))


@tagged('post_install', '-at_install', 'liwan')
class TestCommerceReplyApi(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation()
        cls.late = cls.make_conversation(minutes_ago=25 * 60)

    def setUp(self):
        super().setUp()
        self.login(self.agent)

    def reply(self, content, conversation=None):
        return self.api('POST', f'/api/v1/inbox/conversations/{(conversation or self.conversation).id}/messages', {'commerce': content})

    def test_a_channel_without_a_catalog_refuses_with_a_422_on_commerce(self):
        response_ = self.reply(PRODUCT)
        self.assertError(response_, 422, 'invalid')
        self.assertEqual(response_.json().get('field'), 'commerce')

    def test_the_content_is_validated(self):
        bad = (
            {**PRODUCT, 'product_retailer_id': 'bad id!'}, {**PRODUCT, 'extra': 1}, {'type': 'nope'},
            {**LIST, 'sections': []}, {**LIST, 'header': 'h' * 61},
            {**LIST, 'sections': [{'title': 'a' * 25, 'product_retailer_ids': ['x']}]},
            {**LIST, 'sections': [{'title': 'a', 'product_retailer_ids': ['x']}, {'title': 'b', 'product_retailer_ids': ['x']}]},
            {**LIST, 'sections': [{'title': 'a', 'product_retailer_ids': [f'p{i}' for i in range(31)]}]},
        )
        for content in bad:
            with self.subTest(content=content):
                self.assertError(self.reply(content), 422, 'invalid')

    def test_a_reply_carries_one_content_member(self):
        self.assertError(self.api(
            'POST', f'/api/v1/inbox/conversations/{self.conversation.id}/messages', {'commerce': PRODUCT, 'body': 'x'},
        ), 422, 'invalid')


@tagged('post_install', '-at_install', 'liwan')
class TestCommerceAutomation(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.conversation = cls.make_conversation()

    def test_a_rule_reply_with_products_is_skipped_with_a_note_on_a_channel_without_a_catalog(self):
        rule = self.env['liwan.inbox.rule'].create({'name': 'Catalog', 'match_kind': 'any', 'stop': True})
        rule._liwan_set_reply(reply_parsing.parse_commerce(PRODUCT))
        message = self.conversation.message_ids[:1]
        self.env['liwan.inbox.automation']._liwan_send(self.conversation, message, rule.reply_ids, 'note')
        self.assertFalse(self.conversation.message_ids.filtered(lambda m: m.direction == 'out'))
        self.assertTrue(self.conversation.message_ids.filtered(lambda m: m.direction == 'note' and 'المنتجات' in m.body))

    def test_the_rule_reply_dumps_its_commerce_content(self):
        rule = self.env['liwan.inbox.rule'].create({'name': 'Catalog2', 'match_kind': 'order'})
        rule._liwan_set_reply(reply_parsing.parse_commerce(LIST))
        self.assertEqual(rule.reply_ids._liwan_dump_content(), {'commerce': LIST})
