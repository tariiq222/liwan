# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged

from .common import BASE_URL, CATALOG_ID, WebVueCatalogCase
from odoo.addons.webvue_inbox.tests import whatsapp_payloads as wa
from odoo.addons.webvue_inbox.tests.test_outbox import response as provider_response
from odoo.addons.webvue_payments.models.order_service import NotPayable


def cart_line(retailer_id, quantity=1, price=1.0, currency='SAR'):
    return {'product_retailer_id': retailer_id, 'quantity': quantity, 'item_price': price, 'currency': currency}


class OrderCase(WebVueCatalogCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.catalog = cls.make_catalog()
        cls.item = cls.synced(cls.make_item(cls.catalog))
        cls.item2 = cls.synced(cls.make_item(cls.catalog, cls.product2))
        cls.conversation = cls.make_conversation()
        # The customer's accounting partner exists already: it carries the SAR price list the gateway needs.
        cls.conversation.contact_id.partner_id = cls.customer
        cls.counter_cart = 0

    def setUp(self):
        super().setUp()
        self.login_user(self.agent)

    def deliver_cart(self, items, catalog_id=CATALOG_ID, conversation=None):
        conversation = conversation or self.conversation
        type(self).counter_cart += 1
        data = wa.inbound_message(
            'order', {'catalog_id': catalog_id, 'text': 'please', 'product_items': items},
            provider_id=f'wamid.CART{self.counter_cart}', wa_id=conversation.identity_id.address,
        )
        self.env['webvue.inbox.event'].create({
            'channel_id': conversation.channel_id.id, 'owner_company_id': conversation.company_id.id, 'payload': json.dumps(data),
        })
        self.env['webvue.inbox.event']._webvue_run_events()
        return self.env['webvue.inbox.order'].search([('message_id.provider_message_id', '=', f'wamid.CART{self.counter_cart}')])

    def order_path(self, order, suffix=''):
        return f'/api/v1/inbox/orders/{order.id}{suffix}'

    def checkout(self, order, payload=None):
        return self.api('POST', self.order_path(order, '/checkout'), payload or {})

    def run_outbox(self):
        mocked = MagicMock(return_value=provider_response(200, {'messages': [{'id': 'wamid.OUT'}]}))
        with patch.object(requests, 'request', mocked):
            self.env['webvue.inbox.message']._webvue_run_outbox()
        return mocked


@tagged('post_install', '-at_install', 'webvue')
class TestOrderIngest(OrderCase):

    def test_a_cart_becomes_an_order_with_resolved_lines(self):
        order = self.deliver_cart([cart_line('SHIRT-1', 2, 99.0), cart_line('ghost', 1)])
        self.assertEqual((order.state, order.catalog_id, order.cart_total, order.cart_currency), ('cart', self.catalog, 199.0, 'SAR'))
        resolved, unknown = order.line_ids
        self.assertEqual((resolved.catalog_item_id, resolved.product_id, resolved.quantity), (self.item, self.product, 2))
        self.assertEqual((unknown.catalog_item_id.id, unknown.product_id.id), (False, False))

    def test_an_unlisted_or_rejected_item_is_flagged_not_matched(self):
        self.item2.review_status = 'rejected'
        self.item.listed = False
        order = self.deliver_cart([cart_line('SHIRT-1'), cart_line(self.item2.retailer_id)])
        self.assertEqual(order.line_ids.mapped('catalog_item_id').ids, [])
        self.item.listed = True
        self.item2.review_status = 'approved'
        path = f'/api/v1/inbox/conversations/{self.conversation.id}/orders'
        built = self.api('POST', path, {'lines': [{'catalog_item_id': self.item.id, 'quantity': 1}]})
        self.assertEqual(built.status_code, 201)
        self.item.listed = False
        self.assertError(self.api('POST', path, {'lines': [{'catalog_item_id': self.item.id, 'quantity': 1}]}), 422, 'invalid')
        self.assertError(self.checkout(self.env['webvue.inbox.order'].browse(built.json()['id'])), 422, 'invalid')

    def test_without_the_catalog_feature_a_cart_stays_a_message_with_no_order(self):
        data = wa.inbound_message('order', {
            'catalog_id': CATALOG_ID, 'text': 'x', 'product_items': [cart_line('SHIRT-1')],
        }, provider_id='wamid.NOFEATURE', wa_id=self.conversation.identity_id.address)
        self.env['webvue.inbox.event'].create({
            'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id, 'payload': json.dumps(data),
        })
        with self.without_catalog():
            self.env['webvue.inbox.event']._webvue_run_events()
        message = self.env['webvue.inbox.message'].search([('provider_message_id', '=', 'wamid.NOFEATURE')])
        self.assertEqual((message.kind, len(message.order_line_ids)), ('order', 1))
        self.assertFalse(self.env['webvue.inbox.order'].search([('message_id', '=', message.id)]))

    def test_a_cart_of_another_catalog_resolves_nothing(self):
        order = self.deliver_cart([cart_line('SHIRT-1')], catalog_id='399999999999')
        self.assertFalse(order.catalog_id)
        self.assertFalse(order.line_ids.catalog_item_id)

    def test_a_replayed_webhook_makes_one_order(self):
        order = self.deliver_cart([cart_line('SHIRT-1')])
        event = self.env['webvue.inbox.event'].search([], order='id desc', limit=1)
        self.env['webvue.inbox.event'].create({
            'channel_id': event.channel_id.id, 'owner_company_id': event.owner_company_id.id, 'payload': event.payload,
        })
        self.env['webvue.inbox.event']._webvue_run_events()
        self.assertEqual(self.env['webvue.inbox.order'].search_count([('message_id', '=', order.message_id.id)]), 1)

    def test_the_thread_and_the_order_api_show_the_cart(self):
        order = self.deliver_cart([cart_line('SHIRT-1', 2, 90.0)])
        data = self.get(self.order_path(order)).json()
        self.assertEqual((data['state'], data['cart_total'], data['total'], data['price_changed']), ('cart', 180.0, 200.0, True))
        line = data['lines'][0]
        self.assertEqual((line['unit_price'], line['cart_price'], line['name']), (100.0, 90.0, 'Shirt'))
        thread = self.get(f'/api/v1/inbox/conversations/{self.conversation.id}/messages').json()
        cart = next(message for message in thread['items'] if message['kind'] == 'order')
        self.assertEqual(cart['commerce']['order'], {'id': order.id, 'state': 'cart', 'reference': None, 'payment_status': None})
        self.assertEqual(cart['commerce']['lines'][0]['product']['name'], 'Shirt')

    def test_edit_a_cart_replaces_its_lines(self):
        order = self.deliver_cart([cart_line('SHIRT-1', 1), cart_line('ghost', 1)])
        keep = order.line_ids[0]
        response = self.api('PATCH', self.order_path(order), {'lines': [
            {'id': keep.id, 'quantity': 3}, {'catalog_item_id': self.item2.id, 'quantity': 2},
        ]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([(line['product_retailer_id'], line['quantity']) for line in response.json()['lines']], [('SHIRT-1', 3), (self.item2.retailer_id, 2)])
        self.assertError(self.api('PATCH', self.order_path(order), {'lines': [{'id': 99999, 'quantity': 1}]}), 422, 'invalid')

    def test_an_agent_builds_an_order(self):
        response = self.api('POST', f'/api/v1/inbox/conversations/{self.conversation.id}/orders', {
            'lines': [{'catalog_item_id': self.item.id, 'quantity': 2}],
        })
        self.assertEqual(response.status_code, 201, response.text)
        data = response.json()
        self.assertEqual((data['message_id'], data['cart_total'], data['total'], data['created_by']['id']), (None, None, 200.0, self.agent.id))
        self.assertIsNone(data['lines'][0]['cart_price'])
        self.assertError(self.api('POST', f'/api/v1/inbox/conversations/{self.conversation.id}/orders', {
            'lines': [{'catalog_item_id': 999999, 'quantity': 1}],
        }), 422, 'invalid')

    def test_dismissing_locks_the_cart(self):
        order = self.deliver_cart([cart_line('SHIRT-1')])
        self.assertEqual(self.api('POST', self.order_path(order, '/cancel')).json()['state'], 'dismissed')
        self.assertError(self.api('PATCH', self.order_path(order), {'lines': [{'id': order.line_ids.id, 'quantity': 2}]}), 409, 'order_locked')
        self.assertError(self.checkout(order), 409, 'order_locked')
        self.assertError(self.api('POST', self.order_path(order, '/cancel')), 409, 'order_locked')


@tagged('post_install', '-at_install', 'webvue')
class TestCheckout(OrderCase):

    def test_checkout_makes_the_online_order_at_odoo_prices_and_sends_the_pay_link(self):
        order = self.deliver_cart([cart_line('SHIRT-1', 2, 1.0)])
        response = self.checkout(order)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual((data['order']['state'], data['order']['total'], data['order']['payment']['status']), ('ordered', 200.0, 'payable'))
        self.assertTrue(data['order']['reference'].startswith('S'))
        sale_order = order._webvue_sale_orders().sudo()
        self.assertEqual((sale_order.amount_total, sale_order.order_line.product_uom_qty), (200.0, 2.0))
        message = self.env['webvue.inbox.message'].browse(data['message_id'])
        self.assertEqual((message.interactive_type, message.cta_display_text), ('cta_url', 'ادفع الآن'))
        self.assertTrue(message.cta_url.startswith(f'{BASE_URL}/pay/order/{sale_order.id}?access_token='))
        sent = self.run_outbox().call_args.kwargs['json']['interactive']
        self.assertEqual((sent['type'], sent['action']['parameters']['url']), ('cta_url', message.cta_url))

    def test_the_partner_is_made_once_and_reused(self):
        contact = self.conversation.contact_id
        contact.partner_id = False
        partner = contact._webvue_partner()
        self.assertEqual((partner.name, partner.phone), (contact.name, contact.phone))
        self.assertEqual(contact._webvue_partner(), partner)

    def test_a_second_checkout_sends_a_new_link_for_the_same_order(self):
        order = self.deliver_cart([cart_line('SHIRT-1')])
        first = self.checkout(order).json()
        second = self.checkout(order).json()
        self.assertEqual(second['order']['reference'], first['order']['reference'])
        self.assertNotEqual(second['message_id'], first['message_id'])
        self.assertEqual(self.env['sale.order'].sudo().search_count([('name', '=', first['order']['reference'])]), 1)

    def test_an_unknown_line_blocks_the_checkout_and_nothing_is_left_behind(self):
        order = self.deliver_cart([cart_line('SHIRT-1'), cart_line('ghost')])
        before = self.env['sale.order'].sudo().search_count([])
        response = self.checkout(order)
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['field'], 'lines')
        self.assertEqual((order.state, self.env['sale.order'].sudo().search_count([])), ('cart', before))

    def test_a_closed_window_needs_an_approved_template_with_the_pay_link_button(self):
        late = self.make_conversation(minutes_ago=25 * 60)
        late.contact_id.partner_id = self.customer
        order = self.deliver_cart([cart_line('SHIRT-1')], conversation=late)
        late.message_ids.write({'date': fields.Datetime.now() - timedelta(hours=26)})
        self.assertError(self.checkout(order), 409, 'window_closed')
        wrong = self.make_template(button_ids=[{'kind': 'url', 'text': 'Pay', 'url': 'https://other.test/pay/{{1}}', 'example': 'https://other.test/pay/1'}])
        response = self.checkout(order, {'template_id': wrong.id})
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['field'], 'template_id')
        template = self.make_template(button_ids=[{
            'kind': 'url', 'text': 'Pay', 'url': f'{BASE_URL}/pay/order/{{{{1}}}}', 'example': f'{BASE_URL}/pay/order/1',
        }])
        response = self.checkout(order, {'template_id': template.id})
        self.assertEqual(response.status_code, 200, response.text)
        message = self.env['webvue.inbox.message'].browse(response.json()['message_id'])
        self.assertEqual(message.template_id, template)
        self.assertTrue(message.template_button_ids.value.startswith(f"{order._webvue_sale_orders().id}?access_token="))

    def test_service_refusals_are_mapped(self):
        order = self.deliver_cart([cart_line('SHIRT-1')])
        service = type(self.env['webvue.payments.service'])
        with patch.object(service, '_webvue_payment_path', side_effect=NotPayable('x')):
            self.assertError(self.checkout(order), 409, 'not_payable')
        self.assertEqual(order.state, 'cart')  # the order made inside the failed request was undone
        self.paymob.sudo().state = 'disabled'
        self.assertError(self.checkout(order), 422, 'no_gateway')

    def test_checkout_needs_the_orders_capability(self):
        order = self.deliver_cart([cart_line('SHIRT-1')])
        self.login_user(self.reader_only)
        self.assertError(self.checkout(order), 403, 'forbidden')
        self.assertEqual(self.get(self.order_path(order)).status_code, 200)


@tagged('post_install', '-at_install', 'webvue')
class TestOrderStatus(OrderCase):

    def ordered(self):
        order = self.deliver_cart([cart_line('SHIRT-1')])
        self.checkout(order)
        self.run_outbox()
        return order

    def notes(self):
        return self.conversation.message_ids.filtered(lambda m: m.direction == 'note').mapped('body')

    def test_payment_notes_notifies_and_thanks_the_customer_inside_the_window(self):
        order = self.ordered()
        self.pay(order._webvue_sale_orders(), 200.0)
        self.assertIn(f'تم دفع الطلب {order.reference}', self.notes())
        notice = self.conversation.message_ids.filtered(lambda m: m.automated and m.direction == 'out')
        self.assertEqual(notice.body, f'تم استلام دفعتك لطلب {order.reference}. شكرًا لك')
        self.assertEqual(order._webvue_payment_status(), 'paid')
        self.assertEqual(self.get(self.order_path(order)).json()['payment']['status'], 'paid')

    def test_the_notice_can_be_switched_off_and_a_closed_window_gets_only_the_note(self):
        order = self.ordered()
        self.channel.paid_notice_enabled = False
        self.pay(order._webvue_sale_orders(), 200.0)
        self.assertFalse(self.conversation.message_ids.filtered(lambda m: m.automated and m.direction == 'out'))
        self.assertTrue(self.notes())
        self.channel.paid_notice_enabled = True
        closed = self.make_conversation(minutes_ago=25 * 60)
        closed.contact_id.partner_id = self.customer
        other = self.deliver_cart([cart_line('SHIRT-1')], conversation=closed)
        closed.message_ids.write({'date': fields.Datetime.now() - timedelta(hours=26)})
        template = self.make_template(button_ids=[{
            'kind': 'url', 'text': 'Pay', 'url': f'{BASE_URL}/pay/order/{{{{1}}}}', 'example': f'{BASE_URL}/pay/order/1',
        }])
        self.checkout(other, {'template_id': template.id})
        self.pay(other._webvue_sale_orders(), 200.0)
        self.assertFalse(closed.message_ids.filtered(lambda m: m.automated and m.direction == 'out'))
        self.assertTrue(closed.message_ids.filtered(lambda m: m.direction == 'note' and other.reference in m.body))

    def test_the_expiry_cancels_the_order_with_a_note(self):
        order = self.ordered()
        sale_order = order._webvue_sale_orders().sudo()
        sale_order.webvue_payment_deadline = fields.Datetime.now() - timedelta(minutes=1)
        self.expire()
        self.assertEqual(sale_order.state, 'cancel')
        self.assertIn(f'أُلغي الطلب {order.reference}: انتهت مهلة الدفع', self.notes())
        self.assertEqual(self.get(self.order_path(order)).json()['payment']['status'], 'cancelled')

    def test_an_agent_cancels_an_ordered_order(self):
        order = self.ordered()
        self.assertEqual(self.api('POST', self.order_path(order, '/cancel')).json()['payment']['status'], 'cancelled')
        self.assertIn(f'أُلغي الطلب {order.reference}', self.notes())

    def test_the_orders_list_filters_and_follows_visibility(self):
        paid = self.ordered()
        self.pay(paid._webvue_sale_orders(), 200.0)
        cart = self.deliver_cart([cart_line('SHIRT-1')])
        listing = self.get('/api/v1/inbox/orders').json()
        self.assertEqual({item['id'] for item in listing['items']} >= {paid.id, cart.id}, True)
        self.assertEqual([item['id'] for item in self.get('/api/v1/inbox/orders?payment_status=paid').json()['items']], [paid.id])
        self.assertEqual([item['id'] for item in self.get('/api/v1/inbox/orders?state=cart').json()['items']][:1], [cart.id])
        self.assertError(self.get('/api/v1/inbox/orders?state=x'), 422, 'invalid')
        self.settings.visibility_policy = 'assigned_only'
        self.assertEqual(self.get('/api/v1/inbox/orders').json()['total'], 0)
        self.assertError(self.get(self.order_path(cart)), 404, 'not_found')
        self.assertEqual(self.get(f'/api/v1/inbox/conversations/{self.conversation.id}/orders').status_code, 404)
        self.settings.visibility_policy = 'all'
