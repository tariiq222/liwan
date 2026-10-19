# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, http
from odoo.exceptions import MissingError
from odoo.http import request

from .analytic_support import distribution_values, require_plain_distributions
from .common import filter_domain, list_page, parse_choice, require_capability
from .finance_partners import company_partners_domain
from .write_support import (
    attempt,
    company_records,
    is_period_locked,
    period_locked,
    require_state,
)
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.entry import (
    dump_entries,
    dump_entry_detail,
    parse_entry_create,
    parse_entry_patch,
)
from odoo.addons.webvue_finance.serializers.parsing import require_nonempty


def manual_entries_domain():
    """The company's manual journal entries.

    Entries that Odoo generates stay out: the journal entry of a payment or bank statement line (and
    its reversals), the cash-basis tax entries and the exchange-difference entries. Invoices are not
    ``entry`` moves at all.
    """
    return [
        ('company_id', '=', request.env.company.id),
        ('move_type', '=', 'entry'),
        ('origin_payment_id', '=', False),
        ('statement_line_id', '=', False),
        ('tax_cash_basis_origin_move_id', '=', False),
        ('tax_cash_basis_rec_id', '=', False),
        ('exchange_diff_partial_ids', '=', False),
        '|', ('reversed_entry_id', '=', False),
        '&', ('reversed_entry_id.origin_payment_id', '=', False), ('reversed_entry_id.statement_line_id', '=', False),
    ]


def _find_entry(entry_id):
    entry = request.env['account.move'].search([('id', '=', entry_id), *manual_entries_domain()], limit=1)
    if not entry:
        raise MissingError(request.env._('account.move %(id)s does not exist', id=entry_id))
    return entry


def _require_balanced(lines):
    """The debits equal the credits in the company currency, else 422 ``unbalanced`` before Odoo is called."""
    currency = request.env.company.currency_id
    debit = sum(line['debit'] for line in lines)
    credit = sum(line['credit'] for line in lines)
    if currency.compare_amounts(debit, credit):
        raise ApiError(
            422, 'unbalanced', 'the total debit must equal the total credit', field='lines',
            details={'debit': currency.round(debit), 'credit': currency.round(credit)},
        )


def _line_command(line, index):
    values = {key: line[key] for key in ('name', 'debit', 'credit')}
    values['account_id'] = company_records(
        'account.account', [line['account_id']], f'lines[{index}].account_id',
        [('company_ids', 'in', [request.env.company.id])],
    ).id
    if 'partner_id' in line:
        values['partner_id'] = company_records(
            'res.partner', [line['partner_id']], f'lines[{index}].partner_id', company_partners_domain(),
        ).id
    if 'analytic_distribution' in line:
        values['analytic_distribution'] = distribution_values(
            line['analytic_distribution'], f'lines[{index}].analytic_distribution',
        )
    return Command.create(values)


def _entry_values(parsed):
    """ORM values for the parsed keys of a create/patch body; related records are checked in the company."""
    values = {key: parsed[key] for key in ('date',) if key in parsed}
    if 'ref' in parsed:
        values['ref'] = parsed['ref'] or False
    if 'journal_id' in parsed:
        values['journal_id'] = company_records(
            'account.journal', [parsed['journal_id']], 'journal_id',
            [('company_id', '=', request.env.company.id), ('type', '=', 'general')],
        ).id
    if 'lines' in parsed:
        _require_balanced(parsed['lines'])
        # A body that carries lines replaces every existing line of the entry.
        values['line_ids'] = [
            Command.clear(),
            *(_line_command(line, index) for index, line in enumerate(parsed['lines'])),
        ]
    return values


def _require_open_period(day, journal):
    """Odoo would silently move the date of an entry in a closed period when it posts, so refuse it up front."""
    if is_period_locked(day, journal):
        raise period_locked(field='date')


def _reconciled_lines(entry):
    return entry.line_ids.filtered(lambda line: line.matched_debit_ids or line.matched_credit_ids)


def _require_no_reconciliations(entry):
    """A posted entry whose lines are reconciled cannot be reset: POST .../unreconcile first."""
    lines = _reconciled_lines(entry)
    if lines:
        raise ApiError(
            422, 'has_reconciliations', 'the entry has reconciled lines: POST /entries/<id>/unreconcile first',
            details={'line_ids': lines.ids},
        )


