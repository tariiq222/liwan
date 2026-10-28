# Part of Odoo. See LICENSE file for full copyright and licensing details.
from lxml import html

from odoo import Command, api, models
from odoo.exceptions import UserError

WAITING_STATES = ('pending', 'authorized')
PAID_STATES = ('paid', 'in_payment')


class WebVuePaymentsPayer(models.AbstractModel):
    """What an anonymous payer may do with one invoice once its access token is checked.

    The caller (a public route) has already verified the token with the stock portal check, which
    returns the invoice elevated. Every value here comes from that invoice and the tenant's
    providers, never from the payer: the amount is the invoice's residual, the partner is the
    invoice's, and the provider and method must be among the compatible ones.
    """

    _name = 'webvue.payments.payer'
    _description = 'WebVue payments payer service'

    @api.model
    def _webvue_status(self, invoice):
        """``paid``, ``processing`` (a payment is on its way), ``payable`` or ``not_payable``."""
        if invoice.payment_state in PAID_STATES:
            return 'paid'
        if any(
            tx.state in WAITING_STATES or (tx.state == 'done' and not tx.is_post_processed)
            for tx in invoice.transaction_ids
        ):
            return 'processing'
        return 'payable' if invoice._has_to_be_paid() else 'not_payable'

    @api.model
    def _webvue_options(self, invoice):
        """The ``(provider, method)`` pairs the payer may choose, for the tenant's offered live gateways."""
        codes = set(self.env['webvue.payments.provider.registry']._webvue_provider_map())
        # The payer has no session: the provider ACL is system-only and the stock portal reads it elevated too.
        providers = self.env['payment.provider'].sudo()._get_compatible_providers(
            invoice.company_id.id, invoice.partner_id.id, invoice.amount_residual,
            currency_id=invoice.currency_id.id,
        ).filtered(lambda provider: provider.code in codes and provider.state == 'enabled')
        if not providers:
            return []
        methods = self.env['payment.method'].sudo()._get_compatible_payment_methods(
            providers.ids, invoice.partner_id.id, currency_id=invoice.currency_id.id,
        )
        return [
            (provider, method)
            for provider in providers
            for method in methods
            if provider in method.provider_ids
        ]

    @api.model
    def _webvue_start(self, invoice, provider_id, payment_method_id):
        """Create the transaction for the invoice's residual and return the gateway redirect.

        :return: ``{'method', 'url', 'fields'}`` of the stock redirect form.
        :raise UserError: when the pair is not offered or the gateway refuses to start.
        """
        options = {(provider.id, method.id): (provider, method) for provider, method in self._webvue_options(invoice)}
        if (provider_id, payment_method_id) not in options:
            raise UserError(self.env._("This payment method is not available for this invoice."))
        provider, method = options[provider_id, payment_method_id]
        Transaction = self.env['payment.transaction']
        # The payer cannot create transactions (system-only ACL); every value below is the invoice's.
        transaction = Transaction.sudo().create({
            'provider_id': provider.id,
            'payment_method_id': method.id,
            'reference': Transaction._compute_reference(provider.code, invoice_ids=[Command.set(invoice.ids)]),
            'amount': invoice.amount_residual,
            'currency_id': invoice.currency_id.id,
            'partner_id': invoice.partner_id.id,
            'operation': 'online_redirect',
            'invoice_ids': [Command.set(invoice.ids)],
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
