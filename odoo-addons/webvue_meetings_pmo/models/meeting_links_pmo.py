# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Project and task links of meetings: the hooks of webvue.meeting.links, filled by the bridge.

Documented elevated read: ``_webvue_linked_resolution_ids`` searches converted
tasks, archived ones included, with an elevated search restricted to the
given recommendation ids, because a converted recommendation stays frozen
even when the caller cannot read its task. It returns ids only. Every other
hook reads projects and tasks in the caller's environment.
"""
from odoo import api, models
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Domain

from odoo.addons.webvue_api.controllers.common import ApiError, get_record

TASK_EXECUTION_STATES = {
    '1_done': 'done',
    '1_canceled': 'cancelled',
}


class WebVueMeetingProjectLinks(models.AbstractModel):
    _inherit = 'webvue.meeting.links'

    @api.model
    def _webvue_link_fields(self):
        return super()._webvue_link_fields() | {'project_id'}

    @api.model
    def _webvue_project_id(self, record):
        return record.project_id.id or None

    @api.model
    def _webvue_project_ref(self, record):
        return self._webvue_visible_project_ref(record.project_id)

    @api.model
    def _webvue_project_ref_by_id(self, record, project_id):
        if not project_id:
            return None
        return self._webvue_visible_project_ref(self.env['project.project'].browse(project_id))

    @api.model
    def _webvue_visible_project_ref(self, project):
        if not project:
            return None
        if not self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'pmo.projects.read'):
            return None
        try:
            if not project.exists():
                return None
            project.check_access('read')
        except AccessError:
            return None
        if project.company_id != self.env.company:
            return None
        return {'id': project.id, 'name': project.name}

    @api.model
    def _webvue_project_domain(self, project_id):
        return [('project_id', '=', project_id)]

    @api.model
    def _webvue_check_project(self, project_id):
        project = get_record('project.project', project_id)
        if project.company_id != self.env.company:
            raise ApiError(422, 'invalid', 'project_id must belong to the current company', field='project_id')
        project.check_access('read')
        return project.id

    @api.model
    def _webvue_project_vals(self, project_id):
        return {'project_id': project_id or False}

    @api.model
    def _webvue_check_topic_project(self, project_id):
        project = self.env['project.project'].browse(project_id).exists()
        if not project or project.company_id != self.env.company:
            raise ValidationError(self.env._('Minutes topic project is not available in the current company.'))
        project.check_access('read')

    @api.model
    def _webvue_linked_resolution_ids(self, resolutions):
        linked = super()._webvue_linked_resolution_ids(resolutions)
        if not resolutions:
            return linked
        tasks = self.env['project.task'].with_context(active_test=False).sudo().search_fetch(
            [('resolution_id', 'in', resolutions.ids)], ['resolution_id'],
        )
        return linked | {task.resolution_id for task in tasks}

    @api.model
    def _webvue_readable_links(self, resolutions):
        links = super()._webvue_readable_links(resolutions)
        domain = self._webvue_readable_task_domain()
        if domain is None or not resolutions:
            return links
        tasks = self.env['project.task'].search(domain + [('resolution_id', 'in', resolutions.ids)])
        for task in tasks:
            if task.resolution_id:
                links[task.resolution_id] = {
                    'task_id': task.id,
                    'state': TASK_EXECUTION_STATES.get(task.state, 'in_progress'),
                    'company_id': task.company_id.id,
                    'project_id': task.project_id.id,
                }
        return links

    @api.model
    def _webvue_readable_task_domain(self):
        Task = self.env['project.task']
        if not self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'pmo.tasks.read') or not Task.has_access('read'):
            return None
        return [
            ('resolution_id', '>', 0),
            ('company_id', '=', self.env.company.id),
            ('project_id.company_id', '=', self.env.company.id),
            ('project_id.active', '=', True),
            ('active', '=', True),
        ]

    @api.model
    def _webvue_resolution_execution_domain(self, states):
        base = Domain(super()._webvue_resolution_execution_domain(states))
        domain = self._webvue_readable_task_domain()
        if domain is None:
            return list(base)
        # Fetch only the two projection fields, in ordinary ACL/rule scope. Never
        # interpret hidden or archived tasks, and never fetch recommendation content.
        tasks = self.env['project.task'].search_fetch(domain, ['resolution_id', 'state'])
        linked_ids = [task.resolution_id for task in tasks]
        matching_ids = [task.resolution_id for task in tasks if TASK_EXECUTION_STATES.get(task.state, 'in_progress') in states]
        return list(Domain.OR([
            Domain('id', 'in', matching_ids),
            base & Domain('id', 'not in', linked_ids),
        ]))
