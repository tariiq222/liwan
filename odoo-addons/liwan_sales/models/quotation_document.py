# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from markupsafe import Markup

from odoo import Command, api, models
from odoo.exceptions import UserError

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
    def _liwan_queue_mail(self, order):
        """Queue the e-mail that sends ``order`` to its customer: Arabic then English, the link of its public page and the PDF."""
        link = f'{order.get_base_url()}/quote/{order.id}?access_token={order.access_token}'
        customer, company = order.partner_id.name, order.company_id.name
        body = Markup(
            '<div dir="rtl"><p>{ar}</p><p><a href="{link}">{link}</a></p></div><hr/>'
            '<div dir="ltr"><p>{en}</p><p><a href="{link}">{link}</a></p></div>',
        ).format(
            ar=f'مرحبًا {customer}، أرسلت لك {company} عرض السعر {order.name}. افتح الرابط لقراءته.',
            en=f'Hello {customer}, {company} sent you quotation {order.name}. Open the link to read it.',
            link=link,
        )
        # Mailing needs the outgoing-mail right, which no Sales capability carries.
        return self.env['mail.mail'].sudo().create({
            'subject': f'عرض سعر {order.name} / Quotation {order.name}',
            'body_html': body,
            'email_from': self.env['liwan.outbound.mail']._liwan_sender(),
            'email_to': order.partner_id.email,
            'author_id': self.env.user.partner_id.id,
            'auto_delete': True,
            'attachment_ids': [Command.create({
                'name': self._liwan_filename(order), 'raw': self._liwan_pdf(order), 'mimetype': 'application/pdf',
            })],
        })
