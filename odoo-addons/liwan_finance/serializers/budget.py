# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shapes and request bodies of the budgets: a budget, its lines and the budget versus actual report.

Amounts are in the company currency, in the natural direction of the account (see ``models/budget.py``).
"""
from .common import dump_day, dump_ref
from .parsing import (
    parse_bool,
    parse_day,
    parse_id,
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
)
from odoo.addons.liwan_api.controllers.common import ApiError

BUDGET_FIELDS = frozenset({'name', 'description', 'date_from', 'date_to', 'cost_center_split'})
DISTRIBUTE_FIELDS = frozenset({'account_id', 'amount', 'date_from', 'date_to', 'label', 'shares'})
MAX_SHARES = 50
LINE_FIELDS = frozenset({'account_id', 'amount', 'date_from', 'date_to', 'label', 'analytic_account_id'})
PERCENT_DIGITS = 2


def dump_budget_line(line, amount, analytic_account, nature):
    """``nature`` is ``debit`` (expense side) or ``credit`` (income side): the direction ``amount`` is read in."""
    return {
        'id': line.id,
        'account': dump_ref(line.account_id),
        'nature': nature,
        'analytic_account': dump_ref(analytic_account),
        'label': line.name or '',
        'date_from': dump_day(line.date_from),
        'date_to': dump_day(line.date_to),
        'amount': amount,
    }


def dump_budget(budget):
    return {
        'id': budget.id,
        'name': budget.name,
        'description': budget.description or '',
        'state': budget.state,
        'date_from': dump_day(budget.date_from),
        'date_to': dump_day(budget.date_to),
        'currency': budget.company_id.currency_id.name,
        'line_count': len(budget.item_ids),
        'cost_center_split': budget.allow_items_overlap,
    }


def dump_budgets(budgets):
    return [dump_budget(budget) for budget in budgets]


def dump_budget_detail(budget, lines):
    """``lines`` are the ``dump_budget_line`` shapes."""
    return {**dump_budget(budget), 'lines': lines, **budget.env['liwan.finance.actions']._liwan_budget_actions(budget)}


def variance_figures(currency, budget, actual):
    """Budget minus actual, and that as a percentage of the budget (None when the budget is zero)."""
    variance = currency.round(budget - actual)
    percent = round(variance / budget * 100, PERCENT_DIGITS) if budget else None
    return {'budget': budget, 'actual': actual, 'variance': variance, 'variance_percent': percent}


def is_favorable(nature, budget, actual):
    """Spending at or under the budget (debit side), or earning at or over it (credit side)."""
    return actual <= budget if nature == 'debit' else actual >= budget


def _nature_totals(currency, rows, nature):
    selected = [row for row in rows if row[2] == nature]
    return variance_figures(
        currency, currency.round(sum(row[3] for row in selected)), currency.round(sum(row[4] for row in selected)),
    )


def dump_budget_vs_actual(budget, date_to, rows):
    """``rows`` are ``(line, analytic_account, nature, budget, actual)`` in the order of the lines.

    Debit and credit lines are never added together: ``totals`` has one block per nature and ``net``, the
    credit side less the debit side (the budgeted and the actual result of an income and expense budget).
    """
    currency = budget.company_id.currency_id
    lines = [
        {
            'id': line.id,
            'account': dump_ref(line.account_id),
            'nature': nature,
            'analytic_account': dump_ref(analytic_account),
            'label': line.name or '',
            'date_from': dump_day(line.date_from),
            'date_to': dump_day(line.date_to),
            **variance_figures(currency, line_budget, line_actual),
            'favorable': is_favorable(nature, line_budget, line_actual),
        }
        for line, analytic_account, nature, line_budget, line_actual in rows
    ]
    debit = _nature_totals(currency, rows, 'debit')
    credit = _nature_totals(currency, rows, 'credit')
    return {
        'budget': {'id': budget.id, 'name': budget.name, 'state': budget.state},
        'date_from': dump_day(budget.date_from),
        'date_to': dump_day(date_to),
        'currency': currency.name,
        'target_move': 'posted',
        'lines': lines,
        'totals': {
            'debit': debit,
            'credit': credit,
            'net': {
                'budget': currency.round(credit['budget'] - debit['budget']),
                'actual': currency.round(credit['actual'] - debit['actual']),
            },
        },
    }


def check_period(date_from, date_to):
    if date_from > date_to:
        raise ApiError(422, 'invalid', 'date_to must be on or after date_from', field='date_to')


def _parse_budget_fields(payload):
    parsed = {}
    if 'name' in payload:
        parsed['name'] = parse_text(payload['name'], 'name', required=True)
    if 'description' in payload:
        parsed['description'] = parse_text(payload['description'], 'description')
    for field in ('date_from', 'date_to'):
        if field in payload:
            parsed[field] = parse_day(payload[field], field)
    if 'cost_center_split' in payload:
        # OCA's own switch: several lines of one account may cover the same period.
        parsed['allow_items_overlap'] = parse_bool(payload['cost_center_split'], 'cost_center_split')
    return parsed


def parse_budget_create(payload):
    reject_unknown(payload, BUDGET_FIELDS)
    require_keys(payload, ('name', 'date_from', 'date_to'))
    parsed = _parse_budget_fields(payload)
    check_period(parsed['date_from'], parsed['date_to'])
    return parsed


def parse_budget_patch(payload):
    reject_unknown(payload, BUDGET_FIELDS)
    return _parse_budget_fields(payload)


def _parse_line_fields(payload):
    parsed = {}
    if 'account_id' in payload:
        parsed['account_id'] = parse_id(payload['account_id'], 'account_id')
    if 'amount' in payload:
        parsed['amount'] = parse_number(payload['amount'], 'amount', minimum=0)
    for field in ('date_from', 'date_to'):
        if field in payload:
            parsed[field] = parse_day(payload[field], field)
    if 'label' in payload:
        parsed['label'] = parse_text(payload['label'], 'label')
    if 'analytic_account_id' in payload:
        value = payload['analytic_account_id']
        parsed['analytic_account_id'] = None if value is None else parse_id(value, 'analytic_account_id')
    return parsed


def parse_line_create(payload):
    reject_unknown(payload, LINE_FIELDS)
    require_keys(payload, ('account_id', 'amount'))
    return _parse_line_fields(payload)


def parse_line_patch(payload):
    reject_unknown(payload, LINE_FIELDS)
    return _parse_line_fields(payload)


def parse_distribution(payload):
    """A budget of one account for a period split between cost centers: ``shares`` are ``{analytic_account_id, percent}``."""
    reject_unknown(payload, DISTRIBUTE_FIELDS)
    require_keys(payload, ('account_id', 'amount', 'shares'))
    parsed = _parse_line_fields({key: value for key, value in payload.items() if key != 'shares'})
    shares = payload['shares']
    if not isinstance(shares, list) or not 2 <= len(shares) <= MAX_SHARES:
        raise ApiError(422, 'invalid', f'shares must list 2 to {MAX_SHARES} cost centers', field='shares')
    parsed['shares'] = []
    for index, share in enumerate(shares):
        prefix = f'shares[{index}]'
        if not isinstance(share, dict):
            raise ApiError(422, 'invalid', f'{prefix} must be an object', field=prefix)
        reject_unknown(share, {'analytic_account_id', 'percent'}, prefix=f'{prefix}.')
        require_keys(share, ('analytic_account_id', 'percent'), prefix=f'{prefix}.')
        parsed['shares'].append({
            'analytic_account_id': parse_id(share['analytic_account_id'], f'{prefix}.analytic_account_id'),
            'percent': parse_number(share['percent'], f'{prefix}.percent', minimum=0, maximum=100, exclusive_minimum=True),
        })
    ids = [share['analytic_account_id'] for share in parsed['shares']]
    if len(set(ids)) != len(ids):
        raise ApiError(422, 'invalid', 'a cost center can appear once', field='shares')
    if round(sum(share['percent'] for share in parsed['shares']), 6) != 100:
        raise ApiError(422, 'invalid', 'the shares must add up to 100', field='shares')
    return parsed
