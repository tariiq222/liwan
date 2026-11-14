# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command

from odoo.addons.liwan_products.tests.common import ProductsCase

VALID_VAT = '300000000000003'


class ProductTaxesCase(ProductsCase):
    """``ProductsCase`` with the tenant root registered for VAT in Saudi Arabia and taxes of its own.

    ``vat15`` is the root's default sale tax; ``vat5`` a second sale tax; ``zero_inactive`` a zero-rated chart tax that
    is still inactive, as the Saudi chart ships its local 0% taxes; ``archived_by_accountant`` an inactive tax no chart
    loaded; ``export0`` the 0% tax a customer outside Saudi
    Arabia gets through ``foreign``, an automatic fiscal position for the United Arab Emirates. ``branch_tax`` is a
    sale tax branch A owns.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root = cls.root_company
        root.write({'country_id': cls.env.ref('base.sa').id, 'vat': VALID_VAT})
        root.liwan_vat_registered = True
        cls.vat15 = cls.sale_tax(root, 15.0, 'Products VAT 15')
        cls.vat5 = cls.sale_tax(root, 5.0, 'Products VAT 5')
        cls.zero_inactive = cls.sale_tax(root, 0.0, 'Products zero rated')
        cls.zero_inactive.active = False
        # Loaded the way a chart loads its taxes: an account.<company id>_<template xmlid> record.
        cls.env['ir.model.data'].create({
            'module': 'account', 'name': f'{root.id}_products_zero_rated', 'model': 'account.tax',
            'res_id': cls.zero_inactive.id, 'noupdate': True,
        })
        # An accountant's archived tax: never offered, never re-activated by a product.
        cls.archived_by_accountant = cls.sale_tax(root, 0.0, 'Products archived by the accountant')
        cls.archived_by_accountant.active = False
        root.account_sale_tax_id = cls.vat15
        cls.foreign = cls.env['account.fiscal.position'].create({
            'name': 'Products abroad', 'company_id': root.id, 'auto_apply': True, 'sequence': -100,
            'country_id': cls.env.ref('base.ae').id,
        })
        cls.export0 = cls.sale_tax(root, 0.0, 'Products export 0')
        cls.export0.write({'fiscal_position_ids': [Command.set(cls.foreign.ids)], 'original_tax_ids': [Command.set(cls.vat15.ids)]})
        cls.branch_tax = cls.sale_tax(cls.branch_a, 15.0, 'Branch A VAT 15')

    @classmethod
    def sale_tax(cls, company, amount, name):
        group = cls.env['account.tax.group'].search([('company_id', '=', company.id)], limit=1) or cls.env[
            'account.tax.group'].create({'name': 'Products VAT', 'company_id': company.id})
        return cls.env['account.tax'].with_company(company).create({
            'name': name, 'company_id': company.id, 'amount': amount, 'type_tax_use': 'sale',
            'tax_group_id': group.id,
        })

    def service_as(self, user, company):
        return self.env['liwan.products.service'].with_user(user).with_company(company)

    def product(self, price=115.0, taxes=None, user=None, company=None):
        """A shared service product created in the root by ``root_staff`` (or ``user`` in ``company``)."""
        values = {'name': 'Taxed product', 'type': 'service', 'list_price': price}
        if taxes is not None:
            values['taxes'] = taxes.ids
        return self.service_as(user or self.root_staff, company or self.root_company)._liwan_create(values)

    def amounts(self, product, quantity=1.0, company=None, customer=None, user=None):
        company = company or self.root_company
        price = self.service_as(user or self.root_staff, company)._liwan_price(
            product, quantity=quantity, company=company, customer=customer,
        )
        return price['amount_untaxed'], price['amount_tax'], price['amount_total']

    def set_price_mode(self, mode):
        """The establishment's choice (stock ``account_price_include``), written on the root as liwan_api_account
        does: base copies it to the branches."""
        self.root_company.write({'account_price_include': mode})
