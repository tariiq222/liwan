# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import filter_domain, list_page, parse_choice, require_capability
from .finance_invoices import company_invoices_domain
from .finance_partners import company_partners_domain
from .idempotency import idempotent
from .write_support import attempt, company_records, is_period_locked, period_locked
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.payment import (
    counterpart_lines,
    dump_payment,
    dump_payments,
    parse_payment_allocation,
    parse_payment_patch,
    parse_payment_register,
    parse_payment_standalone,
)

PAYMENT_JOURNAL_TYPES = ('bank', 'cash', 'credit')
# Cancelled and rejected payments are final; only they can be reset to draft.
REVIVABLE_STATES = ('canceled', 'rejected')


def _company_payments_domain():
    """Companies already pinned by this operation's capability gate."""
    return [('company_id', 'in', request.env.companies.ids)]


def _find_payment(payment_id):
    payment = request.env['account.payment'].search(
        [('id', '=', payment_id), *_company_payments_domain()], limit=1,
    )
    if not payment:
        raise MissingError(request.env._('account.payment %(id)s does not exist', id=payment_id))
    return payment


def _payable_invoices(invoice_ids):
    """The posted invoices of one partner, currency and kind: the registration pays them as a single batch.

    A single move type keeps the direction of the money and the sign of every residual the same:
    invoices are never paid together with credit notes or with the other side's documents.
    """
    invoices = company_records('account.move', invoice_ids, 'invoice_ids', company_invoices_domain())
    if invoices.filtered(lambda invoice: invoice.state != 'posted'):
        raise ApiError(422, 'not_posted', 'only posted invoices can be paid', field='invoice_ids')
    if len(invoices.commercial_partner_id) != 1 or len(invoices.currency_id) != 1:
        raise ApiError(422, 'invalid', 'invoices paid together must share one partner and one currency', field='invoice_ids')
    if len(set(invoices.mapped('move_type'))) != 1:
        raise ApiError(422, 'invalid', 'invoices paid together must all have the same document type', field='invoice_ids')
    return invoices


def _created_payments(action):
    """The payments the registration wizard opened: one ``res_id`` or a ``domain`` of ids."""
    payments = request.env['account.payment']
    if 'res_id' in action:
        return payments.browse(action['res_id'])
    return payments.search(action['domain'])


def _wizard_values(parsed, invoices):
    # Registration mutates existing invoices. The chosen journal must be
    # natively compatible with every owner; a sibling's journal cannot serve
    # another branch merely because both are visible in the request.
    journal_domain = [('type', 'in', PAYMENT_JOURNAL_TYPES)]
    for company in invoices.company_id:
        journal_domain += request.env['account.journal']._check_company_domain(company)
    journal = company_records('account.journal', [parsed['journal_id']], 'journal_id', journal_domain)
    if journal.currency_id and journal.currency_id != invoices.currency_id:
        raise ApiError(
            422, 'journal_currency_mismatch', 'the journal currency differs from the invoices currency', field='journal_id',
        )
    values = {
        'journal_id': journal.id,
        'payment_date': parsed['payment_date'],
        'amount': parsed['amount'],
        'group_payment': True,
    }
    if 'payment_method_line_id' in parsed:
        values['payment_method_line_id'] = company_records(
            'account.payment.method.line', [parsed['payment_method_line_id']], 'payment_method_line_id',
            [('journal_id', '=', journal.id)],
        ).id
    if 'memo' in parsed:
        values['communication'] = parsed['memo']
    # Odoo does not refuse a payment in a closed period: it silently moves the payment date.
    for company in invoices.company_id:
        if is_period_locked(parsed['payment_date'], journal, company=company):
            raise period_locked(field='payment_date')
    residual = sum(invoices.mapped('amount_residual'))
    if invoices.currency_id.compare_amounts(parsed['amount'], residual) > 0:
        raise ApiError(422, 'amount_exceeds_residual', 'amount is greater than the open balance', field='amount')
    return values, journal


def _payment_journal(journal_id, company=None):
    # Standalone creation stays current-company-only. Existing payments use
    # their owner and stock ancestor compatibility, within native visibility.
    domain = (request.env['account.journal']._check_company_domain(company)
              if company is not None else [('company_id', '=', request.env.company.id)])
    return company_records(
        'account.journal', [journal_id], 'journal_id',
        [*domain, ('type', 'in', PAYMENT_JOURNAL_TYPES)],
    )


def _method_line(method_line_id, journal):
    return company_records(
        'account.payment.method.line', [method_line_id], 'payment_method_line_id', [('journal_id', '=', journal.id)],
    ).id


