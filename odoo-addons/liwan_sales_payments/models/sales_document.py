# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .sales_settings import payments_open


class LiwanSalesDocument(models.AbstractModel):
    _inherit = 'liwan.sales.document'

    @api.model
    def _liwan_mail_notes(self, order):
        """Tell the customer the quotation is confirmed by payment: how much, and the pay link once nothing else is
        needed. A customer who still has to sign is told to sign first; the link of the page is already in the mail."""
        notes = super()._liwan_mail_notes(order)
        if not (order._liwan_asks_payment() and payments_open(self.env)):
            return notes
        summary = self.env['liwan.payments.service']._liwan_summary(order)
        link_state = order._liwan_payment_link_state(summary['status'])
        amount = f"{summary['amount_due']:,.2f} {summary['currency']}"
        if link_state == 'ready':
            notes.append({
                'ar': f'يُؤكَّد هذا العرض بالدفع. المبلغ المطلوب {amount}. ادفع من هذا الرابط:',
                'en': f'This quotation is confirmed by payment. The amount due is {amount}. Pay with this link:',
                'link': f'{order.get_base_url()}{order.get_portal_url()}',
            })
        elif link_state == 'awaiting_signature':
            notes.append({
                'ar': f'يُؤكَّد هذا العرض بالدفع. وقّعه أولًا من صفحته، ثم ادفع المبلغ المطلوب {amount}.',
                'en': f'This quotation is confirmed by payment. Sign it first on its page, then pay the amount due, {amount}.',
                'link': None,
            })
        return notes
