# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase

ROW_KEYS = {'project', 'finance', 'task_count', 'closed_task_count', 'overdue_task_count', 'progress'}
PROJECT_REF_KEYS = {'id', 'name', 'status'}
TOTALS_KEYS = {
    'currency', 'project_count', 'budgeted_project_count', 'planned', 'actual', 'remaining', 'over_budget_count',
}
URL = '/api/v1/reports/projects'


@tagged('post_install', '-at_install', 'nasq')
class TestProjectReports(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The shared fixture models legacy company-less projects. Finance is
        # explicitly company-scoped, so use a current-company fixture here.
        cls.project.company_id = cls.env.company

    def _entry(self, project, **fields):
        return self.env['nasq.project.finance.entry'].create({'project_id': project.id, **fields})

    def test_shape_row_and_task_counts(self):
        self._entry(self.project, kind='budget', title='Budget', amount=1000)
        self._entry(self.project, kind='expense', title='Cost', amount=200, expense_date='2030-01-01')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', URL).json()
        self.assertEqual(set(body), {'items', 'total', 'totals'})
        row = next(item for item in body['items'] if item['project']['id'] == self.project.id)
        self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual(set(row['project']), PROJECT_REF_KEYS)
        self.assertIsNone(row['project']['status'], "to_define is null on the wire")
        self.assertEqual((row['finance']['planned'], row['finance']['actual']), (1000, 200))
        # Fixtures: task_overdue (open, overdue), task_done (closed), task_other (open) -> 1 of 3, 1 overdue.
        self.assertEqual((row['task_count'], row['closed_task_count'], row['overdue_task_count'], row['progress']),
                          (3, 1, 1, 33))

    def test_status_filter_and_unset(self):
        self.project.with_user(self.manager)._nasq_set_status('on_track')
        other = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Off track project'})
        other.with_user(self.manager)._nasq_set_status('off_track')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', f'{URL}?status=on_track').json()
        self.assertEqual([item['project']['id'] for item in body['items']], [self.project.id])
        body = self.api('GET', f'{URL}?status=off_track').json()
        self.assertEqual([item['project']['id'] for item in body['items']], [other.id])
        unset = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Unset project'})
        body = self.api('GET', f'{URL}?status=unset').json()
        self.assertIn(unset.id, [item['project']['id'] for item in body['items']])

    def test_totals_group_known_budgets_only_and_sum_all_actuals(self):
        self._entry(self.project, kind='budget', title='Budget', amount=1000)
        self._entry(self.project, kind='expense', title='Cost', amount=1200, expense_date='2030-01-01')
        unbudgeted = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Unbudgeted project'})
        self._entry(unbudgeted, kind='expense', title='Loose cost', amount=50, expense_date='2030-01-01')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', URL).json()
        self.assertEqual(len(body['totals']), 1)
        totals = body['totals'][0]
        self.assertEqual(set(totals), TOTALS_KEYS)
        self.assertEqual(totals['planned'], 1000)
        self.assertEqual(totals['actual'], 1250)
        self.assertEqual(totals['remaining'], -200)
        self.assertGreaterEqual(totals['budgeted_project_count'], 1)
        self.assertGreaterEqual(totals['over_budget_count'], 1)
        self.assertGreaterEqual(totals['project_count'], 2)

    def test_excludes_archived_private_foreign_and_companyless(self):
        archived = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Archived report project'})
        archived.with_user(self.manager)._nasq_archive()
        private = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Private report project', 'privacy_visibility': 'followers'})
        company_b = self.env['res.company'].create({'name': 'Report company B'})
        foreign = self.env['project.project'].create({'name': 'Foreign report project', 'company_id': company_b.id})
        companyless = self.env['project.project'].create({'name': 'Companyless report project', 'company_id': False})
        self.authenticate('api_emp', 'api_emp_pass_123')
        ids = {item['project']['id'] for item in self.api('GET', URL).json()['items']}
        self.assertNotIn(archived.id, ids)
        self.assertNotIn(private.id, ids)
        self.assertNotIn(foreign.id, ids)
        self.assertNotIn(companyless.id, ids)

    def test_task_counts_null_without_task_read_capability(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'قارئ المشاريع فقط',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', '=', 'pmo.projects.read'),
            ]).ids)],
        })
        reader = new_test_user(self.env, login='report_reader', password='report_reader_pass_123', groups='base.group_user')
        self.env['nasq.access.assignment'].create({
            'user_id': reader.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        self.authenticate('report_reader', 'report_reader_pass_123')
        body = self.api('GET', URL).json()
        row = next(item for item in body['items'] if item['project']['id'] == self.project.id)
        self.assertEqual(
            (row['task_count'], row['closed_task_count'], row['overdue_task_count'], row['progress']),
            (None, None, None, None),
        )
        # Finance visibility is not gated by pmo.tasks.read.
        self.assertIsNotNone(row['finance'])

    def test_unsupported_filter_bad_status_and_limit_bounds(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', f'{URL}?bogus=1').status_code, 400)
        self.assertEqual(self.api('GET', f'{URL}?status=nope').status_code, 422)
        self.assertEqual(self.api('GET', f'{URL}?limit=0').status_code, 422)
        self.assertEqual(self.api('GET', f'{URL}?limit=201').status_code, 422)

    def test_total_aggregation_beyond_200_with_first_page(self):
        Project = self.env['project.project']
        for i in range(205):
            Project.create({'company_id': self.env.company.id, 'name': f'Bulk report project {i}'})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', URL).json()
        self.assertGreaterEqual(body['total'], 206)
        self.assertLessEqual(len(body['items']), 50)
        totals = body['totals'][0]
        self.assertGreaterEqual(totals['project_count'], 206)

    def test_totals_are_pagination_independent(self):
        """The same totals must be reported regardless of limit/offset/page."""
        self._entry(self.project, kind='budget', title='Budget', amount=1000)
        self._entry(self.project, kind='expense', title='Cost', amount=200, expense_date='2030-01-01')
        Project = self.env['project.project']
        for i in range(10):
            Project.create({'company_id': self.env.company.id, 'name': f'Pagination project {i}'})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        full = self.api('GET', URL).json()
        page1 = self.api('GET', f'{URL}?limit=3&offset=0').json()
        page2 = self.api('GET', f'{URL}?limit=3&offset=3').json()
        self.assertEqual(full['total'], page1['total'])
        self.assertEqual(full['total'], page2['total'])
        self.assertEqual(full['totals'], page1['totals'])
        self.assertEqual(full['totals'], page2['totals'])
        self.assertNotEqual([item['project']['id'] for item in page1['items']],
                             [item['project']['id'] for item in page2['items']])

    def test_report_totals_exact_decimal_aggregation_across_many_projects(self):
        """Many 0.01 expenses across many projects must not drift in the totals."""
        Project = self.env['project.project']
        projects = [self.project]
        for i in range(29):
            projects.append(Project.create({'company_id': self.env.company.id, 'name': f'Decimal report project {i}'}))
        for project in projects:
            self._entry(project, kind='budget', title='B', amount=0.10)
            self._entry(project, kind='expense', title='E1', amount=0.01, expense_date='2030-01-01')
            self._entry(project, kind='expense', title='E2', amount=0.02, expense_date='2030-01-01')
            self._entry(project, kind='expense', title='E3', amount=0.03, expense_date='2030-01-01')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        totals = self.api('GET', URL).json()['totals'][0]
        self.assertEqual(totals['planned'], round(0.10 * len(projects), 2))
        self.assertEqual(totals['actual'], round(0.06 * len(projects), 2))
        self.assertEqual(totals['remaining'], round(0.04 * len(projects), 2))
        self.assertEqual(totals['over_budget_count'], 0)

    def test_reports_have_no_implicit_access_from_system_admin_role(self):
        admin = new_test_user(
            self.env, login='report_system_admin', password='report_system_admin_pass_123',
            name='Nour', groups='base.group_user',
        )
        self.env['nasq.access.assignment'].create({
            'user_id': admin.id, 'role_id': self.env.ref('nasq_core.role_system_admin').id,
            'company_id': self.env.company.id,
        })
        self.authenticate('report_system_admin', 'report_system_admin_pass_123')
        self.assertEqual(self.api('GET', URL).status_code, 403)
