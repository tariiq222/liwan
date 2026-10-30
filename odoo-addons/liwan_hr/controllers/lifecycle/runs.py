# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/{onboarding,offboarding}/runs: one launch of a plan and its checklist."""
from odoo import http
from odoo.http import request

from .common import (
    OFFBOARDING,
    ONBOARDING,
    _can,
    _employee,
    _launch_run,
    _purpose_plan,
    _reject_self_decision,
    _require,
    _require_step_decision,
    _run,
    _run_step,
)
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.lifecycle.run import (
    dump_run,
    dump_run_detail,
    parse_run_cancel,
    parse_run_create,
    parse_step_done,
)

RUN_STATES = ('open', 'done', 'cancelled')


def _list_runs(area):
    args = request.httprequest.args
    limit, offset = parse_page(args)
    state = _parse_state(args.get('state'))
    domain = [
        ('company_id', 'in', request.env.companies.ids),
        ('plan_id.hr_purpose', '=', area),
    ]
    employee_id = args.get('employee_id')
    if employee_id not in (None, ''):
        domain.append(('employee_id', '=', parse_positive_int(employee_id, 'employee_id')))
    runs = request.env['liwan.hr.plan.run'].search(domain, order='plan_date desc, id desc')
    # The state is derived from the checklist, so it is filtered after the read.
    items = [dump_run(run) for run in runs]
    if state:
        items = [item for item in items if item['state'] == state]
    return {'items': items[offset:offset + limit], 'total': len(items)}


def _launch(area, payload):
    vals = parse_run_create(payload)
    employee = _employee(vals['employee_id'])
    if area == OFFBOARDING:
        _reject_self_decision(employee)
    plan = _purpose_plan(area, vals['plan_id'])
    run = _launch_run(area, employee, plan, vals.get('plan_date'))
    return request.make_json_response(_detail(area, run), status=201)


def _detail(area, run):
    return dump_run_detail(run, manage=_can(f'hr.{area}.manage'), caller=request.env.user)


def _complete_step(area, run_id, activity_id, payload):
    run, activity = _run_step(area, run_id, activity_id)
    _require_step_decision(area, run, activity)
    if run.state == 'cancelled':
        raise ApiError(422, 'invalid', 'this plan run is cancelled', field='step')
    vals = parse_step_done(payload)
    if activity.state == 'done':
        raise ApiError(422, 'invalid', 'this step is already done', field='step')
    activity.action_feedback(feedback=vals['feedback'] or False)
    return _detail(area, _run(area, run_id))


def _cancel(area, run_id, payload):
    """Cancel a run launched by mistake; an offboarding manager never cancels their own clearance."""
    run = _run(area, run_id)
    if area == OFFBOARDING:
        _reject_self_decision(run.employee_id)
    # A done or already cancelled run is a model ValidationError, which api_handler answers 422.
    run.action_cancel(parse_run_cancel(payload)['reason'])
    return _detail(area, run)


def _parse_state(value):
    if value in (None, ''):
        return None
    if value not in RUN_STATES:
        raise ApiError(422, 'invalid', f"state must be one of {', '.join(RUN_STATES)}", field='state')
    return value


class HrLifecycleRunController(http.Controller):

    @http.route('/api/v1/hr/onboarding/runs', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='read')
    def list_onboarding_runs(self, **_):
        _require('hr.onboarding.read')
        return _list_runs(ONBOARDING)

    @http.route('/api/v1/hr/onboarding/runs', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='write')
    def create_onboarding_run(self, **payload):
        _require('hr.onboarding.manage')
        return _launch(ONBOARDING, payload)

    @http.route('/api/v1/hr/onboarding/runs/<int:run_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='read')
    def get_onboarding_run(self, run_id):
        _require('hr.onboarding.read')
        return _detail(ONBOARDING, _run(ONBOARDING, run_id))

    @http.route('/api/v1/hr/onboarding/runs/<int:run_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='write')
    def cancel_onboarding_run(self, run_id, **payload):
        _require('hr.onboarding.manage')
        return _cancel(ONBOARDING, run_id, payload)

    @http.route('/api/v1/hr/onboarding/runs/<int:run_id>/steps/<int:activity_id>/done', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='write')
    def complete_onboarding_step(self, run_id, activity_id, **payload):
        _require('hr.onboarding.read')
        return _complete_step(ONBOARDING, run_id, activity_id, payload)

    @http.route('/api/v1/hr/offboarding/runs', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='write')
    def create_offboarding_run(self, **payload):
        _require('hr.offboarding.manage')
        return _launch(OFFBOARDING, payload)

    @http.route('/api/v1/hr/offboarding/runs/<int:run_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='read')
    def get_offboarding_run(self, run_id):
        _require('hr.offboarding.read')
        return _detail(OFFBOARDING, _run(OFFBOARDING, run_id))

    @http.route('/api/v1/hr/offboarding/runs/<int:run_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='write')
    def cancel_offboarding_run(self, run_id, **payload):
        _require('hr.offboarding.manage')
        return _cancel(OFFBOARDING, run_id, payload)

    @http.route('/api/v1/hr/offboarding/runs/<int:run_id>/steps/<int:activity_id>/done', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='write')
    def complete_offboarding_step(self, run_id, activity_id, **payload):
        _require('hr.offboarding.read')
        return _complete_step(OFFBOARDING, run_id, activity_id, payload)
