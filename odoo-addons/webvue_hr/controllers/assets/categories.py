# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import current_company
from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.assets.category import (
    dump_categories,
    parse_category_vals,
)
from odoo.addons.webvue_hr.serializers.assets.common import ref


class HrAssetsCategoryController(http.Controller):

    @http.route('/api/v1/hr/assets/categories', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='read')
    @requires_capability('hr.assets.read')
    def list_categories(self, **_):
        # A category is either the company's own or shared with every company.
        categories = request.env['maintenance.equipment.category'].search([
            '|', ('company_id', '=', current_company().id), ('company_id', '=', False),
        ], order='name, id')
        return {'items': dump_categories(categories), 'total': len(categories)}

    @http.route('/api/v1/hr/assets/categories', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='write')
    @requires_capability('hr.assets.manage')
    def create_category(self, **payload):
        vals = parse_category_vals(payload)
        category = request.env['maintenance.equipment.category'].create(vals)
        return request.make_json_response(ref(category), status=201)
