# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestCompletionApproval(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reviewer = new_test_user(
            cls.env, login='psc_reviewer', password='psc_reviewer_pass_123',
            name='Reviewer', groups='nasq_core.group_employee,project.group_project_manager',
        )
        cls.nowrite = new_test_user(
            cls.env, login='psc_nowrite', password='psc_nowrite_pass_123',
            name='No Write', groups='base.group_user',
        )
        nowrite_role = cls.env['nasq.access.role'].create({
            'name_ar': 'مراجع بلا كتابة',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, cls.env['nasq.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.approve']),
            ]).ids)],
        })
        cls.env['nasq.access.assignment'].create({
            'user_id': cls.nowrite.id,
            'role_id': nowrite_role.id,
            'company_id': cls.env.company.id,
        })
        cls.outsider = new_test_user(
            cls.env, login='psc_out', password='psc_out_pass_123',
            groups='nasq_core.group_employee',
        )
        cls.system_admin = new_test_user(
            cls.env, login='psc_sys', password='psc_sys_pass_123',
            groups='base.group_user',
        )
        cls.env['nasq.access.assignment'].create({
            'user_id': cls.system_admin.id,
            'role_id': cls.env.ref('nasq_core.role_system_admin').id,
            'company_id': cls.env.company.id,
        })
        cls.company_b = cls.env['res.company'].create({'name': 'Completion company B'})

    def _project(self, mode, approver=None):
        project = self.env['project.project'].create({
            'name': f'Approval {mode}',
            'user_id': self.manager.id,
            'nasq_completion_approval': mode,
            'nasq_completion_approver_id': approver.id if approver else False,
        })
        task = self.env['project.task'].create({
            'name': 'Needs review',
            'project_id': project.id,
            'user_ids': [(4, self.employee.id)],
        })
        return project, task

    def test_context_default_state_cannot_bypass_approval(self):
        project, _task = self._project('project_manager')
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(self.employee).with_context(
                default_state='1_done', default_project_id=project.id,
            ).create({'name': 'Forged default done'})

    def test_none_mode_still_allows_direct_done(self):
        _project, task = self._project('none')
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{task.id}/transition', {'state': 'done'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['state'], 'done')

    def test_project_manager_request_accept_return_resubmit_reopen(self):
        _project, task = self._project('project_manager')
        self.authenticate('api_emp', 'api_emp_pass_123')
        forbidden = self.api('POST', f'/api/v1/tasks/{task.id}/transition', {'state': 'done'})
        self.assertEqual(forbidden.status_code, 403)
        requested = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertEqual(requested.status_code, 200)
        self.assertTrue(requested.json()['completion_pending'])
        self.assertEqual(requested.json()['state'], 'in_progress')
        revision = requested.json()['completion_revision']
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        returned = self.api('POST', f'/api/v1/tasks/{task.id}/completion/return', {'revision': revision})
        self.assertEqual((returned.status_code, returned.json().get('field')), (422, 'note'))
        returned = self.api('POST', f'/api/v1/tasks/{task.id}/completion/return', {
            'revision': revision, 'note': 'Please add evidence',
        })
        self.assertEqual(returned.status_code, 200)
        self.assertFalse(returned.json()['completion_pending'])
        self.assertEqual(returned.json()['completion_return_note'], 'Please add evidence')
        self.authenticate('api_emp', 'api_emp_pass_123')
        again = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertEqual(again.status_code, 200)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        accepted = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {
            'revision': again.json()['completion_revision'],
        })
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()['state'], 'done')
        self.authenticate('api_emp', 'api_emp_pass_123')
        reopened = self.api('POST', f'/api/v1/tasks/{task.id}/transition', {'state': 'in_progress'})
        self.assertEqual(reopened.status_code, 200)
        self.assertEqual(reopened.json()['state'], 'in_progress')
        self.assertFalse(reopened.json()['completion_pending'])

    def test_self_approval_allowed_for_designated_assignee(self):
        project = self.env['project.project'].create({
            'name': 'Self approval',
            'user_id': self.employee.id,
            'nasq_completion_approval': 'project_manager',
        })
        task = self.env['project.task'].create({
            'name': 'Own work',
            'project_id': project.id,
            'user_ids': [(4, self.employee.id)],
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        requested = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertEqual(requested.status_code, 200)
        accepted = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {
            'revision': requested.json()['completion_revision'],
        })
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()['state'], 'done')

    def test_stale_and_repeated_decisions(self):
        _project, task = self._project('project_manager')
        self.authenticate('api_emp', 'api_emp_pass_123')
        first = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {}).json()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        stale = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {'revision': 0})
        self.assertEqual(stale.status_code, 422)
        ok = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {'revision': first['completion_revision']})
        self.assertEqual(ok.status_code, 200)
        repeated = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {'revision': first['completion_revision']})
        self.assertEqual(repeated.status_code, 422)

    def test_wrong_reviewer_and_system_admin(self):
        _project, task = self._project('specific_user', self.reviewer)
        self.authenticate('api_emp', 'api_emp_pass_123')
        requested = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {}).json()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        wrong = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {
            'revision': requested['completion_revision'],
        })
        self.assertEqual(wrong.status_code, 403)
        self.authenticate('psc_sys', 'psc_sys_pass_123')
        admin_only = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {
            'revision': requested['completion_revision'],
        })
        self.assertIn(admin_only.status_code, (403, 404))
        self.authenticate('psc_reviewer', 'psc_reviewer_pass_123')
        ok = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {
            'revision': requested['completion_revision'],
        })
        self.assertEqual(ok.status_code, 200)

    def test_designated_approver_without_write_can_decide(self):
        project, task = self._project('specific_user', self.nowrite)
        self.authenticate('psc_nowrite', 'psc_nowrite_pass_123')
        detail = self.api('GET', f'/api/v1/tasks/{task.id}').json()
        self.assertTrue(detail['can_approve'])
        self.assertFalse(detail['can_write'])
        self.authenticate('api_emp', 'api_emp_pass_123')
        requested = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {}).json()
        self.authenticate('psc_nowrite', 'psc_nowrite_pass_123')
        detail = self.api('GET', f'/api/v1/tasks/{task.id}').json()
        self.assertIn('accept_completion', detail['allowed_actions'])
        self.assertNotIn('write', detail['allowed_actions'])
        accepted = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {
            'revision': requested['completion_revision'],
        })
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(project.id, task.project_id.id)

    def test_create_write_batch_and_forged_context_cannot_bypass(self):
        project, task = self._project('project_manager')
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(self.employee).create({
                'name': 'Forged done', 'project_id': project.id, 'state': '1_done',
            })
        with self.assertRaises(AccessError):
            task.with_user(self.employee).write({'state': '1_done'})
        other = self.env['project.task'].create({
            'name': 'Batch', 'project_id': project.id, 'user_ids': [(4, self.employee.id)],
        })
        with self.assertRaises(AccessError):
            (task | other).with_user(self.employee).write({'state': '1_done'})
        marker = self.env.cr.precommit.data
        marker['nasq_pmo.task_create_depth'] = 1
        try:
            with self.assertRaises(AccessError):
                task.with_user(self.employee).write({'state': '1_done'})
        finally:
            marker.pop('nasq_pmo.task_create_depth', None)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('PATCH', f'/api/v1/tasks/{task.id}', {'state': 'done'}).status_code, 422)

    def test_policy_edit_invalidates_pending_without_auto_approval(self):
        project, task = self._project('project_manager')
        self.authenticate('api_emp', 'api_emp_pass_123')
        requested = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertTrue(requested.json()['completion_pending'])
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        patched = self.api('PATCH', f'/api/v1/projects/{project.id}', {
            'nasq_completion_approval': 'specific_user',
            'nasq_completion_approver_id': self.reviewer.id,
        })
        self.assertEqual(patched.status_code, 200, patched.text)
        detail = self.api('GET', f'/api/v1/tasks/{task.id}').json()
        self.assertFalse(detail['completion_pending'])
        self.assertEqual(detail['state'], 'in_progress')
        ineligible = self.api('PATCH', f'/api/v1/projects/{project.id}', {
            'nasq_completion_approval': 'specific_user',
            'nasq_completion_approver_id': self.outsider.id,
        })
        self.assertEqual(ineligible.status_code, 422)

    def test_cancel_and_archive_clear_pending_and_reject_stale_accept(self):
        _project, task = self._project('project_manager')
        self.authenticate('api_emp', 'api_emp_pass_123')
        requested = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertEqual(requested.status_code, 200)
        revision = requested.json()['completion_revision']
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        cancelled = self.api('POST', f'/api/v1/tasks/{task.id}/transition', {'state': 'cancelled'})
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()['state'], 'cancelled')
        self.assertFalse(cancelled.json()['completion_pending'])
        self.assertNotIn('accept_completion', cancelled.json()['allowed_actions'])
        accept = self.api('POST', f'/api/v1/tasks/{task.id}/completion/accept', {'revision': revision})
        self.assertEqual(accept.status_code, 422)
        task.invalidate_recordset()
        self.assertEqual(task.state, '1_canceled')
        self.assertFalse(task.nasq_completion_pending)
        reopened = self.api('POST', f'/api/v1/tasks/{task.id}/transition', {'state': 'in_progress'})
        self.assertEqual(reopened.status_code, 200)
        self.assertFalse(reopened.json()['completion_pending'])
        self.authenticate('api_emp', 'api_emp_pass_123')
        again = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertEqual(again.status_code, 200)
        self.assertGreater(again.json()['completion_revision'], revision)

        _project2, task2 = self._project('project_manager')
        self.authenticate('api_emp', 'api_emp_pass_123')
        first = self.api('POST', f'/api/v1/tasks/{task2.id}/completion/request', {}).json()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        archived = self.api('POST', f'/api/v1/tasks/{task2.id}/archive')
        self.assertEqual(archived.status_code, 200)
        self.assertFalse(archived.json()['completion_pending'])
        self.assertNotIn('accept_completion', archived.json()['allowed_actions'])
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{task2.id}/completion/accept', {
            'revision': first['completion_revision'],
        }).status_code, 422)

    def test_context_defaults_cannot_create_pending_completion(self):
        project, _task = self._project('project_manager')
        created = self.env['project.task'].with_user(self.employee).with_context(
            default_nasq_completion_pending=True,
            default_nasq_completion_revision=7,
            default_nasq_completion_requested_by=self.manager.id,
        ).create({'name': 'ctx', 'project_id': project.id})
        created.invalidate_recordset()
        self.assertFalse(created.nasq_completion_pending)
        self.assertEqual(created.nasq_completion_revision, 0)
        self.assertFalse(created.nasq_completion_requested_by)
        self.assertFalse(created.with_user(self.manager)._nasq_can_decide_completion())
        marker = self.env.cr.precommit.data
        marker['nasq_pmo.completion_meta_ids'] = set()
        try:
            with self.assertRaises(AccessError):
                created.with_user(self.employee).write({'nasq_completion_pending': True})
        finally:
            marker.pop('nasq_pmo.completion_meta_ids', None)

    def test_withdraw_allows_resubmit_after_reviewer_repair(self):
        _project, task = self._project('specific_user', self.reviewer)
        self.authenticate('api_emp', 'api_emp_pass_123')
        requested = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertEqual(requested.status_code, 200)
        revision = requested.json()['completion_revision']
        self.assertIn('withdraw_completion', requested.json()['allowed_actions'])
        extra = self.api('POST', f'/api/v1/tasks/{task.id}/completion/withdraw', {
            'revision': revision, 'note': 'nope',
        })
        self.assertEqual(extra.status_code, 422)
        try:
            self.reviewer.write({'active': False})
            task.invalidate_recordset()
            self.authenticate('api_emp', 'api_emp_pass_123')
            detail = self.api('GET', f'/api/v1/tasks/{task.id}').json()
            self.assertEqual(detail['completion_blocked_reason'], 'reviewer_ineligible')
            self.assertTrue(detail['completion_pending'])
            withdrawn = self.api('POST', f'/api/v1/tasks/{task.id}/completion/withdraw', {'revision': revision})
            self.assertEqual(withdrawn.status_code, 200, withdrawn.text)
            self.assertFalse(withdrawn.json()['completion_pending'])
            self.assertEqual(withdrawn.json()['state'], 'in_progress')
        finally:
            self.reviewer.write({'active': True})
        self.authenticate('api_emp', 'api_emp_pass_123')
        again = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertEqual(again.status_code, 200, again.text)

    def test_foreign_company_reviewer_is_blocked_and_requester_can_repair(self):
        _project, task = self._project('specific_user', self.reviewer)
        self.authenticate('api_emp', 'api_emp_pass_123')
        requested = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertEqual(requested.status_code, 200, requested.text)
        revision = requested.json()['completion_revision']
        original_company_id = self.reviewer.company_id.id
        original_company_ids = self.reviewer.company_ids.ids
        try:
            self.reviewer.write({'company_ids': [(4, self.company_b.id)]})
            self.reviewer.write({'company_id': self.company_b.id})
            self.reviewer.write({'company_ids': [(6, 0, [self.company_b.id])]})
            task.invalidate_recordset()

            self.authenticate('api_emp', 'api_emp_pass_123')
            detail_response = self.api('GET', f'/api/v1/tasks/{task.id}')
            self.assertEqual(detail_response.status_code, 200, detail_response.text)
            detail = detail_response.json()
            self.assertEqual(detail['completion_blocked_reason'], 'reviewer_ineligible')
            self.assertIn('withdraw_completion', detail['allowed_actions'])
            withdrawn = self.api(
                'POST', f'/api/v1/tasks/{task.id}/completion/withdraw',
                {'revision': revision},
            )
            self.assertEqual(withdrawn.status_code, 200, withdrawn.text)
            self.assertFalse(withdrawn.json()['completion_pending'])
        finally:
            restored_company_ids = sorted(set(original_company_ids) | {self.company_b.id})
            self.reviewer.write({'company_ids': [(6, 0, restored_company_ids)]})
            self.reviewer.write({'company_id': original_company_id})
            self.reviewer.write({'company_ids': [(6, 0, original_company_ids)]})

        self.authenticate('api_emp', 'api_emp_pass_123')
        repaired = self.api('POST', f'/api/v1/tasks/{task.id}/completion/request', {})
        self.assertEqual(repaired.status_code, 200, repaired.text)
        self.assertTrue(repaired.json()['completion_pending'])

    def test_lock_order_is_project_then_task_sorted(self):
        project, task = self._project('project_manager')
        statements = []
        original = self.env.cr.execute

        def tracking(query, params=None, log_exceptions=True):
            text = query if isinstance(query, str) else str(query)
            if 'FOR UPDATE' in text:
                statements.append((text, list(params or [])))
            return original(query, params, log_exceptions=log_exceptions)

        self.env.cr.execute = tracking
        try:
            task._nasq_lock_completion()
        finally:
            self.env.cr.execute = original
        self.assertEqual(len(statements), 2)
        self.assertIn('project_project', statements[0][0])
        self.assertEqual(statements[0][1], [project.id])
        self.assertIn('project_task', statements[1][0])
        self.assertEqual(statements[1][1], [task.id])
        task.with_user(self.employee)._nasq_request_completion()
        self.assertTrue(task.nasq_completion_pending)
