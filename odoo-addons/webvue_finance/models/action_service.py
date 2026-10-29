# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The actions a finance record offers the caller right now: the one place that decides it.

The record page asks nothing else. An action is **allowed** when the record's state offers it, the caller holds its
capability and nothing refuses it now; it is **blocked** (offered, with the reason a button explains) when the state
and capability offer it but a fact refuses it: the tenant cannot write, the document lies in a closed period, it has
payments or reconciliations, or the ZATCA setup is incomplete. A reason is the code of the 422 or 403 the matching
route answers, so the page's explanation and the route's refusal never disagree. An action neither state nor
capability offers is in neither list.
"""
from odoo import api, models

from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_finance.controllers.write_support import (
    is_period_locked,
    zatca_blocks_posting,
)
from odoo.addons.webvue_finance.serializers.common import UNSET
from odoo.addons.webvue_finance.serializers.invoice import WRITABLE_MOVE_TYPES
from odoo.addons.webvue_finance.serializers.zatca import (
    ZATCA_FORMAT_CODE,
    dump_zatca_submission,
    zatca_document,
)

DEBITABLE_MOVE_TYPES = ('out_invoice', 'in_invoice')
CREDITABLE_MOVE_TYPES = ('out_invoice', 'in_invoice')
LIVE_PAYMENT_EXCLUDED = ('canceled', 'rejected')
FIRST_SEND_STATES = ('pending',)
RESEND_STATES = ('retry', 'rejected', 'blocked', 'unauthorized')


class WebVueFinanceActions(models.AbstractModel):
    _name = 'webvue.finance.actions'
    _description = 'WebVue finance record actions'

    @api.model
    def _webvue_write_block(self):
        """The code every write route refuses with while the tenant cannot write finance data, else ``None``."""
        try:
            self.env['webvue.entitlement.service'].require('finance.enabled')
        except WebVueAccessRule as error:
            return error.code
        return None

    @api.model
    def _webvue_resolve(self, company, offers, write_block):
        """Splits ``offers`` ``(action, capability, reason)`` into the allowed and the blocked actions.

        A write is blocked by the tenant first, then by its own ``reason``; a read (``*.read``) only by its own.
        """
        access = self.env['webvue.access.service']
        allowed, blocked = [], []
        for action, capability, reason in offers:
            if not access._webvue_has_capability(self.env.user, capability, company=company):
                continue
            reason = reason if capability.endswith('.read') else (write_block or reason)
            if reason:
                blocked.append({'action': action, 'reason': reason})
            else:
                allowed.append(action)
        return {'allowed_actions': allowed, 'blocked_actions': blocked}

    @api.model
    def _webvue_invoice_actions(self, invoice, write_block=UNSET):
        write_block = self._webvue_write_block() if write_block is UNSET else write_block
        if invoice.move_type not in WRITABLE_MOVE_TYPES:  # a receipt: it can be printed, nothing else
            receipt = [('pdf', 'finance.invoices.read', None)] if invoice.state == 'posted' else []
            return self._webvue_resolve(invoice.company_id, receipt, write_block)
        draft, posted = invoice.state == 'draft', invoice.state == 'posted'
        locked = 'period_locked' if is_period_locked(
            invoice.invoice_date or invoice.date, invoice.journal_id, bool(invoice.invoice_line_ids.tax_ids), company=invoice.company_id,
        ) else None
        payments = posted and bool(invoice.reconciled_payment_ids.filtered(lambda payment: payment.state not in LIVE_PAYMENT_EXCLUDED))
        transition = 'has_payments' if payments else locked if posted else None
        offers = []
        if draft:
            onboarding = self._webvue_zatca_posting_block(invoice)
            offers += [
                ('edit', 'finance.invoices.manage', None),
                ('delete', 'finance.invoices.manage', None),
                ('post', 'finance.invoices.post', locked or onboarding),
            ]
        else:
            offers.append(('reset_to_draft', 'finance.invoices.post', transition))
        if invoice.state != 'cancel':
            offers.append(('cancel', 'finance.invoices.post', transition))
        if posted:
            offers += self._webvue_posted_invoice_offers(invoice)
        return self._webvue_resolve(invoice.company_id, offers, write_block)

    @api.model
    def _webvue_zatca_posting_block(self, invoice):
        """``zatca_not_onboarded`` when Odoo will refuse to post: the journal sends ZATCA e-invoices and is not onboarded."""
        sends_zatca = any(edi_format.code == ZATCA_FORMAT_CODE for edi_format in invoice.journal_id.edi_format_ids)
        return 'zatca_not_onboarded' if sends_zatca and zatca_blocks_posting(invoice) else None

    @api.model
    def _webvue_posted_invoice_offers(self, invoice):
        offers = [('pdf', 'finance.invoices.read', None)]
        if invoice.move_type in DEBITABLE_MOVE_TYPES and not invoice.debit_origin_id:
            offers.append(('debit_note', 'finance.invoices.manage', None))
        if invoice.move_type in CREDITABLE_MOVE_TYPES:
            offers.append(('credit_note', 'finance.invoices.manage', None))
        if invoice.amount_residual > 0 and invoice.payment_state != 'paid':
            offers.append(('register_payment', 'finance.payments.manage', None))
        if invoice.country_code == 'SA' and invoice.is_sale_document():
            state = dump_zatca_submission(invoice)['state']
            action = 'zatca_submit' if state in FIRST_SEND_STATES else 'zatca_retry' if state in RESEND_STATES else None
            if action and zatca_document(invoice):
                onboarding = 'zatca_not_onboarded' if not invoice.journal_id._l10n_sa_ready_to_submit_einvoices() else None
                mode = 'zatca_mode_not_allowed' if invoice.company_id.l10n_sa_api_mode != 'sandbox' else None
                offers.append((action, 'finance.zatca.submit', mode or onboarding))
        return offers

    @api.model
    def _webvue_entry_actions(self, entry, write_block=UNSET):
        write_block = self._webvue_write_block() if write_block is UNSET else write_block
        locked = 'period_locked' if is_period_locked(entry.date, entry.journal_id, company=entry.company_id) else None
        offers = []
        if entry.state == 'draft':
            offers += [
                ('edit', 'finance.entries.manage', None),
                ('delete', 'finance.entries.manage', None),
                ('post', 'finance.entries.post', locked),
            ]
        elif entry.state == 'posted':
            reconciled = entry.line_ids.filtered(lambda line: line.matched_debit_ids or line.matched_credit_ids)
            offers.append(('reset_to_draft', 'finance.entries.post', 'has_reconciliations' if reconciled else locked))
            if reconciled:
                counterparts = (reconciled.matched_debit_ids.debit_move_id | reconciled.matched_credit_ids.credit_move_id).move_id
                counterpart_locked = any(
                    is_period_locked(move.date, move.journal_id, company=move.company_id) for move in entry | counterparts
                )
                offers.append(('unreconcile', 'finance.entries.post', 'period_locked' if counterpart_locked else None))
        return self._webvue_resolve(entry.company_id, offers, write_block)

    @api.model
    def _webvue_payment_actions(self, payment, unallocated, allocated, write_block=UNSET):
        """``unallocated`` is what the posted payment holds open and ``allocated`` the invoices it is set against."""
        write_block = self._webvue_write_block() if write_block is UNSET else write_block
        revivable = payment.state in ('canceled', 'rejected')
        posted = payment.state in ('in_process', 'paid')
        locked = 'period_locked' if is_period_locked(payment.date, payment.journal_id, company=payment.company_id) else None
        offers = [
            ('cancel', 'finance.payments.manage', locked if posted else None) if not revivable else None,
            ('reset_to_draft', 'finance.payments.manage', None) if revivable else None,
            ('post', 'finance.payments.manage', locked) if payment.state == 'draft' else None,
            ('edit', 'finance.payments.manage', None) if payment.state == 'draft' else None,
            ('allocate', 'finance.payments.manage', None) if posted and unallocated > 0 else None,
            ('unallocate', 'finance.payments.manage', None) if posted and allocated else None,
        ]
        return self._webvue_resolve(payment.company_id, [offer for offer in offers if offer], write_block)

    @api.model
    def _webvue_budget_actions(self, budget, write_block=UNSET):
        write_block = self._webvue_write_block() if write_block is UNSET else write_block
        draft = budget.state == 'draft'
        offers = [
            ('confirm', 'finance.budgets.manage', None) if draft else None,
            ('reset_to_draft', 'finance.budgets.manage', None) if not draft else None,
            ('cancel', 'finance.budgets.manage', None) if budget.state != 'cancelled' else None,
            ('edit_lines', 'finance.budgets.manage', None) if draft else None,
        ]
        return self._webvue_resolve(budget.company_id, [offer for offer in offers if offer], write_block)

    @api.model
    def _webvue_asset_actions(self, asset, write_block=UNSET):
        write_block = self._webvue_write_block() if write_block is UNSET else write_block
        manage = 'finance.assets.manage'
        if asset.state == 'draft':
            offers = [('validate', manage, None), ('edit', manage, None), ('delete', manage, None)]
        elif asset.state in ('open', 'close'):
            offers = [('dispose', manage, None)]
        else:
            offers = []
        return self._webvue_resolve(asset.company_id, offers, write_block)
