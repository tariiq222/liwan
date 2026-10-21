# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, http
from odoo.exceptions import MissingError, UserError, ValidationError
from odoo.http import request

from .common import filter_domain, list_page, require_capability
from .finance_partners import company_partners_domain
from .idempotency import idempotent
from .write_support import attempt, company_records
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.bank import (
    dump_bank_line,
    dump_bank_statement_detail,
    dump_bank_statements,
    dump_reconcile_proposal,
    parse_reconcile,
    parse_statement_create,
    parse_statement_patch,
)
from odoo.addons.webvue_finance.serializers.parsing import reject_unknown

# The leftover of a reconciliation is never booked on a receivable or payable account (it would be an unmatched
# item without a document) or on a liquidity account (it would move cash without a statement line).
LEFTOVER_EXCLUDED_TYPES = ('asset_receivable', 'liability_payable', 'asset_cash', 'liability_credit_card')
# Statements are kept for bank journals and for cash boxes (a cash journal's statement is its count sheet).
STATEMENT_JOURNAL_TYPES = ('bank', 'cash')
# The proposals are ranked in Python (exact amount first), so at most this many open items are examined.
MAX_PROPOSAL_CANDIDATES = 1000


def _find_statement(statement_id):
    statement = request.env['account.bank.statement'].search(
        [('id', '=', statement_id), ('company_id', '=', request.env.company.id)], limit=1,
    )
    if not statement:
        raise MissingError(request.env._('account.bank.statement %(id)s does not exist', id=statement_id))
    return statement


def _find_statement_line(line_id):
    line = request.env['account.bank.statement.line'].search(
        [('id', '=', line_id), ('company_id', '=', request.env.company.id)], limit=1,
    )
    if not line:
        raise MissingError(request.env._('account.bank.statement.line %(id)s does not exist', id=line_id))
    return line


def _open_items_domain(line):
    """Posted, unreconciled items of a reconcilable account, on the side of the line's money direction.

    This is the domain of the OCA reconciliation widget for counterparts (``statement_line_id`` excludes
    the statement lines' own journal items); money in clears debit balances, money out credit balances.
    """
    return [
        ('company_id', '=', line.company_id.id), ('parent_state', '=', 'posted'),
        ('account_id.reconcile', '=', True), ('statement_line_id', '!=', line.id),
        ('amount_residual', '>' if line.amount > 0 else '<', 0),
    ]


def _statement_values(parsed):
    journal = company_records(
        'account.journal', [parsed['journal_id']], 'journal_id',
        [('company_id', '=', request.env.company.id), ('type', 'in', STATEMENT_JOURNAL_TYPES)],
    )
    lines = []
    for index, item in enumerate(parsed['lines']):
        values = {'journal_id': journal.id, 'date': item['date'], 'payment_ref': item['payment_ref'], 'amount': item['amount']}
        if 'partner_id' in item:
            values['partner_id'] = company_records(
                'res.partner', [item['partner_id']], f'lines[{index}].partner_id', company_partners_domain(),
            ).id
        lines.append(Command.create(values))
    values = {key: parsed[key] for key in ('date', 'name', 'balance_start', 'balance_end_real') if key in parsed}
    return {**values, 'line_ids': lines}


def _suspense_to_account(line, account, label):
    """Books what the matched items leave over (the suspense line, when there is one) on ``account``."""
    data = line.reconcile_data_info
    for item in data['data']:
        if item['kind'] == 'suspense':
            item.update({
                'kind': 'other', 'account_id': [account.id, account.display_name], 'name': label or item['name'],
            })
    line.reconcile_data_info = line._recompute_suspense_line(
        data['data'], data['reconcile_auxiliary_id'], line.manual_reference,
    )


def _reconcile_line(line, items, account=None, label=None):
    """Matches ``line`` with ``items``; what they leave over is booked on ``account``. 422 ``not_balanced`` when it does not clear."""
    line.reconcile_data_info = line._default_reconcile_data()
    for item in items:
        line._add_account_move_line(item)
    if account:
        _suspense_to_account(line, account, label)
    if not line.reconcile_data_info.get('can_reconcile'):
        raise ApiError(422, 'not_balanced', 'the selected items do not clear the statement line', field='move_line_ids')
    line.reconcile_bank_line()