def _payment_values(parsed, journal, company):
    """The ``account.payment`` values of the keys present in ``parsed``; the journal is already resolved."""
    values = {}
    for key, field in (('amount', 'amount'), ('payment_date', 'date'), ('memo', 'memo'), ('payment_type', 'payment_type')):
        if key in parsed:
            values[field] = parsed[key]
    if 'journal_id' in parsed:
        values['journal_id'] = journal.id
    if 'payment_method_line_id' in parsed:
        values['payment_method_line_id'] = _method_line(parsed['payment_method_line_id'], journal)
    if 'payment_date' in parsed and is_period_locked(parsed['payment_date'], journal, company=company):
        # Odoo does not refuse a payment in a closed period: it silently moves the payment date.
        raise period_locked(field='payment_date')
    return values


def _open_counterpart(payment):
    """The unreconciled receivable or payable items of a posted payment: what can be set against documents."""
    if payment.state not in ('in_process', 'paid'):
        raise ApiError(422, 'invalid_state', 'only a posted payment can be allocated')
    lines = counterpart_lines(payment).filtered(lambda line: not line.reconciled)
    if not lines:
        raise ApiError(422, 'nothing_to_allocate', 'the payment has no unallocated balance')
    return lines


def _lines_to_settle(payment_lines, documents, field):
    """The open items of ``documents`` on the account of ``payment_lines`` (same partner and currency), or 422 on ``field``."""
    account = payment_lines.account_id
    if len(account) != 1 or len(documents.commercial_partner_id) != 1 or documents.commercial_partner_id != payment_lines.partner_id.commercial_partner_id:
        raise ApiError(422, 'invalid', 'the payment and the documents must belong to the same partner', field=field)
    if documents.currency_id != payment_lines.currency_id:
        raise ApiError(422, 'invalid', 'the payment and the documents must share one currency', field=field)
    lines = documents.line_ids.filtered(lambda line: line.account_id == account and not line.reconciled)
    if not lines:
        raise ApiError(422, 'invalid', 'the documents have nothing open on the payment account', field=field)
    return lines


