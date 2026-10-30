# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import LiwanPaidBookingCase
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_appointments_payments.serializers.booking_payment import (
    parse_type_payment,
)

TYPE_PAYMENT_KEYS = {
    'online_payment', 'deposit_percent', 'price', 'currency', 'refund_policy', 'refund_amounts', 'refund_tiers',
}
BOOKING_PAYMENT_KEYS = {
    'status', 'needs_attention', 'currency', 'amount_total', 'amount_due', 'amount_received', 'amount_to_refund', 'expires_at',
}
BOOKINGS = '/api/v1/appointments/bookings'
PUBLIC_BOOKINGS = '/api/v1/public/appointments/bookings'


@tagged('post_install', '-at_install', 'liwan')
class TestBookingPaymentRoutes(LiwanPaidBookingCase):
    """Staff set how a type is paid, read a booking's payment and get its pay link to send to the customer."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The booking routes ask an existing requester for the contact fields the company requires.
        cls.customer.phone = '+966500000009'

    def type_url(self, booking_type=None):
        return f'/api/v1/appointments/types/{(booking_type or self.paid_type).id}/payment'

    def booking_url(self, booking, suffix=''):
        return f'/api/v1/appointments/bookings/{booking.id}/payment{suffix}'

    def test_a_manager_prices_a_type_and_chooses_its_online_payment(self):
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')
        body = self.api('GET', self.type_url()).json()
        self.assertEqual(set(body), TYPE_PAYMENT_KEYS)
        self.assertEqual((body['online_payment'], body['price']), ('full', 115.0))
        changed = self.api('PATCH', self.type_url(), json={'online_payment': 'deposit', 'deposit_percent': 25, 'price': 200})
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(
            {key: changed.json()[key] for key in ('online_payment', 'deposit_percent', 'price')},
            {'online_payment': 'deposit', 'deposit_percent': 25, 'price': 200.0},
        )
        unpriced = self.api('PATCH', self.type_url(self.booking_type), json={'online_payment': 'full'})
        self.assertEqual((unpriced.status_code, unpriced.json()['field']), (422, 'price'))
        self.assertEqual(self.api('GET', self.type_url(self.booking_type)).json()['price'], None)
        for payload, field in (
            ({'online_payment': 'later'}, 'online_payment'),
            ({'deposit_percent': 100}, 'deposit_percent'),
            ({'price': 0}, 'price'),
            ({'price': '10'}, 'price'),
            ({'price': 1_000_001}, 'price'),
            ({'product_id': 1}, 'product_id'),
            ({}, 'online_payment'),
        ):
            with self.subTest(field=field):
                response = self.api('PATCH', self.type_url(), json=payload)
                self.assertEqual((response.status_code, response.json()['field']), (422, field))

    def test_a_price_that_is_not_a_real_amount_is_refused(self):
        # An HTTP client cannot even send these (JSON has no NaN or Infinity), but Python's JSON reader accepts them.
        for price in (float('nan'), float('inf')):
            with self.subTest(price=price), self.assertRaises(ApiError):
                parse_type_payment({'price': price})

    def test_only_a_manager_changes_how_a_type_is_paid(self):
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        self.assertEqual(self.api('GET', self.type_url()).status_code, 200)
        self.assertEqual(self.api('PATCH', self.type_url(), json={'online_payment': 'none'}).status_code, 403)
        self.assertEqual(self.paid_type.liwan_online_payment, 'full')

    def test_the_booker_reads_the_payment_and_gets_the_pay_link(self):
        booking = self.book()
        order = self.order_of(booking)
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        payment = self.api('GET', self.booking_url(booking)).json()
        self.assertEqual(set(payment), BOOKING_PAYMENT_KEYS)
        self.assertEqual((payment['status'], payment['amount_due'], payment['currency']), ('payable', order.amount_total, 'SAR'))
        link = self.api('POST', self.booking_url(booking, '/link'), json={})
        self.assertEqual(link.status_code, 200)
        self.assertEqual(link.json(), {'path': f'/pay/order/{order.id}?access_token={order.access_token}'})
        free = self.book(self.booking_type, scheduled=False)
        self.assertEqual(self.api('GET', self.booking_url(free)).json()['status'], 'none')
        refused = self.api('POST', self.booking_url(free, '/link'), json={})
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'not_payable'))

    def test_another_company_booking_and_a_reader_without_write_get_nothing(self):
        booking = self.book()
        _other, _type, _combination, foreign = self._foreign_company_records()
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        for path in (self.booking_url(foreign), self.type_url(foreign.type_id)):
            with self.subTest(path=path):
                self.assertEqual(self.api('GET', path).status_code, 404)
        # A viewer reads only the bookings they make or serve, and never gets a pay link.
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', self.booking_url(booking)).status_code, 404)
        self.assertEqual(self.api('POST', self.booking_url(booking, '/link'), json={}).status_code, 403)

    def test_the_pay_link_and_type_changes_need_online_payments(self):
        booking = self.book()
        set_probe_feature(self, key='payments.enabled', enabled=False)
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')
        self.assertEqual(self.api('POST', self.booking_url(booking, '/link'), json={}).status_code, 403)
        self.assertEqual(self.api('PATCH', self.type_url(), json={'price': 120}).status_code, 403)
        self.assertEqual(self.api('GET', self.booking_url(booking)).status_code, 200)

    def first_slot(self, booking_type=None):
        today = fields.Date.today()
        path = '/api/v1/appointments/types/%d/slots?from=%s&to=%s' % (
            (booking_type or self.paid_type).id, today + timedelta(days=2), today + timedelta(days=9),
        )
        return self.api('GET', path).json()['items'][0]['start']

    def test_a_paid_booking_through_the_booking_routes(self):
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        created = self.api('POST', BOOKINGS, json={
            'type_id': self.paid_type.id, 'requester_id': self.customer.id, 'start': self.first_slot(),
        })
        self.assertEqual((created.status_code, created.json()['state']), (200, 'scheduled'), created.text)
        booking = self.env['resource.booking'].browse(created.json()['id'])
        order = self.order_of(booking)
        self.assertEqual(self.api('GET', self.booking_url(booking)).json()['status'], 'payable')
        self.pay(order, order.amount_total)
        self.assertEqual(self.api('GET', f'{BOOKINGS}/{booking.id}').json()['state'], 'confirmed')
        cancelled = self.api('POST', f'{BOOKINGS}/{booking.id}/cancel', json={})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        payment = self.api('GET', self.booking_url(booking)).json()
        self.assertEqual((order.state, payment['status'], payment['amount_to_refund']), ('cancel', 'cancelled', order.amount_total))

    def test_scheduling_an_invitation_through_the_route_opens_its_order(self):
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        pending = self.api('POST', BOOKINGS, json={'type_id': self.paid_type.id, 'requester_id': self.customer.id})
        self.assertEqual((pending.status_code, pending.json()['state']), (200, 'pending'), pending.text)
        booking_id = pending.json()['id']
        self.assertEqual(self.api('GET', f'{BOOKINGS}/{booking_id}/payment').json()['status'], 'none')
        scheduled = self.api('POST', f'{BOOKINGS}/{booking_id}/schedule', json={'start': self.first_slot()})
        self.assertEqual((scheduled.status_code, scheduled.json()['state']), (200, 'scheduled'), scheduled.text)
        self.assertEqual(self.api('GET', f'{BOOKINGS}/{booking_id}/payment').json()['status'], 'payable')

    def test_the_invited_customer_schedules_pays_and_cancels_a_paid_booking(self):
        invitation = self.book(scheduled=False)
        invitation._portal_ensure_token()
        token, path, today = invitation.access_token, f'{PUBLIC_BOOKINGS}/{invitation.id}', fields.Date.today()
        slots = self.api('GET', f'{path}/slots?access_token={token}&from={today + timedelta(days=2)}&to={today + timedelta(days=9)}')
        start = slots.json()['items'][0]['start']
        scheduled = self.api('POST', f'{path}/schedule', json={'access_token': token, 'start': start})
        self.assertEqual((scheduled.status_code, scheduled.json()['state']), (200, 'scheduled'), scheduled.text)
        order = self.order_of(invitation)
        # The anonymous requester opened the order: it is the customer's, and nobody is its salesperson.
        self.assertEqual((order.state, order.partner_id, order.user_id), ('draft', self.customer, self.env['res.users']))
        self.pay(order, order.amount_total)
        self.assertEqual(self.api('GET', f'{path}?access_token={token}').json()['state'], 'confirmed')
        cancelled = self.api('POST', f'{path}/cancel', json={'access_token': token})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertEqual((order.state, order.sudo().liwan_refund_due_amount), ('cancel', order.amount_total))

    def test_a_manager_sets_the_refund_rules_of_a_type(self):
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')
        body = self.api('GET', self.type_url()).json()
        self.assertEqual(
            (body['refund_policy'], body['refund_amounts'], body['refund_tiers']), ('company', 'company', []),
        )
        tiers = [{'notice_hours': 48, 'percent': 100}, {'notice_hours': 24, 'percent': 50}]
        changed = self.api('PATCH', self.type_url(), json={'refund_policy': 'notice', 'refund_amounts': 'any', 'refund_tiers': tiers})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual((changed.json()['refund_policy'], changed.json()['refund_tiers']), ('notice', tiers))
        for payload, field in (
            ({'refund_policy': 'later'}, 'refund_policy'),
            ({'refund_amounts': 'half'}, 'refund_amounts'),
            ({'refund_tiers': [{'notice_hours': 24, 'percent': 101}]}, 'refund_tiers'),
            ({'refund_tiers': [{'notice_hours': 24, 'percent': 50}, {'notice_hours': 24, 'percent': 10}]}, 'refund_tiers'),
            ({'refund_tiers': [{'notice_hours': 1, 'percent': 10}] * 6}, 'refund_tiers'),
            ({'refund_tiers': []}, 'refund_tiers'),
        ):
            with self.subTest(payload=payload):
                response = self.api('PATCH', self.type_url(), json=payload)
                self.assertEqual((response.status_code, response.json()['field']), (422, field))
        unpriced = self.api('PATCH', self.type_url(self.booking_type), json={'refund_policy': 'none'})
        self.assertEqual((unpriced.status_code, unpriced.json()['field']), (422, 'price'))

    def test_the_customer_who_cancels_late_gets_back_what_the_type_allows(self):
        self.paid_type.with_user(self.manager)._liwan_set_payment(refund_rules={
            'refund_policy': 'notice', 'refund_tiers': [{'notice_hours': 1000, 'percent': 100}, {'notice_hours': 0, 'percent': 40}],
        })
        invitation = self.book(scheduled=False)
        invitation._portal_ensure_token()
        token, path, today = invitation.access_token, f'{PUBLIC_BOOKINGS}/{invitation.id}', fields.Date.today()
        slots = self.api('GET', f'{path}/slots?access_token={token}&from={today + timedelta(days=2)}&to={today + timedelta(days=9)}')
        self.api('POST', f'{path}/schedule', json={'access_token': token, 'start': slots.json()['items'][0]['start']})
        order = self.order_of(invitation)
        self.pay(order, order.amount_total)
        cancelled = self.api('POST', f'{path}/cancel', json={'access_token': token})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        # Cancelled two to nine days ahead, under 1000 hours: the 0-hour tier gives 40% of what was paid back.
        refund = order.currency_id.round(order.amount_total * 0.4)
        self.assertEqual((order.state, order.sudo().liwan_refund_due_amount), ('cancel', refund))
        staff = self.book()
        staff_order = self.order_of(staff)
        self.pay(staff_order, staff_order.amount_total)
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        self.assertEqual(self.api('POST', f'{BOOKINGS}/{staff.id}/cancel', json={}).status_code, 200)
        self.assertEqual(staff_order.sudo().liwan_refund_due_amount, staff_order.amount_total)
