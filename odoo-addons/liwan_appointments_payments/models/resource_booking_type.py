# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError, UserError

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

ONLINE_PAYMENTS = (('none', 'No online payment'), ('full', 'Full price'), ('deposit', 'Deposit'))
# Inclusive bounds of a deposit, in percent of the price; the CHECK and the API parser read them.
DEPOSIT_RANGE = (1, 99)
DEFAULT_DEPOSIT_PERCENT = 30
MANAGE_CAPABILITY = 'appointments.bookings.manage'
PAYMENTS_FEATURE = 'payments.enabled'


def _refuse_product(code, status, message):
    """The structured refusal of a product that cannot sell the booking type (``api_handler`` answers ``status``)."""
    raise LiwanAccessRule(code, message, field='product_id', status=status)


class PriceRequired(UserError):
    """A booking type was asked to take online payment before it has a price."""


class ResourceBookingType(models.Model):
    _inherit = 'resource.booking.type'

    # Whether a booking of this type is paid online before it is confirmed: not at all, in full, or a
    # deposit of ``liwan_deposit_percent`` of the price. The price is the list price of the type's product.
    liwan_online_payment = fields.Selection(ONLINE_PAYMENTS, required=True, default='none')
    liwan_deposit_percent = fields.Integer(required=True, default=DEFAULT_DEPOSIT_PERCENT)

    _liwan_deposit_range = models.Constraint(
        'CHECK(liwan_deposit_percent BETWEEN %d AND %d)' % DEPOSIT_RANGE,
        'liwan_deposit_percent must be between %d and %d' % DEPOSIT_RANGE,
    )

    def _liwan_product(self):
        """The product that sells this type (OCA ``product.template.resource_booking_type_id``), or an empty one."""
        self.ensure_one()
        return self.env['product.product'].with_context(active_test=False).search(
            [('resource_booking_type_id', '=', self.id)], limit=1,
        )

    def _liwan_takes_payment(self):
        """Whether a new booking of this type is held by an online order now.

        A tenant without online payments (``payments.enabled`` off) takes every booking without
        one, to be paid later or on site, instead of holding slots that nobody can pay.
        """
        self.ensure_one()
        return self.liwan_online_payment != 'none' and self.env['liwan.entitlement.service']._liwan_feature_write(PAYMENTS_FEATURE)

    def _liwan_prepayment_percent(self):
        """The share of the price a booking's order asks to be paid online before it is confirmed."""
        self.ensure_one()
        return 1.0 if self.liwan_online_payment == 'full' else self.liwan_deposit_percent / 100

    def _liwan_set_payment(self, online_payment=None, deposit_percent=None, price=None, refund_rules=None, product_id=None):
        """Change how this type is paid online. ``product_id`` links an existing service product (a
        ``product.template`` of ``liwan.products.service``) as the product that sells it; ``price`` sets that
        product's list price, a product created through the service on first use; ``refund_rules`` are the refund
        rules of the product (``liwan.payments.service._liwan_set_refund_rules``).

        The product is picked, created and priced through ``liwan.products.service`` as the caller, who needs its
        capabilities (``products.manage``, ``products.prices.manage``) and, for a shared product, the root company.

        :raise PriceRequired: when the type would take online payment, or get refund rules, without a product.
        """
        self.ensure_one()
        if not self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, MANAGE_CAPABILITY, company=self.company_id,
        ):
            raise AccessError(self.env._('forbidden'))
        product = self._liwan_product()
        if product_id is not None:
            product = self._liwan_link_product(product, product_id)
        mode = online_payment or self.liwan_online_payment
        if price is not None:
            product = self._liwan_price_product(product, price)
        elif mode != 'none' and not product:
            raise PriceRequired(self.env._("Set the price of this booking type before it takes online payment."))
        if refund_rules:
            if not product:
                raise PriceRequired(self.env._("Set the price of this booking type before its refund rules."))
            self.env['liwan.payments.service']._liwan_set_refund_rules(product, **refund_rules)
        values = {'liwan_online_payment': mode}
        if deposit_percent is not None:
            values['liwan_deposit_percent'] = deposit_percent
        self.write(values)
        return product

    def _liwan_link_product(self, current, product_id):
        """Make the service product ``product_id`` the one that sells this type, and return its variant.

        :raise LiwanAccessRule: 404 for a product the caller cannot pick (an archived one too), 422 for a product that
            is not a service, 409 when the product sells another type or this type is sold by another product (an
            unpaid order of the type would lose its booking if the link moved).
        """
        service = self.env['liwan.products.service']
        picked = service._liwan_pick_product(product_id)
        if picked.type != 'service':
            _refuse_product('invalid', 422, 'only a service can sell a booking type')
        if picked.resource_booking_type_id and picked.resource_booking_type_id != self:
            _refuse_product('conflict', 409, 'this product sells another booking type')
        if current and current.product_tmpl_id != picked:
            _refuse_product('conflict', 409, 'this booking type is sold by another product')
        # The link is this bridge's own field, not part of the product's definition: the caller writes it after the
        # service confirms that they may write this product (capability and company, plan D23).
        service._liwan_require_write(picked.company_id, {'resource_booking_type_id': self.id})
        picked.write({'resource_booking_type_id': self.id})
        return picked.product_variant_id

    def _liwan_price_product(self, product, price):
        """Set the list price of this type's product through the service; a type with none gets a new service
        product named after it, linked to the type.

        The caller needs ``products.prices.manage`` (and ``products.manage`` to create the product).
        """
        service = self.env['liwan.products.service']
        if product:
            template = service._liwan_product(product.product_tmpl_id.id, include_archived=True)
            service._liwan_update(template, {'list_price': price})
            return product
        created = service._liwan_create({'name': self.name, 'type': 'service', 'list_price': price})
        return self._liwan_link_product(product, created.id)
