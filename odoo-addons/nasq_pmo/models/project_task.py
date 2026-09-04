# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

from odoo.addons.project.models.project_task import CLOSED_STATES

MANAGER_STATES = {'03_approved', '02_changes_requested'}
ALL_STATES = {'01_in_progress', '02_changes_requested', '03_approved', '04_waiting_normal', *CLOSED_STATES}


class ProjectTask(models.Model):
    _inherit = 'project.task'

    def _nasq_can_approve(self):
        """True when the current user (regardless of ``self``) may approve / request changes."""
        return (
            self.env.user.has_group('project.group_project_manager')
            or self.env.user.has_group('nasq_core.group_customer_admin')
        )

    def _nasq_transition(self, state):
        """Move ``self`` to ``state`` (Odoo code) applying nasq's approval rule.

        Decomposed into hooks so customer overlays override one step.
        """
        if state not in ALL_STATES:
            raise ValueError(f"unknown task state {state!r}")
        self._nasq_check_transition_allowed(state)
        self._nasq_do_transition(state)
        self._nasq_post_transition_hook(state)
        return self

    def _nasq_check_transition_allowed(self, state):
        """Raise AccessError when the current user may not move to ``state``."""
        if state in MANAGER_STATES and not self._nasq_can_approve():
            raise AccessError(self.env._("Only a project manager can approve or request changes."))

    def _nasq_do_transition(self, state):
        """Write ``state`` and keep ``date_end`` consistent: set on close, cleared on reopen."""
        if state in CLOSED_STATES:
            self.write({'state': state, 'date_end': fields.Datetime.now()})
            return
        reopened = self.filtered(lambda t: t.state in CLOSED_STATES)
        (self - reopened).write({'state': state})
        reopened.write({'state': state, 'date_end': False})

    def _nasq_post_transition_hook(self, state):
        """Extension point (notifications, side effects). No-op in core."""
