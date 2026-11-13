# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import content_disposition, request

from .customers import FEATURE_HOOK, FEATURE_KEYS, SERVICE
from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_registered_feature,
)
from odoo.addons.liwan_api.serializers.csv_export import refuse_oversized_export
from odoo.addons.liwan_customers.models.access_service import CUSTOMERS_EXPORT
from odoo.addons.liwan_customers.serializers.customer import parse_list_filters
from odoo.addons.liwan_customers.serializers.export import export_csv


class CustomersExportController(http.Controller):

    @http.route('/api/v1/customers/export', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(CUSTOMERS_EXPORT)
    def export_customers(self, **_):
        """The parties the caller can see that the list filters (``q``, ``archived``, ``property.<key>``) keep."""
        definition = request.env['res.partner']._liwan_party_properties_definition()
        query, archived, filters = parse_list_filters(request.httprequest.args, definition)
        service = request.env['liwan.customers.service']
        refuse_oversized_export(service._liwan_export_count(query, archived, filters))
        parties = service._liwan_export_parties(query, archived, filters)
        filename = f'customers-{fields.Date.context_today(parties)}.csv'
        return request.make_response(export_csv(parties, definition), headers=[
            ('Content-Type', 'text/csv; charset=utf-8'),
            ('Content-Disposition', content_disposition(filename)),
            ('Cache-Control', 'private, no-store'),
            ('X-Content-Type-Options', 'nosniff'),
        ])
