# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import time

from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import BUSINESS_ACCOUNT_ID, PHONE_ID, WebVueInboxCase
from odoo.addons.webvue_inbox.adapters import whatsapp
from odoo.addons.webvue_inbox.serializers.conversation import dump_messages

CATALOG = '300000000001'


def cart(items, catalog_id=CATALOG, text='Two please'):
    return {'catalog_id': catalog_id, 'text': text, 'product_items': items}


def line(retailer_id='sku-1', quantity=2, price=7.99, currency='SAR'):
    return {'product_retailer_id': retailer_id, 'quantity': quantity, 'item_price': price, 'currency': currency}


def parsed(payload):
    return whatsapp.parse_events(payload, PHONE_ID, BUSINESS_ACCOUNT_ID)


@tagged('post_install', '-at_install', 'webvue')
class TestCommerceParsing(WebVueInboxCase):

    def one(self, kind, block=None, **extra):
        events = parsed(wa.inbound_message(kind, block, **extra))
        self.assertEqual(len(events), 1)
        return events[0]

    def test_a_cart_is_typed_with_decimal_and_integer_prices(self):
        event = self.one('order', cart([line(price=7.99), line('sku-2', 1, 10, 'USD')]))
        self.assertEqual((event.kind, event.body, event.order.catalog_id), ('order', 'Two please', CATALOG))
        self.assertEqual(event.order.items, (
            whatsapp.OrderItem('sku-1', 2, 7.99, 'SAR'), whatsapp.OrderItem('sku-2', 1, 10.0, 'USD'),
        ))

    def test_a_cart_without_text_has_the_placeholder_body(self):
        event = self.one('order', cart([line()], text=''))
        self.assertEqual((event.kind, event.body, event.order.text), ('order', '[order]', None))

    def test_a_malformed_cart_is_unsupported(self):
        bad = (
            cart([]), cart([line(quantity=0)]), cart([line(quantity='2')]), cart([line(price=-1)]),
            cart([line(currency='sar')]), cart([line(retailer_id='')]), cart([line()], catalog_id='abc'), cart([line()] + ['x']),
        )
        for block in bad:
            with self.subTest(block=block):
                event = self.one('order', block)
                self.assertEqual((event.kind, event.order, event.body), ('unsupported', None, '[unsupported]'))

    def test_a_product_inquiry_is_a_text_with_its_product(self):
        event = self.one('text', {'body': 'Is it in stock?'}, context={
            'from': '966', 'id': 'wamid.X', 'referred_product': {'catalog_id': CATALOG, 'product_retailer_id': 'sku-1'},
        })
        self.assertEqual((event.kind, event.referred_product), ('text', whatsapp.ReferredProduct(CATALOG, 'sku-1')))
        plain = self.one('text', {'body': 'hi'}, context={'referred_product': {'catalog_id': 'x', 'product_retailer_id': 'sku'}})
        self.assertIsNone(plain.referred_product)


@tagged('post_install', '-at_install', 'webvue')
class TestCommerceIngestion(WebVueInboxCase):

    def deliver(self, data):
        self.env['webvue.inbox.event'].create({
            'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id, 'payload': json.dumps(data),
        })
        self.env['webvue.inbox.event']._webvue_run_events()

    def message(self, provider_id):
        return self.env['webvue.inbox.message'].search([('provider_message_id', '=', provider_id)])

    def test_a_cart_is_stored_with_its_lines_once(self):
        data = wa.inbound_message('order', cart([line(), line('sku-2', 1, 3, 'SAR')]), provider_id='wamid.CART')
        self.deliver(data)
        self.deliver(data)
        message = self.message('wamid.CART')
        self.assertEqual((message.kind, message.catalog_id, message.body), ('order', CATALOG, 'Two please'))
        self.assertEqual(
            [(row.retailer_id, row.quantity, row.item_price, row.currency) for row in message.order_line_ids],
            [('sku-1', 2, 7.99, 'SAR'), ('sku-2', 1, 3.0, 'SAR')],
        )

    def test_an_inquiry_keeps_its_product(self):
        self.deliver(wa.inbound_message('text', {'body': 'Price?'}, provider_id='wamid.INQ', context={
            'referred_product': {'catalog_id': CATALOG, 'product_retailer_id': 'sku-9'},
        }))
        message = self.message('wamid.INQ')
        self.assertEqual((message.referred_catalog_id, message.referred_retailer_id), (CATALOG, 'sku-9'))

    def test_the_thread_shows_the_cart_lines(self):
        self.deliver(wa.inbound_message('order', cart([line()]), provider_id='wamid.CART2'))
        message = self.message('wamid.CART2')
        commerce = dump_messages(message)[0]['commerce']
        self.assertEqual(commerce['type'], 'order')
        self.assertEqual(commerce['lines'], [{
            'product_retailer_id': 'sku-1', 'product': None, 'quantity': 2, 'item_price': 7.99, 'currency': 'SAR',
        }])

    def test_a_cart_fires_the_order_rule_only(self):
        rule = self.env['webvue.inbox.rule'].create({
            'name': 'Carts', 'match_kind': 'order', 'resolve': True,
        })
        other = self.env['webvue.inbox.rule'].create({'name': 'Hello', 'match_kind': 'exact', 'resolve': True,
                                                      'keyword_ids': [(0, 0, {'value': 'hello'})]})
        self.deliver(wa.inbound_message('order', cart([line()]), provider_id='wamid.CART3', timestamp=str(int(time.time()))))
        conversation = self.message('wamid.CART3').conversation_id
        self.assertEqual(conversation.state, 'resolved')
        self.assertTrue(rule and other)
