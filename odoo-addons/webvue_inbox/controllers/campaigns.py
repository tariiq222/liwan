# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Campaigns: CRUD, lifecycle actions, preview, test send, the header upload and the recipients (capability inbox.campaigns.manage)."""
from odoo import http
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    get_record,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.adapters import whatsapp
from odoo.addons.webvue_inbox.controllers.audiences import search_term
from odoo.addons.webvue_inbox.controllers.campaign_parsing import (
    in_company,
    parse_campaign,
    parse_preview,
)
from odoo.addons.webvue_inbox.controllers.helpers import (
    check_fields,
    find_one,
    no_content,
    reject,
)
from odoo.addons.webvue_inbox.controllers.templates import parse_sample_upload
from odoo.addons.webvue_inbox.models.access_service import CAMPAIGNS
from odoo.addons.webvue_inbox.models.campaign_constants import (
    CAMPAIGN_STATES,
    FAILURES,
    RECIPIENT_STATES,
)
from odoo.addons.webvue_inbox.models.campaign_param import param_text, template_needs
from odoo.addons.webvue_inbox.models.constants import CAMPAIGNS_FEATURE
from odoo.addons.webvue_inbox.models.template import PLACEHOLDER
from odoo.addons.webvue_inbox.serializers.campaigns import (
    dump_campaigns,
    dump_recipient,
)
from odoo.addons.webvue_inbox.serializers.conversation import dump_attachment


def dump_one(campaign):
    return dump_campaigns(campaign)[0]


def campaign_of(campaign_id):
    return get_record('webvue.inbox.campaign', campaign_id)


def choice_filter(args, key, choices):
    value = args.get(key)
    if value is not None and value not in dict(choices):
        reject(f'{key} must be one of {sorted(dict(choices))}', key)
    return value


def run_action(campaign_id, payload, method):
    """Run a lifecycle action of the campaign and return its new detail shape."""
    if payload:
        reject('no fields are accepted')
    campaign = campaign_of(campaign_id)
    getattr(campaign, method)()
    return dump_one(campaign)


def render_preview(template, params, contact):
    """The template as `contact` would receive it, and the placeholders that have no value (shown as written)."""
    given = {(item['location'], item['position']): param_text(item['source'], item['value'], contact) for item in params}
    missing = sorted(slot for slot in template_needs(template) if not given.get(slot))

    def fill(location):
        return lambda match: given.get((location, int(match.group(1)))) or match.group(0)

    return {
        'contact': {'id': contact.id, 'name': contact.name} if contact else None,
        'header_text': PLACEHOLDER.sub(fill('header'), template.header_text) if template.header_type == 'text' and template.header_text else None,
        'body': PLACEHOLDER.sub(fill('body'), template.body or ''),
        'footer': template.footer or None,
        'buttons': [
            {'type': button.kind, 'text': button.text or ''} for button in template.button_ids.sorted('sequence') if button.kind != 'otp'
        ],
        'missing': [{'location': location, 'position': position} for location, position in missing],
    }


