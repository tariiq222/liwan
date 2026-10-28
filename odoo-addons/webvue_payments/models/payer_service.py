# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from lxml import html

from odoo import api, fields, models
from odoo.exceptions import LockError, UserError

WAITING_STATES = ('pending', 'authorized')
# How long a started checkout blocks another one for the same document: two open gateway pages
# could both take the customer's money (two tabs, a retried request, a lost answer).
OPEN_CHECKOUT = timedelta(minutes=15)
# How long a payment the gateway reported as pending or authorized still counts as on its way; after
# that the gateway is not expected to settle it, and a late settlement makes the refund due.
SETTLE_WINDOW = timedelta(days=1)
# How long stock keeps retrying the post-processing of a received payment (payment_transaction.py,
# ``_cron_post_process``); after that nothing records it on its document any more.
POST_PROCESS_RETRIES = timedelta(days=4)
# A received payment not recorded on its document after this long needs a person (spec 5.2).
STUCK_AFTER = timedelta(hours=1)


def _unrecorded(tx):
    return tx.state == 'done' and not tx.is_post_processed


def payment_on_its_way(transactions, now):
    """Whether one of ``transactions`` is paid or being paid and may still be recorded on its document.

    A pending or authorized payment counts for ``SETTLE_WINDOW``; a received one that is not
    recorded yet counts while stock still retries its post-processing.
    """
    return any(
        (tx.state in WAITING_STATES and tx.last_state_change >= now - SETTLE_WINDOW)
        or (_unrecorded(tx) and tx.last_state_change >= now - POST_PROCESS_RETRIES)
        for tx in transactions
    )


def payment_stuck(transactions, now):
    """Whether money was received but has not been recorded on its document for ``STUCK_AFTER``."""
    return any(_unrecorded(tx) and tx.last_state_change < now - STUCK_AFTER for tx in transactions)


def checkout_open(transactions, since):
    """Whether a checkout among ``transactions`` started after ``since`` and may still be paid on the gateway page."""
    return any(tx.state == 'draft' and tx.create_date >= since for tx in transactions)


class CheckoutOpen(UserError):
    """Another checkout of this document is open or being started right now."""


class WebVuePaymentsPayer(models.AbstractModel):
    """What an anonymous payer may do with one payable document once its access token is checked.

    A payable document is a posted customer invoice (``account.move``) or an online order
    (``sale.order``); each answers ``_webvue_is_pay_document``, ``_webvue_payment_recordable``,
    ``_webvue_pay_state``, ``_webvue_pay_amount`` and ``_webvue_pay_link``. The caller (a public route) has already verified the token with the stock
    portal check, which returns the document elevated. Every value here comes from that document
    and the tenant's providers, never from the payer: the amount is the document's, the partner is
    the document's, and the provider and method must be among the compatible ones.
    """

    _name = 'webvue.payments.payer'
    _description = 'WebVue payments payer service'

    @api.model
    def _webvue_status(self, document):
        """``paid``, ``processing`` (a payment is on its way), ``payable`` or ``not_payable``."""
        state = document._webvue_pay_state()
        if state != 'paid' and payment_on_its_way(document.transaction_ids, fields.Datetime.now()):
            return 'processing'
        return state

    @api.model
    def _webvue_options(self, document):
        """The ``(provider, method)`` pairs the payer may choose, for the tenant's offered live gateways."""
        codes = set(self.env['webvue.payments.provider.registry']._webvue_provider_map())
        # The payer has no session: the provider ACL is system-only and the stock portal reads it elevated too.
        providers = self.env['payment.provider'].sudo()._get_compatible_providers(
            document.company_id.id, document.partner_id.id, document._webvue_pay_amount(),
            currency_id=document.currency_id.id,
        ).filtered(lambda provider: provider.code in codes and provider.state == 'enabled')
        if not providers:
            return []
        methods = self.env['payment.method'].sudo()._get_compatible_payment_methods(
            providers.ids, document.partner_id.id, currency_id=document.currency_id.id,
        )
        return [
            (provider, method)
            for provider in providers
            for method in methods
            if provider in method.provider_ids
        ]

    @api.model
    def _webvue_start(self, document, provider_id, payment_method_id):
        """Create the transaction for what the document asks now and return the gateway redirect.

        Starts are serialized per document: its row is locked, and a checkout started less than
        ``OPEN_CHECKOUT`` ago blocks a new one, so one document never has two gateway pages open at
        once.

        :return: ``{'method', 'url', 'fields'}`` of the stock redirect form.
        :raise CheckoutOpen: when another start holds the document or a recent checkout is open.
        :raise UserError: when the pair is not offered or the gateway refuses to start.
        """
        try:
            document.lock_for_update(allow_referencing=True)
        except LockError as error:
            raise CheckoutOpen(self.env._("A payment of this document is already being started.")) from error
        if checkout_open(document.transaction_ids, fields.Datetime.now() - OPEN_CHECKOUT):
            raise CheckoutOpen(self.env._("A payment of this document is already open; finish it or try again later."))
        options = {(provider.id, method.id): (provider, method) for provider, method in self._webvue_options(document)}
        if (provider_id, payment_method_id) not in options:
            raise UserError(self.env._("This payment method is not available for this document."))
        provider, method = options[provider_id, payment_method_id]
        Transaction = self.env['payment.transaction']
        link = document._webvue_pay_link()
        # The payer cannot create transactions (system-only ACL); every value below is the document's.
        transaction = Transaction.sudo().create({
            'provider_id': provider.id,
            'payment_method_id': method.id,
            'reference': Transaction._compute_reference(provider.code, **link),
            'amount': document._webvue_pay_amount(),
            'currency_id': document.currency_id.id,
            'partner_id': document.partner_id.id,
            'operation': 'online_redirect',
            **link,
        })
        processing = transaction._get_processing_values()
        if transaction.state == 'error' or not processing.get('redirect_form_html'):
            raise UserError(self.env._("The payment gateway could not start the payment."))
        return self._webvue_redirect(processing['redirect_form_html'])

    @api.model
    def _webvue_redirect(self, form_html):
        """The action, method and hidden fields of a stock provider redirect form."""
        form = html.fromstring(form_html)
        if form.tag != 'form':
            form = form.find('.//form')
        return {
            'method': (form.get('method') or 'get').lower(),
            'url': form.get('action'),
            'fields': {field.get('name'): field.get('value') or '' for field in form.iter('input') if field.get('name')},
        }
