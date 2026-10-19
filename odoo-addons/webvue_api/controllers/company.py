# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import api_handler, requires_capability
from odoo.addons.webvue_api.controllers.lookups import list_countries, list_states
from odoo.addons.webvue_api.serializers.company_profile import (
    dump_company_profile,
    parse_company_profile_vals,
    parse_logo_upload,
)


class CompanyController(http.Controller):

    @http.route('/api/v1/admin/company', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability('settings.company.read')
    def admin_company(self):
        return dump_company_profile(request.env.company)

    @http.route('/api/v1/admin/company', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_capability('settings.company.manage')
    def patch_admin_company(self, **payload):
        company = request.env.company
        company._webvue_write_company_profile(parse_company_profile_vals(payload, company))
        return dump_company_profile(company)

    @http.route('/api/v1/admin/company/logo', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_capability('settings.company.manage')
    def upload_admin_company_logo(self, **payload):
        company = request.env.company
        company._webvue_write_company_profile({'logo': parse_logo_upload(payload)})
        return dump_company_profile(company)

    @http.route('/api/v1/admin/company/countries', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability('settings.company.read')
    def list_company_countries(self, **_):
        return list_countries()

    @http.route('/api/v1/admin/company/countries/<int:country_id>/states', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability('settings.company.read')
    def list_company_states(self, country_id, **_):
        return list_states(country_id)
