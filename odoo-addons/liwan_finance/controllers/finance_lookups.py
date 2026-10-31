# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import parse_choice, require_any_capability
from odoo.addons.liwan_api.controllers.common import api_handler, requires_feature
from odoo.addons.liwan_api.controllers.lookups import list_countries, list_states

# The lookups feed the address fields of a partner and of the company setup, so either reader may use them.
LOOKUP_CAPABILITIES = ('finance.partners.read', 'finance.setup.read')
# The names are read in the language of the screen (``?lang=``), not the Odoo language stored on the user, which a
# seeded or imported account may keep in English while it works in the Arabic interface.
SCREEN_LANGUAGES = {'ar': 'ar_001', 'en': 'en_US'}


def _use_screen_language():
    code = parse_choice(request.httprequest.args.get('lang'), SCREEN_LANGUAGES, 'lang')
    if code:
        request.update_context(lang=SCREEN_LANGUAGES[code])


class FinanceLookupController(http.Controller):

    @http.route('/api/v1/finance/countries', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_countries(self, **_):
        require_any_capability(LOOKUP_CAPABILITIES)
        _use_screen_language()
        return list_countries()

    @http.route('/api/v1/finance/countries/<int:country_id>/states', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_states(self, country_id, **_):
        require_any_capability(LOOKUP_CAPABILITIES)
        _use_screen_language()
        return list_states(country_id)
