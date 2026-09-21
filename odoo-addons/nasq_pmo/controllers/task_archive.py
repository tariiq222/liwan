# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.nasq_pmo.serializers.task import dump_task, dump_task_detail

MAX_LIMIT = 200
# Field fetches for `_nasq_can_archive` are isolated per batch so the
# candidate id list is not kept as one prefetched recordset. Capability
# checks remain per record; this is not an asymptotic SQL improvement.
ARCHIVE_SCAN_BATCH = 200


def eligible_archived_task_ids(tasks, domain, batch_size=ARCHIVE_SCAN_BATCH):
    """Ids the caller may restore, in `write_date desc, id desc` order.

    Eligibility is fully applied before any caller pagination. Candidates
    are scanned in batches so the whole matching recordset is not
    materialized at once.
    """
    candidate_ids = tasks._search(domain, order='write_date desc, id desc').get_result_ids()
    batch_size = max(int(batch_size), 1)
    eligible_ids = []
    for start in range(0, len(candidate_ids), batch_size):
        batch_ids = candidate_ids[start:start + batch_size]
        batch = tasks.browse(batch_ids).with_prefetch(batch_ids)
        eligible_ids.extend(task.id for task in batch if task._nasq_can_archive())
    return eligible_ids


class TaskArchiveController(http.Controller):

    @http.route('/api/v1/tasks/archived', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_archived(self, **_):
        request.env['nasq.access.service']._nasq_require_capability('pmo.tasks.read')
        args = request.httprequest.args
        unknown = set(args) - {'project_id', 'filter', 'q', 'limit', 'offset'}
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        filter_ = args.get('filter')
        if filter_ not in (None, 'mine'):
            raise ApiError(400, 'unsupported_filter', "filter must be 'mine'")
        project_id = args.get('project_id')
        if project_id is not None:
            try:
                project_id = int(project_id)
            except (TypeError, ValueError):
                raise ApiError(422, 'invalid', 'project_id must be an integer', field='project_id') from None
            if project_id <= 0:
                raise ApiError(422, 'invalid', 'project_id must be a positive integer', field='project_id')
        if project_id is None and filter_ != 'mine':
            raise ApiError(400, 'unsupported_filter', 'pass filter=mine and/or project_id')

        limit = _parse_page(args.get('limit', 50), 'limit')
        offset = _parse_page(args.get('offset', 0), 'offset')
        company_id = request.env.company.id
        Task = request.env['project.task'].with_context(active_test=False)
        # Restoration is impossible while the parent project is archived;
        # omit those rows from both items and total.
        domain = [
            ('active', '=', False),
            ('company_id', '=', company_id),
            ('project_id.company_id', '=', company_id),
            ('project_id.active', '=', True),
        ]
        if project_id is not None:
            project = request.env['project.project'].with_context(active_test=False).search([
                ('id', '=', project_id), ('company_id', '=', company_id), ('active', '=', True),
            ], limit=1)
            if not project:
                return {'items': [], 'total': 0}
            domain.append(('project_id', '=', project_id))
        if filter_ == 'mine':
            domain.append(('create_uid', '=', request.env.uid))
        elif not request.env['project.project']._nasq_is_manager():
            # Assigned project managers may restore all tasks in their project;
            # employees can list only tasks they created.
            domain.append('|')
            domain.extend([('create_uid', '=', request.env.uid), ('project_id.user_id', '=', request.env.uid)])
        q = args.get('q')
        if q:
            domain.append(('name', 'ilike', q))
        # Capability checks are record-scoped and cannot be represented by the
        # ORM domain. Filter before pagination so totals and pages contain only
        # tasks this user may actually restore.
        page_limit = min(limit, MAX_LIMIT)
        eligible_ids = eligible_archived_task_ids(Task, domain)
        page_ids = eligible_ids[offset:offset + page_limit]
        tasks = Task.browse(page_ids)
        return {'items': [dump_task(task) for task in tasks], 'total': len(eligible_ids)}

    @http.route('/api/v1/tasks/<int:task_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def unarchive_task(self, task_id, **_):
        Task = request.env['project.task'].with_context(active_test=False)
        company_id = request.env.company.id
        task = Task.search([
            ('id', '=', task_id),
            ('company_id', '=', company_id),
            ('project_id.company_id', '=', company_id),
        ], limit=1)
        if not task:
            raise MissingError(request.env._('task not found'))
        try:
            task._nasq_check_visible_current()
        except AccessError:
            raise MissingError(request.env._('task not found')) from None
        project = request.env['project.project'].with_context(active_test=False).browse(task.project_id.id).exists()
        if not project:
            raise MissingError(request.env._('project not found'))
        if not project.active:
            raise ApiError(422, 'archived_project', 'Tasks cannot be restored while the project is archived.')
        if not task._nasq_can_archive():
            raise MissingError(request.env._('task not found'))
        try:
            task.check_access('write')
            task.write({'active': True})
        except AccessError as error:
            raise ApiError(403, 'forbidden', str(error)) from error
        return dump_task_detail(task)


def _parse_page(value, field):
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise ApiError(422, 'invalid', 'limit and offset must be non-negative integers', field=field) from None
    if value < 0:
        raise ApiError(422, 'invalid', 'limit and offset must be non-negative integers', field=field)
    return value
