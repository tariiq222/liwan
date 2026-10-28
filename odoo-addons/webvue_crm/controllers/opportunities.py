# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import fields, http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_crm.serializers.opportunity import (
    DUPLICATE_PHONE,
    dump_opportunity,
    parse_list_filters,
    parse_opportunity_body,
)

ORDER = 'create_date desc, id desc'


def _visibility():
    return request.env['webvue.crm.visibility']


def visible_domain():
    return _visibility()._webvue_domain(request.env.user)


def find_opportunity(lead_id):
    """The opportunity, lost ones included, when the caller may read it.

    404 for a hidden, foreign or missing one alike.
    """
    lead = request.env['crm.lead'].with_context(active_test=False).search([('id', '=', lead_id), *visible_domain()], limit=1)
    if not lead:
        raise ApiError(404, 'not_found', 'Record does not exist')
    # Back to the normal archive filter: whatever the lead reads or searches next ignores archived records.
    return lead.with_context(active_test=True)


def filter_domain(filters):
    domain = [(name, '=', filters[name]) for name in ('stage_id', 'user_id', 'source_id') if name in filters]
    now = fields.Datetime.now()
    if 'due' in filters:
        domain += [('webvue_next_call_at', '<=', now)] if filters['due'] else [
            '|', ('webvue_next_call_at', '=', False), ('webvue_next_call_at', '>', now),
        ]
    if 'unassigned' in filters:
        domain.append(('user_id', '=' if filters['unassigned'] else '!=', False))
    if 'needs_manager' in filters:
        domain.append(('webvue_needs_manager', '=', filters['needs_manager']))
    if filters.get('q'):
        text = filters['q']
        domain += ['|', '|', '|', ('contact_name', 'ilike', text), ('phone', 'ilike', text),
                   ('phone_sanitized', 'ilike', text), ('email_from', 'ilike', text)]
    return domain


def _normalized_phone(raw, lead=None):
    """E.164 phone for the current company; 422 when invalid or held by another opportunity."""
    company = request.env.company
    Lead = request.env['crm.lead']
    phone = Lead._webvue_normalize_phone(raw, company)
    if not phone:
        raise ApiError(422, 'invalid', 'invalid phone', field='phone')
    if (not lead or lead.phone_sanitized != phone) and Lead._webvue_find_duplicate(phone, company):
        raise ApiError(422, 'invalid', DUPLICATE_PHONE, field='phone')
    return phone


def _saved(operation):
    """Run a create or write and flush it; a phone taken meanwhile answers the same 422."""
    try:
        with request.env.cr.savepoint():
            result = operation()
            request.env.flush_all()
    except UniqueViolation as error:
        if not request.env['crm.lead']._webvue_is_duplicate_phone(error):
            raise
        raise ApiError(422, 'invalid', DUPLICATE_PHONE, field='phone') from None
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
        if not request.env['webvue.access.service']._webvue_has_capability(me, 'crm.leads.work'):
            raise ApiError(403, 'forbidden', 'crm.leads.work capability is required')
        return me
    if not _visibility()._webvue_can_assign(me, company):
        raise ApiError(403, 'forbidden', 'crm.leads.assign capability is required')
    if not parsed['user_id']:
        return request.env['res.users']
    agent = request.env['webvue.crm.distribution']._webvue_eligible_agents(company).filtered(
        lambda user: user.id == parsed['user_id'],
    )
    if not agent:
        raise ApiError(422, 'invalid', 'the chosen agent cannot take opportunities', field='user_id')
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
        domain = [*visible_domain(), *filter_domain(parse_list_filters(args))]
        limit, offset = parse_page(args)
        Lead = request.env['crm.lead']
        return {
            'items': [dump_opportunity(lead) for lead in Lead.search(domain, limit=limit, offset=offset, order=ORDER)],
            'total': Lead.search_count(domain),
        }

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
            'company_id': request.env.company.id,
            'phone': _normalized_phone(parsed['phone']),
            'user_id': agent.id,
        }
        Lead = request.env['crm.lead'].with_context(mail_auto_subscribe_no_notify=True)
        lead = _saved(lambda: Lead.create(vals))
        lead._webvue_notify_assigned()
        return dump_opportunity(lead)

    @http.route('/api/v1/crm/opportunities/<int:lead_id>', type='json2', auth='user', methods=['GET'],
                readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def get_opportunity(self, lead_id, **_):
        # Not readonly: the view log, when enabled, records this opening.
        lead = find_opportunity(lead_id)
        request.env['webvue.crm.view.log']._webvue_record(lead)
        return dump_opportunity(lead)

    @http.route('/api/v1/crm/opportunities/<int:lead_id>', type='json2', auth='user', methods=['PATCH'],
                readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.work')
    def patch_opportunity(self, lead_id, **payload):
        lead = find_opportunity(lead_id)
        _visibility()._webvue_check_write(lead, request.env.user)
        lead._webvue_require_open()
        parsed = parse_opportunity_body(payload, creating=False)
        _check_source(parsed.get('source_id'))
        if 'stage_id' in parsed:
            _check_stage(parsed['stage_id'])
        vals = _vals(parsed)
        if 'phone' in parsed:
            vals['phone'] = _normalized_phone(parsed['phone'], lead)
        _saved(lambda: lead.write(vals))
        return dump_opportunity(lead)
