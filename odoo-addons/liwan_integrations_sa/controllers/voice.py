# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, time

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_integrations_sa.controllers.helpers import (
    check_fields,
    not_found,
    reject,
)
from odoo.addons.liwan_integrations_sa.models.constants import FEATURE, MANAGE
from odoo.addons.liwan_integrations_sa.serializers.call import (
    dump_call,
    dump_call_state,
)

LOG_READ = 'integrations.log.read'
TEST_ORIGIN = 'test'
# The fixed Arabic sentence the speak test speaks when the caller gives no text of their own.
TEST_TEXT = 'مرحبًا، هذه مكالمة تجريبية من ليوان.'
CALL_STATE_KEYS = {'initiated', 'ringing', 'in_progress', 'completed', 'busy', 'no_answer', 'failed', 'canceled', 'unconfirmed'}
TO_MAX = 32


def _query_date(args, key):
    raw = args.get(key)
    if raw is None:
        return None
    # The contract promises `YYYY-MM-DD` (z.iso.date), so the full datetime spelling is refused.
    try:
        parsed = datetime.strptime(raw, '%Y-%m-%d').date()
    except ValueError:
        reject(f'{key} must be a date (YYYY-MM-DD)', key)
    return parsed


def _query_state(args):
    state = args.get('state')
    if state is None:
        return None
    if state not in CALL_STATE_KEYS:
        reject(f'state must be one of {", ".join(sorted(CALL_STATE_KEYS))}', 'state')
    return state


class IntegrationVoiceController(http.Controller):

    @http.route('/api/v1/integrations/voice/test', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def send_test(self, **payload):
        check_fields(payload, {'sender_id', 'to', 'mode', 'text', 'agent_number', 'language'}, required=('to', 'mode'))
        Voice = request.env['liwan.integration.voice']
        mode = payload['mode']
        sender_id = payload.get('sender_id')
        if mode == 'speak':
            if 'agent_number' in payload:
                reject('agent_number belongs to a bridge call', 'agent_number')
            state = Voice._liwan_speak(
                payload['to'], payload.get('text') or TEST_TEXT, TEST_ORIGIN,
                language=payload.get('language') or 'ar', sender=sender_id,
            )
        elif mode == 'bridge':
            if 'text' in payload or 'language' in payload:
                reject('a bridge call carries no spoken text', 'mode')
            if not payload.get('agent_number'):
                reject('agent_number is required for a bridge call', 'agent_number')
            state = Voice._liwan_bridge(
                payload['agent_number'], payload['to'], TEST_ORIGIN, sender=sender_id,
            )
        else:
            reject('mode must be speak or bridge', 'mode')
        return request.make_json_response(dump_call_state(state), status=201)

    @http.route('/api/v1/integrations/voice/test/<int:call_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(MANAGE)
    def read_test(self, call_id, **_):
        state = request.env['liwan.integration.voice']._liwan_status(call_id, TEST_ORIGIN, requested_by=request.env.user)
        if not state:
            raise not_found()
        return dump_call_state(state)

    @http.route('/api/v1/integrations/voice/calls', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(LOG_READ)
    def list_calls(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = [('company_id', '=', request.env.company.id)]
        state = _query_state(args)
        if state:
            domain.append(('state', '=', state))
        sender_id = args.get('sender_id')
        if sender_id is not None:
            if not sender_id.isdigit() or int(sender_id) <= 0:
                reject('sender_id must be a positive integer', 'sender_id')
            domain.append(('sender_id', '=', int(sender_id)))
        date_from, date_to = _query_date(args, 'date_from'), _query_date(args, 'date_to')
        if date_from and date_to and date_from > date_to:
            reject('date_from must not be after date_to', 'date_from')
        if date_from:
            domain.append(('create_date', '>=', datetime.combine(date_from, time.min)))
        if date_to:
            domain.append(('create_date', '<=', datetime.combine(date_to, time.max)))
        q = (args.get('q') or '').strip()
        if q:
            if len(q) > 32:
                reject('q must be at most 32 characters', 'q')
            domain.append(('to', 'ilike', q))
        Call = request.env['liwan.integration.call']
        calls = Call.search(domain, order='id desc', limit=limit, offset=offset)
        return {'items': [dump_call(call) for call in calls], 'total': Call.search_count(domain)}

    @http.route('/api/v1/integrations/voice/calls/<int:call_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(LOG_READ)
    def read_call(self, call_id, **_):
        call = request.env['liwan.integration.call'].search(
            [('id', '=', call_id), ('company_id', '=', request.env.company.id)], limit=1,
        )
        if not call:
            raise not_found()
        return dump_call(call)

    @http.route('/api/v1/integrations/lookup/test', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def lookup_test(self, **payload):
        check_fields(payload, {'number', 'line_type'}, required=('number',))
        number = payload['number']
        if not isinstance(number, str) or not 1 <= len(number.strip()) <= TO_MAX:
            reject(f'number must be a phone number of at most {TO_MAX} characters', 'number')
        line_type = payload.get('line_type', False)
        if not isinstance(line_type, bool):
            reject('line_type must be true or false', 'line_type')
        return request.env['liwan.integration.lookup']._liwan_lookup(number.strip(), line_type=line_type)
