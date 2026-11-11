# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date
from unittest.mock import patch

from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_pmo.serializers.project_evm import build_evm

FEATURE = 'pmo.evm'
D = date
TODAY = D(2026, 3, 15)


@tagged('post_install', '-at_install', 'liwan')
class TestProjectEvm(LiwanPmoCase):
    """The worked example of the maths test, read through the route: four equal tasks, a 120 000 budget, 48 000 spent."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project.write({'user_id': cls.manager.id})
        cls.base = f'/api/v1/projects/{cls.project.id}'
        cls.Task = cls.env['project.task'].sudo()
        (cls.task_overdue | cls.task_done | cls.task_other).sudo().write({'active': False})
        cls.t_done = cls._task('Done', D(2026, 3, 1), D(2026, 3, 11), state='1_done')
        cls.t_half = cls._task('Half', D(2026, 3, 5), D(2026, 3, 25))
        cls.t_mid = cls._task('Mid', D(2026, 3, 10), D(2026, 3, 20))
        cls.t_later = cls._task('Later', D(2026, 3, 20), D(2026, 3, 30))
        cls.env['liwan.project.finance.entry'].sudo().create({
            'project_id': cls.project.id, 'kind': 'budget', 'title': 'Budget', 'amount': 120000,
        })
        cls.project.sudo().liwan_charter_state = 'approved'
        cls.baseline = cls.env['liwan.project.baseline'].with_user(cls.manager).create({'project_id': cls.project.id})

    def setUp(self):
        super().setUp()
        # Expenses are manual only while the actual cost source answers "manual", which the case patches per test.
        self.env['liwan.project.finance.entry'].sudo().create({
            'project_id': self.project.id, 'kind': 'expense', 'title': 'Spend', 'amount': 48000, 'expense_date': D(2026, 3, 2),
        })

    @classmethod
    def _task(cls, name, start, end, **extra):
        return cls.Task.create({
            'name': name, 'project_id': cls.project.id, 'liwan_planned_start': start,
            'date_deadline': fields.Datetime.to_datetime(end), **extra,
        })

    def _get(self, login='api_mgr'):
        password = {'api_emp': 'api_emp_pass_123', 'api_mgr': 'api_mgr_pass_123'}.get(login, f'{login}_pass_123')
        self.authenticate(login, password)
        return self.api('GET', f'{self.base}/evm')

    def _method(self, value):
        self.env['ir.config_parameter'].sudo().set_param(f'liwan_pmo.evm_progress_method.{self.env.company.id}', value)

    def _build(self):
        return build_evm(self.project.with_user(self.manager), self.baseline.with_user(self.manager), TODAY)

    # --- the numbers ---------------------------------------------------------------------
    def test_binary_method_counts_the_finished_task_only(self):
        evm = self._build()
        self.assertEqual(evm['method'], 'binary')
        self.assertEqual((evm['bac'], evm['pv'], evm['ev'], evm['ac']), (120000, 60000, 30000, 48000))
        self.assertEqual((evm['spi'], evm['cpi']), (0.5, 0.63))
        self.assertEqual((evm['baseline_number'], evm['as_of'], evm['hidden_count'], evm['undated_count']), (1, '2026-03-15', 0, 0))

    def test_manual_method_reads_the_percent_complete_of_open_tasks(self):
        self._method('manual')
        self.t_half.liwan_percent_complete = 40
        evm = self._build()
        self.assertEqual(evm['method'], 'manual')
        self.assertEqual(
            {key: evm[key] for key in ('pv', 'ev', 'ac', 'sv', 'cv', 'spi', 'cpi', 'eac', 'etc', 'vac', 'tcpi')},
            {'pv': 60000, 'ev': 42000, 'ac': 48000, 'sv': -18000, 'cv': -6000, 'spi': 0.7, 'cpi': 0.88,
             'eac': 137142.86, 'etc': 89142.86, 'vac': -17142.86, 'tcpi': 1.08},
        )
        self.assertEqual(evm['planned_curve'][-1], {'date': '2026-03-30', 'pv': 120000})

    def test_a_cancelled_or_moved_task_earns_nothing_and_keeps_its_planned_value(self):
        self.t_done.write({'state': '1_canceled'})
        self.assertEqual(self._build()['ev'], 0)
        self.t_done.write({'state': '1_done'})
        other = self.env['project.project'].create({'name': 'Elsewhere', 'company_id': self.env.company.id})
        self.t_done.write({'project_id': other.id})
        evm = self._build()
        self.assertEqual((evm['pv'], evm['ev']), (60000, 0))

    def test_a_deleted_task_earns_nothing(self):
        self.t_done.unlink()
        evm = self._build()
        self.assertEqual((evm['pv'], evm['ev']), (60000, 0))

    def test_the_route_reads_the_callers_calendar_day(self):
        with patch.object(fields.Date, 'context_today', staticmethod(lambda *_args, **_kwargs: TODAY)):
            response = self._get()
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body['as_of'], body['pv'], body['ev'], body['currency']['id'] == self.project.currency_id.id), ('2026-03-15', 60000, 30000, True))
        self.assertEqual(set(body) >= {'baseline_number', 'computed_at', 'bac', 'pv', 'ev', 'ac', 'sv', 'cv', 'spi', 'cpi', 'eac', 'etc', 'vac', 'tcpi', 'method', 'planned_curve'}, True)

    def test_a_project_without_a_budget_keeps_the_schedule_index(self):
        self.env['liwan.project.finance.entry'].sudo().search([('project_id', '=', self.project.id)]).unlink()
        baseline = self.env['liwan.project.baseline'].with_user(self.manager).create({'project_id': self.project.id})
        evm = build_evm(self.project.with_user(self.manager), baseline, TODAY)
        self.assertEqual((evm['bac'], evm['spi'], evm['cpi'], evm['eac']), (0, 0.5, None, None))

    # --- gates -----------------------------------------------------------------------------------
    def test_no_baseline_answers_409(self):
        other = self.env['project.project'].create({'name': 'Fresh', 'company_id': self.env.company.id, 'user_id': self.manager.id})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('GET', f'/api/v1/projects/{other.id}/evm')
        self.assertEqual((response.status_code, response.json()['code']), (409, 'no_baseline'))

    def test_hidden_or_missing_project_answers_404(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/projects/99999999/evm').status_code, 404)
        self.project.sudo().write({'active': False})
        self.assertEqual(self._get().status_code, 404)
        self.project.sudo().write({'active': True})

    def test_cost_numbers_need_the_finance_gate(self):
        outsider = new_test_user(self.env, login='api_evm_outsider', password='api_evm_outsider_pass_123', name='Out', groups='base.group_user')
        outsider.write({'liwan_access_managed': True})
        self.assertEqual(self._get('api_evm_outsider').status_code, 403)
        self.assertEqual(self._get('api_mgr').status_code, 200)

    def test_a_reader_without_task_access_gets_no_plan_figures(self):
        reader = new_test_user(self.env, login='api_evm_reader', password='api_evm_reader_pass_123', name='Reader', groups='base.group_user')
        role = self.env['liwan.access.role'].create({
            'name_ar': 'قارئ المشاريع للقيمة المكتسبة', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([('key', 'in', ('pmo.projects.read', 'pmo.finance.read'))]).ids)],
        })
        self.env['liwan.access.assignment'].create({'user_id': reader.id, 'role_id': role.id, 'company_id': self.env.company.id})
        body = self._get('api_evm_reader').json()
        self.assertEqual((body['bac'], body['ac'], body['hidden_count'], body['pv'], body['ev'], body['spi'], body['cpi'], body['planned_curve']), (120000, 48000, 4, None, None, None, None, []))

    def test_some_hidden_tasks_blank_the_plan_figures_but_not_the_cost(self):
        visible = self.baseline.task_ids[:3]
        with patch('odoo.addons.liwan_pmo.serializers.project_baseline.readable_lines', return_value=visible):
            evm = self._build()
        self.assertEqual((evm['hidden_count'], evm['bac'], evm['ac']), (1, 120000, 48000))
        for key in ('pv', 'ev', 'sv', 'cv', 'spi', 'cpi', 'eac', 'etc', 'vac', 'tcpi'):
            self.assertIsNone(evm[key], key)
        self.assertEqual(evm['planned_curve'], [])

    def test_an_undated_task_blanks_the_cost_indices_only(self):
        self.Task.create({'name': 'Undated done', 'project_id': self.project.id, 'state': '1_done'})
        baseline = self.env['liwan.project.baseline'].with_user(self.manager).create({'project_id': self.project.id})
        evm = build_evm(self.project.with_user(self.manager), baseline, TODAY)
        self.assertEqual((evm['undated_count'], evm['spi'] is not None, evm['bac'], evm['ac']), (1, True, 120000, 48000))
        for key in ('cv', 'cpi', 'eac', 'etc', 'vac', 'tcpi'):
            self.assertIsNone(evm[key], key)

    def test_a_withdrawn_feature_keeps_reads_open_and_the_chosen_method_but_refuses_writes(self):
        self._method('manual')
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, FEATURE: False}})
        self.assertEqual(self._get().status_code, 200, 'a withdrawn sub-feature keeps reads open')
        self.assertEqual(self.env['liwan.pmo.settings'].evm_progress_method(), 'manual', 'a retained read keeps the method')
        refused = self._patch_task('api_mgr', self.t_half, {'percent_complete': 40})
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'percent_complete'))
        detail = self.api('GET', f'/api/v1/tasks/{self.t_half.id}').json()
        self.assertEqual(detail['progress_method'], 'manual')
        self.assertNotIn('write_percent', detail['allowed_actions'], 'a downgraded tenant is not offered an edit that cannot save')

    # --- percent complete -----------------------------------------------------------------------------
    def _patch_task(self, login, task, body):
        password = {'api_emp': 'api_emp_pass_123', 'api_mgr': 'api_mgr_pass_123'}.get(login, f'{login}_pass_123')
        self.authenticate(login, password)
        return self.api('PATCH', f'/api/v1/tasks/{task.id}', body)

    def test_percent_complete_is_editable_only_under_the_manual_method(self):
        refused = self._patch_task('api_mgr', self.t_half, {'percent_complete': 40})
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'percent_complete'))
        self._method('manual')
        saved = self._patch_task('api_mgr', self.t_half, {'percent_complete': 40})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual((saved.json()['percent_complete'], saved.json()['progress_method']), (40, 'manual'))
        for bad in (101, -1, 'x', True, 4.5):
            response = self._patch_task('api_mgr', self.t_half, {'percent_complete': bad})
            self.assertEqual((response.status_code, response.json()['field']), (422, 'percent_complete'), bad)

    def test_write_percent_is_offered_only_for_an_open_task_a_writer_edits_under_manual(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')

        def actions(task):
            return self.api('GET', f'/api/v1/tasks/{task.id}').json()['allowed_actions']

        self.assertNotIn('write_percent', actions(self.t_half), 'binary method')
        self._method('manual')
        self.assertIn('write_percent', actions(self.t_half))
        self.assertNotIn('write_percent', actions(self.t_done), 'a closed task is fixed')

    def test_the_percent_of_a_closed_task_is_fixed(self):
        self._method('manual')
        refused = self._patch_task('api_mgr', self.t_done, {'percent_complete': 10})
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'percent_complete'))
        self.t_half.write({'state': '1_canceled'})
        self.assertEqual(self._patch_task('api_mgr', self.t_half, {'percent_complete': 10}).status_code, 422)

    def test_an_assignee_edits_their_own_percent_and_a_done_task_reads_100(self):
        self._method('manual')
        mine = self.Task.create({'name': 'Mine', 'project_id': self.project.id, 'user_ids': [(4, self.employee.id)]})
        self.assertEqual(self._patch_task('api_emp', mine, {'percent_complete': 25}).status_code, 200)
        self.assertEqual(mine.liwan_percent_complete, 25)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', f'/api/v1/tasks/{self.t_done.id}').json()['percent_complete'], 100)

    def test_the_binary_detail_reads_zero_or_100(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        half = self.api('GET', f'/api/v1/tasks/{self.t_half.id}').json()
        done = self.api('GET', f'/api/v1/tasks/{self.t_done.id}').json()
        self.assertEqual((half['percent_complete'], half['progress_method'], done['percent_complete']), (0, 'binary', 100))

    def test_the_setting_is_a_company_choice_managers_change(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('PATCH', '/api/v1/settings/projects', {'evm_progress_method': 'manual'}).status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        saved = self.api('PATCH', '/api/v1/settings/projects', {'evm_progress_method': 'manual'})
        self.assertEqual((saved.status_code, saved.json()['evm_progress_method']), (200, 'manual'))
        invalid = self.api('PATCH', '/api/v1/settings/projects', {'evm_progress_method': 'guess'})
        self.assertEqual((invalid.status_code, invalid.json()['field']), (422, 'evm_progress_method'))
