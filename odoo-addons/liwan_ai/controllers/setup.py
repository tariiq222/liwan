# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import http
from odoo.http import request

from odoo.addons.liwan_ai.controllers.ai import AI_FEATURE
from odoo.addons.liwan_ai.models.access_service import AI_USE
from odoo.addons.liwan_ai.serializers.setup import dump_setting
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)


class AiSetupController(http.Controller):
    """The setup agent's two routes: the settings the caller may change, and one change the caller approved.

    Both answer only for settings of enabled applications whose capability the caller holds where the setting lives;
    the assistant reaches them through the Nuxt executor with the caller's own session.
    """

    @http.route('/api/v1/ai/setup/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(AI_FEATURE, operation='read')
    @requires_capability(AI_USE)
    def list_settings(self, **_):
        registry = request.env['liwan.ai.setting.registry']
        items = [dump_setting(item, registry._liwan_ai_current_value(item)) for item in registry._liwan_ai_manageable()]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/ai/setup/settings/<string:key>', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    @requires_capability(AI_USE)
    def apply_setting(self, key, **payload):
        if set(payload) != {'value'}:
            raise ApiError(422, 'invalid', 'send exactly the value', field='value')
        registry = request.env['liwan.ai.setting.registry']
        item = next((item for item in registry._liwan_ai_manageable() if item['key'] == key), None)
        if item is None:
            # An unknown key, an application the tenant lacks and a capability the caller lacks look the same.
            raise ApiError(404, 'not_found', 'no such setting for you')
        request.env['liwan.entitlement.service'].require(item['feature_key'])
        try:
            value = registry._liwan_ai_check_value(item, payload['value'])
        except ValueError as error:
            raise ApiError(422, 'invalid', str(error), field='value') from error
        try:
            with request.env.cr.savepoint():
                before, after = registry._liwan_ai_apply(item, value)
        except UniqueViolation as error:
            # The settings form saved the company's first row at the same moment: the user retries on fresh values.
            raise ApiError(409, 'conflict', 'the settings changed meanwhile; read them again') from error
        return {'key': key, 'before': before, 'after': after}
