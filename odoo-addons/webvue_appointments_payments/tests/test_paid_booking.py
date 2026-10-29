# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import WebVuePaidBookingCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_payments.models.order_service import NotPayable


@tagged('post_install', '-at_install', 'webvue')
class TestPaidBooking(WebVuePaidBookingCase):
    """A booking of a paying type is held by an online order, confirmed once paid and released when it expires."""

    def test_a_paying_type_is_priced_by_its_own_product(self):
        product = self.paid_type._webvue_product()
        self.assertEqual(
            (product.name, product.type, product.list_price, product.company_id, product.resource_booking_type_id),
            ('Paid consultation', 'service', 115.0, self.env.company, self.paid_type),
        )
        self.paid_type.with_user(self.manager)._webvue_set_payment(online_payment='deposit', deposit_percent=40, price=150.0)
        self.paid_type.with_user(self.manager).name = 'Long consultation'
        self.assertEqual(self.paid_type._webvue_product(), product)
        self.assertEqual((product.name, product.list_price), ('Long consultation', 150.0))
        self.assertEqual(self.paid_type._webvue_prepayment_percent(), 0.4)
        with self.assertRaises(AccessError):
            self.paid_type.with_user(self.booker)._webvue_set_payment(online_payment='none')
        with self.assertRaises(UserError):
            self.booking_type.with_user(self.manager)._webvue_set_payment(online_payment='full')
        self.assertEqual(self.booking_type.webvue_online_payment, 'none')

    def test_a_paying_booking_stays_scheduled_until_its_order_is_paid(self):
        self.assertFalse(self.booker.has_group('sales_team.group_sale_salesman'))
        booking = self.book()
        order = self.order_of(booking)
        self.assertEqual(booking.state, 'scheduled')
        self.assertEqual(
            (order.partner_id, order.require_payment, order.prepayment_percent, order.order_line.product_id),
            (self.customer, True, 1.0, self.paid_type._webvue_product()),
        )
        self.assertEqual(order.order_line.price_unit, 115.0)
        payment = booking.with_user(self.booker)._webvue_payment()
        self.assertEqual((payment['status'], payment['refund_due'], payment['amount_due']), ('payable', False, order.amount_total))
        self.pay(order, order.amount_total)
        self.assertEqual((order.state, booking.state), ('sale', 'confirmed'))
        self.assertEqual(booking.with_user(self.booker)._webvue_payment()['status'], 'paid')

    def test_the_guest_link_never_asks_to_confirm_a_paying_booking(self):
        """The company asks requesters to confirm, but scheduling already confirmed the paying booking: its order holds
        it, so the requester's page offers no confirmation and the confirm route refuses one."""
        self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, 'requester_confirmation': True})
        self.env.flush_all()
        booking = self.env['resource.booking'].browse(self.book().id)
        booking._portal_ensure_token()
        path = '/api/v1/public/appointments/bookings/%d' % booking.id
        body = self.api('GET', '%s?access_token=%s' % (path, booking.access_token)).json()
        self.assertEqual((body['state'], body['awaits_confirmation']), ('scheduled', False))
        refused = self.api('POST', path + '/confirm', json={'access_token': booking.access_token})
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid'), refused.text)

    def test_a_deposit_confirms_the_booking(self):
        self.paid_type.with_user(self.manager)._webvue_set_payment(online_payment='deposit', deposit_percent=30)
        booking = self.book()
        order = self.order_of(booking)
        deposit = order.currency_id.round(order.amount_total * 0.3)
        self.assertEqual(booking.with_user(self.booker)._webvue_payment()['amount_due'], deposit)
        self.pay(order, deposit)
        self.assertEqual((order.state, booking.state), ('sale', 'confirmed'))

    def test_a_free_type_takes_no_order(self):
        booking = self.book(self.booking_type, scheduled=False)
        self.assertFalse(booking.sale_order_line_id)
        self.assertIsNone(booking._webvue_payment())

    def test_without_online_payments_a_paying_type_books_without_an_order(self):
        set_probe_feature(self, key='payments.enabled', enabled=False)
        booking = self.book()
        self.assertFalse(booking.sale_order_line_id)

    def test_an_invitation_gets_its_order_once_it_is_scheduled(self):
        booking = self.book(scheduled=False)
        self.assertFalse(booking.sale_order_line_id)
        self.schedule(booking)
        order = self.order_of(booking)
        self.assertEqual((order.state, booking.state, booking._webvue_confirms_on_schedule()), ('draft', 'scheduled', True))
        self.pay(order, order.amount_total)
        self.assertEqual(booking.state, 'confirmed')

    def test_an_unpaid_booking_is_released_when_its_order_expires(self):
        booking = self.book()
        order = self.order_of(booking)
        self.assertTrue(booking.meeting_id)
        order.webvue_payment_deadline = fields.Datetime.now() - timedelta(minutes=1)
        self.expire()
        self.assertEqual((order.state, booking.state, booking.active), ('cancel', 'canceled', False))
        self.assertFalse(booking.meeting_id)

    def test_cancelling_a_booking_cancels_its_order_and_link(self):
        booking = self.book()
        order = self.order_of(booking)
        booking.with_user(self.booker).action_cancel()
        self.assertEqual(order.state, 'cancel')
        with self.assertRaises(NotPayable):
            self.env['webvue.payments.service']._webvue_payment_path(order)
        self.assertEqual(booking.with_user(self.booker)._webvue_payment()['status'], 'cancelled')

    def test_a_payment_after_the_booking_is_gone_is_recorded_and_due_back(self):
        booking = self.book()
        order = self.order_of(booking)
        booking.action_cancel()
        tx = self.pay(order, order.amount_total)
        self.assertEqual((tx.state, order.state, booking.state), ('done', 'cancel', 'canceled'))
        payment = booking._webvue_payment()
        self.assertEqual((payment['status'], payment['refund_due']), ('cancelled', True))

    def test_a_booking_held_by_an_order_keeps_its_type(self):
        booking = self.book()
        with self.assertRaises(UserError):
            booking.type_id = self.booking_type
