# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from .write_support import attempt
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.tax import (
    TAX_LOCKED_WHEN_USED,
    TAX_USES,
    dump_tax,
    dump_taxes,
    parse_tax_create,
    parse_tax_patch,
)


def _company_taxes_domain():
    return [('company_id', '=', request.env.company.id), ('type_tax_use', 'in', TAX_USES)]


def _find_tax(tax_id):
    tax = request.env['account.tax'].with_context(active_test=False).search([('id', '=', tax_id), *_company_taxes_domain()], limit=1)
    if not tax:
        raise MissingError(request.env._('account.tax %(id)s does not exist', id=tax_id))
    return tax


def _values(parsed):
    values = {key: parsed[key] for key in ('name', 'type_tax_use', 'amount_type', 'amount') if key in parsed}
    if 'price_include' in parsed:
        values['price_include_override'] = 'tax_included' if parsed['price_include'] else 'tax_excluded'
    return values


def _require_unused_for(tax, parsed):
    """A tax used by journal items keeps what it computes: a changed rate would disagree with the posted history."""
    changed = [field for field in TAX_LOCKED_WHEN_USED if field in parsed and parsed[field] != dump_tax(tax)[field]]
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
        values = _values(parse_tax_create(payload))
        values.setdefault('amount_type', 'percent')
        tax = attempt(lambda: request.env['account.tax'].create({**values, 'company_id': request.env.company.id}))
        request.env['webvue.finance.audit.event']._webvue_log('tax_created', tax, fields_written=values)
        return request.make_json_response(dump_tax(tax), status=201)

    @http.route('/api/v1/finance/taxes/<int:tax_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_tax(self, tax_id, **payload):
        require_capability('finance.taxes.manage')
        tax = _find_tax(tax_id)
        parsed = parse_tax_patch(payload)
        _require_unused_for(tax, parsed)
        values = _values(parsed)
        attempt(lambda: tax.write(values))
        request.env['webvue.finance.audit.event']._webvue_log('tax_changed', tax, fields_written=values)
        return dump_tax(tax)

    @http.route('/api/v1/finance/taxes/<int:tax_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def archive_tax(self, tax_id, **_):
        require_capability('finance.taxes.manage')
        tax = _find_tax(tax_id)
        attempt(tax.action_archive)
        request.env['webvue.finance.audit.event']._webvue_log('tax_archived', tax)
        return dump_tax(tax)

    @http.route('/api/v1/finance/taxes/<int:tax_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unarchive_tax(self, tax_id, **_):
        require_capability('finance.taxes.manage')
        tax = _find_tax(tax_id)
        attempt(tax.action_unarchive)
        request.env['webvue.finance.audit.event']._webvue_log('tax_unarchived', tax)
        return dump_tax(tax)
