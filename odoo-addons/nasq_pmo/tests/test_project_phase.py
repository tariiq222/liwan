# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import NasqPmoCase
from odoo.addons.nasq_pmo.models.project_phase import NasqPhaseGate, NasqPhaseStep

PHASE_KEYS = {'current', 'next', 'previous', 'next_checks'}


@tagged('post_install', '-at_install', 'nasq')
class TestProjectPhase(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project.write({'user_id': cls.manager.id})

    def setUp(self):
        super().setUp()
        key = f'nasq_pmo.require_charter_approval.{self.env.company.id}'
        self.env['ir.config_parameter'].sudo().set_param(key, 'false')

    def _as_manager(self):
        return self.project.with_user(self.manager)

    def _approve_charter(self):
        self._as_manager()._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_state, 'approved')

    def _move(self, target, token=None, project=None):
        project = project or self.project
        if token is None:
            token = project._nasq_updated_at()
        return self.api('POST', f'/api/v1/projects/{project.id}/phase', {'phase': target, 'expected_updated_at': token})

    def test_existing_project_starts_initiating(self):
        self.assertEqual(self.project.nasq_phase, 'initiating')
        self._approve_charter()
        self._as_manager()._nasq_move_phase('planning')
        self.assertEqual(self.project.nasq_phase, 'planning')

    def test_forward_blocked_until_charter_approved(self):
        with self.assertRaises(NasqPhaseGate) as ctx:
            self._as_manager()._nasq_move_phase('planning')
        self.assertEqual(ctx.exception.nasq_checks, [{'key': 'charter_approved', 'ok': False}])
        self.assertEqual(self.project.nasq_phase, 'initiating')

    def test_skipping_a_phase_is_rejected(self):
        self._approve_charter()
        with self.assertRaises(NasqPhaseStep):
            self._as_manager()._nasq_move_phase('executing')
        with self.assertRaises(NasqPhaseStep):
            self._as_manager()._nasq_move_phase('initiating')

    def test_backward_one_step_always_allowed(self):
        self._approve_charter()
        self._as_manager()._nasq_move_phase('planning')
        self._as_manager()._nasq_move_phase('initiating')
        self.assertEqual(self.project.nasq_phase, 'initiating')

    def test_reopened_charter_does_not_move_phase_back(self):
        self._approve_charter()
        self._as_manager()._nasq_move_phase('planning')
        key = f'nasq_pmo.require_charter_approval.{self.env.company.id}'
        self.env['ir.config_parameter'].sudo().set_param(key, 'true')
        self.project.with_user(self.manager).write({'name': 'Renamed after approval'})
        self.assertEqual(self.project.nasq_charter_state, 'draft')
        self.assertEqual(self.project.nasq_phase, 'planning')
        self.assertEqual(self.project._nasq_gate_checks('planning'), [{'key': 'charter_approved', 'ok': False}])

    def test_non_manager_cannot_move(self):
        self._approve_charter()
        with self.assertRaises(AccessError):
            self.project.with_user(self.employee)._nasq_move_phase('planning')

    def test_phase_state_shape_at_both_ends(self):
        first = self._as_manager()._nasq_phase_state()
        self.assertEqual(set(first), PHASE_KEYS)
        self.assertEqual((first['previous'], first['next']), (None, 'planning'))
        self.assertEqual(first['next_checks'], [{'key': 'charter_approved', 'ok': False}])
        self.project.nasq_phase = 'closed'
        last = self._as_manager()._nasq_phase_state()
        self.assertEqual((last['previous'], last['next'], last['next_checks']), ('closing', None, []))

    def test_route_moves_and_returns_detail(self):
        self._approve_charter()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self._move('planning')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['phase'], 'planning')
        self.assertEqual(set(body['phase_state']), PHASE_KEYS)
        self.assertEqual(body['phase_state']['next'], 'executing')

    def test_route_gate_error_carries_checks(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self._move('planning')
        self.assertEqual(res.status_code, 409)
        body = res.json()
        self.assertEqual(body['code'], 'phase_gate')
        self.assertEqual(body['details'], {'checks': [{'key': 'charter_approved', 'ok': False}]})

    def test_route_step_error(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self._move('closed')
        self.assertEqual((res.status_code, res.json()['code']), (409, 'phase_step'))

    def test_route_invalid_phase_and_unknown_field(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self._move('bogus')
        self.assertEqual((res.status_code, res.json()['field']), (422, 'phase'))
        token = self.project._nasq_updated_at()
        extra = self.api('POST', f'/api/v1/projects/{self.project.id}/phase', {
            'phase': 'planning', 'expected_updated_at': token, 'name': 'x',
        })
        self.assertEqual((extra.status_code, extra.json()['code']), (422, 'unknown_field'))

    def test_route_forbidden_for_employee(self):
        self._approve_charter()
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self._move('planning').status_code, 403)

    def test_phase_move_with_stale_token(self):
        self._approve_charter()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        token = self.project._nasq_updated_at()
        self.assertEqual(self._move('planning', token).status_code, 200)
        second = self._move('executing', token)
        self.assertEqual((second.status_code, second.json()['code']), (409, 'stale_write'))

    def test_phase_is_not_writable_through_patch(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        for key in ('phase', 'nasq_phase'):
            res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {key: 'executing'})
            self.assertEqual((res.status_code, res.json()['code']), (422, 'unknown_field'))
        self.assertEqual(self.project.nasq_phase, 'initiating')
