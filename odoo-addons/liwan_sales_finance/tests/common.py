# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, fields

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_sales.tests.common import CATALOG_KEYS, SAUDI_VAT, QuotationCase

ORDERS = '/api/v1/sales/orders'
INVOICES = '/api/v1/finance/invoices'
SETTINGS = '/api/v1/sales/settings'
SALES_AGENT = 'liwan_sales.role_sales_agent'
SALES_MANAGER = 'liwan_sales.role_sales_manager'
FINANCE_ACCOUNTANT = 'liwan_finance.role_finance_accountant'
FINANCE_MANAGER = 'liwan_finance.role_finance_manager'
FINANCE_AUDITOR = 'liwan_finance.role_finance_auditor'
INVOICE_BLOCK_KEYS = {
    'status', 'amount_invoiced', 'amount_credited', 'amount_drafted', 'amount_to_invoice', 'amount_paid', 'invoices', 'can_invoice', 'can_down_payment',
}
INVOICE_ITEM_KEYS = {
    'id', 'number', 'state', 'kind', 'payment_state', 'invoice_date', 'invoice_date_due', 'amount_total', 'amount_residual', 'currency',
}


class SalesFinanceCase(QuotationCase):
    """A Saudi establishment with the ``sa`` chart, registered for VAT, with a branch that has a sales journal of its own,
    and people who hold Sales roles, finance roles or both, in the root company and in the branch."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The tenant's root company (the products and customers services belong to it) takes the Saudi chart and a branch.
        cls.fin = cls.company
        cls.fin.write({'currency_id': cls.env.ref('base.SAR').id, 'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        cls.env['account.chart.template'].try_loading('sa', cls.fin)
        cls.unlink_zatca(cls.fin)
        cls.fin_branch = cls.branch
        cls.unlink_zatca(cls.fin_branch)
        cls.env['account.journal'].create({'name': 'Branch sales', 'code': 'BRS', 'type': 'sale', 'company_id': cls.fin_branch.id})
        cls.vat = cls.env['account.tax'].search([
            ('company_id', '=', cls.fin.id), ('type_tax_use', '=', 'sale'), ('amount_type', '=', 'percent'), ('amount', '=', 15),
        ], limit=1)
        cls.seller = cls.member('inv_seller', cls.fin, SALES_AGENT)
        cls.seller2 = cls.member('inv_seller2', cls.fin, SALES_AGENT)
        cls.sales_boss = cls.member('inv_sales_boss', cls.fin, SALES_MANAGER)
        cls.biller = cls.member('inv_biller', cls.fin, SALES_AGENT, FINANCE_ACCOUNTANT)
        cls.biller2 = cls.member('inv_biller2', cls.fin, SALES_AGENT, FINANCE_ACCOUNTANT)
        cls.boss = cls.member('inv_boss', cls.fin, SALES_MANAGER, FINANCE_MANAGER)
        cls.accountant = cls.member('inv_accountant', cls.fin, FINANCE_ACCOUNTANT)
        cls.finance_manager = cls.member('inv_finance_manager', cls.fin, FINANCE_MANAGER)
        cls.auditor = cls.member('inv_auditor', cls.fin, SALES_AGENT, FINANCE_AUDITOR)
        cls.branch_biller = cls.member('inv_branch_biller', cls.fin_branch, SALES_AGENT, FINANCE_ACCOUNTANT)
        cls.catalog_fin = cls.custom_user('inv_catalog', CATALOG_KEYS, company=cls.fin)
        cls.item = cls.service_product('Invoiced service', 100.0, cls.vat, user=cls.catalog_fin, company=cls.fin)
        cls.item2 = cls.service_product('Second service', 40.0, cls.vat, user=cls.catalog_fin, company=cls.fin)
        cls.free_item = cls.service_product('Untaxed service', 100.0, user=cls.catalog_fin, company=cls.fin)
        cls.customer = cls.party('Invoice customer')

    @classmethod
    def unlink_zatca(cls, company):
        """ZATCA phase 2 refuses to post until a journal is onboarded: the fixtures sell through journals without that format."""
        zatca = cls.env.ref('l10n_sa_edi.edi_sa_zatca')
        cls.env['account.journal'].search([('company_id', '=', company.id)]).edi_format_ids = [Command.unlink(zatca.id)]

    @classmethod
    def member(cls, login, company, *roles):
        user = cls._member(login, company, roles[0])
        for role in roles[1:]:
            cls.env['liwan.access.assignment'].create({
                'user_id': user.id, 'role_id': cls.env.ref(role).id, 'company_id': company.id,
            })
        return user

    @classmethod
    def line(cls, product=None, quantity=1.0, price=None, **values):
        product = product or cls.item
        variant = product.product_variant_id
        return Command.create({
            'product_id': variant.id, 'product_uom_qty': quantity, 'price_unit': price if price is not None else variant.list_price,
            **values,
        })

    @classmethod
    def confirmed(cls, user=None, company=None, lines=None, **values):
        """A confirmed staff order of ``user`` (default: the biller) in ``company`` (default: the root), made as the superuser."""
        company = company or cls.fin
        order = cls.make_order(user or cls.biller, company, lines=lines or [cls.line(quantity=2)], **values)
        order.partner_id.liwan_party = True
        cls.env['liwan.sales.service']._liwan_move(order, 'confirm')
        order.invalidate_recordset()
        return order

    @classmethod
    def set_invoice_actor(cls, mode):
        cls.env['liwan.sales.settings']._liwan_current().invoice_actor = mode
        cls.env.registry.clear_cache()

    def invoice_order(self, user, order, body=None, expect=200):
        response = self.api_as(user, 'POST', f'{ORDERS}/{order.id}/invoices', {'method': 'order'} if body is None else body)
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def shape(self, user, order, expect=200):
        response = self.api_as(user, 'GET', f'{ORDERS}/{order.id}')
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def feature(self, key, enabled, retained=False):
        set_probe_feature(self, key=key, enabled=enabled, retained=retained)

    def post_invoice(self, invoice_id, user=None):
        """Post the draft invoice ``invoice_id`` through finance's own route, as a finance manager."""
        response = self.api_as(user or self.finance_manager, 'POST', f'{INVOICES}/{invoice_id}/post')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def pay_invoice(self, invoice_id, amount=None):
        """Register a payment on the posted invoice as the superuser, through stock's wizard."""
        invoice = self.env['account.move'].browse(invoice_id)
        wizard = self.env['account.payment.register'].with_context(active_model='account.move', active_ids=invoice.ids).create(
            {'amount': amount if amount is not None else invoice.amount_residual},
        )
        wizard.action_create_payments()
        invoice.invalidate_recordset()
        return invoice

    @staticmethod
    def today():
        return fields.Date.context_today(fields.Date)
