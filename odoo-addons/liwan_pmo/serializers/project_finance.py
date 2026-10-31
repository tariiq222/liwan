# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math
from decimal import ROUND_HALF_UP, Decimal

from odoo import fields
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_pmo.serializers.dates import parse_date
from odoo.addons.liwan_pmo.serializers.project_charter import dump_currency

CREATE_FIELDS = {'kind', 'title', 'amount', 'expense_date', 'reference', 'notes', 'budget_entry_id'}
PATCH_FIELDS = {'title', 'amount', 'expense_date', 'reference', 'notes', 'budget_entry_id'}
MAX_AMOUNT = 1e12
TITLE_MAX_LEN = 200
REFERENCE_MAX_LEN = 200
NOTES_MAX_LEN = 10000


def currency_quantum(currency):
    """The smallest representable Decimal step at a currency's precision.

    Public (no leading underscore): shared with serializers/project_reports.py
    for report-totals aggregation, not just used internally here.
    """
    decimals = currency.decimal_places if currency else 2
    return Decimal(1).scaleb(-decimals)


def to_decimal(value):
    """Exact Decimal from a float/int amount, via its shortest round-trip repr.

    `str(value)` (not `Decimal(value)`) recovers the decimal literal the
    value was created from (e.g. `0.1` -> ``'0.1'``) instead of the binary
    float's exact-but-noisy value, so precision checks and sums never trip on
    float representation noise for values that are otherwise exact (avoids
    the `0.1 + 0.2 != 0.3` class of bug). Public: shared with
    serializers/project_reports.py.
    """
    return Decimal(str(value))


def _date_out(value):
    return fields.Date.to_string(value) if value else None


def dump_finance_entry(entry):
    return {
        'id': entry.id,
        'project_id': entry.project_id.id,
        'kind': entry.kind,
        'title': entry.title,
        'amount': entry.amount,
        'expense_date': _date_out(entry.expense_date),
        'reference': entry.reference or '',
        'notes': entry.notes or '',
        'budget_entry_id': entry.budget_entry_id.id or None,
        'updated_at': entry._liwan_updated_at(),
    }


