# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from .access_service import SETTINGS_MANAGE
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

VISIBILITY_MODES = ('own', 'all')
# What the customer may do on the public page of a sent quotation: nothing, accept, or accept with a signature.
ANSWER_MODES = ('none', 'accept', 'accept_and_sign')
# What staff sending again a quotation the customer already answered does: send and clear the answer, or refuse.
RESEND_MODES = ('allow', 'refuse')
# How a customer may sign under ``accept_and_sign``: by hand-drawing only, or by drawing or typing their name.
SIGNATURE_MODES = ('draw', 'draw_or_type')
# How a signature was made.
SIGNATURE_METHODS = ('drawn', 'typed')
PAYMENTS_FEATURE = 'payments.enabled'
# Whether the customer must pay before the quotation becomes an order: not at all, all of it, or a percentage of it.
PAYMENT_MODES = ('off', 'full', 'percent')
MIN_PERCENT = 1
MAX_PERCENT = 100


def payments_open(env):
    """Whether the tenant can take payments now: online payments are included in its plan and its lifecycle allows writes."""
    return env['liwan.entitlement.service']._liwan_feature_write(PAYMENTS_FEATURE)


def _invalid(field, message):
    code = 'invalid'
    raise LiwanAccessRule(code, message, field=field, status=422)


def parse_payment_mode(value):
    if value not in PAYMENT_MODES:
        _invalid('payment_to_confirm', f'payment_to_confirm must be one of {PAYMENT_MODES}')
    return value


def parse_prepayment_percent(value):
    if not isinstance(value, int) or isinstance(value, bool) or not MIN_PERCENT <= value <= MAX_PERCENT:
        _invalid('prepayment_percent', f'prepayment_percent must be an integer from {MIN_PERCENT} to {MAX_PERCENT}')
    return value


