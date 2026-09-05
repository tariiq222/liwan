# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler

ALLOWED = {'project_creators', 'default_stages'}


class SettingsController(http.Controller):

    @http.route('/api/v1/settings/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_project_settings(self):
        settings = request.env['nasq.pmo.settings']
        if not settings._can_edit():
            raise AccessError(request.env._("Only a customer administrator can read project policies."))
        return settings.get()

    @http.route('/api/v1/settings/projects', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_project_settings(self, **payload):
        unknown = set(payload) - ALLOWED
        if unknown:
            raise ApiError(422, 'unknown_field', f"field {sorted(unknown)[0]!r} is not writable", field=sorted(unknown)[0])
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        try:
            return request.env['nasq.pmo.settings'].set_values(payload)
        except ValueError as e:
            raise ApiError(422, 'invalid', str(e), field=getattr(e, 'nasq_field', None)) from e
