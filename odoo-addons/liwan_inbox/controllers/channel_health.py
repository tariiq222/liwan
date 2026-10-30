# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Number health, business profile and Meta analytics actions of a channel (capability inbox.channels.manage)."""
import re

from odoo import fields, http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.adapters import whatsapp
from odoo.addons.liwan_inbox.controllers.channels import dump
from odoo.addons.liwan_inbox.controllers.conversation_files import parse_upload
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    get_channel,
    no_content,
    parse_text,
    reject,
)
from odoo.addons.liwan_inbox.models.access_service import MANAGE_CHANNELS
from odoo.addons.liwan_inbox.models.constants import WHATSAPP_FEATURE
from odoo.addons.liwan_inbox.models.health_constants import ACTION_COOLDOWN
from odoo.addons.liwan_inbox.serializers.channel_health import dump_alert

TEMPLATES_FEATURE = 'inbox.templates'
PIN = re.compile(r'^\d{6}$')
EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
WEBSITE = re.compile(r'^https?://\S+$')
PROFILE_FIELDS = {'about', 'address', 'description', 'email', 'websites', 'vertical'}
# (field, longest text, whether it may be empty) of the plain text fields of the profile.
PROFILE_TEXTS = (('about', 139, False), ('address', 256, True), ('description', 512, True))
PICTURE_MIMETYPES = ('image/jpeg', 'image/png')


def parse_profile(payload):
    """The profile fields of a PATCH body checked against Meta's limits; 422 naming the field otherwise."""
    check_fields(payload, PROFILE_FIELDS)
    values = {}
    for key, maximum, may_be_empty in PROFILE_TEXTS:
        if key in payload:
            if may_be_empty and isinstance(payload[key], str) and not payload[key]:
                values[key] = ''
            else:
                values[key] = parse_text(payload, key, maximum)
    if 'email' in payload:
        email = payload['email']
        if not isinstance(email, str) or (email and not (len(email) <= 128 and EMAIL.match(email))):
            reject('email must be empty or a valid address of at most 128 characters', 'email')
        values['email'] = email
    if 'websites' in payload:
        sites = payload['websites']
        if not isinstance(sites, list) or len(sites) > 2 or not all(
            isinstance(site, str) and len(site) <= 256 and WEBSITE.match(site) for site in sites
        ):
            reject('websites must be at most two http or https addresses of at most 256 characters', 'websites')
        values['websites'] = sites
    if 'vertical' in payload:
        vertical = payload['vertical']
        if vertical is not None and vertical not in whatsapp.BUSINESS_VERTICALS:
            reject('vertical is not one of Meta\'s business categories', 'vertical')
        values['vertical'] = vertical
    return values


def parse_pin(payload):
    check_fields(payload, {'pin'}, required=('pin',))
    if not isinstance(payload['pin'], str) or not PIN.match(payload['pin']):
        reject('pin must be six digits', 'pin')
    return payload['pin']


def reject_rate_limited(message):
    raise ApiError(429, 'rate_limited', message)


def claim_action(channel, field):
    """Record the attempt of a number action (registration, PIN change); 429 while the last one is too recent."""
    if channel._liwan_cooling_down(field, ACTION_COOLDOWN):
        reject_rate_limited('this action was done a moment ago; wait a minute before repeating it')
    channel[field] = fields.Datetime.now()


def provider_call(call, *args, **kwargs):
    """Run an adapter call; a provider refusal answers 422 with Meta's text (never the request, so never a PIN)."""
    try:
        return call(*args, **kwargs)
    except whatsapp.ProviderError as error:
        reject(str(error))


def profile_of(channel):
    return provider_call(whatsapp.get_business_profile, channel._liwan_credentials())


class ChannelHealthController(http.Controller):

    @http.route('/api/v1/inbox/channels/<int:channel_id>/alerts', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(MANAGE_CHANNELS)
    def list_alerts(self, channel_id, **_):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        limit, offset = parse_page(request.httprequest.args)
        Alert = request.env['liwan.inbox.channel.alert']
        domain = [('channel_id', '=', channel.id)]
        return {
            'items': [dump_alert(a) for a in Alert.search(domain, limit=limit, offset=offset)],
            'total': Alert.search_count(domain),
        }

    @http.route('/api/v1/inbox/channels/<int:channel_id>/profile', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', WHATSAPP_FEATURE, operation='read')
    @requires_capability(MANAGE_CHANNELS)
    def read_profile(self, channel_id, **_):
        return profile_of(get_channel(channel_id, MANAGE_CHANNELS))

    @http.route('/api/v1/inbox/channels/<int:channel_id>/profile', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', WHATSAPP_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def update_profile(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        values = parse_profile(payload)
        provider_call(whatsapp.update_business_profile, channel._liwan_credentials(), values)
        return profile_of(channel)

    @http.route('/api/v1/inbox/channels/<int:channel_id>/profile/picture', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', WHATSAPP_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def upload_picture(self, channel_id, **payload):
        """Send the profile picture to Meta; LiwanOS keeps no copy of the bytes."""
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        name, raw, mimetype = parse_upload(payload)
        if mimetype not in PICTURE_MIMETYPES:
            reject('the profile picture must be a JPEG or PNG image', 'data')
        if not channel.app_id:
            reject('the channel needs the Meta app id to upload a picture', 'app_id')
        credentials = channel._liwan_credentials()
        handle = provider_call(whatsapp.upload_resumable, credentials, channel.app_id, name, mimetype, raw)
        provider_call(whatsapp.update_business_profile, credentials, {}, picture_handle=handle)
        return profile_of(channel)

    @http.route('/api/v1/inbox/channels/<int:channel_id>/display-name', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', WHATSAPP_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def request_display_name(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        check_fields(payload, {'name'}, required=('name',))
        name = parse_text(payload, 'name', 128, minimum=3)
        provider_call(whatsapp.request_display_name, channel._liwan_credentials(), name)
        channel.write({'name_status': 'pending_review', 'requested_name': name, 'name_rejection_reason': False})
        channel._liwan_alert('name_pending', 'info', requested_name=name)
        return dump(channel)

    @http.route('/api/v1/inbox/channels/<int:channel_id>/two-step-pin', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', WHATSAPP_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def set_pin(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        pin = parse_pin(payload)
        claim_action(channel, 'pin_attempted_at')
        provider_call(whatsapp.set_two_step_pin, channel._liwan_credentials(), pin)
        return no_content()

    @http.route('/api/v1/inbox/channels/<int:channel_id>/register', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', WHATSAPP_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def register_number(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        pin = parse_pin(payload)
        claim_action(channel, 'register_attempted_at')
        provider_call(whatsapp.register, channel._liwan_credentials(), pin)
        channel._liwan_refresh_health()
        return dump(channel)

    @http.route(
        '/api/v1/inbox/channels/<int:channel_id>/template-insights', type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('inbox.enabled', WHATSAPP_FEATURE, TEMPLATES_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def enable_template_insights(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        if payload:
            reject('no fields are accepted')
        provider_call(request.env['liwan.inbox.meta.analytics']._liwan_enable_template_insights, channel)
        return dump(channel)

    @http.route(
        '/api/v1/inbox/channels/<int:channel_id>/analytics/sync', type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('inbox.enabled', WHATSAPP_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def sync_analytics(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_CHANNELS)
        if payload:
            reject('no fields are accepted')
        if not request.env['liwan.inbox.meta.analytics']._liwan_request(channel):
            reject_rate_limited('the analytics were requested a moment ago; try again in a few minutes')
        return dump(channel)
