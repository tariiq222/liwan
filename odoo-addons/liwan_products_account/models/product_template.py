# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, models

from .elevated import elevated_env
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

TAXES = 'taxes'
# The Saudi chart's 0% taxes that need a buyer identified as a Saudi national (l10n_sa_edi
# models/account_edi_format.py:276-284): left out of the choices until an application knows the buyer (plan D21).
NATIONAL_BUYER_TAXES = ('sa_private_education_tax_0', 'sa_private_healthcare_tax_0')
# A chart loads its taxes as account.<company id>_<template xmlid> (account/models/chart_template.py company_xmlid).
CHART_MODULE = 'account'


def _refuse_taxes(message):
    code = 'invalid'
    raise LiwanAccessRule(code, message, field=TAXES, status=422)


def dump_tax(tax):
    """A tax as plain data: what leaves the elevated read."""
    return {'id': tax.id, 'name': tax.name, 'amount': tax.amount, 'active': tax.active}


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    @api.model
    def _liwan_product_extension_specs(self):
        """A product's sale taxes (plan D21): shown and accepted for an establishment registered for VAT. The stored
        value passed between ``parse``/``default`` and ``write`` is a tuple of tax ids, never a record."""
        return [*super()._liwan_product_extension_specs(), {
            'name': TAXES,
            'field': 'taxes_id',
            'applies': lambda env: env.company._liwan_vat_registered(),
            'parse': lambda env, value, company: env['product.template']._liwan_parse_sale_taxes(value, company),
            'default': lambda env, company: env['product.template']._liwan_default_sale_tax_ids(company),
            # Stock defaults both tax fields from the root's taxes under its own elevation (account/models/product.py:44,
            # 51), which a branch session may not then store (fields_relational.py:1503 checks read access). The
            # purchase taxes stay empty: a service product is a thing the company sells (plan D20).
            'blank': {'taxes_id': [Command.clear()], 'supplier_taxes_id': [Command.clear()]},
            'write': lambda product, tax_ids: product._liwan_store_sale_taxes(tax_ids),
            'dump': lambda product: product._liwan_dump_sale_taxes(),
        }]

    @api.model
    def _liwan_tax_owner(self, company):
        """The company whose establishment a product owned by ``company`` (empty when shared) takes its taxes from."""
        return company or self.env['liwan.entitlement.service']._liwan_profile().root_company_id

    @api.model
    def _liwan_sale_tax_choice_data(self, company):
        """The choices of ``_liwan_elevated_tax_choices`` as plain dicts ``{id, name, amount, active}``."""
        return [dump_tax(tax) for tax in self._liwan_elevated_tax_choices(company)]

    @api.model
    def _liwan_elevated_tax_choices(self, company):
        """Private to this addon: the sale taxes a product owned by ``company`` may carry, as elevated records (a
        branch session cannot read its root's taxes through the company fence). Those of its company and of every
        ancestor: the active ones, and the inactive ones a chart loaded (an accountant's archived tax stays out),
        less the ones that need a Saudi-national buyer."""
        elevated = elevated_env(self.env)
        owner = elevated['res.company'].browse(self._liwan_tax_owner(company).id)
        taxes = elevated['account.tax'].with_context(active_test=False).search([
            ('type_tax_use', '=', 'sale'), ('company_id', 'in', owner.parent_ids.ids),
        ], order='sequence, id')
        from_chart = set(elevated['ir.model.data'].search([
            ('model', '=', 'account.tax'), ('module', '=', CHART_MODULE), ('res_id', 'in', taxes.ids),
        ]).mapped('res_id'))
        charts = elevated['account.chart.template']
        excluded = elevated['account.tax'].union(*(
            charts.with_company(ancestor).ref(xmlid, raise_if_not_found=False) or elevated['account.tax']
            for ancestor in owner.parent_ids for xmlid in NATIONAL_BUYER_TAXES
        ))
        return taxes.filtered(lambda tax: tax.active or tax.id in from_chart) - excluded

    @api.model
    def _liwan_default_sale_tax_ids(self, company):
        """The ids of the establishment's default sale tax for a new product owned by ``company`` (stock
        ``account/models/product.py:44``: the company's, else its root's), read elevated."""
        owner = elevated_env(self.env)['res.company'].browse(self._liwan_tax_owner(company).id)
        return tuple((owner.account_sale_tax_id or owner.root_id.account_sale_tax_id).ids)

    @api.model
    def _liwan_parse_sale_taxes(self, value, company):
        """The tax ids of a wire list: one or more of the choices of ``company``, else 422. "No tax" is a zero-rated
        or exempt tax picked from the choices, because a ZATCA invoice line needs one (plan D21)."""
        if not isinstance(value, list) or not value or not all(
            isinstance(tax_id, int) and not isinstance(tax_id, bool) for tax_id in value
        ):
            _refuse_taxes('taxes must be a non-empty list of tax ids')
        allowed = set(self._liwan_elevated_tax_choices(company).ids)
        if not set(value) <= allowed:
            _refuse_taxes("taxes must be the establishment's own sale taxes")
        return tuple(sorted(set(value)))

    def _liwan_store_sale_taxes(self, tax_ids):
        """Store the taxes ``tax_ids`` (from the choices or the default) on this product, activating a chart tax that
        is still inactive (the choices hold no other inactive tax). Elevated: a branch session may not write taxes it
        cannot read. Returns nothing."""
        self.ensure_one()
        taxes = elevated_env(self.env)['account.tax'].with_context(active_test=False).browse(tax_ids)
        taxes.filtered(lambda tax: not tax.active).write({'active': True})
        self.with_env(taxes.env).write({'taxes_id': [Command.set(taxes.ids)]})

    def _liwan_dump_sale_taxes(self):
        """The product's sale taxes that apply in the session's company (stock ``_filter_taxes_by_company``), read
        elevated, as plain ``{id, name, amount}``."""
        self.ensure_one()
        elevated = elevated_env(self.env)
        company = elevated['res.company'].browse(self.env.company.id)
        taxes = self.with_env(elevated).taxes_id._filter_taxes_by_company(company)
        return [{'id': tax.id, 'name': tax.name, 'amount': tax.amount} for tax in taxes]
