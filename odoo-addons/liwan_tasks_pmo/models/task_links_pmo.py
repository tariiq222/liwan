# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Project links of personal tasks: the hooks of liwan.task.links, filled by the bridge.

Every hook reads projects and project tasks in the caller's environment, so
PMO's ACLs and record rules decide what is visible. Nothing here uses ``sudo()``.
"""
from odoo import api, models
from odoo.fields import Domain

OPEN_STATE = '01_in_progress'


class LiwanTaskLinksPmo(models.AbstractModel):
    _inherit = 'liwan.task.links'

    @api.model
    def _liwan_project_task_domain(self, uid):
        """Project tasks assigned to ``uid`` in an active project, while the PMO feature is readable."""
        domain = super()._liwan_project_task_domain(uid)
        # PMO's search gate wants pmo.tasks.read, and the ``project_id.active`` leaf below
        # searches projects, which wants pmo.projects.read: without either the personal
        # branch must stay alone (a tasks-only role), or the whole list would be refused.
        access = self.env['liwan.access.service']
        if not (
            self.env['liwan.entitlement.service']._liwan_feature_read('pmo.enabled')
            and access._liwan_has_capability(self.env.user, 'pmo.tasks.read')
            and access._liwan_has_capability(self.env.user, 'pmo.projects.read')
        ):
            return domain
        return Domain.OR([domain, Domain([
            ('project_id', '!=', False),
            ('project_id.active', '=', True),
            ('company_id', '=', self.env.company.id),
            ('user_ids', 'in', [uid]),
        ])])

    @api.model
    def _liwan_project_ref(self, task):
        if not task.project_id:
            return super()._liwan_project_ref(task)
        return {
            'id': task.project_id.id,
            'name': task.project_id.name,
            'href': f'/projects/{task.project_id.id}/tasks/{task.id}',
        }

    @api.model
    def _liwan_can_convert(self, task):
        """An open top-level personal task, a caller who may create tasks in a project, PMO on."""
        if (
            not task.liwan_personal
            or task.liwan_parent_id
            or task.state != OPEN_STATE
            or not self.env['liwan.entitlement.service']._liwan_feature_write('pmo.enabled')
        ):
            return False
        return bool(self.env['liwan.my.task.convert']._targets(limit=1))
