# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The call log, the lookup by number and the recording link (design 4.3, 4.4, 8).

Every route needs the feature, the capability and the current company, and a user with only ``telephony.use`` sees
their own calls because the record rule says so, not because this controller filters.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_feature,
)
from odoo.addons.liwan_telephony.serializers.telephony_call import dump_call, dump_calls


def _require(capability):
    service = request.env['liwan.access.service']
    if not service._liwan_has_capability(request.env.user, capability):
        raise ApiError(403, 'forbidden', f'{capability} capability is required')


class TelephonyCallsController(http.Controller):

    @http.route('/api/v1/telephony/calls', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('telephony.enabled', operation='read')
    @requires_feature('telephony.recording', operation='read')
    def list_calls(self, direction=None, state=None, user_id=None, **kwargs):
        _require('telephony.use')
        limit, offset = parse_page(request.httprequest.args)
        domain = []
        if direction:
            domain.append(('direction', '=', direction))
        if state:
            domain.append(('state', '=', state))
        if user_id:
            domain.append(('user_id', '=', int(user_id)))
        Call = request.env['liwan.telephony.call']
        calls = Call.search(domain, limit=limit, offset=offset)
        return {'items': dump_calls(calls), 'total': Call.search_count(domain)}

    @http.route('/api/v1/telephony/calls/<int:call_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('telephony.enabled', operation='read')
    def get_call(self, call_id, **_):
        _require('telephony.use')
        call = request.env['liwan.telephony.call'].browse(call_id).exists()
        if not call:
            raise ApiError(404, 'not_found', 'The call does not exist.')
        dump = dump_call(call)
        dump['canListen'] = request.env['liwan.access.service']._liwan_has_capability(
            request.env.user,
            'telephony.recordings.listen',
        )
        return dump

    @http.route('/api/v1/telephony/lookup', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('telephony.enabled', operation='read')
    def lookup(self, number, **_):
        """The caller card: the partner this number belongs to and the last calls with it."""
        _require('telephony.use')
        if not number:
            raise ApiError(422, 'invalid', 'A number is required.')
        partner = request.env['res.partner'].search([('phone', '=', number)], limit=1)
        if not partner:
            partner = request.env['res.partner'].search([('mobile', '=', number)], limit=1)
        calls = request.env['liwan.telephony.call'].search(
            [('remote_number', '=', number)], limit=5, order='started_at desc',
        )
        return {
            'partner': {
                'id': partner.id, 'name': partner.display_name, 'company': partner.company_name,
            } if partner else None,
            'lastCalls': dump_calls(calls),
            'number': number,
        }
