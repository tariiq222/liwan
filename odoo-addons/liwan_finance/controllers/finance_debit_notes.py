# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, http
from odoo.http import request

from .common import require_capability
from .finance_invoices import _find_invoice, _lock_context
from .write_support import attempt, require_open_period
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_finance.serializers.debit_note import parse_debit_note
from odoo.addons.liwan_finance.serializers.invoice import dump_invoice_detail

DEBITABLE_MOVE_TYPES = ('out_invoice', 'in_invoice')


def _require_debitable(invoice):
    """Only a posted customer invoice or vendor bill that is not itself a debit note."""
    if invoice.move_type not in DEBITABLE_MOVE_TYPES:
        raise ApiError(422, 'invalid_state', 'only a customer invoice or a vendor bill can be debited')
    if invoice.state != 'posted':
        raise ApiError(422, 'not_posted', 'the invoice must be posted')
    if invoice.debit_origin_id:
        raise ApiError(422, 'invalid_state', 'a debit note cannot be debited again')


class FinanceDebitNoteController(http.Controller):

    @http.route(
        '/api/v1/finance/invoices/<int:invoice_id>/debit-note', type='json2', auth='user', methods=['POST'],
        readonly=False,
    )
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_debit_note(self, invoice_id, **payload):
        """The draft debit note of a posted invoice, made by Odoo's public ``account.debit.note`` wizard."""
        require_capability('finance.invoices.manage')
        invoice = _find_invoice(invoice_id, writable=True)
        parsed = parse_debit_note(payload)
        _require_debitable(invoice)

        def create():
            wizard = request.env['account.debit.note'].create({
                'move_ids': [Command.set(invoice.ids)], 'copy_lines': parsed['copy_lines'],
                **{key: parsed[key] for key in ('date', 'reason') if key in parsed},
            })
            return request.env['account.move'].browse(wizard.create_debit()['res_id'])

        lock = {
            **_lock_context(invoice), 'day': parsed.get('date') or invoice.date,
            'has_tax': parsed['copy_lines'] and bool(invoice.invoice_line_ids.tax_ids),
        }
        if 'date' in parsed:
            require_open_period(**lock, field='date')
        debit_note = attempt(create, **lock)
        # The wizard always sets the type, origin, date and ref; it copies the lines only when asked.
        written = ('move_type', 'debit_origin_id', 'date', 'ref')
        if parsed['copy_lines']:
            written += ('invoice_line_ids',)
        request.env['liwan.finance.audit.event']._liwan_log(
            'invoice_debit_note_created', debit_note, fields_written=written, outcome=debit_note.state,
        )
        return request.make_json_response(dump_invoice_detail(debit_note), status=201)
