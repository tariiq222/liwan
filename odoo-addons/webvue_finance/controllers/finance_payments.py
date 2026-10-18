# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import filter_domain, list_page, parse_choice, require_capability
from .finance_invoices import company_invoices_domain
from .write_support import attempt, company_records, is_period_locked, period_locked
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.payment import (
    dump_payment,
    dump_payments,
    parse_payment_register,
)

PAYMENT_JOURNAL_TYPES = ('bank', 'cash', 'credit')
# Cancelled and rejected payments are final; only they can be reset to draft.
REVIVABLE_STATES = ('canceled', 'rejected')


def _find_payment(payment_id):
    payment = request.env['account.payment'].search(
        [('id', '=', payment_id), ('company_id', '=', request.env.company.id)], limit=1,
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
    journal = company_records(
        'account.journal', [parsed['journal_id']], 'journal_id',
        [('company_id', '=', request.env.company.id), ('type', 'in', PAYMENT_JOURNAL_TYPES)],
    )
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
    if is_period_locked(parsed['payment_date'], journal):
        raise period_locked(field='payment_date')
    residual = sum(invoices.mapped('amount_residual'))
    if invoices.currency_id.compare_amounts(parsed['amount'], residual) > 0:
        raise ApiError(422, 'amount_exceeds_residual', 'amount is greater than the open balance', field='amount')
    return values, journal


class FinancePaymentController(http.Controller):

    @http.route('/api/v1/finance/payments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_payments(self, **_):
        require_capability('finance.payments.read')
        args = request.httprequest.args
        fields = request.env['account.payment']._fields
        domain = [('company_id', '=', request.env.company.id), *filter_domain(args, 'date')]
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

        payments = _created_payments(attempt(register, day=parsed['payment_date'], journal=journal))
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
        attempt(payment.action_cancel, day=payment.date, journal=payment.journal_id)
        return dump_payment(payment)

    @http.route('/api/v1/finance/payments/<int:payment_id>/reset-to-draft', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def reset_payment_to_draft(self, payment_id, **_):
        require_capability('finance.payments.manage')
        payment = _find_payment(payment_id)
        if payment.state not in REVIVABLE_STATES:
            raise ApiError(422, 'invalid_state', 'only a cancelled or rejected payment can be reset to draft')
        attempt(payment.action_draft, day=payment.date, journal=payment.journal_id)
        return dump_payment(payment)
