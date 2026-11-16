# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

FEATURE = 'finance.enabled'
# Whether staff may invoice part of a confirmed order in advance (a down payment), or only the order as a whole.
DOWN_PAYMENT_MODES = ('allow', 'refuse')
# Who may invoice an order: its salesperson or an assign holder (the actor rule of Sales), or any caller with both rights.
INVOICE_ACTOR_MODES = ('owner', 'any_biller')


def choice_parser(field, modes):
    """The parser of the selection setting ``field``: the value is one of ``modes``, else 422 on ``field``."""
    def parse(value):
        if value not in modes:
            code = 'invalid'
            raise LiwanAccessRule(code, f'{field} must be one of {modes}', field=field, status=422)
        return value
    return parse


class LiwanSalesSettings(models.Model):
    """What the finance bridge adds to the tenant's Sales policy: whether a confirmed order may be invoiced in advance and
    who may invoice an order that is not theirs.

    Read each time an invoice is made, so a change applies to the invoices that come after it.
    """
    _inherit = 'liwan.sales.settings'

    # allow: an order is invoiced whole or by down payments; refuse: only the whole order.
    invoice_down_payment = fields.Selection([(mode, mode) for mode in DOWN_PAYMENT_MODES], required=True, default='allow')
    # owner: the salesperson of the order or a holder of sales.documents.assign; any_biller: any caller who reads the order.
    invoice_actor = fields.Selection([(mode, mode) for mode in INVOICE_ACTOR_MODES], required=True, default='owner')

    @api.model
    def _liwan_patch_parsers(self):
        parsers = {
            'invoice_down_payment': choice_parser('invoice_down_payment', DOWN_PAYMENT_MODES),
            'invoice_actor': choice_parser('invoice_actor', INVOICE_ACTOR_MODES),
        }
        return {
            **super()._liwan_patch_parsers(),
            **{key: self._liwan_parse_finance_setting(parse) for key, parse in parsers.items()},
        }

    @api.model
    def _liwan_parse_finance_setting(self, parse):
        """``parse`` as a settings parser: the value is checked, and a tenant without Finance cannot set it."""
        def parser(value):
            checked = parse(value)
            self.env['liwan.entitlement.service'].require(FEATURE)
            return checked
        return parser

    def _liwan_wire_extras(self):
        extras = super()._liwan_wire_extras()
        if not self.env['liwan.entitlement.service']._liwan_feature_read(FEATURE):
            return extras
        return {**extras, 'invoice_down_payment': self.invoice_down_payment, 'invoice_actor': self.invoice_actor}
