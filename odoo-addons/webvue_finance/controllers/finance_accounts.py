# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from odoo.addons.webvue_api.controllers.common import api_handler, requires_feature
from odoo.addons.webvue_finance.serializers.account import dump_accounts


class FinanceAccountController(http.Controller):

    @http.route('/api/v1/finance/accounts', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_accounts(self, **_):
        require_capability('finance.accounts.read')
        args = request.httprequest.args
        domain = [('company_ids', 'in', [request.env.company.id])]
        account_type = parse_choice(
            args.get('account_type'),
            request.env['account.account']._fields['account_type'].get_values(request.env),
            'account_type',
        )
        if account_type:
            domain.append(('account_type', '=', account_type))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', ('code', 'ilike', query), ('name', 'ilike', query)]
        return list_page('account.account', domain, dump_accounts)
