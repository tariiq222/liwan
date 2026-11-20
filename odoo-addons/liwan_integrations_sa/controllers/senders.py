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
from odoo.addons.liwan_integrations_sa.controllers.helpers import (
    check_fields,
    find_connection,
    not_found,
    reject,
)
from odoo.addons.liwan_integrations_sa.models.communication_settings import (
    MAX_DAILY_MESSAGE_LIMIT,
)
from odoo.addons.liwan_integrations_sa.models.constants import FEATURE, MANAGE, READ
from odoo.addons.liwan_integrations_sa.models.sender import CHANNEL_KINDS
from odoo.addons.liwan_integrations_sa.providers import errors
from odoo.addons.liwan_integrations_sa.serializers.sender import (
    dump_available_number,
    dump_sender,
    dump_settings,
)

CREATE_FIELDS = {'connection_id', 'channel', 'kind', 'value', 'is_default'}
PATCH_FIELDS = {'is_default', 'active'}
SETTINGS_FIELDS = {'daily_message_limit'}
VALUE_MAX = 64
BOOLEAN_TEXT = {'true': True, 'false': False}


def provider_failure(error):
    """A provider refusal while reading the account answers 502 with the provider's short message."""
    return ApiError(502, 'provider_error', str(error), details={'retryable': error.retryable})


def _positive_int(value, key):
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        reject(f'{key} must be a positive integer', key)
    return value


def _boolean(payload, key):
    if not isinstance(payload[key], bool):
        reject(f'{key} must be true or false', key)
    return payload[key]


def _query_connection_id(args):
    raw = args.get('connection_id')
    if raw is None:
        return None
    if not raw.isdigit() or int(raw) <= 0:
        reject('connection_id must be a positive integer', 'connection_id')
    return int(raw)


def _find_sender(sender_id):
    """The sender of the current company, archived ones included, or 404."""
    sender = request.env['liwan.integration.sender'].with_context(active_test=False).search(
        [('id', '=', sender_id), ('company_id', '=', request.env.company.id)], limit=1,
    )
    if not sender:
        raise not_found()
    return sender


def _refuse_duplicate(connection, channel, value, exclude=None):
    Sender = request.env['liwan.integration.sender']
    domain = [
        ('company_id', '=', request.env.company.id), ('connection_id', '=', connection.id),
        ('channel', '=', channel), ('value', '=', value), ('active', '=', True),
    ]
    if exclude:
        domain.append(('id', '!=', exclude.id))
    if Sender.search_count(domain):
        reject('this sender is already added for this channel', 'value')


class IntegrationSenderController(http.Controller):

    @http.route('/api/v1/integrations/senders', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(READ)
    def list_senders(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = [('company_id', '=', request.env.company.id)]
        channel = args.get('channel')
        if channel is not None:
            if channel not in CHANNEL_KINDS:
                reject(f'channel must be one of {", ".join(CHANNEL_KINDS)}', 'channel')
            domain.append(('channel', '=', channel))
        connection_id = _query_connection_id(args)
        if connection_id is not None:
            domain.append(('connection_id', '=', connection_id))
        active = args.get('active', 'true')
        if active not in BOOLEAN_TEXT:
            reject('active must be true or false', 'active')
        domain.append(('active', '=', BOOLEAN_TEXT[active]))
        Sender = request.env['liwan.integration.sender'].with_context(active_test=False)
        senders = Sender.search(domain, order='id desc', limit=limit, offset=offset)
        return {'items': [dump_sender(sender) for sender in senders], 'total': Sender.search_count(domain)}

    @http.route('/api/v1/integrations/senders/available', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(MANAGE)
    def available_numbers(self, **_):
        connection_id = _query_connection_id(request.httprequest.args)
        if connection_id is None:
            reject('connection_id is required', 'connection_id')
        connection = find_connection(connection_id)
        try:
            numbers = connection._liwan_account_numbers()
        except errors.ProviderError as error:
            raise provider_failure(error) from None
        items = [dump_available_number(number) for number in numbers]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/integrations/senders', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def create_sender(self, **payload):
        check_fields(payload, CREATE_FIELDS, required=('connection_id', 'channel', 'kind', 'value'))
        connection = find_connection(_positive_int(payload['connection_id'], 'connection_id'))
        channel, kind, value = payload['channel'], payload['kind'], payload['value']
        if channel not in CHANNEL_KINDS:
            reject(f'channel must be one of {", ".join(CHANNEL_KINDS)}', 'channel')
        if kind not in CHANNEL_KINDS[channel]:
            reject(f'a {channel} sender is one of {", ".join(CHANNEL_KINDS[channel])}', 'kind')
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= VALUE_MAX:
            reject(f'value must be a string of 1 to {VALUE_MAX} characters', 'value')
        value = value.strip()
        _refuse_duplicate(connection, channel, value)
        values = {'company_id': request.env.company.id, 'connection_id': connection.id, 'channel': channel, 'kind': kind, 'value': value}
        if 'is_default' in payload:
            values['is_default'] = _boolean(payload, 'is_default')
        try:
            sender = request.env['liwan.integration.sender'].create(values)
        except errors.ProviderError as error:
            raise provider_failure(error) from None
        return request.make_json_response(dump_sender(sender), status=201)

    @http.route('/api/v1/integrations/senders/<int:sender_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def patch_sender(self, sender_id, **payload):
        check_fields(payload, PATCH_FIELDS)
        sender = _find_sender(sender_id)
        values = {key: _boolean(payload, key) for key in PATCH_FIELDS if key in payload}
        if values.get('is_default') and not values.get('active', sender.active):
            reject('an archived sender cannot be the default', 'is_default')
        if values.get('active') and not sender.active:
            _refuse_duplicate(sender.connection_id, sender.channel, sender.value, exclude=sender)
        try:
            sender.write(values)
        except errors.ProviderError as error:
            raise provider_failure(error) from None
        return dump_sender(sender)

    @http.route('/api/v1/integrations/senders/<int:sender_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def delete_sender(self, sender_id, **_):
        _find_sender(sender_id)._liwan_archive()
        return request.make_json_response('', status=204)

    @http.route('/api/v1/integrations/communication-settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(READ)
    def read_settings(self, **_):
        return dump_settings(request.env['liwan.integration.settings']._liwan_values(request.env.company))

    @http.route('/api/v1/integrations/communication-settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def patch_settings(self, **payload):
        check_fields(payload, SETTINGS_FIELDS)
        limit = payload['daily_message_limit']
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_DAILY_MESSAGE_LIMIT:
            reject(f'daily_message_limit must be an integer from 1 to {MAX_DAILY_MESSAGE_LIMIT}', 'daily_message_limit')
        values = request.env['liwan.integration.settings']._liwan_update(request.env.company, {'daily_message_limit': limit})
        return dump_settings(values)
