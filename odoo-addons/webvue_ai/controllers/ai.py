# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.webvue_ai.models.access_service import AI_USE
from odoo.addons.webvue_ai.serializers.audit import dump_audit_receipt
from odoo.addons.webvue_ai.serializers.tool import dump_tool
from odoo.addons.webvue_ai.serializers.usage import dump_usage
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_registered_feature,
)

AI_FEATURE = 'ai.enabled'
MAX_USAGE_ITEMS = 64


def as_api_error(error, collection=None):
    """The 422 ``ApiError`` for a ``ValidationError`` carrying a field, else the error itself.

    A batch ``create`` tags the failing row with ``webvue_index``; the field then reads ``<collection>.<i>.<field>``.
    """
    field = getattr(error, 'webvue_field', None)
    if field is None:
        return error
    index = getattr(error, 'webvue_index', None)
    if collection is not None and index is not None:
        field = f'{collection}.{index}.{field}'
    return ApiError(422, getattr(error, 'webvue_code', 'invalid'), str(error), field=field)


class AiController(http.Controller):

    @http.route('/api/v1/ai/tools', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        'webvue.ai.tool.registry', '_webvue_ai_feature_keys',
        keys=('registry:webvue.ai.tool.registry',), operation='read', match='any',
    )
    def list_tools(self, **_):
        request.env['webvue.entitlement.service'].require_read(AI_FEATURE)
        request.env['webvue.access.service']._webvue_require_capability(AI_USE)
        registry = request.env['webvue.ai.tool.registry']
        items = [dump_tool(item) for item in registry._webvue_ai_tools_for_user()]
        # tool_calls_per_run is enforced by the AI service/executor from this limits block, not by Odoo.
        return {'items': items, 'total': len(items), 'limits': registry._webvue_ai_limits()}

    @http.route('/api/v1/ai/audit', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(
        'webvue.ai.tool.registry', '_webvue_ai_feature_keys',
        keys=('registry:webvue.ai.tool.registry',), operation='write', match='any',
    )
    def record_audit(self, **payload):
        request.env['webvue.entitlement.service'].require(AI_FEATURE)
        request.env['webvue.access.service']._webvue_require_capability(AI_USE)
        Audit = request.env['webvue.ai.audit']
        try:
            row = Audit.create(payload)
        except ValidationError as error:
            raise as_api_error(error) from error
        entitlement = request.env['webvue.entitlement.service']
        return dump_audit_receipt(row, Audit._webvue_ai_count_messages(), entitlement._webvue_limit_value('ai.messages.monthly'))

    @http.route('/api/v1/ai/usage', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(
        'webvue.ai.tool.registry', '_webvue_ai_feature_keys',
        keys=('registry:webvue.ai.tool.registry',), operation='write', match='any',
    )
    def record_usage(self, **payload):
        request.env['webvue.entitlement.service'].require(AI_FEATURE)
        request.env['webvue.access.service']._webvue_require_capability(AI_USE)
        unknown = sorted(set(payload) - {'items'})
        if unknown:
            raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])
        items = payload.get('items')
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_USAGE_ITEMS:
            raise ApiError(422, 'invalid', f'items must be a list of 1 to {MAX_USAGE_ITEMS} objects', field='items')
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise ApiError(422, 'invalid', 'each item must be an object', field=f'items.{index}')
        try:
            rows = request.env['webvue.ai.usage'].create(items)
        except ValidationError as error:
            raise as_api_error(error, 'items') from error
        return {'items': [dump_usage(row) for row in rows], 'total': len(rows)}
