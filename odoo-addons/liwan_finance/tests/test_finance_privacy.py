# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Finance's contribution to the privacy hooks of liwan_customers: accounting documents are kept, a draft's copy goes."""
import io

import openpyxl

from odoo import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_customers.models import privacy_hooks
from odoo.addons.liwan_finance.models.privacy_hooks import (
    DOCUMENT_KEY,
    DRAFT_KEY,
    LINE_KEY,
    PAYMENT_KEY,
    STATEMENT_KEY,
)
from odoo.addons.liwan_finance.tests.common import LiwanFinanceCase

NAME = 'Zahra Trading Establishment'
PHONE = '+966501230001'
EMAIL = 'zahra@example.test'


@tagged('post_install', '-at_install', 'liwan')
class TestFinancePrivacy(LiwanFinanceCase):
    """The privacy service is called as a user who holds the system administrator and the finance manager roles."""

    @classmethod
    def _admin(cls, login, with_finance):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee',
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        grants = [{'role_id': cls.env.ref('liwan_core.role_system_admin').id, 'company_id': cls.company.id}]
        if with_finance:
            grants.append({'role_id': cls.env.ref('liwan_finance.role_finance_manager').id, 'company_id': cls.company.id})
        cls.env['liwan.access.service']._liwan_replace_assignments(user, grants)
        return user

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = cls._admin('finance_privacy_admin', with_finance=True)
        cls.no_finance_admin = cls._admin('finance_privacy_plain', with_finance=False)
        cls.customer = cls.env['liwan.customers.service']._liwan_create({'name': NAME, 'phone': PHONE, 'email': EMAIL})
        cls.customer.company_id = cls.company  # a customer of this company: the administrator's session covers it
        cls.posted = cls._sale_invoice(cls.company, cls.customer)
        cls.draft = cls._draft_sale_invoice(cls.company, cls.customer)
        cls.draft.invoice_source_email = EMAIL
        bank = cls.env['account.journal'].search([('company_id', '=', cls.company.id), ('type', '=', 'bank')], limit=1)
        cls.payment = cls.env['account.payment'].with_company(cls.company).create({
            'payment_type': 'inbound', 'partner_type': 'customer', 'partner_id': cls.customer.id, 'amount': 50,
            'date': '2026-10-18', 'journal_id': bank.id,
        })
        cls.payment.action_post()
        cls.statement_line = cls.env['account.bank.statement.line'].with_company(cls.company).create({
            'journal_id': bank.id, 'date': '2026-10-19', 'amount': 25, 'payment_ref': 'Transfer', 'partner_id': cls.customer.id,
            'partner_name': NAME,
        })

    def chatter(self, *records):
        """How many messages the records carry, whatever their models."""
        return sum(self.env['mail.message'].search_count([('model', '=', record._name), ('res_id', '=', record.id)]) for record in records)

    def service(self, user=None):
        return self.env['liwan.customers.privacy.service'].with_user(user or self.admin)

    def items(self, user=None):
        return {item['key']: item for item in self.service(user)._liwan_erase_preview(self.customer.id)['items']}

    def test_the_preview_lists_the_documents_as_retained_and_the_draft_copy_as_erased(self):
        items = self.items()
        self.assertEqual({key: (items[key]['action'], items[key]['owner']) for key in (DOCUMENT_KEY, LINE_KEY, PAYMENT_KEY, STATEMENT_KEY, DRAFT_KEY)}, {
            DOCUMENT_KEY: ('retain', 'liwan_finance'), LINE_KEY: ('retain', 'liwan_finance'),
            PAYMENT_KEY: ('retain', 'liwan_finance'), STATEMENT_KEY: ('retain', 'liwan_finance'),
            DRAFT_KEY: ('erase', 'liwan_finance'),
        })
        self.assertEqual((items[DOCUMENT_KEY]['count'], items[PAYMENT_KEY]['count'], items[DRAFT_KEY]['count']), (4, 1, 1))
        # The posted invoice, the draft, and the entries of the payment and of the statement line.
        self.assertGreaterEqual(items[LINE_KEY]['count'], 3)
        self.assertEqual(items[STATEMENT_KEY]['count'], 1)
        self.assertTrue(all(items[key]['complete'] for key in (DOCUMENT_KEY, LINE_KEY, PAYMENT_KEY, STATEMENT_KEY, DRAFT_KEY)))
        self.assertIn('accounting_name_copies', self.service()._liwan_erase_preview(self.customer.id)['not_covered'])

    def test_the_export_has_the_invoice_and_payment_sheets(self):
        content, _filename, logged = self.service()._liwan_export(self.customer.id, 'Access request')
        workbook = openpyxl.load_workbook(io.BytesIO(content))
        self.assertIn('Invoices and credit notes', workbook.sheetnames)
        self.assertIn('Payments', workbook.sheetnames)
        invoices = list(workbook['Invoices and credit notes'].values)
        self.assertEqual(len(invoices) - 1, 2)
        self.assertIn(self.posted.name, {row[1] for row in invoices[1:]})
        self.assertEqual(len(list(workbook['Payments'].values)) - 1, 1)
        self.assertEqual(logged.counts[DOCUMENT_KEY], 2)

    def test_an_erase_keeps_a_posted_invoice_whole_and_clears_a_drafts_copy_of_the_address(self):
        service = self.service()
        invoice = self.posted
        before = {
            'name': invoice.name, 'total': invoice.amount_total, 'untaxed': invoice.amount_untaxed, 'state': invoice.state,
            'date': invoice.invoice_date, 'partner': invoice.partner_id.id, 'lines': len(invoice.line_ids),
        }
        messages = self.chatter(self.customer, invoice, self.draft)
        token = service._liwan_erase_preview(self.customer.id)['token']
        logged, counts = service._liwan_erase(self.customer.id, token, NAME, 'Request')
        self.assertEqual((counts[DOCUMENT_KEY], counts[PAYMENT_KEY], counts[STATEMENT_KEY]), (4, 1, 1))
        self.assertEqual(logged.counts[DOCUMENT_KEY], 4)
        self.env.invalidate_all()
        invoice = self.posted
        self.assertEqual(before, {
            'name': invoice.name, 'total': invoice.amount_total, 'untaxed': invoice.amount_untaxed, 'state': invoice.state,
            'date': invoice.invoice_date, 'partner': invoice.partner_id.id, 'lines': len(invoice.line_ids),
        })
        self.assertEqual(invoice.state, 'posted')
        self.assertEqual(self.payment.partner_id, self.customer)
        self.assertEqual(self.statement_line.partner_id, self.customer)
        self.assertFalse(self.draft.invoice_source_email)
        self.assertEqual(self.draft.state, 'draft')
        # The posted document now names the customer by the marker, which is what its partner record holds.
        self.assertEqual(invoice.partner_id.with_context(active_test=False).name, privacy_hooks.ERASED_NAME % self.customer.id)
        self.assertEqual(invoice.invoice_partner_display_name, privacy_hooks.ERASED_NAME % self.customer.id)
        # Nothing was written to a chatter.
        self.assertEqual(self.chatter(self.customer, invoice, self.draft), messages)
        self.assertFalse(self.env['mail.tracking.value'].search_count([('old_value_char', 'in', (NAME, EMAIL))]))

    def test_a_caller_without_finance_reach_is_refused_and_nothing_is_written(self):
        service = self.service(self.no_finance_admin)
        by_key = {item['key']: item for item in service._liwan_erase_preview(self.customer.id)['items']}
        self.assertFalse(by_key[DOCUMENT_KEY]['complete'])
        self.assertEqual(by_key[DOCUMENT_KEY]['count'], 0)
        token = service._liwan_erase_preview(self.customer.id)['token']
        with self.assertRaises(LiwanAccessRule) as caught:
            service._liwan_erase(self.customer.id, token, NAME, 'Request')
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'erase_incomplete'))
        self.assertIn(
            {'key': DOCUMENT_KEY, 'owner': 'liwan_finance', 'reason': 'caller_cannot_reach_all_records'},
            caught.exception.details['incomplete'],
        )
        self.env.invalidate_all()
        self.assertEqual(self.customer.name, NAME)
        self.assertEqual(self.draft.invoice_source_email, EMAIL)

    def test_a_caller_who_reads_but_cannot_edit_drafts_is_refused_before_anything_is_written(self):
        reader = self._admin('finance_privacy_reader', with_finance=False)
        role = self.env['liwan.access.role'].with_company(self.company).create({
            'key': 'finance_privacy_reader_role', 'name_ar': 'r', 'name_en': 'r', 'type': 'custom',
            'permission_ids': [Command.set(self.env['liwan.access.permission'].search([
                ('key', 'in', ['finance.invoices.read', 'finance.payments.read', 'finance.bank.read']),
            ]).ids)],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(reader, [
            {'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.company.id},
            {'role_id': role.id, 'company_id': self.company.id},
        ])
        service = self.service(reader)
        token = service._liwan_erase_preview(self.customer.id)['token']
        with self.assertRaises(LiwanAccessRule) as caught:
            service._liwan_erase(self.customer.id, token, NAME, 'Request')
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'erase_incomplete'))
        self.env.invalidate_all()
        self.assertEqual(self.customer.name, NAME)
