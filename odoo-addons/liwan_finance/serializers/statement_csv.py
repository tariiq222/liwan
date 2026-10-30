# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bank statement files in CSV: reading, column mapping and row validation, with no database access.

A bank exports its own layout, so the caller names the columns (``mapping``) after a preview that proposes them from
the header. Rows are validated one by one and every problem is reported with its row number, so a file is accepted
whole or not at all.
"""
import csv
import io
import re
from datetime import datetime

from .parsing import parse_text
from odoo.addons.liwan_api.controllers.common import ApiError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 5000
DELIMITERS = (',', ';', '\t', '|')
DATE_FORMATS = {
    'YYYY-MM-DD': '%Y-%m-%d', 'DD/MM/YYYY': '%d/%m/%Y', 'DD-MM-YYYY': '%d-%m-%Y',
    'MM/DD/YYYY': '%m/%d/%Y', 'YYYY/MM/DD': '%Y/%m/%d', 'DD.MM.YYYY': '%d.%m.%Y',
}
DECIMAL_SEPARATORS = ('.', ',')
MAPPING_KEYS = ('date', 'payment_ref', 'amount', 'debit', 'credit')
# Header words banks use, per field; the first column that contains one is proposed.
HEADER_HINTS = {
    'date': ('date', 'التاريخ', 'تاريخ'),
    'payment_ref': ('description', 'details', 'narration', 'reference', 'البيان', 'الوصف', 'التفاصيل', 'المرجع'),
    'amount': ('amount', 'المبلغ'),
    'debit': ('debit', 'withdrawal', 'مدين', 'سحب'),
    'credit': ('credit', 'deposit', 'دائن', 'إيداع'),
}
EASTERN_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩٫٬', '0123456789.,')
NUMBER = re.compile(r'[+-]?\d+(\.\d+)?')


def _refuse(message, field):
    raise ApiError(422, 'invalid', message, field=field)


def read_table(content, delimiter=None):
    """``(delimiter, rows)`` of the file: lists of cell strings, empty lines dropped."""
    if not isinstance(content, str) or not content.strip():
        _refuse('content must be the text of a CSV file', 'content')
    if len(content.encode()) > MAX_BYTES:
        _refuse(f'the file is larger than {MAX_BYTES // (1024 * 1024)} MiB', 'content')
    text = content.lstrip('﻿')
    if any(ord(char) < 32 and char not in '\t\r\n' for char in text):
        _refuse('the file is not readable text', 'content')
    if delimiter is None:
        delimiter = _detect_delimiter(text)
    elif delimiter not in DELIMITERS:
        _refuse(f'delimiter must be one of {", ".join(repr(item) for item in DELIMITERS)}', 'delimiter')
    rows = [[cell.strip() for cell in row] for row in csv.reader(io.StringIO(text), delimiter=delimiter) if any(cell.strip() for cell in row)]
    if not rows:
        _refuse('the file has no rows', 'content')
    if len(rows) > MAX_ROWS + 1:
        _refuse(f'the file has more than {MAX_ROWS} rows', 'content')
    return delimiter, rows


def _detect_delimiter(text):
    first_lines = '\n'.join(text.splitlines()[:5])
    return max(DELIMITERS, key=first_lines.count)


def suggest_mapping(header):
    """The column of each field that the header names suggest; fields with no match are left out."""
    mapping = {}
    for field, hints in HEADER_HINTS.items():
        for column in header:
            if column not in mapping.values() and any(hint in column.lower() for hint in hints):
                mapping[field] = column
                break
    return mapping


def _column_index(spec, header, field):
    """The index of a mapped column: a header name, or a zero-based position when the file has no header."""
    if header is not None and isinstance(spec, str):
        if spec not in header:
            _refuse(f'mapping.{field} names a column that is not in the header', f'mapping.{field}')
        return header.index(spec)
    if not isinstance(spec, int) or isinstance(spec, bool) or spec < 0:
        _refuse(f'mapping.{field} must name a column', f'mapping.{field}')
    return spec


def parse_mapping(mapping, header):
    """``{field: column index}`` once the mapping is checked: date, a reference, and an amount or debit and credit."""
    if not isinstance(mapping, dict):
        _refuse('mapping must be an object', 'mapping')
    unknown = sorted(set(mapping) - set(MAPPING_KEYS))
    if unknown:
        _refuse(f'unknown mapping key: {unknown[0]}', f'mapping.{unknown[0]}')
    for field in ('date', 'payment_ref'):
        if field not in mapping:
            _refuse(f'mapping.{field} is required', f'mapping.{field}')
    if ('amount' in mapping) == ('debit' in mapping or 'credit' in mapping):
        _refuse('map either amount or debit and credit', 'mapping.amount')
    if 'amount' not in mapping and ('debit' not in mapping or 'credit' not in mapping):
        _refuse('debit and credit must be mapped together', 'mapping.debit')
    return {field: _column_index(spec, header, field) for field, spec in mapping.items()}


def parse_options(payload):
    date_format = payload.get('date_format', 'YYYY-MM-DD')
    if date_format not in DATE_FORMATS:
        _refuse(f'date_format must be one of {", ".join(DATE_FORMATS)}', 'date_format')
    decimal = payload.get('decimal_separator', '.')
    if decimal not in DECIMAL_SEPARATORS:
        _refuse('decimal_separator must be "." or ","', 'decimal_separator')
    has_header = payload.get('has_header', True)
    if not isinstance(has_header, bool):
        _refuse('has_header must be a boolean', 'has_header')
    return DATE_FORMATS[date_format], decimal, has_header


def parse_cell_date(text, date_format):
    return datetime.strptime(text.translate(EASTERN_DIGITS).strip(), date_format).date()


def parse_cell_amount(text, decimal):
    """A number from a bank cell: thousands separators, a trailing or leading sign, parentheses and Arabic-Indic digits."""
    value = text.translate(EASTERN_DIGITS).strip().replace(' ', '')
    negative = (value.startswith('(') and value.endswith(')')) or value.endswith('-') or value.startswith('-')
    value = value.strip('()').strip('+-')
    thousands = ',' if decimal == '.' else '.'
    value = value.replace(thousands, '').replace(decimal, '.')
    if not NUMBER.fullmatch(value):
        raise ValueError(text)
    return -float(value) if negative else float(value)


def parse_rows(rows, columns, date_format, decimal):
    """``(lines, errors)``: the valid statement lines (row number first) and every row-level problem."""
    lines, errors = [], []
    for number, row in rows:
        def cell(field):
            index = columns.get(field)
            return row[index] if index is not None and index < len(row) else ''

        try:
            day = parse_cell_date(cell('date'), date_format)
        except ValueError:
            errors.append({'row': number, 'field': 'date', 'message': 'not a date in the chosen format'})
            continue
        reference = cell('payment_ref') or '-'
        try:
            if 'amount' in columns:
                amount = parse_cell_amount(cell('amount'), decimal)
            else:
                credit = parse_cell_amount(cell('credit'), decimal) if cell('credit') else 0.0
                debit = parse_cell_amount(cell('debit'), decimal) if cell('debit') else 0.0
                amount = abs(credit) - abs(debit)
        except ValueError:
            errors.append({'row': number, 'field': 'amount', 'message': 'not a number'})
            continue
        if not amount:
            errors.append({'row': number, 'field': 'amount', 'message': 'the amount is zero'})
            continue
        lines.append({'row': number, 'date': day, 'payment_ref': parse_text(reference[:255], 'payment_ref'), 'amount': round(amount, 2)})
    return lines, errors
