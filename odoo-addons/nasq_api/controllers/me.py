# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.serializers.user import dump_me


class MeController(http.Controller):

    @http.route('/api/v1/me', type='json2', auth='user', methods=['GET'], readonly=True)
    def me(self):
        return dump_me(request.env.user)
