# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    requires_feature,
)
from odoo.addons.webvue_pmo.serializers.dates import parse_date
from odoo.addons.webvue_pmo.serializers.project_schedule import (
    dump_schedule_milestone,
    dump_schedule_task,
)

ISO_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _strict_date(value, field):
    if value is not None and (not isinstance(value, str) or not ISO_DATE.fullmatch(value)):
        raise ApiError(422, 'invalid', f'{field} must be a YYYY-MM-DD date', field=field)
    return parse_date(value, field)


def _project_tasks(project):
    return request.env['project.task'].search([
        ('project_id', '=', project.id),
        ('active', '=', True),
        ('project_id.active', '=', True),
        ('project_id.company_id', '=', request.env.company.id),
    ], order='webvue_planned_start asc, date_deadline asc, id asc')


class ProjectScheduleController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/schedule', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_schedule(self, project_id):
        project = get_record('project.project', project_id)
        if not project.active or not project.company_id or project.company_id != request.env.company:
            raise ApiError(404, 'not_found', 'Project does not exist.')
        project._webvue_check_visible_current()
        tasks = _project_tasks(project)
        visible_ids = set(tasks.ids)
        milestones = request.env['project.milestone'].search([
            ('project_id', '=', project.id),
        ], order='deadline asc, sequence asc, id asc')
        return {
            'project_id': project.id,
            'tasks': [dump_schedule_task(task, visible_ids) for task in tasks],
            'milestones': [dump_schedule_milestone(milestone) for milestone in milestones],
            'can_manage': project._webvue_can_manage(),
            'total': len(tasks),
        }

    @http.route('/api/v1/projects/<int:project_id>/schedule/tasks/<int:task_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_schedule_task(self, project_id, task_id, **payload):
        project = get_record('project.project', project_id)
        if not project.active or not project.company_id or project.company_id != request.env.company:
            raise ApiError(404, 'not_found', 'Project does not exist.')
        unknown = set(payload) - {'start', 'end'}
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f'field {field!r} is not writable', field=field)
        if set(payload) != {'start', 'end'}:
            raise ApiError(422, 'invalid', 'start and end are required', field='start')
        task = request.env['project.task'].search([
            ('id', '=', task_id),
            ('project_id', '=', project.id),
            ('active', '=', True),
        ], limit=1)
        if not task:
            raise ApiError(404, 'not_found', 'Task does not exist in this project.')
        task._webvue_check_visible_current()
        start = _strict_date(payload['start'], 'start')
        end = _strict_date(payload['end'], 'end')
        try:
            task._webvue_set_schedule(start, end)
        except AccessError as error:
            raise ApiError(403, 'forbidden', str(error)) from error
        tasks = _project_tasks(project)
        visible_ids = set(tasks.ids)
        refreshed = next((item for item in tasks if item.id == task.id), task)
        return dump_schedule_task(refreshed, visible_ids)
