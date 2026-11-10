# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import fields, http
from odoo.http import request

from .common import parse_day, require_capability
from .write_support import company_records
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_finance.serializers.setup import dump_setup

# The soft locks move both ways. The hard lock date is irreversible in stock Odoo, so only its own route writes it.
LOCK_DATE_FIELDS = ('fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date')
FISCAL_DAYS = range(1, 32)
FISCAL_MONTHS = range(1, 13)

# The fiscal write carries the identity the screen was read for, so a screen that moved to another
# user or company before it saved is refused before the payload is parsed and before anything is written.
# The header is a comparison value only: it never selects the target and never grants a capability.
EXPECTED_USER_HEADER = 'X-Liwan-Expected-User-Id'
EXPECTED_COMPANY_HEADER = 'X-Liwan-Expected-Company-Id'
# Positive canonical ASCII decimal, no wider than an exact JavaScript integer (Number.MAX_SAFE_INTEGER).
EXPECTED_ID_PATTERN = re.compile(r'^[1-9][0-9]*$')
MAX_EXPECTED_ID_DIGITS = 16
MAX_EXPECTED_ID = 9007199254740991


def _expected_id(header):
    """The id a precondition header states, or a 422 naming the header it must carry."""
    value = request.httprequest.headers.get(header)
    invalid = (
        value is None
        or len(value) > MAX_EXPECTED_ID_DIGITS
        or not EXPECTED_ID_PATTERN.match(value)
        or int(value) > MAX_EXPECTED_ID
    )
    if invalid:
        # The refusal names no identity: neither the authenticated one nor the stated one leaves this layer.
        raise ApiError(422, 'invalid_request_context', 'the request must state the expected sign-in user and company', field=header)
    return int(value)


def require_expected_context(user, company):
    """Refuse a fiscal write whose screen was read for another user or company.

    ``user`` and ``company`` are the authenticated identity of this request, read once by the caller and
    kept for the write that follows. A missing or malformed header is a 422; a stated identity that is not
    the authenticated one is a 409. Both are decided before the payload is parsed and before any write,
    audit event or server-side effect, and neither can select a company or replace the capability check.
    """
    expected_user = _expected_id(EXPECTED_USER_HEADER)
    expected_company = _expected_id(EXPECTED_COMPANY_HEADER)
    if expected_user != user.id or expected_company != company.id:
        raise ApiError(
            409, 'request_context_changed',
            'the sign-in user or company changed since this screen was loaded; reload it and try again',
        )


def _require_payload(payload, allowed):
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        raise ApiError(422, 'invalid', f'unknown field: {unknown[0]}', field=unknown[0])
    if not payload:
        raise ApiError(422, 'invalid', 'no fields to update')


def _parse_int_in(value, field, allowed):
    if isinstance(value, bool) or not isinstance(value, int) or value not in allowed:
        raise ApiError(422, 'invalid', f'{field} must be an integer from {allowed[0]} to {allowed[-1]}', field=field)
    return value


def _parse_lock_date(value, field):
    if value is None:
        return False
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', f'{field} must be an ISO date (YYYY-MM-DD) or null', field=field)
    return parse_day(value, field)


def _transfer_account(value, company):
    """The reconcilable current-asset account that internal transfers pass through."""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ApiError(422, 'invalid', 'transfer_account_id must be an account id', field='transfer_account_id')
    return company_records(
        'account.account', [value], 'transfer_account_id',
        [*request.env['account.account']._check_company_domain(company), ('reconcile', '=', True), ('account_type', '=', 'asset_current')],
    )


