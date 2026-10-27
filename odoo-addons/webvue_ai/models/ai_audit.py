# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import math
from datetime import datetime, timezone

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from odoo.addons.webvue_ai.models.access_service import AI_USE
from odoo.addons.webvue_ai.models.tool_registry import TOOL_KINDS

AUDIT_KINDS = ('message', *TOOL_KINDS)
MONTHLY_MESSAGES = 'ai.messages.monthly'
AUDIT_RESULTS = ('ok', 'denied', 'failed', 'proposed', 'approved', 'rejected')
DRAFT_RESULTS = ('proposed', 'approved', 'rejected')
WIRE_KEYS = frozenset({
    'conversation_id', 'kind', 'tool_name', 'input', 'result', 'http_status', 'draft', 'approved', 'attested',
})
SECRET_FRAGMENTS = ('password', 'passwd', 'token', 'secret', 'apikey', 'authorization', 'credential')
NUL = '\x00'
MAX_JSON_DEPTH = 8
MAX_JSON_BYTES = 32 * 1024


def is_secret_key(key):
    normalized = key.lower().replace('-', '').replace('_', '')
    return normalized == 'key' or any(fragment in normalized for fragment in SECRET_FRAGMENTS)


def check_scalar(value):
    if isinstance(value, str) and NUL in value:
        message = 'NUL characters are not allowed'
        raise ValueError(message)
    if isinstance(value, float) and not math.isfinite(value):
        message = 'numbers must be finite'
        raise ValueError(message)
    return value


def scrub(value, depth=1):
    """Drop secret-looking keys anywhere in a JSON value; everything else is kept verbatim.

    Raises ``ValueError`` for a container nested deeper than ``MAX_JSON_DEPTH``, a non-string key,
    a NUL character in a key or string (PostgreSQL cannot store it) or a non-finite number.
    """
    if not isinstance(value, (dict, list)):
        return check_scalar(value)
    if depth > MAX_JSON_DEPTH:
        message = f'nesting deeper than {MAX_JSON_DEPTH} levels'
        raise ValueError(message)
    if isinstance(value, list):
        return [scrub(item, depth + 1) for item in value]
    if not all(isinstance(key, str) for key in value):
        message = 'keys must be strings'
        raise ValueError(message)
    for key in value:
        check_scalar(key)
    return {key: scrub(item, depth + 1) for key, item in value.items() if not is_secret_key(key)}


