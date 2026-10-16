# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError, api_handler

# Future billing paths. json2 does not parse a body when Content-Length is 0,
# and this handler never reads one. A missing profile is not treated as SaaS.
COMMERCIAL_UNAVAILABLE = 'commercial self-service is not enabled for this installation'


class CommercialController(http.Controller):

    @http.route(
        '/api/commercial/v1/<path:subpath>',
        type='json2', auth='user', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        readonly=True,
    )
    @api_handler
    def unavailable(self, subpath, **_ignored):
        del subpath, _ignored
        profile = request.env['webvue.tenant.profile'].sudo().search([], limit=1)
        if not profile or profile.commercial_mode != 'saas':
            raise ApiError(404, 'commercial_unavailable', COMMERCIAL_UNAVAILABLE)
        # SaaS still has no billing surface until a later authorized phase.
        raise ApiError(404, 'commercial_unavailable', COMMERCIAL_UNAVAILABLE)
