# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_appointments.controllers.records import (
    MANAGE_CAPABILITY,
    READ_CAPABILITY,
    company_domain,
    get_company_record,
)
from odoo.addons.webvue_appointments.serializers.appointment_reason import (
    dump_reason,
    dump_reasons,
    parse_kind,
    parse_reason,
)

REASON = 'webvue.appointment.reason'


class AppointmentReasonController(http.Controller):
    """The company's visit-reason and cancel-reason lists; a reason is archived, never deleted."""

    @http.route('/api/v1/appointments/reasons', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def list_reasons(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = company_domain(args)
        if 'kind' in args:
            domain.append(('kind', '=', parse_kind(args['kind'])))
        Reason = request.env[REASON]
        return {
            'items': dump_reasons(Reason.search(domain, limit=limit, offset=offset)),
            'total': Reason.search_count(domain),
        }

    @http.route('/api/v1/appointments/reasons', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def create_reason(self, **payload):
        values = parse_reason(payload, creating=True)
        return dump_reason(request.env[REASON].create({**values, 'company_id': request.env.company.id}))

    @http.route('/api/v1/appointments/reasons/<int:reason_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def patch_reason(self, reason_id, **payload):
        reason = get_company_record(REASON, reason_id)
        reason.write(parse_reason(payload, creating=False))
        return dump_reason(reason)

    @http.route('/api/v1/appointments/reasons/<int:reason_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def archive_reason(self, reason_id, **_):
        reason = get_company_record(REASON, reason_id)
        reason.write({'active': False})
        return dump_reason(reason)

    @http.route('/api/v1/appointments/reasons/<int:reason_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def unarchive_reason(self, reason_id, **_):
        reason = get_company_record(REASON, reason_id)
        reason.write({'active': True})
        return dump_reason(reason)
