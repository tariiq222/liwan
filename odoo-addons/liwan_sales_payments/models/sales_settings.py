# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

FEATURE = 'payments.enabled'
# Whether the customer must pay before the quotation becomes an order: not at all, all of it, or a percentage of it.
PAYMENT_MODES = ('off', 'full', 'percent')
MIN_PERCENT = 1
MAX_PERCENT = 100


def payments_open(env):
    """Whether the tenant can take payments now: online payments are included in its plan and its lifecycle allows writes."""
    return env['liwan.entitlement.service']._liwan_feature_write(FEATURE)


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
    """The tenant's default way of asking a customer to pay before a quotation becomes an order.

    A new quotation takes these values once; the value kept on each quotation is what counts after that.
    """
    _inherit = 'liwan.sales.settings'

    # off: the customer is not asked to pay; full: all of the quotation; percent: ``prepayment_percent`` of it.
    payment_to_confirm = fields.Selection([(mode, mode) for mode in PAYMENT_MODES], required=True, default='off')
    # The share of the total a customer pays under ``percent``.
    prepayment_percent = fields.Integer(required=True, default=50)

    _prepayment_percent_range = models.Constraint(
        f'CHECK(prepayment_percent >= {MIN_PERCENT} AND prepayment_percent <= {MAX_PERCENT})',
        'the prepayment is a percent between 1 and 100',
    )

    @api.model
    def _liwan_patch_parsers(self):
        return {
            **super()._liwan_patch_parsers(),
            'payment_to_confirm': self._liwan_parse_payment_setting(parse_payment_mode),
            'prepayment_percent': self._liwan_parse_payment_setting(parse_prepayment_percent),
        }

    @api.model
    def _liwan_parse_payment_setting(self, parse):
        """``parse`` as a settings parser: the value is checked, and a tenant without online payments cannot set it."""
        def parser(value):
            checked = parse(value)
            self.env['liwan.entitlement.service'].require(FEATURE)
            return checked
        return parser

    def _liwan_wire_extras(self):
        extras = super()._liwan_wire_extras()
        if not payments_open(self.env):
            return extras
        return {**extras, 'payment_to_confirm': self.payment_to_confirm, 'prepayment_percent': self.prepayment_percent}

    def _liwan_preset_extras(self):
        """Selling goods takes the money before the order; services and contracts are paid by invoice, not by a link."""
        presets = super()._liwan_preset_extras()
        return {
            **presets,
            'services': {**presets.get('services', {}), 'payment_to_confirm': 'off'},
            'trading': {**presets.get('trading', {}), 'payment_to_confirm': 'full'},
            'contracting': {**presets.get('contracting', {}), 'payment_to_confirm': 'off'},
        }
