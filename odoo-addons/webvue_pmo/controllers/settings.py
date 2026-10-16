# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)

ALLOWED = {
    'project_creators',
    'default_stages',
    'require_manager_on_create',
    'require_end_date_on_create',
    'default_completion_approval',
    'deadline_reminders_enabled',
    'deadline_reminders_days_before',
    'overdue_digest_enabled',
    'require_charter_approval',
}


class SettingsController(http.Controller):

    @http.route('/api/v1/settings/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_project_settings(self):
        settings = request.env['webvue.pmo.settings']
        if not settings._can_edit():
            raise AccessError(request.env._("Only a customer administrator can read project policies."))
        return settings.get()

    @http.route('/api/v1/settings/projects/create-defaults', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_project_create_defaults(self):
        if not request.env['project.project']._webvue_can_create():
            raise AccessError(request.env._("You are not allowed to create projects."))
        return request.env['webvue.pmo.settings'].get_create_defaults()

    @http.route('/api/v1/settings/projects', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_project_settings(self, **payload):
        unknown = set(payload) - ALLOWED
        if unknown:
            raise ApiError(422, 'unknown_field', f"field {sorted(unknown)[0]!r} is not writable", field=sorted(unknown)[0])
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        try:
            return request.env['webvue.pmo.settings'].set_values(payload)
        except ValueError as e:
            raise ApiError(422, 'invalid', str(e), field=getattr(e, 'webvue_field', None)) from e
