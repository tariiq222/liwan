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
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    find_one,
    get_channel,
    holds,
    no_content,
    parse_provider_id,
    parse_text,
    reject,
    unique_as_invalid,
)
from odoo.addons.liwan_inbox.models.access_service import MANAGE_CHANNELS
from odoo.addons.liwan_inbox.serializers.settings import dump_channel

HOOK_PATH = '/api/v1/inbox/hooks/whatsapp'
CREATE_FIELDS = {
    'name', 'kind', 'department_id', 'phone_number_id', 'business_account_id', 'access_token', 'app_secret', 'app_id',
}
PATCH_FIELDS = {'name', 'department_id', 'state', 'access_token', 'app_secret', 'app_id'}
SECRET_LIMITS = {'access_token': (16, 1024), 'app_secret': (16, 256)}


def dump(channel):
    base = request.httprequest.url_root.replace('http://', 'https://', 1).rstrip('/')
    return dump_channel(channel, base + HOOK_PATH)


def parse_channel(payload, creating):
    """The channel values (secrets encrypted) of a create or patch body; 422 on any bad field."""
    check_fields(payload, CREATE_FIELDS if creating else PATCH_FIELDS,
                 required=('name', 'kind', 'phone_number_id', 'business_account_id', 'access_token', 'app_secret') if creating else ())
    values = {}
    if 'name' in payload:
        values['name'] = parse_text(payload, 'name', 128)
    if creating and payload['kind'] != 'whatsapp':
        reject('kind must be whatsapp', 'kind')
    if 'department_id' in payload:
        values['department_id'] = (
            find_one('liwan.inbox.department', payload['department_id'], 'department_id').id
            if payload['department_id'] is not None else False
        )
    if 'state' in payload:
        if payload['state'] != 'disabled':
            reject('state can only be set to disabled; a passing connection test connects the channel', 'state')
        values['state'] = payload['state']
    for key in ('phone_number_id', 'business_account_id'):
        if key in payload:
            values[key] = parse_provider_id(payload, key)
    if 'app_id' in payload:
        values['app_id'] = parse_provider_id(payload, 'app_id') if payload['app_id'] is not None else False
    secrets = {
        key: parse_text(payload, key, maximum=high, minimum=low)
        for key, (low, high) in SECRET_LIMITS.items() if key in payload
    }
    return {**values, **request.env['liwan.inbox.channel']._liwan_secret_values(**secrets)}


class ChannelController(http.Controller):

    @http.route('/api/v1/inbox/channels', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(MANAGE_CHANNELS)
    def list_channels(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        Channel = request.env['liwan.inbox.channel']
        companies = request.env['liwan.access.service']._liwan_capability_company_ids((MANAGE_CHANNELS,))
        domain = [('owner_company_id', 'in', companies)]
        return {
            'items': [dump(c) for c in Channel.search(domain, limit=limit, offset=offset)],
            'total': Channel.search_count(domain),
        }

    @http.route('/api/v1/inbox/channels', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def create_channel(self, **payload):
        if not holds(MANAGE_CHANNELS, request.env.company):
            raise ApiError(403, 'forbidden', f'{MANAGE_CHANNELS} capability is required in the current company')
        values = parse_channel(payload, creating=True)
        with unique_as_invalid('phone_number_id', 'this phone number id is already connected', 'inbox_phone_number_taken'):
            channel = request.env['liwan.inbox.channel'].create(values)
        return dump(channel)

    @http.route('/api/v1/inbox/channels/<int:channel_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(MANAGE_CHANNELS)
    def read_channel(self, channel_id, **_):
        return dump(get_channel(channel_id, MANAGE_CHANNELS))

    @http.route('/api/v1/inbox/channels/<int:channel_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def patch_channel(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        channel.write(parse_channel(payload, creating=False))
        return dump(channel)

    @http.route('/api/v1/inbox/channels/<int:channel_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def delete_channel(self, channel_id, **_):
        get_channel(channel_id, MANAGE_CHANNELS).unlink()
        return no_content()

    @http.route('/api/v1/inbox/channels/<int:channel_id>/test', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def test_channel(self, channel_id, **_):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        channel._liwan_refresh_health()
        return dump(channel)
