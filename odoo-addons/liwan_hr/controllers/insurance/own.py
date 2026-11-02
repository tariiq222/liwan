# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/insurance/me: the caller's own enrollments, and their dependents when the company's policy shows them."""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.insurance.enrollment import dump_own_enrollment

ENROLLMENT = 'liwan.hr.insurance.enrollment'


class HrInsuranceOwnController(http.Controller):

    @http.route('/api/v1/hr/insurance/me', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='read')
    @requires_capability('hr.employees.read')
    def list_own_enrollments(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        domain = [
            ('employee_user_id', '=', request.env.uid), ('company_id', '=', request.env.company.id),
            ('state', '!=', 'cancelled'),
        ]
        policy = request.env['liwan.hr.insurance.settings']._liwan_effective(request.env.company)
        show_dependents = policy['insurance_visibility'] == 'own_enrollment_and_dependents'
        Enrollment = request.env[ENROLLMENT]
        rows = Enrollment.search(domain, limit=limit, offset=offset)
        return {
            'items': [dump_own_enrollment(row, show_dependents) for row in rows],
            'total': Enrollment.search_count(domain),
        }
