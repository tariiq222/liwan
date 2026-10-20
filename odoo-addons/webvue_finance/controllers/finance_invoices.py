# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, http
from odoo.exceptions import MissingError
from odoo.http import request

from .analytic_support import distribution_values, require_plain_distributions
from .common import filter_domain, list_page, parse_choice, require_capability
from .finance_partners import company_partners_domain
from .write_support import attempt, company_records, require_state
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.invoice import (
    WRITABLE_MOVE_TYPES,
    dump_invoice_detail,
    dump_invoices,
    parse_invoice_create,
    parse_invoice_patch,
)
from odoo.addons.webvue_finance.serializers.parsing import require_nonempty


def _invoice_types():
    return request.env['account.move'].get_invoice_types(include_receipts=True)


def company_invoices_domain():
    return [
        ('company_id', '=', request.env.company.id),
        ('move_type', 'in', _invoice_types()),
    ]


def _find_invoice(invoice_id, *, writable=False):
    """The company's invoice; for a write only the four invoice/refund types exist (receipts are 404)."""
    domain = company_invoices_domain()
    if writable:
        domain.append(('move_type', 'in', WRITABLE_MOVE_TYPES))
    invoice = request.env['account.move'].search([('id', '=', invoice_id), *domain], limit=1)
    if not invoice:
        raise MissingError(request.env._('account.move %(id)s does not exist', id=invoice_id))
    return invoice


def _tax_use(move_type):
    return 'sale' if move_type.startswith('out_') else 'purchase'


def _default_journal(move_type):
    """The journal Odoo picks for a new move of ``move_type`` in the current company."""
    return request.env['account.journal'].search([
        ('company_id', '=', request.env.company.id),
        ('type', '=', _tax_use(move_type)),
    ], limit=1)


def _require_no_payments(invoice):
    """Cancelling or resetting a posted invoice unreconciles and cancels its payments; that is the payments route's job."""
    payments = invoice.reconciled_payment_ids.filtered(lambda payment: payment.state not in ('canceled', 'rejected'))
    if invoice.state != 'posted':
        payments = request.env['account.payment']
    if payments:
        raise ApiError(
            422, 'has_payments', 'the invoice has payments: cancel or reset them first',
            details={'payment_ids': payments.ids},
        )


def _line_command(line, index, tax_use):
    values = {key: line[key] for key in ('name', 'quantity', 'price_unit', 'discount')}
    if 'tax_ids' in line:
        taxes = company_records(
            'account.tax', line['tax_ids'], f'lines[{index}].tax_ids',
            [('company_id', '=', request.env.company.id), ('type_tax_use', '=', tax_use)],
        )
        values['tax_ids'] = [Command.set(taxes.ids)]
    if 'account_id' in line:
        account = company_records(
            'account.account', [line['account_id']], f'lines[{index}].account_id',
            [('company_ids', 'in', [request.env.company.id])],
        )
        values['account_id'] = account.id
    if 'analytic_distribution' in line:
        values['analytic_distribution'] = distribution_values(
            line['analytic_distribution'], f'lines[{index}].analytic_distribution',
        )
    return Command.create(values)


def _move_values(parsed, move_type):
    """ORM values for the parsed keys of a create/patch body; related records are checked in the company.

    Line taxes must be of the document's kind: sale taxes on customer documents, purchase taxes on vendor ones.
    """
    values = {}
    if 'move_type' in parsed:
        values['move_type'] = move_type
    if 'partner_id' in parsed:
        values['partner_id'] = company_records(
            'res.partner', [parsed['partner_id']], 'partner_id', company_partners_domain(),
        ).id
    if 'journal_id' in parsed:
        values['journal_id'] = company_records(
            'account.journal', [parsed['journal_id']], 'journal_id',
            [('company_id', '=', request.env.company.id), ('type', '=', _tax_use(move_type))],
        ).id
    if 'currency' in parsed:
        currency = request.env['res.currency'].search([('name', '=', parsed['currency'])], limit=1)
        if not currency:
            raise ApiError(422, 'invalid', 'currency is not an active currency code', field='currency')
        values['currency_id'] = currency.id
    for key in ('invoice_date', 'invoice_date_due', 'ref'):
        if key in parsed:
            values[key] = parsed[key] or False
    if 'lines' in parsed:
        # A body that carries lines replaces every existing line of the invoice.
        values['invoice_line_ids'] = [
            Command.clear(),
            *(_line_command(line, index, _tax_use(move_type)) for index, line in enumerate(parsed['lines'])),
        ]
    return values


