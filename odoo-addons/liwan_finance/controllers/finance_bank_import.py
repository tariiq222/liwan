# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bank statement import from a CSV, OFX or CAMT file: a preview that writes nothing, then the import that checks the balances."""
from collections import Counter

from odoo import http
from odoo.http import request

from .common import require_capability
from .finance_bank import STATEMENT_JOURNAL_TYPES, _creation_outcome, _statement_values
from .idempotency import idempotent
from .write_support import attempt, company_records
from odoo.addons.base.models.res_bank import sanitize_account_number
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_finance.serializers.bank import dump_bank_statement_detail
from odoo.addons.liwan_finance.serializers.common import dump_day
from odoo.addons.liwan_finance.serializers.parsing import (
    parse_id,
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
)
from odoo.addons.liwan_finance.serializers.statement_camt import (
    CamtError,
    camt_bytes,
    normalize_camt,
)
from odoo.addons.liwan_finance.serializers.statement_csv import (
    parse_mapping,
    parse_options,
    parse_rows,
    read_table,
    suggest_mapping,
)
from odoo.addons.liwan_finance.serializers.statement_file import (
    file_format,
    read_text,
    refuse,
)
from odoo.addons.liwan_finance.serializers.statement_ofx import OfxError, parse_ofx

CSV_FIELDS = frozenset({'delimiter', 'has_header', 'mapping', 'date_format', 'decimal_separator'})
FILE_FIELDS = CSV_FIELDS | {'journal_id', 'content', 'format'}
IMPORT_FIELDS = FILE_FIELDS | {'name', 'balance_start', 'balance_end_real', 'skip_duplicates'}
LINE_KEYS = ('date', 'payment_ref', 'amount', 'unique_import_id')
SAMPLE_ROWS = 5


def _journal(parsed_id):
    return company_records(
        'account.journal', [parsed_id], 'journal_id',
        [('company_id', '=', request.env.company.id), ('type', 'in', STATEMENT_JOURNAL_TYPES)],
    )


def _open(payload, allowed):
    """``(journal, format)`` of a request once its fields are checked; CSV options belong to CSV files only."""
    reject_unknown(payload, allowed)
    require_keys(payload, ('journal_id', 'content'))
    journal = _journal(parse_id(payload['journal_id'], 'journal_id'))
    fmt = file_format(payload)
    stray = sorted(CSV_FIELDS & payload.keys()) if fmt != 'csv' else []
    if stray:
        refuse(f'{stray[0]} applies to CSV files only', stray[0])
    return journal, fmt


def _mark_duplicates(journal, lines):
    """Flag the lines the journal already holds: same day, amount and reference, counted occurrence by occurrence.

    Two identical lines in one file are both legitimate (two coffees, one day) as long as the journal holds fewer
    copies than the file has seen so far. A line that carries the bank's own transaction id (OFX ``FITID``) is judged by
    that id alone: a manual line with the same day, amount and text must not hide it. A journal line that an id of the file
    matches is reserved for that id and is not counted again for the lines without one, whatever their order in the file.
    """
    if not lines:
        return
    file_ids = [line['unique_import_id'] for line in lines if 'unique_import_id' in line]
    if len(set(file_ids)) != len(file_ids):
        refuse('the file has two transactions with the same id', 'content')
    existing = Counter()
    for line in request.env['account.bank.statement.line'].search([
        ('journal_id', '=', journal.id),
        ('date', '>=', min(line['date'] for line in lines)), ('date', '<=', max(line['date'] for line in lines)),
    ]):
        if line.unique_import_id not in file_ids:
            existing[line.date, round(line.amount, 2), line.payment_ref or '-'] += 1
    known_ids = set(request.env['account.bank.statement.line'].search([('unique_import_id', 'in', file_ids)]).mapped('unique_import_id'))
    seen = Counter()
    for line in lines:
        if 'unique_import_id' in line:
            line['duplicate'] = line['unique_import_id'] in known_ids
            continue
        key = (line['date'], line['amount'], line['payment_ref'])
        seen[key] += 1
        line['duplicate'] = existing[key] >= seen[key]


def _camt_statements(text):
    data = camt_bytes(text)
    try:
        parsed = request.env['account.statement.import.camt.parser'].parse(data)
    except (ValueError, LookupError, TypeError, AttributeError):
        message = 'the file is not a readable CAMT statement'
        raise CamtError(message) from None
    return normalize_camt(text, *parsed)


