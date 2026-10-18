# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day, dump_ref
from .parsing import (
    parse_day,
    parse_id,
    parse_id_list,
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
)
from odoo.addons.webvue_api.controllers.common import ApiError

STATEMENT_FIELDS = frozenset({'journal_id', 'date', 'name', 'balance_start', 'balance_end_real', 'lines'})
STATEMENT_LINE_FIELDS = frozenset({'date', 'payment_ref', 'partner_id', 'amount'})
RECONCILE_FIELDS = frozenset({'move_line_ids', 'account_id', 'label'})
MAX_STATEMENT_LINES = 500


def dump_bank_line(line):
    return {
        'id': line.id,
        'date': dump_day(line.date),
        'payment_ref': line.payment_ref or '',
        'partner': dump_ref(line.partner_id),
        'amount': line.amount,
        'is_reconciled': line.is_reconciled,
        'amount_residual': line.amount_residual,
    }


def dump_bank_statement(statement):
    return {
        'id': statement.id,
        'name': statement.name or '',
        'date': dump_day(statement.date),
        'journal': dump_ref(statement.journal_id),
        'currency': statement.currency_id.name,
        'balance_start': statement.balance_start,
        'balance_end': statement.balance_end,
        'balance_end_real': statement.balance_end_real,
        'lines_count': len(statement.line_ids),
    }


def dump_bank_statements(statements):
    return [dump_bank_statement(statement) for statement in statements]


def dump_bank_statement_detail(statement):
    return {
        **dump_bank_statement(statement),
        'lines': [dump_bank_line(line) for line in statement.line_ids.sorted(lambda line: (line.date, line.sequence, line.id))],
    }


def dump_reconcile_proposal(move_line, statement_line):
    """An open journal item the statement line could be matched with; ``exact`` when it clears the line to the cent."""
    company_currency = move_line.company_currency_id
    return {
        'id': move_line.id,
        'date': dump_day(move_line.date),
        'entry': move_line.move_id.name or '',
        'label': move_line.name or '',
        'partner': dump_ref(move_line.partner_id),
        'account': dump_ref(move_line.account_id),
        'amount_residual': move_line.amount_residual,
        'exact': (
            statement_line.currency_id == company_currency
            and company_currency.is_zero(abs(move_line.amount_residual) - abs(statement_line.amount))
        ),
    }


def _parse_statement_line(item, index):
    prefix = f'lines[{index}].'
    if not isinstance(item, dict):
        raise ApiError(422, 'invalid', f'lines[{index}] must be an object', field=f'lines[{index}]')
    reject_unknown(item, STATEMENT_LINE_FIELDS, prefix)
    require_keys(item, ('date', 'payment_ref', 'amount'), prefix)
    amount = parse_number(item['amount'], prefix + 'amount')
    if not amount:
        raise ApiError(422, 'invalid', f'{prefix}amount must not be zero', field=prefix + 'amount')
    parsed = {
        'date': parse_day(item['date'], prefix + 'date'),
        'payment_ref': parse_text(item['payment_ref'], prefix + 'payment_ref', required=True),
        'amount': amount,
    }
    if item.get('partner_id') is not None:
        parsed['partner_id'] = parse_id(item['partner_id'], prefix + 'partner_id')
    return parsed


def parse_statement_create(payload):
    """Validate a bank statement body (shape only; the journal and partners are resolved by the route)."""
    reject_unknown(payload, STATEMENT_FIELDS)
    require_keys(payload, ('journal_id', 'date', 'lines'))
    lines = payload['lines']
    if not isinstance(lines, list) or not lines:
        raise ApiError(422, 'invalid', 'lines must be a non-empty list', field='lines')
    if len(lines) > MAX_STATEMENT_LINES:
        raise ApiError(422, 'invalid', f'lines must have at most {MAX_STATEMENT_LINES} items', field='lines')
    parsed = {
        'journal_id': parse_id(payload['journal_id'], 'journal_id'),
        'date': parse_day(payload['date'], 'date'),
        'lines': [_parse_statement_line(item, index) for index, item in enumerate(lines)],
    }
    if 'name' in payload:
        parsed['name'] = parse_text(payload['name'], 'name', required=True)
    for field in ('balance_start', 'balance_end_real'):
        if field in payload:
            parsed[field] = parse_number(payload[field], field)
    return parsed


def parse_reconcile(payload):
    """Validate a reconciliation body: journal items to match and/or the account for the remainder."""
    reject_unknown(payload, RECONCILE_FIELDS)
    parsed = {
        'move_line_ids': parse_id_list(payload['move_line_ids'], 'move_line_ids') if 'move_line_ids' in payload else [],
    }
    if payload.get('account_id') is not None:
        parsed['account_id'] = parse_id(payload['account_id'], 'account_id')
    if 'label' in payload:
        parsed['label'] = parse_text(payload['label'], 'label', required=True)
    if not parsed['move_line_ids'] and 'account_id' not in parsed:
        raise ApiError(422, 'invalid', 'move_line_ids or account_id is required', field='move_line_ids')
    if 'label' in parsed and 'account_id' not in parsed:
        raise ApiError(422, 'invalid', 'label needs account_id', field='label')
    return parsed
