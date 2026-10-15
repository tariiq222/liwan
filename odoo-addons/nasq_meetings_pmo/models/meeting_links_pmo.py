# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Project and task links of meetings: the hooks of nasq.meeting.links, filled by the bridge.

Documented elevated read: ``_nasq_linked_resolution_ids`` searches converted
tasks, archived ones included, with an elevated search restricted to the
given recommendation ids, because a converted recommendation stays frozen
even when the caller cannot read its task. It returns ids only. Every other
hook reads projects and tasks in the caller's environment.
"""
from odoo import api, models
from odoo.exceptions import AccessError, ValidationError

from odoo.addons.nasq_api.controllers.common import ApiError, get_record

TASK_EXECUTION_STATES = {
    '1_done': 'done',
    '1_canceled': 'cancelled',
}


class NasqMeetingProjectLinks(models.AbstractModel):
    _inherit = 'nasq.meeting.links'

    @api.model
    def _nasq_link_fields(self):
        return super()._nasq_link_fields() | {'project_id'}

    @api.model
    def _nasq_project_id(self, record):
        return record.project_id.id or None

    @api.model
    def _nasq_project_ref(self, record):
        return self._nasq_visible_project_ref(record.project_id)

    @api.model
    def _nasq_project_ref_by_id(self, record, project_id):
        if not project_id:
            return None
        return self._nasq_visible_project_ref(self.env['project.project'].browse(project_id).exists())

    @api.model
    def _nasq_visible_project_ref(self, project):
        if not project or project.company_id != self.env.company:
            return None
        if not self.env['nasq.access.service']._nasq_has_capability(self.env.user, 'pmo.projects.read'):
            return None
        try:
            project.check_access('read')
        except AccessError:
            return None
        return {'id': project.id, 'name': project.name}

    @api.model
    def _nasq_project_domain(self, project_id):
        return [('project_id', '=', project_id)]

    @api.model
    def _nasq_check_project(self, project_id):
        project = get_record('project.project', project_id)
        if project.company_id != self.env.company:
            raise ApiError(422, 'invalid', 'project_id must belong to the current company', field='project_id')
        project.check_access('read')
        return project.id

    @api.model
    def _nasq_project_vals(self, project_id):
        return {'project_id': project_id or False}

    @api.model
    def _nasq_check_topic_project(self, project_id):
        project = self.env['project.project'].browse(project_id).exists()
        if not project or project.company_id != self.env.company:
            raise ValidationError(self.env._('Minutes topic project is not available in the current company.'))
        project.check_access('read')

    @api.model
    def _nasq_linked_resolution_ids(self, resolutions):
        linked = super()._nasq_linked_resolution_ids(resolutions)
        if not resolutions:
            return linked
        tasks = self.env['project.task'].with_context(active_test=False).sudo().search_fetch(
            [('resolution_id', 'in', resolutions.ids)], ['resolution_id'],
        )
        return linked | {task.resolution_id for task in tasks}

    @api.model
    def _nasq_readable_links(self, resolutions):
        links = super()._nasq_readable_links(resolutions)
        Task = self.env['project.task']
        can_read_tasks = self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'pmo.tasks.read',
        ) and Task.has_access('read')
        if not can_read_tasks or not resolutions:
            return links
        tasks = Task.search([
            ('resolution_id', 'in', resolutions.ids),
            ('company_id', '=', self.env.company.id),
            ('project_id.company_id', '=', self.env.company.id),
            ('project_id.active', '=', True),
            ('active', '=', True),
        ])
        for task in tasks:
            if task.resolution_id:
                links[task.resolution_id] = {
                    'task_id': task.id,
                    'state': TASK_EXECUTION_STATES.get(task.state, 'in_progress'),
                    'company_id': task.company_id.id,
                    'project_id': task.project_id.id,
                }
        return links
