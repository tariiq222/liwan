# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.liwan_ai.models.access_service import AI_USE
from odoo.addons.liwan_ai.serializers.audit import dump_audit_receipt
from odoo.addons.liwan_ai.serializers.tool import dump_tool
from odoo.addons.liwan_ai.serializers.usage import dump_usage
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_registered_feature,
)

AI_FEATURE = 'ai.enabled'
MAX_USAGE_ITEMS = 64


def as_api_error(error, collection=None):
    """The 422 ``ApiError`` for a ``ValidationError`` carrying a field, else the error itself.

    A batch ``create`` tags the failing row with ``liwan_index``; the field then reads ``<collection>.<i>.<field>``.
    """
    field = getattr(error, 'liwan_field', None)
    if field is None:
        return error
    index = getattr(error, 'liwan_index', None)
    if collection is not None and index is not None:
        field = f'{collection}.{index}.{field}'
    return ApiError(422, getattr(error, 'liwan_code', 'invalid'), str(error), field=field)


class AiController(http.Controller):

    @http.route('/api/v1/ai/tools', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        'liwan.ai.tool.registry', '_liwan_ai_feature_keys',
        keys=('registry:liwan.ai.tool.registry',), operation='read', match='any',
    )
    def list_tools(self, **_):
        request.env['liwan.entitlement.service'].require_read(AI_FEATURE)
        request.env['liwan.access.service']._liwan_require_capability(AI_USE)
        registry = request.env['liwan.ai.tool.registry']
        items = [dump_tool(item) for item in registry._liwan_ai_tools_for_user()]
        # tool_calls_per_run is enforced by the AI service/executor from this limits block, not by Odoo.
        return {'items': items, 'total': len(items), 'limits': registry._liwan_ai_limits()}

    @http.route('/api/v1/ai/audit', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(
        'liwan.ai.tool.registry', '_liwan_ai_feature_keys',
        keys=('registry:liwan.ai.tool.registry',), operation='write', match='any',
    )
    def record_audit(self, **payload):
        request.env['liwan.entitlement.service'].require(AI_FEATURE)
        request.env['liwan.access.service']._liwan_require_capability(AI_USE)
        Audit = request.env['liwan.ai.audit']
        try:
            row = Audit.create(payload)
        except ValidationError as error:
            raise as_api_error(error) from error
        entitlement = request.env['liwan.entitlement.service']
        return dump_audit_receipt(row, Audit._liwan_ai_count_messages(), entitlement._liwan_limit_value('ai.messages.monthly'))

    @http.route('/api/v1/ai/usage', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(
        'liwan.ai.tool.registry', '_liwan_ai_feature_keys',
        keys=('registry:liwan.ai.tool.registry',), operation='write', match='any',
    )
    def record_usage(self, **payload):
        request.env['liwan.entitlement.service'].require(AI_FEATURE)
        request.env['liwan.access.service']._liwan_require_capability(AI_USE)
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
            rows = request.env['liwan.ai.usage'].create(items)
        except ValidationError as error:
            raise as_api_error(error, 'items') from error
        return {'items': [dump_usage(row) for row in rows], 'total': len(rows)}
