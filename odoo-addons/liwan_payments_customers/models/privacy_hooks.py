# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_customers.models.privacy_hooks import ACTION_ERASE, ACTION_RETAIN

OWNER = 'liwan_payments_customers'
ORDER_KEY = 'payment_orders'
ORDER_LINE_KEY = 'payment_order_lines'
TRANSACTION_KEY = 'payment_transactions'
TOKEN_KEY = 'payment_tokens'
ERASED_PROVIDER_REF = 'erased-%d'
# The payer's own copy a transaction takes of the customer when the checkout starts. The gateway reference, the amount,
# the currency, the state and the link to the customer and to the invoice or order stay: they are the payment record.
TRANSACTION_PERSONAL_FIELDS = (
    'partner_name', 'partner_lang', 'partner_email', 'partner_address', 'partner_zip', 'partner_city',
    'partner_state_id', 'partner_country_id', 'partner_phone',
)


def order_domain(partners):
    return [('partner_id', 'in', partners.ids)]


def order_line_domain(partners):
    return [('order_partner_id', 'in', partners.ids)]


def transaction_domain(partners):
    return [('partner_id', 'in', partners.ids)]


def token_domain(partners):
    return [('partner_id', 'in', partners.ids)]


class LiwanPaymentsCustomersPrivacyHooks(models.AbstractModel):
    """What online payments hold about a customer: its orders, payment transactions and saved payment methods.

    Orders and their lines are commercial and accounting records: they keep the link to the customer, the numbers
    and the amounts. A transaction keeps its reference, state, amount and links too, and loses the copy of the payer's
    name, e-mail, phone and address it took at checkout: the payment itself is evidenced by the payment and the
    posted invoice (Finance), whose retention is the law's, and the gateway keeps its own record under its reference.
    A saved payment method (a card reference) is archived, and its details and gateway reference are replaced.
    """
    _inherit = 'liwan.customers.privacy.hooks'

    @api.model
    def _liwan_subject_coverage(self):
        return {
            **super()._liwan_subject_coverage(),
            ORDER_KEY: ('sale.order', order_domain),
            ORDER_LINE_KEY: ('sale.order.line', order_line_domain),
            TRANSACTION_KEY: ('payment.transaction', transaction_domain),
            TOKEN_KEY: ('payment.token', token_domain),
        }

    @api.model
    def _liwan_payments_search(self, model_name, domain):
        """The records of ``model_name`` the domain finds as the caller (archived included); none without an ACL."""
        try:
            return self.env[model_name].with_context(active_test=False).search(domain)
        except AccessError:
            return self.env[model_name]

    @api.model
    def _liwan_payments_subject(self, partners):
        search = self._liwan_payments_search
        return {
            ORDER_KEY: search('sale.order', order_domain(partners)),
            ORDER_LINE_KEY: search('sale.order.line', order_line_domain(partners)),
            TRANSACTION_KEY: search('payment.transaction', transaction_domain(partners)),
            TOKEN_KEY: search('payment.token', token_domain(partners)),
        }

    @api.model
    def _liwan_subject_export(self, partners):
        subject = self._liwan_payments_subject(partners)
        return [
            *super()._liwan_subject_export(partners),
            {
                'key': ORDER_KEY, 'title': 'Online orders',
                'header': ['id', 'number', 'customer_id', 'date', 'state', 'untaxed', 'tax', 'total', 'currency'],
                'rows': [
                    [order.id, order.name, order.partner_id.id, order.date_order, order.state, order.amount_untaxed,
                     order.amount_tax, order.amount_total, order.currency_id.name]
                    for order in subject[ORDER_KEY]
                ],
            },
            {
                'key': TRANSACTION_KEY, 'title': 'Payment transactions',
                'header': ['id', 'reference', 'customer_id', 'created', 'state', 'amount', 'currency', 'payer_name',
                           'payer_email', 'payer_phone'],
                'rows': [
                    [tx.id, tx.reference, tx.partner_id.id, tx.create_date, tx.state, tx.amount, tx.currency_id.name,
                     tx.partner_name, tx.partner_email, tx.partner_phone]
                    for tx in subject[TRANSACTION_KEY]
                ],
            },
        ]

    @api.model
    def _liwan_subject_erase_preview(self, partners):
        subject = self._liwan_payments_subject(partners)
        actions = {
            ORDER_KEY: ACTION_RETAIN, ORDER_LINE_KEY: ACTION_RETAIN, TRANSACTION_KEY: ACTION_ERASE, TOKEN_KEY: ACTION_ERASE,
        }
        return [
            *super()._liwan_subject_erase_preview(partners),
            *({'key': key, 'owner': OWNER, 'action': action, 'count': len(subject[key])} for key, action in actions.items()),
        ]

    @api.model
    def _liwan_subject_erase(self, partners):
        counts = super()._liwan_subject_erase(partners)
        subject = self._liwan_payments_subject(partners)
        # No tracking: a tracked write would copy the old values into a new message.
        subject[TRANSACTION_KEY].with_context(tracking_disable=True).write(dict.fromkeys(TRANSACTION_PERSONAL_FIELDS, False))
        for token in subject[TOKEN_KEY]:
            token.with_context(tracking_disable=True).write({
                'active': False, 'payment_details': False, 'provider_ref': ERASED_PROVIDER_REF % token.id,
            })
        return {**counts, **{key: len(records) for key, records in subject.items()}}
