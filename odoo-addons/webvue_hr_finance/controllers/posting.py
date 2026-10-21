# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.controllers.common import hr_rule_handler
from odoo.addons.webvue_hr.controllers.payroll.runs import scoped_run
from odoo.addons.webvue_hr.serializers.payroll.run import dump_run
from odoo.addons.webvue_hr_finance.serializers.posting import dump_posting_preview

FEATURES = ('hr.enabled', 'hr.payroll', 'finance.enabled')
CAPABILITIES = ('hr.payroll.read', 'finance.entries.post')


class HrPayrollPostingController(http.Controller):

    @http.route(
        '/api/v1/hr/payroll/runs/<int:run_id>/posting-preview', type='json2', auth='user', methods=['GET'],
        readonly=True,
    )
    @api_handler
    @hr_rule_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability(*CAPABILITIES, match='all')
    def get_posting_preview(self, run_id, **_):
        run = scoped_run(run_id)
        settings = request.env['webvue.hr.payroll.finance.settings']._webvue_for_company(run.company_id)
        lines, warnings = request.env['webvue.hr.payroll.posting']._webvue_posting_lines(run, settings)
        return dump_posting_preview(run, settings, lines, warnings)

    @http.route('/api/v1/hr/payroll/runs/<int:run_id>/post', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability(*CAPABILITIES, match='all')
    def post_run(self, run_id, **_):
        run = scoped_run(run_id)
        request.env['webvue.hr.payroll.posting']._webvue_post(run)
        return dump_run(run)
