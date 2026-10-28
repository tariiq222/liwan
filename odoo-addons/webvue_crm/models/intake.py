# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import datetime
import io
import zipfile

import openpyxl
from openpyxl.utils.exceptions import InvalidFileException
from psycopg2.errors import UniqueViolation

from odoo import api, models
from odoo.tools import email_normalize, plaintext2html

from odoo.addons.webvue_api.controllers.common import ApiError

MAX_ROWS = 5000
MAX_BYTES = 5 * 1024 * 1024
NAME_MAX = 200
EMAIL_MAX = 254
PREVIEW_ROW_LIMIT = 100
CSV_DELIMITERS = ',;\t'
FIELDS = ('name', 'phone', 'email', 'notes', 'package')
REQUIRED_FIELDS = ('name', 'phone')
FILE_EMPTY = 'the file is empty'
FILE_NO_ROWS = 'the file has no rows'
FILE_TOO_LARGE = 'the file is larger than 5 MB'
FILE_TOO_MANY_ROWS = f'the file has more than {MAX_ROWS} rows'
FILE_NOT_UTF8 = 'the file must be saved as UTF-8'
FILE_BAD_CSV = 'the file is not a valid CSV file'
FILE_BAD_XLSX = 'the file is not a valid XLSX workbook'
READERS = {'.csv': '_webvue_read_csv', '.xlsx': '_webvue_read_xlsx'}


def _file_error(message):
    return ApiError(422, 'invalid', message, field='file')


def _text(value):
    """A cell as text: no decimal point on whole numbers (``501234567.0`` -> ``501234567``)."""
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, datetime.datetime | datetime.date | datetime.time):
        return value.isoformat()
    return str(value).strip()


def _delimiter(text):
    first_line = text.partition('\n')[0]
    return max(CSV_DELIMITERS, key=first_line.count)


def _records(table):
    """Header-keyed dicts of every non-blank data row; 422 on an empty or oversized table."""
    table = iter(table)
    header = next(table, None)
    if header is None:
        raise _file_error(FILE_EMPTY)
    names = [_text(cell) for cell in header]
    rows = []
    for cells in table:
        values = [_text(cell) for cell in cells]
        if not any(values):
            continue
        if len(rows) == MAX_ROWS:
            raise _file_error(FILE_TOO_MANY_ROWS)
        values += [''] * (len(names) - len(values))
        rows.append({name: value for name, value in zip(names, values, strict=False) if name})
    if not rows:
        raise _file_error(FILE_NO_ROWS)
    return rows


