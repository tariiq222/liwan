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

# The one route the usage recorder's API key may reach (models/ir_http.py registers it with the platform guard).
USAGE_SERVICE_PATH = '/api/v1/ai/usage/service'
USAGE_KINDS = ('plan', 'title')
# What kind of task a call served (the AI service's ``Capability`` and the zod ``AiCapabilitySchema``).
USAGE_CAPABILITIES = ('quick', 'standard', 'analysis', 'writing')
USAGE_OUTCOMES = ('ok', 'failed', 'retried', 'aborted')
# Who paid a provider call: the platform within the package (counted against ai.tokens.monthly), the tenant's own key,
# or the vendor's assistance budget (the free setup and help agents run on the platform provider outside the package,
# spec §6.5); the AI service names that last billing ``setup``.
USAGE_BILLINGS = ('platform', 'tenant_key', 'setup')
WIRE_KEYS = frozenset({
    'conversation_id', 'call_id', 'kind', 'capability', 'billing', 'provider', 'model', 'outcome', 'input_tokens', 'output_tokens',
    'cost', 'charge', 'called_at',
})
# The same provider attempt reported twice is the same row: the spool retries a batch whose answer it never saw.
CALL_ID_PATTERN = re.compile(r'[0-9a-f]{16}')
PROVIDER_PATTERN = re.compile(r'[a-z][a-z0-9_-]{0,31}')
CONTROL_CHARACTERS = re.compile(r'[\x00-\x1f\x7f-\x9f]')
MAX_MODEL_LENGTH = 128
MAX_TOKENS = 100_000_000
# Cost and charge are in cost units of 0.00001 USD; the bound is the largest value of the integer column.
MAX_COST_UNITS = 2_147_483_647
# What a row is and how large one can be (issue #557). A row is ONE provider call (`call_id` is the provider attempt, apps/ai-service
# contracts.py ModelUsageEvent), not a run. The executor does not bound one call tighter than the wire: `input_tokens_per_run=0`
# disables the per-run input ceiling, and the ceilings (graph.py) are checked BETWEEN calls, so the call that crosses one still
# finishes with the whole history sent. The only trustworthy per-row bound is therefore the AI service's own contract
# (`le=100_000_000` on both counts, mirrored by MAX_TOKENS here and by the zod schema); a test reads that contract and fails if it
# grows past MAX_TOKENS. Nothing smaller is enforced per row: a smaller number would refuse legitimate usage.
#
# Abuse protection on the service route (a stolen key could report 64 rows of MAX_TOKENS and use up ``ai.tokens.monthly`` for the
# whole tenant) is therefore an AGGREGATE bound on what the recorder inserted in the last minute, tenant-wide, counted under the
# recorder lock (controllers/ai.py): rows, and tokens. The token ceiling is two full rows' worth (input plus output of one maximal
# row), so any single valid row fits an empty window; it is an engineering sanity value far above any provider's per-account
# rate, not a derived limit, and is single-sourced with the Nuxt splitter in packages/contracts (a drift test compares them).
# Age: the web spool gives a row up after an hour (apps/web usage.ts), so a day is generous and keeps a row in its month.
SERVICE_MAX_AGE = timedelta(hours=24)
SERVICE_MAX_ROWS_PER_MINUTE = 600  # exact: the route serializes admission per recorder (controllers/ai.py), so parallel requests cannot overshoot
SERVICE_MAX_TOKENS_PER_MINUTE = 2 * MAX_TOKENS
FUTURE_TOLERANCE = timedelta(minutes=5)
# RFC 3339 with an offset, the same instants the zod contract's iso datetime({offset: true}) accepts.
RFC3339 = re.compile(
    r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-])(\d{2}):(\d{2}))',
)


