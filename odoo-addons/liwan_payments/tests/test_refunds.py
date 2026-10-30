# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import Command, fields
from odoo.exceptions import AccessError, LockError
from odoo.tests import new_test_user, tagged

from .common import LiwanOrderCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_payments.models.order_service import (
    RefundConflict,
    RefundRefused,
)
from odoo.addons.liwan_payments.models.refund_policy import RefundRulesInvalid

ORDERS = '/api/v1/payments/orders'
ORDER_ITEM_KEYS = {
    'id', 'number', 'customer', 'date', 'status', 'needs_attention', 'currency', 'amount_total', 'amount_due',
    'amount_received', 'amount_to_refund', 'expires_at',
}
ORDER_DETAIL_KEYS = ORDER_ITEM_KEYS | {'lines', 'transactions', 'partial_refunds'}
TRANSACTION_KEYS = {'id', 'kind', 'state', 'amount', 'provider', 'reference', 'date'}


class LiwanRefundCase(LiwanOrderCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.refunder = cls.payments_user('payments_refunder', ('payments.orders.read', 'payments.refund'), cls.env.company)

    @classmethod
    def payments_user(cls, login, keys, company, companies=None):
        """An employee holding ``keys`` (through a test role) in ``company`` only."""
        permissions = cls.env['liwan.access.permission'].search([('key', 'in', keys)])
        role = cls.env['liwan.access.role'].create({
            'key': 'test_%s' % login, 'name_ar': login, 'type': 'built_in', 'permission_ids': [Command.set(permissions.ids)],
        })
        user = new_test_user(
            cls.env, login=login, password=login + '_pass_123', groups='liwan_core.group_employee',
            company_ids=[Command.set((companies or company).ids)], company_id=(companies or company)[:1].id,
        )
        cls.env['liwan.access.assignment'].create({'user_id': user.id, 'role_id': role.id, 'company_id': company.id})
        return user

    def setUp(self):
        super().setUp()
        self.service_api = self.env['liwan.payments.service']

    def record(self, order, amount, reference):
        return self.service_api.with_user(self.refunder)._liwan_record_refund(order, amount, reference)

    def rules(self, product=None, **rules):
        self.service_api._liwan_set_refund_rules(product or self.service, **rules)

    def paid_order(self, amount=115.0):
        order = self.online_order()
        self.pay(order, amount)
        return order

    def cancel_by_customer(self, order, hours_before=None):
        start = fields.Datetime.now() + timedelta(hours=hours_before) if hours_before is not None else False
        self.service_api._liwan_request_cancel(order, requested_by_customer=True, service_start=start)

    def credit_notes(self, order):
        return self.env['account.move'].search([('reversed_entry_id', 'in', order.invoice_ids.ids)])


@tagged('post_install', '-at_install', 'liwan')
class TestRefundRules(LiwanRefundCase):
    """What a cancelled order gives back: the product's refund rules decide only when the customer cancels."""

    def test_by_default_everything_received_is_due_back(self):
        order = self.paid_order()
        self.cancel_by_customer(order, hours_before=1)
        self.assertEqual((order.state, order.liwan_retained_amount, order.liwan_refund_due_amount), ('cancel', 0.0, 115.0))

    def test_a_product_without_refunds_keeps_what_the_customer_paid_but_not_a_late_payment(self):
        self.rules(refund_policy='none')
        order = self.paid_order()
        self.cancel_by_customer(order)
        self.assertEqual((order.liwan_retained_amount, order.liwan_refund_due_amount), (115.0, 0.0))
        self.pay(order, 115.0)
        self.assertEqual(order.liwan_refund_due_amount, 115.0)

    def test_the_company_default_applies_to_products_that_keep_it(self):
        self.env['liwan.payments.settings'].create({'company_id': self.env.company.id, 'refund_policy': 'none'})
        order = self.paid_order()
        self.cancel_by_customer(order)
        self.assertEqual(order.liwan_refund_due_amount, 0.0)
        self.rules(refund_policy='full')
        other = self.paid_order()
        self.cancel_by_customer(other)
        self.assertEqual(other.liwan_refund_due_amount, 115.0)

    def test_notice_tiers_refund_by_how_long_before_the_service_the_customer_cancels(self):
        self.rules(refund_policy='notice', refund_tiers=[
            {'notice_hours': 48, 'percent': 100}, {'notice_hours': 24, 'percent': 50},
        ])
        for hours, due in ((72, 115.0), (30, 57.5), (10, 0.0), (-2, 0.0), (None, 115.0)):
            with self.subTest(hours=hours):
                order = self.paid_order()
                self.cancel_by_customer(order, hours_before=hours)
                self.assertEqual(order.liwan_refund_due_amount, due)

    def test_a_staff_cancellation_or_an_expiry_gives_everything_back(self):
        self.rules(refund_policy='none')
        order = self.paid_order()
        self.service_api._liwan_request_cancel(order)
        self.assertEqual(order.liwan_refund_due_amount, 115.0)

    def test_a_deposit_keeps_its_share_of_what_was_received_only(self):
        self.rules(refund_policy='notice', refund_tiers=[{'notice_hours': 24, 'percent': 50}])
        order = self.online_order(prepayment_percent=0.2)
        self.pay(order, 23.0)
        self.cancel_by_customer(order, hours_before=30)
        self.assertEqual((order.liwan_retained_amount, order.liwan_refund_due_amount), (11.5, 11.5))

    def test_a_refund_by_notice_needs_a_tier(self):
        with self.assertRaises(RefundRulesInvalid):
            self.rules(refund_policy='notice')
        self.rules(refund_policy='notice', refund_tiers=[{'notice_hours': 0, 'percent': 20}])
        with self.assertRaises(RefundRulesInvalid):
            self.rules(refund_tiers=[])
        self.assertEqual(self.service_api._liwan_refund_rules(self.service), {
            'refund_policy': 'notice', 'refund_amounts': 'company', 'refund_tiers': [{'notice_hours': 0, 'percent': 20}],
        })


@tagged('post_install', '-at_install', 'liwan')
class TestRecordedRefunds(LiwanRefundCase):
    """Staff record what the tenant refunded on the gateway; the order, its payments and its invoices follow."""

    def test_a_full_refund_reverses_the_invoice_and_reconciles_it(self):
        order = self.paid_order()
        invoice = order.invoice_ids
        self.assertEqual((invoice.state, invoice.payment_state in ('paid', 'in_payment')), ('posted', True))
        self.cancel_by_customer(order)
        refunds = self.record(order, 115.0, 'PMB-R-1')
        self.assertEqual((refunds.state, refunds.amount, refunds.provider_reference), ('done', -115.0, 'PMB-R-1'))
        self.assertEqual((order.liwan_refund_due_amount, order._liwan_net_received()), (0.0, 0.0))
        credit_note = self.credit_notes(order)
        self.assertEqual((credit_note.state, credit_note.amount_total), ('posted', 115.0))
        self.assertTrue(credit_note.payment_state in ('paid', 'in_payment', 'reversed'), credit_note.payment_state)
        self.assertEqual(refunds.payment_id.payment_type, 'outbound')
        note = order.message_ids.filtered(lambda message: 'PMB-R-1' in (message.body or ''))
        self.assertEqual(note.author_id, self.refunder.partner_id)

    def test_the_whole_amount_due_is_refunded_at_once_unless_partial_amounts_are_allowed(self):
        order = self.paid_order()
        self.cancel_by_customer(order)
        for amount in (0.0, -5.0, 50.0, 115.01):
            with self.subTest(amount=amount), self.assertRaises(RefundRefused):
                self.record(order, amount, 'PMB-R-2')
        self.rules(refund_amounts='any')
        self.record(order, 50.0, 'PMB-R-2')
        self.record(order, 65.0, 'PMB-R-3')
        self.assertEqual(order.liwan_refund_due_amount, 0.0)
        self.assertEqual(sorted(self.credit_notes(order).mapped('amount_total')), [50.0, 65.0])

    def test_a_refund_by_notice_credits_the_refunded_part_only(self):
        self.rules(refund_policy='notice', refund_tiers=[{'notice_hours': 24, 'percent': 50}])
        order = self.paid_order()
        self.cancel_by_customer(order, hours_before=30)
        self.record(order, 57.5, 'PMB-R-4')
        self.assertEqual(self.credit_notes(order).amount_total, 57.5)
        self.assertEqual(order.liwan_refund_due_amount, 0.0)

    def test_an_overpayment_of_a_standing_order_is_refunded_without_a_credit_note(self):
        order = self.paid_order()
        self.pay(order, 115.0)
        self.record(order, 115.0, 'PMB-R-5')
        self.assertEqual((order.state, order.liwan_refund_due_amount, len(self.credit_notes(order))), ('sale', 0.0, 0))

    def test_a_late_payment_of_an_uninvoiced_cancelled_order_is_refunded_without_a_credit_note(self):
        order = self.online_order()
        self.service_api._liwan_request_cancel(order)
        self.pay(order, 115.0)
        self.record(order, 115.0, 'PMB-R-6')
        self.assertEqual((order.liwan_refund_due_amount, len(self.credit_notes(order))), (0.0, 0))

    def test_what_the_merchant_keeps_stays_invoiced_when_a_late_payment_is_refunded(self):
        self.rules(refund_policy='none')
        order = self.paid_order()
        self.cancel_by_customer(order)
        self.pay(order, 115.0)
        self.assertEqual(order.liwan_refund_due_amount, 115.0)
        self.record(order, 115.0, 'PMB-R-10')
        self.assertEqual((order.liwan_refund_due_amount, len(self.credit_notes(order))), (0.0, 0))

    def test_a_refund_waits_while_a_payment_is_not_recorded_yet(self):
        order = self.online_order()
        self.service_api._liwan_request_cancel(order)
        tx = self.paymob_transaction(115.0, sale_order_ids=[Command.set(order.ids)])
        tx._process('paymob', self.paymob_notification(tx, 11500))
        self.assertEqual((tx.state, tx.is_post_processed, order.liwan_refund_due_amount), ('done', False, 115.0))
        with self.assertRaises(RefundConflict):
            self.record(order, 115.0, 'PMB-R-11')
        tx._post_process()
        self.record(order, 115.0, 'PMB-R-11')
        self.assertEqual(order.liwan_refund_due_amount, 0.0)

    def test_the_same_gateway_refund_is_recorded_once(self):
        self.rules(refund_amounts='any')
        order = self.paid_order()
        self.cancel_by_customer(order)
        self.record(order, 50.0, 'PMB-R-12')
        with self.assertRaises(RefundConflict):
            self.record(order, 50.0, 'PMB-R-12')
        self.assertEqual(order.liwan_refund_due_amount, 65.0)

    def test_a_refund_being_recorded_holds_the_order(self):
        order = self.paid_order()
        self.cancel_by_customer(order)

        def locked(records, **_):
            msg = 'locked'
            raise LockError(msg)
        self.patch(type(order), 'lock_for_update', locked)
        with self.assertRaises(RefundConflict):
            self.record(order, 115.0, 'PMB-R-13')

    def test_recording_a_refund_needs_the_capability_in_the_order_company(self):
        order = self.paid_order()
        self.cancel_by_customer(order)
        with self.assertRaises(AccessError):
            self.service_api.with_user(self.admin)._liwan_record_refund(order, 115.0, 'PMB-R-14')

    def test_a_saudi_credit_note_carries_its_zatca_reason(self):
        order = self.paid_order()
        self.cancel_by_customer(order)
        self.record(order, 115.0, 'PMB-R-15')
        credit_note = self.credit_notes(order)
        if 'l10n_sa_reason' not in credit_note._fields:
            self.skipTest('the Saudi localization is not installed')
        self.assertEqual(credit_note.l10n_sa_reason, 'BR-KSA-17-reason-1')

    def test_a_partial_credit_note_with_a_fixed_tax_credits_its_share(self):
        fixed = self.env['account.tax'].create({'name': 'Fixed 10', 'amount_type': 'fixed', 'amount': 10, 'type_tax_use': 'sale'})
        product = self.env['product.product'].create({
            'name': 'Fixed tax service', 'type': 'service', 'list_price': 100.0, 'taxes_id': [Command.set(fixed.ids)],
        })
        self.rules(product=product, refund_amounts='any')
        order = self.service_api._liwan_new_order(self.env.company, self.customer)
        self.service_api._liwan_add_line(order, product)
        self.pay(order, order.amount_total)
        self.service_api._liwan_request_cancel(order)
        self.assertEqual(order.amount_total, 110.0)
        self.record(order, 55.0, 'PMB-R-18')
        credit_note = self.credit_notes(order)
        self.assertEqual((credit_note.amount_total, credit_note.amount_tax), (55.0, 5.0))

    def test_a_partial_credit_note_of_a_taxed_order_meets_the_refund_or_says_so(self):
        tax = self.env['account.tax'].create({'name': 'VAT 15', 'amount': 15, 'type_tax_use': 'sale'})
        taxed = self.env['product.product'].create({
            'name': 'Taxed consultation', 'type': 'service', 'list_price': 100.0, 'taxes_id': [Command.set(tax.ids)],
        })
        self.rules(product=taxed, refund_amounts='any')
        order = self.service_api._liwan_new_order(self.env.company, self.customer)
        self.service_api._liwan_add_line(order, taxed)
        self.pay(order, order.amount_total)
        self.service_api._liwan_request_cancel(order)
        for amount, reference in ((57.5, 'PMB-R-7'), (10.0, 'PMB-R-7B')):
            with self.subTest(amount=amount):
                before = self.credit_notes(order)
                self.record(order, amount, reference)
                credit_note = self.credit_notes(order) - before
                gap = abs(credit_note.amount_total - amount)
                self.assertLessEqual(gap, 0.01)
                if gap:
                    self.assertIn('review them with an accountant', order.message_ids[:1].body)


@tagged('post_install', '-at_install', 'liwan')
class TestOrderRoutes(LiwanRefundCase):
    """Payments staff list the company's online orders and record refunds with their own capability."""

    def refund(self, order, **body):
        return self.api('POST', f'{ORDERS}/{order.id}/refunds', json=body)

    def test_the_admin_lists_and_reads_orders_but_records_no_refund(self):
        due = self.paid_order()
        self.cancel_by_customer(due)
        self.online_order()
        self.login_admin()
        listed = self.api('GET', ORDERS).json()
        self.assertGreaterEqual(listed['total'], 2)
        self.assertEqual(set(listed['items'][0]), ORDER_ITEM_KEYS)
        refunds_due = self.api('GET', f'{ORDERS}?refund_due=true').json()
        self.assertEqual([item['id'] for item in refunds_due['items']], [due.id])
        detail = self.api('GET', f'{ORDERS}/{due.id}').json()
        self.assertEqual(set(detail), ORDER_DETAIL_KEYS)
        self.assertEqual(set(detail['transactions'][0]), TRANSACTION_KEYS)
        self.assertEqual((detail['amount_to_refund'], detail['partial_refunds']), (115.0, False))
        self.assertEqual(self.refund(due, amount=115.0, reference='PMB-R-8').status_code, 403)

    def test_a_refunder_records_a_refund_and_sees_it_on_the_order(self):
        order = self.paid_order()
        self.cancel_by_customer(order)
        self.authenticate('payments_refunder', 'payments_refunder_pass_123')
        recorded = self.refund(order, amount=115.0, reference='PMB-R-9')
        self.assertEqual(recorded.status_code, 200, recorded.text)
        body = recorded.json()
        self.assertEqual(body['amount_to_refund'], 0.0)
        refund = [tx for tx in body['transactions'] if tx['kind'] == 'refund']
        self.assertEqual([(tx['amount'], tx['reference'], tx['state']) for tx in refund], [(115.0, 'PMB-R-9', 'done')])

    def test_invalid_refunds_and_filters_are_refused(self):
        order = self.paid_order()
        self.cancel_by_customer(order)
        self.authenticate('payments_refunder', 'payments_refunder_pass_123')
        for body, field in (
            ({'amount': 115.0}, 'reference'),
            ({'amount': 115.0, 'reference': ' '}, 'reference'),
            ({'amount': 115.0, 'reference': 'x' * 129}, 'reference'),
            ({'amount': '115', 'reference': 'R'}, 'amount'),
            ({'amount': 0, 'reference': 'R'}, 'amount'),
            ({'amount': 50.0, 'reference': 'R'}, 'amount'),
            ({'amount': 115.0, 'reference': 'R', 'currency': 'SAR'}, 'currency'),
        ):
            with self.subTest(field=field, body=body):
                response = self.refund(order, **body)
                self.assertEqual((response.status_code, response.json()['field']), (422, field))
        for query, field in (('refund_due=yes', 'refund_due'), ('state=paid', 'state'), ('needs_attention=1', 'needs_attention')):
            with self.subTest(query=query):
                response = self.api('GET', f'{ORDERS}?{query}')
                self.assertEqual((response.status_code, response.json()['field']), (422, field))

    def test_another_company_order_and_a_plain_order_are_not_found(self):
        other = self.env['res.company'].create({'name': 'Other payments company'})
        foreign = self.service_api._liwan_new_order(other, self.customer)
        plain = self.env['sale.order'].create({'partner_id': self.customer.id})
        self.login_admin()
        for order in (foreign, plain):
            with self.subTest(order=order.id):
                self.assertEqual(self.api('GET', f'{ORDERS}/{order.id}').status_code, 404)
        self.assertNotIn(foreign.id, [item['id'] for item in self.api('GET', ORDERS).json()['items']])

    def test_a_refund_of_another_company_order_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Refund other company'})
        foreign = self.service_api._liwan_new_order(other, self.customer)
        self.authenticate('payments_refunder', 'payments_refunder_pass_123')
        self.assertEqual(self.refund(foreign, amount=115.0, reference='PMB-R-16').status_code, 404)

    def test_capabilities_held_in_a_branch_open_nothing_of_the_parent(self):
        branch = self.env['res.company'].create({'name': 'Refund branch', 'parent_id': self.env.company.id})
        user = self.payments_user(
            'payments_branch_refunder', ('payments.orders.read', 'payments.refund'), branch,
            companies=self.env.company | branch,
        )
        access = self.env['liwan.access.service']
        self.assertTrue(access._liwan_has_capability(user, 'payments.refund', company=branch))
        self.assertFalse(access._liwan_has_capability(user, 'payments.refund', company=self.env.company))
        order = self.paid_order()
        self.cancel_by_customer(order)
        self.authenticate('payments_branch_refunder', 'payments_branch_refunder_pass_123')
        self.assertEqual(self.api('GET', ORDERS).status_code, 403)
        self.assertEqual(self.api('GET', f'{ORDERS}/{order.id}').status_code, 403)
        self.assertEqual(self.refund(order, amount=115.0, reference='PMB-R-17').status_code, 403)
        self.assertEqual(order.liwan_refund_due_amount, 115.0)

    def test_a_closed_feature_refuses_the_order_routes(self):
        order = self.paid_order()
        self.login_admin()
        set_probe_feature(self, key='payments.enabled', enabled=False)
        self.assertEqual(self.api('GET', ORDERS).status_code, 403)
        self.assertEqual(self.api('GET', f'{ORDERS}/{order.id}').status_code, 403)
