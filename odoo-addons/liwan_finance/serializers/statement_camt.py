# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""CAMT.052/053/054 bank statements: the bytes handed to the OCA parser and its answer in the import's line shape.

The parsing itself is ``account.statement.import.camt.parser.parse`` of the pinned OCA/bank-statement-import. This module
has no database access: it refuses what a statement never needs (a document type declaration) and maps the answer.
"""
import re
from datetime import date

DECLARATION = re.compile(r'^\s*(<\?xml[^>]*?)\s+encoding\s*=\s*(["\'])[^"\']*\2')
DOCTYPE = re.compile(r'<!(DOCTYPE|ENTITY)', re.IGNORECASE)
MAX_REFERENCE = 255


class CamtError(ValueError):
    """The file is not a CAMT statement we can read; the message says why."""


def camt_bytes(text):
    """UTF-8 bytes of the text; the text was already decoded, so a declared legacy encoding no longer applies."""
    if DOCTYPE.search(text):
        message = 'a document type declaration is not allowed in a statement file'
        raise CamtError(message)
    return DECLARATION.sub(r'\1', text, count=1).encode()


def _lines(transactions):
    lines, errors = [], []
    for number, transaction in enumerate(transactions, start=1):
        try:
            day = date.fromisoformat(str(transaction['date'])[:10])
        except (KeyError, ValueError):
            errors.append({'row': number, 'field': 'date', 'message': 'not a date'})
            continue
        amount = round(transaction['amount'], 2)
        if not amount:
            errors.append({'row': number, 'field': 'amount', 'message': 'the amount is zero'})
            continue
        reference = ' '.join(str(transaction.get('payment_ref') or '').split())[:MAX_REFERENCE]
        lines.append({'row': number, 'date': day, 'payment_ref': reference or '-', 'amount': amount})
    return lines, errors


def normalize_camt(currency, account_number, statements):
    """The statements the OCA parser read as ``{currency, account_number, balance_start, balance_end, lines, errors}`` each."""
    if not statements:
        message = 'the file has no statement with entries'
        raise CamtError(message)
    normalized = []
    for statement in statements:
        lines, errors = _lines(statement['transactions'])
        normalized.append({
            'currency': currency,
            'account_number': account_number,
            'balance_start': round(statement['balance_start'], 2),
            'balance_end': round(statement['balance_end_real'], 2),
            'lines': lines,
            'errors': errors,
        })
    return normalized
