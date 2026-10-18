# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command

from .write_common import WebVueFinanceWriteCase

REPORTS = '/api/v1/finance/reports'
ASSETS = '/api/v1/finance/assets'
BANK = '/api/v1/finance/bank-statements'
BANK_LINES = '/api/v1/finance/bank-statement-lines'


class WebVueFinanceOcaCase(WebVueFinanceWriteCase):
    """The write fixture plus books with known totals, for the OCA-backed routes.

    Company A (calendar fiscal year 2026, SAR) after the inherited sale of 1000 + 15% VAT on 2026-10-18 to
    Al Noor Trading, of which 400 is paid on 2026-10-19 (750 stays open), and:

    - 2025-12-15 sale: bank 5000 / sales 5000 (the previous fiscal year, so earnings of earlier years);
    - 2026-01-02 capital: bank 100000 / capital 100000;
    - 2026-01-05 equipment: furniture 12000 / bank 12000;
    - 2026-02-01 loans: bank 10000 / end of service provision 8000 and leave provision 2000;
    - 2026-10-20 bill from Gulf Supplies: expenses 400 + 60 VAT, payable 460, due 2026-11-20;
    - 2026-10-18 sales to Riyadh Supplies: 100 + 15% VAT due 2026-11-20, 200 + 15% VAT due 2026-12-15.

    At 2026-12-31 that is: assets 116555, liabilities 10655, equity 105900 (capital 100000, earlier years 5000,
    this year 900 = sales 1300 less expenses 400).
    """

    @classmethod
    def account(cls, code, company=None):
        company = company or cls.company
        return cls.env['account.account'].with_company(company).search([
            ('code', '=', code), ('company_ids', 'in', company.ids),
        ], limit=1)

    @classmethod
    def asset_profile(cls, company):
        """A five year linear profile for furniture (yearly entries, calendar fiscal year)."""
        return cls.env['account.asset.profile'].with_company(company).create({
            'name': 'Furniture 5 years', 'company_id': company.id,
            'account_asset_id': cls.account('106002', company).id,
            'account_depreciation_id': cls.account('106007', company).id,
            'account_expense_depreciation_id': cls.account('400064', company).id,
            'journal_id': cls._journal(company, 'general').id,
            'method': 'linear', 'method_time': 'year', 'method_number': 5, 'method_period': 'year',
        })

    @classmethod
    def entry(cls, day, lines):
        """A posted general journal entry; ``lines`` are ``(account_code, debit, credit)``."""
        move = cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'entry', 'date': day, 'journal_id': cls._journal(cls.company, 'general').id,
            'line_ids': [
                Command.create({'account_id': cls.account(code).id, 'debit': debit, 'credit': credit, 'name': 'entry'})
                for code, debit, credit in lines
            ],
        })
        move.action_post()
        return move

    @classmethod
    def sale(cls, partner, amount, due):
        """A posted sale of ``amount`` plus 15% VAT, dated 2026-10-18 and due on ``due``."""
        invoice = cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'out_invoice', 'partner_id': partner.id, 'invoice_date': '2026-10-18', 'invoice_date_due': due,
            'invoice_line_ids': [Command.create({
                'name': 'Service', 'quantity': 1, 'price_unit': amount, 'tax_ids': [Command.set(cls.sale_vat.ids)],
            })],
        })
        invoice.action_post()
        return invoice

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.capital = cls.env['account.account'].with_company(cls.company).create({
            'code': '300001', 'name': 'Share capital', 'account_type': 'equity',
        })
        cls.entry('2025-12-15', [('101001', 5000, 0), ('500001', 0, 5000)])
        cls.entry('2026-01-02', [('101001', 100000, 0), ('300001', 0, 100000)])
        cls.entry('2026-01-05', [('106002', 12000, 0), ('101001', 0, 12000)])
        cls.entry('2026-02-01', [('101001', 10000, 0), ('202001', 0, 8000), ('201005', 0, 2000)])
        cls.bill = cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'in_invoice', 'partner_id': cls.vendor.id, 'invoice_date': '2026-10-20', 'invoice_date_due': '2026-11-20',
            'invoice_line_ids': [Command.create({
                'name': 'Paper', 'quantity': 4, 'price_unit': 100, 'tax_ids': [Command.set(cls.purchase_vat.ids)],
            })],
        })
        cls.bill.action_post()
        cls.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=cls.invoice.ids,
        ).create({'amount': 400, 'payment_date': '2026-10-19', 'journal_id': cls.bank.id}).action_create_payments()
        cls.riyadh = cls.env['res.partner'].create({'name': 'Riyadh Supplies'})
        cls.sale_late = cls.sale(cls.riyadh, 100, '2026-11-20')
        cls.sale_current = cls.sale(cls.riyadh, 200, '2026-12-15')
