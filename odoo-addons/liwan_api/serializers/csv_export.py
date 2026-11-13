# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Spreadsheet-safe CSV cells shared by the export routes: text a spreadsheet will not run as a formula, phones that
keep their plus sign, and one column per custom field of the properties engine."""
import csv
import io
import re

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.properties import dump_values

FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')
E164 = re.compile(r'\+[0-9]{6,15}')
# What separates the option keys of a multi-valued property in one cell.
OPTION_SEPARATOR = ', '
# The most rows one export file holds; a larger result is refused, never cut.
EXPORT_MAX_ROWS = 50_000
# Property types written as plain numbers.
NUMBER_TYPES = ('integer', 'float')


def refuse_oversized_export(row_count):
    """422 ``export_too_large`` when the filters keep more than ``EXPORT_MAX_ROWS`` rows. Called with the count, before
    any record is loaded."""
    if row_count > EXPORT_MAX_ROWS:
        raise ApiError(
            422, 'export_too_large', 'too many rows to export: narrow the filters',
            details={'rows': row_count, 'max_rows': EXPORT_MAX_ROWS},
        )


def safe_cell(value):
    """A text cell a spreadsheet will not run as a formula."""
    return f"'{value}" if value.startswith(FORMULA_PREFIXES) else value


def phone_cell(value):
    """A phone in international form is only digits after its plus sign, so it runs nothing.

    A leading tab keeps a spreadsheet from reading it as a number and dropping the plus sign.
    """
    return f'\t{value}' if E164.fullmatch(value) else safe_cell(value)


def property_headers(definition):
    """The header of one column per defined property."""
    return [safe_cell(item['string']) for item in definition]


def property_cells(record, field_name, definition):
    """One cell per defined property of ``record``'s properties field: its label form, formula-safe, empty when unset."""
    values = dump_values(record, field_name)
    return [_cell(item, values.get(item['name'])) for item in definition]


def csv_bytes(header, rows):
    """UTF-8 bytes with a byte-order mark, so a spreadsheet reads Arabic text correctly."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    writer.writerows(rows)
    return b'\xef\xbb\xbf' + buffer.getvalue().encode('utf-8')


def _cell(item, value):
    """A number stays a number a spreadsheet can add up; every text form is made formula-safe."""
    if item['type'] in NUMBER_TYPES and value is not None:
        return value
    return safe_cell(_text(item, value))


def _text(item, value):
    """A property value in its text form: option labels, true/false, ISO dates (``dump_values``)."""
    if value is None:
        return ''
    if item['type'] == 'tags':
        labels = _labels(item)
        return OPTION_SEPARATOR.join(labels.get(key, key) for key in value)
    if item['type'] == 'selection':
        return _labels(item).get(value, value)
    if item['type'] == 'boolean':
        return 'true' if value else 'false'
    return str(value)


def _labels(item):
    """The option label of every option key of a selection or tags property."""
    return {pair[0]: pair[1] for pair in item.get(item['type']) or ()}
