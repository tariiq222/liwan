# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_pmo.serializers.task import (
    dump_task,
    dump_task_detail,
    task_counts,
)

MAX_LIMIT = 200
ARCHIVE_ORDER = 'write_date desc, id desc'


def archive_eligibility_domain(service, user):
    """The SQL form of ``project.task._liwan_can_archive`` for this caller.

    A task is restorable when the caller may write it and is either its creator
    or its approver. Write and approve are each held company-wide or
    contextually, as the task's project manager, so:

    * global ``pmo.tasks.write`` — every task of the current company;
    * otherwise the contextual write grant — ``project_id.user_id`` is the caller;
    * global ``pmo.tasks.approve``, the creator, or the same project manager.

    The caller's own domain pins the task and its project to the current
    company, so the contextual grant's company condition (the project's company
    equals the task's) is already satisfied, and its readability condition is
    carried by the record rules of the search itself.
    """
    write_all = service._liwan_has_capability(user, 'pmo.tasks.write')
    approve_all = service._liwan_has_capability(user, 'pmo.tasks.approve')
    manager_scope = Domain('project_id.user_id', '=', user.id)
    return (Domain.TRUE if write_all else manager_scope) & (
        Domain('create_uid', '=', user.id) | (Domain.TRUE if approve_all else manager_scope)
    )


class TaskArchiveController(http.Controller):

    @http.route('/api/v1/tasks/archived', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_archived(self, **_):
        require_capabilities('pmo.tasks.read')
        args = request.httprequest.args
        unknown = set(args) - {'project_id', 'filter', 'q', 'limit', 'offset'}
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        # Paging is validated first, so a bad limit or offset is a 422 whatever scope was passed.
        limit = parse_nonneg_int(args.get('limit', 50), 'limit')
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
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

        company_id = request.env.company.id
        Task = request.env['project.task'].with_context(active_test=False)
        # Restoration is impossible while the parent project is archived;
        # omit those rows from both items and total.
        domain = Domain([
            ('active', '=', False),
            ('company_id', '=', company_id),
            ('project_id.company_id', '=', company_id),
            ('project_id.active', '=', True),
        ])
        if project_id is not None:
            project = request.env['project.project'].with_context(active_test=False).search([
                ('id', '=', project_id), ('company_id', '=', company_id), ('active', '=', True),
            ], limit=1)
            if not project:
                return {'items': [], 'total': 0}
            domain &= Domain('project_id', '=', project_id)
        if filter_ == 'mine':
            domain &= Domain('create_uid', '=', request.env.uid)
        elif not request.env['project.project']._liwan_is_manager():
            # Assigned project managers may restore all tasks in their project;
            # employees can list only tasks they created.
            domain &= (
                Domain('create_uid', '=', request.env.uid)
                | Domain('project_id.user_id', '=', request.env.uid)
            )
        q = args.get('q')
        if q:
            domain &= Domain('name', 'ilike', q)
        # Restore eligibility is the same rule as `_liwan_can_archive`, expressed
        # as a domain so the counts and the page are decided in SQL.
        eligibility = archive_eligibility_domain(
            request.env['liwan.access.service'], request.env.user,
        )
        page_limit = min(limit, MAX_LIMIT)
        eligible = domain & eligibility
        total = Task.search_count(eligible)
        # `limit=0` is a valid request for the total alone, with no items.
        if not page_limit:
            return {'items': [], 'total': total}
        tasks = Task.search(eligible, order=ARCHIVE_ORDER, limit=page_limit, offset=offset)
        counts = task_counts(tasks)
        return {'items': [dump_task(task, counts=counts) for task in tasks], 'total': total}

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
            task._liwan_check_visible_current()
        except AccessError:
            raise MissingError(request.env._('task not found')) from None
        project = request.env['project.project'].with_context(active_test=False).browse(task.project_id.id).exists()
        if not project:
            raise MissingError(request.env._('project not found'))
        project._liwan_check_archived_readable()
        if not project.active:
            raise ApiError(422, 'archived_project', 'Tasks cannot be restored while the project is archived.')
        if not task._liwan_can_archive():
            raise MissingError(request.env._('task not found'))
        try:
            task.check_access('write')
            task.write({'active': True})
        except AccessError as error:
            raise ApiError(403, 'forbidden', str(error)) from error
        return dump_task_detail(task)
