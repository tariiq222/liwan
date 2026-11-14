# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class AccountTax(models.Model):
    _inherit = 'account.tax'

    @api.model
    def _liwan_default_purchase_taxes_to_added(self, companies):
        """Give every purchase tax without an explicit override "tax added" (D5).

        A sale tax keeps following the company's choice; a purchase tax that already carries an override,
        and every sale tax, is left untouched.
        """
        taxes = self.with_context(active_test=False).search([
            ('company_id', 'in', companies.ids),
            ('type_tax_use', '=', 'purchase'),
            ('price_include_override', '=', False),
        ])
        if taxes:
            taxes.write({'price_include_override': 'tax_excluded'})
        return taxes
