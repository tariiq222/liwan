# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_crm.controllers.opportunities import (
    ORDER,
    filter_domain,
    visible_domain,
)
from odoo.addons.liwan_crm.serializers.export import export_csv
from odoo.addons.liwan_crm.serializers.opportunity import parse_list_filters

FEATURES = ('crm.enabled', 'crm.export')


class CrmExportController(http.Controller):

    @http.route('/api/v1/crm/export', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability('crm.leads.export')
    def export_opportunities(self, **_):
        """Every opportunity the caller reads (open, won and lost) that the list filters keep."""
        domain = [*visible_domain(), *filter_domain(parse_list_filters(request.httprequest.args), default_status='all')]
        leads = request.env['crm.lead'].with_context(active_test=False).search(domain, order=ORDER)
        filename = f'crm-opportunities-{fields.Date.context_today(leads)}.csv'
        return request.make_response(export_csv(leads), headers=[
            ('Content-Type', 'text/csv; charset=utf-8'),
            ('Content-Disposition', content_disposition(filename)),
            ('Cache-Control', 'private, no-store'),
            ('X-Content-Type-Options', 'nosniff'),
        ])
