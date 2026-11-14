# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, models

from .elevated import elevated_env


class LiwanProductsService(models.AbstractModel):
    _inherit = 'liwan.products.service'

    @api.model
    def _liwan_price_amounts(self, variant, unit_price, quantity, company, customer):
        """The tax part of the price function (plan D6): the stock tax computation on the taxes stock puts on a sale
        line of ``company`` (``_filter_taxes_by_company`` climbs to the first ancestor that owns one), mapped through
        the fiscal position stock picks for ``customer``. When the mapping drops a price-included tax, the price loses
        that tax first, as a stock line does (``account.tax._fix_tax_included_price_company``). Each tax follows
        stock's price mode of the company that owns it (``account_price_include``, the establishment's one choice).
        An establishment that is not registered for VAT has no tax, whatever taxes the product still carries.

        Read elevated (plan D24), after ``_liwan_price`` checked the caller: only the amounts leave it.
        """
        if not company._liwan_vat_registered():
            return super()._liwan_price_amounts(variant, unit_price, quantity, company, customer)
        elevated = elevated_env(self.env)
        company = elevated['res.company'].browse(company.id)
        product_taxes = variant.with_env(elevated).taxes_id._filter_taxes_by_company(company)
        taxes, partner = product_taxes, None
        if customer:
            partner = customer.with_env(elevated)
            taxes = elevated['account.fiscal.position'].with_company(company)._get_fiscal_position(partner).map_tax(
                product_taxes,
            )
            unit_price = elevated['account.tax']._fix_tax_included_price_company(
                unit_price, product_taxes, taxes, company,
            )
        result = taxes.with_company(company).compute_all(
            unit_price, company.currency_id, quantity, product=variant.with_env(elevated), partner=partner,
        )
        currency = company.currency_id
        untaxed, total = result['total_excluded'], result['total_included']
        return untaxed, currency.round(total - untaxed), total

    @api.model
    def _liwan_sale_tax_choices(self):
        """The taxes a holder of ``products.manage`` may put on a product of the session's company, as plain dicts
        ``{id, name, amount, active}``: 403 otherwise; none for an establishment that is not registered for VAT."""
        company = self._liwan_new_company()
        self._liwan_require_write(company, {'taxes'})
        if not self.env.company._liwan_vat_registered():
            return []
        return self.env['product.template']._liwan_sale_tax_choice_data(company)

    @api.model
    def _liwan_adopt(self, products):
        """Adopted products carry valid establishment sale taxes: taxes outside the choices (or none) give way to the
        establishment's default, and purchase taxes are cleared (a service product is sold, plan D20)."""
        adopted = super()._liwan_adopt(products)
        templates, shared = self.env['product.template'], self.env['res.company']
        allowed = set(templates._liwan_elevated_tax_choices(shared).ids)
        default = templates._liwan_default_sale_tax_ids(shared)
        for product in adopted.with_context(active_test=False):
            if not product.taxes_id or not set(product.taxes_id.ids) <= allowed:
                product.taxes_id = [Command.set(default)]
            product.supplier_taxes_id = [Command.clear()]
        return adopted
