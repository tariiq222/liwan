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
from odoo.addons.webvue_hr.serializers.shifts.settings import (
    dump_settings,
    parse_settings,
)


class HrShiftSettingsController(http.Controller):

    @http.route('/api/v1/hr/shifts/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='read')
    @requires_capability('hr.employees.read')
    def get_settings(self, **_):
        return dump_settings(request.env['webvue.hr.shift.settings']._webvue_current(), request.env.company, request.env.user)

    @http.route('/api/v1/hr/shifts/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='write')
    @requires_capability('hr.shifts.manage')
    def patch_settings(self, **payload):
        vals = parse_settings(payload)
        revision = vals['revision']
        model = request.env['webvue.hr.shift.settings']
        model._webvue_require_current_company('hr.shifts.manage')
        row = model._webvue_current()
        if revision != (row.revision if row else 0):
            raise ApiError(409, 'conflict', 'shift settings changed; reload before saving')
        try:
            with request.env.cr.savepoint():
                if row:
                    row.write({'day_reference': vals['day_reference'], 'revision': revision + 1})
                else:
                    row = model.create({'company_id': request.env.company.id, 'day_reference': vals['day_reference']})
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', 'shift settings changed; reload before saving') from error
        return dump_settings(row, request.env.company, request.env.user)
