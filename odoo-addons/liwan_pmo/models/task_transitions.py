# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

from .project_task import ALL_STATES, DONE_STATE, MANAGER_STATES
from odoo.addons.project.models.project_task import CLOSED_STATES


class ProjectTaskTransitions(models.Model):
    _inherit = 'project.task'

    def _liwan_can_approve(self):
        """True when the current user may use the broad approve / request-changes states."""
        self.ensure_one()
        return self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'pmo.tasks.approve', record=self,
        )

    def _liwan_allowed_transitions(self):
        self.ensure_one()
        api_to_state = {
            'in_progress': '01_in_progress',
            'changes_requested': '02_changes_requested',
            'approved': '03_approved',
            'waiting': '04_waiting_normal',
            'done': '1_done',
            'cancelled': '1_canceled',
        }
        state_to_api = {odoo: api for api, odoo in api_to_state.items()}
        current = state_to_api.get(self.state)
        allowed = []
        can_write = self._liwan_can_write()
        can_approve = self._liwan_can_approve()
        required = self._liwan_completion_required()
        for api_state, odoo_state in api_to_state.items():
            if api_state == current:
                continue
            if odoo_state in MANAGER_STATES and not can_approve:
                continue
            if odoo_state == DONE_STATE and required:
                continue
            if not can_write and not (can_approve and odoo_state in MANAGER_STATES):
                continue
            allowed.append(api_state)
        return allowed

    def _liwan_transition(self, state):
        """Move ``self`` to ``state`` (Odoo code) applying liwan's approval rule.

        Decomposed into hooks so customer overlays override one step.
        """
        if state not in ALL_STATES:
            raise ValueError(f"unknown task state {state!r}")
        self._liwan_check_transition_allowed(state)
        self._liwan_do_transition(state)
        self._liwan_post_transition_hook(state)
        return self

    def _liwan_check_transition_allowed(self, state):
        """Raise AccessError when the current user may not move to ``state``."""
        if state in MANAGER_STATES and not self._liwan_can_approve():
            raise AccessError(self.env._("Only a project manager can approve or request changes."))
        if state == DONE_STATE:
            accept_ids = self._liwan_accept_ids()
            if any(task._liwan_completion_required() and task.id not in accept_ids for task in self):
                raise AccessError(self.env._("This task requires completion approval."))

    def _liwan_do_transition(self, state):
        """Write ``state`` and keep ``date_end`` consistent: set on close, cleared on reopen."""
        if state in CLOSED_STATES:
            self.write({'state': state, 'date_end': fields.Datetime.now()})
            return
        reopened = self.filtered(lambda t: t.state in CLOSED_STATES)
        (self - reopened).write({'state': state})
        reopened.write({'state': state, 'date_end': False})

    def _liwan_post_transition_hook(self, state):
        """Extension point (notifications, side effects). No-op in core."""
