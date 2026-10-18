# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import filter_domain, list_page, parse_choice, require_capability
from odoo.addons.webvue_api.controllers.common import api_handler, requires_feature
from odoo.addons.webvue_finance.serializers.payment import dump_payments


class FinancePaymentController(http.Controller):

    @http.route('/api/v1/finance/payments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_payments(self, **_):
        require_capability('finance.payments.read')
        args = request.httprequest.args
        fields = request.env['account.payment']._fields
        domain = [('company_id', '=', request.env.company.id), *filter_domain(args, 'date')]
        for field in ('payment_type', 'state'):
            value = parse_choice(args.get(field), fields[field].get_values(request.env), field)
            if value:
                domain.append((field, '=', value))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', '|', ('name', 'ilike', query), ('memo', 'ilike', query), ('partner_id.name', 'ilike', query)]
        return list_page('account.payment', domain, dump_payments)
