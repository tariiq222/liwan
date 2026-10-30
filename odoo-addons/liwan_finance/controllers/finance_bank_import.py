# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bank statement import from a CSV file: a preview that writes nothing, then the import that checks the balances."""
from collections import Counter

from odoo import http
from odoo.http import request

from .common import require_capability
from .finance_bank import STATEMENT_JOURNAL_TYPES, _statement_values
from .idempotency import idempotent
from .write_support import attempt, company_records
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
from odoo.addons.liwan_finance.serializers.statement_csv import (
    parse_mapping,
    parse_options,
    parse_rows,
    read_table,
    suggest_mapping,
)

FILE_FIELDS = frozenset({'journal_id', 'content', 'delimiter', 'has_header', 'mapping', 'date_format', 'decimal_separator'})
IMPORT_FIELDS = FILE_FIELDS | {'name', 'balance_start', 'balance_end_real', 'skip_duplicates'}
SAMPLE_ROWS = 5


def _journal(parsed_id):
    return company_records(
        'account.journal', [parsed_id], 'journal_id',
        [('company_id', '=', request.env.company.id), ('type', 'in', STATEMENT_JOURNAL_TYPES)],
    )


def _mark_duplicates(journal, lines):
    """Flag the lines the journal already holds: same day, amount and reference, counted occurrence by occurrence.

    Two identical lines in one file are both legitimate (two coffees, one day) as long as the journal holds fewer
    copies than the file has seen so far.
    """
    if not lines:
        return
    existing = Counter()
    for line in request.env['account.bank.statement.line'].search([
        ('journal_id', '=', journal.id),
        ('date', '>=', min(line['date'] for line in lines)), ('date', '<=', max(line['date'] for line in lines)),
    ]):
        existing[line.date, round(line.amount, 2), line.payment_ref or '-'] += 1
    seen = Counter()
    for line in lines:
        key = (line['date'], line['amount'], line['payment_ref'])
        seen[key] += 1
        line['duplicate'] = existing[key] >= seen[key]


def _read_file(payload, allowed):
    reject_unknown(payload, allowed)
    require_keys(payload, ('journal_id', 'content'))
    journal = _journal(parse_id(payload['journal_id'], 'journal_id'))
    delimiter, rows = read_table(payload['content'], payload.get('delimiter'))
    date_format, decimal, has_header = parse_options(payload)
    header = rows[0] if has_header else None
    return journal, delimiter, rows, header, date_format, decimal, has_header


def _dump_line(line):
    return {
        'row': line['row'], 'date': dump_day(line['date']), 'payment_ref': line['payment_ref'],
        'amount': line['amount'], 'duplicate': line['duplicate'],
    }


def _parse_file(payload, allowed):
    """``(journal, lines, errors, header, delimiter, rows)`` of a mapped file; lines carry their ``duplicate`` flag."""
    journal, delimiter, rows, header, date_format, decimal, has_header = _read_file(payload, allowed)
    columns = parse_mapping(payload.get('mapping'), header)
    numbered = [(index + 1, row) for index, row in enumerate(rows)][1 if has_header else 0:]
    lines, errors = parse_rows(numbered, columns, date_format, decimal)
    _mark_duplicates(journal, lines)
    return journal, lines, errors, header, delimiter, rows


class FinanceBankImportController(http.Controller):

    @http.route('/api/v1/finance/bank-statements/import/preview', type='json2', auth='user', methods=['POST'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def preview_bank_import(self, **payload):
        """Read a CSV file and write nothing.

        Without ``mapping`` the answer is the header, a few rows and the columns the header suggests. With it, every line the
        import would create (flagged when the journal already holds it), every row-level problem and the totals.
        """
        require_capability('finance.bank.manage')
        if 'mapping' not in payload:
            journal, delimiter, rows, header, _date_format, _decimal, has_header = _read_file(payload, FILE_FIELDS)
            return {
                'delimiter': delimiter, 'columns': header or [str(index) for index in range(max(map(len, rows)))],
                'sample': rows[1 if has_header else 0:][:SAMPLE_ROWS],
                'suggested_mapping': suggest_mapping(header) if header else {},
                'row_count': len(rows) - (1 if has_header else 0),
            }
        journal, lines, errors, header, delimiter, _rows = _parse_file(payload, FILE_FIELDS)
        kept = [line for line in lines if not line['duplicate']]
        return {
            'delimiter': delimiter,
            'columns': header or [],
            'lines': [_dump_line(line) for line in lines],
            'errors': errors,
            'summary': {
                'lines': len(lines), 'duplicates': len(lines) - len(kept),
                'total': journal.currency_id.round(sum(line['amount'] for line in kept)) if journal.currency_id else round(sum(line['amount'] for line in kept), 2),
                'date_from': dump_day(min((line['date'] for line in lines), default=None)),
                'date_to': dump_day(max((line['date'] for line in lines), default=None)),
            },
        }

    @http.route('/api/v1/finance/bank-statements/import', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    @idempotent
    def import_bank_statement(self, **payload):
        """Create one statement from a CSV file, whole or not at all.

        Refused (422) when a row is unreadable (``invalid_rows``), when the journal already holds some of the lines and
        ``skip_duplicates`` is not set (``duplicate_lines``), or when the opening balance plus the lines is not the closing
        balance (``balance_mismatch``).
        """
        require_capability('finance.bank.manage')
        require_keys(payload, ('balance_start', 'balance_end_real'))
        journal, lines, errors, _header, _delimiter, _rows = _parse_file(payload, IMPORT_FIELDS)
        if errors:
            raise ApiError(422, 'invalid_rows', 'the file has rows that cannot be read', details={'errors': errors})
        skip = payload.get('skip_duplicates', False)
        if not isinstance(skip, bool):
            raise ApiError(422, 'invalid', 'skip_duplicates must be a boolean', field='skip_duplicates')
        duplicates = [line['row'] for line in lines if line['duplicate']]
        if duplicates and not skip:
            raise ApiError(422, 'duplicate_lines', 'the journal already holds some of these lines', details={'rows': duplicates})
        kept = [line for line in lines if not line['duplicate']]
        if not kept:
            raise ApiError(422, 'invalid', 'the file has no new lines to import', field='content')
        start = parse_number(payload['balance_start'], 'balance_start')
        end = parse_number(payload['balance_end_real'], 'balance_end_real')
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
            'lines': [{key: line[key] for key in ('date', 'payment_ref', 'amount')} for line in kept],
        }
        if 'name' in payload:
            parsed['name'] = parse_text(payload['name'], 'name', required=True)
        values = _statement_values(parsed)
        statement = attempt(lambda: request.env['account.bank.statement'].create(values))
        request.env['liwan.finance.audit.event']._liwan_log('bank_statement_imported', statement, outcome=f'{len(kept)} lines')
        return request.make_json_response(dump_bank_statement_detail(statement), status=201)