def _statement(journal, fmt, content):
    """The one statement of an OFX or CAMT file, in the journal's currency; its lines carry ``unique_import_id`` when the bank gave ids."""
    text = read_text(content)
    try:
        statements = parse_ofx(text) if fmt == 'ofx' else _camt_statements(text)
    except (OfxError, CamtError) as error:
        refuse(str(error), 'content')
    if len(statements) > 1:
        refuse(f'the file holds {len(statements)} statements; import one at a time', 'content')
    statement = statements[0]
    currency = journal.currency_id or journal.company_id.currency_id
    if statement['currency'] and statement['currency'].upper() != currency.name:
        refuse(f'the file is in {statement["currency"]} but the journal is in {currency.name}', 'journal_id')
    _check_account(journal, statement['account_number'])
    for line in statement['lines']:
        if line.get('fitid'):
            line['unique_import_id'] = f'{journal.id}-{fmt}-{line["fitid"]}'
    return statement


def _check_account(journal, file_account):
    """422 ``account_mismatch`` when the file's account and the journal's bank account are both known and differ.

    The numbers are compared without spaces and in capitals; a local account number matches the IBAN that ends with it.
    A file with no account number, or a journal with no bank account, is accepted.
    """
    journal_account = sanitize_account_number(journal.bank_account_id.acc_number or '')
    file_account = sanitize_account_number(file_account or '')
    if journal_account and file_account and not (journal_account.endswith(file_account) or file_account.endswith(journal_account)):
        raise ApiError(422, 'account_mismatch', 'the file belongs to another bank account than the journal', field='journal_id')


def _file_balances(journal, fmt, statement, lines):
    """``(opening, closing)`` for the lines the import would create, as far as the file lets us know them.

    CAMT states both: the opening balance moves by the lines the journal already holds. OFX states only the closing
    balance, so the opening one is where the journal's latest statement ended (``None`` when it has none).
    """
    if fmt == 'csv':
        return None, None
    currency = journal.currency_id or journal.company_id.currency_id
    if fmt == 'camt':
        skipped = sum(line['amount'] for line in lines if line['duplicate'])
        opening = statement['balance_start']
        return (None if opening is None else currency.round(opening + skipped)), statement['balance_end']
    latest = request.env['account.bank.statement'].search([('journal_id', '=', journal.id)], order='date desc, id desc', limit=1)
    return (currency.round(latest.balance_end_real) if latest else None), statement['balance_end']


def _read_lines(journal, fmt, payload):
    """Every line the file holds with its ``duplicate`` flag, the row problems and the balances the file suggests."""
    shape = {'delimiter': None, 'columns': []}
    if fmt == 'csv':
        delimiter, rows = read_table(payload['content'], payload.get('delimiter'))
        date_format, decimal, has_header = parse_options(payload)
        header = rows[0] if has_header else None
        columns = parse_mapping(payload.get('mapping'), header)
        numbered = [(index + 1, row) for index, row in enumerate(rows)][1 if has_header else 0:]
        lines, errors = parse_rows(numbered, columns, date_format, decimal)
        shape = {'delimiter': delimiter, 'columns': header or []}
        statement = None
    else:
        statement = _statement(journal, fmt, payload['content'])
        lines, errors = statement['lines'], statement['errors']
    _mark_duplicates(journal, lines)
    start, end = _file_balances(journal, fmt, statement, lines)
    return {**shape, 'format': fmt, 'lines': lines, 'errors': errors, 'balance_start': start, 'balance_end_real': end}


def _dump_line(line):
    return {
        'row': line['row'], 'date': dump_day(line['date']), 'payment_ref': line['payment_ref'],
        'amount': line['amount'], 'duplicate': line['duplicate'],
    }


def _balances(payload, read):
    """The opening and closing balance to check: the caller's, else the file's; refused when neither is known."""
    values = []
    for field in ('balance_start', 'balance_end_real'):
        value = payload[field] if field in payload else read[field]
        if value is None:
            raise ApiError(422, 'invalid', f'{field} is required', field=field)
        values.append(parse_number(value, field))
    return values


