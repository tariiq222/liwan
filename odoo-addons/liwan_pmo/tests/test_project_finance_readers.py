# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase

KEY = 'pmo.finance.read'
SUMMARY_URL = '/api/v1/reports/projects/summary'
ANALYTICS_URL = '/api/v1/reports/projects/analytics'


@tagged('post_install', '-at_install', 'liwan')
class TestProjectFinanceReaders(LiwanPmoCase):
    """pmo.finance.read: the project's manager and the company-wide project managers read its money; the company can
    widen that to the project's members with `finance_readers = members`."""

    @classmethod
    def _user(cls, login, groups='liwan_core.group_employee'):
        return new_test_user(cls.env, login=login, password=f'{login}_pass_123', name=login, groups=groups)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.owner = cls._user('fin_owner')
        cls.reader = cls._user('fin_reader')
        cls.follower = cls._user('fin_follower')
        cls.sponsor = cls._user('fin_sponsor')
        cls.assignee = cls._user('fin_assignee')
        cls.no_read = cls._user('fin_noread', groups='base.group_user')
        # The shared fixture holds a task of the project for api_emp, who would be a member: use the project of this case.
        cls.fin = cls.env['project.project'].create({
            'name': 'Finance readers', 'company_id': cls.env.company.id, 'user_id': cls.owner.id,
            'liwan_sponsor_id': cls.sponsor.id, 'liwan_budget_state': 'estimate', 'liwan_budget_amount': 1000,
        })
        cls.fin.message_subscribe(partner_ids=[cls.follower.partner_id.id, cls.no_read.partner_id.id])
        cls.env['project.task'].create({'name': 'Mine', 'project_id': cls.fin.id, 'user_ids': [Command.link(cls.assignee.id)]})
        cls.budget = cls.env['liwan.project.finance.entry'].create({
            'project_id': cls.fin.id, 'kind': 'budget', 'title': 'Budget', 'amount': 1000,
        })

    def setUp(self):
        super().setUp()
        # Manual expenses exist only while the case's patched actual source answers "manual", which is per test.
        self.expense = self.env['liwan.project.finance.entry'].create({
            'project_id': self.fin.id, 'kind': 'expense', 'title': 'Spend', 'amount': 250, 'expense_date': '2030-01-01',
        })

    def _mode(self, value):
        settings = self.env['liwan.pmo.settings']
        settings._params().set_param(settings._company_key('liwan_pmo.finance_readers'), value)

    def _get(self, login, path):
        self.authenticate(login, f'{login}_pass_123')
        return self.api('GET', path)

    def _finance_paths(self):
        base = f'/api/v1/projects/{self.fin.id}'
        return (f'{base}/finance', f'{base}/finance/summary', f'{base}/finance/{self.budget.id}', f'{base}/evm')

    def _status(self, login):
        """The status of every finance path for LOGIN."""
        return [self._get(login, path).status_code for path in self._finance_paths()]

    # --- registration -----------------------------------------------------------------
    def test_the_capability_is_registered_sensitive_and_implied_by_manage(self):
        permission = self.env['liwan.access.permission'].search([('key', '=', KEY)])
        self.assertTrue(permission.sensitive and permission.custom_role_allowed)
        self.assertEqual(permission.group_xmlid, 'liwan_pmo.group_cap_pmo_finance_read')
        dependencies = self.service._liwan_permission_dependencies()
        self.assertEqual(dependencies[KEY], {'pmo.projects.read'})
        self.assertIn(KEY, dependencies['pmo.projects.manage'])
        self.assertIn(self.env.ref('liwan_pmo.group_cap_pmo_finance_read'), self.env.ref('liwan_pmo.group_pmo_manager').implied_ids)
        for role in ('liwan_pmo.role_pmo_manager', 'liwan_core.role_vendor_support'):
            self.assertIn(permission, self.env.ref(role).permission_ids, role)
        self.assertNotIn(permission, self.env.ref('liwan_core.role_employee').permission_ids)

    def test_company_wide_holders_are_managers_and_custom_roles(self):
        self.assertTrue(self.service._liwan_has_capability(self.manager, KEY))
        self.assertFalse(self.service._liwan_has_capability(self.reader, KEY))
        role = self.env['liwan.access.role'].create({
            'name_ar': 'قارئ مالية المشاريع', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([
                ('key', 'in', ('pmo.projects.read', KEY)),
            ]).ids)],
        })
        finance_reader = self._user('fin_custom', groups='base.group_user')
        self.env['liwan.access.assignment'].create({
            'user_id': finance_reader.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        self.assertTrue(self.service._liwan_has_capability(finance_reader, KEY))
        self.assertEqual(self._status('fin_custom'), [200, 200, 200, 409])

    # --- managers mode (the default) ----------------------------------------------------
    def test_default_mode_is_managers(self):
        self.assertEqual(self.env['liwan.pmo.settings'].get()['finance_readers'], 'managers')

    def test_managers_mode_a_reader_or_member_is_forbidden_on_every_finance_path(self):
        for login in ('fin_reader', 'fin_follower', 'fin_sponsor', 'fin_assignee'):
            self.assertEqual(self._status(login), [403, 403, 403, 403], login)

    def test_managers_mode_the_project_manager_and_a_pmo_manager_read(self):
        for login in ('fin_owner', 'api_mgr'):
            # The EVM route passes the gate and then asks for a baseline (409): the read is allowed.
            self.assertEqual(self._status(login), [200, 200, 200, 409], login)
        body = self._get('fin_owner', self._finance_paths()[0]).json()
        self.assertEqual((body['total'], body['summary']['planned'], body['summary']['actual']), (2, 1000, 250))

    def test_managers_mode_the_orm_refuses_or_filters_entries(self):
        Entry = self.env['liwan.project.finance.entry']
        reader = Entry.with_user(self.reader)
        self.assertFalse(reader.search([]))
        self.assertEqual(reader.search_count([]), 0)
        grouped = reader.formatted_read_group([], [], ['amount:sum'])
        self.assertFalse(grouped[0]['amount:sum'])
        with self.assertRaises(AccessError):
            reader.browse(self.budget.id).read(['title'])
        # With the export right, the finance rule is what refuses the export.
        self.reader.group_ids = [Command.link(self.env.ref('base.group_allow_export').id)]
        with self.assertRaises(AccessError):
            reader.browse(self.budget.id).export_data(['amount'])
        self.assertEqual(Entry.with_user(self.owner).search([]), self.budget | self.expense)
        self.assertEqual(Entry.with_user(self.manager).search([('project_id', '=', self.fin.id)]), self.budget | self.expense)

    def test_the_capability_of_one_company_opens_no_other_allowed_company(self):
        company_b = self.env['res.company'].create({'name': 'Finance readers B'})
        self.env['liwan.pmo.settings'].with_company(company_b).set_values({'finance_tool_policy': 'enabled'})
        foreign = self.env['project.project'].create({'name': 'Foreign money', 'company_id': company_b.id})
        foreign_entry = self.env['liwan.project.finance.entry'].with_company(company_b).create({
            'project_id': foreign.id, 'kind': 'budget', 'title': 'Foreign budget', 'amount': 5,
        })
        self.manager.write({'company_ids': [Command.link(company_b.id)]})
        both = self.env['liwan.project.finance.entry'].with_user(self.manager).with_context(
            allowed_company_ids=[self.env.company.id, company_b.id])
        self.assertTrue(self.service._liwan_has_capability(self.manager, KEY))
        self.assertFalse(self.service._liwan_has_capability(self.manager, KEY, company=company_b))
        self.assertNotIn(foreign_entry, both.search([]))
        self.assertIn(self.budget, both.search([]))

    def test_managers_mode_the_orm_refuses_or_filters_the_project_budget(self):
        project = self.fin.with_user(self.reader)
        with self.assertRaises(AccessError):
            project.read(['liwan_budget_amount'])
        with self.assertRaises(AccessError):
            project.export_data(['liwan_budget_state'])
        self.assertFalse(project.search([('id', '=', self.fin.id), ('liwan_budget_amount', '>', 0)]))
        grouped = project.formatted_read_group([('id', '=', self.fin.id)], [], ['liwan_budget_amount:sum'])
        self.assertFalse(grouped[0]['liwan_budget_amount:sum'])
        self.assertEqual(project.read(['name'])[0]['name'], 'Finance readers')
        owner = self.fin.with_user(self.owner)
        self.assertEqual(owner.read(['liwan_budget_amount'])[0]['liwan_budget_amount'], 1000)
        self.assertTrue(owner.search([('id', '=', self.fin.id), ('liwan_budget_amount', '>', 0)]))

    def test_the_project_detail_says_whether_the_caller_reads_finance(self):
        path = f'/api/v1/projects/{self.fin.id}'
        self.assertFalse(self._get('fin_reader', path).json()['can_read_finance'])
        self.assertTrue(self._get('fin_owner', path).json()['can_read_finance'])
        self.assertTrue(self._get('api_mgr', path).json()['can_read_finance'])

    def test_the_charter_budget_is_redacted_and_not_writable_without_the_capability(self):
        path = f'/api/v1/projects/{self.fin.id}'
        charter = self._get('fin_reader', path).json()['charter']
        self.assertEqual((charter['budget_state'], charter['amount'], charter['currency']), (None, None, None))
        charter = self._get('fin_owner', path).json()['charter']
        self.assertEqual((charter['budget_state'], charter['amount']), ('estimate', 1000))
        reader = self.fin.with_user(self.reader)
        with self.assertRaises(AccessError):
            reader._liwan_check_tool_content_vals({'liwan_budget_amount': 5})
        # A creator names a manager who is not themself: they must read finance to enter the budget.
        with self.assertRaises(AccessError):
            reader._liwan_check_tool_create_vals({'liwan_budget_amount': 5, 'user_id': self.owner.id})
        reader._liwan_check_tool_create_vals({'liwan_budget_amount': 5, 'user_id': self.reader.id})
        self.fin.with_user(self.owner)._liwan_check_tool_content_vals({'liwan_budget_amount': 5})

    def test_baseline_money_and_variance_cost_are_null_for_a_non_reader(self):
        self.fin.sudo().liwan_charter_state = 'approved'
        self.env['liwan.project.baseline'].with_user(self.owner).create({'project_id': self.fin.id})
        base = f'/api/v1/projects/{self.fin.id}/baselines'
        owner_view = self._get('fin_owner', f'{base}/1').json()
        self.assertEqual(owner_view['budget_total'], 1000)
        self.assertTrue(all(row['planned_value_share'] is not None for row in owner_view['tasks']))
        self.assertIsNotNone(self._get('fin_owner', f'{base}/variance').json()['cost'])
        for login in ('fin_reader', 'fin_assignee'):
            view = self._get(login, f'{base}/1').json()
            self.assertIsNone(view['budget_total'], login)
            self.assertTrue(all(row['planned_value_share'] is None for row in view['tasks']), login)
            self.assertIsNone(self._get(login, f'{base}/variance').json()['cost'], login)
            self.assertIsNone(self._get(login, base).json()['items'][0]['budget_total'], login)
        baseline = self.env['liwan.project.baseline'].search([('project_id', '=', self.fin.id)])
        with self.assertRaises(AccessError):
            baseline.with_user(self.reader).read(['budget_total'])
        with self.assertRaises(AccessError):
            baseline.with_user(self.reader).export_data(['budget_total'])
        self.assertEqual(baseline.with_user(self.owner).read(['budget_total'])[0]['budget_total'], 1000)

    def test_change_request_cost_impact_is_null_and_not_writable_without_the_capability(self):
        base = f'/api/v1/projects/{self.fin.id}/changes'
        self.authenticate('fin_owner', 'fin_owner_pass_123')
        created = self.api('POST', base, {'title': 'Costly', 'impact_cost': 500})
        self.assertEqual((created.status_code, created.json()['impact_cost']), (201, 500), created.text)
        # A member who may not read finance raises requests without a cost, and never reads or writes one.
        self.authenticate('fin_assignee', 'fin_assignee_pass_123')
        refused = self.api('POST', base, {'title': 'Mine', 'impact_cost': 10})
        self.assertEqual(refused.status_code, 403, refused.text)
        mine = self.api('POST', base, {'title': 'Mine'})
        self.assertEqual((mine.status_code, mine.json()['impact_cost']), (201, None), mine.text)
        listed = self.api('GET', base).json()['items']
        self.assertTrue(listed)
        self.assertTrue(all(item['impact_cost'] is None for item in listed))
        self.assertIsNone(self.api('GET', f"{base}/{mine.json()['id']}").json()['impact_cost'])
        patched = self.api('PATCH', f"{base}/{mine.json()['id']}", {
            'expected_updated_at': mine.json()['updated_at'], 'impact_cost': 10,
        })
        self.assertEqual(patched.status_code, 403, patched.text)
        change = self.env['liwan.project.change'].browse(mine.json()['id'])
        with self.assertRaises(AccessError):
            change.with_user(self.assignee).read(['impact_cost'])
        self.assertEqual(change.impact_cost, 0)

    def test_managers_mode_reports_leave_out_unreadable_projects(self):
        over = self.env['project.project'].create({
            'name': 'Over budget report', 'company_id': self.env.company.id, 'user_id': self.owner.id,
        })
        Entry = self.env['liwan.project.finance.entry']
        Entry.create({'project_id': over.id, 'kind': 'budget', 'title': 'B', 'amount': 100})
        Entry.create({'project_id': over.id, 'kind': 'expense', 'title': 'E', 'amount': 200, 'expense_date': '2030-01-01'})
        self._assert_reports(readers=('fin_owner', 'api_mgr'), non_readers=('fin_reader', 'fin_assignee'), over=over)

    def _assert_reports(self, readers, non_readers, over):
        for login in readers:
            rows = {row['project']['id']: row for row in self._get(login, ANALYTICS_URL).json()['projects']}
            self.assertIsNotNone(rows[self.fin.id]['finance'], login)
            self.assertIsNotNone(rows[over.id]['finance'], login)
            summary = self._get(login, SUMMARY_URL).json()
            self.assertIn(over.id, {row['project']['id'] for row in summary['attention']}, login)
            self.assertGreaterEqual(sum(t['over_budget_count'] for t in summary['totals']), 1, login)
        for login in non_readers:
            analytics = self._get(login, ANALYTICS_URL).json()
            rows = {row['project']['id']: row for row in analytics['projects']}
            self.assertIsNone(rows[self.fin.id]['finance'], login)
            self.assertIsNone(rows[over.id]['finance'], login)
            summary = self._get(login, SUMMARY_URL).json()
            self.assertNotIn(over.id, {row['project']['id'] for row in summary['attention']}, login)
            for body in (analytics, summary):
                self.assertEqual(sum(t['project_count'] for t in body['totals']), sum(
                    1 for row in analytics['projects'] if row['finance'] is not None
                ), login)
                self.assertEqual(sum(t['over_budget_count'] for t in body['totals']), 0, login)

    # --- members mode -------------------------------------------------------------------
    def test_members_mode_every_kind_of_member_reads_and_others_do_not(self):
        self._mode('members')
        for login in ('fin_owner', 'fin_follower', 'fin_sponsor', 'fin_assignee', 'api_mgr'):
            self.assertEqual(self._status(login), [200, 200, 200, 409], login)
        self.assertEqual(self._status('fin_reader'), [403, 403, 403, 403])

    def test_members_mode_a_member_without_project_read_is_not_a_reader(self):
        self._mode('members')
        # A follower of the project, though without pmo.projects.read the project itself is closed to them.
        self.assertIn(self.no_read.partner_id, self.fin.message_partner_ids)
        self.assertFalse(self.service._liwan_has_capability(self.no_read, 'pmo.projects.read'))
        self.assertFalse(self.service._liwan_has_capability(self.no_read, KEY, record=self.fin))
        self.assertEqual(self._status('fin_noread'), [403, 403, 403, 403])

    def test_members_mode_the_setting_is_per_company_and_read_live(self):
        self._mode('members')
        self.assertTrue(self.service._liwan_has_capability(self.follower, KEY, record=self.fin))
        self._mode('managers')
        self.assertFalse(self.service._liwan_has_capability(self.follower, KEY, record=self.fin))

    def test_members_mode_models_and_reports_follow_the_same_decision(self):
        self._mode('members')
        Entry = self.env['liwan.project.finance.entry']
        self.assertEqual(Entry.with_user(self.follower).search([]), self.budget | self.expense)
        self.assertFalse(Entry.with_user(self.reader).search([]))
        self.assertEqual(self.fin.with_user(self.assignee).read(['liwan_budget_amount'])[0]['liwan_budget_amount'], 1000)
        over = self.env['project.project'].create({
            'name': 'Over budget members', 'company_id': self.env.company.id, 'user_id': self.owner.id,
        })
        Entry.create({'project_id': over.id, 'kind': 'budget', 'title': 'B', 'amount': 100})
        Entry.create({'project_id': over.id, 'kind': 'expense', 'title': 'E', 'amount': 200, 'expense_date': '2030-01-01'})
        # `over` has no member beside its manager: a follower of `fin` reads fin but not over.
        rows = {row['project']['id']: row for row in self._get('fin_follower', ANALYTICS_URL).json()['projects']}
        self.assertIsNotNone(rows[self.fin.id]['finance'])
        self.assertIsNone(rows[over.id]['finance'])
        self._assert_reports(readers=('fin_owner', 'api_mgr'), non_readers=('fin_reader',), over=over)

    def test_the_predicate_and_the_domain_agree_for_every_kind_of_user(self):
        users = (self.owner, self.reader, self.follower, self.sponsor, self.assignee, self.manager)
        for mode in ('managers', 'members'):
            self._mode(mode)
            for user in users:
                project = self.fin.with_user(user)
                self.assertEqual(bool(project._liwan_finance_readable()), project._liwan_can_read_finance(), (mode, user.login))
                self.assertEqual(
                    bool(project.search([('id', '=', self.fin.id), ('liwan_budget_amount', '>', 0)])),
                    project._liwan_can_read_finance(), (mode, user.login),
                )

    def test_members_mode_with_governance_off_every_member_still_reads_the_money(self):
        self._mode('members')
        settings = self.env['liwan.pmo.settings']
        settings._params().set_param(settings._company_key('liwan_pmo.governance_tool_policy'), 'optional')
        self.assertFalse(self.fin.liwan_governance_enabled)
        Entry = self.env['liwan.project.finance.entry']
        for user in (self.owner, self.follower, self.assignee, self.sponsor):
            project = self.fin.with_user(user)
            self.assertTrue(project._liwan_can_read_finance(), user.login)
            self.assertEqual(project._liwan_finance_readable(), self.fin, user.login)
            self.assertEqual(Entry.with_user(user).search([]), self.budget | self.expense, user.login)
        self.assertFalse(Entry.with_user(self.reader).search([]))
        for login in ('fin_owner', 'fin_follower', 'fin_assignee', 'fin_sponsor'):
            rows = {row['project']['id']: row for row in self._get(login, ANALYTICS_URL).json()['projects']}
            self.assertEqual(rows[self.fin.id]['finance']['planned'], 1000, login)
            summary = self._get(login, f'/api/v1/projects/{self.fin.id}/finance/summary').json()
            self.assertEqual((summary['planned'], summary['actual']), (1000, 250), login)

    def test_the_sponsor_rule_still_applies_when_governance_is_on(self):
        self._mode('members')
        settings = self.env['liwan.pmo.settings']
        settings._params().set_param(settings._company_key('liwan_pmo.governance_tool_policy'), 'optional')
        self.fin.liwan_governance_enabled = True
        Entry = self.env['liwan.project.finance.entry']
        self.assertEqual(Entry.with_user(self.sponsor).search([]), self.budget | self.expense)
        self.assertTrue(self.fin.with_user(self.sponsor)._liwan_can_read_finance())
        self.assertEqual(Entry.with_user(self.assignee).search([]), self.budget | self.expense)

    def test_the_sponsor_of_an_archived_project_still_reads_its_money(self):
        self._mode('members')
        self.fin.active = False
        # Entries of an archived project stay hidden (project_finance.py: the active-project floor); the membership
        # decision itself must still count the sponsor, as the per-record capability does.
        project = self.fin.with_user(self.sponsor).with_context(active_test=False)
        self.assertTrue(project._liwan_can_read_finance())
        self.assertEqual(project._liwan_finance_readable(), project)
        # Built from an ordinary context, as the archived child-project query builds it.
        Project = self.env['project.project'].with_user(self.sponsor)
        self.assertIn(self.fin, Project.with_context(active_test=False).search(Project._liwan_member_domain()))

    # --- settings -----------------------------------------------------------------------
    def test_the_setting_is_validated_and_needs_the_settings_capability(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/settings/projects').json()['finance_readers'], 'managers')
        saved = self.api('PATCH', '/api/v1/settings/projects', {'finance_readers': 'members'})
        self.assertEqual((saved.status_code, saved.json()['finance_readers']), (200, 'members'), saved.text)
        self.assertEqual(self.env['liwan.pmo.settings'].get()['finance_readers'], 'members')
        invalid = self.api('PATCH', '/api/v1/settings/projects', {'finance_readers': 'everyone'})
        self.assertEqual((invalid.status_code, invalid.json()['field']), (422, 'finance_readers'), invalid.text)
        self.authenticate('fin_owner', 'fin_owner_pass_123')
        denied = self.api('PATCH', '/api/v1/settings/projects', {'finance_readers': 'managers'})
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(self.env['liwan.pmo.settings'].get()['finance_readers'], 'members')