def is_token_count(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_TOKENS


def is_cost_units(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_COST_UNITS


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
    capability = fields.Selection([(capability, capability) for capability in USAGE_CAPABILITIES], required=True, default='standard')
    billing = fields.Selection([(billing, billing) for billing in USAGE_BILLINGS], required=True)
    provider = fields.Char(required=True)
    model = fields.Char(required=True)
    outcome = fields.Selection([(outcome, outcome) for outcome in USAGE_OUTCOMES], required=True)
    input_tokens = fields.Integer()
    output_tokens = fields.Integer()
    tokens_reported = fields.Boolean()
    # What the call cost the vendor and what the tenant is charged, in cost units (0.00001 USD). An Integer column cannot tell
    # null from 0 (a free model costs 0), so each has a ``*_reported`` flag like ``tokens_reported``; the serializer returns
    # null unless the flag is set. ``charge`` is null where the vendor pays the call (``setup``) or the tenant's own key does.
    cost = fields.Integer()
    cost_reported = fields.Boolean()
    charge = fields.Integer()
    charge_reported = fields.Boolean()
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
        capability = values['capability']
        if not isinstance(capability, str) or capability not in USAGE_CAPABILITIES:
            invalid('capability', f'capability must be one of {USAGE_CAPABILITIES}')
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
        for field in ('cost', 'charge'):
            if values[field] is not None and not is_cost_units(values[field]):
                invalid(field, f'{field} must be an integer from 0 to {MAX_COST_UNITS} or null')
        if values['cost'] is not None and not all(reported):
            invalid('cost', 'cost needs token counts')
        if values['charge'] is not None and values['cost'] is None:
            invalid('charge', 'charge needs a cost')
        if billing == 'tenant_key' and (values['cost'] is not None or values['charge'] is not None):
            invalid('cost' if values['cost'] is not None else 'charge', 'a call on the tenant key has no cost or charge')
        if billing == 'setup' and values['charge'] is not None:
            invalid('charge', 'a setup call is paid by the vendor and has no charge')
        if not service:
            # The session route is open to every user with ai.use: a user must not write the figures deducted from the balance.
            for field in ('cost', 'charge'):
                if values[field] is not None:
                    invalid(field, f'{field} is only accepted from the usage recorder')
        called_at = parse_called_at(values['called_at'])
        if called_at is None:
            invalid('called_at', 'called_at must be an ISO-8601 datetime with an offset')
        if called_at > datetime.now(timezone.utc) + FUTURE_TOLERANCE:
            invalid('called_at', 'called_at must not be more than 5 minutes in the future')
        if service:
            if called_at < datetime.now(timezone.utc) - SERVICE_MAX_AGE:
                invalid('called_at', 'called_at must be within the last 24 hours on this route')
        return {
            'company_id': company.id,
            'user_id': user.id,
            'conversation_id': conversation_id,
            'call_id': call_id,
            'kind': kind,
            'capability': capability,
            'billing': billing,
            'provider': provider,
            'model': model,
            'outcome': outcome,
            'input_tokens': tokens['input_tokens'] or 0,
            'output_tokens': tokens['output_tokens'] or 0,
            'tokens_reported': all(reported),
            'cost': values['cost'] or 0,
            'cost_reported': values['cost'] is not None,
            'charge': values['charge'] or 0,
            'charge_reported': values['charge'] is not None,
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

    @staticmethod
    def _liwan_ai_tokens_of(items):
        """The tokens a raw request claims (anything that is not a valid count counts 0; validation refuses it later)."""
        return sum(
            value for item in items if isinstance(item, dict)
            for value in (item.get('input_tokens'), item.get('output_tokens')) if is_token_count(value)
        )

    @api.model
    def _liwan_ai_admission(self, items):
        """``None`` when the recorder may add ``items`` now, ``'rate_limited'`` when it must wait, ``'too_large'`` when it must split."""
        claimed = self._liwan_ai_tokens_of(items)
        if claimed > SERVICE_MAX_TOKENS_PER_MINUTE:
            return 'too_large'
        rows_left, tokens_left = self._liwan_ai_recorder_budget_left()
        return 'rate_limited' if len(items) > rows_left or claimed > tokens_left else None

    @api.model
    def _liwan_ai_recorder_budget_left(self):
        """``(rows, tokens)`` the recorder may still add in this minute, tenant-wide.

        Counted from the ledger itself, so it needs no counter store; the ``called_at`` bound only lets the index on it
        narrow the scan, since a service row is never older than ``SERVICE_MAX_AGE``. The request is pinned to the recorder's
        current company and its branches, so each company the recorder may write to is counted in its own context (the record
        rule and the company fence stay in force, no ``sudo()``): a key cannot spread its rows over another top-level company
        to escape either ceiling. The caller holds the recorder lock, so the read and the insert are one critical section.
        """
        now = fields.Datetime.now()
        domain = [
            ('create_uid', '=', self.env.uid),
            ('called_at', '>=', now - SERVICE_MAX_AGE - timedelta(minutes=1)),
            ('create_date', '>=', now - timedelta(minutes=1)),
        ]
        rows = tokens = 0
        for company_id in self.env.user.company_ids.ids:
            scoped = self.with_context(allowed_company_ids=[company_id], liwan_pinned_company_ids=[company_id])
            [[count, input_sum, output_sum]] = scoped._read_group(domain, [], ['__count', 'input_tokens:sum', 'output_tokens:sum'])
            rows += count
            tokens += (input_sum or 0) + (output_sum or 0)
        return SERVICE_MAX_ROWS_PER_MINUTE - rows, SERVICE_MAX_TOKENS_PER_MINUTE - tokens

    @api.model
    def _liwan_ai_existing(self, row):
        """The row this attempt already has, if any, within the same user and conversation."""
        return self.search([
            ('user_id', '=', row['user_id']),
            ('conversation_id', '=', row['conversation_id']),
            ('call_id', '=', row['call_id']),
        ], limit=1)