class FinanceBankImportController(http.Controller):

    @http.route('/api/v1/finance/bank-statements/import/preview', type='json2', auth='user', methods=['POST'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def preview_bank_import(self, **payload):
        """Read a CSV, OFX or CAMT file and write nothing.

        The format is the ``format`` named, else the one the file shows. An OFX or CAMT file answers at once with every line
        the import would create (flagged when the journal already holds it), every row-level problem, the totals and the
        balances the file suggests. A CSV file without ``mapping`` answers the header, a few rows and the columns the header
        suggests; with it, the same as the others.
        """
        require_capability('finance.bank.manage')
        journal, fmt = _open(payload, FILE_FIELDS)
        if fmt == 'csv' and 'mapping' not in payload:
            delimiter, rows = read_table(payload['content'], payload.get('delimiter'))
            _date_format, _decimal, has_header = parse_options(payload)
            header = rows[0] if has_header else None
            return {
                'format': fmt, 'delimiter': delimiter, 'columns': header or [str(index) for index in range(max(map(len, rows)))],
                'sample': rows[1 if has_header else 0:][:SAMPLE_ROWS],
                'suggested_mapping': suggest_mapping(header) if header else {},
                'row_count': len(rows) - (1 if has_header else 0),
            }
        read = _read_lines(journal, fmt, payload)
        lines = read['lines']
        kept = [line for line in lines if not line['duplicate']]
        total = sum(line['amount'] for line in kept)
        return {
            'format': fmt,
            'delimiter': read['delimiter'],
            'columns': read['columns'],
            'lines': [_dump_line(line) for line in lines],
            'errors': read['errors'],
            'balance_start': read['balance_start'],
            'balance_end_real': read['balance_end_real'],
            'summary': {
                'lines': len(lines), 'duplicates': len(lines) - len(kept),
                'total': journal.currency_id.round(total) if journal.currency_id else round(total, 2),
                'date_from': dump_day(min((line['date'] for line in lines), default=None)),
                'date_to': dump_day(max((line['date'] for line in lines), default=None)),
            },
        }

    @http.route('/api/v1/finance/bank-statements/import', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    @idempotent
    def import_bank_statement(self, **payload):
        """Create one statement from a CSV, OFX or CAMT file, whole or not at all.

        Refused (422) when a row is unreadable (``invalid_rows``), when the journal already holds some of the lines and
        ``skip_duplicates`` is not set (``duplicate_lines``), or when the opening balance plus the lines is not the closing
        balance (``balance_mismatch``). The balances are the caller's; an OFX or CAMT file supplies those the caller omits.
        """
        require_capability('finance.bank.manage')
        journal, fmt = _open(payload, IMPORT_FIELDS)
        read = _read_lines(journal, fmt, payload)
        if read['errors']:
            raise ApiError(422, 'invalid_rows', 'the file has rows that cannot be read', details={'errors': read['errors']})
        skip = payload.get('skip_duplicates', False)
        if not isinstance(skip, bool):
            raise ApiError(422, 'invalid', 'skip_duplicates must be a boolean', field='skip_duplicates')
        lines = read['lines']
        duplicates = [line['row'] for line in lines if line['duplicate']]
        if duplicates and not skip:
            raise ApiError(422, 'duplicate_lines', 'the journal already holds some of these lines', details={'rows': duplicates})
        kept = [line for line in lines if not line['duplicate']]
        if not kept:
            raise ApiError(422, 'invalid', 'the file has no new lines to import', field='content')
        start, end = _balances(payload, read)
        currency = journal.currency_id or journal.company_id.currency_id
        expected = currency.round(start + sum(line['amount'] for line in kept))
        if currency.compare_amounts(expected, end):
            raise ApiError(
                422, 'balance_mismatch', 'the opening balance plus the lines is not the closing balance',
                field='balance_end_real', details={'expected': expected, 'given': end},
            )
        parsed = {
            'journal_id': journal.id,
            'date': max(line['date'] for line in kept),
            'balance_start': start,
            'balance_end_real': end,
            'lines': [{key: line[key] for key in LINE_KEYS if key in line} for line in kept],
        }
        if 'name' in payload:
            parsed['name'] = parse_text(payload['name'], 'name', required=True)
        values = _statement_values(parsed)
        statement = attempt(lambda: request.env['account.bank.statement'].create(values))
        request.env['liwan.finance.audit.event']._liwan_log(
            'bank_statement_imported', statement, outcome=f'{fmt.upper()} file, {_creation_outcome(statement)}',
        )
        return request.make_json_response(dump_bank_statement_detail(statement), status=201)
