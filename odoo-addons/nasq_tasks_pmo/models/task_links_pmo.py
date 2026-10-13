# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Project links of personal tasks: the hooks of nasq.task.links, filled by the bridge.

Every hook reads projects and project tasks in the caller's environment, so
PMO's ACLs and record rules decide what is visible. Nothing here uses ``sudo()``.
"""
from odoo import api, models
from odoo.fields import Domain

OPEN_STATE = '01_in_progress'


class NasqTaskLinksPmo(models.AbstractModel):
    _inherit = 'nasq.task.links'

    @api.model
    def _nasq_project_task_domain(self, uid):
        """Project tasks assigned to ``uid`` in an active project, while the PMO feature is readable."""
        domain = super()._nasq_project_task_domain(uid)
        if not self.env['nasq.entitlement.service']._nasq_feature_read('pmo.enabled'):
            return domain
        return Domain.OR([domain, Domain([
            ('project_id', '!=', False),
            ('project_id.active', '=', True),
            ('company_id', '=', self.env.company.id),
            ('user_ids', 'in', [uid]),
        ])])

    @api.model
    def _nasq_project_ref(self, task):
        if not task.project_id:
            return super()._nasq_project_ref(task)
        return {
            'id': task.project_id.id,
            'name': task.project_id.name,
            'href': f'/projects/{task.project_id.id}/tasks/{task.id}',
        }

    @api.model
    def _nasq_can_convert(self, task):
        """An open top-level personal task, a caller who may create tasks in a project, PMO on."""
        if (
            not task.nasq_personal
            or task.nasq_parent_id
            or task.state != OPEN_STATE
            or not self.env['nasq.entitlement.service']._nasq_feature_write('pmo.enabled')
        ):
            return False
        return bool(self.env['nasq.my.task.convert']._targets(limit=1))
