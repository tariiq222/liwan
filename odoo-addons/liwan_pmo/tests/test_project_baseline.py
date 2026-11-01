# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date
from unittest.mock import patch

from psycopg2 import IntegrityError

from odoo import fields
from odoo.exceptions import AccessError, LockError, ValidationError
from odoo.tests import new_test_user, tagged
from odoo.tools import mute_logger

from .common import LiwanPmoCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_pmo.models.project_phase import LiwanPhaseGate

FEATURE = 'pmo.baselines'
D = date


@tagged('post_install', '-at_install', 'liwan')
class TestProjectBaseline(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sponsor = new_test_user(
            cls.env, login='api_bl_sponsor', password='api_bl_sponsor_pass_123', name='Sponsor',
            groups='liwan_core.group_employee',
        )
        cls.project.write({'user_id': cls.manager.id, 'liwan_sponsor_id': cls.sponsor.id})
        cls.base = f'/api/v1/projects/{cls.project.id}/baselines'
        cls.Task = cls.env['project.task'].sudo()
        # Three dated tasks and one cancelled one: the baseline keeps the first three.
        cls.t_late = cls._task('Late', D(2026, 3, 1), D(2026, 3, 10))
        cls.t_early = cls._task('Early', D(2026, 3, 5), D(2026, 3, 20))
        cls.t_undated = cls._task('Undated', False, False)
        cls.t_cancelled = cls._task('Cancelled', D(2026, 3, 1), D(2026, 3, 2), state='1_canceled')
        # The fixture tasks of the base case would add undated lines: archive them for exact counts.
        (cls.task_overdue | cls.task_done | cls.task_other).sudo().write({'active': False})

    @classmethod
    def _task(cls, name, start, end, **extra):
        return cls.Task.create({
            'name': name, 'project_id': cls.project.id, 'liwan_planned_start': start,
            'date_deadline': fields.Datetime.to_datetime(end) if end else False, **extra,
        })

    def setUp(self):
        super().setUp()
        self.env['ir.config_parameter'].sudo().set_param(f'liwan_pmo.require_charter_approval.{self.env.company.id}', 'false')

    # --- helpers ------------------------------------------------------------------
    def _call(self, login, method, path, body=None):
        password = {'api_emp': 'api_emp_pass_123', 'api_mgr': 'api_mgr_pass_123'}.get(login, f'{login}_pass_123')
        self.authenticate(login, password)
        return self.api(method, path, body)

    def _param(self, name, value):
        self.env['ir.config_parameter'].sudo().set_param(f'liwan_pmo.{name}.{self.env.company.id}', value)

    def _approve_charter(self):
        self.project.with_user(self.manager)._liwan_charter_submit()
        self.assertEqual(self.project.liwan_charter_state, 'approved')

    def _take(self, login='api_mgr', body=None):
        return self._call(login, 'POST', self.base, body or {})

    def _taken(self, **body):
        response = self._take(body=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def _approved_change(self):
        change = self.env['liwan.project.change'].with_user(self.employee).create({'project_id': self.project.id, 'title': 'Re-plan'})
        change._liwan_submit()
        change.with_user(self.sponsor)._liwan_approve()
        return change

    def _lines(self, number=1):
        return self._call('api_mgr', 'GET', f'{self.base}/{number}').json()['tasks']

    # --- taking ---------------------------------------------------------------------
    def test_first_baseline_needs_an_approved_charter(self):
        response = self._take()
        self.assertEqual((response.status_code, response.json()['code']), (409, 'charter_state'))
        self._approve_charter()
        body = self._taken(note='  Kick-off plan ')
        self.assertEqual((body['number'], body['note'], body['task_count']), (1, 'Kick-off plan', 3))
        self.assertEqual(body['taken_by']['id'], self.manager.id)
        self.assertEqual(sorted(line['name'] for line in body['tasks']), ['Early', 'Late', 'Undated'])
        self.assertEqual([round(line['planned_value_share'], 6) for line in body['tasks']], [round(1 / 3, 6)] * 3)

    def test_the_snapshot_keeps_the_plan_not_the_live_task(self):
        self._approve_charter()
        self._taken()
        self.t_late.write({'name': 'Renamed'})
        self.t_late.unlink()
        lines = {line['name']: line for line in self._lines()}
        self.assertEqual((lines['Late']['task_id'], lines['Late']['planned_end']), (None, '2026-03-10'))
        self.assertNotIn('Renamed', lines)
        # restore the fixture for the other tests of this class
        type(self).t_late = self._task('Late', D(2026, 3, 1), D(2026, 3, 10))

    def test_numbers_run_on_and_the_lock_is_taken_per_baseline(self):
        self._approve_charter()
        with patch.object(type(self.project), 'lock_for_update', autospec=True, side_effect=type(self.project).lock_for_update) as lock:
            numbers = [self._taken()['number'] for _ in range(3)]
        self.assertEqual(numbers, [1, 2, 3])
        self.assertEqual(lock.call_count, 3)
        listed = self._call('api_mgr', 'GET', self.base).json()
        self.assertEqual([item['number'] for item in listed['items']], [3, 2, 1])
        self.assertEqual(listed['total'], 3)

    def test_a_project_busy_with_another_baseline_answers_409(self):
        self._approve_charter()
        with patch.object(type(self.project), 'lock_for_update', side_effect=LockError('busy')):
            response = self._take()
        self.assertEqual((response.status_code, response.json()['code']), (409, 'baseline_busy'))
        self.assertEqual(self.env['liwan.project.baseline'].search_count([('project_id', '=', self.project.id)]), 0)

    def test_two_baselines_never_share_a_number(self):
        self._approve_charter()
        first = self.env['liwan.project.baseline'].with_user(self.manager).create({'project_id': self.project.id})
        values = {
            'project_id': self.project.id, 'currency_id': self.project.currency_id.id, 'number': first.number,
            'taken_by_id': self.manager.id, 'taken_at': fields.Datetime.now(), 'budget_total': 0,
        }
        with mute_logger('odoo.sql_db'), self.assertRaises(IntegrityError), self.env.cr.savepoint():
            self.env['liwan.project.baseline'].sudo().create(values)

    def test_only_the_project_manager_takes_one(self):
        self._approve_charter()
        self.assertEqual(self._take('api_emp').status_code, 403)
        self.assertEqual(self.env['liwan.project.baseline'].search_count([]), 0)

    def test_the_body_takes_only_a_note_and_a_change(self):
        self._approve_charter()
        for body in ({'number': 5}, {'budget_total': 1}, {'note': 4}, {'change_id': 'x'}, {'change_id': True}):
            response = self._take(body=body)
            self.assertEqual(response.status_code, 422, body)
        with self.assertRaises(ValidationError):
            self.env['liwan.project.baseline'].with_user(self.manager).create({'project_id': self.project.id, 'number': 9})

    # --- immutability -----------------------------------------------------------------
    def test_a_baseline_and_its_lines_never_change(self):
        self._approve_charter()
        baseline = self.env['liwan.project.baseline'].browse(self._taken()['id'])
        for env_user in (self.manager, self.env.user):
            Baseline = baseline.with_user(env_user)
            for operation in (
                lambda b=Baseline: b.write({'note': 'changed'}),
                lambda b=Baseline: b.unlink(),
                lambda b=Baseline: b.task_ids.write({'task_name': 'changed'}),
                lambda b=Baseline: b.task_ids.unlink(),
            ):
                with self.assertRaises(AccessError):
                    operation()
        with self.assertRaises(AccessError):
            baseline.sudo().write({'note': 'changed'})
        with self.assertRaises(AccessError):
            baseline.sudo().task_ids.unlink()
        with self.assertRaises(AccessError):
            self.env['liwan.project.baseline.task'].with_user(self.manager).create({
                'baseline_id': baseline.id, 'task_name': 'Smuggled',
            })
        self.assertEqual(baseline.note, '')
        self.assertEqual(baseline.task_count, 3)

    def _other_project(self):
        other = self.env['project.project'].create({
            'name': 'Other', 'company_id': self.env.company.id, 'user_id': self.manager.id, 'liwan_sponsor_id': self.manager.id,
        })
        other.with_user(self.manager)._liwan_charter_submit()
        return other

    def test_deleting_the_project_removes_its_baselines(self):
        other = self._other_project()
        baseline = self.env['liwan.project.baseline'].with_user(self.manager).create({'project_id': other.id})
        other.sudo().unlink()
        self.assertFalse(baseline.sudo().exists())

    # --- change control -----------------------------------------------------------------
    def test_required_mode_asks_an_executing_project_for_an_approved_change(self):
        self._approve_charter()
        self._taken()
        self._param('change_control_mode', 'required')
        self.project.sudo().write({'liwan_phase': 'executing'})
        refused = self._take()
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'change_required'))
        draft = self.env['liwan.project.change'].with_user(self.employee).create({'project_id': self.project.id, 'title': 'Draft'})
        self.assertEqual(self._take(body={'change_id': draft.id}).status_code, 422)
        change = self._approved_change()
        listed = self._call('api_mgr', 'GET', self.base).json()
        self.assertTrue(listed['change_required'])
        self.assertEqual([item['id'] for item in listed['coverable_changes']], [change.id])
        body = self._taken(change_id=change.id)
        self.assertEqual((body['number'], body['change']['id']), (2, change.id))
        change.with_user(self.manager)._liwan_implement()
        self.assertEqual(self._take(body={'change_id': change.id}).status_code, 409, 'an implemented request no longer unlocks')

    def test_optional_mode_and_other_phases_need_no_change(self):
        self._approve_charter()
        self._param('change_control_mode', 'required')
        self.assertEqual(self._taken()['number'], 1, 'planning is not executing')
        self._param('change_control_mode', 'optional')
        self.project.sudo().write({'liwan_phase': 'executing'})
        self.assertEqual(self._taken()['number'], 2)
        covering = self._approved_change()
        self.assertEqual(self._taken(change_id=covering.id)['change']['id'], covering.id)

    def test_a_change_of_another_project_does_not_cover(self):
        self._approve_charter()
        other = self._other_project()
        foreign = self.env['liwan.project.change'].with_user(self.manager).create({'project_id': other.id, 'title': 'Foreign'})
        foreign._liwan_submit()
        self.assertEqual(foreign.state, 'approved')
        self.assertEqual(self._take(body={'change_id': foreign.id}).status_code, 422)
        self.assertEqual(self._take(body={'change_id': 987654}).status_code, 422)

    def test_change_control_off_refuses_a_link(self):
        self._approve_charter()
        change = self._approved_change()
        self._param('change_control_mode', 'off')
        self.assertEqual(self._take(body={'change_id': change.id}).status_code, 422)
        self.assertEqual(self._taken()['number'], 1)

    # --- the gate ---------------------------------------------------------------------------
    def _planning(self):
        self._approve_charter()
        self.project.sudo().write({'liwan_phase': 'planning'})

    def _checks(self):
        return self.project.with_user(self.manager)._liwan_gate_checks('executing')

    def test_gate_modes(self):
        self._planning()
        self.assertEqual(self.env['liwan.pmo.settings'].baseline_gate(), 'warning', 'the default')
        self.assertEqual(self._checks(), [{'key': 'baseline_set', 'ok': False, 'warning': True}])
        project = self.project.with_user(self.manager)
        with self.assertRaises(LiwanPhaseGate):
            project._liwan_move_phase('executing')
        self._param('baseline_gate', 'required')
        self.assertEqual(self._checks(), [{'key': 'baseline_set', 'ok': False}])
        with self.assertRaises(LiwanPhaseGate):
            project._liwan_move_phase('executing', acknowledge_warnings=True)
        self._param('baseline_gate', 'off')
        self.assertEqual(self._checks(), [])
        project._liwan_move_phase('executing')
        self.assertEqual(self.project.liwan_phase, 'executing')

    def test_warning_mode_moves_with_an_acknowledgement_and_a_baseline_clears_it(self):
        self._planning()
        project = self.project.with_user(self.manager)
        project._liwan_move_phase('executing', acknowledge_warnings=True)
        self.assertEqual(self.project.liwan_phase, 'executing')
        project.sudo().write({'liwan_phase': 'planning'})
        self._param('baseline_gate', 'required')
        self._taken()
        self.assertEqual(self._checks(), [{'key': 'baseline_set', 'ok': True}])
        project._liwan_move_phase('executing')
        self.assertEqual(self.project.liwan_phase, 'executing')

    def test_the_gate_check_reaches_the_phase_card_and_the_phase_route(self):
        self._planning()
        card = self._call('api_mgr', 'GET', f'/api/v1/projects/{self.project.id}').json()['phase_state']
        self.assertEqual(card['next_checks'], [{'key': 'baseline_set', 'ok': False, 'warning': True}])
        self._param('baseline_gate', 'required')
        self.project.invalidate_recordset()
        refused = self._call('api_mgr', 'POST', f'/api/v1/projects/{self.project.id}/phase', {
            'phase': 'executing', 'expected_updated_at': self.project._liwan_updated_at(),
        })
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'phase_gate'))

    def test_the_setting_is_a_company_choice_managers_change(self):
        denied = self._call('api_emp', 'PATCH', '/api/v1/settings/projects', {'baseline_gate': 'required'})
        self.assertEqual(denied.status_code, 403)
        saved = self._call('api_mgr', 'PATCH', '/api/v1/settings/projects', {'baseline_gate': 'required'})
        self.assertEqual((saved.status_code, saved.json()['baseline_gate']), (200, 'required'))
        invalid = self._call('api_mgr', 'PATCH', '/api/v1/settings/projects', {'baseline_gate': 'sometimes'})
        self.assertEqual((invalid.status_code, invalid.json()['field']), (422, 'baseline_gate'))

    def test_a_plan_without_the_feature_has_no_gate_and_no_routes(self):
        self._planning()
        self._param('baseline_gate', 'required')
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, FEATURE: False}})
        self.assertEqual(self._checks(), [])
        response = self._take()
        self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))
        self.assertEqual(self._call('api_mgr', 'GET', self.base).status_code, 403)

    # --- variance --------------------------------------------------------------------------
    def _variance(self, login='api_mgr'):
        response = self._call(login, 'GET', f'{self.base}/variance')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_no_baseline_yet_reads_as_empty(self):
        self.assertEqual(self._variance(), {'project_id': self.project.id, 'baseline': None, 'schedule': None, 'cost': None})
        listed = self._call('api_mgr', 'GET', self.base).json()
        self.assertEqual((listed['items'], listed['total'], listed['can_take']), ([], 0, True))
        self.assertFalse(self._call('api_emp', 'GET', self.base).json()['can_take'])

    def test_schedule_variance_counts_late_early_on_time_and_undated(self):
        self._approve_charter()
        self.project.sudo().write({'date_start': D(2026, 3, 1), 'date': D(2026, 4, 30)})
        self._taken()
        self.t_late.write({'liwan_planned_start': D(2026, 3, 4), 'date_deadline': fields.Datetime.to_datetime(D(2026, 3, 13))})
        self.t_early.write({'date_deadline': fields.Datetime.to_datetime(D(2026, 3, 18))})
        self.t_undated.write({'date_deadline': fields.Datetime.to_datetime(D(2026, 3, 25))})
        self.project.sudo().write({'date': D(2026, 5, 5)})
        schedule = self._variance()['schedule']
        rows = {row['name']: row for row in schedule['tasks']}
        self.assertEqual((rows['Late']['start_variance_days'], rows['Late']['end_variance_days']), (3, 3))
        self.assertEqual((rows['Early']['start_variance_days'], rows['Early']['end_variance_days']), (0, -2))
        self.assertEqual((rows['Undated']['start_variance_days'], rows['Undated']['end_variance_days']), (None, None))
        self.assertEqual(rows['Undated']['current_end'], '2026-03-25')
        self.assertEqual((schedule['late_count'], schedule['early_count'], schedule['undated_count']), (1, 1, 1))
        self.assertEqual((schedule['project']['start_variance_days'], schedule['project']['end_variance_days']), (0, 5))
        # a task that left the project shows as removed, with no variance
        self.t_early.unlink()
        removed = {row['name']: row for row in self._variance()['schedule']['tasks']}['Early']
        self.assertEqual((removed['removed'], removed['end_variance_days'], removed['task_id']), (True, None, None))
        type(self).t_early = self._task('Early', D(2026, 3, 5), D(2026, 3, 20))

    def test_variance_is_measured_against_the_latest_baseline(self):
        self._approve_charter()
        self._taken()
        self.t_late.write({'date_deadline': fields.Datetime.to_datetime(D(2026, 3, 15))})
        self.assertEqual(self._variance()['baseline']['number'], 1)
        self._taken()
        schedule = self._variance()
        self.assertEqual(schedule['baseline']['number'], 2)
        rows = {row['name']: row for row in schedule['schedule']['tasks']}
        self.assertEqual(rows['Late']['end_variance_days'], 0)
        first = {line['name']: line for line in self._lines(1)}
        self.assertEqual(first['Late']['planned_end'], '2026-03-10', 'the first snapshot stays as it was')

    def _entry(self, kind, amount):
        values = {'project_id': self.project.id, 'kind': kind, 'title': kind.title(), 'amount': amount}
        if kind == 'expense':
            values['expense_date'] = D(2026, 3, 2)
        self.env['liwan.project.finance.entry'].sudo().create(values)

    def test_cost_variance_compares_the_budget_now_with_the_baseline(self):
        self._approve_charter()
        self._entry('budget', 1000)
        baseline = self._taken()
        self.assertEqual(baseline['budget_total'], 1000)
        self._entry('budget', 500)
        self._entry('expense', 700)
        cost = self._variance()['cost']
        self.assertEqual(
            (cost['baseline_budget'], cost['current_budget'], cost['budget_variance'], cost['actual']),
            (1000, 1500, 500, 700),
        )
        self.assertEqual((cost['remaining_against_baseline'], cost['over_baseline']), (300, False))
        self._entry('expense', 400)
        cost = self._variance()['cost']
        self.assertEqual((cost['remaining_against_baseline'], cost['over_baseline']), (-100, True))

    def test_the_charter_estimate_stands_in_for_a_missing_budget(self):
        self.project.sudo().write({'liwan_budget_state': 'estimate', 'liwan_budget_amount': 250})
        self._approve_charter()
        self.assertEqual(self._taken()['budget_total'], 250)
        self._entry('budget', 90)
        self.assertEqual(self._variance()['cost']['current_budget'], 90, 'finance entries win over the estimate')

    def test_a_reader_sees_the_cost_but_not_tasks_it_cannot_open(self):
        self._approve_charter()
        self._entry('budget', 1000)
        self._taken()
        reader = new_test_user(self.env, login='api_bl_reader', password='api_bl_reader_pass_123', name='Reader', groups='base.group_user')
        role = self.env['liwan.access.role'].create({
            'name_ar': 'قارئ المشاريع للأساس', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([('key', '=', 'pmo.projects.read')]).ids)],
        })
        self.env['liwan.access.assignment'].create({'user_id': reader.id, 'role_id': role.id, 'company_id': self.env.company.id})
        detail = self._call('api_bl_reader', 'GET', f'{self.base}/1')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual((detail.json()['budget_total'], detail.json()['tasks']), (1000, []))
        variance = self._variance('api_bl_reader')
        self.assertEqual((variance['cost']['baseline_budget'], variance['schedule']['tasks']), (1000, []))
        self.assertEqual(self._call('api_bl_reader', 'POST', self.base, {}).status_code, 403)

    def test_a_user_without_project_access_reads_no_cost(self):
        self._approve_charter()
        self._taken()
        outsider = new_test_user(self.env, login='api_bl_outsider', password='api_bl_outsider_pass_123', name='Out', groups='base.group_user')
        outsider.write({'liwan_access_managed': True})
        for suffix in ('', '/1', '/variance'):
            self.assertEqual(self._call('api_bl_outsider', 'GET', self.base + suffix).status_code, 403, suffix)

    # --- reading ------------------------------------------------------------------------------
    def test_a_missing_number_or_project_answers_404(self):
        self._approve_charter()
        self._taken()
        self.assertEqual(self._call('api_mgr', 'GET', f'{self.base}/7').status_code, 404)
        self.assertEqual(self._call('api_mgr', 'GET', '/api/v1/projects/99999999/baselines').status_code, 404)
        self.assertEqual(self._call('api_mgr', 'GET', f'{self.base}?color=red').status_code, 400)

    def test_an_archived_project_hides_its_baselines(self):
        self._approve_charter()
        self._taken()
        self.project.sudo().write({'active': False})
        self.assertEqual(self._call('api_mgr', 'GET', self.base).status_code, 404)
        self.project.sudo().write({'active': True})

    def test_a_project_with_no_baseline_starts_unchanged(self):
        self.assertEqual(self.env['liwan.project.baseline'].search_count([('project_id', '=', self.project.id)]), 0)
        self.assertEqual(self.project.liwan_phase, 'initiating')
