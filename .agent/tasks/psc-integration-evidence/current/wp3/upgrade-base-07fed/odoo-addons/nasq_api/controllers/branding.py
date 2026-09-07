# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import api_handler
from odoo.addons.nasq_api.serializers.company import dump_branding, parse_branding_vals


class BrandingController(http.Controller):

    @http.route('/api/v1/branding', type='json2', auth='public', methods=['GET'], readonly=True)
    def branding(self):
        company = request.env['res.company'].sudo().search([], order='id', limit=1)
        return request.make_json_response(
            dump_branding(company),
            headers=[('Cache-Control', 'public, max-age=300')],
        )

    @staticmethod
    def _check_admin():
        request.env['nasq.access.service']._nasq_require_capability(
            'settings.branding.manage',
        )

    @http.route('/api/v1/admin/branding', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def admin_branding(self):
        self._check_admin()
        return dump_branding(request.env.company)

    @http.route('/api/v1/admin/branding', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_admin_branding(self, **payload):
        self._check_admin()
        company = request.env.company
        company._nasq_write_branding(parse_branding_vals(payload))
        return dump_branding(company)
