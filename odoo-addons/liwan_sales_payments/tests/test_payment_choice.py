# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""How a quotation asks to be paid: the tenant's default at creation, the staff's choice, and what the staff page shows."""
from odoo.tests import tagged

from .common import ORDERS, TOTAL, SalesPaymentsCase

PAYMENT_KEYS = {
    'mode', 'percent', 'currency', 'amount_required', 'amount_received', 'amount_due', 'amount_to_refund', 'amount_refundable',
    'can_refund', 'status', 'link', 'held', 'needs_attention', 'attention',
}


@tagged('post_install', '-at_install', 'liwan')
class TestPaymentChoice(SalesPaymentsCase):

    def create(self, user=None, expect=200, **extra):
        response = self.api_as(user or self.agent, 'POST', ORDERS, self.order_body(**extra))
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def stored(self, body):
        order = self.env['sale.order'].browse(body['id'])
        return order.require_payment, order.prepayment_percent

    def test_a_new_quotation_takes_the_tenant_default_once(self):
        self.set_default('percent', 30)
        body = self.create()
        self.assertEqual(self.stored(body), (True, 0.3))
        self.assertEqual((body['payment']['mode'], body['payment']['percent']), ('percent', 30))
        self.set_default('off')
        self.assertEqual(self.stored(body), (True, 0.3))
        self.assertEqual(self.api_as(self.agent, 'GET', f"{ORDERS}/{body['id']}").json()['payment']['mode'], 'percent')
        self.assertFalse(self.stored(self.create())[0])

    def test_the_default_full_asks_for_all_of_the_total(self):
        self.set_default('full')
        body = self.create()
        self.assertEqual(self.stored(body), (True, 1.0))
        payment = body['payment']
        self.assertEqual((payment['mode'], payment['percent'], payment['amount_required']), ('full', 100, body['amount_total']))

    def test_the_staff_choice_on_create_wins_over_the_default(self):
        self.set_default('full')
        self.assertFalse(self.stored(self.create(payment_to_confirm='off'))[0])
        self.assertEqual(self.stored(self.create(payment_to_confirm='percent', prepayment_percent=20)), (True, 0.2))
        body = self.create(payment_to_confirm='percent')
        self.assertEqual(body['payment']['percent'], 50)

    def test_a_tenant_without_online_payments_gets_quotations_that_do_not_ask(self):
        self.set_default('full')
        self.payments(False)
        body = self.create()
        self.assertFalse(self.stored(body)[0])
        self.assertIsNone(body['payment'])
        refused = self.api_as(self.agent, 'POST', ORDERS, self.order_body(payment_to_confirm='full'))
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'feature_not_included'), refused.text)
        self.assertEqual(self.create(payment_to_confirm='off')['payment'], None)

    def test_a_draft_changes_its_choice_and_only_a_draft(self):
        body = self.create()
        path = f"{ORDERS}/{body['id']}"
        patched = self.patch_order(self.agent, body['id'], {'payment_to_confirm': 'percent', 'prepayment_percent': 25})
        self.assertEqual((patched['payment']['mode'], patched['payment']['percent']), ('percent', 25))
        self.assertEqual(self.patch_order(self.agent, body['id'], {'prepayment_percent': 40})['payment']['percent'], 40)
        self.assertEqual(self.patch_order(self.agent, body['id'], {'payment_to_confirm': 'full'})['payment']['mode'], 'full')
        self.assertEqual(self.patch_order(self.agent, body['id'], {'payment_to_confirm': 'off'})['payment']['mode'], 'off')
        self.refused(self.api_as(self.agent, 'PATCH', path, {'prepayment_percent': 40}), 422, 'invalid', 'prepayment_percent')
        self.refused(self.api_as(self.agent, 'PATCH', path, {'payment_to_confirm': 'full', 'prepayment_percent': 40}), 422, 'invalid', 'prepayment_percent')
        for key, value in (('payment_to_confirm', 'half'), ('prepayment_percent', 0), ('prepayment_percent', 101), ('prepayment_percent', True)):
            self.refused(self.api_as(self.agent, 'PATCH', path, {key: value}), 422, 'invalid', key)
        self.act(self.agent, body['id'], 'cancel')
        self.assertEqual(self.api_as(self.agent, 'PATCH', path, {'payment_to_confirm': 'full'}).status_code, 403)

    def test_the_choice_needs_the_right_to_write_quotations(self):
        reader = self.custom_user('sales_reader_only', ['sales.read'])
        response = self.api_as(reader, 'POST', ORDERS, self.order_body(payment_to_confirm='full'))
        self.assertEqual(response.status_code, 403, response.text)
        body = self.create()
        self.assertEqual(self.api_as(self.agent2, 'PATCH', f"{ORDERS}/{body['id']}", {'payment_to_confirm': 'full'}).status_code, 404)

    def test_a_duplicate_takes_the_tenant_default_not_the_copied_choice(self):
        body = self.create(payment_to_confirm='full')
        self.set_default('percent', 10)
        copy = self.act(self.agent, body['id'], 'duplicate')
        self.assertEqual((copy['payment']['mode'], copy['payment']['percent']), ('percent', 10))

    def test_the_staff_page_shows_the_payment_of_a_sent_quotation(self):
        order = self.payable('percent', 40)
        body = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()
        self.assertEqual(set(body['payment']), PAYMENT_KEYS)
        self.assertEqual(
            body['payment'],
            {
                'mode': 'percent', 'percent': 40, 'currency': 'SAR', 'amount_required': TOTAL * 0.4, 'amount_received': 0.0,
                'amount_due': TOTAL * 0.4, 'amount_to_refund': 0.0, 'amount_refundable': 0.0, 'can_refund': False,
                'status': 'payable', 'link': 'ready', 'held': None,
                'needs_attention': False, 'attention': None,
            },
        )

    def test_a_quotation_that_asks_for_nothing_and_an_online_order_show_no_payment_due(self):
        body = self.api_as(self.agent, 'GET', f"{ORDERS}/{self.payable('off').id}").json()
        self.assertEqual((body['payment']['mode'], body['payment']['status'], body['payment']['link'], body['payment']['amount_due']), ('off', 'none', 'none', 0.0))
        online = self.online_order()
        self.assertIsNone(self.api_as(self.manager, 'GET', f'{ORDERS}/{online.id}').json()['payment'])

    def test_the_payment_of_a_reader_never_shows_when_payments_are_off(self):
        order = self.payable('full')
        self.payments(False)
        self.assertIsNone(self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['payment'])

    def test_a_draft_switched_to_a_percentage_takes_the_tenant_percentage(self):
        self.set_default('full', 30)
        body = self.create()
        self.assertEqual(body['payment']['mode'], 'full')
        patched = self.patch_order(self.agent, body['id'], {'payment_to_confirm': 'percent'})
        self.assertEqual((patched['payment']['mode'], patched['payment']['percent']), ('percent', 30))
        self.assertEqual(self.stored(body), (True, 0.3))
        # A percentage quotation keeps its own percentage when the mode is sent again.
        self.patch_order(self.agent, body['id'], {'prepayment_percent': 40})
        self.assertEqual(self.patch_order(self.agent, body['id'], {'payment_to_confirm': 'percent'})['payment']['percent'], 40)

    def test_a_percentage_of_one_hundred_reads_back_as_full_on_create_and_edit(self):
        body = self.create(payment_to_confirm='percent', prepayment_percent=100)
        self.assertEqual((body['payment']['mode'], body['payment']['percent']), ('full', 100))
        self.assertEqual(self.stored(body), (True, 1.0))
        patched = self.patch_order(self.agent, body['id'], {'payment_to_confirm': 'percent', 'prepayment_percent': 100})
        self.assertEqual(patched['payment']['mode'], 'full')
        off = self.create(payment_to_confirm='percent', prepayment_percent=15)
        self.assertEqual((off['payment']['mode'], off['payment']['percent']), ('percent', 15))
        self.refused(self.api_as(self.agent, 'POST', ORDERS, self.order_body(prepayment_percent=15)), 422, 'invalid', 'prepayment_percent')
