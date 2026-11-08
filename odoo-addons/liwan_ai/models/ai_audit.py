# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import math
from datetime import datetime, timezone

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from odoo.addons.liwan_ai.models.access_service import AI_USE
from odoo.addons.liwan_ai.models.agent_registry import CORE_AGENT
from odoo.addons.liwan_ai.models.tool_registry import ASSIST_KINDS, TOOL_KINDS
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

# A user message of an ordinary conversation, or of a setup or help conversation (counted against the vendor's assistance budget).
MESSAGE_KINDS = ('message', *ASSIST_KINDS)
AUDIT_KINDS = (*MESSAGE_KINDS, *TOOL_KINDS)
MONTHLY_MESSAGES = 'ai.messages.monthly'
ASSIST_MONTHLY = 'ai.assist.monthly'
MONTHLY_TOKENS = 'ai.tokens.monthly'
PER_USER_MESSAGES = 'ai.messages.per_user_monthly'
AUDIT_RESULTS = ('ok', 'denied', 'failed', 'proposed', 'approved', 'rejected')
DRAFT_RESULTS = ('proposed', 'approved', 'rejected')
WIRE_KEYS = frozenset({
    'conversation_id', 'kind', 'agent', 'tool_name', 'input', 'result', 'http_status', 'draft', 'approved',
})
SECRET_FRAGMENTS = ('password', 'passwd', 'token', 'secret', 'apikey', 'authorization', 'credential')
NUL = '\x00'
MAX_JSON_DEPTH = 8
MAX_JSON_BYTES = 32 * 1024
MAX_CONVERSATION_ID = 64
CONVERSATION_ID_MESSAGE = (
    f'conversation_id must be a non-empty string of at most {MAX_CONVERSATION_ID} characters, without NUL'
)


def is_conversation_id(value):
    return isinstance(value, str) and 0 < len(value) <= MAX_CONVERSATION_ID and NUL not in value


def raise_invalid(env, field, message, code='invalid'):
    """Raise the ``ValidationError`` that the route maps to a 422 carrying ``field`` and ``code``."""
    error = ValidationError(env._('%(message)s', message=message))
    error.liwan_field = field
    error.liwan_code = code
    raise error


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


