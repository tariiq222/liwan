# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_appointments.serializers.appointment_settings import (
    dump_settings,
    parse_settings,
)

STALE_MESSAGE = 'appointment settings changed; reload before saving'


class AppointmentSettingsController(http.Controller):

    @http.route('/api/v1/appointments/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability('appointments.bookings.read', 'appointments.bookings.write', 'appointments.bookings.manage', match='any')
    def get_settings(self, **_):
        return dump_settings(request.env['webvue.appointment.settings']._webvue_current())

    @http.route('/api/v1/appointments/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability('appointments.bookings.manage')
    def patch_settings(self, **payload):
        parsed = parse_settings(payload)
        revision = parsed['revision']
        model = request.env['webvue.appointment.settings']
        model._webvue_require_current_company('appointments.bookings.manage')
        row = model._webvue_current()
        if revision != (row.revision if row else 0):
            raise ApiError(409, 'conflict', STALE_MESSAGE)
        try:
            with request.env.cr.savepoint():
                if row:
                    row.write({**parsed['values'], 'revision': revision + 1})
                else:
                    row = model.create({**parsed['values'], 'company_id': request.env.company.id})
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', STALE_MESSAGE) from error
        return dump_settings(row)
