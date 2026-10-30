# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import UserError, ValidationError


class ResourceBooking(models.Model):
    _inherit = 'resource.booking'

    @api.model_create_multi
    def create(self, vals_list):
        bookings = super().create(vals_list)
        bookings._liwan_hold_scheduled()
        return bookings

    def write(self, vals):
        if 'type_id' in vals and any(
            booking.sale_order_line_id and booking.type_id.id != vals['type_id'] for booking in self
        ):
            raise UserError(self.env._("A booking held by an online order keeps its type."))
        result = super().write(vals)
        if vals.get('start'):
            self._liwan_hold_scheduled()
        return result

    def _liwan_hold_scheduled(self):
        """Hold each scheduled booking of a paying type that has no order yet with a new online order.

        A booking gets its order once it holds a slot: a pending invitation has nothing to hold, so it
        is not cancelled by an expiry before it is scheduled. A booking the engine created for a sold
        order line already has its order.
        """
        self.filtered(
            lambda booking: booking.start and not booking.sale_order_line_id and booking.type_id._liwan_takes_payment(),
        )._liwan_open_orders()

    def action_cancel(self):
        """Cancel the online order of each booking too: its pay link stops, and money already paid is due back.

        A cancellation from the requester's own page (the public user behind a booking token) is the
        customer's: the refund rules of the type's product keep their share, by the notice before the start.
        Staff cancellations give everything back.
        """
        starts = {booking: booking.start for booking in self}
        result = super().action_cancel()
        service = self.env['liwan.payments.service']
        by_customer = self.env.user._is_public()
        for booking in self.filtered('sale_order_line_id'):
            service._liwan_request_cancel(
                service._liwan_orders_of(booking.sale_order_line_id),
                requested_by_customer=by_customer, service_start=starts[booking],
            )
        return result

    def _liwan_confirms_on_schedule(self):
        # Payment is the requester's confirmation: a booking held by an online order accepts its attendance
        # when it is scheduled, and the engine keeps it `scheduled` until its order is paid, then `confirmed`.
        return bool(self.sale_order_line_id) or super()._liwan_confirms_on_schedule()

    def _liwan_open_orders(self):
        """Hold each booking with a new online order for its type's product, paid to the type's terms."""
        service = self.env['liwan.payments.service']
        for booking in self:
            booking_type = booking.type_id
            product = booking_type._liwan_product()
            if not product:
                raise UserError(self.env._("A booking of a paying type needs a priced type."))
            # The engine schedules a booking only with a requester, so a scheduled one has its first partner.
            requester = booking.partner_ids[:1]
            try:
                order = service._liwan_new_order(booking_type.company_id, requester, booking_type._liwan_prepayment_percent())
                line = service._liwan_add_line(order, product)
            except ValidationError as error:
                # Not a slot conflict: the booking routes answer a ValidationError as "slot not available".
                raise UserError(self.env._("The online order of this booking could not be opened: %s", error)) from error
            booking.sale_order_line_id = line

    def _liwan_payment(self):
        """The payment facts of this booking's online order, or None for a booking without one."""
        self.ensure_one()
        if not self.sale_order_line_id:
            return None
        service = self.env['liwan.payments.service']
        return service._liwan_summary(service._liwan_orders_of(self.sale_order_line_id))
