# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import http
from odoo.exceptions import MissingError, UserError
from odoo.http import content_disposition, request

from .common import require_capability
from .finance_invoices import company_invoices_domain
from .write_support import require_state
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)

INVOICE_REPORT = 'account.account_invoices'
# The same invoice without the payments section: payments are a separate capability.
INVOICE_REPORT_WITHOUT_PAYMENTS = 'account.account_invoices_without_payment'
UNSAFE_FILENAME_CHARS = re.compile(r'[\x00-\x1f\x7f"\\/]+')
# wkhtmltopdf states in which the PDF cannot be produced (the others are quality warnings).
PDF_BROKEN_STATES = ('install', 'broken')


def _filename(invoice):
    """The stock report file name, safe for a header: Arabic is kept, quotes, slashes and control characters go."""
    base = UNSAFE_FILENAME_CHARS.sub('_', invoice._get_report_base_filename()).strip(' ._')
    return f'{base or "invoice"}.pdf'


def _render(report_ref, invoice):
    """The PDF bytes; a missing or failing wkhtmltopdf is the 503 ``pdf_unavailable``, any other error is untouched."""
    reports = request.env['ir.actions.report']
    unavailable = ApiError(503, 'pdf_unavailable', 'the PDF engine is not available, try again later')
    try:
        return reports._render_qweb_pdf(report_ref, invoice.ids)[0]
    except OSError:
        raise unavailable from None
    except UserError:
        # Odoo raises a plain UserError both for a missing and for a failing wkhtmltopdf, so ask its state.
        if reports.get_wkhtmltopdf_state() in PDF_BROKEN_STATES:
            raise unavailable from None
        raise


class FinanceDocumentController(http.Controller):

    @http.route(
        '/api/v1/finance/invoices/<int:invoice_id>/pdf', type='http', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def invoice_pdf(self, invoice_id, **_):
        """The stock invoice report of a posted document, rendered in the caller's own environment.

        A file download is not JSON, so the route is ``type='http'`` like the meeting minutes PDF; after
        authentication ``api_handler`` still answers every refusal with the JSON error shape. The report
        lists the invoice's payments, so it is the variant without them unless the caller may read payments.
        """
        require_capability('finance.invoices.read')
        invoice = request.env['account.move'].search([('id', '=', invoice_id), *company_invoices_domain()], limit=1)
        if not invoice:
            raise MissingError(request.env._('account.move %(id)s does not exist', id=invoice_id))
        require_state(invoice, 'posted', 'not_posted')
        service = request.env['webvue.access.service']
        with_payments = service._webvue_has_capability(request.env.user, 'finance.payments.read')
        content = _render(INVOICE_REPORT if with_payments else INVOICE_REPORT_WITHOUT_PAYMENTS, invoice)
        return request.make_response(content, headers=[
            ('Content-Type', 'application/pdf'),
            ('Content-Disposition', content_disposition(_filename(invoice))),
        ])
