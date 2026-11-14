# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_registered_feature,
)
from odoo.addons.liwan_products.controllers.products import (
    FEATURE_HOOK,
    FEATURE_KEYS,
    SERVICE,
)
from odoo.addons.liwan_products.models.access_service import PRODUCTS_MANAGE
from odoo.addons.liwan_products_account.serializers.tax import dump_tax_choices


class ProductTaxesController(http.Controller):

    @http.route('/api/v1/products/taxes', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(PRODUCTS_MANAGE)
    def list_tax_choices(self, **_):
        """The sale taxes a new product of this session may carry (the zero-rated and exempt ones are how "no tax"
        is chosen); empty for an establishment that is not registered for VAT."""
        return dump_tax_choices(request.env[SERVICE]._liwan_sale_tax_choices())
