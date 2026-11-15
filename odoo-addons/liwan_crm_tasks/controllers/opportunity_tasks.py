# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The follow-up tasks of one CRM opportunity.

Both routes need the CRM and the tasks features and capabilities. The opportunity is found through
CRM's own visibility (404 for a hidden, foreign or missing one); a task is created through the tasks
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
from odoo.addons.liwan_crm.controllers.opportunities import find_opportunity
from odoo.addons.liwan_tasks.models.my_task_service import SORTS
from odoo.addons.liwan_tasks.serializers.personal_task import (
    dump_list_item,
    dump_personal_task,
)

URL = '/api/v1/crm/opportunities/<int:lead_id>/tasks'
# The wire fields of a task created from an opportunity; a sub-task cannot be made here.
CREATE_FIELDS = frozenset({'name', 'description', 'date_deadline', 'priority', 'assignees'})


def _create_values(lead, payload):
    """The service's wire values: the payload with the default assignee (the agent, else the caller) and a required due date."""
    if not payload.get('date_deadline'):
        raise ApiError(422, 'invalid', 'date_deadline is required for a follow-up task', field='date_deadline')
    for key in payload:
        if key not in CREATE_FIELDS:
            raise ApiError(422, 'invalid', f'{key} is not supported', field=key)
    assignees = payload.get('assignees')
    return {**payload, 'assignees': [(lead.user_id or request.env.user).id] if assignees is None else assignees}


class CrmOpportunityTasksController(http.Controller):

    @http.route(URL, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', 'tasks.enabled', operation='read')
    @requires_capability('crm.leads.read', 'tasks.tasks.read')
    def list_opportunity_tasks(self, lead_id, **_):
        lead = find_opportunity(lead_id)
        limit, offset = parse_page(request.httprequest.args)
        Task = request.env['project.task']
        domain = [('lead_id', '=', lead.id), ('liwan_personal', '=', True), ('company_id', '=', request.env.company.id)]
        tasks = Task.search(domain, order=SORTS['deadline'], limit=limit, offset=offset)
        return {'items': [dump_list_item(task) for task in tasks], 'total': Task.search_count(domain)}

    @http.route(URL, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', 'tasks.enabled', operation='write')
    @requires_capability('crm.leads.work', 'tasks.tasks.create')
    def create_opportunity_task(self, lead_id, **payload):
        lead = find_opportunity(lead_id)
        request.env['liwan.crm.visibility']._liwan_check_write(lead, request.env.user)
        if not lead.active:
            raise ApiError(422, 'invalid', 'an archived opportunity takes no new task', field='lead_id')
        task = request.env['liwan.my.task.service']._create_task(
            _create_values(lead, payload), link_values={'lead_id': lead.id})
        return dump_personal_task(task)