class LiwanSalesSettings(models.Model):
    """The tenant's Sales policy: who reads which document, the defaults of a new quotation, what a customer may answer and how they sign.

    One record per tenant database, changed only by a holder of ``sales.settings.manage`` in the working company and
    in the root company. ``revision`` refuses a write based on a stale read.
    """
    _name = 'liwan.sales.settings'
    _description = 'LiwanOS Sales settings'
    # Every branch reads the same policy.
    _liwan_scope = 'tenant'

    # own: a reader sees the documents they own and the unassigned ones; all: every document of the company.
    visibility = fields.Selection([(mode, mode) for mode in VISIBILITY_MODES], required=True, default='own')
    # Days a new quotation stays valid; 0 gives it no validity date.
    validity_days = fields.Integer(required=True, default=30)
    # The highest discount percent a line may carry without sales.discounts.approve; 0 means no limit.
    discount_limit_percent = fields.Integer(required=True, default=0)
    default_terms = fields.Text()
    # Copied onto a quotation when it is sent; a later change leaves a sent quotation as it was.
    customer_answer = fields.Selection([(mode, mode) for mode in ANSWER_MODES], required=True, default='accept')
    # Whether the customer's acceptance confirms the order by itself, or leaves it to staff.
    acceptance_confirms = fields.Boolean(required=True, default=False)
    # Read at send time: whether staff may send again a quotation the customer already answered.
    answered_resend = fields.Selection([(mode, mode) for mode in RESEND_MODES], required=True, default='allow')
    # Copied onto a quotation when it is sent, like ``customer_answer``.
    signature_methods = fields.Selection([(mode, mode) for mode in SIGNATURE_MODES], required=True, default='draw_or_type')
    # The default way a new quotation asks the customer to pay before it becomes an order (off: not at all; full: all of
    # it; percent: ``prepayment_percent`` of it). A new quotation takes these values once; the value kept on each
    # quotation is what counts after that.
    payment_to_confirm = fields.Selection([(mode, mode) for mode in PAYMENT_MODES], required=True, default='off')
    # The share of the total a customer pays under ``percent``.
    prepayment_percent = fields.Integer(required=True, default=50)
    revision = fields.Integer(required=True, default=1)

    _revision_positive = models.Constraint('CHECK(revision > 0)', 'the revision is a positive number')
    _validity_days_range = models.Constraint(
        'CHECK(validity_days >= 0 AND validity_days <= 3650)', 'the validity is between 0 and 3650 days',
    )
    _discount_limit_range = models.Constraint(
        'CHECK(discount_limit_percent >= 0 AND discount_limit_percent <= 100)',
        'the discount limit is a percent between 0 and 100',
    )
    _prepayment_percent_range = models.Constraint(
        f'CHECK(prepayment_percent >= {MIN_PERCENT} AND prepayment_percent <= {MAX_PERCENT})',
        'the prepayment is a percent between 1 and 100',
    )

    @api.model
    def _liwan_current(self):
        """The tenant's settings record, installed with the defaults by ``data/sales_settings.xml``."""
        return self.env.ref('liwan_sales.sales_settings')

    @api.model
    def _liwan_can_manage(self):
        """Whether the caller holds ``sales.settings.manage`` in the working company and in the root company: the
        settings bind every branch, so the manager of one branch only reads them."""
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        access = self.env['liwan.access.service']
        return all(
            access._liwan_has_capability(self.env.user, SETTINGS_MANAGE, company=company)
            for company in (self.env.company, root)
        )

    @api.model
    def _liwan_payment_parsers(self):
        """The payment keys a settings write accepts, as ``{key: parser}``. A parser takes the raw value and returns the
        checked one or raises ``LiwanAccessRule`` (422 on the key); a tenant without online payments cannot set them."""
        return {
            'payment_to_confirm': self._liwan_parse_payment_setting(parse_payment_mode),
            'prepayment_percent': self._liwan_parse_payment_setting(parse_prepayment_percent),
        }

    @api.model
    def _liwan_parse_payment_setting(self, parse):
        """``parse`` as a settings parser: the value is checked, and a tenant without online payments cannot set it."""
        def parser(value):
            checked = parse(value)
            self.env['liwan.entitlement.service'].require(PAYMENTS_FEATURE)
            return checked
        return parser

    def _liwan_payment_wire(self):
        """The payment choice the wire shape carries, as ``{key: value}``: empty while the tenant cannot take payments."""
        self.ensure_one()
        if not payments_open(self.env):
            return {}
        return {'payment_to_confirm': self.payment_to_confirm, 'prepayment_percent': self.prepayment_percent}

    @api.model
    def _liwan_patch_parsers(self):
        """The keys a settings write accepts beyond Sales' own, as ``{key: parser}``: none here; the CRM and finance
        bridges add theirs with ``super()``."""
        return {}

    def _liwan_wire_extras(self):
        """The settings the wire shape carries beyond Sales' own, as ``{key: value}``: none here; the CRM and finance
        bridges add theirs with ``super()``."""
        self.ensure_one()
        return {}

    def _liwan_preset_extras(self):
        """The values the sector presets (``models/sales_presets.py``) hold beyond Sales' own, as ``{preset: {key: value}}``:
        none here; the CRM and finance bridges add theirs with ``super()``. Each key is one the settings may not carry, so a
        tenant that does not carry it never sees the value."""
        self.ensure_one()
        return {}

    def _liwan_apply(self, values, revision):
        """Write ``values`` read at ``revision``.

        403 ``forbidden`` unless ``_liwan_can_manage``; 409 ``conflict`` on a stale read. A refusal changes
        nothing. The record rule of a sale order reads the visibility through a cached domain, so the cache is cleared.
        """
        self.ensure_one()
        if not self._liwan_can_manage():
            code = 'forbidden'
            raise LiwanAccessRule(code, 'the Sales settings belong to the managers of the root company', status=403)
        if self.revision != revision:
            code = 'conflict'
            raise LiwanAccessRule(code, 'the Sales settings changed since they were read', status=409)
        self.write({**values, 'revision': revision + 1})
        self.env.registry.clear_cache()
