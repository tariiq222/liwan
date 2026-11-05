# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One TikTok channel's settings: its suggested questions and chat prompts, and its history import."""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.adapters import tiktok
from odoo.addons.liwan_inbox.controllers.automation_parsing import parse_int
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    get_channel,
    no_content,
    not_found,
    reject,
)
from odoo.addons.liwan_inbox.controllers.reply_parsing import parse_string
from odoo.addons.liwan_inbox.models.access_service import MANAGE_CHANNELS
from odoo.addons.liwan_inbox.models.constants import TIKTOK_FEATURE
from odoo.addons.liwan_inbox.models.tiktok_shortcut import LIMITS
from odoo.addons.liwan_inbox.serializers.tiktok import dump_shortcut, dump_sync

SHORTCUTS_PATH = '/api/v1/inbox/channels/<int:channel_id>/tiktok/shortcuts'
SYNC_PATH = '/api/v1/inbox/channels/<int:channel_id>/tiktok/sync'
CREATE_FIELDS = {'kind', 'sequence', 'question', 'answer', 'title', 'content'}
PATCH_FIELDS = {'sequence', 'question', 'answer', 'title', 'content'}
# The content fields and their lengths, by kind.
CONTENT_FIELDS = {
    'question': (('question', tiktok.QUESTION_MAX), ('answer', tiktok.ANSWER_MAX)),
    'prompt': (('title', tiktok.PROMPT_TITLE_MAX), ('content', tiktok.PROMPT_CONTENT_MAX)),
}
MAX_SEQUENCE = 1000


def tiktok_channel(channel_id):
    """A TikTok channel of a company where the caller manages channels; any other is a plain 404."""
    channel = get_channel(channel_id, MANAGE_CHANNELS)
    if channel.kind != 'tiktok':
        raise not_found()
    return channel


def find_shortcut(channel, shortcut_id):
    shortcut = channel.tiktok_shortcut_ids.filtered(
        lambda shortcut: shortcut.id == parse_positive_int(shortcut_id, 'shortcut_id'),
    )
    if not shortcut:
        raise not_found()
    return shortcut


def check_limit(channel, kind):
    if len(channel.tiktok_shortcut_ids.filtered(lambda shortcut: shortcut.kind == kind)) >= LIMITS[kind]:
        reject(
            f'TikTok allows at most {LIMITS[kind]} items of this kind per account',
            reason='inbox_tiktok_auto_message_limit',
        )


def parse_shortcut(payload, kind, creating):
    """The values of a create (`kind` too) or patch body; 422 on any field the kind does not carry."""
    check_fields(payload, CREATE_FIELDS if creating else PATCH_FIELDS, required=('kind',) if creating else ())
    if creating and (not isinstance(payload['kind'], str) or payload['kind'] not in LIMITS):
        reject('kind must be question or prompt', 'kind')
    content_fields = CONTENT_FIELDS[kind]
    for name, _maximum in content_fields:
        if creating and name not in payload:
            reject(f'{name} is required', name)
    values = {}
    if 'sequence' in payload:
        values['sequence'] = parse_int(payload['sequence'], 'sequence', 0, MAX_SEQUENCE)
    for name, maximum in content_fields:
        if name in payload:
            values[name] = parse_string(payload[name], name, maximum)
    for name in {name for names in CONTENT_FIELDS.values() for name, _maximum in names} - {name for name, _maximum in content_fields}:
        if name in payload:
            reject(f'{name} does not belong to a TikTok {"suggested question" if kind == "question" else "chat prompt"}', name)
    if creating:
        values['kind'] = kind
    return values


class TikTokSettingsController(http.Controller):

    @http.route(SHORTCUTS_PATH, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(TIKTOK_FEATURE, operation='read')
    @requires_capability(MANAGE_CHANNELS)
    def list_shortcuts(self, channel_id, **_):
        shortcuts = tiktok_channel(channel_id).tiktok_shortcut_ids
        return {'items': [dump_shortcut(shortcut) for shortcut in shortcuts], 'total': len(shortcuts)}

    @http.route(SHORTCUTS_PATH, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(TIKTOK_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def create_shortcut(self, channel_id, **payload):
        channel = tiktok_channel(channel_id)
        values = parse_shortcut(payload, payload.get('kind'), creating=True)
        check_limit(channel, values['kind'])
        shortcut = request.env['liwan.inbox.tiktok.shortcut'].create({'channel_id': channel.id, **values})
        shortcut._liwan_push()
        return request.make_json_response(dump_shortcut(shortcut), status=201)

    @http.route(f'{SHORTCUTS_PATH}/<int:shortcut_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(TIKTOK_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def patch_shortcut(self, channel_id, shortcut_id, **payload):
        shortcut = find_shortcut(tiktok_channel(channel_id), shortcut_id)
        shortcut.write(parse_shortcut(payload, shortcut.kind, creating=False))
        shortcut._liwan_push()
        return dump_shortcut(shortcut)

    @http.route(f'{SHORTCUTS_PATH}/<int:shortcut_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature(TIKTOK_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def delete_shortcut(self, channel_id, shortcut_id, **_):
        find_shortcut(tiktok_channel(channel_id), shortcut_id).unlink()
        return no_content()

    @http.route(f'{SHORTCUTS_PATH}/enable', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(TIKTOK_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def enable_shortcuts(self, channel_id, **payload):
        channel = tiktok_channel(channel_id)
        check_fields(payload, {'kind', 'enabled'}, required=('kind', 'enabled'))
        if not isinstance(payload['kind'], str) or payload['kind'] not in LIMITS:
            reject('kind must be question or prompt', 'kind')
        if not isinstance(payload['enabled'], bool):
            reject('enabled must be true or false', 'enabled')
        channel._liwan_tiktok_set_enabled(payload['kind'], payload['enabled'])
        shortcuts = channel.tiktok_shortcut_ids
        return {
            'kind': payload['kind'], 'enabled': payload['enabled'],
            'items': [dump_shortcut(shortcut) for shortcut in shortcuts], 'total': len(shortcuts),
        }

    # history import (D11)

    @http.route(SYNC_PATH, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(TIKTOK_FEATURE, operation='read')
    @requires_capability(MANAGE_CHANNELS)
    def latest_sync(self, channel_id, **_):
        """The channel's latest history import, or null before the first one."""
        job = request.env['liwan.inbox.tiktok.sync'].search([('channel_id', '=', tiktok_channel(channel_id).id)], limit=1)
        return {'job': dump_sync(job) if job else None}

    @http.route(SYNC_PATH, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(TIKTOK_FEATURE, operation='write')
    @requires_capability(MANAGE_CHANNELS)
    def start_sync(self, channel_id, **_):
        """Queue a history import on demand; a second one while it runs is 422 `inbox_tiktok_sync_running`."""
        return request.make_json_response(dump_sync(tiktok_channel(channel_id)._liwan_tiktok_queue_sync()), status=201)
