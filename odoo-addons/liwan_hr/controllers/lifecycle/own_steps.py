# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/self/onboarding-steps: the onboarding steps assigned to the caller, and finishing one.

Whoever a step is assigned to (the new employee, their manager or coach) has no onboarding capability, so these
routes serve the caller's own steps only: the runs a record rule lets them read, and of those the activities
assigned to their user. Nothing else of the run or the employee is returned.
"""
from odoo import http
from odoo.http import request

from .common import ONBOARDING, _missing
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.lifecycle.own_step import dump_own_step
from odoo.addons.liwan_hr.serializers.lifecycle.run import parse_step_done


def _own_steps():
    """``(run, activity)`` pairs of the open steps assigned to the caller on an open onboarding run: their own, or one they are assigned a step of."""
    runs = request.env['liwan.hr.plan.run'].search([
        ('hr_purpose', '=', ONBOARDING), ('state', '=', 'open'),
        '|', ('employee_user_id', '=', request.env.uid), ('assignee_ids', 'in', [request.env.uid]),
    ])
    pairs = [(run, activity) for run in runs for activity in run.activity_ids if activity.user_id == request.env.user]
    return sorted(pairs, key=lambda pair: (pair[1].date_deadline, pair[1].id))


class HrOwnOnboardingStepController(http.Controller):

    @http.route('/api/v1/hr/self/onboarding-steps', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='read')
    @requires_capability('hr.employees.read')
    def list_own_steps(self, **_):
        items = [dump_own_step(run, activity) for run, activity in _own_steps()]
        return {'items': items, 'total': len(items)}

    @http.route(
        '/api/v1/hr/self/onboarding-steps/<int:activity_id>/done',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('hr.enabled', 'hr.onboarding', operation='write')
    @requires_capability('hr.employees.read')
    def complete_own_step(self, activity_id, **payload):
        feedback = parse_step_done(payload)['feedback']
        found = [(run, activity) for run, activity in _own_steps() if activity.id == activity_id]
        if not found:
            _missing('mail.activity', activity_id)
        run, activity = found[0]
        if activity.state == 'done':
            raise ApiError(422, 'invalid', 'this step is already done', field='step')
        activity.action_feedback(feedback=feedback or False)
        return {'id': activity_id, 'run_id': run.id, 'done': True}
