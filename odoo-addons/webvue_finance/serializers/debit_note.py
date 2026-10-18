# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .parsing import parse_bool, parse_day, parse_text, reject_unknown

FIELDS = frozenset({'reason', 'date', 'copy_lines'})


def parse_debit_note(payload):
    """The optional ``reason``, ``date`` (Odoo defaults to today) and ``copy_lines`` (default false)."""
    reject_unknown(payload, FIELDS)
    parsed = {'copy_lines': parse_bool(payload.get('copy_lines', False), 'copy_lines')}
    if 'reason' in payload:
        parsed['reason'] = parse_text(payload['reason'], 'reason')
    if 'date' in payload:
        parsed['date'] = parse_day(payload['date'], 'date')
    return parsed
