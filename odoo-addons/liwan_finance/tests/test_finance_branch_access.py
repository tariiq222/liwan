# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import MANAGER_LOGIN, MANAGER_PASSWORD, LiwanFinanceCase


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceBranchAccess(LiwanFinanceCase):
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
        cls.branch_reader = cls.env['liwan.access.role'].with_company(cls.branch)._liwan_access_create({
            'key': 'finance_branch_reader', 'name_ar': 'قارئ فواتير الفرع',
            'permission_ids': [Command.set(cls.env['liwan.access.permission'].search([
                ('key', '=', 'finance.invoices.read'),
            ]).ids)],
        })

    def setUp(self):
        super().setUp()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)

    def _grant_read(self):
        return self.env['liwan.access.assignment']._liwan_access_create({
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
            liwan_pinned_company_ids=(self.company | self.branch).ids,
        )
        with self.assertRaises(AccessError):
            scoped.write({'ref': 'unauthorized'})

    def test_revoking_a_branch_grant_applies_to_an_existing_session(self):
        assignment = self._grant_read()
        self.assertIn(self.branch_invoice.id, self._invoice_ids())
        assignment._liwan_access_unlink()
        self.assertNotIn(self.branch_invoice.id, self._invoice_ids())
        response = self.api('GET', f'/api/v1/finance/invoices/{self.branch_invoice.id}')
        self.assertEqual((response.status_code, response.json().get('code')), (404, 'not_found'), response.text)

    def test_parent_patch_uses_invoice_owner_for_line_and_partner_validation(self):
        permissions = self.env['liwan.access.permission'].search([
            ('key', 'in', ['finance.invoices.read', 'finance.invoices.manage']),
        ])
        writer = self.env['liwan.access.role'].with_company(self.branch)._liwan_access_create({
            'key': 'finance_branch_invoice_writer', 'name_ar': 'Branch invoice writer',
            'permission_ids': [Command.set(permissions.ids)],
        })
        self.env['liwan.access.assignment']._liwan_access_create({
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
        foreign_tax = self.env['account.tax'].with_company(self.other_company).create({
            'name': 'Foreign sales VAT', 'company_id': self.other_company.id, 'amount': 15, 'type_tax_use': 'sale',
        })
        self.env['liwan.access.assignment']._liwan_access_create({
            'user_id': self.manager.id, 'role_id': self.env.ref('liwan_finance.role_finance_manager').id,
            'company_id': self.other_company.id,
        })
        ancestor_account = self.branch_invoice.invoice_line_ids.account_id[:1]
        branch_account = self.env['account.account'].with_company(self.branch).create({
            'name': 'Branch invoice income', 'code': '499901', 'account_type': 'income',
            'company_ids': [Command.set(self.branch.ids)],
        })
        unrelated_account = self.env['account.account'].search([
            ('company_ids', 'in', self.other_company.ids), ('account_type', '=', 'income'),
        ], limit=1)
        branch_partner = self.env['res.partner'].create({'name': 'Branch customer', 'company_id': self.branch.id})
        parent_partner = self.env['res.partner'].create({'name': 'Ancestor customer', 'company_id': self.company.id})
        unrelated_partner = self.env['res.partner'].create({'name': 'Unrelated customer', 'company_id': self.other_company.id})
        plan = self.env['account.analytic.plan'].create({'name': 'Invoice owner plan'})
        branch_analytic, parent_analytic, foreign_analytic = self.env['account.analytic.account'].create([
            {'name': 'Branch invoice project', 'plan_id': plan.id, 'company_id': self.branch.id},
            {'name': 'Parent invoice project', 'plan_id': plan.id, 'company_id': self.company.id},
            {'name': 'Foreign invoice project', 'plan_id': plan.id, 'company_id': self.other_company.id},
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
        # Native accounting references permit compatible ancestors; actor
        # visibility and the document's kind still apply.
        self.assertTrue(ancestor_account.filtered_domain(ancestor_account._check_company_domain(self.branch)))
        parent_journal = self.branch_invoice.journal_id
        response = self.api('PATCH', route, json={
            'lines': [{**line, 'account_id': ancestor_account.id, 'tax_ids': [parent_tax.id],
                       'analytic_distribution': {str(parent_analytic.id): 100}}],
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.branch_invoice.invalidate_recordset()
        self.assertEqual(self.branch_invoice.company_id, self.branch)
        self.assertEqual(self.branch_invoice.invoice_line_ids.tax_ids, parent_tax)
        self.assertEqual(self.branch_invoice.journal_id, parent_journal)
        self.assertTrue(parent_partner.filtered_domain(parent_partner._check_company_domain(self.branch)))
        response = self.api('PATCH', route, json={'partner_id': parent_partner.id})
        self.assertEqual(response.status_code, 200, response.text)
        self.branch_invoice.invalidate_recordset()
        self.assertEqual(self.branch_invoice.partner_id, parent_partner)
        for payload, field in (
            ({'lines': [{**line, 'tax_ids': [foreign_tax.id]}]}, 'lines[0].tax_ids'),
            ({'lines': [{**line, 'tax_ids': [branch_purchase_tax.id]}]}, 'lines[0].tax_ids'),
            ({'lines': [{**line, 'account_id': unrelated_account.id}]}, 'lines[0].account_id'),
            ({'lines': [{**line, 'analytic_distribution': {str(foreign_analytic.id): 100}}]}, 'lines[0].analytic_distribution'),
            ({'partner_id': unrelated_partner.id}, 'partner_id'),
        ):
            with self.subTest(field=field, payload=payload):
                response = self.api('PATCH', route, json=payload)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(response.json().get('field'), field, response.text)
        self.branch_invoice.invalidate_recordset()
        self.assertEqual(self.branch_invoice.company_id, self.branch)
        self.assertEqual(self.branch_invoice.partner_id, parent_partner)

    def _grant_owner_mutations(self):
        # Give both companies actual Finance grants: an unrelated reference is
        # still incompatible even when the actor can read and manage it.
        self.manager.company_ids = [Command.set((self.company | self.branch | self.other_company).ids)]
        for company in self.branch | self.other_company:
            self.env['liwan.access.assignment']._liwan_access_create({
                'user_id': self.manager.id, 'role_id': self.env.ref('liwan_finance.role_finance_manager').id,
                'company_id': company.id,
            })

    def _owner_account(self, company, code, account_type='asset_current'):
        return self.env['account.account'].with_company(company).create({
            'name': f'Owner account {code}', 'code': code, 'account_type': account_type,
            'company_ids': [Command.set(company.ids)],
        })

    def _owner_journal(self, company, code):
        return self.env['account.journal'].with_company(company).create({
            'name': f'Owner journal {code}', 'code': code, 'type': 'general', 'company_id': company.id,
        })

    def _assert_invalid_reference(self, method, route, payload, field):
        response = self.api(method, route, json=payload)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json().get('field'), field, response.text)

    def test_branch_journal_uses_owner_accounts_and_code_namespace(self):
        self._grant_owner_mutations()
        journal = self._owner_journal(self.branch, 'OWNJ')
        parent = self._owner_journal(self.company, 'PARJ')
        duplicate = self._owner_journal(self.branch, 'DUPJ')
        branch_account = self._owner_account(self.branch, '991001')
        ancestor_account = self._owner_account(self.company, '991002')
        foreign_account = self._owner_account(self.other_company, '991003')
        route = f'/api/v1/finance/journals/{journal.id}'
        # A parent journal's code is free in its branch; a branch duplicate is not.
        response = self.api('PATCH', route, json={'code': parent.code, 'default_account_id': branch_account.id})
        self.assertEqual(response.status_code, 200, response.text)
        journal.invalidate_recordset()
        self.assertEqual((journal.company_id, journal.code, journal.default_account_id),
                         (self.branch, parent.code, branch_account))
        self._assert_invalid_reference('PATCH', route, {'code': duplicate.code}, 'code')
        response = self.api('PATCH', route, json={'default_account_id': ancestor_account.id})
        self.assertEqual(response.status_code, 200, response.text)
        self._assert_invalid_reference('PATCH', route, {'default_account_id': foreign_account.id}, 'default_account_id')
        self.assertEqual(self.manager.company_id, self.company)

    def test_branch_tax_account_uses_tax_owner_and_native_ancestor_compatibility(self):
        self._grant_owner_mutations()
        tax = self.env['account.tax'].with_company(self.branch).create({
            'name': 'Owner tax', 'company_id': self.branch.id, 'amount': 15, 'type_tax_use': 'sale',
        })
        route = f'/api/v1/finance/taxes/{tax.id}'
        for company, code in ((self.branch, '992001'), (self.company, '992002')):
            account = self._owner_account(company, code, 'liability_current')
            response = self.api('PATCH', route, json={'tax_account_id': account.id})
            self.assertEqual(response.status_code, 200, response.text)
            tax.invalidate_recordset()
            self.assertEqual(tax.invoice_repartition_line_ids.filtered(lambda line: line.repartition_type == 'tax').account_id, account)
            self.assertEqual(tax.refund_repartition_line_ids.filtered(lambda line: line.repartition_type == 'tax').account_id, account)
            self.assertEqual(tax.company_id, self.branch)
        foreign = self._owner_account(self.other_company, '992003', 'liability_current')
        self._assert_invalid_reference('PATCH', route, {'tax_account_id': foreign.id}, 'tax_account_id')
        self.assertEqual(self.manager.company_id, self.company)

    def _branch_asset_profile(self):
        return self.env['account.asset.profile'].with_company(self.branch).create({
            'name': 'Owner asset profile', 'company_id': self.branch.id,
            'account_asset_id': self._owner_account(self.branch, '993001', 'asset_fixed').id,
            'account_depreciation_id': self._owner_account(self.branch, '993002', 'asset_fixed').id,
            'account_expense_depreciation_id': self._owner_account(self.branch, '993003', 'expense_depreciation').id,
            'journal_id': self._owner_journal(self.branch, 'APBR').id,
            'method': 'linear', 'method_time': 'year', 'method_number': 5, 'method_period': 'year',
        })

    def test_parent_asset_patch_resolves_profile_and_partner_in_the_asset_owner(self):
        self._grant_owner_mutations()
        old_profile = self._branch_asset_profile()
        new_profile = old_profile.copy({'name': 'Second owner asset profile'})
        asset = self.env['account.asset'].with_company(self.branch).create({
            'name': 'Branch desk', 'company_id': self.branch.id, 'profile_id': old_profile.id,
            'purchase_value': 500, 'date_start': '2026-01-01',
        })
        branch_partner = self.env['res.partner'].create({'name': 'Branch vendor', 'company_id': self.branch.id})
        route = f'/api/v1/finance/assets/{asset.id}'
        response = self.api('PATCH', route, json={'profile_id': new_profile.id, 'partner_id': branch_partner.id})
        self.assertEqual(response.status_code, 200, response.text)
        asset.invalidate_recordset()
        self.assertEqual((asset.company_id, asset.profile_id, asset.partner_id), (self.branch, new_profile, branch_partner))

    def test_branch_asset_profile_validates_references_for_profile_company(self):
        self._grant_owner_mutations()
        profile = self._branch_asset_profile()
        route = f'/api/v1/finance/asset-profiles/{profile.id}'
        branch_account = self._owner_account(self.branch, '994001', 'asset_fixed')
        branch_journal = self._owner_journal(self.branch, '994J')
        response = self.api('PATCH', route, json={'asset_account_id': branch_account.id, 'journal_id': branch_journal.id})
        self.assertEqual(response.status_code, 200, response.text)
        profile.invalidate_recordset()
        self.assertEqual((profile.company_id, profile.account_asset_id, profile.journal_id),
                         (self.branch, branch_account, branch_journal))

        # Ancestor references remain valid where there is no child-profile
        # inverse: the depreciation account and general journal are compatible.
        ancestor_depreciation = self._owner_account(self.company, '995001', 'asset_fixed')
        ancestor_journal = self._owner_journal(self.company, '995J')
        response = self.api('PATCH', route, json={
            'depreciation_account_id': ancestor_depreciation.id, 'journal_id': ancestor_journal.id,
        })
        self.assertEqual(response.status_code, 200, response.text)
        profile.invalidate_recordset()
        self.assertEqual(profile.account_depreciation_id, ancestor_depreciation)
        self.assertEqual(profile.journal_id, ancestor_journal)

        # OCA also writes account.asset_profile_id. Parent-only membership is
        # forward-compatible, but the child profile is not inverse-compatible.
        parent_only = self._owner_account(self.company, '995002', 'asset_fixed')
        self.assertTrue(parent_only.filtered_domain(parent_only._check_company_domain(self.branch)))
        self.assertFalse(profile.filtered_domain(profile._check_company_domain(parent_only.company_ids)))
        response = self.api('PATCH', route, json={'asset_account_id': parent_only.id})
        self.assertEqual((response.status_code, response.json().get('code')), (422, 'invalid'), response.text)
        profile.invalidate_recordset()
        parent_only.invalidate_recordset()
        self.assertEqual(profile.account_asset_id, branch_account)
        self.assertFalse(parent_only.asset_profile_id)

        shared = self._owner_account(self.company, '995003', 'asset_fixed')
        shared.company_ids = [Command.set((self.company | self.branch).ids)]
        self.assertTrue(profile.filtered_domain(profile._check_company_domain(shared.company_ids)))
        response = self.api('PATCH', route, json={'asset_account_id': shared.id})
        self.assertEqual(response.status_code, 200, response.text)
        profile.invalidate_recordset()
        shared.invalidate_recordset()
        self.assertEqual(profile.account_asset_id, shared)
        self.assertEqual(shared.asset_profile_id, profile)
        foreign = self._owner_account(self.other_company, '996001', 'asset_fixed')
        foreign_journal = self._owner_journal(self.other_company, 'FORJ')
        self._assert_invalid_reference('PATCH', route, {'asset_account_id': foreign.id}, 'asset_account_id')
        self._assert_invalid_reference('PATCH', route, {'journal_id': foreign_journal.id}, 'journal_id')
        self.assertEqual(self.manager.company_id, self.company)

    def test_branch_asset_disposal_accepts_owner_accounts_and_rejects_unrelated_accounts(self):
        self._grant_owner_mutations()
        profile = self._branch_asset_profile()
        accounts = {
            'sale_account_id': self._owner_account(self.branch, '997001').id,
            'plus_account_id': self._owner_account(self.branch, '997002', 'income').id,
            'min_account_id': self._owner_account(self.branch, '997003', 'expense').id,
        }
        foreign = self._owner_account(self.other_company, '997004')
        asset = self.env['account.asset'].with_company(self.branch).create({
            'name': 'Branch disposal', 'profile_id': profile.id, 'purchase_value': 1000, 'date_start': '2026-01-01',
        })
        asset.validate()
        route = f'/api/v1/finance/assets/{asset.id}/dispose'
        payload = {'date_remove': '2026-10-18', 'sale_value': 100, **accounts}
        for field in accounts:
            self._assert_invalid_reference('POST', route, {**payload, field: foreign.id}, field)
        response = self.api('POST', route, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        asset.invalidate_recordset()
        removal = asset.depreciation_line_ids.filtered(lambda line: line.type == 'remove').move_id
        self.assertTrue(removal)
        self.assertEqual(removal.company_id, self.branch)
        self.assertEqual(removal.state, 'posted')
        ancestor_asset = self.env['account.asset'].with_company(self.branch).create({
            'name': 'Ancestor account disposal', 'profile_id': profile.id,
            'purchase_value': 1000, 'date_start': '2026-01-01',
        })
        ancestor_asset.validate()
        ancestor_accounts = {
            'sale_account_id': self._owner_account(self.company, '997005').id,
            'plus_account_id': self._owner_account(self.company, '997006', 'income').id,
            'min_account_id': self._owner_account(self.company, '997007', 'expense').id,
        }
        response = self.api('POST', f'/api/v1/finance/assets/{ancestor_asset.id}/dispose',
                            json={**payload, **ancestor_accounts})
        self.assertEqual(response.status_code, 200, response.text)
        ancestor_asset.invalidate_recordset()
        self.assertEqual(ancestor_asset.company_id, self.branch)
        self.assertEqual(self.manager.company_id, self.company)

    def test_branch_only_actor_needs_visible_chart_references_without_parent_grant(self):
        self.env['liwan.access.assignment']._liwan_access_create({
            'user_id': self.manager.id, 'role_id': self.env.ref('liwan_finance.role_finance_manager').id,
            'company_id': self.branch.id,
        })
        self.env['liwan.access.assignment'].search([
            ('user_id', '=', self.manager.id), ('company_id', '=', self.company.id),
        ])._liwan_access_unlink()
        self.assertFalse(self.env['liwan.access.service'].with_company(self.company)._liwan_has_capability(
            self.manager, 'finance.invoices.manage', company=self.company,
        ))
        branch_account = self._owner_account(self.branch, '987651', 'income')
        parent_account = self._owner_account(self.company, '987652', 'income')
        branch_journal = self.env['account.journal'].with_company(self.branch).create({
            'name': 'Branch-only Sales', 'code': 'BOSL', 'type': 'sale', 'company_id': self.branch.id,
        })
        self.assertTrue(parent_account.filtered_domain(parent_account._check_company_domain(self.branch)))
        self.assertNotIn(self.branch, parent_account.company_ids)
        line = {'name': 'Branch-only sale', 'quantity': 1, 'price_unit': 100,
                'account_id': branch_account.id, 'tax_ids': []}
        route = f'/api/v1/finance/invoices/{self.branch_invoice.id}'
        self.branch_invoice.write({'journal_id': branch_journal.id})
        response = self.api('PATCH', route, json={'lines': [line]})
        self.assertEqual(response.status_code, 200, response.text)
        # Compatibility is not a permission grant to parent-only chart data.
        self._assert_invalid_reference('PATCH', route, {'lines': [{**line, 'account_id': parent_account.id}]},
                                       'lines[0].account_id')
        response = self.api('GET', f'/api/v1/finance/invoices/{self.invoice.id}')
        self.assertEqual(response.status_code, 404, response.text)
        parent_account.invalidate_recordset()
        self.assertEqual(parent_account.company_ids, self.company)
        self.assertEqual(self.manager.company_id, self.company)

    def test_branch_payment_registration_uses_invoice_owner_and_rejects_sibling_journal(self):
        self._grant_owner_mutations()
        sibling = self.env['res.company'].create({'name': 'Finance Payment Sibling', 'parent_id': self.company.id})
        self.manager.company_ids = [Command.link(sibling.id)]
        self.env['liwan.access.assignment']._liwan_access_create({
            'user_id': self.manager.id, 'role_id': self.env.ref('liwan_finance.role_finance_manager').id,
            'company_id': sibling.id,
        })
        branch_journal, sibling_journal = self.env['account.journal'].create([
            {'name': 'Branch Payment Bank', 'code': 'BRPM', 'type': 'bank', 'company_id': self.branch.id},
            {'name': 'Sibling Payment Bank', 'code': 'SBPM', 'type': 'bank', 'company_id': sibling.id},
        ])
        self.branch_invoice.action_post()
        payload = {'invoice_ids': self.branch_invoice.ids, 'amount': self.branch_invoice.amount_residual,
                   'payment_date': '2026-10-19', 'journal_id': branch_journal.id}
        route = '/api/v1/finance/payments'
        self._assert_invalid_reference('POST', route, {**payload, 'journal_id': sibling_journal.id}, 'journal_id')
        response = self.api('POST', route, json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        payment = self.env['account.payment'].browse(response.json()['id'])
        self.assertEqual(payment.company_id, self.branch)
        self.assertEqual(payment.journal_id, branch_journal)
        self.branch_invoice.invalidate_recordset()
        self.assertEqual(self.branch_invoice.amount_residual, 0)
        self.assertEqual(self.manager.company_id, self.company)

    def test_branch_entry_patch_validates_all_line_references_for_entry_owner(self):
        self._grant_owner_mutations()
        journal = self._owner_journal(self.branch, 'ENTB')
        debit = self._owner_account(self.branch, '998001')
        credit = self._owner_account(self.branch, '998002', 'income')
        entry = self.env['account.move'].with_company(self.branch).create({
            'move_type': 'entry', 'company_id': self.branch.id, 'journal_id': journal.id, 'date': '2026-10-18',
            'line_ids': [Command.create({'name': 'Owner debit', 'account_id': debit.id, 'debit': 10}),
                         Command.create({'name': 'Owner credit', 'account_id': credit.id, 'credit': 10})],
        })
        partner = self.env['res.partner'].create({'name': 'Owner entry partner', 'company_id': self.branch.id})
        plan = self.env['account.analytic.plan'].create({'name': 'Owner entry plan'})
        analytic = self.env['account.analytic.account'].create({
            'name': 'Owner entry analytic', 'plan_id': plan.id, 'company_id': self.branch.id,
        })
        route = f'/api/v1/finance/entries/{entry.id}'
        lines = [{'name': 'Owner debit', 'account_id': debit.id, 'debit': 10, 'credit': 0,
                  'partner_id': partner.id, 'analytic_distribution': {str(analytic.id): 100}},
                 {'name': 'Owner credit', 'account_id': credit.id, 'debit': 0, 'credit': 10}]
        response = self.api('PATCH', route, json={'journal_id': journal.id, 'lines': lines})
        self.assertEqual(response.status_code, 200, response.text)
        entry.invalidate_recordset()
        self.assertEqual(entry.company_id, self.branch)
        self.assertEqual(entry.line_ids.account_id, debit | credit)
        ancestor_account = self._owner_account(self.company, '998004')
        ancestor_journal = self._owner_journal(self.company, 'ENTA')
        ancestor_analytic = self.env['account.analytic.account'].create({
            'name': 'Ancestor entry analytic', 'plan_id': plan.id, 'company_id': self.company.id,
        })
        response = self.api('PATCH', route, json={
            'journal_id': ancestor_journal.id,
            'lines': [{**lines[0], 'account_id': ancestor_account.id,
                       'analytic_distribution': {str(ancestor_analytic.id): 100}}, lines[1]],
        })
        self.assertEqual(response.status_code, 200, response.text)
        entry.invalidate_recordset()
        self.assertEqual(entry.company_id, self.branch)
        foreign_account = self._owner_account(self.other_company, '998003')
        foreign_journal = self._owner_journal(self.other_company, 'ENTF')
        foreign_analytic = self.env['account.analytic.account'].create({
            'name': 'Foreign entry analytic', 'plan_id': plan.id, 'company_id': self.other_company.id,
        })
        foreign_partner = self.env['res.partner'].create({'name': 'Foreign entry partner', 'company_id': self.other_company.id})
        for values, field in (
            ({'account_id': foreign_account.id}, 'lines[0].account_id'),
            ({'partner_id': foreign_partner.id}, 'lines[0].partner_id'),
            ({'analytic_distribution': {str(foreign_analytic.id): 100}}, 'lines[0].analytic_distribution'),
        ):
            self._assert_invalid_reference('PATCH', route, {'lines': [{**lines[0], **values}, lines[1]]}, field)
        self._assert_invalid_reference('PATCH', route, {'journal_id': foreign_journal.id}, 'journal_id')
        self.assertEqual(self.manager.company_id, self.company)

    def _branch_payment_lifecycle_grant(self):
        return self.env['liwan.access.assignment']._liwan_access_create({
            'user_id': self.manager.id, 'role_id': self.env.ref('liwan_finance.role_finance_manager').id,
            'company_id': self.branch.id,
        })

    def _configure_lifecycle_payment_journal(self, journal):
        # Stock recomputes the payment's outstanding account from its method
        # line after journal edits; fresh branch journals need this setup too.
        self.assertTrue(journal.default_account_id)
        methods = journal.inbound_payment_method_line_ids | journal.outbound_payment_method_line_ids
        self.assertTrue(methods)
        methods.write({'payment_account_id': journal.default_account_id.id})

    def _payment_lifecycle_fixture(self, company=None, payment_type='inbound', journal=None, amount=1000):
        company = company or self.branch
        journal = journal or self.env['account.journal'].with_company(company).create({
            'name': 'Payment lifecycle bank', 'code': 'PLBK', 'type': 'bank', 'company_id': company.id,
        })
        self._configure_lifecycle_payment_journal(journal)
        partner = self.partner.with_company(company)
        if not partner.property_account_receivable_id:
            receivable = self.env['account.account'].search([
                *self.env['account.account']._check_company_domain(company),
                ('account_type', '=', 'asset_receivable'),
            ], limit=1)
            self.assertTrue(receivable)
            partner.property_account_receivable_id = receivable
        payment = self.env['account.payment'].with_company(company).create({
            'company_id': company.id, 'journal_id': journal.id, 'partner_id': self.partner.id,
            'partner_type': 'customer', 'payment_type': payment_type, 'amount': amount,
            'date': '2026-10-19', 'memo': 'Payment lifecycle fixture',
        })
        return payment, journal

    def _register_branch_lifecycle_payment(self):
        assignment = self._branch_payment_lifecycle_grant()
        journal = self.env['account.journal'].with_company(self.branch).create({
            'name': 'Registered lifecycle bank', 'code': 'LCRB', 'type': 'bank', 'company_id': self.branch.id,
        })
        self._configure_lifecycle_payment_journal(journal)
        self.branch_invoice.action_post()
        response = self.api('POST', '/api/v1/finance/payments', json={
            'invoice_ids': self.branch_invoice.ids, 'amount': self.branch_invoice.amount_residual,
            'payment_date': '2026-10-19', 'journal_id': journal.id,
        })
        self.assertEqual(response.status_code, 201, response.text)
        return self.env['account.payment'].browse(response.json()['id']), assignment, journal

    def _lifecycle_payment_rows(self, query=''):
        response = self.api('GET', '/api/v1/finance/payments' + query)
        self.assertEqual(response.status_code, 200, response.text)
        return {row['id']: row for row in response.json()['items']}

    def _assert_payment_lifecycle_hidden(self, payment):
        path = f'/api/v1/finance/payments/{payment.id}'
        for method, suffix, payload in (
            ('PATCH', '', {'memo': 'must stay hidden'}),
            ('POST', '/cancel', {}), ('POST', '/reset-to-draft', {}), ('POST', '/post', {}),
            ('POST', '/allocate', {'invoice_ids': self.branch_invoice.ids}), ('POST', '/unallocate', {}),
        ):
            with self.subTest(payment=payment.id, method=method, suffix=suffix):
                response = self.api(method, path + suffix, json=payload)
                self.assertEqual((response.status_code, response.json().get('code')), (404, 'not_found'), response.text)

    def test_registered_branch_payment_remains_reachable_through_its_lifecycle(self):
        payment, _assignment, journal = self._register_branch_lifecycle_payment()
        path = f'/api/v1/finance/payments/{payment.id}'
        amount = self.branch_invoice.amount_total
        rows = self._lifecycle_payment_rows()
        self.assertIn(payment.id, rows)
        self.assertEqual((rows[payment.id]['journal']['id'], rows[payment.id]['amount']), (journal.id, amount))
        response = self.api('POST', path + '/unallocate', json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['unallocated'], amount)
        response = self.api('POST', path + '/allocate', json={'invoice_ids': self.branch_invoice.ids})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['unallocated'], 0)
        response = self.api('POST', path + '/cancel', json={})
        self.assertEqual((response.status_code, response.json().get('state')), (200, 'canceled'), response.text)
        response = self.api('POST', path + '/reset-to-draft', json={})
        self.assertEqual((response.status_code, response.json().get('state')), (200, 'draft'), response.text)
        response = self.api('PATCH', path, json={
            'journal_id': journal.id, 'payment_date': '2026-10-20', 'memo': 'Branch lifecycle corrected',
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()['journal']['id'], response.json()['date']), (journal.id, '2026-10-20'))
        response = self.api('POST', path + '/post', json={})
        self.assertEqual(response.status_code, 200, response.text)
        response = self.api('POST', path + '/allocate', json={'invoice_ids': self.branch_invoice.ids})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['unallocated'], 0)
        self.assertIn(payment.id, self._lifecycle_payment_rows('?q=Branch%20lifecycle%20corrected'))
        payment.invalidate_recordset()
        self.assertEqual(payment.company_id, self.branch)
        self.assertEqual(self.manager.company_id, self.company)

    def test_parent_payment_grant_and_membership_do_not_reveal_branch_or_foreign_payments(self):
        branch_payment, _journal = self._payment_lifecycle_fixture()
        current_payment, _journal = self._payment_lifecycle_fixture(company=self.company)
        foreign_payment, _journal = self._payment_lifecycle_fixture(company=self.other_company)
        self.manager.company_ids = [Command.link(self.other_company.id)]
        rows = self._lifecycle_payment_rows()
        self.assertIn(current_payment.id, rows)
        self.assertNotIn(branch_payment.id, rows)
        self.assertNotIn(foreign_payment.id, rows)
        self._assert_payment_lifecycle_hidden(branch_payment)
        self._assert_payment_lifecycle_hidden(foreign_payment)

    def test_branch_payment_read_grant_does_not_borrow_parent_manage_grant(self):
        payment, journal = self._payment_lifecycle_fixture()
        role = self.env['liwan.access.role'].with_company(self.branch)._liwan_access_create({
            'key': 'branch_lifecycle_payment_reader', 'name_ar': 'Branch payment reader',
            'permission_ids': [Command.set(self.env['liwan.access.permission'].search([
                ('key', '=', 'finance.payments.read'),
            ]).ids)],
        })
        self.env['liwan.access.assignment']._liwan_access_create({
            'user_id': self.manager.id, 'role_id': role.id, 'company_id': self.branch.id,
        })
        self.assertIn(payment.id, self._lifecycle_payment_rows())
        self._assert_payment_lifecycle_hidden(payment)
        # Standalone creation remains owned by the current company.
        self._assert_invalid_reference('POST', '/api/v1/finance/payments/standalone', {
            'partner_id': self.partner.id, 'journal_id': journal.id, 'payment_type': 'inbound',
            'amount': 10, 'payment_date': '2026-10-19',
        }, 'journal_id')

    def test_revoking_branch_payment_grant_denies_warmed_read_and_write_scopes(self):
        payment, assignment, _journal = self._register_branch_lifecycle_payment()
        self.assertIn(payment.id, self._lifecycle_payment_rows())
        response = self.api('POST', f'/api/v1/finance/payments/{payment.id}/unallocate', json={})
        self.assertEqual(response.status_code, 200, response.text)
        assignment._liwan_access_unlink()
        self.assertNotIn(payment.id, self._lifecycle_payment_rows())
        self._assert_payment_lifecycle_hidden(payment)
        self.assertEqual(self.manager.company_id, self.company)

    def test_branch_payment_changes_use_its_own_period_locks(self):
        self._branch_payment_lifecycle_grant()
        payment, _journal = self._payment_lifecycle_fixture()
        self.branch.fiscalyear_lock_date = '2026-10-31'
        path = f'/api/v1/finance/payments/{payment.id}'
        response = self.api('POST', path + '/post', json={})
        self.assertEqual((response.status_code, response.json().get('code')), (422, 'period_locked'), response.text)
        response = self.api('PATCH', path, json={'payment_date': '2026-10-20'})
        self.assertEqual((response.status_code, response.json().get('code'), response.json().get('field')),
                         (422, 'period_locked', 'payment_date'), response.text)
        payment.invalidate_recordset()
        self.assertEqual(payment.state, 'draft')
        self.assertEqual(payment.date.isoformat(), '2026-10-19')

    def test_branch_payment_refund_allocation_uses_only_authorized_target_companies(self):
        payment, _assignment, journal = self._register_branch_lifecycle_payment()
        path = f'/api/v1/finance/payments/{payment.id}'
        response = self.api('POST', path + '/unallocate', json={})
        self.assertEqual(response.status_code, 200, response.text)
        refund, _journal = self._payment_lifecycle_fixture(payment_type='outbound', journal=journal, amount=payment.amount)
        refund.action_post()
        sibling = self.env['res.company'].create({'name': 'Unmanaged payment sibling', 'parent_id': self.company.id})
        self.manager.company_ids = [Command.link(sibling.id)]
        unmanaged_refund, _journal = self._payment_lifecycle_fixture(company=sibling, payment_type='outbound', amount=payment.amount)
        unmanaged_refund.action_post()
        self._assert_invalid_reference('POST', path + '/allocate', {'payment_ids': unmanaged_refund.ids}, 'payment_ids')
        response = self.api('POST', path + '/allocate', json={'payment_ids': refund.ids})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['unallocated'], 0)
        rows = self._lifecycle_payment_rows()
        self.assertEqual(rows[refund.id]['unallocated'], 0)
        self.assertNotIn(unmanaged_refund.id, rows)
        self.assertEqual(self.manager.company_id, self.company)

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
        """A cached native _inherits rule must not retain an earlier LiwanOS fence."""
        bank_reader = self.env['liwan.access.role'].with_company(self.branch)._liwan_access_create({
            'key': 'finance_branch_bank_reader', 'name_ar': 'قارئ بنك الفرع',
            'permission_ids': [Command.set(self.env['liwan.access.permission'].search([
                ('key', '=', 'finance.bank.read'),
            ]).ids)],
        })
        self.env['liwan.access.assignment']._liwan_access_create({
            'user_id': self.manager.id, 'role_id': bank_reader.id, 'company_id': self.branch.id,
        })
        journal = self.env['account.journal'].with_company(self.branch).create({
            'name': 'Branch Bank', 'code': 'BRBK', 'type': 'bank', 'company_id': self.branch.id,
        })
        line = self.env['account.bank.statement.line'].with_company(self.branch).create({
            'journal_id': journal.id, 'date': '2026-10-18', 'payment_ref': 'Branch deposit', 'amount': 10,
        })
        policy = self.env['liwan.access.service'].with_company(self.company)

        def set_mode(mode):
            current = policy._liwan_branch_policy()
            policy._liwan_update_branch_policy(current['version'], mode, [])

        # Keep the same user and ordinary ORM environment across transitions. A
        # caller's broad membership context cannot widen the owning policy.
        statement_lines = line.with_user(self.manager).with_context(
            allowed_company_ids=(self.company | self.branch).ids,
            liwan_capability_scope=((('finance.bank.read',), 'all'),),
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
