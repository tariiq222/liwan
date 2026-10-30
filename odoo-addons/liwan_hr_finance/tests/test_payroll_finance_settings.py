# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import COST_CENTERS, SETTINGS, PayrollFinanceCase

ACCOUNT_KEYS = {
    'basic_expense', 'allowance_expense', 'variable_expense', 'gosi_expense', 'gosi_payable',
    'salaries_payable', 'deduction', 'advance', 'eos_expense', 'eos_provision',
}
SETTINGS_KEYS = {'journal', 'accounts', 'default_analytic_account', 'entry_detail'}


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollFinanceSettings(PayrollFinanceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.payroll_config = cls.user_with('pf_config', ['hr.payroll.read', 'hr.payroll.config', 'hr.employees.read'])
        cls.accountant = cls.user_with('pf_accountant', ['finance.setup.read'])
        cls.payroll_finance_manager = cls.user_with('pf_finance_manager', [
            'hr.payroll.finance.manage', 'hr.payroll.read', 'hr.employees.read',
        ])
        cls.unrelated = cls.user_with('pf_unrelated', ['hr.employees.read'])
        cls.cost_center_reader = cls.user_with('pf_cc_reader', [
            'hr.payroll.read', 'hr.employees.read', 'hr.departments.read', 'finance.analytic.read',
        ])
        cls.cost_center_manager = cls.user_with('pf_cc_manager', [
            'hr.departments.read', 'finance.analytic.read', 'finance.analytic.manage',
        ])
        cls.sales = cls.make_department('Payroll Sales')
        cls.support = cls.make_department('Payroll Support')

    def test_bridge_auto_installs(self):
        modules = self.env['ir.module.module'].search([
            ('name', 'in', ['liwan_hr', 'liwan_finance', 'liwan_hr_finance']),
        ])
        self.assertEqual(set(modules.mapped('state')), {'installed'})
        self.assertEqual(len(modules), 3)

    def test_default_entry_detail_is_aggregated(self):
        self.env['liwan.hr.payroll.finance.settings'].search([]).unlink()
        self.login_as(self.payroll_officer)
        res = self.api('GET', SETTINGS)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), SETTINGS_KEYS)
        self.assertEqual(body['entry_detail'], 'aggregated')
        self.assertEqual(set(body['accounts']), ACCOUNT_KEYS)
        self.assertIsNone(body['journal'])
        self.assertTrue(all(value is None for value in body['accounts'].values()))
        self.assertFalse(self.env['liwan.hr.payroll.finance.settings'].search_count([]))

    def test_payroll_and_finance_managers_can_edit_settings(self):
        body = {'accounts': {'salaries_payable': self.accounts['salaries_payable'].id}}
        for user in (self.payroll_config, self.accountant, self.unrelated):
            self.login_as(user)
            self.assertRefused(self.api('PATCH', SETTINGS, json=body), 403, 'forbidden')
        self.login_as(self.payroll_finance_manager)
        payroll_response = self.api('PATCH', SETTINGS, json=body)
        self.assertEqual(payroll_response.status_code, 200, payroll_response.text)
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        res = self.api('PATCH', SETTINGS, json={
            **body, 'journal_id': self.general_journal.id, 'entry_detail': 'per_employee',
            'default_analytic_account_id': self.riyadh.id,
        })
        self.assertEqual(res.status_code, 200, res.text)
        saved = res.json()
        self.assertEqual(set(saved), SETTINGS_KEYS)
        self.assertEqual(saved['accounts']['salaries_payable']['id'], self.accounts['salaries_payable'].id)
        self.assertEqual(saved['journal']['id'], self.general_journal.id)
        self.assertEqual(saved['default_analytic_account']['id'], self.riyadh.id)
        self.assertEqual(saved['entry_detail'], 'per_employee')
        self.assertEqual(
            self.env['liwan.hr.payroll.finance.settings'].search_count([('company_id', '=', self.company.id)]), 1,
        )
        # A partial save keeps what it does not name; null clears one account.
        res = self.api('PATCH', SETTINGS, json={'accounts': {'advance': self.accounts['advance'].id}})
        self.assertEqual(res.json()['accounts']['salaries_payable']['id'], self.accounts['salaries_payable'].id)
        res = self.api('PATCH', SETTINGS, json={'accounts': {'salaries_payable': None}})
        self.assertIsNone(res.json()['accounts']['salaries_payable'])
        self.assertEqual(res.json()['accounts']['advance']['id'], self.accounts['advance'].id)

    def test_settings_readers(self):
        self.full_settings()
        for user in (self.payroll_config, self.accountant, self.payroll_finance_manager):
            self.login_as(user)
            self.assertEqual(self.api('GET', SETTINGS).status_code, 200, user.login)
        self.login_as(self.unrelated)
        self.assertRefused(self.api('GET', SETTINGS), 403, 'forbidden')
        self.authenticate('finance_outsider', 'finance_outsider_pass_123')
        self.assertRefused(self.api('GET', SETTINGS), 403, 'forbidden')

    def test_accounts_must_belong_to_company(self):
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        res = self.api('PATCH', SETTINGS, json={'accounts': {'salaries_payable': self.foreign_account.id}})
        self.assertRefused(res, 422, 'invalid', field='accounts.salaries_payable')
        res = self.api('PATCH', SETTINGS, json={'accounts': {'basic_expense': self.foreign_account.id}})
        self.assertRefused(res, 422, 'invalid', field='accounts.basic_expense')
        res = self.api('PATCH', SETTINGS, json={'accounts': {'gosi_expense': 0}})
        self.assertRefused(res, 422, 'invalid', field='accounts.gosi_expense')
        res = self.api('PATCH', SETTINGS, json={'journal_id': self._journal(self.other_company, 'general').id})
        self.assertRefused(res, 422, 'invalid', field='journal_id')
        res = self.api('PATCH', SETTINGS, json={'default_analytic_account_id': self.other_branch.id})
        self.assertRefused(res, 422, 'invalid', field='default_analytic_account_id')
        res = self.api('PATCH', SETTINGS, json={'accounts': {'unknown_role': 1}})
        self.assertRefused(res, 422, 'invalid', field='accounts.unknown_role')

    def test_payable_accounts_must_reconcile(self):
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        not_reconcilable = self.env['account.account'].search([
            ('company_ids', 'in', self.company.ids), ('reconcile', '=', False), ('account_type', '=', 'expense'),
        ], limit=1)
        for role in ('salaries_payable', 'advance'):
            res = self.api('PATCH', SETTINGS, json={'accounts': {role: not_reconcilable.id}})
            self.assertRefused(res, 422, 'invalid', field=f'accounts.{role}')

    def test_entry_detail_values(self):
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        res = self.api('PATCH', SETTINGS, json={'entry_detail': 'monthly'})
        self.assertRefused(res, 422, 'invalid', field='entry_detail')
        res = self.api('PATCH', SETTINGS, json={})
        self.assertRefused(res, 422, 'invalid')

    def test_empty_accounts_body_is_refused(self):
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        stored = self.env['liwan.hr.payroll.finance.settings']
        before = stored.search_count([('company_id', '=', self.company.id)])
        res = self.api('PATCH', SETTINGS, json={'accounts': {}})
        self.assertRefused(res, 422, 'invalid')
        self.assertEqual(stored.search_count([('company_id', '=', self.company.id)]), before)

    def test_cost_center_list_covers_every_department(self):
        self.login_as(self.cost_center_reader)
        res = self.api('GET', COST_CENTERS)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), {'items', 'total'})
        departments = self.env['hr.department'].search([('company_id', '=', self.company.id)])
        self.assertEqual(body['total'], len(departments))
        self.assertEqual({item['department']['id'] for item in body['items']}, set(departments.ids))
        self.assertTrue(all(set(item) == {'department', 'analytic_account'} for item in body['items']))
        self.assertTrue(all(item['analytic_account'] is None for item in body['items']))
        self.assertNotIn(self.make_department('Other Co Dept', self.other_company).id, [i['department']['id'] for i in body['items']])

    def test_cost_center_mapping_needs_analytic_manage(self):
        path = f'{COST_CENTERS}/{self.sales.id}'
        self.login_as(self.cost_center_reader)
        self.assertRefused(self.api('PUT', path, json={'analytic_account_id': self.riyadh.id}), 403, 'forbidden')
        self.login_as(self.cost_center_manager)
        res = self.api('PUT', path, json={'analytic_account_id': self.riyadh.id})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['department']['id'], self.sales.id)
        self.assertEqual(res.json()['analytic_account']['id'], self.riyadh.id)
        res = self.api('PUT', path, json={'analytic_account_id': self.jeddah.id})
        self.assertEqual(res.json()['analytic_account']['id'], self.jeddah.id)
        self.assertEqual(self.env['liwan.hr.payroll.cost.center'].search_count([('department_id', '=', self.sales.id)]), 1)
        res = self.api('PUT', path, json={'analytic_account_id': None})
        self.assertIsNone(res.json()['analytic_account'])
        listed = {i['department']['id']: i['analytic_account'] for i in self.api('GET', COST_CENTERS).json()['items']}
        self.assertIsNone(listed[self.sales.id])

    def test_cost_center_mapping_refuses_foreign_records(self):
        self.login_as(self.cost_center_manager)
        res = self.api('PUT', f'{COST_CENTERS}/{self.sales.id}', json={'analytic_account_id': self.other_branch.id})
        self.assertRefused(res, 422, 'invalid', field='analytic_account_id')
        res = self.api('PUT', f'{COST_CENTERS}/{self.sales.id}', json={'analytic_account_id': self.shared.id})
        self.assertRefused(res, 422, 'invalid', field='analytic_account_id')
        foreign = self.make_department('Foreign Dept', self.other_company)
        res = self.api('PUT', f'{COST_CENTERS}/{foreign.id}', json={'analytic_account_id': self.riyadh.id})
        self.assertRefused(res, 404, 'not_found')

    def test_approved_run_builder(self):
        worker = self.make_employee('Bridge Worker', self.sales)
        run = self._approved_run([worker], '2026-11')
        self.assertEqual(run['state'], 'approved')

    def test_a_foreign_currency_journal_is_refused(self):
        foreign = self.env['res.currency'].search([('id', '!=', self.company.currency_id.id)], limit=1)
        foreign.active = True
        journal = self.general_journal.copy({'code': 'FXS', 'currency_id': foreign.id})
        with self.assertRaises(ValidationError):
            self.env['liwan.hr.payroll.finance.settings']._liwan_save(self.company, {'journal_id': journal.id})
