# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .analytic_common import ACCOUNTS, PLANS, AnalyticCase
from .common import OUTSIDER_LOGIN, OUTSIDER_PASSWORD
from .write_common import PASSWORD
from odoo.addons.webvue_api.tests.common import set_probe_feature

ACCOUNT_KEYS = {'id', 'name', 'code', 'plan', 'active'}
PLAN_KEYS = {'id', 'name', 'parent'}


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceAnalyticPlans(AnalyticCase):

    def test_create_get_list_and_rename(self):
        created = self.api('POST', PLANS, json={'name': 'Departments 2'})
        self.assertEqual(created.status_code, 201, created.text)
        plan = created.json()
        self.assertEqual(set(plan), PLAN_KEYS)
        self.assertEqual((plan['name'], plan['parent']), ('Departments 2', None))
        self.assertEqual(self.api('GET', f'{PLANS}/{plan["id"]}').json(), plan)
        renamed = self.api('PATCH', f'{PLANS}/{plan["id"]}', json={'name': 'Departments Two'}).json()
        self.assertEqual(renamed['name'], 'Departments Two')
        listing = self.api('GET', PLANS).json()
        self.assertEqual(set(listing), {'items', 'total'})
        self.assertIn(plan['id'], [item['id'] for item in listing['items']])
        self.assertEqual([item['name'] for item in self.api('GET', f'{PLANS}?q=Two').json()['items']], ['Departments Two'])

    def test_a_sub_plan_names_its_parent(self):
        result = self.api('POST', PLANS, json={'name': 'Cities', 'parent_id': self.branches.id})
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual(result.json()['parent']['id'], self.branches.id)
        self.assertEqual(self.env['account.analytic.plan'].browse(result.json()['id']).root_id, self.branches)

    def test_refusals(self):
        for body, field in (
            ({}, 'name'), ({'name': ' '}, 'name'), ({'name': 'x', 'color': 1}, 'color'),
            ({'name': 'x', 'parent_id': 0}, 'parent_id'), ({'name': 'x', 'parent_id': 999999}, 'parent_id'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', PLANS, json=body), 422, 'invalid', field)
        url = f'{PLANS}/{self.branches.id}'
        # Moving a plan would rebuild the plan columns of existing analytic items: the name is the only edit.
        self.assertRefused(self.api('PATCH', url, json={'parent_id': self.projects.id}), 422, 'invalid', 'parent_id')
        self.assertRefused(self.api('PATCH', url, json={}), 422, 'invalid')
        self.assertRefused(self.api('GET', f'{PLANS}/999999'), 404, 'not_found')


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceAnalyticAccounts(AnalyticCase):

    def create_account(self, **overrides):
        result = self.api('POST', ACCOUNTS, json={'name': 'Medina', 'code': 'MED', 'plan_id': self.branches.id, **overrides})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_create_returns_the_account_in_the_current_company(self):
        account = self.create_account()
        self.assertEqual(set(account), ACCOUNT_KEYS)
        self.assertEqual(
            (account['name'], account['code'], account['plan']['id'], account['active']),
            ('Medina', 'MED', self.branches.id, True),
        )
        self.assertEqual(self.env['account.analytic.account'].browse(account['id']).company_id, self.company)
        self.assertEqual(self.create_account(name='No code', code='')['code'], '')

    def test_get_patch_and_list_filters(self):
        account = self.create_account()
        url = f'{ACCOUNTS}/{account["id"]}'
        self.assertEqual(self.api('GET', url).json(), account)
        patched = self.api('PATCH', url, json={'name': 'Madinah', 'code': '', 'plan_id': self.projects.id}).json()
        self.assertEqual((patched['name'], patched['code'], patched['plan']['id']), ('Madinah', '', self.projects.id))
        listing = self.api('GET', ACCOUNTS).json()
        self.assertEqual(set(listing), {'items', 'total'})
        names = [item['name'] for item in listing['items']]
        self.assertIn('Riyadh', names)
        self.assertEqual(self.api('GET', f'{ACCOUNTS}?q=RYD').json()['total'], 1)
        self.assertEqual({item['name'] for item in self.api('GET', f'{ACCOUNTS}?plan_id={self.projects.id}').json()['items']}, {'Alpha', 'Madinah'})
        sub = self.env['account.analytic.plan'].create({'name': 'Cities', 'parent_id': self.projects.id})
        self.env['account.analytic.account'].create({'name': 'Tabuk', 'plan_id': sub.id, 'company_id': self.company.id})
        self.assertIn('Tabuk', [item['name'] for item in self.api('GET', f'{ACCOUNTS}?plan_id={self.projects.id}').json()['items']])

    def test_archive_and_unarchive_with_active(self):
        account = self.create_account()
        url = f'{ACCOUNTS}/{account["id"]}'
        self.assertFalse(self.api('PATCH', url, json={'active': False}).json()['active'])
        self.assertNotIn(account['id'], [item['id'] for item in self.api('GET', ACCOUNTS).json()['items']])
        archived = self.api('GET', f'{ACCOUNTS}?archived=true').json()
        self.assertEqual([item['id'] for item in archived['items']], [account['id']])
        self.assertEqual(self.api('GET', url).json()['active'], False)
        self.assertTrue(self.api('PATCH', url, json={'active': True}).json()['active'])
        self.assertRefused(self.api('GET', f'{ACCOUNTS}?archived=maybe'), 422, 'invalid', 'archived')

    def test_refusals(self):
        for body, field in (
            ({'plan_id': self.branches.id}, 'name'), ({'name': 'x'}, 'plan_id'),
            ({'name': 'x', 'plan_id': 999999}, 'plan_id'), ({'name': 'x', 'plan_id': self.branches.id, 'company_id': 1}, 'company_id'),
            ({'name': 'x', 'plan_id': self.branches.id, 'active': 'yes'}, 'active'),
            ({'name': '', 'plan_id': self.branches.id}, 'name'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', ACCOUNTS, json=body), 422, 'invalid', field)
        url = f'{ACCOUNTS}/{self.riyadh.id}'
        self.assertRefused(self.api('PATCH', url, json={}), 422, 'invalid')
        self.assertRefused(self.api('PATCH', url, json={'plan_id': 999999}), 422, 'invalid', 'plan_id')

    def test_other_companies_and_shared_accounts_are_not_found(self):
        for account in (self.other_branch, self.shared):
            url = f'{ACCOUNTS}/{account.id}'
            with self.subTest(account=account.name):
                self.assertRefused(self.api('GET', url), 404, 'not_found')
                self.assertRefused(self.api('PATCH', url, json={'name': 'Hijacked'}), 404, 'not_found')
        names = [item['name'] for item in self.api('GET', ACCOUNTS).json()['items']]
        self.assertFalse({'Dammam', 'Shared'} & set(names))
        self.assertEqual(self.other_branch.name, 'Dammam')

    def test_a_used_account_moves_between_sub_plans_of_the_same_root(self):
        north = self.env['account.analytic.plan'].create({'name': 'North', 'parent_id': self.branches.id})
        south = self.env['account.analytic.plan'].create({'name': 'South', 'parent_id': self.branches.id})
        self.riyadh.plan_id = north
        self.posted_invoice(self.split_body())
        moved = self.api('PATCH', f'{ACCOUNTS}/{self.riyadh.id}', json={'plan_id': south.id})
        self.assertEqual((moved.status_code, moved.json()['plan']['id']), (200, south.id))
        self.assertRefused(
            self.api('PATCH', f'{ACCOUNTS}/{self.riyadh.id}', json={'plan_id': self.projects.id}),
            422, 'analytic_account_in_use', 'plan_id',
        )

    def test_an_account_with_items_keeps_its_plan(self):
        self.posted_invoice(self.split_body())
        url = f'{ACCOUNTS}/{self.riyadh.id}'
        self.assertRefused(self.api('PATCH', url, json={'plan_id': self.projects.id}), 422, 'analytic_account_in_use', 'plan_id')
        self.assertEqual(self.riyadh.plan_id, self.branches)
        self.assertEqual(self.api('PATCH', url, json={'name': 'Riyadh HQ'}).json()['name'], 'Riyadh HQ')
        # A draft that only names the account counts too: the distribution refers to its plan.
        self.create_invoice(self.split_body({str(self.alpha.id): 100}))
        self.assertRefused(
            self.api('PATCH', f'{ACCOUNTS}/{self.alpha.id}', json={'plan_id': self.branches.id}),
            422, 'analytic_account_in_use', 'plan_id',
        )


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceAnalyticAccess(AnalyticCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user_with('analytic_reader', ['finance.analytic.read'])
        cls.user_with('analytic_manager', ['finance.analytic.read', 'finance.analytic.manage'])
        cls.user_with('analytic_admin', [
            'finance.analytic.read', 'finance.analytic.manage', 'finance.setup.read', 'finance.setup.manage',
        ])
        cls.user_with('invoice_writer', ['finance.invoices.read', 'finance.invoices.manage', 'finance.invoices.post'])
        cls.cities = cls.env['account.analytic.plan'].create({'name': 'Cities', 'parent_id': cls.branches.id})

    def routes(self):
        plan, account = f'{PLANS}/{self.branches.id}', f'{ACCOUNTS}/{self.riyadh.id}'
        reads = (
            ('GET', PLANS), ('GET', plan), ('GET', ACCOUNTS), ('GET', account),
            ('GET', '/api/v1/finance/reports/analytic?date_from=2026-10-01&date_to=2026-10-31'),
            ('GET', f'/api/v1/finance/reports/analytic/lines?account_id={self.riyadh.id}&date_from=2026-10-01&date_to=2026-10-31'),
        )
        writes = (
            ('POST', PLANS, {'name': 'New plan'}), ('PATCH', plan, {'name': 'Renamed'}),
            ('POST', ACCOUNTS, {'name': 'New', 'plan_id': self.branches.id}), ('PATCH', account, {'name': 'Renamed'}),
        )
        return reads, writes

    def test_the_read_capability_reads_and_never_writes(self):
        reads, writes = self.routes()
        self.authenticate('analytic_reader', PASSWORD)
        for method, path in reads:
            with self.subTest(route=path):
                self.assertEqual(self.api(method, path).status_code, 200)
        for method, path, body in writes:
            with self.subTest(method=method, route=path):
                self.assertRefused(self.api(method, path, json=body), 403, 'forbidden')
        self.assertEqual(self.riyadh.name, 'Riyadh')

    def test_the_manage_capability_writes_accounts_and_sub_plans_but_not_root_plans(self):
        self.authenticate('analytic_manager', PASSWORD)
        created = self.api('POST', ACCOUNTS, json={'name': 'New', 'plan_id': self.branches.id})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(self.api('PATCH', f'{ACCOUNTS}/{self.riyadh.id}', json={'name': 'Renamed'}).status_code, 200)
        sub = self.api('POST', PLANS, json={'name': 'Districts', 'parent_id': self.branches.id})
        self.assertEqual(sub.status_code, 201, sub.text)
        self.assertEqual(self.api('PATCH', f'{PLANS}/{self.cities.id}', json={'name': 'Towns'}).status_code, 200)
        # A root plan changes the analytic table schema: it also needs finance.setup.manage.
        self.assertRefused(self.api('POST', PLANS, json={'name': 'Root plan'}), 403, 'forbidden')
        self.assertRefused(self.api('PATCH', f'{PLANS}/{self.branches.id}', json={'name': 'Renamed'}), 403, 'forbidden')
        self.assertEqual(self.branches.name, 'Branches')
        self.assertFalse(self.env['account.analytic.plan'].search([('name', '=', 'Root plan')]))

    def test_root_plans_need_the_setup_capability_too(self):
        self.authenticate('analytic_admin', PASSWORD)
        created = self.api('POST', PLANS, json={'name': 'Root plan'})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(self.api('PATCH', f'{PLANS}/{created.json()["id"]}', json={'name': 'Root plan 2'}).status_code, 200)

    def test_other_capabilities_and_no_capability_see_nothing(self):
        reads, writes = self.routes()
        for login, password in (('invoice_writer', PASSWORD), (OUTSIDER_LOGIN, OUTSIDER_PASSWORD)):
            self.authenticate(login, password)
            for method, path, *body in [*reads, *writes]:
                with self.subTest(login=login, route=path):
                    self.assertRefused(self.api(method, path, json=body[0] if body else None), 403, 'forbidden')

    def test_a_closed_feature_refuses_every_route(self):
        reads, writes = self.routes()
        set_probe_feature(self, key='finance.enabled', enabled=False)
        for method, path, *body in [*reads, *writes]:
            with self.subTest(route=path):
                self.assertEqual(self.api(method, path, json=body[0] if body else None).status_code, 403)
