# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import MANAGER_LOGIN, MANAGER_PASSWORD, WebVueFinanceCase


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceBranchAccess(WebVueFinanceCase):
    """A parent's finance manager is only a member, not a finance actor, in a branch."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.env['res.company'].create({'name': 'Finance Branch', 'parent_id': cls.company.id})
        accounts = cls.env['account.account'].search([('company_ids', 'in', cls.company.ids)])
        cls.partner.with_company(cls.branch).write({
            'property_account_receivable_id': accounts.filtered(lambda account: account.account_type == 'asset_receivable')[:1].id,
            'property_account_payable_id': accounts.filtered(lambda account: account.account_type == 'liability_payable')[:1].id,
        })
        cls.branch_invoice = cls.env['account.move'].with_company(cls.branch).create({
            'move_type': 'out_invoice', 'partner_id': cls.partner.id,
            'invoice_date': '2026-10-18', 'invoice_date_due': '2026-10-18',
            'invoice_line_ids': [Command.create({
                'name': 'Branch consulting', 'quantity': 1, 'price_unit': 1000,
                'account_id': accounts.filtered(lambda account: account.account_type == 'income')[:1].id,
            })],
        })
        cls.manager.company_ids = [Command.set((cls.company | cls.branch).ids)]
        cls.branch_reader = cls.env['webvue.access.role'].with_company(cls.branch)._webvue_access_create({
            'key': 'finance_branch_reader', 'name_ar': 'قارئ فواتير الفرع',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([
                ('key', '=', 'finance.invoices.read'),
            ]).ids)],
        })

    def setUp(self):
        super().setUp()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)

    def _grant_read(self):
        return self.env['webvue.access.assignment']._webvue_access_create({
            'user_id': self.manager.id, 'role_id': self.branch_reader.id,
            'company_id': self.branch.id,
        })

    def _invoice_ids(self):
        response = self.api('GET', '/api/v1/finance/invoices')
        self.assertEqual(response.status_code, 200, response.text)
        return {item['id'] for item in response.json()['items']}

    def test_branch_membership_does_not_inherit_parent_finance_access(self):
        self.assertNotIn(self.branch_invoice.id, self._invoice_ids())
        response = self.api('GET', f'/api/v1/finance/invoices/{self.branch_invoice.id}')
        self.assertEqual((response.status_code, response.json().get('code')), (404, 'not_found'), response.text)

    def test_explicit_branch_read_does_not_allow_parent_write_in_the_branch(self):
        self._grant_read()
        self.assertIn(self.branch_invoice.id, self._invoice_ids())
        response = self.api('GET', f'/api/v1/finance/invoices/{self.branch_invoice.id}')
        self.assertEqual(response.status_code, 200, response.text)
        before = self.branch_invoice.ref
        response = self.api('PATCH', f'/api/v1/finance/invoices/{self.branch_invoice.id}', json={'ref': 'unauthorized'})
        self.assertEqual((response.status_code, response.json().get('code')), (404, 'not_found'), response.text)
        self.branch_invoice.invalidate_recordset()
        self.assertEqual(self.branch_invoice.ref, before)
        # Global stock accountant write ACLs from the parent must not bypass the
        # branch's read-only grant when a caller uses ordinary ORM directly.
        scoped = self.branch_invoice.with_user(self.manager).with_context(
            allowed_company_ids=(self.company | self.branch).ids,
            webvue_pinned_company_ids=(self.company | self.branch).ids,
        )
        with self.assertRaises(AccessError):
            scoped.write({'ref': 'unauthorized'})

    def test_revoking_a_branch_grant_applies_to_an_existing_session(self):
        assignment = self._grant_read()
        self.assertIn(self.branch_invoice.id, self._invoice_ids())
        assignment._webvue_access_unlink()
        self.assertNotIn(self.branch_invoice.id, self._invoice_ids())
        response = self.api('GET', f'/api/v1/finance/invoices/{self.branch_invoice.id}')
        self.assertEqual((response.status_code, response.json().get('code')), (404, 'not_found'), response.text)

    def test_parent_patch_uses_invoice_owner_for_line_and_partner_validation(self):
        permissions = self.env['webvue.access.permission'].search([
            ('key', 'in', ['finance.invoices.read', 'finance.invoices.manage']),
        ])
        writer = self.env['webvue.access.role'].with_company(self.branch)._webvue_access_create({
            'key': 'finance_branch_invoice_writer', 'name_ar': 'Branch invoice writer',
            'permission_ids': [Command.set(permissions.ids)],
        })
        self.env['webvue.access.assignment']._webvue_access_create({
            'user_id': self.manager.id, 'role_id': writer.id, 'company_id': self.branch.id,
        })
        self.manager.company_ids = [Command.set((self.company | self.branch | self.other_company).ids)]
        branch_tax = self.env['account.tax'].with_company(self.branch).create({
            'name': 'Branch sales VAT', 'company_id': self.branch.id, 'amount': 15, 'type_tax_use': 'sale',
        })
        branch_purchase_tax = self.env['account.tax'].with_company(self.branch).create({
            'name': 'Branch purchase VAT', 'company_id': self.branch.id, 'amount': 15, 'type_tax_use': 'purchase',
        })
        parent_tax = self.env['account.tax'].search([
            ('company_id', '=', self.company.id), ('type_tax_use', '=', 'sale'),
        ], limit=1)
        ancestor_account = self.branch_invoice.invoice_line_ids.account_id[:1]
        branch_account = self.env['account.account'].with_company(self.branch).create({
            'name': 'Branch invoice income', 'code': '499901', 'account_type': 'income',
            'company_ids': [Command.set(self.branch.ids)],
        })
        unrelated_account = self.env['account.account'].search([
            ('company_ids', 'in', self.other_company.ids), ('account_type', '=', 'income'),
        ], limit=1)
        branch_partner = self.env['res.partner'].create({'name': 'Branch customer', 'company_id': self.branch.id})
        parent_partner = self.env['res.partner'].create({'name': 'Parent-only customer', 'company_id': self.company.id})
        plan = self.env['account.analytic.plan'].create({'name': 'Invoice owner plan'})
        branch_analytic, parent_analytic = self.env['account.analytic.account'].create([
            {'name': 'Branch invoice project', 'plan_id': plan.id, 'company_id': self.branch.id},
            {'name': 'Parent invoice project', 'plan_id': plan.id, 'company_id': self.company.id},
        ])
        route = f'/api/v1/finance/invoices/{self.branch_invoice.id}'
        line = {'name': 'Branch service', 'quantity': 1, 'price_unit': 100,
                'tax_ids': [branch_tax.id], 'account_id': branch_account.id,
                'analytic_distribution': {str(branch_analytic.id): 100}}
        response = self.api('PATCH', route, json={'partner_id': branch_partner.id, 'lines': [line]})
        self.assertEqual(response.status_code, 200, response.text)
        self.branch_invoice.invalidate_recordset()
        self.assertEqual(self.branch_invoice.company_id, self.branch)
        self.assertEqual(self.branch_invoice.invoice_line_ids.account_id, branch_account)
        self.assertEqual(self.branch_invoice.invoice_line_ids.tax_ids, branch_tax)
        self.assertEqual(self.branch_invoice.partner_id, branch_partner)
        # Stock accounts are ancestor-compatible: a parent account remains valid
        # for its branch, unlike a tax whose API company must match the document.
        self.assertTrue(ancestor_account.filtered_domain(ancestor_account._check_company_domain(self.branch)))
        response = self.api('PATCH', route, json={'lines': [{**line, 'account_id': ancestor_account.id}]})
        self.assertEqual(response.status_code, 200, response.text)
        for payload, field in (
            ({'lines': [{**line, 'tax_ids': [parent_tax.id]}]}, 'lines[0].tax_ids'),
            ({'lines': [{**line, 'tax_ids': [branch_purchase_tax.id]}]}, 'lines[0].tax_ids'),
            ({'lines': [{**line, 'account_id': unrelated_account.id}]}, 'lines[0].account_id'),
            ({'lines': [{**line, 'analytic_distribution': {str(parent_analytic.id): 100}}]}, 'lines[0].analytic_distribution'),
            ({'partner_id': parent_partner.id}, 'partner_id'),
        ):
            with self.subTest(field=field, payload=payload):
                response = self.api('PATCH', route, json=payload)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(response.json().get('field'), field, response.text)
        self.branch_invoice.invalidate_recordset()
        self.assertEqual(self.branch_invoice.company_id, self.branch)
        self.assertEqual(self.branch_invoice.partner_id, branch_partner)

    def test_branch_pdf_does_not_use_the_parent_payment_permission(self):
        self._grant_read()
        self.branch_invoice.action_post()
        with patch.object(
            type(self.env['ir.actions.report']), '_render_qweb_pdf', autospec=True,
            return_value=(b'%PDF-1.7 branch invoice', 'pdf'),
        ) as render:
            response = self.api('GET', f'/api/v1/finance/invoices/{self.branch_invoice.id}/pdf')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(render.call_args[0][1], 'account.account_invoices_without_payment')

    def test_delegated_statement_parent_rule_refreshes_after_branch_policy_changes(self):
        """A cached native _inherits rule must not retain an earlier WebVue fence."""
        bank_reader = self.env['webvue.access.role'].with_company(self.branch)._webvue_access_create({
            'key': 'finance_branch_bank_reader', 'name_ar': 'قارئ بنك الفرع',
            'permission_ids': [Command.set(self.env['webvue.access.permission'].search([
                ('key', '=', 'finance.bank.read'),
            ]).ids)],
        })
        self.env['webvue.access.assignment']._webvue_access_create({
            'user_id': self.manager.id, 'role_id': bank_reader.id, 'company_id': self.branch.id,
        })
        journal = self.env['account.journal'].with_company(self.branch).create({
            'name': 'Branch Bank', 'code': 'BRBK', 'type': 'bank', 'company_id': self.branch.id,
        })
        line = self.env['account.bank.statement.line'].with_company(self.branch).create({
            'journal_id': journal.id, 'date': '2026-10-18', 'payment_ref': 'Branch deposit', 'amount': 10,
        })
        policy = self.env['webvue.access.service'].with_company(self.company)

        def set_mode(mode):
            current = policy._webvue_branch_policy()
            policy._webvue_update_branch_policy(current['version'], mode, [])

        # Keep the same user and ordinary ORM environment across transitions. A
        # caller's broad membership context cannot widen the owning policy.
        statement_lines = line.with_user(self.manager).with_context(
            allowed_company_ids=(self.company | self.branch).ids,
            webvue_capability_scope=((('finance.bank.read',), 'all'),),
        )
        set_mode('isolated')
        self.assertFalse(statement_lines.search([('id', '=', line.id)]))
        set_mode('delegated')
        self.assertEqual(statement_lines.search([('id', '=', line.id)]), statement_lines)
        with self.assertRaises(AccessError):
            statement_lines.write({'payment_ref': 'forbidden parent write'})
        set_mode('isolated')
        self.assertFalse(statement_lines.search([('id', '=', line.id)]))
        set_mode('delegated')
        self.assertEqual(statement_lines.search([('id', '=', line.id)]), statement_lines)
        self.assertEqual(line.payment_ref, 'Branch deposit')
