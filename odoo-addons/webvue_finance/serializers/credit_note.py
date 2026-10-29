# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .parsing import parse_day, parse_text, reject_unknown

FIELDS = frozenset({'reason', 'date'})


def parse_credit_note(payload):
    """The optional ``reason`` and ``date`` (Odoo defaults to today); the reversal always copies the lines."""
    reject_unknown(payload, FIELDS)
    parsed = {}
    if 'reason' in payload:
        parsed['reason'] = parse_text(payload['reason'], 'reason')
    if 'date' in payload:
        parsed['date'] = parse_day(payload['date'], 'date')
    return parsed
