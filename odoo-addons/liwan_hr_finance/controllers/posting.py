# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_finance.controllers.write_support import company_records
from odoo.addons.liwan_finance.serializers.parsing import parse_day, parse_id
from odoo.addons.liwan_hr.controllers.common import hr_rule_handler
from odoo.addons.liwan_hr.controllers.payroll.runs import scoped_run
from odoo.addons.liwan_hr.serializers.payroll.run import dump_run
from odoo.addons.liwan_hr_finance.serializers.posting import dump_posting_preview

FEATURES = ('hr.enabled', 'hr.payroll', 'finance.enabled')
CAPABILITIES = ('hr.payroll.read', 'finance.entries.post')
PAYMENT_CAPABILITIES = ('hr.payroll.read', 'finance.payments.manage')


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
        run._liwan_require_state(('approved',), request.env._('Only an approved run has a posting preview.'))
        settings, lines, warnings = request.env['liwan.hr.payroll.posting']._liwan_preview(run)
        return dump_posting_preview(run, settings, lines, warnings)

    @http.route('/api/v1/hr/payroll/runs/<int:run_id>/post', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability(*CAPABILITIES, match='all')
    def post_run(self, run_id, **_):
        run = scoped_run(run_id)
        request.env['liwan.hr.payroll.posting']._liwan_post(run)
        return dump_run(run)

    @http.route(
        '/api/v1/hr/payroll/runs/<int:run_id>/payment', type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @hr_rule_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability(*PAYMENT_CAPABILITIES, match='all')
    def record_payment(self, run_id, **payload):
        run = scoped_run(run_id)
        day = parse_day(payload.get('date'), 'date')
        journal = company_records(
            'account.journal', [parse_id(payload.get('journal_id'), 'journal_id')], 'journal_id',
            [('company_id', '=', run.company_id.id)],
        )
        request.env['liwan.hr.payroll.posting']._liwan_record_payment(run, journal, day)
        return dump_run(run)