def build_finance_summary(project, entries=None, externals=None):
    """Lifetime finance summary for one project.

    ``externals`` is ``liwan.project.actual.source._liwan_actual_totals`` of a batch of projects
    (looked up for this project when omitted). A project in it takes its actual cost and expense
    count from that source and ignores manual expense entries.

    Amounts are summed as exact `Decimal` (via each amount's shortest
    round-trip string, see `to_decimal`) and only converted back to float at
    the very end, then compared/subtracted in `Decimal` space too. A plain
    float sum would compute e.g. `0.10 + 0.20 == 0.30000000000000004`, which
    would wrongly flip `over_budget` and `remaining` for an exact
    budget/expense pair - rounding only the *displayed* total afterwards does
    not fix that, since the comparison itself must already be exact.
    """
    if entries is None:
        entries = project.env['liwan.project.finance.entry'].search([('project_id', '=', project.id)])
    source = project.env['liwan.project.actual.source']
    if externals is None:
        externals = source._liwan_actual_totals(project)
    external = externals.get(project.id)
    currency = project.currency_id
    quantum = currency_quantum(currency)
    budgets = entries.filtered(lambda e: e.kind == 'budget')
    expenses = entries.filtered(lambda e: e.kind == 'expense')
    planned_dec = None
    if budgets:
        planned_dec = sum((to_decimal(a) for a in budgets.mapped('amount')), Decimal('0')).quantize(
            quantum, rounding=ROUND_HALF_UP,
        )
    if external is None:
        actual_dec = sum((to_decimal(a) for a in expenses.mapped('amount')), Decimal('0')).quantize(
            quantum, rounding=ROUND_HALF_UP,
        )
        expense_count = len(expenses)
    else:
        actual_dec, expense_count = external[0].quantize(quantum, rounding=ROUND_HALF_UP), external[1]
    remaining_dec = None if planned_dec is None else (planned_dec - actual_dec).quantize(quantum, rounding=ROUND_HALF_UP)
    over_budget = planned_dec is not None and actual_dec > planned_dec
    utilization_percent = None
    if planned_dec:
        utilization_percent = float((actual_dec / planned_dec * 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
    charter_estimate = None if project.liwan_budget_state == 'unknown' else project.liwan_budget_amount
    return {
        'project_id': project.id,
        'currency': dump_currency(currency),
        'charter_estimate': charter_estimate,
        'planned': None if planned_dec is None else float(planned_dec),
        'actual': float(actual_dec),
        'remaining': None if remaining_dec is None else float(remaining_dec),
        'utilization_percent': utilization_percent,
        'over_budget': over_budget,
        'budget_count': len(budgets),
        'expense_count': expense_count,
        'actual_source': 'manual' if external is None else 'external',
        'actual_account': source._liwan_actual_account(project),
        'can_read_actual_lines': source._liwan_can_read_actual_lines(project),
        'can_choose_actual_account': (
            source._liwan_can_choose_actual_account(project)
        ),
    }


def _parse_optional_str(value, field, max_len):
    if value in (None, False):
        return ''
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', f"{field} must be a string", field=field)
    if len(value) > max_len:
        raise ApiError(422, 'invalid', f"{field} must be at most {max_len} characters", field=field)
    return value


def _parse_amount_in(value, currency):
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ApiError(422, 'invalid', "amount must be a finite number", field='amount')
    if not math.isfinite(value):
        raise ApiError(422, 'invalid', "amount must be a finite number", field='amount')
    if value < 0 or value > MAX_AMOUNT:
        raise ApiError(422, 'invalid', "amount must be between 0 and 1e12", field='amount')
    as_decimal = to_decimal(value)
    if as_decimal != as_decimal.quantize(currency_quantum(currency), rounding=ROUND_HALF_UP):
        raise ApiError(422, 'invalid', "amount has more precision than the currency allows", field='amount')
    return value


def _parse_positive_id(value, field):
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ApiError(422, 'invalid', f"{field} must be a positive integer or null", field=field)
    return value


def _parse_budget_link(value, project):
    """Resolve+scope a `budget_entry_id` using the caller's own env (no sudo).

    A search scoped by the *already-authorized* `project.id` (and `kind`)
    directly answers "does a budget entry with this id exist in this
    project", without ever needing to resolve the visibility of some other,
    possibly-foreign/hidden project the id might otherwise belong to - so
    there is no separate existence-oracle concern to work around with a
    privilege-elevated lookup.
    """
    if value in (None, False):
        return False
    _parse_positive_id(value, 'budget_entry_id')
    budget = request.env['liwan.project.finance.entry'].search([
        ('id', '=', value), ('project_id', '=', project.id), ('kind', '=', 'budget'),
    ], limit=1)
    if not budget:
        raise ApiError(
            422, 'invalid', "budget_entry_id must reference a budget entry in this project",
            field='budget_entry_id',
        )
    return budget.id


def parse_finance_create(payload, project):
    unknown = set(payload) - CREATE_FIELDS
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    kind = payload.get('kind')
    if kind not in ('budget', 'expense'):
        raise ApiError(422, 'invalid', "kind must be 'budget' or 'expense'", field='kind')
    title = payload.get('title')
    if not isinstance(title, str) or not title.strip():
        raise ApiError(422, 'invalid', "title must not be empty", field='title')
    title = title.strip()
    if len(title) > TITLE_MAX_LEN:
        raise ApiError(422, 'invalid', f"title must be at most {TITLE_MAX_LEN} characters", field='title')
    amount = _parse_amount_in(payload.get('amount'), project.currency_id)
    vals = {
        'project_id': project.id,
        'kind': kind,
        'title': title,
        'amount': amount,
        'reference': _parse_optional_str(payload.get('reference', ''), 'reference', REFERENCE_MAX_LEN),
        'notes': _parse_optional_str(payload.get('notes', ''), 'notes', NOTES_MAX_LEN),
    }
    if kind == 'budget':
        if payload.get('expense_date') not in (None, False):
            raise ApiError(422, 'invalid', "budget entries cannot have an expense date", field='expense_date')
        if payload.get('budget_entry_id') not in (None, False):
            raise ApiError(422, 'invalid', "budget entries cannot link to another budget entry", field='budget_entry_id')
        vals['expense_date'] = False
        vals['budget_entry_id'] = False
    else:
        if amount <= 0:
            raise ApiError(422, 'invalid', "expense amount must be positive", field='amount')
        expense_date = parse_date(payload.get('expense_date'), 'expense_date')
        if not expense_date:
            raise ApiError(422, 'invalid', "expense_date is required", field='expense_date')
        vals['expense_date'] = expense_date
        vals['budget_entry_id'] = _parse_budget_link(payload.get('budget_entry_id'), project)
    return vals


def parse_finance_patch(payload, entry):
    unknown = set(payload) - PATCH_FIELDS
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} cannot be changed", field=field)
    vals = {}
    if 'title' in payload:
        title = payload['title']
        if not isinstance(title, str) or not title.strip():
            raise ApiError(422, 'invalid', "title must not be empty", field='title')
        title = title.strip()
        if len(title) > TITLE_MAX_LEN:
            raise ApiError(422, 'invalid', f"title must be at most {TITLE_MAX_LEN} characters", field='title')
        vals['title'] = title
    if 'amount' in payload:
        vals['amount'] = _parse_amount_in(payload['amount'], entry.currency_id)
    if 'reference' in payload:
        vals['reference'] = _parse_optional_str(payload['reference'], 'reference', REFERENCE_MAX_LEN)
    if 'notes' in payload:
        vals['notes'] = _parse_optional_str(payload['notes'], 'notes', NOTES_MAX_LEN)
    if 'expense_date' in payload:
        if entry.kind == 'budget':
            raise ApiError(422, 'invalid', "budget entries cannot have an expense date", field='expense_date')
        parsed = parse_date(payload['expense_date'], 'expense_date')
        if not parsed:
            raise ApiError(422, 'invalid', "expense_date is required for an expense", field='expense_date')
        vals['expense_date'] = parsed
    if 'budget_entry_id' in payload:
        if entry.kind == 'budget':
            raise ApiError(422, 'invalid', "budget entries cannot link to another budget entry", field='budget_entry_id')
        vals['budget_entry_id'] = _parse_budget_link(payload['budget_entry_id'], entry.project_id)
    if 'amount' in vals and entry.kind == 'expense' and vals['amount'] <= 0:
        raise ApiError(422, 'invalid', "expense amount must be positive", field='amount')
    return vals
