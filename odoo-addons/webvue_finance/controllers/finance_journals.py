# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from odoo.addons.webvue_api.controllers.common import api_handler, requires_feature
from odoo.addons.webvue_finance.serializers.journal import dump_journals


class FinanceJournalController(http.Controller):

    @http.route('/api/v1/finance/journals', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_journals(self, **_):
        require_capability('finance.journals.read')
        domain = [('company_id', '=', request.env.company.id)]
        journal_type = parse_choice(
            request.httprequest.args.get('type'),
            request.env['account.journal']._fields['type'].get_values(request.env),
            'type',
        )
        if journal_type:
            domain.append(('type', '=', journal_type))
        return list_page('account.journal', domain, dump_journals)
