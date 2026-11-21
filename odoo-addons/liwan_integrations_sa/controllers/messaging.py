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
from odoo.addons.liwan_integrations_sa import providers
from odoo.addons.liwan_integrations_sa.controllers.helpers import (
    check_fields,
    find_connection,
    not_found,
    positive_int,
    provider_failure,
    query_connection_id,
    reject,
)
from odoo.addons.liwan_integrations_sa.models.constants import FEATURE, MANAGE
from odoo.addons.liwan_integrations_sa.models.message import STATES
from odoo.addons.liwan_integrations_sa.models.messaging import MESSAGING_CHANNELS
from odoo.addons.liwan_integrations_sa.providers import errors
from odoo.addons.liwan_integrations_sa.serializers.message import (
    dump_message,
    dump_message_state,
    dump_template,
)

LOG_READ = 'integrations.log.read'
TEST_ORIGIN = 'test'
TEST_FIELDS = {'sender_id', 'to', 'content_sid', 'content_variables'}
TEST_BODY = 'رسالة تجريبية من ليوان: الربط مع مزود الرسائل يعمل.'
TO_MAX = 32
Q_MAX = 32
STATE_KEYS = tuple(key for key, _label in STATES)


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


class IntegrationMessagingController(http.Controller):

    @http.route('/api/v1/integrations/messaging/templates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(MANAGE)
    def list_templates(self, **_):
        connection_id = query_connection_id(request.httprequest.args)
        if connection_id is None:
            reject('connection_id is required', 'connection_id')
        connection = find_connection(connection_id)
        module_list = getattr(providers.MODULES.get(connection.provider), 'list_templates', None)
        if not callable(module_list):
            reject('this provider has no message templates', 'connection_id')
        try:
            templates = module_list(connection.external_id, connection._liwan_provider_credentials())
        except errors.ProviderError as error:
            raise provider_failure(error) from None
        items = [dump_template(template) for template in templates]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/integrations/messaging/test', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def send_test(self, **payload):
        check_fields(payload, TEST_FIELDS, required=('sender_id', 'to'))
        sender_id = positive_int(payload['sender_id'], 'sender_id')
        to = payload['to']
        if not isinstance(to, str) or not 1 <= len(to.strip()) <= TO_MAX:
            reject(f'to must be a phone number of at most {TO_MAX} characters', 'to')
        sender = request.env['liwan.integration.sender'].search(
            [('id', '=', sender_id), ('company_id', '=', request.env.company.id)], limit=1,
        )
        if not sender:
            raise not_found()
        content_sid = payload.get('content_sid') or None
        state = request.env['liwan.integration.messaging']._liwan_send(
            to.strip(), TEST_ORIGIN, channel=sender.channel, body=None if content_sid else TEST_BODY,
            content_sid=content_sid, content_variables=payload.get('content_variables'), sender=sender.id,
        )
        return request.make_json_response(dump_message_state(state), status=201)

    @http.route('/api/v1/integrations/messaging/test/<int:message_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(MANAGE)
    def read_test(self, message_id, **_):
        state = request.env['liwan.integration.messaging']._liwan_status(message_id, TEST_ORIGIN, requested_by=request.env.user)
        if not state:
            raise not_found()
        return dump_message_state(state)

    @http.route('/api/v1/integrations/messaging/messages', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(LOG_READ)
    def list_messages(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = [('company_id', '=', request.env.company.id)]
        channel = args.get('channel')
        if channel is not None:
            if channel not in MESSAGING_CHANNELS:
                reject(f'channel must be one of {", ".join(MESSAGING_CHANNELS)}', 'channel')
            domain.append(('channel', '=', channel))
        state = args.get('state')
        if state is not None:
            if state not in STATE_KEYS:
                reject(f'state must be one of {", ".join(STATE_KEYS)}', 'state')
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
            if len(q) > Q_MAX:
                reject(f'q must be at most {Q_MAX} characters', 'q')
            domain.append(('to', 'ilike', q))
        Message = request.env['liwan.integration.message']
        messages = Message.search(domain, order='id desc', limit=limit, offset=offset)
        return {'items': [dump_message(message) for message in messages], 'total': Message.search_count(domain)}

    @http.route('/api/v1/integrations/messaging/messages/<int:message_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(LOG_READ)
    def read_message(self, message_id, **_):
        message = request.env['liwan.integration.message'].search(
            [('id', '=', message_id), ('company_id', '=', request.env.company.id)], limit=1,
        )
        if not message:
            raise not_found()
        return dump_message(message)

    @http.route('/api/v1/integrations/messaging/messages/<int:message_id>/retry', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE, LOG_READ, match='all')
    def retry_message(self, message_id, **_):
        state = request.env['liwan.integration.messaging']._liwan_retry(message_id)
        if not state:
            raise not_found()
        return request.make_json_response(dump_message_state(state), status=201)
