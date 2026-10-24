# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import api_handler
from odoo.addons.webvue_api.serializers.company import (
    dump_branding,
    parse_branding_vals,
)


class BrandingController(http.Controller):

    @http.route('/api/v1/branding', type='json2', auth='public', methods=['GET'], readonly=True)
    def branding(self):
        # `auth='public'`: no session, so the tenant singleton and its root company are
        # read through one narrow elevation instead of a full superuser environment.
        # The response is the public branding payload only; no other record is reachable
        # from this route.
        profile = request.env['webvue.tenant.profile'].sudo().search([], limit=1)
        if not profile:
            msg = 'webvue tenant profile is not configured'
            raise MissingError(msg)
        company = profile.root_company_id
        return request.make_json_response(
            dump_branding(company),
            headers=[('Cache-Control', 'public, max-age=300')],
        )

    @staticmethod
    def _check_admin():
        request.env['webvue.access.service']._webvue_require_capability(
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
        company._webvue_write_branding(parse_branding_vals(payload))
        return dump_branding(company)