class FinanceEntryController(http.Controller):

    @http.route('/api/v1/finance/entries', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_entries(self, **_):
        require_capability('finance.entries.read')
        args = request.httprequest.args
        domain = manual_entries_domain() + filter_domain(args, 'date')
        state = parse_choice(args.get('state'), request.env['account.move']._fields['state'].get_values(request.env), 'state')
        if state:
            domain.append(('state', '=', state))
        if args.get('journal_id'):
            domain.append(('journal_id', '=', parse_positive_int(args['journal_id'], 'journal_id')))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', ('name', 'ilike', query), ('ref', 'ilike', query)]
        return list_page('account.move', domain, dump_entries)

    @http.route('/api/v1/finance/entries/<int:entry_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_entry(self, entry_id):
        require_capability('finance.entries.read')
        return dump_entry_detail(_find_entry(entry_id))

    @http.route('/api/v1/finance/entries', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_entry(self, **payload):
        require_capability('finance.entries.manage')
        parsed = parse_entry_create(payload)
        values = _entry_values(parsed)
        values['move_type'] = 'entry'
        journal = request.env['account.journal'].browse(values['journal_id'])
        _require_open_period(values['date'], journal)
        entry = attempt(lambda: request.env['account.move'].create(values), day=values['date'], journal=journal)
        return request.make_json_response(dump_entry_detail(entry), status=201)

    @http.route('/api/v1/finance/entries/<int:entry_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_entry(self, entry_id, **payload):
        require_capability('finance.entries.manage')
        entry = _find_entry(entry_id)
        require_nonempty(payload)
        require_state(entry, 'draft', 'not_draft')
        parsed = parse_entry_patch(payload)
        if 'lines' in parsed:
            require_plain_distributions(entry.line_ids)
        values = _entry_values(parsed)
        day = values.get('date') or entry.date
        journal = request.env['account.journal'].browse(values.get('journal_id') or entry.journal_id.id)
        _require_open_period(day, journal)
        attempt(lambda: entry.write(values), day=day, journal=journal)
        return dump_entry_detail(entry)

    @http.route('/api/v1/finance/entries/<int:entry_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def delete_entry(self, entry_id, **_):
        require_capability('finance.entries.manage')
        entry = _find_entry(entry_id)
        require_state(entry, 'draft', 'not_draft')
        attempt(entry.unlink, day=entry.date, journal=entry.journal_id)
        return request.make_json_response('', status=204)

    @http.route('/api/v1/finance/entries/<int:entry_id>/post', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def post_entry(self, entry_id, **_):
        require_capability('finance.entries.post')
        entry = _find_entry(entry_id)
        require_state(entry, 'draft', 'not_draft')
        _require_open_period(entry.date, entry.journal_id)
        attempt(entry.action_post, day=entry.date, journal=entry.journal_id)
        return dump_entry_detail(entry)

    @http.route('/api/v1/finance/entries/<int:entry_id>/reset-to-draft', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def reset_entry_to_draft(self, entry_id, **_):
        require_capability('finance.entries.post')
        entry = _find_entry(entry_id)
        if entry.state == 'draft':
            raise ApiError(422, 'invalid_state', 'the entry is already a draft')
        _require_no_reconciliations(entry)
        attempt(entry.button_draft, day=entry.date, journal=entry.journal_id)
        return dump_entry_detail(entry)

    @http.route('/api/v1/finance/entries/<int:entry_id>/unreconcile', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unreconcile_entry(self, entry_id, **_):
        """Remove the reconciliation of the entry's lines (Odoo's public ``remove_move_reconcile``)."""
        require_capability('finance.entries.post')
        entry = _find_entry(entry_id)
        lines = _reconciled_lines(entry)
        if not lines:
            raise ApiError(422, 'invalid_state', 'the entry has no reconciled lines')
        counterparts = (lines.matched_debit_ids.debit_move_id | lines.matched_credit_ids.credit_move_id).move_id
        for move in entry | counterparts:
            _require_open_period(move.date, move.journal_id)
        attempt(lines.remove_move_reconcile, day=entry.date, journal=entry.journal_id)
        return dump_entry_detail(entry)
