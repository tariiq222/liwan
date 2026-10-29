# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import UserError
from odoo.fields import Domain

from .constants import MAX_CART_QUANTITY, PAY_BUTTON_TEXT

PAY_PATH_PREFIX = '/pay/order/'
ORDER_STATES = [('cart', 'Cart'), ('ordered', 'Ordered'), ('dismissed', 'Dismissed')]
PRICE_TOLERANCE = 0.005
UNREAD = object()
NOTE_PAID = 'تم دفع الطلب %s'
NOTE_CANCELLED = 'أُلغي الطلب %s'
NOTE_EXPIRED = 'أُلغي الطلب %s: انتهت مهلة الدفع'


class OrderLocked(UserError):
    """The order is no longer a cart that can be edited or dismissed."""


class WindowClosed(UserError):
    """The 24-hour reply window is closed and no approved template was given for the pay link."""


class OrderLinesInvalid(UserError):
    """A line of the cart is not a product of the catalog, or an item is not of this conversation's catalog."""


class PayTemplateInvalid(UserError):
    """The template given for the pay link cannot carry it."""


class WebVueInboxOrder(models.Model):
    """A customer's cart (or an order an agent builds) and, once ordered, the online order it became."""
    _name = 'webvue.inbox.order'
    _description = 'Customer Inbox order'
    _order = 'id desc'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    conversation_id = fields.Many2one('webvue.inbox.conversation', required=True, index=True, ondelete='cascade')
    # The customer's cart message; empty for an order an agent built.
    message_id = fields.Many2one('webvue.inbox.message', ondelete='set null')
    catalog_id = fields.Many2one('webvue.inbox.catalog', ondelete='set null')
    state = fields.Selection(ORDER_STATES, required=True, default='cart', index=True)
    cart_total = fields.Float(digits=(16, 2))
    cart_currency = fields.Char(size=3)
    line_ids = fields.One2many('webvue.inbox.order.line', 'order_id')
    pay_message_id = fields.Many2one('webvue.inbox.message', ondelete='set null')
    pay_link_sent_at = fields.Datetime()
    created_by_id = fields.Many2one('res.users', ondelete='set null')
    # The number of the online order (its stock name never changes); the agents hold no right on sale orders.
    reference = fields.Char()

    _message_unique = models.UniqueIndex('(message_id) WHERE message_id IS NOT NULL', 'A cart message makes one order.')

    # reading

    def _webvue_sale_orders(self):
        """The online order made from this order, unelevated (the payments service reads its facts)."""
        self.ensure_one()
        return self.env['webvue.payments.service']._webvue_orders_of(self.line_ids.sale_order_line_id)

    def _webvue_payment(self):
        """The payment facts of the online order, or None while it is a cart."""
        self.ensure_one()
        sale_order = self._webvue_sale_orders()
        return self.env['webvue.payments.service']._webvue_summary(sale_order) if sale_order else None

    def _webvue_payment_status(self):
        payment = self._webvue_payment()
        return payment['status'] if payment else None

    def _webvue_total(self, payment=UNREAD):
        """The total at today's prices (the online order's own total once there is one); unknown lines count nothing.

        `payment` is the already read payment facts of this order, so a caller that needs several values reads them once.
        """
        self.ensure_one()
        payment = self._webvue_payment() if payment is UNREAD else payment
        if payment:
            return payment['amount_total']
        return sum(line.quantity * (line._webvue_unit_price() or 0.0) for line in self.line_ids)

    def _webvue_currency(self):
        self.ensure_one()
        return self.catalog_id.company_id.currency_id.name or self.company_id.currency_id.name

    def _webvue_price_changed(self, payment=UNREAD):
        self.ensure_one()
        return bool(self.message_id) and abs(self._webvue_total(payment) - self.cart_total) > PRICE_TOLERANCE

    # making a cart

    @api.model
    def _webvue_from_cart(self, message):
        """The cart in `message` as an order of its conversation; lines are matched to the channel catalog's items."""
        conversation = message.conversation_id
        catalog = conversation.channel_id._webvue_catalog().filtered(lambda found: found.meta_catalog_id == message.catalog_id)
        items = {item.retailer_id: item for item in catalog.item_ids if item._webvue_orderable()}
        cart_lines = message.order_line_ids
        return self.create({
            'company_id': conversation.company_id.id, 'conversation_id': conversation.id, 'message_id': message.id,
            'catalog_id': catalog.id, 'cart_currency': cart_lines[:1].currency,
            'cart_total': sum(line.quantity * line.item_price for line in cart_lines),
            'line_ids': [(0, 0, {
                'sequence': line.sequence, 'retailer_id': line.retailer_id,
                'catalog_item_id': items[line.retailer_id].id if line.retailer_id in items else False,
                'product_id': items[line.retailer_id].product_id.id if line.retailer_id in items else False,
                'quantity': min(line.quantity, MAX_CART_QUANTITY), 'cart_price': line.item_price, 'currency': line.currency,
            }) for line in cart_lines],
        })

    @api.model
    def _webvue_line_values(self, conversation, entries):
        """Line commands for `entries` ([(catalog item id, quantity)]); every item must be of the conversation's catalog."""
        catalog = conversation.channel_id._webvue_catalog()
        items = self.env['webvue.inbox.catalog.item'].search([('id', 'in', [item_id for item_id, _quantity in entries])])
        if (
            not catalog or items.catalog_id != catalog or len(items) != len({item_id for item_id, _quantity in entries})
            or not all(item._webvue_orderable() for item in items)
        ):
            raise OrderLinesInvalid(self.env._('Every item must be a listed, not rejected item of this conversation\'s catalog.'))
        by_id = {item.id: item for item in items}
        return [(0, 0, {
            'retailer_id': by_id[item_id].retailer_id, 'catalog_item_id': item_id, 'product_id': by_id[item_id].product_id.id,
            'quantity': quantity, 'currency': catalog.company_id.currency_id.name,
        }) for item_id, quantity in entries]

    @api.model
    def _webvue_create_for(self, conversation, entries):
        """An order an agent builds for the customer."""
        order = self.create({
            'company_id': conversation.company_id.id, 'conversation_id': conversation.id,
            'catalog_id': conversation.channel_id._webvue_catalog().id, 'created_by_id': self.env.user.id,
            'line_ids': self._webvue_line_values(conversation, entries),
        })
        order.conversation_id._webvue_notify_bus()
        return order

    def _webvue_require_cart(self):
        if self.state != 'cart':
            raise OrderLocked(self.env._('Only a cart can be changed.'))

    def _webvue_set_lines(self, existing, added):
        """Keep the lines `existing` ({line id: quantity}) and add `added` ([(catalog item id, quantity)]); drop the others."""
        self.ensure_one()
        self._webvue_require_cart()
        by_id = self.line_ids.filtered(lambda line: line.id in existing)
        if len(by_id) != len(existing):
            raise OrderLinesInvalid(self.env._('A line does not belong to this order.'))
        commands = [(2, line.id) for line in self.line_ids - by_id]
        commands += [(1, line.id, {'quantity': existing[line.id]}) for line in by_id]
        commands += self._webvue_line_values(self.conversation_id, added)
        self.write({'line_ids': commands})
        self.conversation_id._webvue_notify_bus()

    # dismissing and cancelling

    def _webvue_cancel(self):
        """A cart is dismissed; an ordered order is cancelled, which stops its pay link and makes a paid amount refundable."""
        self.ensure_one()
        if self.state == 'dismissed':
            raise OrderLocked(self.env._('The order is already dismissed.'))
        if self.state == 'cart':
            self.state = 'dismissed'
        else:
            service = self.env['webvue.payments.service']
            service._webvue_request_cancel(self._webvue_sale_orders())
        self.conversation_id._webvue_notify_bus()

    # checkout

    def _webvue_place(self):
        """Make the online order of a cart: every line needs a catalog product; prices come from Odoo, not from the cart."""
        self.ensure_one()
        self._webvue_require_cart()
        unknown = self.line_ids.filtered(lambda line: not line.product_id or not line.catalog_item_id._webvue_orderable())
        if unknown:
            raise OrderLinesInvalid(self.env._('Remove the products that are not in the catalog: %(ids)s', ids=', '.join(unknown.mapped('retailer_id'))))
        service = self.env['webvue.payments.service']
        partner = self.conversation_id.contact_id._webvue_partner()
        sale_order = service._webvue_new_order(self.company_id, partner)
        for line in self.line_ids:
            line.sale_order_line_id = service._webvue_add_line(sale_order, line.product_id, line.quantity).id
        # Agents hold no right on sale orders: the number comes with the service's order row.
        self.write({'state': 'ordered', 'reference': service._webvue_order_row(sale_order)['number']})

    def _webvue_summary_text(self):
        return f'طلبك جاهز للدفع: {len(self.line_ids)} منتج، الإجمالي {self._webvue_total():.2f} {self._webvue_currency()}'

    def _webvue_checkout(self, template=None, body=None):
        """Create the online order once and send its pay link: a link button inside the window, or an approved template.

        :return: the queued message.
        :raise OrderLocked: a dismissed order cannot be paid.
        :raise WindowClosed: the window is closed and no template was given.
        """
        self.ensure_one()
        conversation = self.conversation_id
        if self.state == 'dismissed':
            raise OrderLocked(self.env._('The order was dismissed.'))
        window_open = bool(conversation.reply_window_ends_at and fields.Datetime.now() <= conversation.reply_window_ends_at)
        if not window_open and not template:
            raise WindowClosed(self.env._('The 24-hour reply window is closed; send the pay link in an approved template.'))
        if self.state == 'cart':
            self._webvue_place()
        path = self.env['webvue.payments.service']._webvue_payment_path(self._webvue_sale_orders())
        Message = self.env['webvue.inbox.message']
        if window_open:
            message = Message._webvue_queue_free_form(conversation, {
                'kind': 'interactive', 'interactive_type': 'cta_url', 'body': body or self._webvue_summary_text(),
                'cta_display_text': PAY_BUTTON_TEXT, 'cta_url': f'{self.get_base_url()}{path}',
            })
        else:
            message = Message._webvue_queue_template(
                conversation, template, button_params=[self._webvue_pay_button(template, path)],
            )
        self.write({'pay_message_id': message.id, 'pay_link_sent_at': fields.Datetime.now()})
        conversation._webvue_notify_bus()
        return message

    def _webvue_pay_button(self, template, path):
        """(button index, link suffix) of the template's one link button, which must end the pay address with a variable."""
        buttons = template.button_ids.filtered(lambda button: button.kind == 'url' and (button.url or '').endswith('{{1}}'))
        needs = template._webvue_button_needs()
        prefix = f'{self.get_base_url()}{PAY_PATH_PREFIX}'
        valid = (
            template.channel_id == self.conversation_id.channel_id and template.param_count == 0
            and len(buttons) == 1 and len(needs) == 1 and path.startswith(PAY_PATH_PREFIX)
            and buttons.url[:-len('{{1}}')] == prefix
        )
        if not valid:
            raise PayTemplateInvalid(self.env._(
                'The template needs one link button ending %(prefix)s{{1}}, and no other variable.', prefix=prefix,
            ))
        return buttons.sequence, path[len(PAY_PATH_PREFIX):]

    # visibility

    @api.model
    def _webvue_visible_domain(self):
        """The orders of the conversations the caller may see."""
        return Domain('conversation_id', 'any', self.env['webvue.inbox.conversation']._webvue_visible_domain())

    # payment events (called by the sale order overrides)

    def _webvue_elevated(self):
        """This order in an elevated environment, for the conversation writes of a payment event.

        Stock runs the events under payment post-processing or the expiry cron, whoever pays or waits, and that
        caller holds no right on inbox messages. Only the note and the automated reply are written through it.
        """
        return self.sudo()

    def _webvue_on_paid(self):
        """The online order was paid: tell the agents, and the customer when the window is open."""
        self.ensure_one()
        order = self._webvue_elevated()
        conversation, channel = order.conversation_id, order.conversation_id.channel_id
        Message = order.env['webvue.inbox.message']
        Message._webvue_post_system_note(conversation, NOTE_PAID % order.reference)
        window_open = conversation.reply_window_ends_at and fields.Datetime.now() <= conversation.reply_window_ends_at
        if channel.paid_notice_enabled and channel.paid_notice_text and window_open:
            try:
                with order.env.cr.savepoint():
                    Message._webvue_queue_automated(conversation, {
                        'kind': 'text', 'body': channel.paid_notice_text.replace('{reference}', order.reference or ''),
                    })
            except UserError:
                pass  # the channel is disabled, the conversation closed or the monthly limit reached: the note stands
        conversation._webvue_notify_bus()

    def _webvue_on_cancelled(self, expired):
        self.ensure_one()
        order = self._webvue_elevated()
        note = NOTE_EXPIRED if expired else NOTE_CANCELLED
        order.env['webvue.inbox.message']._webvue_post_system_note(order.conversation_id, note % order.reference)
        order.conversation_id._webvue_notify_bus()
