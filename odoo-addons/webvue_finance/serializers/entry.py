# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .analytic import distribution_shares, parse_distribution
from .common import dump_day, dump_ref
from .parsing import (
    parse_day,
    parse_id,
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
)
from odoo.addons.webvue_api.controllers.common import ApiError

LINE_FIELDS = frozenset({'account_id', 'partner_id', 'name', 'debit', 'credit', 'analytic_distribution'})
EDITABLE_FIELDS = frozenset({'journal_id', 'date', 'ref', 'lines'})


def dump_entry(move):
    return {
        'id': move.id,
        'name': move.name,
        'state': move.state,
        'date': dump_day(move.date),
        'ref': move.ref or '',
        'journal': dump_ref(move.journal_id),
        'currency': move.currency_id.name,
        'amount_total': move.amount_total,
    }


def dump_entry_line(line, shares):
    return {
        'id': line.id,
        'account': dump_ref(line.account_id),
        'partner': dump_ref(line.partner_id),
        'name': line.name or '',
        'debit': line.debit,
        'credit': line.credit,
        'analytic_distribution': shares[line],
    }


def dump_entry_detail(move):
    shares = distribution_shares(move.line_ids)
    return {**dump_entry(move), 'lines': [dump_entry_line(line, shares) for line in move.line_ids]}


def dump_entries(moves):
    return [dump_entry(move) for move in moves]


def _parse_line(raw, index):
    prefix = f'lines[{index}]'
    if not isinstance(raw, dict):
        raise ApiError(422, 'invalid', f'{prefix} must be an object', field=prefix)
    reject_unknown(raw, LINE_FIELDS, prefix=f'{prefix}.')
    require_keys(raw, ('account_id', 'name'), prefix=f'{prefix}.')
    line = {
        'account_id': parse_id(raw['account_id'], f'{prefix}.account_id'),
        'name': parse_text(raw['name'], f'{prefix}.name', required=True),
        'debit': parse_number(raw.get('debit', 0), f'{prefix}.debit', minimum=0),
        'credit': parse_number(raw.get('credit', 0), f'{prefix}.credit', minimum=0),
    }
    if (line['debit'] > 0) == (line['credit'] > 0):
        raise ApiError(422, 'invalid', f'{prefix} needs exactly one of debit or credit above zero', field=prefix)
    if raw.get('partner_id') is not None:
        line['partner_id'] = parse_id(raw['partner_id'], f'{prefix}.partner_id')
    if 'analytic_distribution' in raw:
        line['analytic_distribution'] = parse_distribution(raw['analytic_distribution'], f'{prefix}.analytic_distribution')
    return line


def _parse_editable(payload):
    """Validate the editable keys present in ``payload`` (shape only; records and balance are the route's)."""
    parsed = {}
    if 'journal_id' in payload:
        parsed['journal_id'] = parse_id(payload['journal_id'], 'journal_id')
    if 'date' in payload:
        parsed['date'] = parse_day(payload['date'], 'date')
    if 'ref' in payload:
        parsed['ref'] = parse_text(payload['ref'], 'ref')
    if 'lines' in payload:
        raw = payload['lines']
        if not isinstance(raw, list) or not raw:
            raise ApiError(422, 'invalid', 'lines must be a non-empty list', field='lines')
        parsed['lines'] = [_parse_line(line, index) for index, line in enumerate(raw)]
    return parsed


def parse_entry_create(payload):
    reject_unknown(payload, EDITABLE_FIELDS)
    require_keys(payload, ('journal_id', 'date', 'lines'))
    return _parse_editable(payload)


def parse_entry_patch(payload):
    reject_unknown(payload, EDITABLE_FIELDS)
    return _parse_editable(payload)
