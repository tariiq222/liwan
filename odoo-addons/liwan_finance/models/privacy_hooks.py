# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_customers.models.privacy_hooks import (
    ACTION_ERASE,
    ACTION_RETAIN,
    refuse_incomplete,
)

OWNER = 'liwan_finance'
DOCUMENT_KEY = 'finance_documents'
LINE_KEY = 'finance_entry_lines'
PAYMENT_KEY = 'finance_payments'
STATEMENT_KEY = 'finance_statement_lines'
DRAFT_KEY = 'finance_draft_copies'
# The e-mail a draft document was received from is a copy of the person's address; a posted document keeps it.
DRAFT_PERSONAL_FIELDS = ('invoice_source_email',)
MANAGE_DRAFTS = 'finance.invoices.manage'


def document_domain(partners):
    return [('partner_id', 'in', partners.ids)]


def draft_domain(partners):
    return [('partner_id', 'in', partners.ids), ('state', '=', 'draft')]


class LiwanFinancePrivacyHooks(models.AbstractModel):
    """What Finance holds about a customer: accounting documents, which the law keeps.

    Invoices, credit notes, journal items, payments and bank statement lines keep their link to the customer, their
    numbers, dates and amounts: an erase changes none of them, and the customer record they point to is anonymised, so
    they then show the marker name. Three kinds of text stay on a posted document and are named in ``not_covered``: the
    name or address a document printed or stored when it was posted (the PDF and e-invoice XML of a posted invoice are
    stored documents), journal item descriptions, and the counterparty name a bank statement line copied from the
    bank's file. A draft is not yet a legal document: the address it was received from is cleared.

    Reads and the draft write run as the caller. Without the finance read capabilities the ORM hides every document
    (no ACL) and the service reports the preview incomplete; a caller who may read but not draft refuses the erase.
    """
    _inherit = 'liwan.customers.privacy.hooks'

    @api.model
    def _liwan_subject_coverage(self):
        return {
            **super()._liwan_subject_coverage(),
            DOCUMENT_KEY: ('account.move', document_domain),
            LINE_KEY: ('account.move.line', document_domain),
            PAYMENT_KEY: ('account.payment', document_domain),
            STATEMENT_KEY: ('account.bank.statement.line', document_domain),
            DRAFT_KEY: ('account.move', draft_domain),
        }

    @api.model
    def _liwan_subject_not_covered(self):
        return [*super()._liwan_subject_not_covered(), 'accounting_name_copies']

    @api.model
    def _liwan_finance_search(self, model_name, domain):
        """The records of ``model_name`` the domain finds as the caller (archived included); none without an ACL."""
        try:
            return self.env[model_name].with_context(active_test=False).search(domain)
        except AccessError:
            return self.env[model_name]

    @api.model
    def _liwan_finance_subject(self, partners):
        search = self._liwan_finance_search
        return {
            DOCUMENT_KEY: search('account.move', document_domain(partners)),
            LINE_KEY: search('account.move.line', document_domain(partners)),
            PAYMENT_KEY: search('account.payment', document_domain(partners)),
            STATEMENT_KEY: search('account.bank.statement.line', document_domain(partners)),
            DRAFT_KEY: search('account.move', draft_domain(partners)),
        }

    @api.model
    def _liwan_subject_export(self, partners):
        subject = self._liwan_finance_subject(partners)
        return [
            *super()._liwan_subject_export(partners),
            {
                'key': DOCUMENT_KEY, 'title': 'Invoices and credit notes',
                'header': ['id', 'number', 'customer_id', 'type', 'date', 'due_date', 'state', 'payment_state',
                           'untaxed', 'tax', 'total', 'currency'],
                'rows': [
                    [move.id, move.name, move.partner_id.id, move.move_type, move.invoice_date, move.invoice_date_due,
                     move.state, move.payment_state, move.amount_untaxed, move.amount_tax, move.amount_total,
                     move.currency_id.name]
                    for move in subject[DOCUMENT_KEY].filtered(lambda move: move.is_invoice(include_receipts=True))
                ],
            },
            {
                'key': PAYMENT_KEY, 'title': 'Payments',
                'header': ['id', 'number', 'customer_id', 'type', 'date', 'state', 'amount', 'currency'],
                'rows': [
                    [payment.id, payment.name, payment.partner_id.id, payment.payment_type, payment.date,
                     payment.state, payment.amount, payment.currency_id.name]
                    for payment in subject[PAYMENT_KEY]
                ],
            },
        ]

    @api.model
    def _liwan_subject_erase_preview(self, partners):
        subject = self._liwan_finance_subject(partners)
        actions = {
            DOCUMENT_KEY: ACTION_RETAIN, LINE_KEY: ACTION_RETAIN, PAYMENT_KEY: ACTION_RETAIN,
            STATEMENT_KEY: ACTION_RETAIN, DRAFT_KEY: ACTION_ERASE,
        }
        return [
            *super()._liwan_subject_erase_preview(partners),
            *({'key': key, 'owner': OWNER, 'action': action, 'count': len(subject[key])} for key, action in actions.items()),
        ]

    @api.model
    def _liwan_subject_erase(self, partners):
        drafts = self._liwan_finance_search('account.move', draft_domain(partners))
        service = self.env['liwan.access.service']
        if drafts and not service._liwan_has_capability(self.env.user, MANAGE_DRAFTS):
            # Before the writes of any other hook: a refusal leaves nothing changed.
            refuse_incomplete([{'key': DRAFT_KEY, 'owner': OWNER, 'reason': 'caller_cannot_reach_all_records'}])
        counts = super()._liwan_subject_erase(partners)
        # No tracking: a tracked write would copy the old values into a new message.
        drafts.with_context(tracking_disable=True).write({name: False for name in DRAFT_PERSONAL_FIELDS})
        subject = self._liwan_finance_subject(partners)
        return {**counts, **{key: len(records) for key, records in subject.items()}}
