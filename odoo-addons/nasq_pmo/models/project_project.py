# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError

# The five statuses a manager may set. Odoo's sixth value, 'to_define', means
# "unset" and is never written by nasq (it is what a project starts as).
STATUS_VALUES = {'on_track', 'at_risk', 'off_track', 'on_hold', 'done'}


class ProjectProject(models.Model):
    _inherit = 'project.project'

    def _nasq_can_manage(self):
        """True when the current user may set project status (same rule as task approval)."""
        return (
            self.env.user.has_group('project.group_project_manager')
            or self.env.user.has_group('nasq_core.group_customer_admin')
        )

    def _nasq_set_status(self, status):
        """Set ``last_update_status`` on ``self`` applying nasq's manager rule.

        Odoo's ``project.project.write`` turns a ``last_update_status`` write into a
        new ``project.update`` record, so the project's update history stays intact.
        Decomposed into hooks so a customer overlay can override one step.
        """
        if status not in STATUS_VALUES:
            raise ValueError(f"unknown project status {status!r}")
        self._nasq_check_status_allowed(status)
        self._nasq_do_set_status(status)
        self._nasq_post_status_hook(status)
        return self

    def _nasq_check_status_allowed(self, status):
        if not self._nasq_can_manage():
            raise AccessError(self.env._("Only a project manager can set the project status."))

    def _nasq_do_set_status(self, status):
        self.write({'last_update_status': status})

    def _nasq_post_status_hook(self, status):
        """Extension point; nothing in core."""
