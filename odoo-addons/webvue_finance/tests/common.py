# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase

MANAGER_LOGIN = 'finance_manager'
MANAGER_PASSWORD = 'finance_manager_pass_123'
OUTSIDER_LOGIN = 'finance_outsider'
OUTSIDER_PASSWORD = 'finance_outsider_pass_123'


class WebVueFinanceCase(WebVueApiCase):
    """The shared webvue_api fixture plus two Saudi companies with the l10n_sa chart,
    a finance manager and an outsider in the first one, and a posted sale invoice
    of 1000 SAR with 15% VAT in each company."""

    @classmethod
    def _saudi_company(cls, name):
        saudi_arabia = cls.env.ref('base.sa')
        company = cls.env['res.company'].create({
            'name': name, 'country_id': saudi_arabia.id, 'currency_id': cls.env.ref('base.SAR').id,
        })
        cls.env['account.chart.template'].try_loading('sa', company)
        return company

    @classmethod
    def _draft_sale_invoice(cls, company, partner):
        vat = cls.env['account.tax'].search([
            ('company_id', '=', company.id), ('type_tax_use', '=', 'sale'),
            ('amount_type', '=', 'percent'), ('amount', '=', 15),
        ], limit=1)
        return cls.env['account.move'].with_company(company).create({
            'move_type': 'out_invoice',
            'partner_id': partner.id,
            'invoice_date': '2026-10-18',
            'invoice_date_due': '2026-10-18',
            'invoice_line_ids': [Command.create({
                'name': 'Consulting', 'quantity': 1, 'price_unit': 1000, 'tax_ids': [Command.set(vat.ids)],
            })],
        })

    @classmethod
    def _sale_invoice(cls, company, partner):
        invoice = cls._draft_sale_invoice(company, partner)
        invoice.action_post()
        return invoice

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls._saudi_company('Finance Company A')
        cls.other_company = cls._saudi_company('Finance Company B')
        cls.partner = cls.env['res.partner'].create({'name': 'Al Noor Trading'})
        cls.manager = new_test_user(
            cls.env, login=MANAGER_LOGIN, password=MANAGER_PASSWORD, name='Finance Manager',
            groups='webvue_core.group_employee', company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('webvue_finance.role_finance_manager').id,
            'company_id': cls.company.id,
        }])
        cls.outsider = new_test_user(
            cls.env, login=OUTSIDER_LOGIN, password=OUTSIDER_PASSWORD, name='No finance access',
            groups='webvue_core.group_employee', company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls.invoice = cls._sale_invoice(cls.company, cls.partner)
        cls.other_invoice = cls._sale_invoice(cls.other_company, cls.partner)
