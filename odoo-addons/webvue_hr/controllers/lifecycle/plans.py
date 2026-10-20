# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/{onboarding,offboarding}/plans: the employee activity plans of each area."""
from odoo import Command, http
from odoo.exceptions import AccessError
from odoo.http import request

from .common import EMPLOYEE_MODEL, OFFBOARDING, ONBOARDING, _purpose_plan, _require
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.lifecycle.plan import (
    TODO_ACTIVITY_XMLID,
    dump_plan,
    parse_plan_create,
    parse_plan_patch,
)

MAX_LIMIT = 200
ACTIVE_CHOICES = {'true': True, 'false': False, 'all': None}


def _list_plans(area):
    args = request.httprequest.args
    limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
    offset = parse_nonneg_int(args.get('offset', 0), 'offset')
    active = _parse_active(args.get('active'))
    domain = [
        ('res_model', '=', EMPLOYEE_MODEL),
        ('hr_purpose', '=', area),
        ('company_id', 'in', [request.env.company.id, False]),
    ]
    if active is not None:
        domain.append(('active', '=', active))
    Plan = request.env['mail.activity.plan'].with_context(active_test=False)
    plans = Plan.search(domain, order='name, id', limit=limit, offset=offset)
    return {'items': [dump_plan(plan) for plan in plans], 'total': Plan.search_count(domain)}


def _create_plan(area, payload):
    vals = parse_plan_create(payload)
    steps = vals.pop('steps')
    vals.update({'hr_purpose': area, 'company_id': request.env.company.id})
    _validate_plan_relations(vals, steps)
    plan = request.env['mail.activity.plan'].create(vals)
    _set_plan_steps(plan, steps)
    return dump_plan(plan)


def _patch_plan(area, plan_id, payload):
    plan = _purpose_plan(area, plan_id)
    vals = parse_plan_patch(payload)
    steps = vals.pop('steps', None)
    _validate_plan_relations(vals, steps or [])
    if vals:
        plan.write(vals)
    if steps is not None:
        _set_plan_steps(plan, steps)
    return dump_plan(plan)


def _visible(model, domain):
    """The first matching record, or an empty recordset the caller may not read.

    A payload relation the caller cannot see is an invalid value for that field, so the
    route answers 422 with the field instead of leaking an access error.
    """
    try:
        return request.env[model].search(domain, limit=1)
    except AccessError:
        return request.env[model]


def _validate_plan_relations(vals, steps):
    department_id = vals.get('department_id')
    if department_id and not _visible('hr.department', [
        ('id', '=', department_id),
        ('company_id', 'in', [request.env.company.id, False]),
    ]):
        raise ApiError(422, 'invalid', 'department_id is not available', field='department_id')
    for step in steps:
        user_id = step.get('responsible_id')
        if not user_id:
            continue
        if not _visible('res.users', [
            ('id', '=', user_id),
            ('active', '=', True),
            ('company_ids', 'in', [request.env.company.id]),
        ]):
            raise ApiError(422, 'invalid', 'responsible_user_id is not available', field='responsible_user_id')


def _set_plan_steps(plan, steps):
    """Replace the plan's templates; the activity type is always the stock todo."""
    activity_type = request.env.ref(TODO_ACTIVITY_XMLID)
    plan.write({'template_ids': [
        Command.clear(),
        *[
            Command.create({**step, 'activity_type_id': activity_type.id})
            for step in steps
        ],
    ]})


def _parse_active(value):
    if value in (None, ''):
        return True
    if value not in ACTIVE_CHOICES:
        raise ApiError(422, 'invalid', 'active must be true, false or all', field='active')
    return ACTIVE_CHOICES[value]


class HrLifecyclePlanController(http.Controller):

    @http.route('/api/v1/hr/onboarding/plans', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='read')
    def list_onboarding_plans(self, **_):
        _require('hr.onboarding.read')
        return _list_plans(ONBOARDING)

    @http.route('/api/v1/hr/onboarding/plans', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='write')
    def create_onboarding_plan(self, **payload):
        _require('hr.onboarding.manage')
        return request.make_json_response(_create_plan(ONBOARDING, payload), status=201)

    @http.route('/api/v1/hr/onboarding/plans/<int:plan_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='read')
    def get_onboarding_plan(self, plan_id):
        _require('hr.onboarding.read')
        return dump_plan(_purpose_plan(ONBOARDING, plan_id))

    @http.route('/api/v1/hr/onboarding/plans/<int:plan_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='write')
    def patch_onboarding_plan(self, plan_id, **payload):
        _require('hr.onboarding.manage')
        return _patch_plan(ONBOARDING, plan_id, payload)

    @http.route('/api/v1/hr/offboarding/plans', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='read')
    def list_offboarding_plans(self, **_):
        _require('hr.offboarding.read')
        return _list_plans(OFFBOARDING)

    @http.route('/api/v1/hr/offboarding/plans', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='write')
    def create_offboarding_plan(self, **payload):
        _require('hr.offboarding.manage')
        return request.make_json_response(_create_plan(OFFBOARDING, payload), status=201)

    @http.route('/api/v1/hr/offboarding/plans/<int:plan_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='read')
    def get_offboarding_plan(self, plan_id):
        _require('hr.offboarding.read')
        return dump_plan(_purpose_plan(OFFBOARDING, plan_id))

    @http.route('/api/v1/hr/offboarding/plans/<int:plan_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='write')
    def patch_offboarding_plan(self, plan_id, **payload):
        _require('hr.offboarding.manage')
        return _patch_plan(OFFBOARDING, plan_id, payload)
