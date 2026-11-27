# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The company's telephony settings and its lines and extensions (design sections 5, 7, 8).

Every route needs the feature, the current company and `telephony.manage`; reading needs `telephony.use`. A line's
password is write-only: it is passed to the agent and never read back, so no shape here carries it.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_telephony.serializers.telephony_extension import (
    dump_extension,
    dump_extensions,
)
from odoo.addons.liwan_telephony.serializers.telephony_line import dump_line, dump_lines
from odoo.addons.liwan_telephony.serializers.telephony_settings import dump_settings

SETTINGS_FIELDS = {
    'recordingPolicy': 'recording_policy',
    'announcementEnabled': 'recording_announcement',
    'retentionDays': 'retention_days',
    'ivrEnabled': 'ivr_enabled',
    'businessHoursEnabled': 'business_hours_enabled',
    'outboundInternational': 'outbound_international',
}
LINE_FIELDS = {
    'name': 'name',
    'kind': 'kind',
    'authMethod': 'auth_method',
    'providerHost': 'provider_host',
    'providerPort': 'provider_port',
    'numbers': 'numbers',
    'outboundFormat': 'outbound_format',
    'callerId': 'caller_id',
    'maxConcurrent': 'max_concurrent',
}


def _require(capability):
    service = request.env['liwan.access.service']
    if not service._liwan_has_capability(request.env.user, capability):
        raise ApiError(403, 'forbidden', f'{capability} capability is required')


def _settings():
    settings = request.env['liwan.telephony.settings'].search([], limit=1)
    if not settings:
        settings = request.env['liwan.telephony.settings'].create({})
    return settings


class TelephonySettingsController(http.Controller):

    @http.route('/api/v1/telephony/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('telephony.enabled', operation='read')
    def get_settings(self, **_):
        _require('telephony.use')
        return dump_settings(_settings())

    @http.route('/api/v1/telephony/settings', type='json2', auth='user', methods=['PATCH'])
    @api_handler
    @requires_feature('telephony.enabled', operation='write')
    def patch_settings(self, **values):
        _require('telephony.manage')
        mapped = {field: values[key] for key, field in SETTINGS_FIELDS.items() if key in values}
        if not mapped:
            raise ApiError(422, 'invalid', 'No setting to change.')
        _settings().write(mapped)
        return dump_settings(_settings())

    @http.route('/api/v1/telephony/lines', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('telephony.enabled', operation='read')
    def list_lines(self, **_):
        _require('telephony.use')
        lines = request.env['liwan.telephony.line'].search([])
        return {'items': dump_lines(lines), 'total': len(lines)}

    @http.route('/api/v1/telephony/lines', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature('telephony.enabled', operation='write')
    def create_line(self, **values):
        _require('telephony.manage')
        mapped = {field: values[key] for key, field in LINE_FIELDS.items() if key in values}
        if not mapped.get('name'):
            raise ApiError(422, 'invalid', 'A line needs a name.')
        line = request.env['liwan.telephony.line'].create(mapped)
        return dump_line(line)

    @http.route('/api/v1/telephony/lines/<int:line_id>', type='json2', auth='user', methods=['PATCH'])
    @api_handler
    @requires_feature('telephony.enabled', operation='write')
    def patch_line(self, line_id, **values):
        _require('telephony.manage')
        line = request.env['liwan.telephony.line'].browse(line_id).exists()
        if not line:
            raise ApiError(404, 'not_found', 'The line does not exist.')
        mapped = {field: values[key] for key, field in LINE_FIELDS.items() if key in values}
        if mapped:
            line.write(mapped)
        return dump_line(line)

    @http.route('/api/v1/telephony/extensions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('telephony.enabled', operation='read')
    def list_extensions(self, **_):
        _require('telephony.use')
        extensions = request.env['liwan.telephony.extension'].search([])
        return {'items': dump_extensions(extensions), 'total': len(extensions)}

    @http.route('/api/v1/telephony/extensions', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature('telephony.enabled', operation='write')
    def create_extension(self, number=None, userId=None, **_):
        _require('telephony.manage')
        if not number:
            raise ApiError(422, 'invalid', 'An extension needs a number.')
        extension = request.env['liwan.telephony.extension'].create({
            'number': number,
            'user_id': int(userId) if userId else False,
        })
        return dump_extension(extension)