class FinancePaymentController(http.Controller):

    @http.route('/api/v1/finance/payments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_payments(self, **_):
        require_capability('finance.payments.read')
        args = request.httprequest.args
        fields = request.env['account.payment']._fields
        domain = [*_company_payments_domain(), *filter_domain(args, 'date')]
        for field in ('payment_type', 'state'):
            value = parse_choice(args.get(field), fields[field].get_values(request.env), field)
            if value:
                domain.append((field, '=', value))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', '|', ('name', 'ilike', query), ('memo', 'ilike', query), ('partner_id.name', 'ilike', query)]
        return list_page('account.payment', domain, dump_payments)

    @http.route('/api/v1/finance/payments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    @idempotent
    def register_payment(self, **payload):
        require_capability('finance.payments.manage')
        parsed = parse_payment_register(payload)
        invoices = _payable_invoices(parsed['invoice_ids'])
        values, journal = _wizard_values(parsed, invoices)

        def register():
            wizard = request.env['account.payment.register'].with_context(
                active_model='account.move', active_ids=invoices.ids,
            ).create(values)
            return wizard.action_create_payments()

        payments = _created_payments(attempt(
            register, day=parsed['payment_date'], journal=journal,
            company=invoices.company_id,
        ))
        if len(payments) != 1:
            raise ApiError(422, 'invalid', 'these invoices cannot be paid with a single payment', field='invoice_ids')
        return request.make_json_response(dump_payment(payments), status=201)

    @http.route('/api/v1/finance/payments/<int:payment_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def cancel_payment(self, payment_id, **_):
        require_capability('finance.payments.manage')
        payment = _find_payment(payment_id)
        if payment.state in REVIVABLE_STATES:
            raise ApiError(422, 'invalid_state', f'the payment is already {payment.state}')
        attempt(payment.action_cancel, day=payment.date, journal=payment.journal_id, company=payment.company_id)
        return dump_payment(payment)

    @http.route('/api/v1/finance/payments/<int:payment_id>/reset-to-draft', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def reset_payment_to_draft(self, payment_id, **_):
        require_capability('finance.payments.manage')
        payment = _find_payment(payment_id)
        if payment.state not in REVIVABLE_STATES:
            raise ApiError(422, 'invalid_state', 'only a cancelled or rejected payment can be reset to draft')
        attempt(payment.action_draft, day=payment.date, journal=payment.journal_id, company=payment.company_id)
        return dump_payment(payment)

    @http.route('/api/v1/finance/payments/standalone', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    @idempotent
    def create_standalone_payment(self, **payload):
        """A receipt or payment voucher that names no invoice: an advance, or money kept to be allocated later."""
        require_capability('finance.payments.manage')
        parsed = parse_payment_standalone(payload)
        partner = company_records('res.partner', [parsed['partner_id']], 'partner_id', company_partners_domain(request.env.company))
        journal = _payment_journal(parsed['journal_id'])
        values = _payment_values(parsed, journal, request.env.company)
        # The partner is a customer for a receipt and a vendor for a payment unless the body says otherwise (a refund of a
        # customer advance is an outbound payment to a customer).
        values['partner_type'] = parsed.get('partner_type') or ('customer' if parsed['payment_type'] == 'inbound' else 'supplier')
        values['partner_id'] = partner.id

        def create():
            payment = request.env['account.payment'].create(values)
            payment.action_post()
            return payment

        payment = attempt(create, day=parsed['payment_date'], journal=journal)
        request.env['webvue.finance.audit.event']._webvue_log('payment_created', payment, outcome=payment.state)
        return request.make_json_response(dump_payment(payment), status=201)

    @http.route('/api/v1/finance/payments/<int:payment_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_payment(self, payment_id, **payload):
        """Correct a draft payment (for example one reset to draft) before it is posted again."""
        require_capability('finance.payments.manage')
        payment = _find_payment(payment_id)
        if payment.state != 'draft':
            raise ApiError(422, 'not_draft', 'only a draft payment can be edited')
        parsed = parse_payment_patch(payload)
        journal = _payment_journal(parsed['journal_id'], payment.company_id) if 'journal_id' in parsed else payment.journal_id
        values = _payment_values(parsed, journal, payment.company_id)
        attempt(lambda: payment.write(values), day=values.get('date', payment.date), journal=journal, company=payment.company_id)
        request.env['webvue.finance.audit.event']._webvue_log('payment_changed', payment, fields_written=values)
        return dump_payment(payment)

    @http.route('/api/v1/finance/payments/<int:payment_id>/post', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def post_payment(self, payment_id, **_):
        require_capability('finance.payments.manage')
        payment = _find_payment(payment_id)
        if payment.state != 'draft':
            raise ApiError(422, 'not_draft', 'only a draft payment can be posted')
        if is_period_locked(payment.date, payment.journal_id, company=payment.company_id):
            raise period_locked(field='date')
        attempt(payment.action_post, day=payment.date, journal=payment.journal_id, company=payment.company_id)
        request.env['webvue.finance.audit.event']._webvue_log('payment_posted', payment, outcome=payment.state)
        return dump_payment(payment)

    @http.route('/api/v1/finance/payments/<int:payment_id>/allocate', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def allocate_payment(self, payment_id, **payload):
        """Set a posted payment's unallocated balance against posted invoices or against other payments (a refund)."""
        require_capability('finance.payments.manage')
        payment = _find_payment(payment_id)
        parsed = parse_payment_allocation(payload)
        own = _open_counterpart(payment)
        if 'invoice_ids' in parsed:
            targets = _lines_to_settle(own, _payable_invoices(parsed['invoice_ids']), 'invoice_ids')
        else:
            others = company_records('account.payment', parsed['payment_ids'], 'payment_ids', _company_payments_domain())
            if payment in others:
                raise ApiError(422, 'invalid', 'a payment cannot be allocated to itself', field='payment_ids')
            open_lines = request.env['account.move.line']
            for other in others:
                open_lines |= _open_counterpart(other)
            targets = _lines_to_settle(own, open_lines.move_id, 'payment_ids') & open_lines
        attempt((own | targets).reconcile, day=payment.date, journal=payment.journal_id, company=(own | targets).company_id)
        request.env['webvue.finance.audit.event']._webvue_log('payment_allocated', payment)
        return dump_payment(payment)

    @http.route('/api/v1/finance/payments/<int:payment_id>/unallocate', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unallocate_payment(self, payment_id, **_):
        """Undo what the payment was set against, so its whole amount is open again."""
        require_capability('finance.payments.manage')
        payment = _find_payment(payment_id)
        if payment.state not in ('in_process', 'paid'):
            raise ApiError(422, 'invalid_state', 'only a posted payment can be unallocated')
        reconciled = counterpart_lines(payment).filtered('matched_debit_ids') | counterpart_lines(payment).filtered('matched_credit_ids')
        if not reconciled:
            raise ApiError(422, 'invalid_state', 'the payment is not allocated')
        attempt(reconciled.remove_move_reconcile, day=payment.date, journal=payment.journal_id, company=payment.company_id)
        request.env['webvue.finance.audit.event']._webvue_log('payment_unallocated', payment)
        return dump_payment(payment)
