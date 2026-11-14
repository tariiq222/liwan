# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_registered_feature,
)
from odoo.addons.liwan_api.controllers.write_state import session_may_write
from odoo.addons.liwan_api.serializers.company_profile import check_vat_registration
from odoo.addons.liwan_api_account.serializers.company_tax import (
    dump_company_tax,
    parse_company_tax_patch,
)

SERVICE = 'liwan.company.tax.service'
FEATURE_KEYS = ('registry:company_tax',)


def _dump(service, values):
    company = request.env.company
    return dump_company_tax(values, company, service._liwan_can_change() and session_may_write(company))


class CompanyTaxController(http.Controller):

    @http.route('/api/v1/admin/company/tax', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        SERVICE, '_liwan_company_tax_feature_keys', keys=FEATURE_KEYS, operation='read',
        open_method='_liwan_company_tax_platform_owned',
    )
    @requires_capability('settings.company.read')
    def get_company_tax(self):
        service = request.env[SERVICE]
        return _dump(service, service._liwan_establishment_values())

    @http.route('/api/v1/admin/company/tax', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_registered_feature(
        SERVICE, '_liwan_company_tax_feature_keys', keys=FEATURE_KEYS, operation='write',
        open_method='_liwan_company_tax_platform_owned',
    )
    @requires_capability('settings.company.vat.manage')
    def patch_company_tax(self, **payload):
        service = request.env[SERVICE]
        patch = parse_company_tax_patch(payload)
        if patch.get('registered'):
            # The profile route's own number check, so both routes answer the same refusal for the same state.
            check_vat_registration(request.env.company, {'vat_registered': True})
        values = service._liwan_write(**patch)
        return _dump(service, values)
