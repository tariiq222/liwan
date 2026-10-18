# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import filter_domain, list_page, parse_choice, require_capability
from odoo.addons.webvue_api.controllers.common import api_handler, requires_feature
from odoo.addons.webvue_finance.serializers.invoice import (
    dump_invoice_detail,
    dump_invoices,
)


def _invoice_types():
    return request.env['account.move'].get_invoice_types(include_receipts=True)


def _company_invoices_domain():
    return [
        ('company_id', '=', request.env.company.id),
        ('move_type', 'in', _invoice_types()),
    ]


class FinanceInvoiceController(http.Controller):

    @http.route('/api/v1/finance/invoices', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_invoices(self, **_):
        require_capability('finance.invoices.read')
        args = request.httprequest.args
        Move = request.env['account.move']
        domain = _company_invoices_domain() + filter_domain(args, 'invoice_date')
        move_type = parse_choice(args.get('move_type'), _invoice_types(), 'move_type')
        if move_type:
            domain.append(('move_type', '=', move_type))
        state = parse_choice(args.get('state'), Move._fields['state'].get_values(request.env), 'state')
        if state:
            domain.append(('state', '=', state))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', '|', ('name', 'ilike', query), ('ref', 'ilike', query), ('partner_id.name', 'ilike', query)]
        return list_page('account.move', domain, dump_invoices)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_invoice(self, invoice_id):
        require_capability('finance.invoices.read')
        invoice = request.env['account.move'].search(
            [('id', '=', invoice_id), *_company_invoices_domain()], limit=1,
        )
        if not invoice:
            raise MissingError(request.env._('account.move %(id)s does not exist', id=invoice_id))
        return dump_invoice_detail(invoice)
