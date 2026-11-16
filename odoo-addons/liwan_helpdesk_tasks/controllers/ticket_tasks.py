# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The follow-up tasks of one support ticket.

Both routes need the support and the tasks features and capabilities. The ticket is found through the
desk's own visibility (404 for a hidden, foreign or missing one); a task is created through the tasks
application's own service, so its validation, privacy rule and assignment bell apply. Nothing here uses
``sudo()``: the list is a search in the caller's environment, so the personal-task rule still hides the
tasks the caller is neither creator nor assignee of.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_helpdesk.controllers.tickets import find
from odoo.addons.liwan_tasks.models.my_task_service import SORTS
from odoo.addons.liwan_tasks.serializers.personal_task import (
    dump_list_item,
    dump_personal_task,
)

URL = '/api/v1/helpdesk/tickets/<int:ticket_id>/tasks'
# The wire fields of a task created from a ticket; a sub-task cannot be made here.
CREATE_FIELDS = frozenset({'name', 'description', 'date_deadline', 'priority', 'assignees'})


def create_values(ticket, payload):
    """The service's wire values: the payload with the default assignee and a required due date."""
    if not payload.get('date_deadline'):
        raise ApiError(422, 'invalid', 'date_deadline is required for a follow-up task', field='date_deadline')
    for key in payload:
        if key not in CREATE_FIELDS:
            raise ApiError(422, 'invalid', f'{key} is not supported', field=key)
    assignees = payload.get('assignees')
    default = ticket.user_id or request.env.user
    return {**payload, 'assignees': [default.id] if assignees is None else assignees}


class HelpdeskTicketTasksController(http.Controller):

    @http.route(URL, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', 'tasks.enabled', operation='read')
    @requires_capability('helpdesk.tickets.read', 'tasks.tasks.read')
    def list_ticket_tasks(self, ticket_id, **_):
        ticket = find(ticket_id)
        limit, offset = parse_page(request.httprequest.args)
        Task = request.env['project.task']
        domain = [
            ('liwan_helpdesk_ticket_id', '=', ticket.id), ('liwan_personal', '=', True),
            ('company_id', '=', request.env.company.id),
        ]
        tasks = Task.search(domain, order=SORTS['deadline'], limit=limit, offset=offset)
        return {'items': [dump_list_item(task) for task in tasks], 'total': Task.search_count(domain)}

    @http.route(URL, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled', 'tasks.enabled')
    @requires_capability('helpdesk.tickets.write', 'tasks.tasks.create')
    def create_ticket_task(self, ticket_id, **_):
        ticket = find(ticket_id, 'helpdesk.tickets.write')
        payload = request.get_json_data()
        if not isinstance(payload, dict):
            raise ApiError(422, 'invalid', 'Invalid request fields.')
        values = create_values(ticket, payload)
        if ticket.stage_id.closed:
            raise ApiError(422, 'invalid', 'a closed ticket takes no new task', field='ticket_id')
        task = request.env['liwan.my.task.service']._create_task(
            values, link_values={'liwan_helpdesk_ticket_id': ticket.id})
        return dump_personal_task(task)
