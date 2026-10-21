# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.controllers.common import hr_rule_handler
from odoo.addons.webvue_hr.controllers.payroll.common import current_company
from odoo.addons.webvue_hr.serializers.payroll.run import parse_month
from odoo.addons.webvue_hr_finance.serializers.eos import dump_provision

FEATURES = ('hr.enabled', 'hr.payroll', 'finance.enabled')
ROUTE = '/api/v1/hr/payroll/eos-provisions'


class HrPayrollEosProvisionController(http.Controller):

    @http.route(ROUTE, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability('hr.payroll.read', 'finance.entries.read', match='all')
    def list_provisions(self, **_):
        Provision = request.env['webvue.hr.payroll.eos.provision']
        domain = [('company_id', '=', current_company().id)]
        return {'items': [dump_provision(row) for row in Provision.search(domain)], 'total': Provision.search_count(domain)}

    @http.route(ROUTE, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability('hr.payroll.read', 'finance.entries.post', match='all')
    def post_provision(self, **payload):
        provision = request.env['webvue.hr.payroll.eos.provision']._webvue_post_provision(
            current_company(), parse_month(payload),
        )
        return request.make_json_response(dump_provision(provision), status=201)
