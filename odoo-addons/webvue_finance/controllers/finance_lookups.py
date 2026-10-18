# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, require_any_capability
from odoo.addons.webvue_api.controllers.common import api_handler, requires_feature
from odoo.addons.webvue_finance.serializers.lookup import dump_countries, dump_states

# The lookups feed the address fields of a partner and of the company setup, so either reader may use them.
LOOKUP_CAPABILITIES = ('finance.partners.read', 'finance.setup.read')


def _name_domain():
    query = (request.httprequest.args.get('q') or '').strip()
    return ['|', ('name', 'ilike', query), ('code', 'ilike', query)] if query else []


class FinanceLookupController(http.Controller):

    @http.route('/api/v1/finance/countries', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_countries(self, **_):
        require_any_capability(LOOKUP_CAPABILITIES)
        return list_page('res.country', _name_domain(), dump_countries)

    @http.route('/api/v1/finance/countries/<int:country_id>/states', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_states(self, country_id, **_):
        require_any_capability(LOOKUP_CAPABILITIES)
        if not request.env['res.country'].search_count([('id', '=', country_id)]):
            raise MissingError(request.env._('res.country %(id)s does not exist', id=country_id))
        return list_page('res.country.state', [('country_id', '=', country_id), *_name_domain()], dump_states)
