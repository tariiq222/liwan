# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

FEATURE = 'crm.enabled'
# When an order wins its opportunity: as soon as it is confirmed, or never (the agent wins the opportunity with a package,
# as in a tenant without Sales).
OPPORTUNITY_WINS = ('order_confirmed', 'manual')
# What the opportunity is won for: the untaxed or the taxed total of its confirmed orders.
WIN_AMOUNTS = ('untaxed', 'total')


def _parse_choice(key, choices):
    def parse(value):
        if value not in choices:
            code = 'invalid'
            raise LiwanAccessRule(code, f'{key} must be one of {choices}', field=key, status=422)
        return value
    return parse


class LiwanSalesSettings(models.Model):
    """What the CRM bridge adds to the tenant's Sales policy: when an order wins its opportunity and for what amount.

    Both are read when an order is confirmed, so a change applies to the confirmations that come after it.
    """
    _inherit = 'liwan.sales.settings'

    # order_confirmed: confirming an order of an opportunity wins it; manual: confirming changes nothing.
    opportunity_win = fields.Selection([(mode, mode) for mode in OPPORTUNITY_WINS], required=True, default='order_confirmed')
    # The amount an opportunity is won for, in the company's currency, summed over its confirmed orders.
    opportunity_win_amount = fields.Selection([(mode, mode) for mode in WIN_AMOUNTS], required=True, default='untaxed')

    @api.model
    def _liwan_patch_parsers(self):
        return {
            **super()._liwan_patch_parsers(),
            'opportunity_win': self._liwan_parse_crm_setting(_parse_choice('opportunity_win', OPPORTUNITY_WINS)),
            'opportunity_win_amount': self._liwan_parse_crm_setting(_parse_choice('opportunity_win_amount', WIN_AMOUNTS)),
        }

    @api.model
    def _liwan_parse_crm_setting(self, parse):
        """``parse`` as a settings parser: the value is checked, and a tenant without CRM cannot set it."""
        def parser(value):
            checked = parse(value)
            self.env['liwan.entitlement.service'].require(FEATURE)
            return checked
        return parser

    def _liwan_wire_extras(self):
        extras = super()._liwan_wire_extras()
        if not self.env['liwan.entitlement.service']._liwan_feature_read(FEATURE):
            return extras
        return {**extras, 'opportunity_win': self.opportunity_win, 'opportunity_win_amount': self.opportunity_win_amount}

    def _liwan_preset_extras(self):
        """Every sector closes an opportunity with a confirmed order, for its untaxed amount."""
        presets = super()._liwan_preset_extras()
        won = {'opportunity_win': 'order_confirmed', 'opportunity_win_amount': 'untaxed'}
        return {**presets, **{sector: {**presets.get(sector, {}), **won} for sector in ('services', 'trading', 'contracting')}}
