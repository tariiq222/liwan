# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import datetime, timedelta, timezone

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from odoo.addons.liwan_ai.models.access_service import AI_USE
from odoo.addons.liwan_ai.models.ai_audit import (
    CONVERSATION_ID_MESSAGE,
    is_conversation_id,
    raise_invalid,
)

USAGE_KINDS = ('plan', 'title')
USAGE_OUTCOMES = ('ok', 'failed', 'retried', 'aborted')
WIRE_KEYS = frozenset({
    'conversation_id', 'kind', 'provider', 'model', 'outcome', 'input_tokens', 'output_tokens', 'called_at',
})
PROVIDER_PATTERN = re.compile(r'[a-z][a-z0-9_-]{0,31}')
CONTROL_CHARACTERS = re.compile(r'[\x00-\x1f\x7f-\x9f]')
MAX_MODEL_LENGTH = 128
MAX_TOKENS = 100_000_000
FUTURE_TOLERANCE = timedelta(minutes=5)
# RFC 3339 with an offset, the same instants the zod contract's iso datetime({offset: true}) accepts.
RFC3339 = re.compile(
    r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-])(\d{2}):(\d{2}))',
)


def is_token_count(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_TOKENS


def parse_called_at(value):
    """The UTC instant of an RFC 3339 string with an offset, or ``None`` for anything else."""
    match = RFC3339.fullmatch(value) if isinstance(value, str) else None
    if not match:
        return None
    year, month, day, hour, minute, second, fraction, sign, offset_hours, offset_minutes = match.groups()
    offset = timedelta(hours=int(offset_hours or 0), minutes=int(offset_minutes or 0))
    try:
        local = datetime(
            int(year), int(month), int(day), int(hour), int(minute), int(second or 0),
            int((fraction or '0')[:6].ljust(6, '0')),
            tzinfo=timezone(-offset if sign == '-' else offset),
        )
        return local.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        # A calendar-invalid value, an offset of 24 hours or more, or an instant outside the range in UTC.
        return None


class LiwanAiUsage(models.Model):
    """One row per AI provider call, owned by the user who made it.

    Written by the Nuxt executor as the user (``/api/v1/ai/usage``); never
    elevated. The calls already happened, so ``create`` applies no limit: it
    only validates and derives the owner. Record rules mirror the audit's: each
    user sees their own rows, the access audit readers see their company's.
    """
    _name = 'liwan.ai.usage'
    _description = 'LiwanOS AI usage'
    _order = 'called_at desc, id desc'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade',
                              default=lambda self: self.env.user)
    conversation_id = fields.Char(required=True, index=True)
    kind = fields.Selection([(kind, kind) for kind in USAGE_KINDS], required=True)
    provider = fields.Char(required=True)
    model = fields.Char(required=True)
    outcome = fields.Selection([(outcome, outcome) for outcome in USAGE_OUTCOMES], required=True)
    input_tokens = fields.Integer()
    output_tokens = fields.Integer()
    tokens_reported = fields.Boolean()
    called_at = fields.Datetime(required=True, index=True)

    # The own-rows rule filters on user_id and orders by called_at; a monthly per-user sum reads the same.
    _user_called_at_idx = models.Index('(user_id, called_at)')

    @api.model
    def _liwan_ai_prepare(self, values):
        """Validate one wire payload and return the create values.

        Raises ``ValidationError`` with ``liwan_field`` for a bad value.
        """
        def invalid(field, message, code='invalid'):
            raise_invalid(self.env, field, message, code)

        if not isinstance(values, dict):
            invalid('items', 'each item must be an object')
        unknown = set(values) - WIRE_KEYS
        if unknown:
            field = sorted(unknown)[0]
            invalid(field, f'field {field!r} is not accepted', code='unknown_field')
        missing = sorted(WIRE_KEYS - set(values))
        if missing:
            invalid(missing[0], f'{missing[0]} is required')
        conversation_id = values['conversation_id']
        if not is_conversation_id(conversation_id):
            invalid('conversation_id', CONVERSATION_ID_MESSAGE)
        kind = values['kind']
        if not isinstance(kind, str) or kind not in USAGE_KINDS:
            invalid('kind', f'kind must be one of {USAGE_KINDS}')
        provider = values['provider']
        if not isinstance(provider, str) or not PROVIDER_PATTERN.fullmatch(provider):
            invalid('provider', f'provider must match {PROVIDER_PATTERN.pattern}')
        model = values['model']
        if not isinstance(model, str) or not 0 < len(model) <= MAX_MODEL_LENGTH or CONTROL_CHARACTERS.search(model):
            invalid('model', f'model must be 1 to {MAX_MODEL_LENGTH} characters, without control characters')
        outcome = values['outcome']
        if not isinstance(outcome, str) or outcome not in USAGE_OUTCOMES:
            invalid('outcome', f'outcome must be one of {USAGE_OUTCOMES}')
        tokens = {field: values[field] for field in ('input_tokens', 'output_tokens')}
        reported = [value is not None for value in tokens.values()]
        if any(reported) and not all(reported):
            invalid('output_tokens' if reported[0] else 'input_tokens', 'input_tokens and output_tokens are both given or both null')
        for field, value in tokens.items():
            if value is not None and not is_token_count(value):
                invalid(field, f'{field} must be an integer from 0 to {MAX_TOKENS}')
        called_at = parse_called_at(values['called_at'])
        if called_at is None:
            invalid('called_at', 'called_at must be an ISO-8601 datetime with an offset')
        if called_at > datetime.now(timezone.utc) + FUTURE_TOLERANCE:
            invalid('called_at', 'called_at must not be more than 5 minutes in the future')
        return {
            'company_id': self.env.company.id,
            'user_id': self.env.user.id,
            'conversation_id': conversation_id,
            'kind': kind,
            'provider': provider,
            'model': model,
            'outcome': outcome,
            'input_tokens': tokens['input_tokens'] or 0,
            'output_tokens': tokens['output_tokens'] or 0,
            'tokens_reported': all(reported),
            'called_at': called_at.replace(tzinfo=None),
        }

    @api.model_create_multi
    def create(self, vals_list):
        self.env['liwan.entitlement.service'].require('ai.enabled')
        self.env['liwan.access.service']._liwan_require_capability(AI_USE)
        rows = []
        for index, values in enumerate(vals_list):
            try:
                rows.append(self._liwan_ai_prepare(values))
            except ValidationError as error:
                error.liwan_index = index
                raise
        return super().create(rows)
