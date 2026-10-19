# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http

from .common import require_any_capability
from odoo.addons.webvue_api.controllers.common import api_handler, requires_feature
from odoo.addons.webvue_api.controllers.lookups import list_countries, list_states

# The lookups feed the address fields of a partner and of the company setup, so either reader may use them.
LOOKUP_CAPABILITIES = ('finance.partners.read', 'finance.setup.read')


class FinanceLookupController(http.Controller):

    @http.route('/api/v1/finance/countries', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_countries(self, **_):
        require_any_capability(LOOKUP_CAPABILITIES)
        return list_countries()

    @http.route('/api/v1/finance/countries/<int:country_id>/states', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_states(self, country_id, **_):
        require_any_capability(LOOKUP_CAPABILITIES)
        return list_states(country_id)
