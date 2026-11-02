# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/insurance/settings and /summary: the company's insurance policy and the dashboard figures."""
from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.insurance.settings import (
    dump_settings,
    parse_settings,
)

SETTINGS = 'liwan.hr.insurance.settings'


def _summary():
    """Counts only (no names, no numbers): the figures the HR dashboard card shows."""
    company = request.env.company
    Enrollment = request.env['liwan.hr.insurance.enrollment']
    today = fields.Date.context_today(Enrollment)
    days = request.env[SETTINGS]._liwan_effective(company)['insurance_expiry_alert_days']
    covering = [
        ('company_id', '=', company.id), ('state', '=', 'active'),
        ('date_from', '<=', today), ('date_end_effective', '>=', today),
    ]
    enrollments = Enrollment.search(covering)
    dependents = request.env['liwan.hr.insurance.dependent'].search_count([
        ('enrollment_id', 'in', enrollments.ids), ('state', '=', 'active'),
        ('date_from', '<=', today), '|', ('date_to', '=', False), ('date_to', '>=', today),
    ])
    plans = request.env['liwan.hr.insurance.plan'].search_count([
        ('company_id', '=', company.id), ('active', '=', True),
        ('valid_to', '>=', today), ('valid_to', '<=', today + timedelta(days=days)),
    ])
    uncovered = request.env['hr.employee'].search_count([
        ('company_id', '=', company.id), ('id', 'not in', enrollments.employee_id.ids),
    ])
    return {
        'active_members': len(enrollments) + dependents,
        'active_enrollments': len(enrollments),
        'active_dependents': dependents,
        'expiring_plans': plans,
        'employees_without_insurance': uncovered,
        'expiry_alert_days': days,
    }


class HrInsuranceSettingsController(http.Controller):

    @http.route('/api/v1/hr/insurance/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='read')
    @requires_capability('hr.employees.read', 'hr.insurance.manage', match='any')
    def get_settings(self, **_):
        return dump_settings(request.env[SETTINGS]._liwan_current())

    @http.route('/api/v1/hr/insurance/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def patch_settings(self, **payload):
        vals, revision = parse_settings(payload)
        model = request.env[SETTINGS]
        before = request.env['liwan.hr.audit.event']._liwan_policy_snapshot(model._liwan_current())
        row = model.action_save(vals, revision)
        request.env['liwan.hr.audit.event']._liwan_log('insurance_settings_changed', row, before)
        return dump_settings(row)

    @http.route('/api/v1/hr/insurance/summary', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='read')
    @requires_capability('hr.insurance.read')
    def get_summary(self, **_):
        return _summary()
