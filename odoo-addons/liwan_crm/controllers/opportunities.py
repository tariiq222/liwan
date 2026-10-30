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
from odoo.addons.liwan_crm.models.distribution import agent_not_eligible
from odoo.addons.liwan_crm.serializers.opportunity import (
    DUPLICATE_PHONE,
    DUPLICATE_PHONE_REASON,
    INVALID_PHONE_REASON,
    dump_opportunity,
    parse_list_filters,
    parse_opportunity_body,
)

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
    return domain


def _normalized_phone(raw, lead=None):
    """E.164 phone for the current company; 422 when invalid or held by another opportunity."""
    company = request.env.company
    Lead = request.env['crm.lead']
    phone = Lead._liwan_normalize_phone(raw, company)
    if not phone:
        raise ApiError(422, 'invalid', 'invalid phone', field='phone', details={'reason': INVALID_PHONE_REASON})
    if (not lead or lead.phone_sanitized != phone) and Lead._liwan_find_duplicate(phone, company):
        raise ApiError(422, 'invalid', DUPLICATE_PHONE, field='phone', details={'reason': DUPLICATE_PHONE_REASON})
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
        raise ApiError(422, 'invalid', DUPLICATE_PHONE, field='phone', details={'reason': DUPLICATE_PHONE_REASON}) from None
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


def _assignee(parsed):
    """Who takes a manual opportunity: the creator, or the chosen user when the caller may assign."""
    me = request.env.user
    company = request.env.company
    if 'user_id' not in parsed or parsed['user_id'] == me.id:
        if not request.env['liwan.access.service']._liwan_has_capability(me, 'crm.leads.work'):
            raise ApiError(403, 'forbidden', 'crm.leads.work capability is required')
        return me
    if not _visibility()._liwan_can_assign(me, company):
        raise ApiError(403, 'forbidden', 'crm.leads.assign capability is required')
    if not parsed['user_id']:
        return request.env['res.users']
    agent = request.env['liwan.crm.distribution']._liwan_eligible_agents(company).filtered(
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
    for name in ('source_id', 'stage_id'):
        if name in parsed:
            vals[name] = parsed[name]
    return vals


class CrmOpportunitiesController(http.Controller):

    @http.route('/api/v1/crm/opportunities', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def list_opportunities(self, **_):
        args = request.httprequest.args
        filters = parse_list_filters(args)
        domain = [*visible_domain(), *filter_domain(filters)]
        limit, offset = parse_page(args)
        # Lost opportunities are archived, so they are searched with the archive filter off.
        Lead = request.env['crm.lead'].with_context(active_test=filters.get('status') not in ('lost', 'all'))
        return {
            'items': [dump_opportunity(lead) for lead in Lead.search(domain, limit=limit, offset=offset, order=ORDER)],
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

    @http.route('/api/v1/crm/opportunities', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.work', 'crm.leads.assign', match='any')
    def create_opportunity(self, **payload):
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
        }
        Lead = request.env['crm.lead'].with_context(mail_auto_subscribe_no_notify=True)
        lead = _saved(lambda: Lead.create(vals))
        lead._liwan_notify_assigned()
        return dump_opportunity(lead)

    @http.route('/api/v1/crm/opportunities/<int:lead_id>', type='json2', auth='user', methods=['GET'],
                readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def get_opportunity(self, lead_id, **_):
        # Not readonly: the view log, when enabled, records this opening.
        lead = find_opportunity(lead_id)
        request.env['liwan.crm.view.log']._liwan_record(lead)
        return dump_opportunity(lead)

    @http.route('/api/v1/crm/opportunities/<int:lead_id>', type='json2', auth='user', methods=['PATCH'],
                readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.work')
    def patch_opportunity(self, lead_id, **payload):
        lead = find_opportunity(lead_id)
        _visibility()._liwan_check_write(lead, request.env.user)
        lead._liwan_require_open()
        parsed = parse_opportunity_body(payload, creating=False)
        _check_source(parsed.get('source_id'))
        if 'stage_id' in parsed:
            _check_stage(parsed['stage_id'])
        vals = _vals(parsed)
        if 'phone' in parsed:
            vals['phone'] = _normalized_phone(parsed['phone'], lead)
        _saved(lambda: lead.write(vals))
        return dump_opportunity(lead)
