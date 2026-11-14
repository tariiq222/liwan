# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from .write_support import attempt, company_records
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_finance.serializers.tax import (
    TAX_LOCKED_WHEN_USED,
    TAX_USES,
    dump_tax,
    dump_taxes,
    parse_tax_create,
    parse_tax_patch,
    tax_account_of,
)


def _company_taxes_domain():
    return [('company_id', 'in', request.env.companies.ids), ('type_tax_use', 'in', TAX_USES)]


def _find_tax(tax_id):
    tax = request.env['account.tax'].with_context(active_test=False).search([('id', '=', tax_id), *_company_taxes_domain()], limit=1)
    if not tax:
        raise MissingError(request.env._('account.tax %(id)s does not exist', id=tax_id))
    return tax


def _tax_account(account_id, company):
    return company_records('account.account', [account_id], 'tax_account_id', request.env['account.account']._check_company_domain(company))


def _set_tax_account(tax, account):
    """Put the tax amount of both the invoice and the credit note distribution on ``account``."""
    tax.invoice_repartition_line_ids.filtered(lambda line: line.repartition_type == 'tax').account_id = account
    tax.refund_repartition_line_ids.filtered(lambda line: line.repartition_type == 'tax').account_id = account


def _effective_use(tax, parsed):
    """The tax use the request leaves on the tax: the body's answer, else the stored one (``None`` on create)."""
    return parsed.get('type_tax_use', tax.type_tax_use if tax else None)


def _require_price_include_allowed(tax, parsed):
    """A sale tax follows the establishment's one mode, so its payload never answers "does the price include the tax"."""
    if _effective_use(tax, parsed) == 'sale' and 'price_include' in parsed:
        raise ApiError(
            422, 'invalid', 'a sale tax follows the company price mode: price_include is not set per tax',
            field='price_include',
        )


def _price_include_values(tax, parsed):
    """The price-include answer a create/patch body leaves on the tax.

    A sale tax follows ``res.company.account_price_include`` through stock's computed ``price_include``, so it keeps no
    override; a tax that becomes a sale tax loses the one it had. A sale tax that stays one and does not name
    ``price_include`` keeps its stored answer: renaming a tax used by journal items must not change what it computes.
    A purchase tax always carries one explicit answer: ``tax_excluded`` unless the accountant sends ``price_include``,
    so an amount typed on a vendor bill keeps meaning that amount under every company mode.
    """
    if _effective_use(tax, parsed) == 'sale':
        becomes_sale = tax is not None and tax.type_tax_use != 'sale'
        return {'price_include_override': False} if becomes_sale and tax.price_include_override else {}
    if 'price_include' in parsed:
        return {'price_include_override': 'tax_included' if parsed['price_include'] else 'tax_excluded'}
    # A new purchase tax, and a tax that becomes one, answers "tax added"; an existing purchase tax keeps its answer.
    if tax is None or tax.type_tax_use != 'purchase':
        return {'price_include_override': 'tax_excluded'}
    return {}


def _values(tax, parsed):
    values = {key: parsed[key] for key in ('name', 'type_tax_use', 'amount_type', 'amount') if key in parsed}
    values.update(_price_include_values(tax, parsed))
    return values


def _require_unused_for(tax, parsed):
    """A tax used by journal items keeps what it computes: a changed rate would disagree with the posted history."""
    current = {**dump_tax(tax), 'tax_account_id': tax_account_of(tax).id}
    changed = [field for field in TAX_LOCKED_WHEN_USED if field in parsed and parsed[field] != current[field]]
    if changed and tax.is_used:
        raise ApiError(422, 'tax_in_use', 'the tax is used by journal items: it can only be renamed or archived', field=changed[0])


class FinanceTaxController(http.Controller):

    @http.route('/api/v1/finance/taxes', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_taxes(self, **_):
        require_capability('finance.taxes.read')
        args = request.httprequest.args
        archived = parse_choice(args.get('archived'), {'true', 'false'}, 'archived') == 'true'
        domain = [*_company_taxes_domain(), ('active', '=', not archived)]
        use = parse_choice(args.get('type_tax_use'), TAX_USES, 'type_tax_use')
        if use:
            domain.append(('type_tax_use', '=', use))
        query = (args.get('q') or '').strip()
        if query:
            domain.append(('name', 'ilike', query))
        return list_page('account.tax', domain, dump_taxes)

    @http.route('/api/v1/finance/taxes/<int:tax_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_tax(self, tax_id):
        require_capability('finance.taxes.read')
        return dump_tax(_find_tax(tax_id))

    @http.route('/api/v1/finance/taxes', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_tax(self, **payload):
        require_capability('finance.taxes.manage')
        parsed = parse_tax_create(payload)
        _require_price_include_allowed(None, parsed)
        values = _values(None, parsed)
        values.setdefault('amount_type', 'percent')
        account = _tax_account(parsed['tax_account_id'], request.env.company)

        def create():
            tax = request.env['account.tax'].create({**values, 'company_id': request.env.company.id})
            _set_tax_account(tax, account)
            return tax

        tax = attempt(create)
        values['tax_account_id'] = account.id
        request.env['liwan.finance.audit.event']._liwan_log('tax_created', tax, fields_written=values)
        return request.make_json_response(dump_tax(tax), status=201)

    @http.route('/api/v1/finance/taxes/<int:tax_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_tax(self, tax_id, **payload):
        require_capability('finance.taxes.manage')
        tax = _find_tax(tax_id)
        parsed = parse_tax_patch(payload)
        _require_price_include_allowed(tax, parsed)
        _require_unused_for(tax, parsed)
        values = _values(tax, parsed)

        def write():
            tax.write(values)
            if 'tax_account_id' in parsed:
                _set_tax_account(tax, _tax_account(parsed['tax_account_id'], tax.company_id))

        attempt(write)
        if 'tax_account_id' in parsed:
            values['tax_account_id'] = parsed['tax_account_id']
        request.env['liwan.finance.audit.event']._liwan_log('tax_changed', tax, fields_written=values)
        return dump_tax(tax)

    @http.route('/api/v1/finance/taxes/<int:tax_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def archive_tax(self, tax_id, **_):
        require_capability('finance.taxes.manage')
        tax = _find_tax(tax_id)
        attempt(tax.action_archive)
        request.env['liwan.finance.audit.event']._liwan_log('tax_archived', tax)
        return dump_tax(tax)

    @http.route('/api/v1/finance/taxes/<int:tax_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unarchive_tax(self, tax_id, **_):
        require_capability('finance.taxes.manage')
        tax = _find_tax(tax_id)
        if not tax.active and tax.type_tax_use == 'sale' and tax.price_include_override:
            if tax.is_used:
                raise ApiError(
                    422, 'tax_in_use',
                    request.env._('This archived sale tax has a historical price override. Create a new sale tax to use it again.'),
                )

            def unarchive():
                tax.write({'price_include_override': False})
                tax.action_unarchive()

            attempt(unarchive)
        else:
            attempt(tax.action_unarchive)
        request.env['liwan.finance.audit.event']._liwan_log('tax_unarchived', tax)
        return dump_tax(tax)