def _lock_context(invoice):
    """What ``attempt`` needs to tell a lock-date refusal from any other one."""
    return {
        'day': invoice.invoice_date or invoice.date,
        'journal': invoice.journal_id,
        'has_tax': bool(invoice.invoice_line_ids.tax_ids),
    }


class FinanceInvoiceController(http.Controller):

    @http.route('/api/v1/finance/invoices', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_invoices(self, **_):
        require_capability('finance.invoices.read')
        args = request.httprequest.args
        Move = request.env['account.move']
        domain = company_invoices_domain() + filter_domain(args, 'invoice_date')
        move_type = parse_choice(args.get('move_type'), _invoice_types(), 'move_type')
        if move_type:
            domain.append(('move_type', '=', move_type))
        state = parse_choice(args.get('state'), Move._fields['state'].get_values(request.env), 'state')
        if state:
            domain.append(('state', '=', state))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', '|', ('name', 'ilike', query), ('ref', 'ilike', query), ('partner_id.name', 'ilike', query)]
        return list_page('account.move', domain, dump_invoices)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_invoice(self, invoice_id):
        require_capability('finance.invoices.read')
        return dump_invoice_detail(_find_invoice(invoice_id))

    @http.route('/api/v1/finance/invoices', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_invoice(self, **payload):
        require_capability('finance.invoices.manage')
        parsed = parse_invoice_create(payload)
        values = _move_values(parsed, parsed['move_type'])
        invoice = attempt(
            lambda: request.env['account.move'].create(values),
            day=values.get('invoice_date'),
            journal=request.env['account.journal'].browse(values['journal_id']) if 'journal_id' in values else _default_journal(parsed['move_type']),
            has_tax=any(line.get('tax_ids') for line in parsed['lines']),
        )
        return request.make_json_response(dump_invoice_detail(invoice), status=201)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_invoice(self, invoice_id, **payload):
        require_capability('finance.invoices.manage')
        invoice = _find_invoice(invoice_id, writable=True)
        require_nonempty(payload)
        require_state(invoice, 'draft', 'not_draft')
        parsed = parse_invoice_patch(payload)
        if 'lines' in parsed:
            require_plain_distributions(invoice.invoice_line_ids)
        values = _move_values(parsed, invoice.move_type)
        attempt(
            lambda: invoice.write(values), day=values.get('invoice_date') or invoice.date,
            journal=invoice.journal_id,
            has_tax=any(line.get('tax_ids') for line in parsed.get('lines', ())) or bool(invoice.invoice_line_ids.tax_ids),
        )
        return dump_invoice_detail(invoice)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def delete_invoice(self, invoice_id, **_):
        require_capability('finance.invoices.manage')
        invoice = _find_invoice(invoice_id, writable=True)
        require_state(invoice, 'draft', 'not_draft')
        attempt(invoice.unlink, day=invoice.date, journal=invoice.journal_id)
        return request.make_json_response('', status=204)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>/post', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def post_invoice(self, invoice_id, **_):
        require_capability('finance.invoices.post')
        invoice = _find_invoice(invoice_id, writable=True)
        require_state(invoice, 'draft', 'not_draft')
        # 422 zatca_not_onboarded means the sales journal is not ZATCA-onboarded; Odoo may list further
        # configuration errors in the same refusal, all of them in details.detail.
        attempt(invoice.action_post, move=invoice, **_lock_context(invoice))
        return dump_invoice_detail(invoice)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def cancel_invoice(self, invoice_id, **_):
        require_capability('finance.invoices.post')
        invoice = _find_invoice(invoice_id, writable=True)
        if invoice.state == 'cancel':
            raise ApiError(422, 'invalid_state', 'the invoice is already cancelled')
        _require_no_payments(invoice)
        attempt(invoice.button_cancel, **_lock_context(invoice))
        return dump_invoice_detail(invoice)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>/reset-to-draft', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def reset_invoice_to_draft(self, invoice_id, **_):
        require_capability('finance.invoices.post')
        invoice = _find_invoice(invoice_id, writable=True)
        if invoice.state == 'draft':
            raise ApiError(422, 'invalid_state', 'the invoice is already a draft')
        _require_no_payments(invoice)
        attempt(invoice.button_draft, **_lock_context(invoice))
        return dump_invoice_detail(invoice)
