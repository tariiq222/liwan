# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.webvue_appointments.serializers.appointments_record import dump_records

MAX_LIMIT = 200


class AppointmentsRecordController(http.Controller):

    @http.route('/api/v1/appointments/records', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    def list_records(self, **_):
        service = request.env['webvue.access.service']
        if not service._webvue_has_capability(request.env.user, 'appointments.records.read'):
            raise ApiError(403, 'forbidden', 'appointments.records.read capability is required')
        args = request.httprequest.args
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        Record = request.env['webvue.appointments.record']
        domain = [('company_id', '=', request.env.company.id)]
        records = Record.search(domain, limit=limit, offset=offset)
        return {'items': dump_records(records), 'total': Record.search_count(domain)}