def _certain_matches(line):
    """The open items that settle ``line`` to the cent and are tied to it by the partner or by the entry number in the reference.

    Matching is only certain when exactly one such item exists; the caller leaves every other line to a person.
    """
    domain = _open_items_domain(line)
    candidates = request.env['account.move.line'].search(domain, limit=MAX_PROPOSAL_CANDIDATES)
    currency = line.company_id.currency_id
    reference = (line.payment_ref or '').lower()
    partners = (line.partner_id | line.partner_id.commercial_partner_id) if line.partner_id else request.env['res.partner']
    exact = candidates.filtered(
        lambda item: line.currency_id == currency and currency.is_zero(abs(item.amount_residual) - abs(line.amount)),
    )
    return exact.filtered(
        lambda item: (item.partner_id and item.partner_id in partners)
        or (item.move_id.name and item.move_id.name != '/' and item.move_id.name.lower() in reference),
    )


class FinanceBankController(http.Controller):
    """Bank statements and their reconciliation over stock statements and OCA account_reconcile_oca.

    CSV files are imported by ``finance_bank_import``. Not covered: OFX and CAMT files, reconcile models and rules, matching a line
    with several partners, foreign-currency exchange differences and undoing a reconciliation.
    """

    @http.route('/api/v1/finance/bank-statements', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_bank_statements(self, **_):
        """Bank statements, filtered by ``journal_id`` and ``date_from``/``date_to``."""
        require_capability('finance.bank.read')
        args = request.httprequest.args
        domain = [('company_id', '=', request.env.company.id), *filter_domain(args, 'date')]
        if args.get('journal_id'):
            domain.append(('journal_id', '=', parse_positive_int(args['journal_id'], 'journal_id')))
        return list_page('account.bank.statement', domain, dump_bank_statements)

    @http.route('/api/v1/finance/bank-statements/<int:statement_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_bank_statement(self, statement_id, **_):
        """A bank statement with its lines."""
        require_capability('finance.bank.read')
        return dump_bank_statement_detail(_find_statement(statement_id))

    @http.route('/api/v1/finance/bank-statements', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    @idempotent
    def create_bank_statement(self, **payload):
        """A bank statement with its lines, on a bank journal of the current company."""
        require_capability('finance.bank.manage')
        values = _statement_values(parse_statement_create(payload))
        statement = attempt(lambda: request.env['account.bank.statement'].create(values))
        return request.make_json_response(dump_bank_statement_detail(statement), status=201)

    @http.route(
        '/api/v1/finance/bank-statement-lines/<int:line_id>/reconcile-proposals',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def reconcile_proposals(self, line_id, **_):
        """Open items to match, the exact-amount ones first, then the newest; the line's partner narrows them."""
        require_capability('finance.bank.read')
        line = _find_statement_line(line_id)
        domain = _open_items_domain(line)
        if line.partner_id:
            domain.append(('partner_id', 'in', (line.partner_id | line.partner_id.commercial_partner_id).ids))
        candidates = request.env['account.move.line'].search(domain, order='date desc, id desc', limit=MAX_PROPOSAL_CANDIDATES)
        proposals = [dump_reconcile_proposal(item, line) for item in candidates]
        proposals.sort(key=lambda proposal: not proposal['exact'])
        limit, offset = parse_page(request.httprequest.args)
        return {'items': proposals[offset:offset + limit], 'total': len(proposals)}

    @http.route(
        '/api/v1/finance/bank-statement-lines/<int:line_id>/reconcile',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def reconcile(self, line_id, **payload):
        """Matches the line with open items; what they leave over is booked on ``account_id``.

        When nothing is left over, ``account_id`` is not needed (and not used). Otherwise, without it, the
        items do not clear the line: 422 ``not_balanced``. ``account_id`` is a company account that is neither
        receivable, payable nor liquidity (else 422 ``invalid`` on that field).
        """
        require_capability('finance.bank.manage')
        line = _find_statement_line(line_id)
        parsed = parse_reconcile(payload)
        if line.is_reconciled:
            raise ApiError(422, 'invalid_state', 'the statement line is already reconciled')
        items = company_records('account.move.line', parsed['move_line_ids'], 'move_line_ids', _open_items_domain(line))
        account = None
        if 'account_id' in parsed:
            account = company_records(
                'account.account', [parsed['account_id']], 'account_id',
                [('company_ids', 'in', [line.company_id.id]), ('account_type', 'not in', LEFTOVER_EXCLUDED_TYPES)],
            )

        attempt(lambda: _reconcile_line(line, items, account, parsed.get('label')), day=line.date)
        return dump_bank_line(line)

    @http.route('/api/v1/finance/bank-statements/<int:statement_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_bank_statement(self, statement_id, **payload):
        """Corrects the name and the opening and closing balances of a statement."""
        require_capability('finance.bank.manage')
        statement = _find_statement(statement_id)
        values = parse_statement_patch(payload)
        attempt(lambda: statement.write(values), day=statement.date, journal=statement.journal_id)
        request.env['webvue.finance.audit.event']._webvue_log('bank_statement_changed', statement, fields_written=values)
        return dump_bank_statement_detail(statement)

    @http.route('/api/v1/finance/bank-statements/<int:statement_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def delete_bank_statement(self, statement_id, **_):
        """Removes a statement none of whose lines is reconciled: undo the reconciliations first (422 ``has_reconciliations``)."""
        require_capability('finance.bank.manage')
        statement = _find_statement(statement_id)
        reconciled = statement.line_ids.filtered('is_reconciled')
        if reconciled:
            raise ApiError(422, 'has_reconciliations', 'undo the reconciliation of its lines first', details={'line_ids': reconciled.ids})
        journal, day = statement.journal_id, statement.date
        attempt(statement.unlink, day=day, journal=journal)
        # The statement is gone, so the event names its journal.
        request.env['webvue.finance.audit.event']._webvue_log('bank_statement_deleted', journal, outcome=f'statement {statement_id}')
        return request.make_json_response('', status=204)

    @http.route(
        '/api/v1/finance/bank-statement-lines/<int:line_id>/unreconcile',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unreconcile(self, line_id, **_):
        """Undoes a reconciliation. The journal's reconcile mode decides how: ``edit`` removes the matching and the
        entries made for it, ``keep`` leaves them and reverses the matched entries."""
        require_capability('finance.bank.manage')
        line = _find_statement_line(line_id)
        if not line.is_reconciled:
            raise ApiError(422, 'invalid_state', 'the statement line is not reconciled')
        attempt(line.unreconcile_bank_line, day=line.date, journal=line.journal_id)
        request.env['webvue.finance.audit.event']._webvue_log('bank_line_unreconciled', line)
        return dump_bank_line(line)

    @http.route('/api/v1/finance/bank-statements/<int:statement_id>/auto-reconcile', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def auto_reconcile(self, statement_id, **payload):
        """Matches the statement's open lines that have exactly one certain item; everything else is left for review.

        A line is certain when one open item clears it to the cent and is tied to it by the same partner or by its entry
        number in the line reference. Without ``apply: true`` nothing is written and the answer is what would happen.
        A line that is ambiguous (several candidates), unmatched (none) or refused by Odoo (``failed``) is listed in
        ``review`` with its reason, never guessed.
        """
        require_capability('finance.bank.manage')
        reject_unknown(payload, {'apply'})
        apply = payload.get('apply', False)
        if not isinstance(apply, bool):
            raise ApiError(422, 'invalid', 'apply must be a boolean', field='apply')
        statement = _find_statement(statement_id)
        matched, review = [], []
        for line in statement.line_ids.filtered(lambda item: not item.is_reconciled):
            candidates = _certain_matches(line)
            if len(candidates) != 1:
                review.append({'line_id': line.id, 'reason': 'ambiguous' if candidates else 'no_match', 'candidates': candidates.ids})
                continue
            if apply:
                try:
                    with request.env.cr.savepoint():
                        _reconcile_line(line, candidates)
                except (ApiError, UserError, ValidationError) as error:
                    review.append({'line_id': line.id, 'reason': 'failed', 'candidates': candidates.ids, 'message': str(error)})
                    continue
            matched.append({'line_id': line.id, 'move_line_id': candidates.id, 'entry': candidates.move_id.name})
        if apply and matched:
            request.env['webvue.finance.audit.event']._webvue_log('bank_statement_auto_reconciled', statement, outcome=f'{len(matched)} lines')
        return {'applied': apply, 'matched': matched, 'review': review}
