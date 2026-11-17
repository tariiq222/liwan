# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from markupsafe import Markup

from odoo import Command, api, models
from odoo.exceptions import UserError

from .sales_settings import payments_open
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

REPORT = 'sale.action_report_saleorder'
# wkhtmltopdf states in which the PDF cannot be produced (the others are quality warnings).
PDF_BROKEN_STATES = ('install', 'broken')
UNSAFE_FILENAME_CHARS = re.compile(r'[\x00-\x1f\x7f"\\/]+')


class LiwanSalesDocument(models.AbstractModel):
    """The documents of a quotation that leave the application: its PDF and the e-mail that carries it."""

    _name = 'liwan.sales.document'
    _description = 'LiwanOS Sales quotation document'

    @api.model
    def _liwan_note_markup(self, notes, language):
        """The e-mail paragraphs of ``notes`` in ``language``: the text and, under it, the address of the note if it has one."""
        return Markup('').join(
            Markup('<p>{text}</p>').format(text=note[language]) + (
                Markup('<p><a href="{link}">{link}</a></p>').format(link=note['link']) if note['link'] else Markup('')
            )
            for note in notes
        )

    @api.model
    def _liwan_pdf(self, order, signed=False):
        """The stock quotation report of ``order``, rendered in the order's own environment.

        With ``signed`` the report prints the customer's signature. A missing or failing wkhtmltopdf is a 503
        ``pdf_unavailable``; any other error is untouched.
        """
        reports = order.env['ir.actions.report'].with_context(sale_include_signature=signed)
        unavailable = LiwanAccessRule(
            'pdf_unavailable', 'the PDF engine is not available, try again later', status=503,
        )
        try:
            return reports._render_qweb_pdf(REPORT, order.ids)[0]
        except OSError:
            raise unavailable from None
        except UserError:
            # Odoo raises a plain UserError both for a missing and for a failing wkhtmltopdf, so ask its state.
            if reports.get_wkhtmltopdf_state() in PDF_BROKEN_STATES:
                raise unavailable from None
            raise

    @api.model
    def _liwan_filename(self, order):
        """The stock report file name, safe for a header: Arabic is kept, quotes, slashes and control characters go."""
        base = UNSAFE_FILENAME_CHARS.sub('_', order._get_report_base_filename()).strip(' ._')
        return f'{base or "quotation"}.pdf'

    @api.model
    def _liwan_payment_notes(self, order):
        """The notes added to the e-mail of ``order``, each ``{'ar', 'en', 'link'}``: the text in both languages and the
        address it points to (None for a note without one). Tell the customer the quotation is confirmed by payment: how
        much, and the pay link once nothing else is needed. A customer who still has to sign is told to sign first; the
        link of the page is already in the mail."""
        notes = []
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

    @api.model
    def _liwan_queue_mail(self, order):
        """Queue the e-mail that sends ``order`` to its customer: Arabic then English, the link of its public page, any
        notes and the PDF."""
        customer, company = order.partner_id.name, order.company_id.name
        return self._liwan_mail(
            order,
            f'عرض سعر {order.name} / Quotation {order.name}',
            f'مرحبًا {customer}، أرسلت لك {company} عرض السعر {order.name}. افتح الرابط لقراءته.',
            f'Hello {customer}, {company} sent you quotation {order.name}. Open the link to read it.',
            attachments=[Command.create({
                'name': self._liwan_filename(order), 'raw': self._liwan_pdf(order), 'mimetype': 'application/pdf',
            })],
        )

    @api.model
    def _liwan_queue_confirmation_mail(self, order):
        """Queue the e-mail that tells the customer ``order`` is confirmed, with the link of its public page; False when
        the tenant has no sender address (nothing is queued, the caller decides what that means)."""
        if not self.env['liwan.outbound.mail']._liwan_sender():
            return False
        customer, company = order.partner_id.name, order.company_id.name
        return self._liwan_mail(
            order,
            f'تأكيد الطلب {order.name} / Order {order.name} confirmed',
            f'مرحبًا {customer}، أكّدت {company} طلبك {order.name}. افتح الرابط لقراءته.',
            f'Hello {customer}, {company} confirmed your order {order.name}. Open the link to read it.',
        )

    @api.model
    def _liwan_mail(self, order, subject, ar, en, attachments=()):
        """Queue one bilingual e-mail about ``order`` to its customer from the tenant's outbound sender: ``ar`` then ``en``,
        each followed by the link of the order's public page (never an Odoo portal link) and the notes."""
        link = f'{order.get_base_url()}/quote/{order.id}?access_token={order.access_token}'
        notes = self._liwan_payment_notes(order)
        body = Markup(
            '<div dir="rtl"><p>{ar}</p><p><a href="{link}">{link}</a></p>{ar_notes}</div><hr/>'
            '<div dir="ltr"><p>{en}</p><p><a href="{link}">{link}</a></p>{en_notes}</div>',
        ).format(
            ar=ar, en=en, link=link,
            ar_notes=self._liwan_note_markup(notes, 'ar'),
            en_notes=self._liwan_note_markup(notes, 'en'),
        )
        # Mailing needs the outgoing-mail right, which no Sales capability carries.
        return self.env['mail.mail'].sudo().create({
            'subject': subject,
            'body_html': body,
            'email_from': self.env['liwan.outbound.mail']._liwan_sender(),
            'email_to': order.partner_id.email,
            'author_id': self.env.user.partner_id.id,
            'auto_delete': True,
            'attachment_ids': list(attachments),
        })
