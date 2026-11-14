# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import TransactionCase

SAUDI_VAT = '300000000000003'
TAX_EXCLUDED = 'tax_excluded'
TAX_INCLUDED = 'tax_included'
PRICE = 115.0


class LiwanOrdersCase(TransactionCase):
    """Fixtures of an establishment with a 15% sale tax and a product sold at 115 SAR."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sar = cls.env.ref('base.SAR')
        cls.customer = cls.env['res.partner'].create({'name': 'Orders customer'})

    @classmethod
    def company(cls, name, registered=False, price_mode=TAX_INCLUDED, parent=None):
        """A company whose tax mode is stated at creation (stock refuses to change it after a journal item)."""
        values = {
            'name': name,
            'account_price_include': parent.account_price_include if parent else price_mode,
            'country_id': cls.env.ref('base.sa').id,
            'currency_id': cls.sar.id,
        }
        if parent:
            values['parent_id'] = parent.id
        company = cls.env['res.company'].create(values)
        if registered:
            cls.register(company, True)
        return company

    @classmethod
    def register(cls, company, registered):
        company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': registered})

    @classmethod
    def tax(cls, company, name='VAT 15%'):
        group = cls.env['account.tax.group'].create({'name': f'{company.name} {name} group', 'company_id': company.id})
        return cls.env['account.tax'].create({
            'name': f'{company.name} {name}', 'amount': 15.0, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': company.id, 'tax_group_id': group.id,
        })

    @classmethod
    def product(cls, tax, name='Consultation'):
        return cls.env['product.product'].create({
            'name': name, 'type': 'service', 'list_price': PRICE, 'taxes_id': [Command.set(tax.ids)],
        })

    @classmethod
    def order(cls, company, lines=()):
        """A draft order of ``company`` with one line per product in ``lines``."""
        pricelist = cls.env['product.pricelist'].create({
            'name': f'{company.name} SAR', 'currency_id': cls.sar.id, 'company_id': company.id,
        })
        return cls.env['sale.order'].with_company(company).create({
            'company_id': company.id,
            'partner_id': cls.customer.id,
            'pricelist_id': pricelist.id,
            'order_line': [Command.create({'product_id': product.id}) for product in lines],
        })

    @classmethod
    def line(cls, order, product, quantity=1):
        return cls.env['sale.order.line'].with_company(order.company_id).create({
            'order_id': order.id, 'product_id': product.id, 'product_uom_qty': quantity,
        })
