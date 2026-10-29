# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/inbox forms: the WhatsApp Flows a tenant builds, publishes to Meta, sends and reads the answers of."""
from datetime import date, datetime, timedelta

from odoo import http
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.adapters import whatsapp
from odoo.addons.webvue_inbox.controllers.flow_parsing import (
    parse_copy,
    parse_flow_write,
)
from odoo.addons.webvue_inbox.controllers.helpers import (
    get_channel,
    no_content,
    not_found,
    reject,
    unique_as_invalid,
    visible_conversation,
)
from odoo.addons.webvue_inbox.models.access_service import (
    MANAGE_AUTOMATION,
    MANAGE_CHANNELS,
    MANAGE_FLOWS,
    MANAGE_TEMPLATES,
    READ,
    REPLY,
)
from odoo.addons.webvue_inbox.models.constants import FLOWS_FEATURE
from odoo.addons.webvue_inbox.models.flow import STATUSES
from odoo.addons.webvue_inbox.serializers.flows import (
    dump_flow,
    dump_flow_summary,
    dump_preview,
    dump_submission,
)

# Who may pick a form: the composer (reply), the rule and template forms, and the form builders.
PICK = (REPLY, MANAGE_FLOWS, MANAGE_AUTOMATION, MANAGE_TEMPLATES, MANAGE_CHANNELS)
MAX_SEARCH = 128
PROVIDER_UNAVAILABLE = 'provider_unavailable'


def get_flow(flow_id, *capabilities):
    """A form whose channel the caller may use with one of `capabilities`; anything else is a plain 404."""
    flow = request.env['webvue.inbox.flow'].search([('id', '=', flow_id)], limit=1)
    if not flow:
        raise not_found()
    get_channel(flow.channel_id.id, *capabilities)
    return flow


def provider_failure(error):
    """Meta refused the call (422, with its words) or could not be reached (502). The request rolls back either way."""
    if error.retryable:
        raise ApiError(502, PROVIDER_UNAVAILABLE, str(error))
    reject(str(error))


def list_domain(channel, args):
    domain = [('channel_id', '=', channel.id)]
    status = args.get('status')
    if status:
        if status not in dict(STATUSES):
            reject(f'status must be one of {sorted(dict(STATUSES))}', 'status')
        domain.append(('status', '=', status))
    query = (args.get('q') or '').strip()
    if len(query) > MAX_SEARCH:
        reject(f'q must be at most {MAX_SEARCH} characters', 'q')
    if query:
        domain.append(('name', 'ilike', query))
    sendable = args.get('sendable')
    if sendable is not None:
        if sendable != 'true':
            reject('sendable must be true when given', 'sendable')
        domain += [('status', '=', 'published'), ('health', '!=', 'blocked')]
    return domain


def parse_day(args, key):
    value = args.get(key)
    if value is None:
        return None
    try:
        day = date.fromisoformat(value) if len(value) == 10 else None
    except ValueError:
        day = None
    if day is None:
        reject(f'{key} must be a date as YYYY-MM-DD', key)
    return day


def submission_domain(args):
    """The date filters of the submissions list (UTC days, both ends included)."""
    domain = []
    first, last = parse_day(args, 'date_from'), parse_day(args, 'date_to')
    if first:
        domain.append(('submitted_at', '>=', datetime.combine(first, datetime.min.time())))
    if last:
        domain.append(('submitted_at', '<', datetime.combine(last + timedelta(days=1), datetime.min.time())))
    return domain


def submissions_page(domain):
    limit, offset = parse_page(request.httprequest.args)
    Submission = request.env['webvue.inbox.flow.submission']
    return {
        'items': [dump_submission(s) for s in Submission.search(domain, limit=limit, offset=offset)],
        'total': Submission.search_count(domain),
    }


