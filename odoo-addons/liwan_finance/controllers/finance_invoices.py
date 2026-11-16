# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, fields, http
from odoo.exceptions import MissingError
from odoo.http import request

from .analytic_support import distribution_values, require_plain_distributions
from .common import (
    filter_domain,
    list_page,
    parse_choice,
    require_capability,
    state_summary,
)
from .finance_partners import company_partners_domain
from .idempotency import idempotent
from .write_support import attempt, company_records, require_open_period, require_state
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_finance.serializers.invoice import (
    WRITABLE_MOVE_TYPES,
    dump_invoice_detail,
    dump_invoices,
    parse_invoice_create,
    parse_invoice_patch,
)
from odoo.addons.liwan_finance.serializers.parsing import require_nonempty
from odoo.addons.liwan_finance.serializers.zatca import (
    zatca_content_final,
    zatca_document,
    zatca_state,
)
from odoo.addons.liwan_products.models.products_service import valid_quantity


def _invoice_types():
    return request.env['account.move'].get_invoice_types(include_receipts=True)


def company_invoices_domain():
    return [
        ('company_id', 'in', request.env.companies.ids),
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


def _require_not_final_zatca_content(invoice):
    """Refuse editing a document that carries a ZATCA chain index: re-sending it would reuse that index with other content.

    Stock's own guard fires in production and for a submission that timed out (``l10n_sa_edi/models/account_move.py:175``),
    and only hides the button; its ``button_draft`` raises in production alone. An invoice accepted (or still awaiting an
    answer after a timeout) in the sandbox could therefore be reset to draft, changed and posted again under the same
    index, which ZATCA treats as a second invoice for one ICV. The chain index is what makes the content final; a
    rejection clears it, so a rejected invoice stays correctable.
    """
    if not zatca_content_final(invoice):
        return
    if zatca_state(zatca_document(invoice)) == 'accepted':
        message = request.env._('ZATCA accepted this document: its content cannot change. Issue a credit note instead.')
    else:
        message = request.env._(
            'ZATCA has not answered this document yet and it keeps its chain number: its content cannot change. '
            'Send it again to get the answer.',
        )
    raise ApiError(422, 'invalid', message)


def _asset_profile(profile_id, index, tax_use, company):
    """The asset profile a vendor-bill line capitalises into; creating the asset is the fixed-assets capability."""
    if tax_use != 'purchase':
        raise ApiError(422, 'invalid', 'only a vendor bill line can create an asset', field=f'lines[{index}].asset_profile_id')
    require_capability('finance.assets.manage')
    return company_records(
        'account.asset.profile', [profile_id], f'lines[{index}].asset_profile_id', [('company_id', '=', company.id)],
    )


def _line_product(line, index, company, kept):
    """The variant a line names: the products service's product usable in ``company``, else 422 on its field.

    ``kept`` holds the products the draft already carries, which an edit may send back even after the product was
    archived. A line names a template and takes its one variant (variants come with a later pull request).
    """
    field = f'lines[{index}].product_id'
    service = request.env['liwan.products.service']
    try:
        service._liwan_require_pick()
        product = service._liwan_product(line['product_id'], include_archived=line['product_id'] in kept)
    except LiwanAccessRule as error:
        if error.status == 404:
            raise ApiError(422, 'invalid', 'the product does not exist', field=field) from error
        raise
    if product.company_id and product.company_id not in company.parent_ids:
        raise ApiError(422, 'invalid', 'the product belongs to another company', field=field)
    if len(product.with_context(active_test=False).product_variant_ids) > 1:
        raise ApiError(422, 'invalid', 'products with variants are not supported yet', field=field)
    return product


def resolve_line_products(parsed, move_type, company, invoice=None):
    """Replace each ``product_id`` of the parsed lines with its product, and default the unit price from it (D20).

    A vendor bill line refuses a product (a service product is a thing the company sells). A price typed on the line
    stays; an absent one is the price as typed on the product, which is in the company currency, converted to the
    invoice's currency at the invoice's day with the rate the invoice itself uses (``res.currency._convert``; a missing
    rate is the invoice's own 422). Runs before the exchange-rate check, which reads the prices. ``invoice`` is the draft
    being edited: its own products stay usable after they were archived.

    A product line of a company not registered for VAT refuses taxes (422 on ``lines[i].tax_ids``): the establishment's
    one rule is that such a line has none (``account.move.line._compute_tax_ids`` enforces it on every recompute).
    """
    kept = set(invoice.invoice_line_ids.product_id.product_tmpl_id.ids) if invoice else set()
    currency, day = _effective_currency_and_day(invoice, parsed)
    registered = company._liwan_vat_registered()
    for index, line in enumerate(parsed.get('lines', ())):
        if 'product_id' not in line:
            continue
        if _tax_use(move_type) != 'sale':
            raise ApiError(422, 'invalid', 'a vendor bill line cannot name a product', field=f'lines[{index}].product_id')
        if line.get('tax_ids') and not registered:
            raise ApiError(
                422, 'invalid', 'a product line of a company not registered for VAT has no tax',
                field=f'lines[{index}].tax_ids',
            )
        product = _line_product(line, index, company, kept)
        line['product'] = product
        if 'price_unit' not in line:
            quantity = line['quantity'] if valid_quantity(line['quantity']) else 1.0
            price = request.env['liwan.products.service']._liwan_price(
                product, quantity=quantity, company=company,
            )['unit_price']
            if currency != company.currency_id:
                _require_exchange_rate(currency, company, day)
                price = currency.round(company.currency_id._convert(price, currency, company, day))
            line['price_unit'] = price


def _lines_have_tax(lines, move_type, company):
    """Whether the parsed lines will carry a tax, for the lock-date pre-check: typed taxes, or a product line that takes
    the product's default ones (an establishment not registered for VAT takes none)."""
    taxed_by_default = company._liwan_vat_registered()
    return any(
        line.get('tax_ids') or (
            'tax_ids' not in line and taxed_by_default and 'product' in line
            and _tax_use(move_type) == 'sale' and bool(line['product'].taxes_id._filter_taxes_by_company(company))
        )
        for line in lines
    )


def _line_command(line, index, tax_use, company):
    values = {key: line[key] for key in ('quantity', 'price_unit', 'discount')}
    # A line with a product and no label takes the product's, which stock computes.
    if 'name' in line:
        values['name'] = line['name']
    if 'product' in line:
        values['product_id'] = line['product'].with_context(active_test=False).product_variant_ids[:1].id
    if 'tax_ids' in line:
        taxes = company_records(
            'account.tax', line['tax_ids'], f'lines[{index}].tax_ids',
            [*request.env['account.tax']._check_company_domain(company), ('type_tax_use', '=', tax_use)],
        )
        values['tax_ids'] = [Command.set(taxes.ids)]
    if 'account_id' in line:
        account = company_records(
            'account.account', [line['account_id']], f'lines[{index}].account_id',
            request.env['account.account']._check_company_domain(company),
        )
        values['account_id'] = account.id
    if 'asset_profile_id' in line:
        values['asset_profile_id'] = _asset_profile(line['asset_profile_id'], index, tax_use, company).id
    if 'analytic_distribution' in line:
        values['analytic_distribution'] = distribution_values(
            line['analytic_distribution'], f'lines[{index}].analytic_distribution', company=company,
        )
    return Command.create(values)


def _invoice_amount_is_nonzero(lines):
    return any(
        line_values['quantity'] * line_values['price_unit'] * (1 - line_values['discount'] / 100)
        for line_values in map(_line_values, lines)
    )


def _require_exchange_rate(currency, company, invoice_date):
    # Match account.move's currency conversion inputs while retaining the caller's record rules.
    rate_model = request.env['res.currency.rate']
    scope = [
        ('currency_id', '=', currency.id),
        ('company_id', 'in', (False, company.root_id.id)),
    ]
    # Odoo picks the latest rate on/before the date, or the earliest rate if none qualify.
    if not rate_model.search(scope + [('name', '<=', invoice_date)], limit=1) and not rate_model.search(scope, limit=1):
        raise ApiError(
            422, 'missing_exchange_rate', 'No exchange rate is available for this currency and invoice date.',
            field='currency',
        )


def _require_invoice_conversion(currency, company, invoice_date, lines):
    if currency != company.currency_id and _invoice_amount_is_nonzero(lines):
        _require_exchange_rate(currency, company, invoice_date)


def _line_values(line):
    return {
        'quantity': line['quantity'] if isinstance(line, dict) else line.quantity,
        'price_unit': line['price_unit'] if isinstance(line, dict) else line.price_unit,
        'discount': line.get('discount', 0) if isinstance(line, dict) else line.discount,
    }


def _effective_currency_and_day(invoice, parsed):
    """The currency and the day the invoice will convert at: what the body sets, else what the draft has (a new
    invoice has the company's currency and today)."""
    currency = invoice.currency_id if invoice else request.env.company.currency_id
    if 'currency' in parsed:
        currency = request.env['res.currency'].search([('name', '=', parsed['currency'])], limit=1)
        if not currency:
            raise ApiError(422, 'invalid', 'currency is not an active currency code', field='currency')
    day = parsed.get('invoice_date', invoice.invoice_date if invoice else None)
    return currency, day or fields.Date.context_today(request.env['account.move'])


def _effective_invoice_conversion(invoice, parsed, company):
    currency, invoice_date = _effective_currency_and_day(invoice, parsed)
    lines = parsed.get('lines', invoice.invoice_line_ids)
    _require_invoice_conversion(currency, company, invoice_date, lines)


def _move_values(parsed, move_type, company):
    """ORM values for the parsed keys of a create/patch body; related records are checked for the document company.

    Line taxes must be of the document's kind: sale taxes on customer documents, purchase taxes on vendor ones.
    Accounting references follow stock ancestor compatibility; all lookups retain
    native visibility while checking compatibility with the document owner.
    """
    values = {}
    if 'move_type' in parsed:
        values['move_type'] = move_type
    if 'partner_id' in parsed:
        values['partner_id'] = company_records(
            'res.partner', [parsed['partner_id']], 'partner_id',
            company_partners_domain(company),
        ).id
    if 'journal_id' in parsed:
        values['journal_id'] = company_records(
            'account.journal', [parsed['journal_id']], 'journal_id',
            [*request.env['account.journal']._check_company_domain(company), ('type', '=', _tax_use(move_type))],
        ).id
    if 'payment_term_id' in parsed:
        # The terms of the company and the shared ones that come with the chart; None clears the term.
        values['invoice_payment_term_id'] = parsed['payment_term_id'] and company_records(
            'account.payment.term', [parsed['payment_term_id']], 'payment_term_id',
            ['|', ('company_id', '=', False), ('company_id', '=', company.id)],
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
            *(_line_command(line, index, _tax_use(move_type), company) for index, line in enumerate(parsed['lines'])),
        ]
    return values


def _lock_context(invoice):
    """What ``attempt`` needs to tell a lock-date refusal from any other one."""
    return {
        'day': invoice.invoice_date or invoice.date,
        'journal': invoice.journal_id,
        'has_tax': bool(invoice.invoice_line_ids.tax_ids),
        'company': invoice.company_id,
    }


def _invoices_domain(args, *, include_state=True):
    Move = request.env['account.move']
    domain = company_invoices_domain() + filter_domain(args, 'invoice_date')
    move_type = parse_choice(args.get('move_type'), _invoice_types(), 'move_type')
    if move_type:
        domain.append(('move_type', '=', move_type))
    state = parse_choice(args.get('state'), Move._fields['state'].get_values(request.env), 'state')
    if state and include_state:
        domain.append(('state', '=', state))
    query = (args.get('q') or '').strip()
    if query:
        domain += ['|', '|', ('name', 'ilike', query), ('ref', 'ilike', query), ('partner_id.name', 'ilike', query)]
    return domain


class FinanceInvoiceController(http.Controller):

    @http.route('/api/v1/finance/invoices', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_invoices(self, **_):
        require_capability('finance.invoices.read')
        return list_page('account.move', _invoices_domain(request.httprequest.args), dump_invoices)

    @http.route('/api/v1/finance/invoices/summary', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def summary_invoices(self, **_):
        """All tile counts for the list filters, independently of its selected state and page."""
        require_capability('finance.invoices.read')
        args = request.httprequest.args
        return state_summary('account.move', _invoices_domain(args, include_state=False), ('draft', 'posted', 'cancel'))

    @http.route('/api/v1/finance/invoices/<int:invoice_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_invoice(self, invoice_id):
        require_capability('finance.invoices.read')
        return dump_invoice_detail(_find_invoice(invoice_id))

    @http.route('/api/v1/finance/invoices', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    @requires_capability('finance.invoices.manage')
    @idempotent
    def create_invoice(self, **payload):
        parsed = parse_invoice_create(payload)
        resolve_line_products(parsed, parsed['move_type'], request.env.company)
        values = _move_values(parsed, parsed['move_type'], request.env.company)
        effective_currency = request.env['res.currency'].browse(
            values.get('currency_id', request.env.company.currency_id.id),
        )
        _require_invoice_conversion(
            effective_currency, request.env.company, parsed.get('invoice_date'), parsed['lines'],
        )
        values['company_id'] = request.env.company.id
        written = tuple(values)  # account.move.create renames and adds keys in place
        # The audit names what the caller wrote, so the journal chosen here stays out of it.
        if 'journal_id' not in values:
            # The company's own journal, never stock's pick: a branch can also match its parent's journals, which it cannot read,
            # and a branch starts with none of its own.
            default = _default_journal(parsed['move_type'])
            if not default:
                raise ApiError(422, 'no_journal', 'create a journal for this kind of document in the finance settings first', field='journal_id')
            values['journal_id'] = default.id
        lock = {
            'day': values.get('invoice_date'),
            'journal': request.env['account.journal'].browse(values['journal_id']),
            'has_tax': _lines_have_tax(parsed['lines'], parsed['move_type'], request.env.company),
        }
        require_open_period(**lock, company=request.env.company, field='invoice_date')
        invoice = attempt(lambda: request.env['account.move'].create(values), **lock)
        request.env['liwan.finance.audit.event']._liwan_log(
            'invoice_created', invoice, fields_written=written, outcome=invoice.state,
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
            if invoice.invoice_line_ids.asset_profile_id:
                # Replacing the lines would drop their asset profiles, which only fixed-assets managers can resend.
                require_capability('finance.assets.manage')
        resolve_line_products(parsed, invoice.move_type, invoice.company_id, invoice)
        _effective_invoice_conversion(invoice, parsed, invoice.company_id)
        values = _move_values(parsed, invoice.move_type, invoice.company_id)
        written = tuple(values)  # account.move.write adds is_manually_modified in place
        lock = {
            'day': values.get('invoice_date') or _lock_context(invoice)['day'],
            'journal': invoice.journal_id,
            'company': invoice.company_id,
            'has_tax': _lines_have_tax(parsed.get('lines', ()), invoice.move_type, invoice.company_id)
            or bool(invoice.invoice_line_ids.tax_ids),
        }
        require_open_period(**lock, field='invoice_date')
        attempt(lambda: invoice.write(values), **lock)
        request.env['liwan.finance.audit.event']._liwan_log(
            'invoice_changed', invoice, fields_written=written, outcome=invoice.state,
        )
        return dump_invoice_detail(invoice)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def delete_invoice(self, invoice_id, **_):
        require_capability('finance.invoices.manage')
        invoice = _find_invoice(invoice_id, writable=True)
        require_state(invoice, 'draft', 'not_draft')
        company = invoice.company_id
        attempt(invoice.unlink, day=invoice.date, journal=invoice.journal_id, company=company)
        request.env['liwan.finance.audit.event']._liwan_log(
            'invoice_deleted', invoice, fields_written=('unlink',), outcome='deleted', company=company,
        )
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
        lock = _lock_context(invoice)
        require_open_period(**lock, field='invoice_date')
        if invoice.invoice_line_ids.filtered(lambda line: line.asset_profile_id and not line.asset_id):
            # Posting creates the assets of the capitalised lines.
            require_capability('finance.assets.manage')
        attempt(invoice.action_post, move=invoice, **lock)
        request.env['liwan.finance.audit.event']._liwan_log(
            'invoice_posted', invoice, fields_written=('state',), outcome=invoice.state,
        )
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
        _require_not_final_zatca_content(invoice)
        attempt(invoice.button_cancel, **_lock_context(invoice))
        request.env['liwan.finance.audit.event']._liwan_log(
            'invoice_cancelled', invoice, fields_written=('state',), outcome=invoice.state,
        )
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
        _require_not_final_zatca_content(invoice)
        attempt(invoice.button_draft, **_lock_context(invoice))
        request.env['liwan.finance.audit.event']._liwan_log(
            'invoice_reset_to_draft', invoice, fields_written=('state',), outcome=invoice.state,
        )
        return dump_invoice_detail(invoice)
