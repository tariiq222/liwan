# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/insurance/enrollments: employees in plans, with their dependents (the insurance capabilities).

Enrollments and dependents are private to the employee they cover. The routes below are for the insurance
readers and managers; the employee reads their own through `/me`. Ending and cancelling are actions, and every
step is audited without copying the member number, the identity numbers, the names or the notes.
"""
from datetime import timedelta

from odoo import fields, http
from odoo.exceptions import MissingError
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.insurance.common import (
    parse_end,
    parse_revision_only,
)
from odoo.addons.liwan_hr.serializers.insurance.dependent import (
    dump_dependent,
    parse_dependent_create,
    parse_dependent_patch,
)
from odoo.addons.liwan_hr.serializers.insurance.enrollment import (
    dump_enrollment,
    parse_enrollment_create,
    parse_enrollment_patch,
    parse_enrollment_state,
)

ENROLLMENT = 'liwan.hr.insurance.enrollment'
DEPENDENT = 'liwan.hr.insurance.dependent'


def _enrollment(enrollment_id):
    """An enrollment of the current company the caller's record rules show → 404 otherwise (never a 403)."""
    row = request.env[ENROLLMENT].search([
        ('id', '=', enrollment_id), ('company_id', '=', request.env.company.id),
    ], limit=1)
    if not row:
        raise MissingError(request.env._('liwan.hr.insurance.enrollment %(id)s does not exist', id=enrollment_id))
    return row


def _dependent(dependent_id):
    row = request.env[DEPENDENT].search([
        ('id', '=', dependent_id), ('company_id', '=', request.env.company.id),
    ], limit=1)
    if not row:
        raise MissingError(request.env._('liwan.hr.insurance.dependent %(id)s does not exist', id=dependent_id))
    return row


def _expiring_domain():
    """Active enrollments whose coverage ends inside the company's alert window."""
    days = request.env['liwan.hr.insurance.settings']._liwan_effective(request.env.company)['insurance_expiry_alert_days']
    today = fields.Date.context_today(request.env[ENROLLMENT])
    return [
        ('state', '=', 'active'), ('date_end_effective', '>=', today),
        ('date_end_effective', '<=', today + timedelta(days=days)),
    ]


class HrInsuranceEnrollmentController(http.Controller):

    @http.route('/api/v1/hr/insurance/enrollments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='read')
    @requires_capability('hr.insurance.read')
    def list_enrollments(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        Enrollment = request.env[ENROLLMENT]
        domain = [('company_id', '=', request.env.company.id)]
        if args.get('employee_id'):
            domain.append(('employee_id', '=', parse_positive_int(args['employee_id'], 'employee_id')))
        if args.get('plan_id'):
            domain.append(('plan_id', '=', parse_positive_int(args['plan_id'], 'plan_id')))
        state = parse_enrollment_state(args.get('state'))
        if state:
            domain = Domain(domain) & Enrollment._liwan_state_domain(state)
        if args.get('expiring') == 'true':
            domain = Domain(domain) & Domain(_expiring_domain())
        rows = Enrollment.search(domain, limit=limit, offset=offset)
        return {'items': [dump_enrollment(row) for row in rows], 'total': Enrollment.search_count(domain)}

    @http.route('/api/v1/hr/insurance/enrollments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def create_enrollment(self, **payload):
        row = request.env[ENROLLMENT].action_create(parse_enrollment_create(payload))
        return request.make_json_response(dump_enrollment(row, detail=True, full=True), status=201)

    @http.route('/api/v1/hr/insurance/enrollments/<int:enrollment_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='read')
    @requires_capability('hr.insurance.read')
    def get_enrollment(self, enrollment_id, **_):
        row = _enrollment(enrollment_id)
        # Readers see the dependents' identity numbers masked; whole ones are for the insurance managers.
        return dump_enrollment(row, detail=True, full=request.env[ENROLLMENT]._liwan_can_manage(row.company_id))

    @http.route('/api/v1/hr/insurance/enrollments/<int:enrollment_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def patch_enrollment(self, enrollment_id, **payload):
        revision, vals = parse_enrollment_patch(payload)
        return dump_enrollment(_enrollment(enrollment_id).action_update(revision, vals), detail=True, full=True)

    @http.route('/api/v1/hr/insurance/enrollments/<int:enrollment_id>/end', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def end_enrollment(self, enrollment_id, **payload):
        revision, date_end = parse_end(payload)
        return dump_enrollment(_enrollment(enrollment_id).action_end(revision, date_end), detail=True, full=True)

    @http.route('/api/v1/hr/insurance/enrollments/<int:enrollment_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def cancel_enrollment(self, enrollment_id, **payload):
        revision = parse_revision_only(payload)
        return dump_enrollment(_enrollment(enrollment_id).action_cancel(revision), detail=True, full=True)

    @http.route('/api/v1/hr/insurance/enrollments/<int:enrollment_id>/dependents', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def add_dependent(self, enrollment_id, **payload):
        vals = parse_dependent_create(payload)
        row = request.env[DEPENDENT].action_add(_enrollment(enrollment_id), vals)
        return request.make_json_response(dump_dependent(row, full=True), status=201)

    @http.route('/api/v1/hr/insurance/dependents/<int:dependent_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def patch_dependent(self, dependent_id, **payload):
        revision, vals = parse_dependent_patch(payload)
        return dump_dependent(_dependent(dependent_id).action_update(revision, vals), full=True)

    @http.route('/api/v1/hr/insurance/dependents/<int:dependent_id>/end', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def end_dependent(self, dependent_id, **payload):
        revision, date_end = parse_end(payload)
        return dump_dependent(_dependent(dependent_id).action_end(revision, date_end), full=True)
