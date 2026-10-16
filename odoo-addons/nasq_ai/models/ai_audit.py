# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from datetime import datetime, timezone

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from odoo.addons.nasq_ai.models.access_service import AI_USE
from odoo.addons.nasq_ai.models.tool_registry import TOOL_KINDS

AUDIT_KINDS = ('message', *TOOL_KINDS)
AUDIT_RESULTS = ('ok', 'denied', 'failed', 'proposed', 'approved', 'rejected')
DRAFT_RESULTS = ('proposed', 'approved', 'rejected')
WIRE_KEYS = frozenset({
    'conversation_id', 'kind', 'tool_name', 'input', 'result', 'http_status', 'draft', 'approved', 'attested',
})
SECRET_FRAGMENTS = ('password', 'passwd', 'token', 'secret', 'apikey', 'authorization', 'credential')
MAX_JSON_DEPTH = 8
MAX_JSON_BYTES = 32 * 1024


def is_secret_key(key):
    normalized = key.lower().replace('-', '').replace('_', '')
    return normalized == 'key' or any(fragment in normalized for fragment in SECRET_FRAGMENTS)


def scrub(value, depth=1):
    """Drop secret-looking keys anywhere in a JSON value; everything else is kept verbatim.

    Raises ``ValueError`` for a container nested deeper than ``MAX_JSON_DEPTH`` or a non-string key.
    """
    if not isinstance(value, (dict, list)):
        return value
    if depth > MAX_JSON_DEPTH:
        message = f'nesting deeper than {MAX_JSON_DEPTH} levels'
        raise ValueError(message)
    if isinstance(value, list):
        return [scrub(item, depth + 1) for item in value]
    if not all(isinstance(key, str) for key in value):
        message = 'keys must be strings'
        raise ValueError(message)
    return {key: scrub(item, depth + 1) for key, item in value.items() if not is_secret_key(key)}


class NasqAiAudit(models.Model):
    """One row per AI message, tool execution or draft decision, owned by its user.

    Written by the Nuxt executor as the user (``/api/v1/ai/audit``); never
    elevated. ``create`` is the single validation point. Record rules keep each
    user on their own rows, except content-free ``message`` rows which every
    employee of the company reads to count the monthly limit, and the access
    audit readers on their company.
    """
    _name = 'nasq.ai.audit'
    _description = 'Nasq AI audit'
    _order = 'id desc'
    _nasq_scope = 'company'

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
    def _nasq_ai_invalid(self, field, message):
        error = ValidationError(self.env._('%(message)s', message=message))
        error.nasq_field = field
        raise error

    @api.model
    def _nasq_ai_json(self, field, value):
        """A scrubbed JSON object within the depth and size caps, or ``None``."""
        if value is None:
            return None
        if not isinstance(value, dict):
            self._nasq_ai_invalid(field, f'{field} must be an object')
        try:
            cleaned = scrub(value)
            size = len(json.dumps(cleaned, ensure_ascii=False).encode())
        except (TypeError, ValueError) as error:
            self._nasq_ai_invalid(field, f'{field} is not valid JSON: {error}')
        if size > MAX_JSON_BYTES:
            self._nasq_ai_invalid(field, f'{field} must be at most {MAX_JSON_BYTES} bytes')
        return cleaned

    @api.model
    def _nasq_ai_prepare(self, values):
        """Validate one wire payload (contract ع4) and return the create values.

        Single choke point: ``create`` runs it for every row, so the route and a
        direct ORM create enforce the same rules. Raises ``ValidationError``
        with ``nasq_field`` for a bad value and ``AccessError`` when the user
        lacks the tool's capability or its feature is off.
        """
        invalid = self._nasq_ai_invalid
        unknown = set(values) - WIRE_KEYS
        if unknown:
            field = sorted(unknown)[0]
            invalid(field, f'field {field!r} is not accepted')
        conversation_id = values.get('conversation_id')
        if not isinstance(conversation_id, str) or not conversation_id or len(conversation_id) > 64:
            invalid('conversation_id', 'conversation_id must be a non-empty string of at most 64 characters')
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
            tool = self.env['nasq.ai.tool.registry']._nasq_ai_tool_map().get(tool_name)
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
        payload = {field: self._nasq_ai_json(field, values.get(field)) for field in ('input', 'draft', 'approved')}
        if tool is not None:
            if not self.env['nasq.access.service']._nasq_has_capability(self.env.user, tool['capability']):
                raise AccessError(self.env._('You do not have access to the tool %(tool)s.', tool=tool_name))
            if not self.env['nasq.entitlement.service']._nasq_feature_read(tool['feature_key']):
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
        self.env['nasq.entitlement.service'].require('ai.enabled')
        self.env['nasq.access.service']._nasq_require_capability(AI_USE)
        rows = [self._nasq_ai_prepare(values) for values in vals_list]
        messages = sum(row['kind'] == 'message' for row in rows)
        if messages:
            # Serialize concurrent senders on the tenant row so the limit cannot be passed by a race.
            entitlement = self.env['nasq.entitlement.service']
            entitlement._nasq_profile()._nasq_lock()
            entitlement.require_within_limit('ai.messages.monthly', self._nasq_ai_count_messages() + messages)
        return super().create(rows)

    @api.model
    def _nasq_ai_record(self, values):
        return self.create(values)

    @api.model
    def _nasq_ai_month_start(self):
        now = datetime.now(timezone.utc)
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

    @api.model
    def _nasq_ai_count_messages(self, company=None):
        """Message rows of ``company`` (default: current) since the start of this UTC month."""
        company = company or self.env.company
        return self.search_count([
            ('company_id', '=', company.id),
            ('kind', '=', 'message'),
            ('create_date', '>=', self._nasq_ai_month_start()),
        ])
