# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_chat.models.chat_access_service import CHAT_SETTINGS_MANAGE
from odoo.addons.liwan_chat.models.chat_settings import (
    DEFAULTS,
    MESSAGE_DELETE_MODES,
)

STALE = 'Chat settings changed; reload before saving'


class ChatSettingsController(http.Controller):

    @http.route('/api/v1/chat/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('chat.enabled', operation='read')
    @requires_capability(CHAT_SETTINGS_MANAGE)
    def get_settings(self, **_):
        return _dump_current()

    @http.route('/api/v1/chat/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    @requires_capability(CHAT_SETTINGS_MANAGE)
    def patch_settings(self, **payload):
        revision, values = _parse_patch(payload)
        model = request.env['liwan.chat.settings']
        row = model._liwan_current()
        if revision != (row.revision if row else 0):
            raise ApiError(409, 'conflict', STALE)
        try:
            with request.env.cr.savepoint():
                if row:
                    row.write({**values, 'revision': revision + 1})
                else:
                    model.create({**values, 'company_id': request.env.company.id})
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', STALE) from error
        return _dump_current()


def _parse_patch(payload):
    unknown = sorted(set(payload) - {'revision', 'values'})
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    revision = payload.get('revision')
    if type(revision) is not int or revision < 0:
        raise ApiError(422, 'invalid', 'revision must be a nonnegative integer', field='revision')
    values = payload.get('values')
    if not isinstance(values, dict) or not values:
        raise ApiError(422, 'invalid', 'values must be a non-empty object', field='values')
    unknown = sorted(set(values) - set(DEFAULTS))
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    mode = values.get('message_delete_mode')
    if mode not in MESSAGE_DELETE_MODES:
        raise ApiError(
            422, 'invalid', 'message_delete_mode must be one of: %s' % ', '.join(MESSAGE_DELETE_MODES), field='message_delete_mode',
        )
    return revision, {'message_delete_mode': mode}


def _dump_current():
    model = request.env['liwan.chat.settings']
    row = model._liwan_current()
    return {
        'values': model._liwan_effective(),
        'defaults': dict(DEFAULTS),
        'options': {'message_delete_mode': list(MESSAGE_DELETE_MODES)},
        'revision': row.revision if row else 0,
    }