class LiwanAiAudit(models.Model):
    """One row per AI message, tool execution or draft decision, owned by its user.

    Written by the Nuxt executor as the user (``/api/v1/ai/audit``); never
    elevated. ``create`` is the single validation point. Record rules keep each
    user on their own rows, plus the access audit readers on their company. The
    monthly message limit is counted by SQL over the whole tenant, so it needs
    no read access to other users' rows; ``message`` rows carry no content.
    """
    _name = 'liwan.ai.audit'
    _description = 'LiwanOS AI audit'
    _order = 'id desc'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade',
                              default=lambda self: self.env.user)
    conversation_id = fields.Char(required=True, index=True)
    kind = fields.Selection([(kind, kind) for kind in AUDIT_KINDS], required=True, index=True)
    # The agent that was active when the tool ran (spec 2026-11-04 §6.9 monitoring); none on a message row.
    agent_key = fields.Char(index=True)
    tool_name = fields.Char(index=True)
    input = fields.Json()
    result = fields.Selection([(result, result) for result in AUDIT_RESULTS], required=True, index=True)
    http_status = fields.Integer()
    draft = fields.Json()
    approved = fields.Json()
    attested_at = fields.Datetime()

    @api.model
    def _liwan_ai_invalid(self, field, message, code='invalid'):
        raise_invalid(self.env, field, message, code)

    @api.model
    def _liwan_ai_json(self, field, value):
        """A scrubbed JSON object within the depth and size caps, or ``None``."""
        if value is None:
            return None
        if not isinstance(value, dict):
            self._liwan_ai_invalid(field, f'{field} must be an object')
        try:
            cleaned = scrub(value)
            size = len(json.dumps(cleaned, ensure_ascii=False).encode())
        except (TypeError, ValueError) as error:
            self._liwan_ai_invalid(field, f'{field} is not valid JSON: {error}')
        if size > MAX_JSON_BYTES:
            self._liwan_ai_invalid(field, f'{field} must be at most {MAX_JSON_BYTES} bytes')
        return cleaned

    @api.model
    def _liwan_ai_prepare(self, values):
        """Validate one wire payload (contract ع4) and return the create values.

        Single choke point: ``create`` runs it for every row, so the route and a
        direct ORM create enforce the same rules. Raises ``ValidationError``
        with ``liwan_field`` for a bad value and ``AccessError`` when the user
        lacks the tool's capability or its feature is off.
        """
        invalid = self._liwan_ai_invalid
        unknown = set(values) - WIRE_KEYS
        if unknown:
            field = sorted(unknown)[0]
            self._liwan_ai_invalid(field, f'field {field!r} is not accepted', code='unknown_field')
        conversation_id = values.get('conversation_id')
        if not is_conversation_id(conversation_id):
            invalid('conversation_id', CONVERSATION_ID_MESSAGE)
        kind = values.get('kind')
        if not isinstance(kind, str) or kind not in AUDIT_KINDS:
            invalid('kind', f'kind must be one of {AUDIT_KINDS}')
        result = values.get('result')
        if not isinstance(result, str) or result not in AUDIT_RESULTS:
            invalid('result', f'result must be one of {AUDIT_RESULTS}')
        tool_name = values.get('tool_name')
        http_status = values.get('http_status')
        if http_status is not None and (not isinstance(http_status, int) or isinstance(http_status, bool) or not 100 <= http_status <= 599):
            invalid('http_status', 'http_status must be an HTTP status code')
        tool = None
        agent = values.get('agent')
        if kind in MESSAGE_KINDS:
            for field in ('agent', 'tool_name', 'input', 'draft', 'approved', 'http_status'):
                if values.get(field) is not None:
                    invalid(field, f'a message audit has no {field}')
            if result != 'ok':
                invalid('result', 'a message audit result is ok')
        else:
            if not isinstance(tool_name, str):
                invalid('tool_name', 'tool_name must be a registered tool name')
            tool = self.env['liwan.ai.tool.registry']._liwan_ai_tool_map().get(tool_name)
            if tool is None:
                invalid('tool_name', f'unknown tool {tool_name!r}')
            if tool['kind'] != kind:
                invalid('kind', f'tool {tool_name} is of kind {tool["kind"]}')
            agents = self.env['liwan.ai.agent.registry']._liwan_ai_agent_map()
            if agent != CORE_AGENT and agent not in agents:
                invalid('agent', 'agent must be a registered agent or core')
        if kind == 'draft' and result not in DRAFT_RESULTS:
            invalid('result', f'a draft result must be one of {DRAFT_RESULTS}')
        if kind != 'draft' and result in DRAFT_RESULTS:
            invalid('result', f'result {result} is only valid for a draft')
        if result == 'approved' and not isinstance(values.get('approved'), dict):
            invalid('approved', 'an approved draft carries the approved payload')
        payload = {field: self._liwan_ai_json(field, values.get(field)) for field in ('input', 'draft', 'approved')}
        if tool is not None:
            if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, tool['capability']):
                raise AccessError(self.env._('You do not have access to the tool %(tool)s.', tool=tool_name))
            # A tool of an application the tenant does not have is refused like that application's own routes.
            self.env['liwan.entitlement.service'].require_read(tool['feature_key'])
        return {
            'company_id': self.env.company.id,
            'user_id': self.env.user.id,
            'conversation_id': conversation_id,
            'kind': kind,
            'agent_key': agent if kind not in MESSAGE_KINDS else False,
            'tool_name': tool_name,
            'result': result,
            'http_status': http_status,
            # The server stamps the acknowledgement, never the caller (issue #556): an `approved` draft is approved by the
            # session that recorded it, at this transaction's time.
            'attested_at': fields.Datetime.now() if result == 'approved' else False,
            **payload,
        }

    @api.model_create_multi
    def create(self, vals_list):
        # The single choke point: the route and a direct /json/2 create obey the same feature gate.
        self.env['liwan.entitlement.service'].require('ai.enabled')
        self.env['liwan.access.service']._liwan_require_capability(AI_USE)
        rows = [self._liwan_ai_prepare(values) for values in vals_list]
        messages = sum(row['kind'] == 'message' for row in rows)
        setup = sum(row['kind'] == 'setup' for row in rows)
        assist = setup + sum(row['kind'] == 'help' for row in rows)
        self._liwan_ai_check_mode(rows)
        if setup and not self.env['liwan.ai.setting.registry']._liwan_ai_manageable():
            # The free setup agent serves those who may change a setting; it is no general chat for everyone.
            raise AccessError(self.env._('You may not change any setting, so the setup assistant has nothing to do for you.'))
        if assist:
            # The free agents run outside the package's message and token limits, against the vendor's one assistance budget.
            entitlement = self.env['liwan.entitlement.service']
            if entitlement._liwan_limit_value(ASSIST_MONTHLY) is not None:
                entitlement._liwan_profile()._liwan_bump_quota_revision()
            entitlement.require_within_limit(ASSIST_MONTHLY, self._liwan_ai_count_messages(kinds=ASSIST_KINDS) + assist)
        if messages:
            entitlement = self.env['liwan.entitlement.service']
            settings = self.env['liwan.ai.settings']._liwan_current()
            platform_run = settings.provider_mode == 'platform'
            capped = bool(settings.messages_per_user_monthly) or entitlement._liwan_limit_value(MONTHLY_MESSAGES) is not None or (
                platform_run and entitlement._liwan_limit_value(MONTHLY_TOKENS) is not None
            )
            if capped:
                # An exact cap. Odoo runs REPEATABLE READ, so a lock alone would let a sender that waited count
                # from a snapshot older than the winner's commit. Writing the tenant's quota fence before the
                # count makes such a sender fail serialization instead; Odoo then retries its whole request on
                # fresh data, which already holds the winner's row. Unlimited tenants skip the fence. Known limit:
                # Odoo retries a request five times, so a burst of more concurrent capped messages for one tenant
                # (or ones racing other quota claims) can still end in a server error; each transaction is short.
                entitlement._liwan_profile()._liwan_bump_quota_revision()
            entitlement.require_within_limit(MONTHLY_MESSAGES, self._liwan_ai_count_messages() + messages)
            per_user = settings.messages_per_user_monthly
            if per_user and self._liwan_ai_count_messages(self.env.user) + messages > per_user:
                # The administrator's narrowing of the package limit (spec 2026-11-04 §6.7), refused like that limit.
                code = 'feature_not_included'
                raise LiwanAccessRule(
                    code, 'your monthly assistant messages are used up', status=403,
                    details={'reason': 'limit', 'limit_key': PER_USER_MESSAGES},
                )
            if platform_run:
                # A run starts only while the month's platform tokens are below the limit, so a tenant passes it by
                # at most the one run that crossed it (spec 2026-11-04 §6.8). A tenant key pays its own provider.
                entitlement.require_within_limit(MONTHLY_TOKENS, self.env['liwan.ai.usage']._liwan_platform_tokens_used() + 1)
        return super().create(rows)

    @api.model
    def _liwan_ai_check_mode(self, rows):
        """A conversation keeps the mode it started in: a setup or help conversation never takes a message of another
        mode, nor an ordinary one theirs, so no budget can pay for another mode's conversation."""
        for row in rows:
            if row['kind'] not in MESSAGE_KINDS:
                continue
            others = [kind for kind in MESSAGE_KINDS if kind != row['kind']]
            self.env.cr.execute(
                'SELECT 1 FROM liwan_ai_audit WHERE conversation_id = %s AND kind = ANY(%s) LIMIT 1', [row['conversation_id'], others],
            )
            if self.env.cr.fetchone():
                raise_invalid(self.env, 'kind', 'this conversation belongs to the other mode', code='mode_mismatch')

    @api.model
    def _liwan_ai_conversation_mode(self, conversation_id):
        """``setup``, ``help``, ``assistant`` or None for a conversation of the caller, from their own message rows."""
        rows = self.search([('conversation_id', '=', conversation_id), ('user_id', '=', self.env.uid), ('kind', 'in', MESSAGE_KINDS)], limit=1)
        return None if not rows else (rows.kind if rows.kind in ASSIST_KINDS else 'assistant')

    @api.model
    def _liwan_ai_month_start(self):
        now = datetime.now(timezone.utc)
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

    @api.model
    def _liwan_ai_count_messages(self, user=None, kinds=('message',)):
        """Message rows (``message``, or ``kinds`` such as the free agents' ``setup`` and ``help``) of the whole tenant
        since the start of this UTC month.

        The monthly limit belongs to the one tenant profile, so the count spans every company and
        user. It is plain SQL on this table (no ORM read access to other users' rows). It feeds
        ``limits.messages_used`` and the limit check only, never ``_liwan_count_usage``: a rolling
        monthly flow must not block a plan change as stock usage would.
        """
        query = 'SELECT count(*) FROM liwan_ai_audit WHERE kind = ANY(%s) AND create_date >= %s'
        params = [list(kinds), self._liwan_ai_month_start()]
        if user is not None:
            query += ' AND user_id = %s'
            params.append(user.id)
        self.env.cr.execute(query, params)
        return self.env.cr.fetchone()[0]
