# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import datetime, timedelta, timezone

from psycopg2.errors import UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from odoo.addons.liwan_ai.models.access_service import AI_USE
from odoo.addons.liwan_ai.models.ai_audit import (
    CONVERSATION_ID_MESSAGE,
    is_conversation_id,
    raise_invalid,
)
from odoo.addons.liwan_ai.models.ai_settings import MAX_INPUT_TOKENS_PER_RUN

# The one route the usage recorder's API key may reach (models/ir_http.py registers it with the platform guard).
USAGE_SERVICE_PATH = '/api/v1/ai/usage/service'
USAGE_KINDS = ('plan', 'title')
USAGE_OUTCOMES = ('ok', 'failed', 'retried', 'aborted')
# Who paid a provider call: the platform within the package (counted against ai.tokens.monthly), the tenant's own key,
# or the vendor's assistance budget (the free setup and help agents run on the platform provider outside the package,
# spec §6.5); the AI service names that last billing ``setup``.
USAGE_BILLINGS = ('platform', 'tenant_key', 'setup')
WIRE_KEYS = frozenset({
    'conversation_id', 'call_id', 'kind', 'billing', 'provider', 'model', 'outcome', 'input_tokens', 'output_tokens', 'called_at',
})
# The same provider attempt reported twice is the same row: the spool retries a batch whose answer it never saw.
CALL_ID_PATTERN = re.compile(r'[0-9a-f]{16}')
PROVIDER_PATTERN = re.compile(r'[a-z][a-z0-9_-]{0,31}')
CONTROL_CHARACTERS = re.compile(r'[\x00-\x1f\x7f-\x9f]')
MAX_MODEL_LENGTH = 128
MAX_TOKENS = 100_000_000
# Ceilings of the service route, whose key is held by the web server and not by a user (issue #557). A wrong or stolen key
# could otherwise report 64 rows of MAX_TOKENS each and use up ``ai.tokens.monthly`` for the whole tenant, and rows can only
# be removed by an operator. Each ceiling comes from what the stack itself allows a single call or run to consume:
#   input per row: the tenant's own ceiling on one run's input tokens, which no single call can exceed (ai_settings.py);
#   output per row: the AI service's policy cap on one run's output tokens (apps/ai-service contracts.py max_output_tokens);
#   per request: four full runs, since a request carries the rows a user's runs left unreported during an outage;
#   age: the web spool gives a row up after an hour (apps/web usage.ts), so a day is generous and keeps a row in its month;
#   rate: 600 rows a minute is ~45 runs of 13 calls a minute for one tenant, far above real use.
SERVICE_MAX_INPUT_TOKENS = MAX_INPUT_TOKENS_PER_RUN
SERVICE_MAX_OUTPUT_TOKENS = 1_000_000
SERVICE_MAX_BATCH_TOKENS = 4 * (SERVICE_MAX_INPUT_TOKENS + SERVICE_MAX_OUTPUT_TOKENS)
SERVICE_MAX_AGE = timedelta(hours=24)
SERVICE_MAX_ROWS_PER_MINUTE = 600
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

    Written by the Nuxt executor, either as the user (``/api/v1/ai/usage``, their session) or, once their session no
    longer matters, as the tenant's technical recorder account for that user (``/api/v1/ai/usage/service``); never
    elevated by ``sudo()``. The calls already happened, so ``create`` applies no limit: it
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
    # The provider's own id of the call (16 hex): the wire's identity of the row, so a re-sent batch adds nothing.
    call_id = fields.Char(required=True)
    kind = fields.Selection([(kind, kind) for kind in USAGE_KINDS], required=True)
    billing = fields.Selection([(billing, billing) for billing in USAGE_BILLINGS], required=True)
    provider = fields.Char(required=True)
    model = fields.Char(required=True)
    outcome = fields.Selection([(outcome, outcome) for outcome in USAGE_OUTCOMES], required=True)
    input_tokens = fields.Integer()
    output_tokens = fields.Integer()
    tokens_reported = fields.Boolean()
    called_at = fields.Datetime(required=True, index=True)

    # The own-rows rule filters on user_id and orders by called_at; a monthly per-user sum reads the same.
    _user_called_at_idx = models.Index('(user_id, called_at)')
    # One row per provider attempt of one user: a batch Odoo accepted before a timeout is never counted twice (issue #557).
    _user_conversation_call_uniq = models.UniqueIndex('(user_id, conversation_id, call_id)')

    @api.model
    def _liwan_ai_prepare(self, values, user, company, service=False):
        """Validate one wire payload and return the create values for ``user`` in ``company``.

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
        call_id = values['call_id']
        if not isinstance(call_id, str) or not CALL_ID_PATTERN.fullmatch(call_id):
            invalid('call_id', 'call_id must be 16 lowercase hex characters')
        kind = values['kind']
        if not isinstance(kind, str) or kind not in USAGE_KINDS:
            invalid('kind', f'kind must be one of {USAGE_KINDS}')
        billing = values['billing']
        if not isinstance(billing, str) or billing not in USAGE_BILLINGS:
            invalid('billing', f'billing must be one of {USAGE_BILLINGS}')
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
        if service:
            if tokens['input_tokens'] and tokens['input_tokens'] > SERVICE_MAX_INPUT_TOKENS:
                invalid('input_tokens', f'input_tokens must not exceed {SERVICE_MAX_INPUT_TOKENS} on this route')
            if tokens['output_tokens'] and tokens['output_tokens'] > SERVICE_MAX_OUTPUT_TOKENS:
                invalid('output_tokens', f'output_tokens must not exceed {SERVICE_MAX_OUTPUT_TOKENS} on this route')
            if called_at < datetime.now(timezone.utc) - SERVICE_MAX_AGE:
                invalid('called_at', 'called_at must be within the last 24 hours on this route')
        return {
            'company_id': company.id,
            'user_id': user.id,
            'conversation_id': conversation_id,
            'call_id': call_id,
            'kind': kind,
            'billing': billing,
            'provider': provider,
            'model': model,
            'outcome': outcome,
            'input_tokens': tokens['input_tokens'] or 0,
            'output_tokens': tokens['output_tokens'] or 0,
            'tokens_reported': all(reported),
            'called_at': called_at.replace(tzinfo=None),
        }

    @api.model
    def _liwan_platform_tokens_used(self):
        """Input plus output tokens of the platform-billed calls of the whole tenant since the start of this UTC month.

        Plain SQL like the monthly message count: the limit is the tenant's, so it spans every company and user.
        """
        self.env.cr.execute(
            "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM liwan_ai_usage"
            " WHERE billing = 'platform' AND called_at >= %s",
            [self.env['liwan.ai.audit']._liwan_ai_month_start()],
        )
        return self.env.cr.fetchone()[0]

    @api.model_create_multi
    def create(self, vals_list):
        """Record the attempts of a batch as the signed-in user, each row once (the browser-session path)."""
        self.env['liwan.entitlement.service'].require('ai.enabled')
        self.env['liwan.access.service']._liwan_require_capability(AI_USE)
        return self._liwan_ai_record(vals_list, self.env.user, self.env.company)

    @api.model
    def _liwan_ai_record_for(self, vals_list, user_id, company_id):
        """Record the attempts of a batch for ``user_id`` as the technical recorder (the service-identity path).

        The caller is the recorder account, which holds no AI capability; what it may write is bound by its own ACL
        and by the checks below: the user must exist (a leaver's calls still happened), be an internal user, and
        belong to ``company_id``, so a row is never attributed to a user or company it does not belong to. The whole
        write runs in that one company, so its record rules apply to it and to no other.
        """
        self.env['liwan.entitlement.service'].require('ai.enabled')
        if not isinstance(user_id, int) or isinstance(user_id, bool):
            raise_invalid(self.env, 'user_id', 'user_id must be an integer')
        if not isinstance(company_id, int) or isinstance(company_id, bool):
            raise_invalid(self.env, 'user_company_id', 'user_company_id must be an integer')
        if company_id not in self.env.user.company_ids.ids:
            raise_invalid(self.env, 'user_company_id', 'user_company_id must be a company of this tenant')
        scoped = self.with_context(allowed_company_ids=[company_id], liwan_pinned_company_ids=[company_id])
        # One search answers all three questions: it finds the user only if internal and a member of the company.
        user = scoped.env['res.users'].with_context(active_test=False).search([
            ('id', '=', user_id), ('share', '=', False), ('company_ids', 'in', [company_id]),
        ], limit=1)
        if not user:
            raise_invalid(self.env, 'user_id', 'user_id must be an internal user of user_company_id')
        return scoped._liwan_ai_record(vals_list, user, scoped.env['res.company'].browse(company_id), service=True)

    @api.model
    def _liwan_ai_record(self, vals_list, user, company, service=False):
        """Record the attempts of a batch, each row once; a row this user already reported is not counted again.

        The spool retries a batch whose answer it never saw, so the same attempt can arrive twice (issue #557). The unique
        index on (user, conversation, call) is the guard: a refused insert rolls back only its own savepoint and the batch
        answers success with the rows that already exist, so the retry is settled rather than repeated.
        """
        rows = []
        for index, values in enumerate(vals_list):
            try:
                rows.append(self._liwan_ai_prepare(values, user, company, service=service))
            except ValidationError as error:
                error.liwan_index = index
                raise
        if service and sum(row['input_tokens'] + row['output_tokens'] for row in rows) > SERVICE_MAX_BATCH_TOKENS:
            raise_invalid(self.env, 'items', f'a request must not report more than {SERVICE_MAX_BATCH_TOKENS} tokens in all')
        created = []
        for index, row in enumerate(rows):
            existing = self._liwan_ai_existing(row)
            if existing:
                created.append(existing.id)
                continue
            try:
                with self.env.cr.savepoint():
                    created.append(super().create([row]).id)
            except UniqueViolation:
                # A concurrent report of the same attempt won the insert: that row is the record of this attempt too.
                existing = self._liwan_ai_existing(row)
                if not existing:
                    # The index is unique per user, whatever the company: the same attempt is already held under another
                    # company (a user who switched company mid-run). It is answered as a conflict, naming nothing of that row.
                    error = ValidationError(self.env._('This call was already reported.'))
                    error.liwan_field, error.liwan_code, error.liwan_status, error.liwan_index = 'call_id', 'duplicate', 409, index
                    raise error from None
                created.append(existing.id)
        return self.browse(created)

    @api.model
    def _liwan_ai_recorder_rows_left(self):
        """How many more rows the recorder may add in this minute (``SERVICE_MAX_ROWS_PER_MINUTE`` less what it just added).

        Counted from the ledger itself, so it needs no counter store; the ``called_at`` bound only lets the index on it
        narrow the scan, since a service row is never older than ``SERVICE_MAX_AGE``.
        """
        now = fields.Datetime.now()
        used = self.search_count([
            ('create_uid', '=', self.env.uid),
            ('called_at', '>=', now - SERVICE_MAX_AGE - timedelta(minutes=1)),
            ('create_date', '>=', now - timedelta(minutes=1)),
        ])
        return SERVICE_MAX_ROWS_PER_MINUTE - used

    @api.model
    def _liwan_ai_existing(self, row):
        """The row this attempt already has, if any, within the same user and conversation."""
        return self.search([
            ('user_id', '=', row['user_id']),
            ('conversation_id', '=', row['conversation_id']),
            ('call_id', '=', row['call_id']),
        ], limit=1)
