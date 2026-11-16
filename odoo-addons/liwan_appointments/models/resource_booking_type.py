# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, UserError

from .appointment_settings import DEFAULTS
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
    """The booking type's modification deadline: its own, or the company policy it follows.

    A type either inherits the company's ``modification_deadline_hours`` or carries its own value. Both states are
    explicit and stored (`inherits_company_deadline`, `own_deadline_hours`), so a hand-set deadline is never mistaken
    for an inherited one, and the engine's ``modifications_deadline`` is resolved on every read: a saved company policy
    reaches every inheriting type at once without rewriting a row (issue #551). ``_liwan_resolved_deadlines`` is the
    single resolver, used by the computed field the engine and the booking routes read and by the serializer.
    """

    _inherit = 'resource.booking.type'

    # The engine allows a company-less type, visible to every company; LiwanOS types
    # belong to one company (database-per-tenant still hosts several companies).
    company_id = fields.Many2one(required=True, default=lambda self: self.env.company)
    inherits_company_deadline = fields.Boolean(
        default=True,
        help='The type follows the company modification deadline. Turn this off to give the type its own deadline.',
    )
    own_deadline_hours = fields.Float(
        string='Own modification deadline (hours)',
        help='Hours before the start after which the requester may no longer change the booking. '
             'Used only while the type does not follow the company deadline.',
    )
    # The deadline every rule reads: the engine's overdue and slot searches, the booking routes and the serializers.
    # It is read-only on purpose: the type's state is the pair above, so a write never guesses which one changed.
    modifications_deadline = fields.Float(
        compute='_compute_modifications_deadline', store=False, string='Modification deadline (hours)',
        help='Hours before the start after which the requester may no longer change the booking: the type\'s own '
             'deadline, or the company setting while the type follows it.',
    )

    # Whether a booking of this type is paid online before it is confirmed: not at all, in full, or a
    # deposit of ``liwan_deposit_percent`` of the price. The price is the list price of the type's product.
    liwan_online_payment = fields.Selection(ONLINE_PAYMENTS, required=True, default='none')
    liwan_deposit_percent = fields.Integer(required=True, default=DEFAULT_DEPOSIT_PERCENT)

    _liwan_deposit_range = models.Constraint(
        'CHECK(liwan_deposit_percent BETWEEN %d AND %d)' % DEPOSIT_RANGE,
        'liwan_deposit_percent must be between %d and %d' % DEPOSIT_RANGE,
    )

    @api.depends('inherits_company_deadline', 'own_deadline_hours', 'company_id')
    def _compute_modifications_deadline(self):
        deadlines = self._liwan_resolved_deadlines()
        for booking_type in self:
            booking_type.modifications_deadline = deadlines[booking_type.id]

    def _liwan_resolved_deadlines(self):
        """``{type id: deadline hours}`` for this recordset: the type's own value, or its company's setting.

        One settings search per company, whatever the number of types. The declared default (24 hours) answers while a
        company has saved no settings, and for a type of a company the caller may not read: such a type is hidden by the
        type's own record rule, and the policy of another company is never exposed here.
        """
        policies = {}
        for booking_type in self:
            company = booking_type.company_id
            if company not in policies:
                policies[company] = self._liwan_company_deadline_hours(company)
        return {
            booking_type.id: policies[booking_type.company_id] if booking_type.inherits_company_deadline
            else booking_type.own_deadline_hours
            for booking_type in self
        }

    @api.model
    def _liwan_company_deadline_hours(self, company):
        """The deadline of ``company``'s appointment settings, or the declared default while it saved none.

        The settings are searched in the type's own company. ``company`` is one the caller may work in: a type of any
        other company is hidden by the type's own record rule, so this only ever answers for a company the reader was
        already allowed to see, and the settings record rule plus the Appointments capability decide the rest. Only the
        number is returned, never the settings row.
        """
        if not company or company not in self.env.companies:
            return DEFAULTS['modification_deadline_hours']
        settings = self.env['liwan.appointment.settings'].with_company(company).search(
            [('company_id', '=', company.id)], limit=1,
        )
        return settings.modification_deadline_hours if settings else DEFAULTS['modification_deadline_hours']

    @api.model
    def default_get(self, fields_list):
        defaults = super().default_get(fields_list)
        type_defaults = self.env['liwan.appointment.settings']._liwan_type_defaults()
        for name, value in type_defaults.items():
            if name in fields_list and 'default_' + name not in self.env.context:
                defaults[name] = value
        return defaults

    @api.constrains('company_id')
    def _check_combinations_company(self):
        self.combination_rel_ids._check_type_company()

    def _liwan_combination_commands(self, combinations):
        """The commands that make this type serve exactly ``combinations``, in that order.

        A combination the type already serves keeps its relation row; the rest are created or deleted.
        """
        self.ensure_one()
        by_combination = {rel.combination_id: rel for rel in self.combination_rel_ids}
        commands = [Command.delete(rel.id) for combination, rel in by_combination.items() if combination not in combinations]
        for sequence, combination in enumerate(combinations):
            rel = by_combination.get(combination)
            if rel:
                commands.append(Command.update(rel.id, {'sequence': sequence}))
            else:
                commands.append(Command.create({'combination_id': combination.id, 'sequence': sequence}))
        return commands

    def _liwan_product(self):
        """The product that sells this type (OCA ``product.template.resource_booking_type_id``), or an empty one."""
        self.ensure_one()
        return self.env['product.product'].with_context(active_test=False).search(
            [('resource_booking_type_id', '=', self.id)], limit=1,
        )

    def _liwan_is_priced(self, product):
        """Whether ``product`` (this type's variant, possibly empty) sells the type for money: a product at 0 is as
        good as none, because an order of total 0 never gets paid."""
        return bool(product) and product.list_price > 0

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

        :raise PriceRequired: when the type would take online payment, or get refund rules, without a product priced above 0.
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
        if mode != 'none' and not self._liwan_is_priced(product):
            raise PriceRequired(self.env._("Set the price of this booking type before it takes online payment."))
        if refund_rules:
            if not self._liwan_is_priced(product):
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
        # The link is this application's own field, not part of the product's definition: the caller writes it after the
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
