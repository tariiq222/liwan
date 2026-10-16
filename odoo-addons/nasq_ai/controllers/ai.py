# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.nasq_ai.models.access_service import AI_USE
from odoo.addons.nasq_ai.serializers.audit import dump_audit_receipt
from odoo.addons.nasq_ai.serializers.tool import dump_tool
from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    requires_registered_feature,
)

AI_FEATURE = 'ai.enabled'
AUDIT_FIELDS = {'conversation_id', 'kind', 'tool_name', 'input', 'result', 'http_status', 'draft', 'approved', 'attested'}


class AiController(http.Controller):

    @http.route('/api/v1/ai/tools', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        'nasq.ai.tool.registry', '_nasq_ai_feature_keys',
        keys=('registry:nasq.ai.tool.registry',), operation='read', match='any',
    )
    def list_tools(self, **_):
        request.env['nasq.entitlement.service'].require_read(AI_FEATURE)
        request.env['nasq.access.service']._nasq_require_capability(AI_USE)
        registry = request.env['nasq.ai.tool.registry']
        items = [dump_tool(item) for item in registry._nasq_ai_tools_for_user()]
        # tool_calls_per_run is enforced by the AI service/executor from this limits block, not by Odoo.
        return {'items': items, 'total': len(items), 'limits': registry._nasq_ai_limits()}

    @http.route('/api/v1/ai/audit', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(
        'nasq.ai.tool.registry', '_nasq_ai_feature_keys',
        keys=('registry:nasq.ai.tool.registry',), operation='write', match='any',
    )
    def record_audit(self, **payload):
        request.env['nasq.entitlement.service'].require(AI_FEATURE)
        request.env['nasq.access.service']._nasq_require_capability(AI_USE)
        unknown = set(payload) - AUDIT_FIELDS
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not accepted", field=field)
        Audit = request.env['nasq.ai.audit']
        try:
            row = Audit._nasq_ai_record(payload)
        except ValidationError as error:
            field = getattr(error, 'nasq_field', None)
            if field is None:
                raise
            raise ApiError(422, 'invalid', str(error), field=field) from error
        entitlement = request.env['nasq.entitlement.service']
        return dump_audit_receipt(row, Audit._nasq_ai_count_messages(), entitlement._nasq_limit_value('ai.messages.monthly'))
