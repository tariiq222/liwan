# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import fields, http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_api.serializers.properties import read_items
from odoo.addons.liwan_crm.models.crm_lead import PROPERTIES_FIELD
from odoo.addons.liwan_crm.models.distribution import agent_not_eligible
from odoo.addons.liwan_crm.serializers.call import CUSTOMER_FIELDS
from odoo.addons.liwan_crm.serializers.opportunity import (
    INVALID_PHONE_REASON,
    dump_opportunity,
    parse_list_filters,
    parse_opportunity_body,
)
from odoo.addons.liwan_customers.serializers.link import parse_customer_choice

ORDER = 'create_date desc, id desc'

MAX_AGENTS = 50


def _visibility():
    return request.env['liwan.crm.visibility']


def visible_domain():
    return _visibility()._liwan_domain(request.env.user)


def find_opportunity(lead_id):
    """The opportunity, lost ones included, when the caller may read it.

    404 for a hidden, foreign or missing one alike.
    """
    lead = request.env['crm.lead'].with_context(active_test=False).search([('id', '=', lead_id), *visible_domain()], limit=1)
    if not lead:
        raise ApiError(404, 'not_found', 'Record does not exist')
    # Back to the normal archive filter: whatever the lead reads or searches next ignores archived records.
    return lead.with_context(active_test=True)


STATUS_WON_STATUS = {'open': 'pending', 'won': 'won', 'lost': 'lost'}


def filter_domain(filters, default_status='open'):
    """The domain of the list filters; ``status`` (open, won, lost or all) falls back to ``default_status``."""
    domain = [(name, '=', filters[name]) for name in ('stage_id', 'user_id', 'source_id') if name in filters]
    now = fields.Datetime.now()
    status = filters.get('status', default_status)
    if status != 'all':
        domain.append(('won_status', '=', STATUS_WON_STATUS[status]))
    if 'due' in filters:
        domain += [('liwan_next_call_at', '<=', now)] if filters['due'] else [
            '|', ('liwan_next_call_at', '=', False), ('liwan_next_call_at', '>', now),
        ]
    if 'unassigned' in filters:
        domain.append(('user_id', '=' if filters['unassigned'] else '!=', False))
    if 'needs_manager' in filters:
        domain.append(('liwan_needs_manager', '=', filters['needs_manager']))
    if filters.get('q'):
        text = filters['q']
        domain += ['|', '|', '|', ('contact_name', 'ilike', text), ('phone', 'ilike', text),
                   ('phone_sanitized', 'ilike', text), ('email_from', 'ilike', text)]
    domain += filters.get('properties', [])
    return domain


def _normalized_phone(raw, lead=None):
    """E.164 phone in the tenant's phone country; 422 when invalid or held by another open opportunity."""
    company = request.env.company
    Lead = request.env['crm.lead']
    phone = request.env['liwan.customers.service']._liwan_phone_or_none(raw)
    if not phone:
        raise ApiError(422, 'invalid', 'invalid phone', field='phone', details={'reason': INVALID_PHONE_REASON})
    if (not lead or lead.phone_sanitized != phone) and Lead._liwan_find_duplicate(phone, company):
        raise Lead._liwan_duplicate_phone_error()
    return phone


def _saved(operation):
    """Run a create or write and flush it; a phone taken meanwhile answers the same 422."""
    try:
        with request.env.cr.savepoint():
            result = operation()
            request.env.flush_all()
    except UniqueViolation as error:
        if not request.env['crm.lead']._liwan_is_duplicate_phone(error):
            raise
        raise request.env['crm.lead']._liwan_duplicate_phone_error() from None
    return result


def _check_source(source_id):
    if source_id and not request.env['utm.source'].search_count([('id', '=', source_id)], limit=1):
        raise ApiError(422, 'invalid', 'source does not exist', field='source_id')


def _check_stage(stage_id):
    stage = request.env['crm.stage'].search([('id', '=', stage_id)], limit=1)
    if not stage:
        raise ApiError(422, 'invalid', 'stage does not exist', field='stage_id')
    if stage.is_won:
        raise ApiError(422, 'invalid', 'an opportunity is won through the sale action', field='stage_id')


