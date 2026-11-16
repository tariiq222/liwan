# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Sending a quotation: the route, the e-mail row, the snapshots, the PDF, expiry and the reopen that extends it."""
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import tagged

from .common import FAKE_PDF, MODES, SENDER, QuotationCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

ORDERS = '/api/v1/sales/orders'
ANSWER_MODES = ('none', 'accept', 'accept_and_sign')


def yesterday():
    return fields.Date.today() - timedelta(days=1)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesSend(QuotationCase):

    def test_a_draft_is_sent_and_a_sent_quotation_is_sent_again(self):
        self.set_answer('accept', False)
        order = self.quotation()
        mails = self.env['mail.mail'].search_count([])
        first = self.send_via_api(self.agent, order.id)
        self.assertEqual(first['state'], 'sent')
        self.assertEqual(first['customer_answer'], {
            'mode': 'accept', 'acceptance_confirms': False, 'answer': None, 'answered_at': None,
            'signed_by': None, 'signature_method': None, 'decline_reason': None,
        })
        order.invalidate_recordset()
        token = order.access_token
        self.assertTrue(token)
        self.assertEqual(self.send_via_api(self.agent, order.id)['state'], 'sent')
        order.invalidate_recordset()
        self.assertEqual(order.access_token, token)
        self.assertEqual(self.env['mail.mail'].search_count([]), mails + 2)

    def test_the_mail_row_goes_to_the_customer_with_the_link_and_the_pdf(self):
        mails = self.env['mail.mail'].search([])
        order = self.sent()
        mail = self.env['mail.mail'].search([('id', 'not in', mails.ids)])
        self.assertEqual(len(mail), 1)
        self.assertEqual((mail.email_to, mail.email_from), ('buyer@example.test', SENDER))
        self.assertIn(f'{order.get_base_url()}/quote/{order.id}?access_token={order.access_token}', mail.body_html)
        self.assertIn(order.name, mail.subject)
        self.assertRegex(mail.body_html, '[؀-ۿ]')
        self.assertIn('quotation', mail.body_html.lower())
        self.assertEqual(len(mail.attachment_ids), 1)
        attachment = mail.attachment_ids
        self.assertEqual((attachment.mimetype, attachment.raw), ('application/pdf', FAKE_PDF))
        self.assertTrue(attachment.name.endswith('.pdf'))

    def test_a_none_mode_still_mails_the_link(self):
        mails = self.env['mail.mail'].search([])
        order = self.sent('none')
        mail = self.env['mail.mail'].search([('id', 'not in', mails.ids)])
        self.assertIn(f'/quote/{order.id}?access_token={order.access_token}', mail.body_html)

    def test_each_mode_is_snapshotted_and_only_signing_requires_a_signature(self):
        for mode in ANSWER_MODES:
            for confirms in (False, True):
                with self.subTest(mode=mode, confirms=confirms):
                    order = self.sent(mode, confirms)
                    answer = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['customer_answer']
                    self.assertEqual((answer['mode'], answer['acceptance_confirms']), (mode, confirms))
                    self.assertEqual(order.require_signature, mode == 'accept_and_sign')

    def test_the_signature_methods_are_snapshotted_and_a_later_change_does_not_touch_them(self):
        order = self.sent('accept_and_sign', signature_methods='draw')
        self.assertEqual(order.liwan_signature_methods, 'draw')
        self.set_signature_methods('draw_or_type')
        order.invalidate_recordset()
        self.assertEqual(order.liwan_signature_methods, 'draw')
        self.send_via_api(self.agent, order.id)
        order.invalidate_recordset()
        self.assertEqual(order.liwan_signature_methods, 'draw_or_type')

    def test_a_later_settings_change_does_not_touch_a_sent_quotation(self):
        order = self.sent('accept_and_sign', True)
        self.set_answer('none', False)
        answer = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['customer_answer']
        self.assertEqual((answer['mode'], answer['acceptance_confirms']), ('accept_and_sign', True))
        self.assertTrue(order.require_signature)
        self.send_via_api(self.agent, order.id)
        answer = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['customer_answer']
        self.assertEqual((answer['mode'], answer['acceptance_confirms']), ('none', False))
        order.invalidate_recordset()
        self.assertFalse(order.require_signature)

    def test_a_resend_clears_the_earlier_answer_and_signature(self):
        order = self.sent('accept_and_sign')
        order.write({
            'liwan_answer': 'accepted', 'liwan_answered_on': fields.Datetime.now(), 'signed_by': 'Buyer',
            'signed_on': fields.Datetime.now(), 'liwan_decline_reason': 'old', 'liwan_signature_method': 'typed',
        })
        body = self.send_via_api(self.agent, order.id)
        self.assertIsNone(body['customer_answer']['answer'])
        order.invalidate_recordset()
        self.assertEqual(
            (order.signed_by, order.signed_on, order.signature, order.liwan_decline_reason, order.liwan_signature_method),
            (False,) * 5,
        )

    def answer_it(self, order, answer='accepted'):
        order.write({
            'liwan_answer': answer, 'liwan_answered_on': fields.Datetime.now(), 'signed_by': 'Buyer',
            'signed_on': fields.Datetime.now(), 'liwan_signature_method': 'typed',
        })

    def test_an_answered_quotation_is_sent_again_when_the_tenant_allows_it(self):
        order = self.sent('accept_and_sign')
        self.answer_it(order)
        detail = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()
        self.assertTrue(detail['actions']['send'])
        body = self.send_via_api(self.agent, order.id)
        self.assertEqual((body['state'], body['customer_answer']['answer'], body['customer_answer']['signature_method']), ('sent', None, None))
        order.invalidate_recordset()
        self.assertEqual((order.liwan_answer, order.signed_by, order.liwan_signature_method), (False,) * 3)

    def test_an_answered_quotation_is_refused_a_resend_when_the_tenant_says_so(self):
        order = self.sent('accept_and_sign')
        self.answer_it(order)
        self.set_answered_resend('refuse')
        mails = self.env['mail.mail'].search_count([])
        detail = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()
        self.assertFalse(detail['actions']['send'])
        with self.pdf_engine():
            self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/send'), 409, 'quotation_answered')
        order.invalidate_recordset()
        self.assertEqual((order.liwan_answer, order.signed_by, order.liwan_signature_method), ('accepted', 'Buyer', 'typed'))
        self.assertEqual(self.env['mail.mail'].search_count([]), mails)
        self.assertEqual(self.act(self.agent, order.id, 'reopen')['state'], 'draft')
        self.assertTrue(self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['actions']['send'])
        self.assertEqual(self.send_via_api(self.agent, order.id)['state'], 'sent')

    def test_the_refuse_mode_leaves_an_unanswered_quotation_alone(self):
        self.set_answered_resend('refuse')
        order = self.sent()
        detail = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()
        self.assertTrue(detail['actions']['send'])
        self.assertEqual(self.send_via_api(self.agent, order.id)['state'], 'sent')

    def test_a_declined_cancelled_quotation_keeps_its_state_refusal_in_refuse_mode(self):
        order = self.sent()
        self.answer_it(order, 'declined')
        order.action_cancel()
        self.set_answered_resend('refuse')
        self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/send'), 403, 'transition_forbidden')

    def test_an_apostrophe_and_other_valid_addresses_are_accepted(self):
        for email in ("o'brien@example.test", 'Buyer <buyer+tag@example.test>', 'first.last@sub.example.test'):
            with self.subTest(email=email):
                order = self.quotation(email=email)
                self.assertEqual(self.send_via_api(self.agent, order.id)['state'], 'sent')

    def test_the_resend_refusal_gives_way_to_a_403_and_to_expiry(self):
        order = self.sent('accept_and_sign')
        self.answer_it(order)
        self.set_answered_resend('refuse')
        confirmer = self.custom_user('sales_send_confirmer', ['sales.read', 'sales.orders.confirm'])
        order.user_id = confirmer
        self.refused(self.api_as(confirmer, 'POST', f'{ORDERS}/{order.id}/send'), 403, 'forbidden')
        # The service itself, reached without the route's capability gate, refuses with the state table's 403, not the 409.
        with self.assertRaises(LiwanAccessRule) as refusal:
            self.service_as(confirmer)._liwan_send(order.id)
        self.assertEqual((refusal.exception.status, refusal.exception.code), (403, 'transition_forbidden'))
        self.assertFalse(self.api_as(confirmer, 'GET', f'{ORDERS}/{order.id}').json()['resend_refused'])
        order.user_id = self.agent
        with self.pdf_engine():
            self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/send'), 409, 'quotation_answered')
        order.validity_date = yesterday()
        with self.pdf_engine():
            self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/send'), 422, 'quotation_expired')

    def test_resend_refused_is_true_only_when_the_setting_alone_removes_send(self):
        url = f'{ORDERS}/{{}}'
        order = self.sent('accept_and_sign')
        self.answer_it(order)
        self.assertFalse(self.api_as(self.agent, 'GET', url.format(order.id)).json()['resend_refused'])
        self.set_answered_resend('refuse')
        detail = self.api_as(self.agent, 'GET', url.format(order.id)).json()
        self.assertEqual((detail['resend_refused'], detail['actions']['send']), (True, False))
        order.validity_date = yesterday()
        self.assertFalse(self.api_as(self.agent, 'GET', url.format(order.id)).json()['resend_refused'])
        self.set_answered_resend('allow')
        self.assertFalse(self.api_as(self.agent, 'GET', url.format(order.id)).json()['resend_refused'])
        unanswered = self.sent()
        self.set_answered_resend('refuse')
        self.assertFalse(self.api_as(self.agent, 'GET', url.format(unanswered.id)).json()['resend_refused'])

    def test_a_malformed_customer_email_is_refused_before_any_write(self):
        mails = self.env['mail.mail'].search_count([])
        for email in ('not-an-address', 'a@b@c', 'two@example.test, other@example.test', '   '):
            with self.subTest(email=email):
                order = self.quotation(email=email)
                self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/send'), 422, 'customer_email_missing')
                order.invalidate_recordset()
                self.assertEqual((order.state, order.liwan_answer_mode, order.access_token), ('draft', False, False))
        self.assertEqual(self.env['mail.mail'].search_count([]), mails)

    def test_the_refusals_have_their_own_codes_and_leave_the_order_alone(self):
        mails = self.env['mail.mail'].search_count([])
        without_email = self.quotation(email=False)
        self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{without_email.id}/send'), 422, 'customer_email_missing')
        expired = self.quotation(validity_date=yesterday())
        self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{expired.id}/send'), 422, 'quotation_expired')
        empty = self.quotation(lines=[])
        self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{empty.id}/send'), 422, 'invalid', 'lines')
        confirmed = self.quotation()
        confirmed.action_confirm()
        cancelled = self.quotation()
        cancelled.action_cancel()
        for order in (confirmed, cancelled):
            self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/send'), 403, 'transition_forbidden')
        online = self.make_order(None, staff=False)
        self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{online.id}/send'), 403, 'forbidden')
        self.assertEqual(self.env['mail.mail'].search_count([]), mails)
        self.assertEqual((without_email.state, expired.state, empty.state), ('draft',) * 3)

    def test_no_sender_address_is_a_503_before_any_write(self):
        self.env['ir.config_parameter'].set_param('mail.default.from', False)
        order = self.quotation()
        mails = self.env['mail.mail'].search_count([])
        with patch('odoo.addons.liwan_core.models.outbound_mail.config', {}):
            self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/send'), 503, 'mail_unavailable')
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer_mode, order.access_token), ('draft', False, False))
        self.assertEqual(self.env['mail.mail'].search_count([]), mails)

    def test_visibility_and_capability_decide_who_sends(self):
        order = self.quotation()
        self.assertEqual(self.api_as(self.agent2, 'POST', f'{ORDERS}/{order.id}/send').status_code, 404)
        self.set_visibility('all')
        self.refused(self.api_as(self.agent2, 'POST', f'{ORDERS}/{order.id}/send'), 403, 'forbidden')
        reader = self.custom_user('sales_send_reader', ['sales.read'])
        self.refused(self.api_as(reader, 'POST', f'{ORDERS}/{order.id}/send'), 403, 'forbidden')
        self.refused(self.api_as(self.outsider, 'POST', f'{ORDERS}/{order.id}/send'), 403, 'forbidden')
        self.assertEqual(self.send_via_api(self.manager, order.id)['state'], 'sent')

    def test_sending_works_in_both_scopes_and_both_commercial_modes(self):
        for mode in MODES:
            self.set_mode(mode)
            for name, scope in self.scopes.items():
                with self.subTest(commercial_mode=mode, scope=name):
                    order = self.quotation(scope)
                    self.assertEqual(self.send_via_api(scope.agent, order.id)['state'], 'sent')

    def test_the_actions_of_a_draft_a_sent_and_an_expired_quotation(self):
        order = self.quotation()
        actions = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['actions']
        self.assertEqual((actions['send'], actions['reopen']), (True, False))
        self.send_via_api(self.agent, order.id)
        detail = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()
        self.assertEqual((detail['actions']['send'], detail['actions']['reopen'], detail['expired']), (True, True, False))
        order.validity_date = yesterday()
        detail = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()
        self.assertEqual(
            (detail['actions']['send'], detail['actions']['confirm'], detail['actions']['reopen'], detail['expired']),
            (False, False, True, True),
        )
        listed = next(
            row for row in self.api_as(self.agent, 'GET', f'{ORDERS}?limit=200').json()['items'] if row['id'] == order.id
        )
        self.assertEqual((listed['expired'], listed['customer_answer']['mode']), (True, 'accept'))
        fresh = self.api_as(self.agent, 'GET', f'{ORDERS}/{self.quotation().id}').json()
        self.assertIsNone(fresh['customer_answer'])

    def test_an_expired_draft_offers_neither_send_nor_confirm(self):
        order = self.quotation(validity_date=yesterday())
        detail = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()
        self.assertEqual(
            (detail['actions']['send'], detail['actions']['confirm'], detail['expired']), (False, False, True),
        )

    def test_an_expired_quotation_cannot_be_confirmed_and_staff_extend_it_by_reopening(self):
        order = self.sent()
        order.validity_date = yesterday()
        self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/confirm'), 422, 'quotation_expired')
        self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/send'), 422, 'quotation_expired')
        self.assertEqual(self.act(self.agent, order.id, 'reopen')['state'], 'draft')
        tomorrow = (fields.Date.today() + timedelta(days=1)).isoformat()
        self.assertFalse(self.patch_order(self.agent, order.id, {'validity_date': tomorrow})['expired'])
        self.assertEqual(self.send_via_api(self.agent, order.id)['state'], 'sent')
        self.assertEqual(self.act(self.agent, order.id, 'confirm')['state'], 'confirmed')

    def test_an_expired_draft_cannot_be_confirmed(self):
        order = self.quotation(validity_date=yesterday())
        self.refused(self.api_as(self.agent, 'POST', f'{ORDERS}/{order.id}/confirm'), 422, 'quotation_expired')
        self.assertEqual(order.state, 'draft')

    def test_reopening_a_sent_quotation_clears_the_answer_and_the_snapshots(self):
        order = self.sent('accept_and_sign')
        order.write({
            'liwan_answer': 'accepted', 'liwan_answered_on': fields.Datetime.now(), 'signed_by': 'Buyer',
            'liwan_signature_method': 'drawn',
        })
        body = self.act(self.agent, order.id, 'reopen')
        self.assertEqual((body['state'], body['customer_answer']), ('draft', None))
        order.invalidate_recordset()
        self.assertEqual(
            (order.liwan_answer_mode, order.liwan_answer, order.liwan_answered_on, order.signed_by, order.signature,
             order.require_signature, order.liwan_signature_methods, order.liwan_signature_method),
            (False,) * 8,
        )

    def test_a_declined_quotation_reopens_without_its_answer(self):
        order = self.sent()
        order.write({'liwan_answer': 'declined', 'liwan_decline_reason': 'too dear'})
        order.action_cancel()
        body = self.act(self.agent, order.id, 'reopen')
        self.assertEqual((body['state'], body['customer_answer']), ('draft', None))
        order.invalidate_recordset()
        self.assertFalse(order.liwan_decline_reason)

    def test_confirm_cancel_and_reopen_still_send_no_mail(self):
        order = self.sent()
        mails = self.env['mail.mail'].search_count([])
        for action in ('confirm', 'cancel', 'reopen'):
            self.act(self.agent, order.id, action)
        self.assertEqual(self.env['mail.mail'].search_count([]), mails)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesQuotationPdf(QuotationCase):

    def pdf(self, user, order_id):
        with self.pdf_engine() as render:
            response = self.api_as(user, 'GET', f'{ORDERS}/{order_id}/pdf')
        return response, render

    def test_the_pdf_is_the_stock_quotation_report(self):
        order = self.quotation()
        response, render = self.pdf(self.agent, order.id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['Content-Type'], 'application/pdf')
        self.assertTrue(response.content.startswith(b'%PDF'))
        self.assertTrue(response.headers['Content-Disposition'].startswith('attachment;'))
        self.assertNotIn('/', response.headers['Content-Disposition'])
        (_report, report_ref, res_ids), _kwargs = render.call_args
        self.assertEqual((report_ref, res_ids), ('sale.action_report_saleorder', order.ids))

    def test_a_reader_downloads_within_the_visibility_and_others_are_refused(self):
        order = self.quotation()
        reader = self.custom_user('sales_pdf_reader', ['sales.read'])
        self.assertEqual(self.pdf(self.manager, order.id)[0].status_code, 200)
        self.assertEqual(self.pdf(self.agent2, order.id)[0].status_code, 404)
        self.assertEqual(self.pdf(reader, order.id)[0].status_code, 404)
        self.set_visibility('all')
        self.assertEqual(self.pdf(reader, order.id)[0].status_code, 200)
        refused = self.pdf(self.outsider, order.id)[0]
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))

    def test_a_branch_session_downloads_a_branch_quotation(self):
        scope = self.in_branch
        order = self.quotation(scope)
        self.assertEqual(self.pdf(scope.agent, order.id)[0].status_code, 200)
        self.assertEqual(self.pdf(self.agent, order.id)[0].status_code, 404)

    def test_the_real_report_template_renders_in_a_branch_session(self):
        scope = self.in_branch
        order = self.quotation(scope)
        reports = self.env['ir.actions.report'].with_user(scope.agent).with_context(allowed_company_ids=[scope.company.id])
        html = reports._render_qweb_html('sale.action_report_saleorder', order.ids)[0]
        self.assertIn(order.name.encode(), html)

    def test_a_missing_pdf_engine_is_the_503_pdf_unavailable(self):
        order = self.quotation()
        report = type(self.env['ir.actions.report'])
        with patch.object(report, '_render_qweb_pdf', autospec=True, side_effect=OSError('no wkhtmltopdf')):
            response = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}/pdf')
        self.assertEqual((response.status_code, response.json()['code']), (503, 'pdf_unavailable'))
