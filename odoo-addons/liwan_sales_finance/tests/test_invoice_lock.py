# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Two requests for one order never both find room: the order row is locked before any figure is read."""
from unittest.mock import patch

from odoo.exceptions import LockError
from odoo.tests import tagged

from .common import ORDERS, SalesFinanceCase


@tagged('post_install', '-at_install', 'liwan')
class TestInvoiceLock(SalesFinanceCase):

    def test_the_order_is_locked_before_the_figures_are_read(self):
        order = self.confirmed(lines=[self.line(quantity=2)])
        Order = type(self.env['sale.order'])
        calls = []
        locked = Order.lock_for_update
        figures = Order._liwan_invoice_figures

        def lock(records, **kwargs):
            calls.append(('lock', records.ids, kwargs))
            return locked(records, **kwargs)

        def read_figures(records, *args, **kwargs):
            calls.append(('figures', records.ids))
            return figures(records, *args, **kwargs)

        with patch.object(Order, 'lock_for_update', lock), patch.object(Order, '_liwan_invoice_figures', read_figures):
            self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 25})
        names = [call[0] for call in calls]
        self.assertEqual(names[0], 'lock', calls)
        self.assertEqual(calls[0][1:], (order.ids, {'allow_referencing': True}))
        self.assertIn('figures', names)

    def test_a_request_that_finds_the_order_held_is_a_conflict_and_makes_no_invoice(self):
        order = self.confirmed(lines=[self.line(quantity=2)])

        def held(records, **_kwargs):
            message = 'held'
            raise LockError(message)

        with patch.object(type(self.env['sale.order']), 'lock_for_update', held):
            response = self.api_as(self.biller, 'POST', f'{ORDERS}/{order.id}/invoices', {'method': 'order'})
        self.assertEqual((response.status_code, response.json()['code']), (409, 'conflict'), response.text)
        self.assertFalse(self.env['sale.order'].browse(order.id).invoice_ids)

    def test_a_refused_caller_never_takes_the_lock(self):
        self.set_visibility('all')
        order = self.confirmed(user=self.seller)
        with patch.object(type(self.env['sale.order']), 'lock_for_update', side_effect=AssertionError('locked')):
            response = self.api_as(self.biller2, 'POST', f'{ORDERS}/{order.id}/invoices', {'method': 'order'})
        self.assertEqual(response.status_code, 403, response.text)

    def test_the_second_request_after_the_first_finds_what_the_first_took(self):
        order = self.confirmed(lines=[self.line(quantity=2)])
        self.invoice_order(self.biller, order, {'method': 'amount', 'amount': order.amount_total})
        response = self.api_as(self.biller, 'POST', f'{ORDERS}/{order.id}/invoices', {'method': 'amount', 'amount': 1.0})
        self.assertEqual((response.status_code, response.json()['code']), (422, 'nothing_to_invoice'), response.text)
        self.assertEqual(len(self.env['sale.order'].browse(order.id).invoice_ids), 1)
