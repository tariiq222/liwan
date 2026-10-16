# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError, ValidationError


class OperationsPmoProcess(models.Model):
    _inherit = 'webvue.operation.process'

    @api.model
    def _operations_execution_kinds(self):
        kinds = super()._operations_execution_kinds()
        if self.env['webvue.entitlement.service']._webvue_feature_write('pmo.enabled'):
            return (*kinds, 'pmo_completion')
        return kinds

    def _operations_targets(self, q):
        if self.execution_kind != 'pmo_completion':
            return super()._operations_targets(q)
        self.env['webvue.entitlement.service'].require_read('pmo.enabled')
        self.env['webvue.access.service']._webvue_require_capability('pmo.tasks.read')
        tasks = self.env['project.task'].search([('company_id', '=', self.env.company.id), ('active', '=', True), ('project_id.webvue_completion_approval', '!=', 'none'), ('name', 'ilike', q), ('state', 'not in', ['1_done', '1_canceled']), '|', '&', ('user_ids', 'in', [self.env.uid]), ('webvue_completion_pending', '=', False), '&', ('webvue_completion_pending', '=', True), ('webvue_completion_requested_by', '=', self.env.uid)], limit=50, order='id desc')
        return [{'id': task.id, 'name': task.name, 'href': f'/projects/{task.project_id.id}/tasks/{task.id}'} for task in tasks if task._webvue_can_request_completion() or (task.webvue_completion_pending and task.webvue_completion_requested_by == self.env.user)]


class OperationsPmoRequest(models.Model):
    _inherit = 'webvue.operation.request'

    @api.model
    def _operations_task(self, task_id):
        self.env['webvue.entitlement.service'].require_read('pmo.enabled')
        if isinstance(task_id, bool) or not isinstance(task_id, int) or task_id <= 0:
            raise ValidationError(self.env._('Choose a valid task.'))
        task = self.env['project.task'].search([('id', '=', task_id), ('company_id', '=', self.env.company.id)], limit=1)
        if not task or not self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'pmo.tasks.read', record=task):
            raise AccessError(self.env._('The task is not available.'))
        return task

    @api.model
    def _operations_target_values(self, process, target_id):
        if process.execution_kind != 'pmo_completion':
            return super()._operations_target_values(process, target_id)
        task = self._operations_task(target_id)
        if not task._webvue_can_request_completion() and not (task.webvue_completion_pending and task.webvue_completion_requested_by == self.env.user):
            raise AccessError(self.env._('You cannot request completion for this task.'))
        return {'target_ref': {'id': task.id, 'revision': 0}}

    def _operations_prepare_submission(self, process):
        if process.execution_kind != 'pmo_completion':
            return super()._operations_prepare_submission(process)
        self.env['webvue.entitlement.service'].require('pmo.enabled')
        task = self._operations_task((self.target_ref or {}).get('id'))
        reviewer = task._webvue_completion_reviewer()
        final = process.step_ids.sorted('sequence')[-1:]
        if not reviewer or final.reviewer_ids != reviewer:
            raise ValidationError(self.env._('The final stage must use the designated PMO completion reviewer.'))
        if not task.webvue_completion_pending:
            task._webvue_request_completion()
        elif task.webvue_completion_requested_by != self.env.user:
            raise AccessError(self.env._('Only the original completion requester can submit this operation.'))
        self._ops_write({'target_ref': {'id': task.id, 'revision': task.webvue_completion_revision}})
        return True

    def _execute_approved(self):
        if self.execution_kind != 'pmo_completion':
            return super()._execute_approved()
        self.env['webvue.entitlement.service'].require('pmo.enabled')
        target = self.target_ref or {}
        task = self._operations_task(target.get('id'))
        # The native method locks and rechecks revision, current designated
        # reviewer and original PMO capability, in this caller's real identity.
        task._webvue_accept_completion(target.get('revision'))
        return True

    def _operations_target(self):
        if not self.target_ref:
            return super()._operations_target()
        try:
            task = self._operations_task(self.target_ref.get('id'))
        except AccessError:
            return None
        return {'id': task.id, 'name': task.name, 'href': f'/projects/{task.project_id.id}/tasks/{task.id}'}

    def action_withdraw(self, revision, comment=''):
        with self.env.cr.savepoint():
            result = super().action_withdraw(revision, comment)
            if self.execution_kind == 'pmo_completion' and self.target_ref:
                task = self._operations_task(self.target_ref.get('id'))
                if task.webvue_completion_pending:
                    task._webvue_withdraw_completion(self.target_ref.get('revision'))
            return result