def _manual_distribution():
    return request.env['liwan.crm.settings']._liwan_effective()['distribution_mode'] == 'manual'


def can_create_opportunity():
    """Whether the caller may create an opportunity in the current company.

    In manual distribution an opportunity nobody holds is visible only to the holders of ``crm.leads.assign``, so
    only they create; an agent would lose what they create. Otherwise ``crm.leads.work`` is enough.
    """
    me = request.env.user
    if _visibility()._liwan_can_assign(me, request.env.company):
        return True
    return not _manual_distribution() and request.env['liwan.access.service']._liwan_has_capability(me, 'crm.leads.work')


def check_can_create():
    """403 unless the caller may create an opportunity; the bridges call it before any side effect."""
    if not can_create_opportunity():
        message = 'crm.leads.assign capability is required while distribution is manual' if _manual_distribution() \
            else 'crm.leads.work capability is required'
        raise ApiError(403, 'forbidden', message)


def _assignee(parsed):
    """Who takes a new opportunity, once the caller may create it.

    The creator by default, except in manual distribution where it waits unassigned for the assigner to hand out.
    A ``user_id`` naming the creator needs ``crm.leads.work``; naming another user (or null for the pool) needs
    ``crm.leads.assign`` and an eligible agent.
    """
    me = request.env.user
    if 'user_id' not in parsed and _manual_distribution():
        return request.env['res.users']
    if 'user_id' not in parsed or parsed['user_id'] == me.id:
        if not request.env['liwan.access.service']._liwan_has_capability(me, 'crm.leads.work'):
            raise ApiError(403, 'forbidden', 'crm.leads.work capability is required')
        return me
    if not _visibility()._liwan_can_assign(me, request.env.company):
        raise ApiError(403, 'forbidden', 'crm.leads.assign capability is required')
    if not parsed['user_id']:
        return request.env['res.users']
    agent = request.env['liwan.crm.distribution']._liwan_eligible_agents(request.env.company).filtered(
        lambda user: user.id == parsed['user_id'],
    )
    if not agent:
        raise agent_not_eligible()
    return agent


def _vals(parsed):
    vals = {}
    if 'contact_name' in parsed:
        vals['contact_name'] = vals['name'] = parsed['contact_name']
    if 'email' in parsed:
        vals['email_from'] = parsed['email']
    for name in ('source_id', 'stage_id', 'probability'):
        if name in parsed:
            vals[name] = parsed[name]
    return vals


def _merged_properties(lead, parsed):
    """The value object of a partial ``properties`` patch: the current values with the given keys changed.

    The engine writes one value object for the whole field, so the untouched properties are carried
    over from the record in the engine's own value form.
    """
    values = {item['name']: item.get('value') for item in read_items(lead, PROPERTIES_FIELD)}
    values.update(parsed)
    return values


def create_opportunity_from_payload(payload, partner=None):
    """Create and assign a manual opportunity with the ordinary CRM checks, linked to ``partner`` when given."""
    check_can_create()
    parsed = parse_opportunity_body(payload, creating=True)
    _check_source(parsed.get('source_id'))
    agent = _assignee(parsed)
    vals = {
        **_vals(parsed),
        'type': 'opportunity',
        'stage_id': request.env['crm.lead']._liwan_first_stage().id,
        'company_id': request.env.company.id,
        'phone': _normalized_phone(parsed['phone']),
        'user_id': agent.id,
        'partner_id': partner.id if partner else False,
    }
    Lead = request.env['crm.lead'].with_context(mail_auto_subscribe_no_notify=True)
    lead = _saved(lambda: Lead.create(vals))
    lead._liwan_notify_assigned()
    return lead


