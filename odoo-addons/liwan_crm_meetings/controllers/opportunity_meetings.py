# Part of Odoo. See LICENSE file for full copyright and licensing details.
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
from odoo.addons.liwan_meetings.controllers.meetings import (
    CREATE_FIELDS,
    create_meeting_from_body,
    request_body,
)
from odoo.addons.liwan_meetings.serializers.meeting import dump_meeting, dump_meetings

ORDER = 'meeting_date desc, id desc'
# The opportunity comes from the URL, under a name apart from the body's lead_id, which is refused.
# A meeting made here is not part of a series or a project.
BODY_FIELDS = CREATE_FIELDS - {'series_id', 'project_id', 'minutes_form'}


class OpportunityMeetingsController(http.Controller):

    @http.route('/api/v1/crm/opportunities/<int:opportunity_id>/meetings', type='json2', auth='user', methods=['GET'],
                readonly=True)
    @api_handler
    @requires_feature('crm.enabled', 'meetings.enabled', operation='read')
    @requires_capability('crm.leads.read', 'meetings.read')
    def list_opportunity_meetings(self, opportunity_id, **_):
        lead = find_opportunity(opportunity_id)
        limit, offset = parse_page(request.httprequest.args)
        Meeting = request.env['liwan.meeting.minute']
        domain = [('lead_id', '=', lead.id)]
        return {
            'items': dump_meetings(Meeting.search(domain, order=ORDER, limit=limit, offset=offset)),
            'total': Meeting.search_count(domain),
        }

    @http.route('/api/v1/crm/opportunities/<int:opportunity_id>/meetings', type='json2', auth='user', methods=['POST'],
                readonly=False)
    @api_handler
    @requires_feature('crm.enabled', 'meetings.enabled', operation='write')
    @requires_capability('crm.leads.work', 'meetings.create')
    def create_opportunity_meeting(self, opportunity_id, **payload):
        extra = set(payload) - BODY_FIELDS
        if extra:
            raise ApiError(422, 'invalid', 'unsupported meeting fields: %s' % ', '.join(sorted(extra)))
        lead = find_opportunity(opportunity_id)
        request.env['liwan.crm.visibility']._liwan_check_write(lead, request.env.user)
        if not lead.active:
            raise ApiError(422, 'invalid', 'an archived opportunity takes no new meeting', field='lead_id')
        meeting = create_meeting_from_body(request_body(), {'lead_id': lead.id})
        return request.make_json_response(dump_meeting(meeting, detail=True), status=201)
