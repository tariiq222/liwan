# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, http
from odoo.http import request

from .common import require_capability
from .finance_invoices import _find_invoice, _lock_context
from .write_support import attempt, require_open_period
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.credit_note import parse_credit_note
from odoo.addons.webvue_finance.serializers.invoice import dump_invoice_detail

CREDITABLE_MOVE_TYPES = ('out_invoice', 'in_invoice')


def _require_creditable(invoice):
    """Only a posted customer invoice or vendor bill; a draft or cancelled one is not posted."""
    if invoice.move_type not in CREDITABLE_MOVE_TYPES:
        raise ApiError(422, 'invalid_state', 'only a customer invoice or a vendor bill can be credited')
    if invoice.state != 'posted':
        raise ApiError(422, 'not_posted', 'the invoice must be posted')


class FinanceCreditNoteController(http.Controller):

    @http.route(
        '/api/v1/finance/invoices/<int:invoice_id>/credit-note', type='json2', auth='user', methods=['POST'],
        readonly=False,
    )
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_credit_note(self, invoice_id, **payload):
        """The draft credit note reversing a posted invoice, made by Odoo's public ``account.move.reversal`` wizard.

        Posting the credit note reconciles it with the invoice and lowers its residual.
        """
        require_capability('finance.invoices.manage')
        invoice = _find_invoice(invoice_id, writable=True)
        parsed = parse_credit_note(payload)
        _require_creditable(invoice)

        def create():
            wizard = request.env['account.move.reversal'].create({
                'move_ids': [Command.set(invoice.ids)], 'company_id': invoice.company_id.id,
                'journal_id': invoice.journal_id.id, **parsed,
            })
            credit_note = request.env['account.move'].browse(wizard.refund_moves()['res_id'])
            # The wizard schedules a future-dated reversal to post itself; posting needs its own capability.
            if credit_note.auto_post != 'no':
                credit_note.auto_post = 'no'
            return credit_note

        lock = {**_lock_context(invoice), 'day': parsed.get('date') or invoice.date}
        if 'date' in parsed:
            require_open_period(**lock, field='date')
        credit_note = attempt(create, **lock)
        # The wizard sets the type, origin, date and ref, and reverses the lines.
        request.env['webvue.finance.audit.event']._webvue_log(
            'invoice_credit_note_created', credit_note,
            fields_written=('move_type', 'reversed_entry_id', 'date', 'ref', 'invoice_line_ids'),
            outcome=credit_note.state,
        )
        return request.make_json_response(dump_invoice_detail(credit_note), status=201)
