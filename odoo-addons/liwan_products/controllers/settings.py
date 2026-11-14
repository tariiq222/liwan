# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .products import FEATURE_HOOK, FEATURE_KEYS, SERVICE
from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_registered_feature,
)
from odoo.addons.liwan_products.models.access_service import (
    PRODUCTS_READ,
    PRODUCTS_SETTINGS_MANAGE,
)
from odoo.addons.liwan_products.serializers.settings import (
    dump_settings,
    parse_settings_patch,
)


def dump_current():
    settings = request.env['liwan.products.settings']
    return dump_settings(settings._liwan_current(), settings._liwan_can_manage())


class ProductsSettingsController(http.Controller):

    @http.route('/api/v1/products/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(PRODUCTS_READ, PRODUCTS_SETTINGS_MANAGE, match='any')
    def read_settings(self, **_):
        return dump_current()

    @http.route('/api/v1/products/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(PRODUCTS_SETTINGS_MANAGE)
    def write_settings(self, **payload):
        values, revision = parse_settings_patch(payload)
        request.env['liwan.products.settings']._liwan_current()._liwan_apply(values, revision)
        return dump_current()
