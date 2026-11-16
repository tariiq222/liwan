# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Who may invoice an order, who reads its invoices, and every refusal, both applications' features and capabilities."""
from odoo.tests import tagged

from .common import ORDERS, SalesFinanceCase


@tagged('post_install', '-at_install', 'liwan')
class TestInvoiceAccess(SalesFinanceCase):

    def refused(self, user, order, status, code=None, body=None):
        before = len(self.env['sale.order'].browse(order.id).invoice_ids)
        response = self.api_as(user, 'POST', f'{ORDERS}/{order.id}/invoices', body or {'method': 'order'})
        self.assertEqual(response.status_code, status, response.text)
        if code:
            self.assertEqual(response.json()['code'], code, response.text)
        self.assertEqual(len(self.env['sale.order'].browse(order.id).invoice_ids), before)
        return response.json()

    def test_both_capabilities_are_needed_and_either_one_alone_is_refused(self):
        order = self.confirmed()
        for user in (self.seller2, self.accountant, self.outsider, self.auditor):
            with self.subTest(user=user.login):
                self.refused(user, order, 403, 'forbidden')
        order_confirm = self.custom_user('inv_confirm_only', ('sales.read', 'sales.orders.confirm', 'finance.invoices.read'), company=self.fin)
        manage_only = self.custom_user('inv_manage_only', ('sales.read', 'finance.invoices.read', 'finance.invoices.manage'), company=self.fin)
        for user in (order_confirm, manage_only):
            with self.subTest(user=user.login):
                self.refused(user, order, 403)

    def test_only_the_orders_the_caller_reads_in_sales_are_invoiced(self):
        order = self.confirmed(user=self.biller)
        self.refused(self.biller2, order, 404, 'not_found')
        branch_order = self.confirmed(user=self.branch_biller, company=self.fin_branch)
        self.refused(self.biller, branch_order, 404, 'not_found')
        self.refused(self.branch_biller, order, 404, 'not_found')
        self.assertEqual(self.invoice_order(self.boss, order)['invoicing']['status'], 'invoiced')
        self.set_visibility('all')
        self.set_invoice_actor('any_biller')
        other = self.confirmed(user=self.biller)
        self.assertEqual(self.invoice_order(self.biller2, other)['invoicing']['status'], 'invoiced')

    def test_by_default_only_the_salesperson_or_an_assign_holder_invoices(self):
        self.set_visibility('all')
        order = self.confirmed(user=self.biller)
        self.assertEqual(self.env['liwan.sales.settings']._liwan_current().invoice_actor, 'owner')
        block = self.shape(self.biller2, order)['invoicing']
        self.assertEqual((block['can_invoice'], block['can_down_payment']), (False, False))
        refused = self.refused(self.biller2, order, 403, 'forbidden')
        self.assertEqual(refused['details'], {'reason': 'not_the_salesperson'})
        self.refused(self.biller2, order, 403, 'forbidden', {'method': 'percent', 'percent': 10})
        for user in (self.biller, self.boss):
            with self.subTest(user=user.login):
                block = self.shape(user, order)['invoicing']
                self.assertEqual((block['can_invoice'], block['can_down_payment']), (True, True))
        self.assertEqual(self.invoice_order(self.boss, order)['invoicing']['status'], 'invoiced')
        own = self.confirmed(user=self.biller2)
        self.assertEqual(self.invoice_order(self.biller2, own)['invoicing']['status'], 'invoiced')

    def test_any_biller_lets_a_colleague_with_both_rights_invoice_and_is_mirrored_in_the_shape(self):
        self.set_visibility('all')
        self.set_invoice_actor('any_biller')
        order = self.confirmed(user=self.seller)
        block = self.shape(self.biller2, order)['invoicing']
        self.assertEqual((block['can_invoice'], block['can_down_payment']), (True, True))
        self.assertEqual(self.invoice_order(self.biller2, order, {'method': 'percent', 'percent': 20})['invoicing']['status'], 'partial')
        self.refused(self.auditor, self.confirmed(user=self.seller), 403, 'forbidden')
        self.refused(self.accountant, order, 403, 'forbidden')
        self.set_invoice_actor('owner')
        self.assertFalse(self.shape(self.biller2, order)['invoicing']['can_invoice'])

    def test_the_invoices_are_hidden_without_finance_read(self):
        order = self.confirmed(user=self.seller)
        self.invoice_order(self.boss, order)
        shape = self.shape(self.seller, order)
        self.assertIsNone(shape['invoicing'])
        self.assertNotIn('S0', str(shape['invoicing']))
        auditor_order = self.confirmed(user=self.auditor)
        self.invoice_order(self.boss, auditor_order)
        seen = self.shape(self.auditor, auditor_order)['invoicing']
        self.assertEqual((seen['status'], len(seen['invoices']), seen['can_invoice'], seen['can_down_payment']), ('invoiced', 1, False, False))
        self.refused(self.auditor, self.confirmed(user=self.auditor), 403, 'forbidden')

    def test_a_missing_feature_on_either_side_refuses_and_hides(self):
        order = self.confirmed()
        shown = self.shape(self.biller, order)['invoicing']
        self.assertTrue(shown['can_invoice'])
        for key in ('finance.enabled', 'sales.enabled'):
            with self.subTest(feature=key):
                self.feature(key, False)
                self.refused(self.biller, order, 403, 'feature_not_included')
                if key == 'finance.enabled':
                    self.assertIsNone(self.shape(self.biller, order)['invoicing'])
                self.feature(key, True)
        self.assertEqual(self.invoice_order(self.biller, order)['invoicing']['status'], 'invoiced')

    def test_finance_kept_for_reading_shows_the_invoices_but_offers_no_new_one(self):
        order = self.confirmed()
        self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 50})
        self.feature('finance.enabled', False, retained=True)
        self.refused(self.biller, order, 403, 'feature_not_included', {'method': 'percent', 'percent': 10})
        block = self.shape(self.biller, order)['invoicing']
        self.assertTrue(block and not block['can_invoice'] and not block['can_down_payment'])
        self.assertEqual(len(block['invoices']), 1)

    def test_an_online_order_is_invoiced_by_the_payments_service_not_here(self):
        online = self.make_order(None, self.fin, staff=False, lines=[self.line(quantity=2)])
        online.action_confirm()
        refused = self.refused(self.biller, online, 403, 'forbidden')
        self.assertEqual(refused['details'], {'reason': 'online_order'})
        block = self.shape(self.biller, online)['invoicing']
        self.assertEqual((block['can_invoice'], block['can_down_payment'], block['status']), (False, False, 'to_invoice'))

    def test_an_order_that_is_not_confirmed_is_refused(self):
        draft = self.make_order(self.biller, self.fin, lines=[self.line(quantity=2)])
        self.refused(self.biller, draft, 422, 'order_not_confirmed')
        cancelled = self.confirmed()
        self.env['liwan.sales.service']._liwan_move(cancelled, 'cancel')
        self.refused(self.biller, cancelled, 422, 'order_not_confirmed')

    def test_a_company_without_a_sales_journal_asks_for_one(self):
        order = self.confirmed()
        self.env['account.journal'].search([('company_id', '=', self.fin.id), ('type', '=', 'sale')]).active = False
        refused = self.refused(self.biller, order, 422, 'no_journal')
        self.assertEqual(refused['field'], 'journal_id')

    def test_an_unknown_order_and_an_unauthenticated_call_are_refused(self):
        missing = self.api_as(self.biller, 'POST', f'{ORDERS}/999999/invoices', {'method': 'order'})
        self.assertEqual(missing.status_code, 404, missing.text)
        self.authenticate(None, None)
        anonymous = self.api('POST', f'{ORDERS}/1/invoices', {'method': 'order'})
        self.assertIn(anonymous.status_code, (401, 403, 404), anonymous.text)

    def test_a_repeated_idempotency_key_makes_one_invoice(self):
        order = self.confirmed(lines=[self.line(quantity=2)])
        self.as_user(self.biller)
        headers = {'Content-Type': 'application/json', 'Idempotency-Key': 'sales-finance-key-0001'}
        first = self.url_open(f'{ORDERS}/{order.id}/invoices', json={'method': 'percent', 'percent': 25}, headers=headers, method='POST')
        again = self.url_open(f'{ORDERS}/{order.id}/invoices', json={'method': 'percent', 'percent': 25}, headers=headers, method='POST')
        self.assertEqual((first.status_code, again.status_code), (200, 200), again.text)
        self.assertEqual(first.json(), again.json())
        self.assertEqual(len(self.env['sale.order'].browse(order.id).invoice_ids), 1)
