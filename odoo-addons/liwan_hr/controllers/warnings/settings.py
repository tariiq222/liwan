# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/warnings/settings: who may issue, how the employee answers, the escalation window."""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.warnings.settings import (
    dump_settings,
    parse_settings,
)

SETTINGS = 'liwan.hr.warning.settings'


def _can_issue():
    return request.env['liwan.hr.warning']._liwan_can_issue_any(request.env.company)


class HrWarningSettingsController(http.Controller):

    @http.route('/api/v1/hr/warnings/settings', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='read')
    @requires_capability('hr.employees.read', 'hr.warnings.manage', match='any')
    def get_settings(self, **_):
        request.env['liwan.hr.warning.type']._liwan_ensure_for_caller()
        return dump_settings(request.env[SETTINGS]._liwan_current(), _can_issue())

    @http.route('/api/v1/hr/warnings/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='write')
    @requires_capability('hr.warnings.manage')
    def patch_settings(self, **payload):
        vals, revision = parse_settings(payload)
        model = request.env[SETTINGS]
        before = request.env['liwan.hr.audit.event']._liwan_policy_snapshot(model._liwan_current())
        row = model.action_save(vals, revision)
        request.env['liwan.hr.audit.event']._liwan_log('warning_settings_changed', row, before)
        return dump_settings(row, _can_issue())
