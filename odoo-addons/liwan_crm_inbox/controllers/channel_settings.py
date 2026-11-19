# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_crm_inbox.models.channel_opportunity import OPPORTUNITY_MODES
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    get_channel,
    holds,
    not_found,
    reject,
)
from odoo.addons.liwan_inbox.models.access_service import MANAGE_CHANNELS

MANAGE_CRM_SETTINGS = 'crm.settings.manage'
MODES = tuple(value for value, _label in OPPORTUNITY_MODES)


def dump_crm_settings(channel):
    """The channel's CRM setting: whether a new conversation opens an opportunity by itself."""
    return {'channel_id': channel.id, 'opportunity_mode': channel.crm_opportunity_mode}


def parse_crm_settings(payload):
    """The values of a patch of the channel's CRM setting; 422 on an unknown field or value."""
    check_fields(payload, {'opportunity_mode'}, required=('opportunity_mode',))
    mode = payload['opportunity_mode']
    if mode not in MODES:
        reject(f'opportunity_mode must be one of {", ".join(MODES)}', 'opportunity_mode')
    return {'crm_opportunity_mode': mode}


def crm_channel(channel_id):
    """The channel when the caller manages channels and CRM settings in the channel's own company; else a plain 404."""
    channel = get_channel(channel_id, MANAGE_CHANNELS)
    if not holds(MANAGE_CRM_SETTINGS, channel.owner_company_id):
        raise not_found()
    return channel


class ChannelCrmSettingsController(http.Controller):

    @http.route('/api/v1/inbox/channels/<int:channel_id>/crm-settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', 'inbox.enabled', operation='read')
    @requires_capability(MANAGE_CHANNELS, MANAGE_CRM_SETTINGS)
    def read_channel_crm_settings(self, channel_id, **_):
        return dump_crm_settings(crm_channel(channel_id))

    @http.route('/api/v1/inbox/channels/<int:channel_id>/crm-settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', 'inbox.enabled', operation='write')
    @requires_capability(MANAGE_CHANNELS, MANAGE_CRM_SETTINGS)
    def patch_channel_crm_settings(self, channel_id, **payload):
        channel = crm_channel(channel_id)
        channel.write(parse_crm_settings(payload))
        return dump_crm_settings(channel)
