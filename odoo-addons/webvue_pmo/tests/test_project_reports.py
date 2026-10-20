# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import WebVuePmoCase
from odoo.addons.webvue_pmo.serializers.project_reports import (
    build_dashboard_summary,
    build_project_dashboard_analytics,
    today_utc,
)

ROW_KEYS = {'project', 'finance', 'task_count', 'closed_task_count', 'overdue_task_count', 'progress'}
PROJECT_REF_KEYS = {'id', 'name', 'status'}
TOTALS_KEYS = {
    'currency', 'project_count', 'budgeted_project_count', 'planned', 'actual', 'remaining', 'over_budget_count',
}
SUMMARY_URL = '/api/v1/reports/projects/summary'
ANALYTICS_URL = '/api/v1/reports/projects/analytics'


@tagged('post_install', '-at_install', 'webvue')
class TestProjectReports(WebVuePmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The shared fixture models legacy company-less projects. Finance is
        # explicitly company-scoped, so use a current-company fixture here.
        cls.project.company_id = cls.env.company

    def _entry(self, project, **fields):
        return self.env['webvue.project.finance.entry'].create({'project_id': project.id, **fields})

    def test_summary_finance_search_is_batched_and_matches_analytics(self):
        projects = self.env['project.project'].create([
            {'company_id': self.env.company.id, 'name': f'Batch finance {index:02d}'}
            for index in range(12)
        ])
        for project in projects:
            self._entry(project, kind='budget', title='Budget', amount=0.1)
            self._entry(project, kind='expense', title='Expense', amount=0.2, expense_date='2030-01-01')
        projects = projects.with_user(self.manager)
        today = today_utc()
        expected = build_project_dashboard_analytics(projects, today, True)
        expected = {key: value for key, value in expected.items() if key not in ('projects', 'recent_projects')}
        Finance = type(self.env['webvue.project.finance.entry'])
        original_search = Finance.search
        domains = []

        def counted_search(records, domain, *args, **kwargs):
            domains.append(domain)
            return original_search(records, domain, *args, **kwargs)

        for selected in (projects[:1], projects):
            domains.clear()
            with patch.object(Finance, 'search', counted_search):
                result = build_dashboard_summary(selected, today, True)
            self.assertEqual(len(domains), 1, 'finance reads must not grow per project or attention row')
            self.assertEqual(domains[0], [('project_id', 'in', selected.ids)])
            if selected == projects:
                self.assertEqual(result, expected)
        self.assertEqual(result['attention_project_count'], 12)
        self.assertEqual(len(result['attention']), 10)
        with patch.object(Finance, 'search', counted_search):
            domains.clear()
            empty = build_dashboard_summary(projects[:0], today, False)
        self.assertEqual(domains, [])
        self.assertEqual(empty['project_count'], 0)

    def test_shape_row_and_task_counts(self):
        self._entry(self.project, kind='budget', title='Budget', amount=1000)
        self._entry(self.project, kind='expense', title='Cost', amount=200, expense_date='2030-01-01')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', ANALYTICS_URL).json()
        row = next(item for item in body['projects'] if item['project']['id'] == self.project.id)
        self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual(set(row['project']), PROJECT_REF_KEYS)
        self.assertIsNone(row['project']['status'], "to_define is null on the wire")
        self.assertEqual((row['finance']['planned'], row['finance']['actual']), (1000, 200))
        # Fixtures: task_overdue (open, overdue), task_done (closed), task_other (open) -> 1 of 3, 1 overdue.
        self.assertEqual((row['task_count'], row['closed_task_count'], row['overdue_task_count'], row['progress']),
                          (3, 1, 1, 33))

    def test_status_filter_and_unset(self):
        self.project.with_user(self.manager)._webvue_set_status('on_track')
        other = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Off track project'})
        other.with_user(self.manager)._webvue_set_status('off_track')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', f'{ANALYTICS_URL}?status=on_track').json()
        self.assertEqual([item['project']['id'] for item in body['projects']], [self.project.id])
        body = self.api('GET', f'{ANALYTICS_URL}?status=off_track').json()
        self.assertEqual([item['project']['id'] for item in body['projects']], [other.id])
        unset = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Unset project'})
        body = self.api('GET', f'{ANALYTICS_URL}?status=unset').json()
        self.assertIn(unset.id, [item['project']['id'] for item in body['projects']])

    def test_totals_group_known_budgets_only_and_sum_all_actuals(self):
        self._entry(self.project, kind='budget', title='Budget', amount=1000)
        self._entry(self.project, kind='expense', title='Cost', amount=1200, expense_date='2030-01-01')
        unbudgeted = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Unbudgeted project'})
        self._entry(unbudgeted, kind='expense', title='Loose cost', amount=50, expense_date='2030-01-01')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', ANALYTICS_URL).json()
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
        archived.with_user(self.manager)._webvue_archive()
        private = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Private report project', 'privacy_visibility': 'followers'})
        company_b = self.env['res.company'].create({'name': 'Report company B'})
        foreign = self.env['project.project'].create({'name': 'Foreign report project', 'company_id': company_b.id})
        companyless = self.env['project.project'].create({'name': 'Companyless report project', 'company_id': False})
        self.authenticate('api_emp', 'api_emp_pass_123')
        ids = {item['project']['id'] for item in self.api('GET', ANALYTICS_URL).json()['projects']}
        self.assertNotIn(archived.id, ids)
        self.assertNotIn(private.id, ids)
        self.assertNotIn(foreign.id, ids)
        self.assertNotIn(companyless.id, ids)

    def test_task_counts_null_without_task_read_capability(self):
        role = self.env['webvue.access.role'].create({
            'name_ar': 'قارئ المشاريع فقط',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', '=', 'pmo.projects.read'),
            ]).ids)],
        })
        reader = new_test_user(self.env, login='report_reader', password='report_reader_pass_123', groups='base.group_user')
        self.env['webvue.access.assignment'].create({
            'user_id': reader.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        self.authenticate('report_reader', 'report_reader_pass_123')
        body = self.api('GET', ANALYTICS_URL).json()
        row = next(item for item in body['projects'] if item['project']['id'] == self.project.id)
        self.assertEqual(
            (row['task_count'], row['closed_task_count'], row['overdue_task_count'], row['progress']),
            (None, None, None, None),
        )
        # Finance visibility is not gated by pmo.tasks.read.
        self.assertIsNotNone(row['finance'])

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
        totals = self.api('GET', ANALYTICS_URL).json()['totals'][0]
        self.assertEqual(totals['planned'], round(0.10 * len(projects), 2))
        self.assertEqual(totals['actual'], round(0.06 * len(projects), 2))
        self.assertEqual(totals['remaining'], round(0.04 * len(projects), 2))
        self.assertEqual(totals['over_budget_count'], 0)

    def test_reports_have_no_implicit_access_from_system_admin_role(self):
        admin = new_test_user(
            self.env, login='report_system_admin', password='report_system_admin_pass_123',
            name='Nour', groups='base.group_user',
        )
        self.env['webvue.access.assignment'].create({
            'user_id': admin.id, 'role_id': self.env.ref('webvue_core.role_system_admin').id,
            'company_id': self.env.company.id,
        })
        self.authenticate('report_system_admin', 'report_system_admin_pass_123')
        self.assertEqual(self.api('GET', ANALYTICS_URL).status_code, 403)

    def test_dashboard_summary_shape_and_all_project_scope(self):
        self.project.with_user(self.manager)._webvue_set_status('on_track')
        for i in range(201):
            self.env['project.project'].create({
                'company_id': self.env.company.id,
                'name': f'Dashboard scope {i:03d}',
            })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', SUMMARY_URL, timeout=60).json()
        self.assertEqual(set(body), {
            'project_count', 'attention_project_count', 'overdue_task_count',
            'status_counts', 'totals', 'attention',
        })
        self.assertGreaterEqual(body['project_count'], 202)
        self.assertEqual(body['project_count'], sum(item['count'] for item in body['status_counts']))
        self.assertEqual(body['overdue_task_count'], 1)
        self.assertLessEqual(len(body['attention']), 10)

    def test_dashboard_summary_reuses_q_and_status_filters(self):
        self.project.with_user(self.manager)._webvue_set_status('on_track')
        other = self.env['project.project'].create({
            'company_id': self.env.company.id, 'name': 'Dashboard other',
        })
        other.with_user(self.manager)._webvue_set_status('off_track')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', f'{SUMMARY_URL}?q=other&status=off_track').json()
        self.assertEqual(body['project_count'], 1)
        self.assertEqual(body['status_counts'], [{'status': 'off_track', 'count': 1}])
        self.assertEqual([item['project']['id'] for item in body['attention']], [other.id])
        self.assertEqual(self.api('GET', f'{SUMMARY_URL}?status=unset').json()['project_count'], 0)

    def test_dashboard_summary_task_totals_are_null_without_task_read(self):
        role = self.env['webvue.access.role'].create({
            'name_ar': 'قارئ المشاريع للوحة',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', '=', 'pmo.projects.read'),
            ]).ids)],
        })
        reader = new_test_user(
            self.env, login='dashboard_reader', password='dashboard_reader_pass_123',
            groups='base.group_user',
        )
        self.env['webvue.access.assignment'].create({
            'user_id': reader.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        self.authenticate('dashboard_reader', 'dashboard_reader_pass_123')
        body = self.api('GET', SUMMARY_URL).json()
        self.assertIsNone(body['overdue_task_count'])
        self.assertTrue(all(item['overdue_task_count'] is None for item in body['attention']))

    def test_dashboard_summary_isolates_archived_private_foreign_projects(self):
        archived = self.env['project.project'].create({
            'company_id': self.env.company.id, 'name': 'Archived dashboard project',
        })
        archived.with_user(self.manager)._webvue_archive()
        private = self.env['project.project'].create({
            'company_id': self.env.company.id, 'name': 'Private dashboard project',
            'privacy_visibility': 'followers',
        })
        company_b = self.env['res.company'].create({'name': 'Dashboard company B'})
        foreign = self.env['project.project'].create({
            'company_id': company_b.id, 'name': 'Foreign dashboard project',
        })
        companyless = self.env['project.project'].create({
            'name': 'Companyless dashboard project', 'company_id': False,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', SUMMARY_URL).json()
        ids = {item['project']['id'] for item in body['attention']}
        visible_ids = {
            item['project']['id'] for item in self.api('GET', ANALYTICS_URL).json()['projects']
        }
        self.assertNotIn(archived.id, visible_ids | ids)
        self.assertNotIn(private.id, visible_ids | ids)
        self.assertNotIn(foreign.id, visible_ids | ids)
        self.assertNotIn(companyless.id, visible_ids | ids)

    def test_dashboard_summary_deduplicates_attention_and_orders_by_overdue(self):
        Project = self.env['project.project']
        high = Project.create({'company_id': self.env.company.id, 'name': 'A high overdue'})
        low = Project.create({'company_id': self.env.company.id, 'name': 'B low overdue'})
        status_only = Project.create({'company_id': self.env.company.id, 'name': 'C status only'})
        high.with_user(self.manager)._webvue_set_status('at_risk')
        status_only.with_user(self.manager)._webvue_set_status('off_track')
        Task = self.env['project.task']
        for i in range(3):
            Task.create({
                'name': f'High overdue {i}', 'project_id': high.id,
                'date_deadline': '2020-01-01', 'user_ids': [(4, self.employee.id)],
            })
        Task.create({
            'name': 'Low overdue', 'project_id': low.id,
            'date_deadline': '2020-01-01', 'user_ids': [(4, self.employee.id)],
        })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', SUMMARY_URL).json()
        attention = body['attention']
        ids = [item['project']['id'] for item in attention]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids[:2], [high.id, low.id])
        high_rows = [item for item in attention if item['project']['id'] == high.id]
        self.assertEqual(len(high_rows), 1)
        self.assertEqual(body['attention_project_count'], 4)

    def test_dashboard_summary_rejects_pagination_and_invalid_status(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', f'{SUMMARY_URL}?limit=10').status_code, 400)
        self.assertEqual(self.api('GET', f'{SUMMARY_URL}?offset=1').status_code, 400)
        self.assertEqual(self.api('GET', f'{SUMMARY_URL}?bogus=1').status_code, 400)
        self.assertEqual(self.api('GET', f'{SUMMARY_URL}?status=nope').status_code, 422)
        self.assertEqual(self.api('GET', f'{SUMMARY_URL}?mine=maybe').status_code, 422)

    def test_dashboard_summary_mine_counts_only_managed_projects(self):
        Project = self.env['project.project']
        managed = Project.create({'company_id': self.env.company.id, 'name': 'Managed summary project', 'user_id': self.manager.id})
        Project.create({'company_id': self.env.company.id, 'name': 'Unmanaged summary project', 'user_id': False})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        mine = self.api('GET', f'{SUMMARY_URL}?mine=1').json()
        everything = self.api('GET', SUMMARY_URL).json()
        expected = Project.with_user(self.manager).search_count([
            ('company_id', '=', self.env.company.id), ('user_id', '=', self.manager.id),
        ])
        self.assertIn(managed.id, Project.search([('user_id', '=', self.manager.id)]).ids)
        self.assertEqual(mine['project_count'], expected)
        self.assertLess(mine['project_count'], everything['project_count'])

    def test_dashboard_analytics_returns_full_scope_and_tied_latest_five(self):
        Project = self.env['project.project']
        projects = [Project.create({
            'company_id': self.env.company.id,
            'name': f'Analytics scope {index:03d}',
        }) for index in range(201)]
        tied_date = fields.Datetime.to_string(fields.Datetime.now())
        self.env.cr.execute(
            'UPDATE project_project SET write_date = %s WHERE id IN %s',
            [tied_date, tuple(project.id for project in projects)],
        )
        for project in projects:
            project.invalidate_recordset(['write_date'])

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', f'{ANALYTICS_URL}?q=Analytics%20scope', timeout=60).json()
        self.assertEqual(set(body), {
            'project_count', 'attention_project_count', 'overdue_task_count',
            'status_counts', 'totals', 'attention', 'projects', 'recent_projects',
        })
        self.assertEqual(body['project_count'], 201)
        self.assertEqual(len(body['projects']), 201)
        self.assertEqual(
            [row['project']['id'] for row in body['projects']],
            [project.id for project in projects],
        )
        expected_recent = sorted((project.id for project in projects), reverse=True)[:5]
        self.assertEqual(
            [row['project']['id'] for row in body['recent_projects']], expected_recent,
        )
        self.assertTrue(all(
            row['updated_at'] == tied_date.replace(' ', 'T') + 'Z'
            for row in body['recent_projects']
        ))
        self.assertEqual(
            (body['projects'][0]['task_count'], body['projects'][0]['closed_task_count'],
             body['projects'][0]['overdue_task_count'], body['projects'][0]['progress']),
            (0, 0, 0, 0),
        )

    def test_dashboard_analytics_excludes_hidden_projects_from_both_arrays(self):
        archived = self.env['project.project'].create({
            'company_id': self.env.company.id, 'name': 'Archived analytics project',
        })
        archived.with_user(self.manager)._webvue_archive()
        private = self.env['project.project'].create({
            'company_id': self.env.company.id, 'name': 'Private analytics project',
            'privacy_visibility': 'followers',
        })
        company_b = self.env['res.company'].create({'name': 'Analytics company B'})
        foreign = self.env['project.project'].create({
            'name': 'Foreign analytics project', 'company_id': company_b.id,
        })
        companyless = self.env['project.project'].create({
            'name': 'Companyless analytics project', 'company_id': False,
        })

        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', ANALYTICS_URL).json()
        project_ids = {row['project']['id'] for row in body['projects']}
        recent_ids = {row['project']['id'] for row in body['recent_projects']}
        for hidden in (archived, private, foreign, companyless):
            self.assertNotIn(hidden.id, project_ids)
            self.assertNotIn(hidden.id, recent_ids)

    def test_dashboard_analytics_task_values_are_null_without_task_read(self):
        role = self.env['webvue.access.role'].create({
            'name_ar': 'قارئ المشاريع للتحليلات',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', '=', 'pmo.projects.read'),
            ]).ids)],
        })
        reader = new_test_user(
            self.env, login='analytics_reader', password='analytics_reader_pass_123',
            groups='base.group_user',
        )
        self.env['webvue.access.assignment'].create({
            'user_id': reader.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        self.authenticate('analytics_reader', 'analytics_reader_pass_123')
        body = self.api('GET', ANALYTICS_URL).json()
        row = next(item for item in body['projects'] if item['project']['id'] == self.project.id)
        self.assertEqual(
            (row['task_count'], row['closed_task_count'], row['overdue_task_count'], row['progress']),
            (None, None, None, None),
        )
        recent = next(item for item in body['recent_projects'] if item['project']['id'] == self.project.id)
        self.assertEqual(
            (recent['task_count'], recent['closed_task_count'], recent['overdue_task_count'], recent['progress']),
            (None, None, None, None),
        )

    def test_dashboard_analytics_matches_summary_for_finance_and_grouped_task_counts(self):
        project = self.env['project.project'].create({
            'company_id': self.env.company.id, 'name': 'Analytics finance project',
        })
        self._entry(project, kind='budget', title='Budget one', amount=100)
        self._entry(project, kind='budget', title='Budget two', amount=50)
        self._entry(project, kind='expense', title='Expense one', amount=20, expense_date='2030-01-01')
        self._entry(project, kind='expense', title='Expense two', amount=30, expense_date='2030-01-01')
        Task = self.env['project.task']
        Task.create({
            'name': 'Analytics overdue', 'project_id': project.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': '2020-01-01',
        })
        Task.create({
            'name': 'Analytics done', 'project_id': project.id,
            'user_ids': [(4, self.employee.id)], 'state': '1_done',
        })
        Task.create({
            'name': 'Analytics open', 'project_id': project.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': '2999-01-01',
        })
        no_budget = self.env['project.project'].create({
            'company_id': self.env.company.id, 'name': 'Analytics zero budget project',
        })

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        query = '?q=Analytics%20finance%20project'
        analytics = self.api('GET', f'{ANALYTICS_URL}{query}').json()
        summary = self.api('GET', f'{SUMMARY_URL}{query}').json()
        row = analytics['projects'][0]
        self.assertEqual(row, summary['attention'][0])
        self.assertEqual(
            (row['finance']['planned'], row['finance']['actual'], row['finance']['remaining']),
            (150, 50, 100),
        )
        self.assertEqual(
            (row['task_count'], row['closed_task_count'], row['overdue_task_count'], row['progress']),
            (3, 1, 1, 33),
        )
        all_projects = self.api('GET', ANALYTICS_URL).json()['projects']
        zero_row = next(item for item in all_projects if item['project']['id'] == no_budget.id)
        self.assertEqual(
            (zero_row['finance']['planned'], zero_row['finance']['actual'], zero_row['finance']['remaining']),
            (None, 0, None),
        )
        self.assertEqual(
            (zero_row['task_count'], zero_row['closed_task_count'], zero_row['overdue_task_count'], zero_row['progress']),
            (0, 0, 0, 0),
        )

    def test_dashboard_analytics_rejects_pagination_and_invalid_status(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', f'{ANALYTICS_URL}?limit=10').status_code, 400)
        self.assertEqual(self.api('GET', f'{ANALYTICS_URL}?offset=1').status_code, 400)
        self.assertEqual(self.api('GET', f'{ANALYTICS_URL}?status=nope').status_code, 422)
