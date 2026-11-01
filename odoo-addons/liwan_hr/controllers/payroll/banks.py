# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.payroll.compensation import dump_bank


class HrPayrollBankController(http.Controller):

    @http.route('/api/v1/hr/payroll/banks', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def list_banks(self, **_):
        """The banks the compensation form can pick: a name or SWIFT code search over ``res.bank``."""
        args = request.httprequest.args
        limit, offset = parse_page(args, default=100)
        domain = []
        q = (args.get('q') or '').strip()
        if q:
            domain = ['|', ('name', 'ilike', q), ('bic', 'ilike', q)]
        Bank = request.env['res.bank']
        banks = Bank.search(domain, order='name, id', limit=limit, offset=offset)
        return {'items': [dump_bank(bank) for bank in banks], 'total': Bank.search_count(domain)}
