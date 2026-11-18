# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/inbox agents: the assignee picker with availability, the manual status and the weekly shifts of an agent."""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    require_capabilities,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.controllers.automation_parsing import (
    parse_bool,
    parse_shifts,
)
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    not_found,
)
from odoo.addons.liwan_inbox.models.access_service import (
    ASSIGN,
    MANAGE_AUTOMATION,
    MANAGE_SETTINGS,
    READ,
    REPLY,
)
from odoo.addons.liwan_inbox.serializers.agent import dump_agent

AGENT = '/api/v1/inbox/agents/<int:user_id>'


def agent_service():
    return request.env['liwan.inbox.agent']


def reply_agents():
    """Active users who can reply in the current company."""
    service = request.env['liwan.access.service']
    return request.env.ref('liwan_inbox.group_cap_inbox_conversations_reply').all_user_ids.filtered(
        lambda user: user.active and service._liwan_has_capability(user, REPLY),
    )


def find_inbox_agent(user_id):
    """The user when they are an active agent of the current company; 404 otherwise."""
    user = request.env['res.users'].browse(user_id).exists()
    if not user or user not in reply_agents():
        raise not_found()
    return user


def dump_one(user):
    return dump_agent(user, agent_service()._liwan_availability(user, request.env.company)[user.id])


class AgentsController(http.Controller):

    @http.route('/api/v1/inbox/agents', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ, MANAGE_AUTOMATION, MANAGE_SETTINGS, match='any')
    def list_agents(self, **_):
        """The assignee picker: active users of the company who can reply, with their availability."""
        args = request.httprequest.args
        limit, offset = parse_page(args)
        candidates = reply_agents().filtered(lambda user: args.get('q', '').lower() in user.name.lower()).sorted('name')
        page = candidates[offset:offset + limit]
        state = agent_service()._liwan_availability(page, request.env.company)
        return {'items': [dump_agent(user, state[user.id]) for user in page], 'total': len(candidates)}

    @http.route(AGENT, type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY, ASSIGN, match='any')
    def patch_agent(self, user_id, **payload):
        """An agent switches their own status (reply right); anyone else's needs the assign right."""
        if user_id != request.env.user.id:
            require_capabilities(ASSIGN)
        user = find_inbox_agent(user_id)
        check_fields(payload, {'available'}, required=('available',))
        agent_service()._liwan_set_available(user, request.env.company, parse_bool(payload['available'], 'available'))
        return dump_one(user)

    @http.route(f'{AGENT}/shifts', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(MANAGE_SETTINGS)
    def get_shifts(self, user_id, **_):
        user = find_inbox_agent(user_id)
        row = agent_service().search([('company_id', '=', request.env.company.id), ('user_id', '=', user.id)], limit=1)
        return {'ranges': request.env['liwan.inbox.working.hours']._liwan_dump_days(row.hours_range_ids)}

    @http.route(f'{AGENT}/shifts', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def put_shifts(self, user_id, **payload):
        user = find_inbox_agent(user_id)
        row = agent_service()._liwan_write_shifts(user, request.env.company, parse_shifts(payload))
        return {'ranges': request.env['liwan.inbox.working.hours']._liwan_dump_days(row.hours_range_ids)}
