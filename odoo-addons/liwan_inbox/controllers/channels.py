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
    not_found,
    parse_provider_id,
    parse_text,
    reject,
    unique_as_invalid,
)
from odoo.addons.liwan_inbox.models.access_service import (
    MANAGE_AUTOMATION,
    MANAGE_CHANNELS,
    MANAGE_FLOWS,
    MANAGE_TEMPLATES,
    READ,
)
from odoo.addons.liwan_inbox.models.constants import (
    AUTOMATION_FEATURE,
    CHANNEL_FEATURES,
    CHANNEL_USES,
    FLOWS_FEATURE,
    INBOX_FEATURE,
    TEMPLATES_FEATURE,
)
from odoo.addons.liwan_inbox.models.integration_registry import USE_PROVIDERS
from odoo.addons.liwan_inbox.serializers.settings import (
    dump_channel,
    dump_channel_work,
    dump_connection,
    dump_event,
)

# The channels a page may pick from, by the capability and feature that give a user work on them (reading conversations included).
WORK_SCOPES = (
    (READ, INBOX_FEATURE), (MANAGE_TEMPLATES, TEMPLATES_FEATURE), (MANAGE_FLOWS, FLOWS_FEATURE), (MANAGE_AUTOMATION, AUTOMATION_FEATURE),
)
CREATE_FIELDS = {'name', 'kind', 'department_id', 'connection_id', 'phone_number_id'}
PATCH_FIELDS = {'name', 'department_id', 'state'}
KINDS = tuple(USE_PROVIDERS)


def parse_connection(payload, kind):
    """The connection a new channel serves: a live account of its kind's provider, connected by the current company."""
    connection = find_one('liwan.integration.connection', payload['connection_id'], 'connection_id')
    if (connection.provider != USE_PROVIDERS[kind] or connection.company_id != request.env.company
            or connection.state != 'connected'):
        reject(f'connection_id must name a connected {USE_PROVIDERS[kind]} connection of the current company', 'connection_id')
    return connection


def parse_create(payload):
    """The values of a new channel; 422 on any bad field."""
    check_fields(payload, CREATE_FIELDS, required=('name', 'kind', 'connection_id'))
    kind = payload['kind']
    if kind not in KINDS:
        reject(f'kind must be one of {", ".join(KINDS)}', 'kind')
    if (kind == 'whatsapp') != ('phone_number_id' in payload):
        reject('phone_number_id is required for a whatsapp channel and refused for a tiktok one', 'phone_number_id')
    values = {
        'name': parse_text(payload, 'name', 128), 'kind': kind, 'connection_id': parse_connection(payload, kind).id,
        **parse_department(payload, request.env.company),
    }
    if kind == 'whatsapp':
        values['phone_number_id'] = parse_provider_id(payload, 'phone_number_id')
    else:
        # A TikTok channel is its account: the connected account is the channel's state from the start.
        values['state'] = 'connected'
    return values


def parse_department(payload, company):
    """The department values of a payload: a department of `company`, the channel's own company."""
    if 'department_id' not in payload:
        return {}
    if payload['department_id'] is None:
        return {'department_id': False}
    return {'department_id': find_one('liwan.inbox.department', payload['department_id'], 'department_id', company).id}


