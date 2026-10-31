# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Every finance mutation writes one audit row (owner decision 2026-10-29, issue #166)."""
from odoo.tests import tagged

from .analytic_common import ACCOUNTS, PLANS
from .oca_common import ASSETS, BANK, BANK_LINES, LiwanFinanceOcaCase
from .write_common import PARTNERS, PAYMENTS

BUDGETS = '/api/v1/finance/budgets'
YEAR = {'date_from': '2026-01-01', 'date_to': '2026-12-31'}


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceAuditCoverage(LiwanFinanceOcaCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.asset_profile(cls.company)
        cls.expense = cls.env['account.account'].with_company(cls.company).create({
            'code': '600911', 'name': 'Audited expense', 'account_type': 'expense',
        })
        plan = cls.env['account.analytic.plan'].create({'name': 'Audit plan'})
        cls.centers = cls.env['account.analytic.account'].create([
            {'name': 'Audit A', 'plan_id': plan.id, 'company_id': cls.company.id},
            {'name': 'Audit B', 'plan_id': plan.id, 'company_id': cls.company.id},
        ])

    def events(self):
        return self.env['liwan.finance.audit.event'].search([('company_id', '=', self.company.id)], order='id')

    def call(self, method, path, status, **body):
        before = len(self.events())
        result = self.api(method, path, json=body or {})
        self.assertEqual(result.status_code, status, result.text)
        return result, self.events()[before:]

    def assertOneEvent(self, new, action, res_model=None, outcome=None):  # noqa: N802
        self.assertEqual(new.mapped('action'), [action], new.mapped('action'))
        if res_model:
            self.assertEqual(new.res_model, res_model)
        if outcome is not None:
            self.assertEqual(new.outcome, outcome)
        self.assertEqual(new.create_uid, self.manager)

    def test_payments_are_audited_from_registration_to_return(self):
        invoice = self.posted_invoice()
        result, new = self.call('POST', PAYMENTS, 201, **self.pay_body([invoice]))
        self.assertOneEvent(new, 'payment_created', 'account.payment')
        payment_id = result.json()['id']
        _result, new = self.call('POST', f'{PAYMENTS}/{payment_id}/cancel', 200)
        self.assertOneEvent(new, 'payment_cancelled', 'account.payment', 'canceled')
        _result, new = self.call('POST', f'{PAYMENTS}/{payment_id}/reset-to-draft', 200)
        self.assertOneEvent(new, 'payment_reset_to_draft', 'account.payment', 'draft')

    def test_assets_are_audited_from_creation_to_depreciation(self):
        body = {'profile_id': self.profile.id, 'name': 'Audited desk', 'purchase_value': 12000, 'date_start': '2024-01-01'}
        result, new = self.call('POST', ASSETS, 201, **body)
        self.assertOneEvent(new, 'asset_created', 'account.asset', 'draft')
        asset_id = result.json()['id']
        _result, new = self.call('POST', f'{ASSETS}/{asset_id}/validate', 200)
        self.assertOneEvent(new, 'asset_validated', 'account.asset', 'open')
        _result, new = self.call('POST', f'{ASSETS}/compute-depreciation', 200, date='2026-10-31')
        self.assertOneEvent(new, 'asset_depreciation_computed', 'res.company')
        self.assertRegex(new.outcome, r'^\d+ entries$')

    def test_partners_are_audited(self):
        result, new = self.call('POST', PARTNERS, 201, name='Audited Partner', customer=True)
        self.assertOneEvent(new, 'partner_created', 'res.partner')
        partner_id = result.json()['id']
        _result, new = self.call('PATCH', f'{PARTNERS}/{partner_id}', 200, name='Audited Partner 2')
        self.assertOneEvent(new, 'partner_changed', 'res.partner')
        self.assertIn('name', new.fields_written)
        _result, new = self.call('POST', f'{PARTNERS}/{partner_id}/archive', 200)
        self.assertOneEvent(new, 'partner_archived', 'res.partner')
        _result, new = self.call('POST', f'{PARTNERS}/{partner_id}/unarchive', 200)
        self.assertOneEvent(new, 'partner_unarchived', 'res.partner')

    def test_analytic_plans_and_accounts_are_audited(self):
        result, new = self.call('POST', PLANS, 201, name='Audited plan', parent_id=self.centers[0].plan_id.id)
        self.assertOneEvent(new, 'analytic_plan_created', 'account.analytic.plan')
        plan_id = result.json()['id']
        _result, new = self.call('PATCH', f'{PLANS}/{plan_id}', 200, name='Audited plan 2')
        self.assertOneEvent(new, 'analytic_plan_changed', 'account.analytic.plan')
        result, new = self.call('POST', ACCOUNTS, 201, name='Audited center', plan_id=plan_id)
        self.assertOneEvent(new, 'analytic_account_created', 'account.analytic.account')
        _result, new = self.call('PATCH', f'{ACCOUNTS}/{result.json()["id"]}', 200, active=False)
        self.assertOneEvent(new, 'analytic_account_changed', 'account.analytic.account')

    def test_budgets_are_audited_through_their_whole_life(self):
        result, new = self.call('POST', BUDGETS, 201, name='Audited budget', **YEAR)
        self.assertOneEvent(new, 'budget_created', 'mis.budget.by.account', 'draft')
        path = f'{BUDGETS}/{result.json()["id"]}'
        _result, new = self.call('PATCH', path, 200, name='Audited budget 2')
        self.assertOneEvent(new, 'budget_changed', 'mis.budget.by.account')
        line, new = self.call('POST', f'{path}/lines', 201, account_id=self.expense.id, amount=100)
        self.assertOneEvent(new, 'budget_line_created', 'mis.budget.by.account')
        _result, new = self.call('PATCH', f'{path}/lines/{line.json()["id"]}', 200, amount=150)
        self.assertOneEvent(new, 'budget_line_changed')
        _result, new = self.call('DELETE', f'{path}/lines/{line.json()["id"]}', 204)
        self.assertOneEvent(new, 'budget_line_deleted')
        shares = [{'analytic_account_id': self.centers[0].id, 'percent': 60}, {'analytic_account_id': self.centers[1].id, 'percent': 40}]
        _result, new = self.call('POST', f'{path}/lines/distribute', 201, account_id=self.expense.id, amount=1000, shares=shares)
        self.assertOneEvent(new, 'budget_lines_distributed', outcome='2 lines')
        for route, action, state in (
            ('confirm', 'budget_confirmed', 'confirmed'), ('cancel', 'budget_cancelled', 'cancelled'),
            ('reset-to-draft', 'budget_reset_to_draft', 'draft'),
        ):
            _result, new = self.call('POST', f'{path}/{route}', 200)
            self.assertOneEvent(new, action, 'mis.budget.by.account', state)

    def test_a_bank_statement_and_its_reconciliation_are_audited(self):
        receivable = self.invoice.line_ids.filtered(lambda line: line.account_id.account_type == 'asset_receivable')
        body = {
            'journal_id': self.bank.id, 'date': '2026-10-31', 'balance_start': 0, 'balance_end_real': 750,
            'lines': [{'date': '2026-10-25', 'payment_ref': 'Settlement', 'partner_id': self.partner.id, 'amount': 750}],
        }
        result, new = self.call('POST', BANK, 201, **body)
        self.assertOneEvent(new, 'bank_statement_created', 'account.bank.statement', '1 lines, 0 reconciled')
        line_id = result.json()['lines'][0]['id']
        _result, new = self.call('POST', f'{BANK_LINES}/{line_id}/reconcile', 200, move_line_ids=receivable.ids)
        self.assertOneEvent(new, 'bank_line_reconciled', 'account.bank.statement.line')

    def test_a_failed_mutation_leaves_no_event(self):
        before = len(self.events())
        self.assertEqual(self.api('POST', f'{PAYMENTS}/999999/cancel', json={}).status_code, 404)
        self.assertEqual(self.api('POST', BUDGETS, json={'name': 'x'}).status_code, 422)
        self.assertEqual(len(self.events()), before)

    def test_the_budget_and_partner_roles_can_write_their_events(self):
        # The row is created in the caller's own rights: the ACL of each capability group must allow it.
        acl = self.env['ir.model.access'].search([('model_id.model', '=', 'liwan.finance.audit.event'), ('perm_create', '=', True)])
        groups = acl.group_id
        for key in ('budgets', 'analytic', 'partners', 'payments', 'assets', 'bank'):
            with self.subTest(capability=key):
                self.assertIn(self.env.ref(f'liwan_finance.group_cap_finance_{key}_manage'), groups)