class CrmOpportunitiesController(http.Controller):

    @http.route('/api/v1/crm/opportunities', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def list_opportunities(self, **_):
        args = request.httprequest.args
        filters = parse_list_filters(args, request.env['res.company']._liwan_lead_properties_definition())
        domain = [*visible_domain(), *filter_domain(filters)]
        limit, offset = parse_page(args)
        # Lost opportunities are archived, so they are searched with the archive filter off.
        Lead = request.env['crm.lead'].with_context(active_test=filters.get('status') not in ('lost', 'all'))
        leads = Lead.search(domain, limit=limit, offset=offset, order=ORDER)
        customers = request.env['liwan.customers.service']._liwan_visible_parties(leads.partner_id)
        win = Lead._liwan_win_shape()
        return {
            'items': [dump_opportunity(lead, customers, win) for lead in leads],
            'total': Lead.search_count(domain),
        }

    @http.route('/api/v1/crm/agents', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.assign')
    def list_agents(self, **_):
        """The people an opportunity can be assigned to: the same set the assignment itself accepts, as a person picker reads it."""
        term = (request.httprequest.args.get('q') or '').strip().casefold()
        agents = request.env['liwan.crm.distribution']._liwan_eligible_agents(request.env.company)
        return [
            {'id': user.id, 'name': user.name, 'user_id': user.id}
            for user in agents if term in user.name.casefold()
        ][:MAX_AGENTS]

    @http.route('/api/v1/crm/access', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def get_access(self, **_):
        """What the caller may do that the capability list alone does not say: today, create opportunities."""
        return {'can_create': can_create_opportunity()}

    @http.route('/api/v1/crm/opportunities', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.work', 'crm.leads.assign', match='any')
    def create_opportunity(self, **payload):
        return dump_opportunity(create_opportunity_from_payload(payload))

    @http.route('/api/v1/crm/opportunities/<int:lead_id>', type='json2', auth='user', methods=['GET'],
                readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def get_opportunity(self, lead_id, **_):
        # A read never writes: the viewing log is the explicit POST `<id>/seen` below, so a preview or a
        # prefetch cannot grow a personal-data table (A9-F10).
        return dump_opportunity(find_opportunity(lead_id))

    @http.route('/api/v1/crm/opportunities/<int:lead_id>/seen', type='json2', auth='user', methods=['POST'],
                readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def mark_opportunity_seen(self, lead_id, **_):
        """Record this opening in the audit trail, when the company enabled it; 204 either way."""
        lead = find_opportunity(lead_id)
        request.env['liwan.crm.view.log']._liwan_record(lead)
        return request.make_json_response('', status=204)

    @http.route('/api/v1/crm/opportunities/<int:lead_id>', type='json2', auth='user', methods=['PATCH'],
                readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.work')
    def patch_opportunity(self, lead_id, **payload):
        lead = find_opportunity(lead_id)
        _visibility()._liwan_check_write(lead, request.env.user)
        lead._liwan_require_open()
        parsed = parse_opportunity_body(
            payload, creating=False,
            definition=request.env['res.company']._liwan_lead_properties_definition(lead.company_id),
        )
        _check_source(parsed.get('source_id'))
        if 'stage_id' in parsed:
            _check_stage(parsed['stage_id'])
        vals = _vals(parsed)
        if 'properties' in parsed:
            vals[PROPERTIES_FIELD] = _merged_properties(lead, parsed['properties'])
        if 'phone' in parsed:
            vals['phone'] = _normalized_phone(parsed['phone'], lead)
        _saved(lambda: lead.write(vals))
        return dump_opportunity(lead)

    @http.route('/api/v1/crm/opportunities/<int:lead_id>/customer', type='json2', auth='user', methods=['POST'],
                readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.work')
    def link_customer(self, lead_id, **payload):
        """Link the opportunity to a customer: the one named by ``customer_id``, a new one when ``create_new`` is true,
        or (neither) one made from its own data, which answers 409 ``conflict`` with the candidates when customers with
        its phone exist. A linked opportunity keeps its customer: naming another answers 409 ``already_linked``."""
        unknown = sorted(set(payload) - set(CUSTOMER_FIELDS))
        if unknown:
            raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
        customer_id, create_new = parse_customer_choice(payload)
        lead = find_opportunity(lead_id)
        _visibility()._liwan_check_write(lead, request.env.user)
        lead._liwan_require_open()
        _saved(lambda: lead._liwan_link_customer(customer_id, create_new))
        return dump_opportunity(lead)