class WebVueAiAudit(models.Model):
    """One row per AI message, tool execution or draft decision, owned by its user.

    Written by the Nuxt executor as the user (``/api/v1/ai/audit``); never
    elevated. ``create`` is the single validation point. Record rules keep each
    user on their own rows, plus the access audit readers on their company. The
    monthly message limit is counted by SQL over the whole tenant, so it needs
    no read access to other users' rows; ``message`` rows carry no content.
    """
    _name = 'webvue.ai.audit'
    _description = 'WebVue AI audit'
    _order = 'id desc'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade',
                              default=lambda self: self.env.user)
    conversation_id = fields.Char(required=True, index=True)
    kind = fields.Selection([(kind, kind) for kind in AUDIT_KINDS], required=True, index=True)
    tool_name = fields.Char(index=True)
    input = fields.Json()
    result = fields.Selection([(result, result) for result in AUDIT_RESULTS], required=True, index=True)
    http_status = fields.Integer()
    draft = fields.Json()
    approved = fields.Json()
    attested_at = fields.Datetime()

    @api.model
    def _webvue_ai_invalid(self, field, message, code='invalid'):
        error = ValidationError(self.env._('%(message)s', message=message))
        error.webvue_field = field
        error.webvue_code = code
        raise error

    @api.model
    def _webvue_ai_json(self, field, value):
        """A scrubbed JSON object within the depth and size caps, or ``None``."""
        if value is None:
            return None
        if not isinstance(value, dict):
            self._webvue_ai_invalid(field, f'{field} must be an object')
        try:
            cleaned = scrub(value)
            size = len(json.dumps(cleaned, ensure_ascii=False).encode())
        except (TypeError, ValueError) as error:
            self._webvue_ai_invalid(field, f'{field} is not valid JSON: {error}')
        if size > MAX_JSON_BYTES:
            self._webvue_ai_invalid(field, f'{field} must be at most {MAX_JSON_BYTES} bytes')
        return cleaned

    @api.model
    def _webvue_ai_prepare(self, values):
        """Validate one wire payload (contract ع4) and return the create values.

        Single choke point: ``create`` runs it for every row, so the route and a
        direct ORM create enforce the same rules. Raises ``ValidationError``
        with ``webvue_field`` for a bad value and ``AccessError`` when the user
        lacks the tool's capability or its feature is off.
        """
        invalid = self._webvue_ai_invalid
        unknown = set(values) - WIRE_KEYS
        if unknown:
            field = sorted(unknown)[0]
            self._webvue_ai_invalid(field, f'field {field!r} is not accepted', code='unknown_field')
        conversation_id = values.get('conversation_id')
        if not isinstance(conversation_id, str) or not conversation_id or len(conversation_id) > 64 or NUL in conversation_id:
            invalid('conversation_id', 'conversation_id must be a non-empty string of at most 64 characters, without NUL')
        kind = values.get('kind')
        if not isinstance(kind, str) or kind not in AUDIT_KINDS:
            invalid('kind', f'kind must be one of {AUDIT_KINDS}')
        result = values.get('result')
        if not isinstance(result, str) or result not in AUDIT_RESULTS:
            invalid('result', f'result must be one of {AUDIT_RESULTS}')
        attested = values.get('attested', False)
        if not isinstance(attested, bool):
            invalid('attested', 'attested must be a boolean')
        tool_name = values.get('tool_name')
        http_status = values.get('http_status')
        if http_status is not None and (not isinstance(http_status, int) or isinstance(http_status, bool) or not 100 <= http_status <= 599):
            invalid('http_status', 'http_status must be an HTTP status code')
        tool = None
        if kind == 'message':
            for field in ('tool_name', 'input', 'draft', 'approved', 'http_status'):
                if values.get(field) is not None:
                    invalid(field, f'a message audit has no {field}')
            if attested:
                invalid('attested', 'a message audit is not attested')
            if result != 'ok':
                invalid('result', 'a message audit result is ok')
        else:
            if not isinstance(tool_name, str):
                invalid('tool_name', 'tool_name must be a registered tool name')
            tool = self.env['webvue.ai.tool.registry']._webvue_ai_tool_map().get(tool_name)
            if tool is None:
                invalid('tool_name', f'unknown tool {tool_name!r}')
            if tool['kind'] != kind:
                invalid('kind', f'tool {tool_name} is of kind {tool["kind"]}')
        if kind == 'draft' and result not in DRAFT_RESULTS:
            invalid('result', f'a draft result must be one of {DRAFT_RESULTS}')
        if kind != 'draft' and result in DRAFT_RESULTS:
            invalid('result', f'result {result} is only valid for a draft')
        if result == 'approved' and not attested:
            invalid('attested', 'an approved draft needs the user attestation')
        if result == 'approved' and not isinstance(values.get('approved'), dict):
            invalid('approved', 'an approved draft carries the approved payload')
        payload = {field: self._webvue_ai_json(field, values.get(field)) for field in ('input', 'draft', 'approved')}
        if tool is not None:
            if not self.env['webvue.access.service']._webvue_has_capability(self.env.user, tool['capability']):
                raise AccessError(self.env._('You do not have access to the tool %(tool)s.', tool=tool_name))
            if not self.env['webvue.entitlement.service']._webvue_feature_read(tool['feature_key']):
                raise AccessError(self.env._('The feature of the tool %(tool)s is not available.', tool=tool_name))
        return {
            'company_id': self.env.company.id,
            'user_id': self.env.user.id,
            'conversation_id': conversation_id,
            'kind': kind,
            'tool_name': tool_name,
            'result': result,
            'http_status': http_status,
            'attested_at': fields.Datetime.now() if attested else False,
            **payload,
        }

    @api.model_create_multi
    def create(self, vals_list):
        # The single choke point: the route and a direct /json/2 create obey the same feature gate.
        self.env['webvue.entitlement.service'].require('ai.enabled')
        self.env['webvue.access.service']._webvue_require_capability(AI_USE)
        rows = [self._webvue_ai_prepare(values) for values in vals_list]
        messages = sum(row['kind'] == 'message' for row in rows)
        if messages:
            entitlement = self.env['webvue.entitlement.service']
            if entitlement._webvue_limit_value(MONTHLY_MESSAGES) is not None:
                # An exact cap. Odoo runs REPEATABLE READ, so a lock alone would let a sender that waited count
                # from a snapshot older than the winner's commit. Writing the tenant's quota fence before the
                # count makes such a sender fail serialization instead; Odoo then retries its whole request on
                # fresh data, which already holds the winner's row. Unlimited tenants skip the fence.
                entitlement._webvue_profile()._webvue_bump_quota_revision()
            entitlement.require_within_limit(MONTHLY_MESSAGES, self._webvue_ai_count_messages() + messages)
        return super().create(rows)

    @api.model
    def _webvue_ai_month_start(self):
        now = datetime.now(timezone.utc)
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

    @api.model
    def _webvue_ai_count_messages(self):
        """Message rows of the whole tenant since the start of this UTC month.

        The monthly limit belongs to the one tenant profile, so the count spans every company and
        user. It is plain SQL on this table (no ORM read access to other users' rows). It feeds
        ``limits.messages_used`` and the limit check only, never ``_webvue_count_usage``: a rolling
        monthly flow must not block a plan change as stock usage would.
        """
        self.env.cr.execute(
            "SELECT count(*) FROM webvue_ai_audit WHERE kind = 'message' AND create_date >= %s",
            [self._webvue_ai_month_start()],
        )
        return self.env.cr.fetchone()[0]
