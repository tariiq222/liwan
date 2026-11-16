# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Down payments by percent and by amount, the final invoice that deducts them, and their refusals."""
from odoo.tests import tagged

from .common import SalesFinanceCase


@tagged('post_install', '-at_install', 'liwan')
class TestDownPayments(SalesFinanceCase):

    def pay(self, user, order, body, expect=200):
        return self.invoice_order(user, order, body, expect=expect)

    def refused(self, body, code, field=None, order=None):
        order = order or self.confirmed(lines=[self.line(quantity=2)])
        response = self.pay(self.biller, order, body, expect=422)
        self.assertEqual((response['code'], response.get('field')), (code, field), response)
        self.assertFalse(self.env['sale.order'].browse(order.id).invoice_ids)
        return response

    def test_a_down_payment_by_percent_invoices_that_share_of_the_total(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                order = self.confirmed(lines=[self.line(quantity=2, discount=10)])
                block = self.pay(self.biller, order, {'method': 'percent', 'percent': 30})['invoicing']
                share = round(order.amount_total * 0.3, 2)
                self.assertEqual((block['invoices'][0]['kind'], block['invoices'][0]['amount_total']), ('down_payment', share))
                self.assertEqual(
                    (block['status'], block['amount_drafted'], block['amount_to_invoice']),
                    ('partial', share, round(order.amount_total - share, 2)),
                )
                self.assertTrue(block['can_invoice'] and block['can_down_payment'])
                invoice = self.env['account.move'].browse(block['invoices'][0]['id'])
                self.assertEqual((invoice.state, invoice.amount_total), ('draft', share))
                self.assertEqual(len(invoice.invoice_line_ids.filtered('is_downpayment')), 1)

    def test_a_down_payment_by_amount_is_the_taxed_total_typed(self):
        order = self.confirmed(lines=[self.line(quantity=2)])
        block = self.pay(self.biller, order, {'method': 'amount', 'amount': 57.5})['invoicing']
        self.assertEqual((block['invoices'][0]['kind'], block['invoices'][0]['amount_total']), ('down_payment', 57.5))
        self.assertEqual(block['amount_to_invoice'], round(order.amount_total - 57.5, 2))

    def test_the_final_invoice_deducts_the_down_payments_once_they_are_posted(self):
        order = self.confirmed(lines=[self.line(quantity=2, discount=10)])
        first = self.pay(self.biller, order, {'method': 'percent', 'percent': 30})['invoicing']['invoices'][0]['id']
        second = self.pay(self.biller, order, {'method': 'amount', 'amount': 50})['invoicing']['invoices'][0]['id']
        self.post_invoice(first)
        self.post_invoice(second)
        block = self.shape(self.biller, order)['invoicing']
        self.assertEqual((block['amount_invoiced'], block['amount_to_invoice'], block['status']), (104.0, 76.0, 'partial'))
        final = self.pay(self.biller, order, {'method': 'order'})['invoicing']
        self.assertEqual((final['status'], final['amount_to_invoice'], final['amount_drafted']), ('invoiced', 0.0, 76.0))
        newest = final['invoices'][0]
        self.assertEqual((newest['kind'], newest['amount_total']), ('invoice', 76.0))
        self.assertEqual(sorted(invoice['kind'] for invoice in final['invoices']), ['down_payment', 'down_payment', 'invoice'])
        invoice = self.env['account.move'].browse(newest['id'])
        self.assertEqual(invoice.amount_total, 76.0)
        self.assertEqual(len(invoice.invoice_line_ids.filtered('is_downpayment')), 2)
        self.post_invoice(newest['id'])
        done = self.shape(self.biller, order)['invoicing']
        self.assertEqual((done['amount_invoiced'], done['amount_to_invoice'], done['status']), (order.amount_total, 0.0, 'invoiced'))

    def test_down_payments_that_would_pass_what_is_left_are_refused(self):
        order = self.confirmed(lines=[self.line(quantity=2)])
        self.pay(self.biller, order, {'method': 'percent', 'percent': 60})
        too_much = self.pay(self.biller, order, {'method': 'percent', 'percent': 60}, expect=422)
        self.assertEqual((too_much['code'], too_much['field']), ('invalid', 'percent'))
        self.assertEqual(too_much['details'], {'max_amount': round(order.amount_total * 0.4, 2)})
        by_amount = self.pay(self.biller, order, {'method': 'amount', 'amount': round(order.amount_total * 0.4, 2) + 0.01}, expect=422)
        self.assertEqual((by_amount['code'], by_amount['field']), ('invalid', 'amount'))
        last = self.pay(self.biller, order, {'method': 'amount', 'amount': round(order.amount_total * 0.4, 2)})['invoicing']
        self.assertEqual((last['status'], last['amount_to_invoice']), ('invoiced', 0.0))
        self.assertEqual(self.pay(self.biller, order, {'method': 'percent', 'percent': 1}, expect=422)['code'], 'nothing_to_invoice')

    def test_a_malformed_body_is_refused_before_anything_is_made(self):
        cases = (
            ({}, 'method'), ({'method': 'half'}, 'method'), ({'method': 'percent'}, 'percent'),
            ({'method': 'percent', 'percent': 0}, 'percent'), ({'method': 'percent', 'percent': 0.5}, 'percent'),
            ({'method': 'percent', 'percent': 100.5}, 'percent'), ({'method': 'percent', 'percent': -5}, 'percent'),
            ({'method': 'percent', 'percent': '30'}, 'percent'), ({'method': 'percent', 'percent': True}, 'percent'),
            ({'method': 'amount'}, 'amount'), ({'method': 'amount', 'amount': 0}, 'amount'),
            ({'method': 'amount', 'amount': -1}, 'amount'), ({'method': 'amount', 'amount': '9'}, 'amount'),
            ({'method': 'amount', 'amount': 10**13}, 'amount'), ({'method': 'amount', 'amount': 0.001}, 'amount'),
            ({'method': 'order', 'percent': 10}, 'percent'), ({'method': 'percent', 'percent': 10, 'amount': 5}, 'amount'),
            ({'method': 'order', 'extra': 1}, 'extra'),
        )
        order = self.confirmed(lines=[self.line(quantity=2)])
        for body, field in cases:
            with self.subTest(body=body):
                response = self.pay(self.biller, order, body, expect=422)
                self.assertEqual((response['code'], response['field']), ('invalid', field))
        self.assertFalse(self.env['sale.order'].browse(order.id).invoice_ids)
        edge = self.pay(self.biller, order, {'method': 'percent', 'percent': 1})['invoicing']
        self.assertEqual(edge['invoices'][0]['amount_total'], round(order.amount_total * 0.01, 2))
        full = self.confirmed(lines=[self.line(quantity=1)])
        self.assertEqual(self.pay(self.biller, full, {'method': 'percent', 'percent': 100})['invoicing']['status'], 'invoiced')

    def test_the_setting_that_refuses_down_payments_leaves_the_whole_order(self):
        self.env['liwan.sales.settings']._liwan_current().invoice_down_payment = 'refuse'
        order = self.confirmed()
        shape = self.shape(self.biller, order)['invoicing']
        self.assertEqual((shape['can_invoice'], shape['can_down_payment']), (True, False))
        for body in ({'method': 'percent', 'percent': 30}, {'method': 'amount', 'amount': 10}):
            with self.subTest(body=body):
                response = self.pay(self.biller, order, body, expect=422)
                self.assertEqual((response['code'], response['field']), ('down_payment_refused', 'method'))
        self.assertEqual(self.pay(self.biller, order, {'method': 'order'})['invoicing']['status'], 'invoiced')

    def test_a_cancelled_draft_down_payment_gives_its_amount_back(self):
        order = self.confirmed(lines=[self.line(quantity=2)])
        draft = self.pay(self.biller, order, {'method': 'percent', 'percent': 50})['invoicing']
        self.assertEqual(draft['amount_to_invoice'], round(order.amount_total / 2, 2))
        self.env['account.move'].browse(draft['invoices'][0]['id']).button_cancel()
        block = self.shape(self.biller, order)['invoicing']
        self.assertEqual(
            (block['status'], block['amount_drafted'], block['amount_to_invoice'], block['invoices'][0]['state']),
            ('to_invoice', 0.0, order.amount_total, 'cancel'),
        )
        self.assertEqual(self.pay(self.biller, order, {'method': 'order'})['invoicing']['status'], 'invoiced')

    def test_a_branch_session_makes_down_payments_and_the_final_invoice_with_the_root_tax(self):
        order = self.confirmed(user=self.branch_biller, company=self.fin_branch, lines=[self.line(quantity=2)])
        self.assertEqual(order.order_line.tax_ids, self.vat)
        first = self.pay(self.branch_biller, order, {'method': 'percent', 'percent': 40})['invoicing']
        self.assertEqual((first['invoices'][0]['amount_total'], first['amount_to_invoice']), (80.0, 120.0))
        down = self.env['account.move'].browse(first['invoices'][0]['id'])
        self.assertEqual((down.company_id, down.invoice_line_ids.tax_ids), (self.fin_branch, self.vat))
        self.pay(self.branch_biller, order, {'method': 'amount', 'amount': 20})
        final = self.pay(self.branch_biller, order, {'method': 'order'})['invoicing']
        self.assertEqual((final['status'], final['invoices'][0]['kind'], final['invoices'][0]['amount_total']), ('invoiced', 'invoice', 100.0))

    def test_a_member_of_sales_and_finance_without_project_access_still_invoices(self):
        if 'project.project' in self.env:
            self.assertFalse(self.env['project.project'].with_user(self.biller).has_access('read'))
        order = self.confirmed(lines=[self.line(quantity=1)])
        self.assertEqual(self.pay(self.biller, order, {'method': 'order'})['invoicing']['status'], 'invoiced')