class WebVueCrmIntake(models.AbstractModel):
    """Rows in, opportunities out: the one pipeline behind every source of customer rows.

    A file is the first source; Google Sheets and the website form hand over the same list of
    header-keyed dicts and use the same preview and commit.
    """

    _name = 'webvue.crm.intake'
    _description = 'WebVue CRM intake'

    # Reading

    @api.model
    def _webvue_read_rows(self, filename, content):
        """The data rows of a CSV or XLSX file as ``{column header: text}`` dicts, blank rows dropped.

        422 on a file that is too large, has too many rows, is not UTF-8 text or a workbook,
        or has no data. Row ``n`` of the result is row ``n + 1`` of the file when it has no blank rows.
        """
        extension = next((ext for ext in READERS if filename.lower().endswith(ext)), None)
        if extension is None:
            raise ApiError(422, 'invalid', 'the file must be a .csv or .xlsx file', field='file_name')
        if len(content) > MAX_BYTES:
            raise _file_error(FILE_TOO_LARGE)
        return getattr(self, READERS[extension])(content)

    @api.model
    def _webvue_read_csv(self, content):
        try:
            text = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            raise _file_error(FILE_NOT_UTF8) from None
        try:
            return _records(csv.reader(io.StringIO(text, newline=''), delimiter=_delimiter(text)))
        except csv.Error:
            raise _file_error(FILE_BAD_CSV) from None

    @api.model
    def _webvue_read_xlsx(self, content):
        try:
            book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except (zipfile.BadZipFile, InvalidFileException, KeyError, OSError, ValueError):
            raise _file_error(FILE_BAD_XLSX) from None
        try:
            return _records(book.worksheets[0].iter_rows(values_only=True) if book.worksheets else [])
        finally:
            book.close()

    # Checking

    @api.model
    def _webvue_check_mapping(self, rows, mapping):
        """422 on ``mapping`` unless it names name and phone and only columns that exist in ``rows``."""
        missing = [field for field in REQUIRED_FIELDS if not mapping.get(field)]
        if missing:
            raise ApiError(422, 'invalid', f'{missing[0]} column is required', field='mapping')
        unknown = sorted(column for field in FIELDS if (column := mapping.get(field)) and column not in rows[0])
        if unknown:
            raise ApiError(422, 'invalid', f'column {unknown[0]!r} is not in the file', field='mapping')

    @api.model
    def _webvue_packages(self, company):
        """Active packages of ``company`` by trimmed lower-case name (the lowest id wins a tie)."""
        packages = self.env['product.template'].with_company(company).search([
            ('webvue_crm_package', '=', True), '|', ('company_id', '=', False), ('company_id', '=', company.id),
        ], order='id desc')
        return {package.name.strip().lower(): package for package in packages}

    @api.model
    def _webvue_check_rows(self, rows, mapping, company):
        """Judge every row; a list of ``{row, vals, reason, duplicate}`` in file order (the header is row 1).

        ``reason`` is the stable machine code of an invalid row, else False. ``duplicate`` marks a
        valid row whose phone is already on an opportunity of the company or on an earlier valid
        row. A row that is neither invalid nor duplicate becomes an opportunity.
        """
        self._webvue_check_mapping(rows, mapping)
        Lead = self.env['crm.lead']
        packages = self._webvue_packages(company) if mapping.get('package') else {}
        seen = set()
        checked = []
        for number, row in enumerate(rows, start=2):
            vals, reason = self._webvue_row_values(row, mapping, company, packages)
            duplicate = not reason and (vals['phone'] in seen or Lead._webvue_find_duplicate(vals['phone'], company))
            if not reason:
                seen.add(vals['phone'])
            checked.append({'row': number, 'vals': vals, 'reason': reason, 'duplicate': duplicate})
        return checked

    @api.model
    def _webvue_row_values(self, row, mapping, company, packages):
        name = row[mapping['name']]
        raw_phone = row[mapping['phone']]
        email = row[mapping['email']] if mapping.get('email') else ''
        package_name = row[mapping['package']].lower() if mapping.get('package') else ''
        if not name:
            return {}, 'missing_name'
        if len(name) > NAME_MAX:
            return {}, 'name_too_long'
        if not raw_phone:
            return {}, 'missing_phone'
        phone = self.env['crm.lead']._webvue_normalize_phone(raw_phone, company)
        if not phone:
            return {}, 'invalid_phone'
        if email and (len(email) > EMAIL_MAX or not email_normalize(email)):
            return {}, 'invalid_email'
        package = packages.get(package_name, self.env['product.template'])
        if package_name and not package:
            return {}, 'unknown_package'
        notes = row[mapping['notes']] if mapping.get('notes') else ''
        return {
            'name': name, 'phone': phone, 'email': email, 'notes': notes, 'package': package,
        }, False

    # Preview and commit

    @api.model
    def _webvue_preview(self, rows, mapping, company):
        """Counts of new, duplicate and invalid rows, and which rows (file row numbers only).

        Duplicates are listed by row number alone: the existing opportunity, its id and its
        agent may be hidden from the importer and are never disclosed.
        """
        checked = self._webvue_check_rows(rows, mapping, company)
        invalid = [item for item in checked if item['reason']]
        duplicate = [item['row'] for item in checked if item['duplicate']]
        return {
            'new': len(checked) - len(invalid) - len(duplicate),
            'duplicate': len(duplicate),
            'invalid': len(invalid),
            'invalid_rows': [{'row': item['row'], 'reason': item['reason']} for item in invalid[:PREVIEW_ROW_LIMIT]],
            'duplicate_rows': duplicate[:PREVIEW_ROW_LIMIT],
        }

    @api.model
    def _webvue_commit(self, rows, mapping, source, agent, company, user, file_name=''):
        """Create the new rows as opportunities in the first stage, distribute them, record the batch.

        Everything is judged again here. Each opportunity is created in its own savepoint, so a
        phone another request took in the meantime counts as a duplicate and the rest go on.
        """
        company_env = self.with_company(company)
        checked = company_env._webvue_check_rows(rows, mapping, company)
        Lead = company_env.env['crm.lead'].with_context(
            mail_auto_subscribe_no_notify=True, mail_create_nolog=True, tracking_disable=True,
        )
        stage = Lead._webvue_first_stage()
        batch = company_env.env['webvue.crm.import.batch'].create({
            'company_id': company.id, 'user_id': user.id, 'file_name': file_name, 'source_id': source.id,
        })
        created = Lead.browse()
        duplicates = 0
        for item in checked:
            if item['reason'] or item['duplicate']:
                continue
            lead = company_env._webvue_create_unique(Lead, self._webvue_lead_values(item['vals'], company, source, stage, batch))
            created |= lead
            duplicates += not lead
        duplicates += sum(1 for item in checked if item['duplicate'])
        company_env.env['webvue.crm.distribution']._webvue_assign(created, agent=agent)
        batch.write({
            'created_count': len(created),
            'duplicate_count': duplicates,
            'invalid_count': sum(1 for item in checked if item['reason']),
            'unassigned_count': len(created.filtered(lambda lead: not lead.user_id)),
        })
        return batch

    @api.model
    def _webvue_lead_values(self, vals, company, source, stage, batch):
        package = vals['package']
        return {
            'name': vals['name'],
            'contact_name': vals['name'],
            'type': 'opportunity',
            'company_id': company.id,
            'phone': vals['phone'],
            'email_from': vals['email'] or False,
            'description': plaintext2html(vals['notes']) if vals['notes'] else False,
            'source_id': source.id,
            'stage_id': stage.id,
            'user_id': False,
            'webvue_import_batch_id': batch.id,
            'webvue_package_id': package.id,
            'webvue_list_price': package.list_price,
        }

    @api.model
    def _webvue_create_unique(self, Lead, vals):
        """The new opportunity, or an empty recordset when its phone was taken since it was checked."""
        try:
            with self.env.cr.savepoint():
                lead = Lead.create(vals)
                self.env.flush_all()
        except UniqueViolation as error:
            if not Lead._webvue_is_duplicate_phone(error):
                raise
            return Lead.browse()
        return lead