def parse_patch(channel, payload):
    """The values of a channel patch; 422 on any bad field."""
    check_fields(payload, PATCH_FIELDS)
    values = parse_department(payload, channel.owner_company_id)
    if 'name' in payload:
        values['name'] = parse_text(payload, 'name', 128)
    if 'state' in payload:
        if payload['state'] != 'disabled':
            reject('state can only be set to disabled; a passing connection test connects the channel', 'state')
        values['state'] = payload['state']
    return values


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
            'items': [dump_channel(c) for c in Channel.search(domain, limit=limit, offset=offset)],
            'total': Channel.search_count(domain),
        }

    @http.route('/api/v1/inbox/channels/accounts', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(MANAGE_CHANNELS)
    def list_accounts(self, **_):
        """The provider accounts of the current company a new channel of `kind` may serve (no integrations capability needed)."""
        kind = request.httprequest.args.get('kind')
        if kind not in KINDS:
            reject(f'kind must be one of {", ".join(KINDS)}', 'kind')
        if not holds(MANAGE_CHANNELS, request.env.company):
            raise ApiError(403, 'forbidden', f'{MANAGE_CHANNELS} capability is required in the current company')
        request.env['liwan.entitlement.service'].require_read(CHANNEL_FEATURES[kind])
        accounts = request.env['liwan.integration.connection']._liwan_for_use(CHANNEL_USES[kind])
        return {'items': [dump_connection(account) for account in accounts], 'total': len(accounts)}

    @http.route('/api/v1/inbox/channels/work', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ, MANAGE_TEMPLATES, MANAGE_FLOWS, MANAGE_AUTOMATION, match='any')
    def list_work_channels(self, **_):
        """The channels the caller works on (conversations, templates, forms or automation), as minimal references.

        The channel list itself needs the channels capability; this one names only what a conversation filter or a template, form or
        automation page needs to pick a channel, for the companies where the caller holds that work's capability
        and the matching sub-feature is readable.
        """
        limit, offset = parse_page(request.httprequest.args)
        entitlement = request.env['liwan.entitlement.service']
        companies = {
            company_id
            for capability, feature in WORK_SCOPES
            if entitlement._liwan_feature_read(feature)
            for company_id in request.env['liwan.access.service']._liwan_capability_company_ids((capability,))
        }
        domain = [('owner_company_id', 'in', sorted(companies))]
        Channel = request.env['liwan.inbox.channel']
        return {
            'items': [dump_channel_work(c) for c in Channel.search(domain, limit=limit, offset=offset)],
            'total': Channel.search_count(domain),
        }

    @http.route('/api/v1/inbox/channels/<int:channel_id>/events', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(MANAGE_CHANNELS)
    def list_channel_events(self, channel_id, **_):
        """The channel's deliveries in one state, failed ones by default: what an operator may re-run."""
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        state = request.httprequest.args.get('state') or 'failed'
        if state not in ('pending', 'done', 'failed'):
            reject('state must be pending, done or failed', 'state')
        limit, offset = parse_page(request.httprequest.args)
        Event = request.env['liwan.inbox.event']
        domain = [('channel_id', '=', channel.id), ('state', '=', state)]
        return {
            'items': [dump_event(e) for e in Event.search(domain, order='create_date desc, id desc', limit=limit, offset=offset)],
            'total': Event.search_count(domain),
        }

    @http.route('/api/v1/inbox/events/<int:event_id>/retry', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def retry_event(self, event_id, **_):
        """Give a failed delivery a fresh set of attempts; a stored message is skipped by its provider id."""
        event = request.env['liwan.inbox.event'].search([('id', '=', event_id)], limit=1)
        if not event:
            raise not_found()
        get_channel(event.channel_id.id, MANAGE_CHANNELS)
        if event.state != 'failed':
            raise ApiError(422, 'invalid', 'only a failed delivery can be retried')
        event._liwan_reprocess()
        return dump_event(event)

    @http.route('/api/v1/inbox/channels', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def create_channel(self, **payload):
        if not holds(MANAGE_CHANNELS, request.env.company):
            raise ApiError(403, 'forbidden', f'{MANAGE_CHANNELS} capability is required in the current company')
        values = parse_create(payload)
        taken = ('connection_id', 'this TikTok account already has a channel', None) if values['kind'] == 'tiktok' else (
            'phone_number_id', 'this phone number id is already connected', 'inbox_phone_number_taken',
        )
        with unique_as_invalid(*taken):
            channel = request.env['liwan.inbox.channel'].create(values)
        if channel.kind == 'tiktok':
            # A shared-SaaS tenant registers the account with the relay so deliveries reach it (D13); the cron retries
            # an unreachable relay, and a direct-webhook tenant makes no relay call at all. The account then imports
            # its history (D11).
            channel._liwan_tiktok_bind()
            channel._liwan_tiktok_queue_first_sync()
        return dump_channel(channel)

    @http.route('/api/v1/inbox/channels/<int:channel_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(MANAGE_CHANNELS)
    def read_channel(self, channel_id, **_):
        return dump_channel(get_channel(channel_id, MANAGE_CHANNELS))

    @http.route('/api/v1/inbox/channels/<int:channel_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def patch_channel(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        channel.write(parse_patch(channel, payload))
        return dump_channel(channel)

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
        channel._liwan_test_connection()
        return dump_channel(channel)
