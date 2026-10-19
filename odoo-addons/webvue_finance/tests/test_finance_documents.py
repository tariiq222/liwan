# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import new_test_user, tagged

from .common import (
    MANAGER_LOGIN,
    MANAGER_PASSWORD,
    OUTSIDER_LOGIN,
    OUTSIDER_PASSWORD,
    WebVueFinanceCase,
)
from odoo.addons.webvue_api.tests.common import set_probe_feature

INVOICES = '/api/v1/finance/invoices'
FAKE_PDF = b'%PDF-1.7 fake invoice'
READ_ONLY_LOGIN = 'finance_payments_only'
READ_ONLY_PASSWORD = 'finance_payments_only_pass_123'
INVOICES_ONLY_LOGIN = 'finance_invoices_only'
INVOICES_ONLY_PASSWORD = 'finance_invoices_only_pass_123'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceInvoicePdf(WebVueFinanceCase):
    """The route hands the stock ``account.account_invoices`` report to ``_render_qweb_pdf``.

    wkhtmltopdf is not part of the test environment and Odoo renders HTML instead of a PDF under
    test, so most tests replace the renderer and pin what it is asked for; the last ones render the
    real stock template as the caller to prove it works without elevated rights.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company.vat = '300000000000003'
        for login, password, capability in (
            (READ_ONLY_LOGIN, READ_ONLY_PASSWORD, 'finance.payments.read'),
            (INVOICES_ONLY_LOGIN, INVOICES_ONLY_PASSWORD, 'finance.invoices.read'),
        ):
            user = new_test_user(
                cls.env, login=login, password=password, name=login,
                groups='webvue_core.group_employee', company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
            )
            role = cls.env['webvue.access.role'].with_company(cls.company).create({
                'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom',
                'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([
                    ('key', '=', capability),
                ]).ids)],
            })
            cls.env['webvue.access.service']._webvue_replace_assignments(
                user, [{'role_id': role.id, 'company_id': cls.company.id}],
            )

    def setUp(self):
        super().setUp()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)

    def _pdf(self, invoice, query='', side_effect=None):
        with patch.object(
            type(self.env['ir.actions.report']), '_render_qweb_pdf', autospec=True,
            **({'side_effect': side_effect} if side_effect else {'return_value': (FAKE_PDF, 'pdf')}),
        ) as render:
            result = self.api('GET', f'{INVOICES}/{invoice.id}/pdf{query}')
        return result, render

    def test_a_posted_invoice_downloads_as_a_pdf_attachment(self):
        result, render = self._pdf(self.invoice)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.headers['Content-Type'], 'application/pdf')
        self.assertTrue(result.content.startswith(b'%PDF'))
        disposition = result.headers['Content-Disposition']
        self.assertTrue(disposition.startswith('attachment;'), disposition)
        # A Saudi sale document carries the ZATCA file name: <seller VAT>_<issue time>_<number>.
        self.assertIn('300000000000003_', disposition)
        self.assertIn('_INV-2026-00001.pdf', disposition)
        self.assertNotIn('/', disposition)
        (_report, report_ref, res_ids), _kwargs = render.call_args
        self.assertEqual((report_ref, res_ids), ('account.account_invoices', self.invoice.ids))

    def test_the_manager_who_reads_payments_gets_the_report_with_its_payments(self):
        _result, render = self._pdf(self.invoice)
        self.assertEqual(render.call_args[0][1], 'account.account_invoices')

    def test_a_caller_without_payments_read_gets_the_report_without_payments(self):
        self.authenticate(INVOICES_ONLY_LOGIN, INVOICES_ONLY_PASSWORD)
        result, render = self._pdf(self.invoice)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(render.call_args[0][1], 'account.account_invoices_without_payment')

    def test_the_filename_keeps_arabic_and_cannot_inject_a_header(self):
        with patch.object(type(self.invoice), '_get_report_base_filename', return_value='فاتورة/2026/00001'):
            result, _render = self._pdf(self.invoice)
        self.assertIn("filename*=UTF-8''", result.headers['Content-Disposition'])
        self.assertIn('%D9%81%D8%A7%D8%AA%D9%88%D8%B1%D8%A9', result.headers['Content-Disposition'])
        self.assertNotIn('/', result.headers['Content-Disposition'])
        hostile = 'INV"; x=y\r\nSet-Cookie: a=b/1'
        with patch.object(type(self.invoice), '_get_report_base_filename', return_value=hostile):
            result, _render = self._pdf(self.invoice)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertNotIn('Set-Cookie', result.headers)
        disposition = result.headers['Content-Disposition']
        self.assertTrue(disposition.startswith("attachment; filename*=UTF-8''"), disposition)
        self.assertNotIn('"', disposition)

    def test_a_failing_pdf_engine_is_a_503_pdf_unavailable(self):
        reports = type(self.env['ir.actions.report'])
        for error in (OSError('no binary'), UserError('Wkhtmltopdf failed (error code: 1)')):
            with self.subTest(error=type(error).__name__), patch.object(reports, 'get_wkhtmltopdf_state', return_value='broken'):
                result, _render = self._pdf(self.invoice, side_effect=error)
                self.assertEqual((result.status_code, result.json()['code']), (503, 'pdf_unavailable'))

    def test_another_render_error_is_not_a_503(self):
        reports = type(self.env['ir.actions.report'])
        with patch.object(reports, 'get_wkhtmltopdf_state', return_value='ok'):
            result, _render = self._pdf(self.invoice, side_effect=UserError('Only invoices could be printed.'))
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))

    def test_a_posted_vendor_bill_downloads_too(self):
        bill = self.env['account.move'].with_company(self.company).create({
            'move_type': 'in_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-18',
            'invoice_line_ids': [Command.create({'name': 'Paper', 'quantity': 1, 'price_unit': 10})],
        })
        bill.action_post()
        result, _render = self._pdf(bill)
        self.assertEqual(result.status_code, 200, result.text)

    def test_a_draft_invoice_is_a_422_not_posted_and_nothing_is_rendered(self):
        draft = self._draft_sale_invoice(self.company, self.partner)
        result, render = self._pdf(draft)
        self.assertEqual((result.status_code, result.json()['code']), (422, 'not_posted'))
        self.assertEqual(result.headers['Content-Type'], 'application/json; charset=utf-8')
        render.assert_not_called()

    def test_a_cancelled_invoice_is_a_422_not_posted(self):
        draft = self._draft_sale_invoice(self.company, self.partner)
        draft.button_cancel()
        result, _render = self._pdf(draft)
        self.assertEqual((result.status_code, result.json()['code']), (422, 'not_posted'))

    def test_a_foreign_company_or_unknown_invoice_is_a_404_not_found(self):
        result, render = self._pdf(self.other_invoice)
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))
        render.assert_not_called()
        unknown = self.api('GET', f'{INVOICES}/999999999/pdf')
        self.assertEqual((unknown.status_code, unknown.json()['code']), (404, 'not_found'))

    def test_a_user_without_invoices_read_gets_403_forbidden(self):
        for login, password in ((OUTSIDER_LOGIN, OUTSIDER_PASSWORD), (READ_ONLY_LOGIN, READ_ONLY_PASSWORD)):
            with self.subTest(login=login):
                self.authenticate(login, password)
                result, render = self._pdf(self.invoice)
                self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))
                render.assert_not_called()

    def test_a_closed_finance_feature_refuses_the_download(self):
        set_probe_feature(self, key='finance.enabled', enabled=False)
        result, render = self._pdf(self.invoice)
        self.assertEqual(result.status_code, 403)
        render.assert_not_called()

    def test_only_get_is_routed(self):
        self.assertEqual(self.url_open(f'{INVOICES}/{self.invoice.id}/pdf', data=b'{}').status_code, 405)

    def test_the_stock_template_renders_for_the_caller_with_the_zatca_qr_and_both_languages(self):
        # Under test the stock renderer returns the report HTML, which is what wkhtmltopdf would print.
        self.company.l10n_gcc_dual_language_invoice = True
        manager_env = self.env(user=self.manager)
        html, _type = manager_env['ir.actions.report']._render_qweb_pdf('account.account_invoices', self.invoice.ids)
        page = html.decode()
        self.assertIn(self.invoice.name, page)
        self.assertIn('/report/barcode/?barcode_type=QR', page)
        self.assertIn('Tax Invoice', page)
        self.assertRegex(page, '[\u0600-\u06ff]{3}')

    def test_the_route_serves_the_real_rendering_without_elevated_rights(self):
        result = self.api('GET', f'{INVOICES}/{self.invoice.id}/pdf')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIn(self.invoice.name, result.text)
        self.assertIn('dir="ltr"', result.text)
