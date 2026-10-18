# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user

from .common import MANAGER_LOGIN, MANAGER_PASSWORD, WebVueFinanceCase

INVOICES = '/api/v1/finance/invoices'
PAYMENTS = '/api/v1/finance/payments'
PARTNERS = '/api/v1/finance/partners'
PASSWORD = 'finance_write_pass_123'
SAUDI_VAT = '300000000000003'


class WebVueFinanceWriteCase(WebVueFinanceCase):
    """The finance fixture plus the taxes, journals and request bodies the write routes need."""

    @classmethod
    def _tax(cls, company, use, percent=15):
        return cls.env['account.tax'].search([
            ('company_id', '=', company.id), ('type_tax_use', '=', use),
            ('amount_type', '=', 'percent'), ('amount', '=', percent),
        ], limit=1)

    @classmethod
    def _journal(cls, company, journal_type):
        return cls.env['account.journal'].search([
            ('company_id', '=', company.id), ('type', '=', journal_type),
        ], limit=1)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sale_vat = cls._tax(cls.company, 'sale')
        cls.purchase_vat = cls._tax(cls.company, 'purchase')
        cls.other_sale_vat = cls._tax(cls.other_company, 'sale')
        cls.bank = cls._journal(cls.company, 'bank')
        cls.other_bank = cls._journal(cls.other_company, 'bank')
        cls.vendor = cls.env['res.partner'].create({'name': 'Gulf Supplies'})
        cls.other_payment = cls.env['account.payment'].with_company(cls.other_company).create({
            'payment_type': 'inbound', 'partner_type': 'customer', 'partner_id': cls.partner.id,
            'amount': 10, 'date': '2026-10-18', 'journal_id': cls.other_bank.id,
        })
        cls.foreign_partner = cls.env['res.partner'].create({
            'name': 'Foreign Co Customer', 'company_id': cls.other_company.id,
        })

    def setUp(self):
        super().setUp()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)

    @classmethod
    def user_with(cls, login, keys):
        """A user in the first company whose only finance access is a custom role of ``keys``."""
        user = new_test_user(
            cls.env, login=login, password=PASSWORD, name=login,
            groups='webvue_core.group_employee', company_id=cls.company.id,
            company_ids=[Command.set(cls.company.ids)],
        )
        role = cls.env['webvue.access.role'].with_company(cls.company).create({
            'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([('key', 'in', keys)]).ids)],
        })
        cls.env['webvue.access.service']._webvue_replace_assignments(
            user, [{'role_id': role.id, 'company_id': cls.company.id}],
        )
        return user

    def invoice_body(self, **overrides):
        """A 1000 SAR sale invoice with 15% VAT (1150 total)."""
        return {
            'move_type': 'out_invoice',
            'partner_id': self.partner.id,
            'invoice_date': '2026-10-18',
            'lines': [{'name': 'Consulting', 'quantity': 1, 'price_unit': 1000, 'tax_ids': [self.sale_vat.id]}],
            **overrides,
        }

    def bill_body(self, **overrides):
        """A 1000 SAR vendor bill with 15% VAT (1150 total)."""
        return self.invoice_body(**{
            'move_type': 'in_invoice', 'partner_id': self.vendor.id,
            'lines': [{'name': 'Paper', 'quantity': 10, 'price_unit': 100, 'tax_ids': [self.purchase_vat.id]}],
            **overrides,
        })

    def create_invoice(self, body=None):
        result = self.api('POST', INVOICES, json=body or self.invoice_body())
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def post_invoice(self, invoice_id):
        result = self.api('POST', f'{INVOICES}/{invoice_id}/post', json={})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def posted_invoice(self, body=None):
        return self.post_invoice(self.create_invoice(body)['id'])

    def pay_body(self, invoices, **overrides):
        return {
            'invoice_ids': [invoice['id'] for invoice in invoices],
            'amount': sum(invoice['amount_residual'] for invoice in invoices),
            'payment_date': '2026-10-19',
            'journal_id': self.bank.id,
            **overrides,
        }

    def assertRefused(self, result, status, code, field=None):  # noqa: N802
        body = result.json()
        self.assertEqual((result.status_code, body['code']), (status, code), result.text)
        if field:
            self.assertEqual(body.get('field'), field, result.text)
