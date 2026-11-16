# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A payment confirms a staff quotation through the Sales path, once, and only while the quotation can be confirmed."""
from datetime import timedelta
from unittest.mock import patch

from odoo import Command, fields
from odoo.exceptions import LockError
from odoo.tests import tagged

from .common import ORDERS, TOTAL, SalesPaymentsCase
from odoo.addons.liwan_sales.tests.common import SENDER


@tagged('post_install', '-at_install', 'liwan')
class TestConfirmByPayment(SalesPaymentsCase):

    def note_count(self, order, text):
        return len(order.message_ids.filtered(lambda message: text in (message.body or '')))

    def staff_payment(self, order, user=None):
        return self.api_as(user or self.agent, 'GET', f'{ORDERS}/{order.id}').json()['payment']

    def public_payment(self, order):
        return self.public(order).json()['payment']

    def confirmation_mails(self, order):
        """The Sales confirmation e-mails queued for ``order``."""
        return self.env['mail.mail'].search([('subject', '=', f'تأكيد الطلب {order.name} / Order {order.name} confirmed')])

    def stock_mails(self):
        """Stock's order notification mails, replaced by a recorder; yields the list of their templates."""
        sent = []
        model = type(self.env['sale.order'])
        return sent, patch.object(model, '_send_order_notification_mail', autospec=True, side_effect=lambda order, template, **_: sent.append(template))

    def extend_and_send(self, order, reopen=True):
        """Staff reopen an expired or sent quotation, give it a new validity date and send it again."""
        if reopen:
            self.act(self.agent, order.id, 'reopen')
        future = fields.Date.to_string(fields.Date.today() + timedelta(days=10))
        self.patch_order(self.agent, order.id, {'validity_date': future})
        return self.send_via_api(self.agent, order.id)

    def test_full_payment_confirms_the_order_and_records_the_acceptance(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                order = self.payable('full')
                self.pay(order, TOTAL)
                self.assertEqual(order.state, 'sale')
                self.assertEqual((order.liwan_answer, bool(order.liwan_answered_on)), ('accepted', True))
                payment = self.staff_payment(order)
                self.assertEqual((payment['status'], payment['amount_received'], payment['amount_due'], payment['held']), ('paid', TOTAL, 0.0, None))

    def test_a_repeated_notification_confirms_nothing_twice(self):
        order = self.payable('full')
        tx = self.pay(order, TOTAL)
        stamp = order.liwan_answered_on
        self.assertEqual(tx._check_amount_and_confirm_order(), self.env['sale.order'])
        tx._post_process()
        self.assertEqual((order.state, order.liwan_answered_on, len(order.invoice_ids)), ('sale', stamp, len(order.invoice_ids)))
        self.assertEqual(self.note_count(order, 'A payment arrived'), 0)

    def test_a_deposit_confirms_only_when_it_reaches_the_percentage(self):
        order = self.payable('percent', 40)
        self.pay(order, 30.0)
        self.assertEqual(order.state, 'sent')
        payment = self.staff_payment(order)
        self.assertEqual((payment['status'], payment['amount_received'], payment['amount_due']), ('payable', 30.0, 6.0))
        self.pay(order, 6.0)
        self.assertEqual(order.state, 'sale')

    def test_a_payment_after_the_validity_date_is_recorded_and_the_order_is_not_confirmed(self):
        order = self.payable('full')
        self.lapse(order)
        self.pay(order, TOTAL)
        self.assertEqual((order.state, order.liwan_answer), ('sent', False))
        self.assertEqual(self.note_count(order, 'after the quotation expired'), 1)
        payment = self.staff_payment(order)
        self.assertEqual((payment['held'], payment['amount_received']), ('expired', TOTAL))
        # Staff extend it the way they always do; the send itself confirms nothing.
        self.act(self.agent, order.id, 'reopen')
        self.assertEqual(self.staff_payment(order)['held'], 'reopened')
        self.assertEqual(self.extend_and_send(order, reopen=False)['state'], 'sent')

    def test_a_payment_on_a_reopened_or_cancelled_quotation_is_recorded_and_not_confirmed(self):
        reopened = self.payable('full')
        self.act(self.agent, reopened.id, 'reopen')
        self.pay(reopened, TOTAL)
        self.assertEqual(reopened.state, 'draft')
        self.assertEqual(self.note_count(reopened, 'while the quotation was a draft'), 1)
        cancelled = self.payable('full')
        self.act(self.agent, cancelled.id, 'cancel')
        self.pay(cancelled, TOTAL)
        self.assertEqual(cancelled.state, 'cancel')
        self.assertEqual(self.note_count(cancelled, 'after the quotation was cancelled'), 1)
        payment = self.staff_payment(cancelled)
        self.assertEqual((payment['status'], payment['amount_received'], payment['amount_to_refund'], payment['held']), ('cancelled', TOTAL, TOTAL, 'cancelled'))

    def test_a_signature_and_a_payment_confirm_in_either_order(self):
        paid_first = self.payable('full', answer='accept_and_sign')
        self.pay(paid_first, TOTAL)
        self.assertEqual(paid_first.state, 'sent')
        self.assertEqual(self.staff_payment(paid_first)['held'], 'awaiting_signature')
        self.assertEqual(self.accept(paid_first, self.sign_body()).status_code, 200)
        paid_first.invalidate_recordset()
        self.assertEqual((paid_first.state, paid_first.liwan_answer, paid_first.signed_by), ('sale', 'accepted', 'Mona'))
        signed_first = self.payable('full', answer='accept_and_sign')
        self.assertEqual(self.accept(signed_first, self.sign_body()).status_code, 200)
        signed_first.invalidate_recordset()
        self.assertEqual(signed_first.state, 'sent')
        self.pay(signed_first, TOTAL)
        self.assertEqual((signed_first.state, signed_first.liwan_answer), ('sale', 'accepted'))

    def test_an_acceptance_of_a_quotation_that_asks_for_nothing_confirms_nothing(self):
        order = self.payable('off')
        self.assertEqual(self.accept(order).status_code, 200)
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer), ('sent', 'accepted'))

    def test_without_an_answer_mode_the_payment_alone_confirms(self):
        order = self.payable('full', answer='none')
        self.pay(order, TOTAL)
        self.assertEqual((order.state, order.liwan_answer), ('sale', False))

    def test_an_online_order_is_confirmed_by_stock_as_before(self):
        order = self.online_order()
        self.pay(order, order.amount_total)
        self.assertEqual(order.state, 'sale')

    def test_a_declined_quotation_stays_cancelled_when_paid_later(self):
        order = self.payable('full')
        self.anon('POST', f'/api/v1/public/sales/quotations/{order.id}/decline', {'access_token': order.access_token})
        self.pay(order, TOTAL)
        self.assertEqual(order.state, 'cancel')

    def test_an_acceptance_never_confirms_an_unpaid_quotation_that_asks_to_be_paid(self):
        for answer in ('accept', 'accept_and_sign'):
            for confirms in (True, False):
                with self.subTest(answer=answer, confirms=confirms):
                    order = self.payable('full', answer=answer, confirms=confirms)
                    body = self.sign_body() if answer == 'accept_and_sign' else None
                    self.assertEqual(self.accept(order, body).status_code, 200)
                    order.invalidate_recordset()
                    self.assertEqual((order.state, order.liwan_answer), ('sent', 'accepted'))
                    self.assertEqual(self.public_payment(order)['state'], 'payable')
                    self.pay(order, TOTAL)
                    self.assertEqual(order.state, 'sale')

    def test_an_acceptance_that_confirms_still_confirms_a_quotation_that_asks_for_nothing(self):
        order = self.payable('off', confirms=True)
        self.assertEqual(self.accept(order).status_code, 200)
        order.invalidate_recordset()
        self.assertEqual(order.state, 'sale')

    def test_staff_may_confirm_an_unpaid_quotation_and_no_pay_action_remains(self):
        order = self.payable('full')
        self.act(self.agent, order.id, 'confirm')
        order.invalidate_recordset()
        self.assertEqual(order.state, 'sale')
        payment = self.staff_payment(order)
        self.assertEqual((payment['link'], payment['amount_due'], payment['held']), ('none', 0.0, None))
        self.assertIsNone(self.public_payment(order))

    def held_then_resent(self, answer='accept', user=None, edit=None):
        """A quotation of ``answer`` paid in full after it expired, then reopened, extended (and ``edit``ed) and sent again
        by ``user`` (default: its salesperson), under the same answer mode."""
        order = self.payable('full', answer=answer)
        self.lapse(order)
        self.pay(order, TOTAL)
        self.act(self.agent, order.id, 'reopen')
        future = fields.Date.to_string(fields.Date.today() + timedelta(days=10))
        self.patch_order(user or self.agent, order.id, {'validity_date': future, **(edit or {})})
        self.send_via_api(user or self.agent, order.id)
        order.invalidate_recordset()
        return order

    def test_a_send_never_confirms_with_or_without_the_confirm_capability(self):
        self.give_custom_role(self.agent2, ['sales.read', 'sales.quotations.manage', 'sales.documents.assign'])
        for user in (self.agent2, self.agent):
            with self.subTest(user=user.login):
                order = self.held_then_resent(user=user)
                self.assertEqual((order.state, order.liwan_answer), ('sent', False))
                self.assertFalse(self.confirmation_mails(order))
                self.assertEqual(self.public_payment(order)['state'], 'received')

    def test_after_a_resend_the_new_acceptance_confirms(self):
        order = self.held_then_resent('accept')
        self.assertEqual(self.accept(order).status_code, 200)
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer), ('sale', 'accepted'))
        self.assertEqual(len(self.confirmation_mails(order)), 1)

    def test_after_a_resend_the_signature_confirms(self):
        order = self.held_then_resent('accept_and_sign')
        self.assertEqual((self.staff_payment(order)['held'], self.public(order).json()['can_accept']), ('awaiting_signature', True))
        self.assertEqual(self.accept(order, self.sign_body()).status_code, 200)
        order.invalidate_recordset()
        self.assertEqual((order.state, order.signed_by), ('sale', 'Mona'))

    def test_without_an_answer_mode_staff_are_told_the_money_waits_for_their_confirm(self):
        order = self.held_then_resent('none')
        payment = self.staff_payment(order)
        self.assertEqual((order.state, payment['needs_attention'], payment['attention']), ('sent', True, 'payment_awaits_confirmation'))
        self.act(self.agent, order.id, 'confirm')
        order.invalidate_recordset()
        payment = self.staff_payment(order)
        self.assertEqual((order.state, payment['attention'], payment['needs_attention']), ('sale', None, False))

    def test_a_draft_that_holds_money_keeps_its_customer(self):
        order = self.payable('full')
        self.act(self.agent, order.id, 'reopen')
        self.pay(order, TOTAL)
        other = self.party('Another payer')
        self.refused(self.api_as(self.agent, 'PATCH', f'{ORDERS}/{order.id}', {'customer_id': other.id}), 422, 'invalid', 'customer_id')
        empty = self.payable('full')
        self.act(self.agent, empty.id, 'reopen')
        self.assertEqual(self.patch_order(self.agent, empty.id, {'customer_id': other.id})['customer']['id'], other.id)

    def test_a_resend_priced_higher_asks_for_the_difference(self):
        dearer = [self.product_line(self.plain, quantity=3)]
        order = self.held_then_resent('accept', edit={'lines': dearer})
        self.assertGreater(order.amount_total, TOTAL)
        public = self.public_payment(order)
        self.assertEqual((public['state'], public['amount']), ('payable', order.amount_total - TOTAL))
        self.pay(order, order.amount_total - TOTAL)
        self.assertEqual(order.state, 'sale')

    def test_a_resend_priced_lower_reports_the_surplus_once_confirmed(self):
        cheaper = [self.product_line(self.plain, quantity=1)]
        order = self.held_then_resent('accept', edit={'lines': cheaper})
        self.assertLess(order.amount_total, TOTAL)
        self.assertEqual(self.public_payment(order)['state'], 'received')
        self.assertEqual(self.accept(order).status_code, 200)
        order.invalidate_recordset()
        payment = self.staff_payment(order)
        surplus = TOTAL - order.amount_total
        self.assertEqual((order.state, payment['amount_to_refund'], payment['amount_refundable']), ('sale', surplus, surplus))

    def test_a_payment_that_confirms_sends_one_sales_confirmation_mail(self):
        order = self.payable('full')
        sent, recorder = self.stock_mails()
        with recorder:
            tx = self.pay(order, TOTAL)
            tx._process('paymob', self.paymob_notification(tx, round(TOTAL * 100)))
            tx._check_amount_and_confirm_order()
        self.assertEqual((order.state, sent), ('sale', []))
        mail = self.confirmation_mails(order)
        self.assertEqual(len(mail), 1)
        body = str(mail.body_html)
        for closed in ('/mail/view', '/my/', '/odoo'):
            self.assertNotIn(closed, body)
        self.assertIn(f'/quote/{order.id}?access_token={order.access_token}', body)
        self.assertEqual((mail.email_from, mail.email_to), (SENDER, order.partner_id.email))

    def test_a_payment_confirms_without_a_sender_and_the_order_says_no_mail_went(self):
        order = self.payable('full')
        self.env['ir.config_parameter'].set_param('mail.default.from', False)
        self.patch(type(self.env['liwan.outbound.mail']), '_liwan_sender', lambda model: None)
        self.pay(order, TOTAL)
        self.assertEqual(order.state, 'sale')
        self.assertFalse(self.confirmation_mails(order))
        self.assertEqual(self.note_count(order, 'no confirmation e-mail was sent'), 1)

    def test_a_contended_row_is_a_conflict_for_the_customer(self):
        accepted = self.payable('full', answer='accept_and_sign')
        self.patch(type(self.env['sale.order']), 'lock_for_update', lambda records, **_: (_ for _ in ()).throw(LockError('held')))
        self.refused(self.accept(accepted, self.sign_body()), 409, 'conflict')

    def test_a_payment_callback_on_a_contended_row_raises_so_stock_retries(self):
        order = self.payable('full')
        tx = self.paymob_transaction(TOTAL, sale_order_ids=[Command.set(order.ids)])
        tx._process('paymob', self.paymob_notification(tx, round(TOTAL * 100)))
        self.patch(type(self.env['sale.order']), 'lock_for_update', lambda records, **_: (_ for _ in ()).throw(LockError('held')))
        with self.assertRaises(LockError):
            tx._check_amount_and_confirm_order()

    def test_any_money_on_a_dead_quotation_is_held_and_due_back(self):
        def deposit(order):
            self.pay(order, 20.0)
            return order
        cancelled = deposit(self.payable('percent', 50))
        self.act(self.agent, cancelled.id, 'cancel')
        declined = deposit(self.payable('percent', 50))
        self.anon('POST', f'/api/v1/public/sales/quotations/{declined.id}/decline', {'access_token': declined.access_token})
        expired = deposit(self.payable('percent', 50))
        self.lapse(expired)
        reopened = deposit(self.payable('percent', 50))
        self.act(self.agent, reopened.id, 'reopen')
        for order, reason in ((cancelled, 'cancelled'), (declined, 'cancelled'), (expired, 'expired'), (reopened, 'reopened')):
            with self.subTest(reason=reason, order=order.id):
                payment = self.staff_payment(order)
                self.assertEqual((payment['held'], payment['amount_to_refund'], payment['amount_refundable']), (reason, 20.0, 20.0))
        # A further payment on a dead quotation is noted once, however often its callback comes.
        tx = self.pay(cancelled, 5.0)
        tx._check_amount_and_confirm_order()
        self.assertEqual(self.note_count(cancelled, 'after the quotation was cancelled'), 1)

    def test_a_required_amount_of_zero_asks_for_nothing(self):
        line = Command.create({'product_id': self.product.id, 'product_uom_qty': 1, 'price_unit': 0.0})
        order = self.payable('full', confirms=True, lines=[line])
        self.assertEqual(order._get_prepayment_required_amount(), 0.0)
        self.assertIsNone(self.public_payment(order))
        payment = self.staff_payment(order)
        self.assertEqual((payment['status'], payment['link'], payment['amount_due']), ('none', 'none', 0.0))
        self.assertEqual(self.accept(order).status_code, 200)
        order.invalidate_recordset()
        self.assertEqual(order.state, 'sale')

    def test_a_lapsed_payments_plan_keeps_an_unpaid_quotation_from_being_confirmed_by_acceptance(self):
        order = self.payable('full', confirms=True)
        self.payments(False)
        self.assertEqual(self.accept(order).status_code, 200)
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer), ('sent', 'accepted'))
        self.act(self.agent, order.id, 'confirm')
        order.invalidate_recordset()
        self.assertEqual(order.state, 'sale')

    def test_a_confirmed_order_whose_payment_is_voided_needs_attention(self):
        order = self.payable('full')
        # Paymob captures at once; a gateway that authorizes first is what this guards against.
        self.paymob.sudo().support_manual_capture = 'full_only'
        tx = self.paymob_transaction(TOTAL, sale_order_ids=[Command.set(order.ids)])
        tx._set_authorized()
        tx._post_process()
        self.assertEqual(order.state, 'sale')
        self.assertEqual(self.staff_payment(order)['attention'], None)
        tx._set_canceled()
        payment = self.staff_payment(order)
        self.assertEqual((payment['needs_attention'], payment['attention']), (True, 'payment_reversed'))

    def test_a_held_payment_is_noted_once(self):
        order = self.payable('full')
        self.act(self.agent, order.id, 'cancel')
        tx = self.pay(order, TOTAL)
        order._liwan_confirm_by_payment(tx)
        tx._check_amount_and_confirm_order()
        self.assertEqual(self.note_count(order, 'after the quotation was cancelled'), 1)
        self.assertEqual(self.staff_payment(order)['held'], 'cancelled')

    def test_the_balance_after_a_deposit_and_two_halves_of_the_whole_confirm_on_the_last_payment(self):
        order = self.payable('full')
        self.pay(order, TOTAL / 2)
        self.assertEqual((order.state, self.staff_payment(order)['amount_due']), ('sent', TOTAL / 2))
        self.pay(order, TOTAL / 2)
        self.assertEqual(order.state, 'sale')

    def test_an_overpayment_confirms_and_the_surplus_is_due_back(self):
        order = self.payable('percent', 50)
        self.pay(order, 100.0)
        self.assertEqual(order.state, 'sale')
        payment = self.staff_payment(order)
        self.assertEqual((payment['amount_received'], payment['amount_to_refund'], payment['amount_refundable']), (100.0, 10.0, 10.0))

    def test_a_transaction_shared_with_another_order_stays_with_stock(self):
        order = self.payable('full')
        online = self.online_order()
        tx = self.paymob_transaction(TOTAL + online.amount_total, sale_order_ids=[Command.set((order | online).ids)])
        tx._process('paymob', self.paymob_notification(tx, round((TOTAL + online.amount_total) * 100)))
        tx._post_process()
        self.assertEqual((order.state, online.state), ('sent', 'draft'))
        self.assertEqual(self.staff_payment(order)['amount_received'], 0.0)

    def test_a_percentage_is_rounded_to_the_currency_and_taxes_count_in_the_total(self):
        taxed = self.taxed.product_variant_id
        line = Command.create({'product_id': taxed.id, 'product_uom_qty': 1, 'price_unit': 100.0, 'tax_ids': [Command.set(self.tax_added.ids)]})
        order = self.payable('percent', 33, lines=[line])
        self.assertEqual((order.amount_total, order._get_prepayment_required_amount()), (115.0, 37.95))
        self.pay(order, 37.94)
        self.assertEqual(order.state, 'sent')
        self.pay(order, 0.01)
        self.assertEqual(order.state, 'sale')
        included = Command.create({
            'product_id': self.included.product_variant_id.id, 'product_uom_qty': 1, 'price_unit': 100.0,
            'tax_ids': [Command.set(self.tax_included.ids)],
        })
        inclusive = self.payable('full', lines=[included])
        self.assertEqual(inclusive.amount_total, 100.0)
        self.pay(inclusive, 100.0)
        self.assertEqual(inclusive.state, 'sale')
