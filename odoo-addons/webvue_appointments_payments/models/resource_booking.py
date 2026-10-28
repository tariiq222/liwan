# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import UserError


class ResourceBooking(models.Model):
    _inherit = 'resource.booking'

    @api.model_create_multi
    def create(self, vals_list):
        bookings = super().create(vals_list)
        # A booking the engine created for a sold order line already has its order.
        bookings.filtered(lambda booking: not booking.sale_order_line_id and booking.type_id._webvue_takes_payment())._webvue_open_orders()
        return bookings

    def write(self, vals):
        if 'type_id' in vals and any(
            booking.sale_order_line_id and booking.type_id.id != vals['type_id'] for booking in self
        ):
            raise UserError(self.env._("A booking held by an online order keeps its type."))
        return super().write(vals)

    def action_cancel(self):
        """Cancel the online order of each booking too: its pay link stops, and money already paid is due back."""
        result = super().action_cancel()
        lines = self.sale_order_line_id
        if lines:
            service = self.env['webvue.payments.service']
            service._webvue_request_cancel(service._webvue_orders_of(lines))
        return result

    def _webvue_confirms_on_schedule(self):
        # Payment is the requester's confirmation: a paying booking accepts its attendance when it is
        # scheduled, and the engine keeps it `scheduled` until its order is paid, then `confirmed`.
        return self.type_id._webvue_takes_payment() or super()._webvue_confirms_on_schedule()

    def _webvue_open_orders(self):
        """Hold each booking with a new online order for its type's product, paid to the type's terms."""
        service = self.env['webvue.payments.service']
        for booking in self:
            booking_type = booking.type_id
            product = booking_type._webvue_product()
            requester = booking.partner_ids[:1]
            if not product or not requester:
                raise UserError(self.env._("A booking of a paying type needs a priced type and a requester."))
            order = service._webvue_new_order(booking_type.company_id, requester, booking_type._webvue_prepayment_percent())
            booking.sale_order_line_id = service._webvue_add_line(order, product)

    def _webvue_payment(self):
        """The payment facts of this booking's online order, or None for a booking without one."""
        self.ensure_one()
        if not self.sale_order_line_id:
            return None
        service = self.env['webvue.payments.service']
        return service._webvue_summary(service._webvue_orders_of(self.sale_order_line_id))
