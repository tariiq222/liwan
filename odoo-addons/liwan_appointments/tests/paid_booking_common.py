# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, timedelta

from odoo import Command, fields

from odoo.addons.liwan_appointments.tests.common import LiwanAppointmentsCase
from odoo.addons.liwan_payments.tests.common import LiwanOrderCase


class LiwanPaidBookingCase(LiwanOrderCase, LiwanAppointmentsCase):
    """Appointments users and a live gateway, plus a type paid in full online at 115 SAR."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.paid_type = cls.env['resource.booking.type'].create({
            'name': 'Paid consultation', 'duration': 0.5,
            'combination_rel_ids': [Command.create({'combination_id': cls.combination.id})],
        })
        cls.paid_type.with_user(cls.manager)._liwan_set_payment(online_payment='full', price=115.0)
        cls.price_in_sar(cls.paid_type)

    @classmethod
    def price_in_sar(cls, booking_type):
        """Sell the type's product at its list price in the customer's SAR price list."""
        product = booking_type._liwan_product()
        cls.customer.property_product_pricelist.item_ids = [Command.create({
            'applied_on': '0_product_variant', 'product_id': product.id,
            'compute_price': 'fixed', 'fixed_price': product.list_price,
        })]

    def book(self, booking_type=None, scheduled=True, user=None):
        """A booking of the customer made by the booker (no sales rights), on the first free slot when ``scheduled``."""
        booking = self.env['resource.booking'].with_user(user or self.booker).with_context(
            mail_auto_subscribe_no_notify=True,
        ).create({
            'type_id': (booking_type or self.paid_type).id,
            'combination_id': self.combination.id,
            'partner_ids': [Command.set(self.customer.ids)],
        })
        if scheduled:
            self.schedule(booking)
        return booking

    def schedule(self, booking):
        """Put ``booking`` on its first free slot and confirm it when scheduling confirms, as the schedule route does."""
        now = fields.Datetime.context_timestamp(booking, fields.Datetime.now())
        slots = booking._get_available_slots(now, now + timedelta(days=14))
        first = min(start for day in slots.values() for start in day)
        booking.start = first.astimezone(UTC).replace(tzinfo=None)
        if booking._liwan_confirms_on_schedule():
            booking.action_confirm()
        return booking

    def order_of(self, booking):
        return self.env['sale.order'].browse(booking.sudo().sale_order_line_id.order_id.id)
