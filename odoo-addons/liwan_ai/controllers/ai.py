# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import LockError, ValidationError
from odoo.http import request

from odoo.addons.liwan_ai.models.access_service import AI_USAGE_RECORD, AI_USE
from odoo.addons.liwan_ai.models.ai_usage import USAGE_SERVICE_PATH
from odoo.addons.liwan_ai.models.tool_registry import MODE_AGENTS
from odoo.addons.liwan_ai.serializers.audit import dump_audit_receipt
from odoo.addons.liwan_ai.serializers.tool import dump_agent, dump_tool
from odoo.addons.liwan_ai.serializers.usage import dump_usage
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)

AI_FEATURE = 'ai.enabled'
MAX_USAGE_ITEMS = 64


def as_api_error(error, collection=None):
    """The ``ApiError`` (422, or the error's own ``liwan_status`` such as 409) for a ``ValidationError`` carrying a field, else the error itself.

    A batch ``create`` tags the failing row with ``liwan_index``; the field then reads ``<collection>.<i>.<field>``.
    """
    field = getattr(error, 'liwan_field', None)
    if field is None:
        return error
    index = getattr(error, 'liwan_index', None)
    if collection is not None and index is not None:
        field = f'{collection}.{index}.{field}'
    return ApiError(getattr(error, 'liwan_status', 422), getattr(error, 'liwan_code', 'invalid'), str(error), field=field)


class AiController(http.Controller):

    @http.route('/api/v1/ai/tools', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(AI_FEATURE, operation='read')
    def list_tools(self, **_):
        request.env['liwan.access.service']._liwan_require_capability(AI_USE)
        mode = request.httprequest.args.get('mode')
        if mode is not None and mode not in MODE_AGENTS:
            raise ApiError(422, 'invalid', f"mode must be one of {', '.join(MODE_AGENTS)} or absent", field='mode')
        registry = request.env['liwan.ai.tool.registry']
        tools = registry._liwan_ai_tools_for_user(mode=mode)
        items = [dump_tool(item) for item in tools]
        agents = [dump_agent(item) for item in registry._liwan_ai_agents_for_user(tools)]
        # tool_calls_per_run is enforced by the AI service/executor from this limits block, not by Odoo.
        return {
            'items': items, 'total': len(items), 'agents': agents, 'limits': registry._liwan_ai_limits(),
            'blocked_fields': registry._liwan_ai_blocked_fields(),
        }

    @http.route('/api/v1/ai/conversations/<string:conversation_id>/mode', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(AI_FEATURE, operation='read')
    def conversation_mode(self, conversation_id, **_):
        """The mode a conversation of the caller started in, so a continued message keeps it whatever the browser says."""
        request.env['liwan.access.service']._liwan_require_capability(AI_USE)
        return {'mode': request.env['liwan.ai.audit']._liwan_ai_conversation_mode(conversation_id)}

    @http.route('/api/v1/ai/audit', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    def record_audit(self, **payload):
        request.env['liwan.access.service']._liwan_require_capability(AI_USE)
        Audit = request.env['liwan.ai.audit']
        try:
            row = Audit.create(payload)
        except ValidationError as error:
            raise as_api_error(error) from error
        entitlement = request.env['liwan.entitlement.service']
        return dump_audit_receipt(row, Audit._liwan_ai_count_messages(), entitlement._liwan_limit_value('ai.messages.monthly'))

    # Two routes carry one fact (a run's usage rows) while the shared SaaS registry has no per-tenant recorder key. This session
    # route is the fallback for those deployments and for a run reported without the key. REMOVE IT, with the cookie spool in
    # apps/web/server/utils/ai/usage.ts and `create`'s session branch, in the change that delivers that key (tracked in #557);
    # record_usage_service below is then the only path.
    @http.route('/api/v1/ai/usage', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    def record_usage(self, **payload):
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

    @http.route(USAGE_SERVICE_PATH, type='json2', auth='bearer', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    @requires_capability(AI_USAGE_RECORD)
    def record_usage_service(self, **payload):
        """Record the usage rows of a finished run for the user who made the calls, without that user's session.

        Two checks, both required: the caller holds ``ai.usage.record`` AND is the recorder account itself
        (``liwan_ai.user_ai_usage``). The capability alone is not enough, because liwan_core gives the superuser and
        vendor support every capability and liwan_core must not name an application's capability; the identity check
        is what keeps any other key (an administrator's, a vendor-support user's) out. The browser never reaches this
        route. The rows belong to ``user_id`` in ``user_company_id``, validated by the model. The company has its own
        field name because ``company_id`` in a payload is the platform's "which company do you write in" guard,
        which the recorder (a member of every company) must not be pinned by.
        """
        if request.env.user.id != request.env['liwan.access.service']._liwan_usage_recorder_id():
            raise ApiError(403, 'forbidden', 'this route is for the usage recorder account only')
        unknown = sorted(set(payload) - {'items', 'user_id', 'user_company_id'})
        if unknown:
            raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])
        for name in ('user_id', 'user_company_id'):
            if name not in payload:
                raise ApiError(422, 'invalid', f'{name} is required', field=name)
        items = payload.get('items')
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_USAGE_ITEMS:
            raise ApiError(422, 'invalid', f'items must be a list of 1 to {MAX_USAGE_ITEMS} objects', field='items')
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise ApiError(422, 'invalid', 'each item must be an object', field=f'items.{index}')
        Usage = request.env['liwan.ai.usage']
        # Admission and insertion are one critical section per recorder: the row budget below is read before the rows are
        # written, so two parallel requests would each see the same remaining budget. The recorder's own user row is locked
        # through the ORM until this transaction ends; a request that cannot get it is refused at once (the lock skips, it
        # never waits, so nothing queues or deadlocks) and `web` retries it. ``allow_referencing`` is a FOR NO KEY UPDATE lock:
        # the rows inserted here reference this user (create_uid) and the API key lookup reads it, and neither is blocked.
        try:
            request.env.user.lock_for_update(allow_referencing=True)
        except LockError:
            raise ApiError(429, 'rate_limited', 'another usage report is being recorded', details={'retry_after_seconds': 1}) from None
        admission = Usage._liwan_ai_admission(items)
        if admission == 'too_large':
            # Not a matter of waiting: the request alone is above the per-minute token ceiling, so it must be split.
            raise ApiError(422, 'invalid', 'a request must not report more tokens than the per-minute ceiling; split it', field='items')
        if admission == 'rate_limited':
            raise ApiError(429, 'rate_limited', 'too many usage rows or tokens in the last minute', details={'retry_after_seconds': 60})
        try:
            rows = Usage._liwan_ai_record_for(items, payload['user_id'], payload['user_company_id'])
        except ValidationError as error:
            raise as_api_error(error, 'items') from error
        return {'items': [dump_usage(row) for row in rows], 'total': len(rows)}
