# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One streaming .xlsx writer for the export routes: several sheets, a header row, typed cells, and the same formula
safety as the CSV export.

XlsxWriter's ``constant_memory`` mode writes each row to a temporary file as soon as the next one starts, so the
rows may be a generator and a 100k-row sheet never sits in memory at once (the finished file does, in
``xlsx_bytes``; pass a path or a binary stream to ``write_xlsx`` to keep that out too).
"""
import datetime
import decimal
import io
import re

import xlsxwriter

from .csv_export import E164, safe_cell

# Constant memory: rows are flushed as written, so they must be written in order, sheet after sheet.
WORKBOOK_OPTIONS = {
    'constant_memory': True,
    'remove_timezone': True,
    'nan_inf_to_errors': True,
}
MAX_ROWS = 1_048_576
SHEET_NAME_MAX = 31
FORBIDDEN_SHEET_CHARS = re.compile(r'[\[\]:*?/\\]')
DATE_FORMAT = 'yyyy-mm-dd'
DATETIME_FORMAT = 'yyyy-mm-dd hh:mm:ss'
# A spreadsheet keeps 15 significant digits of a number; a longer integer (an identifier) is written as text.
MAX_EXACT_INTEGER = 10 ** 15
NUMBER_TYPES = (int, float, decimal.Decimal)


class Sheet:
    """One sheet: its ``name``, a ``header`` row and ``rows``, any iterable of row sequences (a generator is read once)."""

    def __init__(self, name, header, rows):
        self.name = name
        self.header = header
        self.rows = rows


def sheet_name(name):
    """A name Excel accepts: no ``[]:*?/\\``, no apostrophe at either end, at most 31 characters."""
    cleaned = FORBIDDEN_SHEET_CHARS.sub(' ', name).strip("' ").strip()
    return cleaned[:SHEET_NAME_MAX] or 'Sheet'


def write_xlsx(target, sheets, right_to_left=False):
    """Write ``sheets`` to ``target`` (a path or a binary stream), in the order given.

    ``right_to_left`` mirrors every sheet for Arabic. Text is made formula-safe by ``safe_cell``; ``bool``, numbers,
    ``date`` and ``datetime`` are typed cells; ``None`` is an empty cell. Any other value is a ``TypeError`` and a
    sheet longer than Excel allows is a ``ValueError``: nothing is cut silently.
    """
    workbook = xlsxwriter.Workbook(target, WORKBOOK_OPTIONS)
    formats = {
        'header': workbook.add_format({'bold': True}),
        datetime.date: workbook.add_format({'num_format': DATE_FORMAT}),
        datetime.datetime: workbook.add_format({'num_format': DATETIME_FORMAT}),
    }
    seen = set()
    try:
        for sheet in sheets:
            name = sheet_name(sheet.name)
            if name.lower() in seen:
                msg = f'two sheets are named {name!r} once made valid for Excel (names are case-insensitive)'
                raise ValueError(msg)
            seen.add(name.lower())
            _write_sheet(workbook.add_worksheet(name), sheet, formats, right_to_left)
    finally:
        workbook.close()


def xlsx_bytes(sheets, right_to_left=False):
    """The file of ``write_xlsx`` as bytes."""
    buffer = io.BytesIO()
    write_xlsx(buffer, sheets, right_to_left=right_to_left)
    return buffer.getvalue()


def _write_sheet(worksheet, sheet, formats, right_to_left):
    if right_to_left:
        worksheet.right_to_left()
    for column, title in enumerate(sheet.header):
        worksheet.write_string(0, column, safe_cell(str(title)), formats['header'])
    worksheet.freeze_panes(1, 0)
    for index, row in enumerate(sheet.rows, start=1):
        if index >= MAX_ROWS:
            msg = f'sheet {worksheet.get_name()!r} has more rows than a spreadsheet holds ({MAX_ROWS})'
            raise ValueError(msg)
        for column, value in enumerate(row):
            _write_cell(worksheet, index, column, value, formats)


def _write_cell(worksheet, row, column, value, formats):
    if value is None:
        return
    if isinstance(value, bool):
        worksheet.write_boolean(row, column, value)
    elif isinstance(value, datetime.datetime):
        worksheet.write_datetime(row, column, value, formats[datetime.datetime])
    elif isinstance(value, datetime.date):
        worksheet.write_datetime(row, column, value, formats[datetime.date])
    elif isinstance(value, NUMBER_TYPES):
        if isinstance(value, int) and abs(value) >= MAX_EXACT_INTEGER:
            worksheet.write_string(row, column, str(value))
        else:
            worksheet.write_number(row, column, value)
    elif isinstance(value, str):
        # A phone in international form is only digits after its plus sign, so it runs nothing (as phone_cell).
        worksheet.write_string(row, column, value if E164.fullmatch(value) else safe_cell(value))
    else:
        msg = f'cannot write a {type(value).__name__} to a spreadsheet cell'
        raise TypeError(msg)