class CampaignController(http.Controller):

    @http.route('/api/v1/inbox/campaigns', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='read')
    @requires_capability(CAMPAIGNS)
    def list_campaigns(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = []
        if choice_filter(args, 'state', CAMPAIGN_STATES):
            domain.append(('state', '=', args['state']))
        if args.get('channel_id') is not None:
            domain.append(('channel_id', '=', parse_positive_int(args['channel_id'], 'channel_id')))
        if search_term(args):
            domain.append(('name', 'ilike', search_term(args)))
        Campaign = request.env['webvue.inbox.campaign']
        return {'items': dump_campaigns(Campaign.search(domain, limit=limit, offset=offset)), 'total': Campaign.search_count(domain)}

    @http.route('/api/v1/inbox/campaigns', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def create_campaign(self, **payload):
        values = parse_campaign(payload)
        campaign = request.env['webvue.inbox.campaign'].create(values)
        self._own_header(campaign)
        return request.make_json_response(dump_one(campaign), status=201)

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='read')
    @requires_capability(CAMPAIGNS)
    def read_campaign(self, campaign_id, **_):
        return dump_one(campaign_of(campaign_id))

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def patch_campaign(self, campaign_id, **payload):
        campaign = campaign_of(campaign_id)
        previous = campaign.header_attachment_id
        campaign.write(parse_campaign(payload, campaign))
        if previous != campaign.header_attachment_id:
            previous.unlink()
        self._own_header(campaign)
        return dump_one(campaign)

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def delete_campaign(self, campaign_id, **_):
        campaign_of(campaign_id).unlink()
        return no_content()

    @staticmethod
    def _own_header(campaign):
        """Move the header file from its loose upload slot onto the campaign."""
        attachment = campaign.header_attachment_id
        if attachment and attachment.res_id != campaign.id:
            attachment.write({'res_model': campaign._name, 'res_id': campaign.id})

    @http.route('/api/v1/inbox/campaigns/uploads', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def upload_header(self, **payload):
        """Store the header file of a media template; it is loose until a campaign uses it or a day passes."""
        name, raw, mimetype = parse_sample_upload(payload)  # Meta's header files: a PNG or JPEG image, an MP4 video or a PDF
        attachment = request.env['ir.attachment'].create({
            'name': name, 'raw': raw, 'mimetype': mimetype, 'type': 'binary', 'res_model': 'webvue.inbox.campaign', 'res_id': 0,
        })
        return request.make_json_response(dump_attachment(attachment), status=201)

    @http.route('/api/v1/inbox/campaigns/preview', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def preview(self, **payload):
        template, params, contact = parse_preview(payload)
        return render_preview(template, params, contact)

    # lifecycle

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>/launch', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def launch_campaign(self, campaign_id, **payload):
        return run_action(campaign_id, payload, 'action_launch')

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>/pause', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def pause_campaign(self, campaign_id, **payload):
        return run_action(campaign_id, payload, 'action_pause')

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>/resume', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def resume_campaign(self, campaign_id, **payload):
        return run_action(campaign_id, payload, 'action_resume')

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def cancel_campaign(self, campaign_id, **payload):
        return run_action(campaign_id, payload, 'action_cancel')

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>/retry', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def retry_campaign(self, campaign_id, **payload):
        return run_action(campaign_id, payload, 'action_retry')

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>/test', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def test_send(self, campaign_id, **payload):
        campaign = campaign_of(campaign_id)
        check_fields(payload, {'contact_id'}, required=('contact_id',))
        contact = in_company(find_one('webvue.inbox.contact', payload['contact_id'], 'contact_id'), 'contact_id')
        try:
            message = campaign._webvue_send_test(contact)
        except whatsapp.ProviderError as error:
            reject(str(error))
        return {'conversation_id': message.conversation_id.id, 'message_id': message.id}

    @http.route('/api/v1/inbox/campaigns/<int:campaign_id>/recipients', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='read')
    @requires_capability(CAMPAIGNS)
    def list_recipients(self, campaign_id, **_):
        campaign = campaign_of(campaign_id)
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = Domain('campaign_id', '=', campaign.id)
        if choice_filter(args, 'state', RECIPIENT_STATES):
            domain &= Domain('state', '=', args['state'])
        if choice_filter(args, 'failure', FAILURES):
            domain &= Domain('failure', '=', args['failure'])
        if search_term(args):
            domain &= Domain('contact_id.name', 'ilike', search_term(args)) | Domain('contact_id.phone', 'ilike', search_term(args))
        Recipient = request.env['webvue.inbox.campaign.recipient']
        return {
            'items': [dump_recipient(r) for r in Recipient.search(domain, limit=limit, offset=offset)],
            'total': Recipient.search_count(domain),
        }
