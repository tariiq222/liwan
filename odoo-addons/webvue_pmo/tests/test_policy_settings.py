# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestRegisterOrderAndStatus(WebVuePmoCase):
    """Risk and issue register: severity order, issue score, and the status-transition policy."""

    def setUp(self):
        super().setUp()
        self.project.write({'user_id': self.manager.id})
        self.url = f'/api/v1/projects/{self.project.id}/register'
        self.authenticate('api_mgr', 'api_mgr_pass_123')

    def _set_policy(self, **values):
        admin = new_test_user(
            self.env, login='policy_admin', password='policy_admin_pass_123',
            groups='webvue_pmo.group_pmo_manager',
        )
        self.env['webvue.pmo.settings'].with_user(admin).set_values(values)

    def _create(self, **values):
        return self.api('POST', self.url, {'kind': 'issue', 'title': 'Item', **values})

    def test_register_lists_by_severity_not_alphabetically(self):
        for priority in ('low', 'normal', 'critical', 'high'):
            self.assertEqual(self._create(title=priority, priority=priority).status_code, 201)
        items = self.api('GET', self.url).json()['items']
        self.assertEqual([item['priority'] for item in items], ['critical', 'high', 'normal', 'low'])

    def test_an_issue_has_no_score_like_its_probability_and_impact(self):
        issue = self._create().json()
        self.assertEqual((issue['score'], issue['probability'], issue['impact']), (None, None, None))

    def test_sequence_mode_is_the_default_and_refuses_jumps(self):
        self.assertEqual(self.env['webvue.pmo.settings'].get()['register_status_transitions'], 'sequence')
        item = self._create().json()
        url = f"{self.url}/{item['id']}"
        for jump in ('closed', 'resolved'):
            res = self.api('PATCH', url, {'status': jump})
            self.assertEqual((res.status_code, res.json()['code']), (422, 'invalid'), jump)
        for step in ('in_progress', 'resolved', 'closed', 'resolved'):
            res = self.api('PATCH', url, {'status': step})
            self.assertEqual((res.status_code, res.json()['status']), (200, step))
        self.assertEqual(self.api('PATCH', url, {'status': 'open'}).status_code, 422)
        self.assertEqual(self._create(status='closed').status_code, 422)

    def test_free_mode_accepts_any_status(self):
        self._set_policy(register_status_transitions='free')
        item = self._create(status='closed').json()
        self.assertEqual(item['status'], 'closed')
        res = self.api('PATCH', f"{self.url}/{item['id']}", {'status': 'open'})
        self.assertEqual((res.status_code, res.json()['status']), (200, 'open'))


@tagged('post_install', '-at_install', 'webvue')
class TestClosingWithOpenTasks(WebVuePmoCase):
    """The `close_with_open_tasks` project setting, enforced when a project moves to `closed`."""

    def setUp(self):
        super().setUp()
        self.project.write({'user_id': self.manager.id, 'webvue_phase': 'closing'})
        self.admin = new_test_user(
            self.env, login='close_admin', password='close_admin_pass_123',
            groups='webvue_pmo.group_pmo_manager',
        )
        self.authenticate('api_mgr', 'api_mgr_pass_123')

    def _close(self, **extra):
        return self.api('POST', f'/api/v1/projects/{self.project.id}/phase', {
            'phase': 'closed', 'expected_updated_at': self.project._webvue_updated_at(), **extra,
        })

    def test_default_blocks_closing_with_open_tasks(self):
        self.assertEqual(self.env['webvue.pmo.settings'].get()['close_with_open_tasks'], 'block')
        res = self._close(acknowledge_warnings=True)
        self.assertEqual((res.status_code, res.json()['code']), (409, 'phase_gate'))
        self.assertEqual(self.project.webvue_phase, 'closing')

    def test_warning_mode_needs_the_manager_to_confirm(self):
        self.env['webvue.pmo.settings'].with_user(self.admin).set_values({'close_with_open_tasks': 'allow_with_warning'})
        refused = self._close()
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.json()['details']['checks'], [{'key': 'no_open_tasks', 'ok': False, 'warning': True}])
        self.assertEqual(self.project.webvue_phase, 'closing')
        accepted = self._close(acknowledge_warnings=True)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(self.project.webvue_phase, 'closed')

    def test_a_project_without_open_tasks_closes_in_either_mode(self):
        self.env['project.task'].search([('project_id', '=', self.project.id)]).write({'state': '1_canceled'})
        self.assertEqual(self._close().status_code, 200)

    def test_the_setting_is_validated(self):
        self.authenticate('close_admin', 'close_admin_pass_123')
        res = self.api('PATCH', '/api/v1/settings/projects', {'close_with_open_tasks': 'maybe'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'close_with_open_tasks'))
        res = self.api('PATCH', '/api/v1/settings/projects', {'register_status_transitions': 'maybe'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'register_status_transitions'))
        ok = self.api('PATCH', '/api/v1/settings/projects', {'close_with_open_tasks': 'allow_with_warning', 'register_status_transitions': 'free'})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(
            (ok.json()['close_with_open_tasks'], ok.json()['register_status_transitions']),
            ('allow_with_warning', 'free'),
        )
