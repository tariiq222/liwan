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
from odoo.addons.liwan_customers.models.access_service import CUSTOMERS_SETTINGS_MANAGE
from odoo.addons.liwan_customers.serializers.settings import (
    dump_settings,
    parse_settings_patch,
)


def require_tenant_manager():
    """The customer settings bind every branch of the tenant: only a settings manager of its root company reads or
    changes them, never the manager of one branch."""
    root = request.env['liwan.entitlement.service']._liwan_profile().root_company_id
    if not request.env['liwan.access.service']._liwan_has_capability(
            request.env.user, CUSTOMERS_SETTINGS_MANAGE, company=root):
        raise ApiError(403, 'forbidden', 'the customer settings belong to the managers of the root company')


class CustomersSettingsController(http.Controller):

    @http.route('/api/v1/customers/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(CUSTOMERS_SETTINGS_MANAGE)
    def read_settings(self, **_):
        require_tenant_manager()
        return dump_settings(request.env['liwan.customers.settings']._liwan_current())

    @http.route('/api/v1/customers/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(CUSTOMERS_SETTINGS_MANAGE)
    def write_settings(self, **payload):
        require_tenant_manager()
        values, revision = parse_settings_patch(request.env, payload)
        settings = request.env['liwan.customers.settings']._liwan_current()
        settings._liwan_apply(values, revision)
        return dump_settings(settings)
