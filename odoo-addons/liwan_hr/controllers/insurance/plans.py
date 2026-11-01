# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/insurance/plans: the policies employees are enrolled in."""
from odoo import http
from odoo.exceptions import MissingError
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.insurance.plan import (
    dump_plan,
    parse_plan_create,
    parse_plan_patch,
    parse_plan_state,
)

PLAN = 'liwan.hr.insurance.plan'


def _plan(plan_id):
    """A plan of the current company the caller's record rules show → 404 otherwise (never a 403)."""
    plan = request.env[PLAN].with_context(active_test=False).search([
        ('id', '=', plan_id), ('company_id', '=', request.env.company.id),
    ], limit=1)
    if not plan:
        raise MissingError(request.env._('liwan.hr.insurance.plan %(id)s does not exist', id=plan_id))
    return plan


def _audit(action, row, before=None):
    request.env['liwan.hr.audit.event']._liwan_log(action, row, before=before)


class HrInsurancePlanController(http.Controller):

    @http.route('/api/v1/hr/insurance/plans', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='read')
    @requires_capability('hr.insurance.read')
    def list_plans(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = [('company_id', '=', request.env.company.id)]
        if args.get('provider_id'):
            domain.append(('provider_id', '=', parse_positive_int(args['provider_id'], 'provider_id')))
        Plan = request.env[PLAN].with_context(active_test=False)
        # Archived plans are listed only when asked for; the derived state is a domain, not a stored column.
        state = parse_plan_state(args.get('state')) or None
        domain = Domain(domain) & (Plan._liwan_state_domain(state) if state else Domain('active', '=', True))
        rows = Plan.search(domain, limit=limit, offset=offset)
        return {'items': [dump_plan(row) for row in rows], 'total': Plan.search_count(domain)}

    @http.route('/api/v1/hr/insurance/plans', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def create_plan(self, **payload):
        vals = parse_plan_create(payload)
        provider = request.env['liwan.hr.insurance.provider'].search([
            ('id', '=', vals['provider_id']), ('company_id', '=', request.env.company.id),
        ], limit=1)
        if not provider:
            raise ApiError(422, 'invalid', 'provider_id does not reference an active provider of the current company', field='provider_id')
        row = request.env[PLAN].create({**vals, 'company_id': request.env.company.id})
        _audit('plan_created', row)
        return request.make_json_response(dump_plan(row), status=201)

    @http.route('/api/v1/hr/insurance/plans/<int:plan_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='read')
    @requires_capability('hr.insurance.read')
    def get_plan(self, plan_id, **_):
        return dump_plan(_plan(plan_id))

    @http.route('/api/v1/hr/insurance/plans/<int:plan_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def patch_plan(self, plan_id, **payload):
        revision, vals = parse_plan_patch(payload)
        row = _plan(plan_id)
        before = request.env['liwan.hr.audit.event']._liwan_policy_snapshot(row)
        row._liwan_save(revision, vals)
        _audit('plan_changed', row, before)
        return dump_plan(row)
