# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import content_disposition, request

from .customers import FEATURE_HOOK, FEATURE_KEYS, SERVICE
from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_registered_feature,
)
from odoo.addons.liwan_customers.models.access_service import (
    CUSTOMERS_ERASE,
    CUSTOMERS_PRIVACY_EXPORT,
)
from odoo.addons.liwan_customers.serializers.privacy import (
    dump_erase,
    dump_preview,
    parse_erase,
    parse_export,
)

PRIVACY = 'liwan.customers.privacy.service'
XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


class CustomersPrivacyController(http.Controller):
    """Privacy requests about one customer (PDPL). A customer the caller cannot see is a 404 on every route."""

    @http.route('/api/v1/customers/<int:customer_id>/privacy/erase-preview', type='json2', auth='user', methods=['POST'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(CUSTOMERS_ERASE)
    def preview_erase(self, customer_id, **_):
        return dump_preview(customer_id, request.env[PRIVACY]._liwan_erase_preview(customer_id))

    @http.route('/api/v1/customers/<int:customer_id>/privacy/erase', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(CUSTOMERS_ERASE)
    def erase_customer(self, customer_id, **payload):
        token, confirmation, reason = parse_erase(payload)
        logged, counts = request.env[PRIVACY]._liwan_erase(customer_id, token, confirmation, reason)
        return dump_erase(customer_id, logged or request.env['liwan.customers.privacy.request'], counts)

    @http.route('/api/v1/customers/<int:customer_id>/privacy/export', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(CUSTOMERS_PRIVACY_EXPORT)
    def export_subject(self, customer_id, **payload):
        content, filename, _logged = request.env[PRIVACY]._liwan_export(customer_id, parse_export(payload))
        return request.make_response(content, headers=[
            ('Content-Type', XLSX_TYPE),
            ('Content-Disposition', content_disposition(filename)),
            ('Cache-Control', 'private, no-store'),
            ('X-Content-Type-Options', 'nosniff'),
        ])
