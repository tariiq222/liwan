# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .customers import FEATURE_HOOK, FEATURE_KEYS, SERVICE
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_registered_feature,
)
from odoo.addons.liwan_customers.models.access_service import (
    CUSTOMERS_READ,
    CUSTOMERS_SETTINGS_MANAGE,
)
from odoo.addons.liwan_customers.serializers.settings import (
    dump_countries,
    dump_settings,
    parse_settings_patch,
)


def can_manage_settings():
    """Whether a settings write passes authorization: the capability in the working company and in the root company.
    The customer settings bind every branch of the tenant, so the manager of one branch only reads them."""
    root = request.env['liwan.entitlement.service']._liwan_profile().root_company_id
    access = request.env['liwan.access.service']
    return all(
        access._liwan_has_capability(request.env.user, CUSTOMERS_SETTINGS_MANAGE, company=company)
        for company in (request.env.company, root)
    )


def require_tenant_manager():
    if not can_manage_settings():
        raise ApiError(403, 'forbidden', 'the customer settings belong to the managers of the root company')


def dump_current():
    return dump_settings(
        request.env['liwan.customers.settings']._liwan_current(),
        request.env['res.partner']._liwan_party_properties_definition(),
        can_manage_settings(),
    )


class CustomersSettingsController(http.Controller):

    @http.route('/api/v1/customers/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(CUSTOMERS_READ, CUSTOMERS_SETTINGS_MANAGE, match='any')
    def read_settings(self, **_):
        """The forms need the party kinds and the field definition, so a reader of customers reads the settings too."""
        return dump_current()

    @http.route('/api/v1/customers/settings/countries', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(CUSTOMERS_SETTINGS_MANAGE)
    def list_countries(self, **_):
        """The countries the phone country can be set to, by name in the session's language. The page that changes the
        setting needs them, so this asks for the capability and not for the root company."""
        countries = request.env['res.country'].search([('code', '!=', False)], order='name')
        return dump_countries(countries.filtered(lambda country: len(country.code) == 2))

    @http.route('/api/v1/customers/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(CUSTOMERS_SETTINGS_MANAGE)
    def write_settings(self, **payload):
        require_tenant_manager()
        definition = request.env['res.partner']._liwan_party_properties_definition()
        values, new_definition, confirm_removal, revision = parse_settings_patch(request.env, payload, definition)
        request.env['liwan.customers.settings']._liwan_current()._liwan_apply(
            values, revision, new_definition, confirm_removal,
        )
        return dump_current()
