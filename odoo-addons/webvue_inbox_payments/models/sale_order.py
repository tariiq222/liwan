# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def _action_confirm(self):
        """A paid online order that came from a WhatsApp cart tells the conversation (a note, the bus and the paid notice)."""
        result = super()._action_confirm()
        for order in self._webvue_inbox_orders():
            order._webvue_on_paid()
        return result

    def _action_cancel(self):
        """A cancelled online order of a WhatsApp cart says so in the conversation: expired unpaid, or cancelled by an agent."""
        open_orders = self.filtered(lambda sale_order: sale_order.state != 'cancel')
        expired = {sale_order.name for sale_order in open_orders if sale_order._webvue_past_deadline()}
        orders = open_orders._webvue_inbox_orders()
        result = super()._action_cancel()
        for order in orders:
            order._webvue_on_cancelled(order.reference in expired)
        return result

    def _webvue_inbox_orders(self):
        """The inbox orders made from these sale orders.

        Runs under stock payment post-processing or the expiry cron, whoever confirms or cancels the sale order.
        Only the lookup of ids is elevated, because the caller may hold no right on inbox order lines; the orders
        are browsed back in the caller's environment, and their conversation writes elevate themselves.
        """
        lines = self.env['webvue.inbox.order.line'].sudo().search([('sale_order_line_id', 'in', self.order_line.ids)])
        return self.env['webvue.inbox.order'].browse(lines.order_id.ids)