def parse_fiscal_vals(payload, company):
    _require_payload(payload, ('fiscalyear_last_day', 'fiscalyear_last_month', 'transfer_account_id', *LOCK_DATE_FIELDS))
    vals = {}
    for field, value in payload.items():
        if field == 'fiscalyear_last_day':
            vals[field] = _parse_int_in(value, field, FISCAL_DAYS)
        elif field == 'fiscalyear_last_month':
            vals[field] = str(_parse_int_in(value, field, FISCAL_MONTHS))
        elif field == 'transfer_account_id':
            vals[field] = _transfer_account(value, company).id
        else:
            vals[field] = _parse_lock_date(value, field)

    fiscal_fields = ('fiscalyear_last_day', 'fiscalyear_last_month')
    fiscal_year_changes = any(
        field in vals and vals[field] != company[field]
        for field in fiscal_fields
    )
    if fiscal_year_changes and request.env['account.move'].search_count([
        ('company_id', '=', company.id), ('state', '=', 'posted'),
    ]):
        # Corrections after posted entries require an operator maintenance window, not an API path.
        raise ApiError(
            422, 'fiscal_year_has_posted_entries',
            'the fiscal year end cannot be changed after journal entries have been posted',
        )
    _require_no_unreconciled_lines(vals, company)
    return vals


def _require_no_unreconciled_lines(vals, company):
    """A fiscal or hard lock needs every bank statement line up to it reconciled; stock refuses with an English sentence, this names the count."""
    field = 'hard_lock_date' if vals.get('hard_lock_date') else 'fiscalyear_lock_date'
    lock = vals.get(field)
    if not lock:
        return
    count = request.env['account.bank.statement.line'].search_count([
        ('company_id', 'child_of', company.ids), ('is_reconciled', '=', False), ('date', '<=', lock),
        ('move_id.state', 'in', ('draft', 'posted')),
    ])
    if count:
        raise ApiError(
            422, 'unreconciled_bank_lines', 'bank statement lines up to the lock date are not reconciled',
            field=field, details={'count': count},
        )


def parse_hard_lock_vals(payload, company):
    """The one irreversible write: a dated hard lock, stated with an explicit confirmation, that only moves later."""
    _require_payload(payload, ('hard_lock_date', 'confirm'))
    if payload.get('confirm') is not True:
        raise ApiError(422, 'invalid', 'the irreversible hard lock must be confirmed with confirm: true', field='confirm')
    value = payload.get('hard_lock_date')
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', 'hard_lock_date must be an ISO date (YYYY-MM-DD)', field='hard_lock_date')
    lock = parse_day(value, 'hard_lock_date')
    if lock > fields.Date.context_today(request.env.user):
        raise ApiError(422, 'invalid', 'the hard lock date cannot be in the future', field='hard_lock_date')
    if company.hard_lock_date and lock < company.hard_lock_date:
        raise ApiError(
            422, 'lock_date_loosening', 'the hard lock date is irreversible and can only move later', field='hard_lock_date',
        )
    drafts = request.env['account.move'].search_count([
        ('company_id', 'child_of', company.ids), ('state', '=', 'draft'), ('date', '<=', lock),
    ])
    if drafts:
        raise ApiError(
            422, 'draft_entries_in_period', 'draft entries up to the hard lock date must be posted or deleted first',
            field='hard_lock_date', details={'count': drafts},
        )
    vals = {'hard_lock_date': lock}
    _require_no_unreconciled_lines(vals, company)
    return vals


class FinanceSetupController(http.Controller):

    @http.route('/api/v1/finance/setup', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_setup(self, **_):
        require_capability('finance.setup.read')
        return dump_setup(request.env.company)

    @http.route('/api/v1/finance/setup/fiscal', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_fiscal(self, **payload):
        require_capability('finance.setup.manage')
        # Read the identity once: the precondition, the parsed payload and the write that follows all
        # act on this same company, so a company switch cannot move the target after the check.
        user, company = request.env.user, request.env.company
        require_expected_context(user, company)
        request.env['liwan.finance.setup']._liwan_write_company(company, parse_fiscal_vals(payload, company))
        return dump_setup(company)

    @http.route('/api/v1/finance/setup/fiscal/lock', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def lock_fiscal(self, **payload):
        require_capability('finance.setup.manage')
        user, company = request.env.user, request.env.company
        require_expected_context(user, company)
        request.env['liwan.finance.setup']._liwan_write_company(company, parse_hard_lock_vals(payload, company))
        return dump_setup(company)
