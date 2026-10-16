# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.webvue_ai.models.access_service import AI_USE
from odoo.addons.webvue_ai.serializers.audit import dump_audit_receipt
from odoo.addons.webvue_ai.serializers.tool import dump_tool
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_registered_feature,
)

AI_FEATURE = 'ai.enabled'


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
            field = getattr(error, 'webvue_field', None)
            if field is None:
                raise
            raise ApiError(422, getattr(error, 'webvue_code', 'invalid'), str(error), field=field) from error
        entitlement = request.env['webvue.entitlement.service']
        return dump_audit_receipt(row, Audit._webvue_ai_count_messages(), entitlement._webvue_limit_value('ai.messages.monthly'))
