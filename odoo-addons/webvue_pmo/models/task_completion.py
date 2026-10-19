# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError

from .project_task import COMPLETION_ACCEPT_IDS, COMPLETION_META_IDS, DONE_STATE


class ProjectTaskCompletion(models.Model):
    _inherit = 'project.task'

    def _webvue_completion_required(self):
        self.ensure_one()
        project = self.project_id
        return bool(project and project.webvue_completion_approval != 'none')

    def _webvue_completion_reviewer(self):
        self.ensure_one()
        return self.project_id._webvue_completion_reviewer() if self.project_id else self.env['res.users']

    def _webvue_task_is_open_for_completion(self):
        self.ensure_one()
        return bool(
            self.active
            and not self.is_closed
            and self.project_id
            and self.project_id.active,
        )

    def _webvue_can_request_completion(self):
        self.ensure_one()
        return bool(
            self._webvue_completion_required()
            and self._webvue_task_is_open_for_completion()
            and not self.webvue_completion_pending
            and self._webvue_can_write()
            and self.env.user in self.user_ids,
        )

    def _webvue_can_decide_completion(self):
        self.ensure_one()
        if (
            not self._webvue_completion_required()
            or not self.webvue_completion_pending
            or not self._webvue_task_is_open_for_completion()
        ):
            return False
        return self._webvue_reviewer_is_current()

    def _webvue_can_withdraw_completion(self):
        self.ensure_one()
        return bool(
            self._webvue_task_is_open_for_completion()
            and self.webvue_completion_pending
            and self.webvue_completion_requested_by == self.env.user
            and self._webvue_can_write(),
        )

    def _webvue_reviewer_eligible(self, user):
        self.ensure_one()
        if not user or not user.active or user.share:
            return False
        # This is a boolean eligibility boundary, not a foreign-company read.
        # Caller-context traversal can raise on res.company record rules and
        # break task serialization before it can report reviewer_ineligible.
        if self.env.company.id not in user.sudo().company_ids.ids:
            return False
        try:
            self.with_user(user).with_company(self.env.company)._webvue_check_visible_current()
            if self.project_id:
                self.project_id.with_user(user).with_company(self.env.company)._webvue_check_visible_current()
        except AccessError:
            return False
        return self.env['webvue.access.service']._webvue_has_capability(
            user, 'pmo.tasks.approve', record=self,
        )

    def _webvue_reviewer_is_current(self):
        self.ensure_one()
        reviewer = self._webvue_completion_reviewer()
        return bool(reviewer and reviewer == self.env.user and self._webvue_reviewer_eligible(reviewer))

    def _webvue_completion_blocked_reason(self):
        self.ensure_one()
        if not self._webvue_completion_required() or self.is_closed or not self.active:
            return None
        if self.project_id and not self.project_id.active:
            return None
        reviewer = self._webvue_completion_reviewer()
        if not reviewer:
            return 'no_reviewer'
        if not self._webvue_reviewer_eligible(reviewer):
            return 'reviewer_ineligible'
        return None

    def _webvue_write_completion_meta(self, vals):
        marker = self.env.cr.precommit.data
        previous = set(marker.get(COMPLETION_META_IDS) or ())
        authorized = set(previous)
        authorized.update(self.ids)
        marker[COMPLETION_META_IDS] = authorized
        try:
            self.write(vals)
        finally:
            marker[COMPLETION_META_IDS] = previous
            if not previous:
                marker.pop(COMPLETION_META_IDS, None)
        return self

    def _webvue_clear_completion_request(self, note=None, invalidate=False):
        for task in self:
            values = {
                'webvue_completion_pending': False,
                'webvue_completion_requested_by': False,
                'webvue_completion_requested_at': False,
            }
            if note is not None:
                values['webvue_completion_return_note'] = note
            if invalidate:
                values['webvue_completion_revision'] = task.webvue_completion_revision + 1
            task._webvue_write_completion_meta(values)
        return self

    @api.model
    def _webvue_lock_projects_then_tasks(self, projects, tasks):
        """Lock PROJECT then TASK by sorted id. Never task-then-project."""
        for project_id in sorted(project_id for project_id in projects.ids if project_id):
            self.env.cr.execute(
                'SELECT id FROM project_project WHERE id = %s FOR UPDATE',
                [project_id],
            )
        for task_id in sorted(tasks.ids):
            self.env.cr.execute(
                'SELECT id FROM project_task WHERE id = %s FOR UPDATE',
                [task_id],
            )

    def _webvue_lock_completion(self):
        self.ensure_one()
        self._webvue_lock_projects_then_tasks(self.project_id, self)

    def _webvue_request_completion(self):
        self.ensure_one()
        self._webvue_check_visible_current()
        self._webvue_lock_completion()
        self.invalidate_recordset()
        if self.project_id:
            self.project_id.invalidate_recordset()
        if not self._webvue_can_request_completion():
            raise AccessError(self.env._("You cannot request completion for this task."))
        reviewer = self._webvue_completion_reviewer()
        if not reviewer or not self._webvue_reviewer_eligible(reviewer):
            raise UserError(self.env._("There is no eligible reviewer for this task."))
        return self._webvue_write_completion_meta({
            'webvue_completion_pending': True,
            'webvue_completion_revision': self.webvue_completion_revision + 1,
            'webvue_completion_requested_by': self.env.uid,
            'webvue_completion_requested_at': fields.Datetime.now(),
            'webvue_completion_return_note': False,
        })

    def _webvue_check_completion_decision(self, revision):
        self.ensure_one()
        self._webvue_check_visible_current()
        self._webvue_lock_completion()
        self.invalidate_recordset()
        if self.project_id:
            self.project_id.invalidate_recordset()
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise UserError(self.env._("A completion revision is required."))
        if not self._webvue_task_is_open_for_completion():
            raise UserError(self.env._("This task is not open for a completion decision."))
        if not self.webvue_completion_pending:
            raise UserError(self.env._("There is no pending completion request."))
        if revision != self.webvue_completion_revision:
            raise UserError(self.env._("This completion request is stale."))
        if not self._webvue_reviewer_is_current():
            raise AccessError(self.env._("Only the designated reviewer can decide this request."))

    def _webvue_accept_completion(self, revision):
        self.ensure_one()
        self._webvue_check_completion_decision(revision)
        marker = self.env.cr.precommit.data
        previous = set(marker.get(COMPLETION_ACCEPT_IDS) or ())
        authorized = set(previous)
        authorized.add(self.id)
        marker[COMPLETION_ACCEPT_IDS] = authorized
        try:
            self._webvue_clear_completion_request()
            self._webvue_transition(DONE_STATE)
        finally:
            marker[COMPLETION_ACCEPT_IDS] = previous
            if not previous:
                marker.pop(COMPLETION_ACCEPT_IDS, None)
        return self

    def _webvue_return_completion(self, revision, note):
        self.ensure_one()
        if not isinstance(note, str) or not note.strip():
            raise UserError(self.env._("A return note is required."))
        self._webvue_check_completion_decision(revision)
        return self._webvue_clear_completion_request(note=note.strip())

    def _webvue_withdraw_completion(self, revision):
        self.ensure_one()
        self._webvue_check_visible_current()
        self._webvue_lock_completion()
        self.invalidate_recordset()
        if self.project_id:
            self.project_id.invalidate_recordset()
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise UserError(self.env._("A completion revision is required."))
        if not self._webvue_task_is_open_for_completion():
            raise UserError(self.env._("This task is not open for a completion decision."))
        if not self.webvue_completion_pending:
            raise UserError(self.env._("There is no pending completion request."))
        if revision != self.webvue_completion_revision:
            raise UserError(self.env._("This completion request is stale."))
        if self.webvue_completion_requested_by != self.env.user or not self._webvue_can_write():
            raise AccessError(self.env._("Only the requester can withdraw this completion request."))
        return self._webvue_clear_completion_request()
