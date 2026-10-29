# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.adapters import media_rules, whatsapp
from odoo.addons.webvue_inbox.controllers.conversation_files import parse_upload
from odoo.addons.webvue_inbox.controllers.helpers import (
    get_channel,
    no_content,
    not_found,
    reject,
    unique_as_invalid,
)
from odoo.addons.webvue_inbox.controllers.template_parsing import parse_template_write
from odoo.addons.webvue_inbox.models.access_service import (
    MANAGE_CHANNELS,
    MANAGE_TEMPLATES,
    READ,
)
from odoo.addons.webvue_inbox.models.template import CATEGORIES, STATUSES
from odoo.addons.webvue_inbox.serializers.conversation import dump_attachment
from odoo.addons.webvue_inbox.serializers.settings import dump_template

TEMPLATES_FEATURE = 'inbox.templates'
READ_CAPABILITIES = (READ, MANAGE_TEMPLATES, MANAGE_CHANNELS)
# Meta accepts one sample file per header kind: a PNG or JPEG image, an MP4 video, a PDF document.
SAMPLE_MIMETYPES = {'image': {'image/png', 'image/jpeg'}, 'video': {'video/mp4'}, 'document': {'application/pdf'}}
MAX_SEARCH = 128


def get_template(template_id, *capabilities):
    """A template whose channel the caller may use with one of `capabilities`; anything else is a plain 404."""
    template = request.env['webvue.inbox.template'].search([('id', '=', template_id)], limit=1)
    if not template:
        raise not_found()
    get_channel(template.channel_id.id, *capabilities)
    return template


def parse_choice(args, key, choices):
    value = args.get(key)
    if value is not None and value not in dict(choices):
        reject(f'{key} must be one of {sorted(dict(choices))}', key)
    return value


def list_domain(channel, args):
    domain = [('channel_id', '=', channel.id)]
    for key, choices in (('status', STATUSES), ('category', CATEGORIES)):
        value = parse_choice(args, key, choices)
        if value:
            domain.append((key, '=', value))
    query = (args.get('q') or '').strip()
    if len(query) > MAX_SEARCH:
        reject(f'q must be at most {MAX_SEARCH} characters', 'q')
    if query:
        domain.append(('name', 'ilike', query))
    return domain


def parse_sample_upload(payload):
    """(name, bytes, mimetype) of a header sample: an image, an MP4 video or a PDF."""
    name, raw, mimetype = parse_upload(payload)
    kind = media_rules.kind_of(mimetype)
    if mimetype not in SAMPLE_MIMETYPES.get(kind, ()):
        reject('a header sample must be an image, an MP4 video or a PDF document', 'data')
    return name, raw, mimetype


class TemplateController(http.Controller):

    @http.route('/api/v1/inbox/channels/<int:channel_id>/templates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(*READ_CAPABILITIES, match='any')
    def list_templates(self, channel_id, **_):
        channel = get_channel(channel_id, *READ_CAPABILITIES)
        domain = list_domain(channel, request.httprequest.args)
        limit, offset = parse_page(request.httprequest.args)
        Template = request.env['webvue.inbox.template']
        return {
            'items': [dump_template(t) for t in Template.search(domain, limit=limit, offset=offset)],
            'total': Template.search_count(domain),
        }

    @http.route('/api/v1/inbox/templates/<int:template_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(*READ_CAPABILITIES, match='any')
    def read_template(self, template_id, **_):
        return dump_template(get_template(template_id, *READ_CAPABILITIES))

    @http.route('/api/v1/inbox/channels/<int:channel_id>/templates/sync', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', TEMPLATES_FEATURE, operation='write')
    @requires_capability(MANAGE_TEMPLATES)
    def sync_templates(self, channel_id, **_):
        channel = get_channel(channel_id, MANAGE_TEMPLATES)
        try:
            templates = request.env['webvue.inbox.template']._webvue_sync(channel)
        except whatsapp.ProviderError as error:
            reject(str(error))
        return {'items': [dump_template(t) for t in templates], 'total': len(templates)}

    @http.route('/api/v1/inbox/channels/<int:channel_id>/templates', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', TEMPLATES_FEATURE, operation='write')
    @requires_capability(MANAGE_TEMPLATES)
    def create_template(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_TEMPLATES)
        parsed = parse_template_write(channel, payload)
        Template = request.env['webvue.inbox.template']
        if Template.search_count([
            ('channel_id', '=', channel.id), ('name', '=', parsed.values['name']), ('language', '=', parsed.values['language']),
        ]):
            reject('a template with this name and language already exists on the channel', 'name')
        try:
            with unique_as_invalid('name', 'a template with this name and language already exists on the channel'):
                template = Template._webvue_create_remote(channel, parsed.values, parsed.allow_category_change)
        except whatsapp.ProviderError as error:
            reject(str(error))
        return request.make_json_response(dump_template(template), status=201)

    @http.route('/api/v1/inbox/templates/<int:template_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', TEMPLATES_FEATURE, operation='write')
    @requires_capability(MANAGE_TEMPLATES)
    def edit_template(self, template_id, **payload):
        template = get_template(template_id, MANAGE_TEMPLATES)
        parsed = parse_template_write(template.channel_id, payload, template)
        try:
            template._webvue_edit_remote(parsed.values)
        except whatsapp.ProviderError as error:
            reject(str(error))
        return dump_template(template)

    @http.route('/api/v1/inbox/templates/<int:template_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', TEMPLATES_FEATURE, operation='write')
    @requires_capability(MANAGE_TEMPLATES)
    def delete_template(self, template_id, **_):
        template = get_template(template_id, MANAGE_TEMPLATES)
        try:
            template._webvue_delete_remote()
        except whatsapp.ProviderError as error:
            reject(str(error))
        return no_content()

    @http.route(
        '/api/v1/inbox/channels/<int:channel_id>/templates/uploads', type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('inbox.enabled', TEMPLATES_FEATURE, operation='write')
    @requires_capability(MANAGE_TEMPLATES)
    def upload_sample(self, channel_id, **payload):
        """Store the sample file of a media header; it is the uploader's own until a template uses it or a day passes."""
        get_channel(channel_id, MANAGE_TEMPLATES)
        name, raw, mimetype = parse_sample_upload(payload)
        attachment = request.env['ir.attachment'].create({
            'name': name, 'raw': raw, 'mimetype': mimetype, 'type': 'binary',
            'res_model': 'webvue.inbox.template', 'res_id': 0,
        })
        return request.make_json_response(dump_attachment(attachment), status=201)
