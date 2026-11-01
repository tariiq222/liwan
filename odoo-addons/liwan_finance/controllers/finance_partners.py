# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_api.controllers.vat import check_vat
from odoo.addons.liwan_finance.serializers.parsing import require_nonempty
from odoo.addons.liwan_finance.serializers.partner import (
    dump_partner,
    dump_partners,
    parse_partner_create,
    parse_partner_patch,
)

PARTNER_KINDS = {'customer': 'customer_rank', 'vendor': 'supplier_rank'}


def tenant_company_partner_ids():
    """The partners of every company of the database, whichever of them the caller belongs to (ids only)."""
    return request.env['res.company'].sudo().with_context(active_test=False).search([]).partner_id.ids


def company_partners_domain(company=None):
    """The customers and vendors of the pinned companies.

    Odoo partners that are system records stay out: users, the partners of every company of the
    tenant (also the ones the caller does not belong to, such as the parent of a branch) and
    employee work contacts. They belong to access, settings and HR, not to Finance.
    ``employee`` is the stored flag hr adds to res.partner; it only exists when hr is installed,
    which Finance does not depend on.
    """
    domain = [
        # The pinned request set: a parent session reads its branches' partners,
        # a branch session only its own, and the shared (company-less) ones.
        '|', ('company_id', '=', False), ('company_id', 'in', request.env.companies.ids),
        ('user_ids', '=', False),
        ('id', 'not in', tenant_company_partner_ids()),
    ]
    if company is not None:
        domain += request.env['res.partner']._check_company_domain(company)
    if 'employee' in request.env['res.partner']._fields:
        domain.append(('employee', '=', False))
    return domain


def find_partner(partner_id):
    partner = request.env['res.partner'].with_context(active_test=False).search(
        [('id', '=', partner_id), *company_partners_domain()], limit=1,
    )
    if not partner:
        raise MissingError(request.env._('res.partner %(id)s does not exist', id=partner_id))
    return partner


def _rank(partner, kind, flag):
    """The customer/supplier rank for a flag: an existing positive rank is kept, so invoicing history survives."""
    rank = partner[PARTNER_KINDS[kind]] if partner else 0
    return (rank or 1) if flag else 0


def _global_record(model, record_id, field):
    """A country or state: shared reference data, not company-scoped."""
    record = request.env[model].browse(record_id).exists()
    if not record:
        raise ApiError(422, 'invalid', f'{field} does not reference an existing record', field=field)
    return record


def _relation(parsed, field, model, current):
    """The record a body names for ``field`` (None clears it), or ``current`` when it is absent."""
    if field not in parsed:
        return current
    return _global_record(model, parsed[field], field) if parsed[field] else request.env[model]


def _partner_values(parsed, partner=None):
    """ORM values for the parsed keys.

    A new partner belongs to the current company and defaults to its country, so the VAT
    check has a country to validate against; the state must belong to the partner's country.
    """
    values = {
        key: value for key, value in parsed.items() if key not in ('customer', 'vendor', 'state_id', 'country_id')
    }
    for kind, field in PARTNER_KINDS.items():
        if kind in parsed:
            values[field] = _rank(partner, kind, parsed[kind])
    country = _relation(parsed, 'country_id', 'res.country', partner.country_id if partner else request.env.company.country_id)
    state = _relation(parsed, 'state_id', 'res.country.state', partner.state_id if partner else request.env['res.country.state'])
    if state and state.country_id != country:
        raise ApiError(422, 'invalid', 'state_id does not belong to the partner country', field='state_id')
    if not partner or 'country_id' in parsed:
        values['country_id'] = country.id
    if 'state_id' in parsed:
        values['state_id'] = state.id
    if 'vat' in parsed or 'country_id' in parsed:
        check_vat(country, parsed.get('vat', partner.vat if partner else ''), parsed.get('name', partner.name if partner else ''))
    if not partner:
        values['company_id'] = request.env.company.id
    return values


class FinancePartnerController(http.Controller):

    @http.route('/api/v1/finance/partners', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_partners(self, **_):
        require_capability('finance.partners.read')
        args = request.httprequest.args
        archived = parse_choice(args.get('archived'), {'true', 'false'}, 'archived') == 'true'
        domain = [*company_partners_domain(), ('active', '=', not archived)]
        kind = parse_choice(args.get('kind'), PARTNER_KINDS, 'kind')
        if kind:
            domain.append((PARTNER_KINDS[kind], '>', 0))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', '|', ('name', 'ilike', query), ('vat', 'ilike', query), ('company_registry', 'ilike', query)]
        return list_page('res.partner', domain, dump_partners)

    @http.route('/api/v1/finance/partners/<int:partner_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_partner(self, partner_id):
        require_capability('finance.partners.read')
        return dump_partner(find_partner(partner_id))

    @http.route('/api/v1/finance/partners', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_partner(self, **payload):
        require_capability('finance.partners.manage')
        values = _partner_values(parse_partner_create(payload))
        partner = request.env['res.partner'].create(values)
        request.env['liwan.finance.audit.event']._liwan_log('partner_created', partner, fields_written=values)
        return request.make_json_response(dump_partner(partner), status=201)

    @http.route('/api/v1/finance/partners/<int:partner_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_partner(self, partner_id, **payload):
        require_capability('finance.partners.manage')
        partner = find_partner(partner_id)
        require_nonempty(payload)
        values = _partner_values(parse_partner_patch(payload), partner)
        partner.write(values)
        request.env['liwan.finance.audit.event']._liwan_log('partner_changed', partner, fields_written=values)
        return dump_partner(partner)

    @http.route('/api/v1/finance/partners/<int:partner_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def archive_partner(self, partner_id, **_):
        require_capability('finance.partners.manage')
        partner = find_partner(partner_id)
        partner.action_archive()
        request.env['liwan.finance.audit.event']._liwan_log('partner_archived', partner)
        return dump_partner(partner)

    @http.route('/api/v1/finance/partners/<int:partner_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unarchive_partner(self, partner_id, **_):
        require_capability('finance.partners.manage')
        partner = find_partner(partner_id)
        partner.action_unarchive()
        request.env['liwan.finance.audit.event']._liwan_log('partner_unarchived', partner)
        return dump_partner(partner)
