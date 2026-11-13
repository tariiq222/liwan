# Part of Odoo. See LICENSE file for full copyright and licensing details.
import datetime
import decimal
import io
from unittest.mock import patch

import openpyxl

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.serializers import xlsx_export
from odoo.addons.liwan_api.serializers.xlsx_export import Sheet, sheet_name, xlsx_bytes


def load(content, **kwargs):
    return openpyxl.load_workbook(io.BytesIO(content), **kwargs)


@tagged('post_install', '-at_install', 'liwan')
class TestXlsxExport(TransactionCase):

    def test_sheets_header_and_rows_round_trip_in_order(self):
        content = xlsx_bytes([
            Sheet('First', ['name', 'city'], [['Ali', 'Riyadh'], ['سارة', 'جدة']]),
            Sheet('Second', ['id'], [[1], [2]]),
        ])
        workbook = load(content)
        self.assertEqual(workbook.sheetnames, ['First', 'Second'])
        self.assertEqual(list(workbook['First'].values), [('name', 'city'), ('Ali', 'Riyadh'), ('سارة', 'جدة')])
        self.assertEqual(list(workbook['Second'].values), [('id',), (1,), (2,)])

    def test_dates_and_numbers_are_typed_cells(self):
        day = datetime.date(2026, 11, 13)
        moment = datetime.datetime(2026, 11, 13, 9, 30, 15)
        content = xlsx_bytes([Sheet('Types', ['d', 'dt', 'int', 'float', 'dec', 'flag', 'none'], [
            [day, moment, 7, 1.5, decimal.Decimal('2.25'), True, None],
        ])])
        cells = next(iter(load(content)['Types'].iter_rows(min_row=2, max_row=2)))
        self.assertEqual(cells[0].value, datetime.datetime(2026, 11, 13))
        self.assertEqual(cells[0].number_format, xlsx_export.DATE_FORMAT)
        self.assertEqual(cells[1].value, moment)
        self.assertEqual(cells[1].number_format, xlsx_export.DATETIME_FORMAT)
        self.assertEqual([cell.value for cell in cells[2:]], [7, 1.5, 2.25, True, None])
        self.assertEqual([cell.data_type for cell in cells[2:4]], ['n', 'n'])
        self.assertEqual(cells[5].data_type, 'b')

    def test_a_timezone_aware_datetime_is_written(self):
        moment = datetime.datetime(2026, 11, 13, 9, 30, tzinfo=datetime.timezone.utc)
        content = xlsx_bytes([Sheet('Zone', ['at'], [[moment]])])
        self.assertEqual(load(content)['Zone']['A2'].value, moment.replace(tzinfo=None))

    def test_a_formula_looking_cell_is_neutralised_like_the_csv_export(self):
        hostile = ['=HYPERLINK("http://x")', '+cmd', '-1+1', '@SUM(A1)', '\tx', '\rx']
        content = xlsx_bytes([Sheet('Hostile', ['=H'], [[value] for value in hostile])])
        sheet = load(content)['Hostile']
        self.assertEqual(sheet['A1'].value, "'=H")
        for row, value in enumerate(hostile, start=2):
            with self.subTest(value=value):
                cell = sheet.cell(row=row, column=1)
                # The file format escapes a carriage return; the cell is still text.
                self.assertEqual((cell.data_type, cell.value), ('s', f"'{value}".replace('\r', '_x000D_')))

    def test_a_phone_in_international_form_stays_plain_text(self):
        cells = ['+966501234567', '+9665012345x', '+1+1']
        sheet = load(xlsx_bytes([Sheet('Phones', ['phone'], [[value] for value in cells])]))['Phones']
        self.assertEqual([sheet.cell(row=row, column=1).value for row in (2, 3, 4)], ['+966501234567', "'+9665012345x", "'+1+1"])

    def test_a_long_integer_is_text_so_no_digit_is_lost(self):
        number = 12345678901234567890
        cell = load(xlsx_bytes([Sheet('Big', ['n'], [[number]])]))['Big']['A2']
        self.assertEqual((cell.data_type, cell.value), ('s', str(number)))

    def test_an_unsupported_value_is_refused(self):
        with self.assertRaises(TypeError):
            xlsx_bytes([Sheet('Bad', ['x'], [[object()]])])

    def test_a_sheet_over_the_spreadsheet_limit_is_refused_not_cut(self):
        with patch.object(xlsx_export, 'MAX_ROWS', 3), self.assertRaises(ValueError):
            xlsx_bytes([Sheet('Long', ['x'], [[1], [2], [3]])])

    def test_the_right_to_left_option_mirrors_every_sheet(self):
        for option in (True, False):
            with self.subTest(right_to_left=option):
                workbook = load(xlsx_bytes([Sheet('A', ['x'], []), Sheet('B', ['x'], [])], right_to_left=option))
                self.assertEqual([sheet.sheet_view.rightToLeft or False for sheet in workbook.worksheets], [option] * 2)

    def test_sheet_names_are_made_valid_for_excel(self):
        self.assertEqual(sheet_name('a/b:c*d?e[f]g\\h'), 'a b c d e f g h')
        self.assertEqual(sheet_name("'quoted'"), 'quoted')
        self.assertEqual(len(sheet_name('x' * 50)), xlsx_export.SHEET_NAME_MAX)
        self.assertEqual(sheet_name('///'), 'Sheet')

    def test_two_sheets_with_the_same_name_once_made_valid_are_refused(self):
        for names in (('Same', 'same'), ('a/b', 'a:b'), ('x' * 40, 'x' * 35)):
            with self.subTest(names=names), self.assertRaises(ValueError):
                xlsx_bytes([Sheet(name, ['x'], []) for name in names])

    def test_the_workbook_is_built_in_constant_memory_mode(self):
        built = []
        real = xlsx_export.xlsxwriter.Workbook

        def spy(*args, **kwargs):
            built.append(real(*args, **kwargs))
            return built[-1]

        with patch.object(xlsx_export.xlsxwriter, 'Workbook', side_effect=spy):
            xlsx_bytes([Sheet('Rows', ['n'], [[1]])])
        self.assertTrue(xlsx_export.WORKBOOK_OPTIONS['constant_memory'])
        self.assertTrue(built[0].constant_memory)

    def test_a_hundred_thousand_rows_are_read_from_the_generator_one_at_a_time(self):
        produced = []

        def rows():
            for number in range(100_000):
                produced.append(number)
                yield [number, f'row {number}']

        content = xlsx_bytes([Sheet('Many', ['n', 'text'], rows())])
        self.assertEqual(len(produced), 100_000)
        sheet = load(content, read_only=True)['Many']
        self.assertEqual(sheet.max_row, 100_001)
        last = next(iter(sheet.iter_rows(min_row=100_001, max_row=100_001, values_only=True)))
        self.assertEqual(last, (99_999, 'row 99999'))
