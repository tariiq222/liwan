# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Sending health of a channel and the campaign policy of the company."""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.adapters import whatsapp
from odoo.addons.liwan_inbox.controllers.campaign_parsing import (
    parse_campaign_settings,
    parse_choice,
)
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    get_channel,
    reject,
)
from odoo.addons.liwan_inbox.models.access_service import CAMPAIGNS, MANAGE_CHANNELS
from odoo.addons.liwan_inbox.models.campaign_constants import MARKETING_APIS
from odoo.addons.liwan_inbox.models.constants import (
    CAMPAIGNS_FEATURE,
    WHATSAPP_FEATURE,
)
from odoo.addons.liwan_inbox.serializers.campaigns import (
    dump_campaign_settings,
    dump_sending,
)


class SendingController(http.Controller):

    @http.route('/api/v1/inbox/channels/<int:channel_id>/sending', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='read')
    @requires_capability(CAMPAIGNS, MANAGE_CHANNELS, match='any')
    def read_sending(self, channel_id, **_):
        return dump_sending(get_channel(channel_id, CAMPAIGNS, MANAGE_CHANNELS))

    @http.route('/api/v1/inbox/channels/<int:channel_id>/sending', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def patch_sending(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        check_fields(payload, {'marketing_api'}, required=('marketing_api',))
        channel.marketing_api = parse_choice(payload, 'marketing_api', MARKETING_APIS)
        return dump_sending(channel)

    @http.route('/api/v1/inbox/channels/<int:channel_id>/sending/refresh', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', WHATSAPP_FEATURE, CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS, MANAGE_CHANNELS, match='any')
    def refresh_sending(self, channel_id, **payload):
        channel = get_channel(channel_id, CAMPAIGNS, MANAGE_CHANNELS)
        if payload:
            reject('no fields are accepted')
        try:
            channel._liwan_refresh_sending()
        except whatsapp.ProviderError as error:
            reject(str(error))
        return dump_sending(channel)

    @http.route('/api/v1/settings/inbox/campaigns', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='read')
    @requires_capability(CAMPAIGNS)
    def get_campaign_settings(self, **_):
        return dump_campaign_settings(request.env['liwan.inbox.settings']._liwan_read_for_company())

    @http.route('/api/v1/settings/inbox/campaigns', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def patch_campaign_settings(self, **payload):
        settings = request.env['liwan.inbox.settings']._get_for_company()
        values, keywords = parse_campaign_settings(payload)
        if values:
            settings.write(values)
        if keywords:
            settings._liwan_replace_keywords(keywords)
        return dump_campaign_settings(settings)
