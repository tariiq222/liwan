# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import Command, api, models

from .elevated import elevated_env

_logger = logging.getLogger(__name__)


class LiwanProductsService(models.AbstractModel):
    _inherit = 'liwan.products.service'

    @api.model
    def _liwan_price_amounts(self, variant, unit_price, quantity, company, customer):
        """The tax part of the price function (plan D6): the stock tax computation on the taxes stock puts on a sale
        line of ``company`` (``_filter_taxes_by_company`` climbs to the first ancestor that owns one), mapped through
        the fiscal position stock picks for ``customer``. The unit price follows the mapping exactly as a stock sale line
        does (``product.product._get_tax_included_unit_price_from_price``, which ends in
        ``account.tax._adapt_price_unit_to_another_taxes``): a price whose every tax is price-included loses the
        tax the mapping drops and takes the one it adds. Each tax follows
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
            unit_price = variant.with_env(elevated)._get_tax_included_unit_price_from_price(
                unit_price, product_taxes, product_taxes_after_fp=taxes,
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
        """Adopted products carry valid establishment sale taxes: the valid ones they already have are kept (a dormant
        chart tax is activated, as picking it does), and only when none is valid the establishment's default takes
        their place. With no default either the product has no tax and the adoption says so in the log. Purchase
        taxes are cleared (a service product is sold, plan D20). An adopted product is shared, so its taxes are the
        root's: the one-company rule of the choices holds."""
        adopted = super()._liwan_adopt(products)
        templates, shared = self.env['product.template'], self.env['res.company']
        allowed = set(templates._liwan_elevated_tax_choices(shared).ids)
        default = templates._liwan_default_sale_tax_ids(shared)
        for product in adopted.with_context(active_test=False):
            current = product.taxes_id
            kept = tuple(tax_id for tax_id in current.ids if tax_id in allowed)
            if not current or len(kept) != len(current) or not all(current.mapped('active')):
                kept = kept or default
                if kept:
                    product._liwan_store_sale_taxes(kept)
                else:
                    _logger.warning(
                        'Adopted product %s (id %s) has no valid sale tax and the establishment has no default',
                        product.name, product.id,
                    )
                    product.taxes_id = [Command.clear()]
            product.supplier_taxes_id = [Command.clear()]
        return adopted
