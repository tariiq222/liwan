# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError, UserError

ONLINE_PAYMENTS = (('none', 'No online payment'), ('full', 'Full price'), ('deposit', 'Deposit'))
# Inclusive bounds of a deposit, in percent of the price; the CHECK and the API parser read them.
DEPOSIT_RANGE = (1, 99)
DEFAULT_DEPOSIT_PERCENT = 30
MANAGE_CAPABILITY = 'appointments.bookings.manage'
PAYMENTS_FEATURE = 'payments.enabled'


class PriceRequired(UserError):
    """A booking type was asked to take online payment before it has a price."""


class ResourceBookingType(models.Model):
    _inherit = 'resource.booking.type'

    # Whether a booking of this type is paid online before it is confirmed: not at all, in full, or a
    # deposit of ``webvue_deposit_percent`` of the price. The price is the list price of the type's product.
    webvue_online_payment = fields.Selection(ONLINE_PAYMENTS, required=True, default='none')
    webvue_deposit_percent = fields.Integer(required=True, default=DEFAULT_DEPOSIT_PERCENT)

    _webvue_deposit_range = models.Constraint(
        'CHECK(webvue_deposit_percent BETWEEN %d AND %d)' % DEPOSIT_RANGE,
        'webvue_deposit_percent must be between %d and %d' % DEPOSIT_RANGE,
    )

    def write(self, vals):
        result = super().write(vals)
        if 'name' in vals:
            for booking_type in self:
                # The product is named after its type: order lines and invoices carry the type's current name.
                booking_type._webvue_product().sudo().write({'name': booking_type.name})
        return result

    def _webvue_product(self):
        """The product that sells this type (OCA ``product.template.resource_booking_type_id``), or an empty one."""
        self.ensure_one()
        return self.env['product.product'].with_context(active_test=False).search(
            [('resource_booking_type_id', '=', self.id)], limit=1,
        )

    def _webvue_takes_payment(self):
        """Whether a new booking of this type is held by an online order now.

        A tenant without online payments (``payments.enabled`` off) takes every booking without
        one, to be paid later or on site, instead of holding slots that nobody can pay.
        """
        self.ensure_one()
        return self.webvue_online_payment != 'none' and self.env['webvue.entitlement.service']._webvue_feature_write(PAYMENTS_FEATURE)

    def _webvue_prepayment_percent(self):
        """The share of the price a booking's order asks to be paid online before it is confirmed."""
        self.ensure_one()
        return 1.0 if self.webvue_online_payment == 'full' else self.webvue_deposit_percent / 100

    def _webvue_set_payment(self, online_payment=None, deposit_percent=None, price=None, refund_rules=None):
        """Change how this type is paid online; ``price`` sets the list price of its product, created on first use,
        and ``refund_rules`` the refund rules of that product (``webvue.payments.service._webvue_set_refund_rules``).

        :raise PriceRequired: when the type would take online payment, or get refund rules, without a price.
        """
        self.ensure_one()
        if not self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, MANAGE_CAPABILITY, company=self.company_id,
        ):
            raise AccessError(self.env._('forbidden'))
        product = self._webvue_product()
        mode = online_payment or self.webvue_online_payment
        if price is not None:
            product = self._webvue_price_product(product, price)
        elif mode != 'none' and not product:
            raise PriceRequired(self.env._("Set the price of this booking type before it takes online payment."))
        if refund_rules:
            if not product:
                raise PriceRequired(self.env._("Set the price of this booking type before its refund rules."))
            self.env['webvue.payments.service']._webvue_set_refund_rules(product, **refund_rules)
        values = {'webvue_online_payment': mode}
        if deposit_percent is not None:
            values['webvue_deposit_percent'] = deposit_percent
        self.write(values)
        return product

    def _webvue_price_product(self, product, price):
        """Set the price of this type's own product, creating it named after the type when it has none.

        Appointments managers hold no product rights: the product is elevated to be written, and only
        its price is theirs to choose; it is returned unelevated.
        """
        Product = self.env['product.product']
        if product:
            product.sudo().write({'list_price': price, 'active': True})
            return product
        created = Product.sudo().create({
            'name': self.name,
            'type': 'service',
            'list_price': price,
            'company_id': self.company_id.id,
            'sale_ok': True,
            'purchase_ok': False,
            'resource_booking_type_id': self.id,
        })
        return Product.browse(created.id)
