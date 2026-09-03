# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.serializers.company import dump_branding


class BrandingController(http.Controller):

    @http.route('/api/v1/branding', type='json2', auth='public', methods=['GET'], readonly=True)
    def branding(self):
        company = request.env['res.company'].sudo().search([], order='id', limit=1)
        return request.make_json_response(
            dump_branding(company),
            headers=[('Cache-Control', 'public, max-age=300')],
        )