class FlowController(http.Controller):

    @http.route('/api/v1/inbox/channels/<int:channel_id>/flows', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='read')
    @requires_capability(*PICK, match='any')
    def list_flows(self, channel_id, **_):
        channel = get_channel(channel_id, *PICK)
        domain = list_domain(channel, request.httprequest.args)
        limit, offset = parse_page(request.httprequest.args)
        Flow = request.env['webvue.inbox.flow']
        return {
            'items': [dump_flow_summary(flow) for flow in Flow.search(domain, limit=limit, offset=offset)],
            'total': Flow.search_count(domain),
        }

    @http.route('/api/v1/inbox/channels/<int:channel_id>/flows', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='write')
    @requires_capability(MANAGE_FLOWS)
    def create_flow(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_FLOWS)
        parsed = parse_flow_write(channel, payload)
        try:
            with unique_as_invalid('name', 'a form with this name already exists on the channel'):
                flow = request.env['webvue.inbox.flow']._webvue_create_remote(channel, parsed.values, parsed.screens)
        except whatsapp.ProviderError as error:
            provider_failure(error)
        return request.make_json_response(dump_flow(flow), status=201)

    @http.route('/api/v1/inbox/channels/<int:channel_id>/flows/sync', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='write')
    @requires_capability(MANAGE_FLOWS)
    def sync_flows(self, channel_id, **_):
        channel = get_channel(channel_id, MANAGE_FLOWS)
        try:
            flows = request.env['webvue.inbox.flow']._webvue_sync(channel)
        except whatsapp.ProviderError as error:
            provider_failure(error)
        return {'items': [dump_flow_summary(flow) for flow in flows], 'total': len(flows)}

    @http.route('/api/v1/inbox/flows/<int:flow_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='read')
    @requires_capability(*PICK, match='any')
    def read_flow(self, flow_id, **_):
        return dump_flow(get_flow(flow_id, *PICK))

    @http.route('/api/v1/inbox/flows/<int:flow_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='write')
    @requires_capability(MANAGE_FLOWS)
    def edit_flow(self, flow_id, **payload):
        flow = get_flow(flow_id, MANAGE_FLOWS)
        flow._webvue_require_editable()
        parsed = parse_flow_write(flow.channel_id, payload, flow)
        try:
            with unique_as_invalid('name', 'a form with this name already exists on the channel'):
                flow._webvue_update_remote(parsed.values, parsed.screens)
        except whatsapp.ProviderError as error:
            provider_failure(error)
        return dump_flow(flow)

    @http.route('/api/v1/inbox/flows/<int:flow_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='write')
    @requires_capability(MANAGE_FLOWS)
    def delete_flow(self, flow_id, **_):
        flow = get_flow(flow_id, MANAGE_FLOWS)
        try:
            flow._webvue_delete_remote()
        except whatsapp.ProviderError as error:
            provider_failure(error)
        return no_content()

    @http.route('/api/v1/inbox/flows/<int:flow_id>/publish', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='write')
    @requires_capability(MANAGE_FLOWS)
    def publish_flow(self, flow_id, **_):
        flow = get_flow(flow_id, MANAGE_FLOWS)
        blockers = flow._webvue_replace_blockers() if flow.editable else flow.browse()
        if blockers:
            reject(f'approved templates still open the form this copy replaces: {", ".join(blockers.mapped("name"))}', 'replace')
        try:
            flow._webvue_publish_remote()
        except whatsapp.ProviderError as error:
            provider_failure(error)
        return dump_flow(flow)

    @http.route('/api/v1/inbox/flows/<int:flow_id>/deprecate', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='write')
    @requires_capability(MANAGE_FLOWS)
    def deprecate_flow(self, flow_id, **_):
        flow = get_flow(flow_id, MANAGE_FLOWS)
        try:
            flow._webvue_deprecate_remote()
        except whatsapp.ProviderError as error:
            provider_failure(error)
        return dump_flow(flow)

    @http.route('/api/v1/inbox/flows/<int:flow_id>/copy', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='write')
    @requires_capability(MANAGE_FLOWS)
    def copy_flow(self, flow_id, **payload):
        flow = get_flow(flow_id, MANAGE_FLOWS)
        name, replace = parse_copy(flow.channel_id, payload)
        try:
            with unique_as_invalid('name', 'a form with this name already exists on the channel'):
                copy = flow._webvue_copy(name, replace)
        except whatsapp.ProviderError as error:
            provider_failure(error)
        return request.make_json_response(dump_flow(copy), status=201)

    @http.route('/api/v1/inbox/flows/<int:flow_id>/preview', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='write')
    @requires_capability(MANAGE_FLOWS)
    def preview_flow(self, flow_id, **_):
        flow = get_flow(flow_id, MANAGE_FLOWS)
        try:
            return dump_preview(flow._webvue_preview())
        except whatsapp.ProviderError as error:
            provider_failure(error)

    @http.route('/api/v1/inbox/flows/<int:flow_id>/submissions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='read')
    @requires_capability(READ)
    def list_submissions(self, flow_id, **_):
        """The answers of a form, limited to the conversations the caller may see."""
        flow = get_flow(flow_id, READ)
        visible = request.env['webvue.inbox.conversation']._webvue_visible_domain()
        return submissions_page(Domain.AND([
            Domain('flow_id', '=', flow.id), Domain('conversation_id', 'any', visible), Domain(submission_domain(request.httprequest.args)),
        ]))

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/flow-submissions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', FLOWS_FEATURE, operation='read')
    @requires_capability(READ)
    def list_conversation_submissions(self, conversation_id, **_):
        conversation = visible_conversation(conversation_id)
        return submissions_page([('conversation_id', '=', conversation.id)])
