# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The customer's side of a quotation: the public page, the answer, the signature and the PDF, by access token."""
import base64
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import LockError
from odoo.tests import tagged

from .common import BRIDGE_KEYS, FAKE_PDF, MODES, QuotationCase, png_base64
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_sales.controllers.public import PDF_COUNTER, PDF_LIMIT

PUBLIC = '/api/v1/public/sales/quotations'
PUBLIC_KEYS = {
    'id', 'number', 'state', 'expired', 'company_name', 'customer_name', 'date', 'validity_date', 'terms', 'currency',
    'amount_untaxed', 'amount_tax', 'amount_total', 'lines', 'answer_mode', 'signature_methods', 'answer', 'answered_at', 'signed_by',
    'can_accept', 'can_decline', 'payment',
}
LINE_KEYS = {
    'kind', 'name', 'quantity', 'unit', 'unit_price', 'discount_percent', 'amount_untaxed', 'amount_tax', 'amount_total',
}


class PublicCase(QuotationCase):

    def anon(self, method, path, json=None):
        self.authenticate(None, None)
        return self.api(method, path, json=json)

    def get(self, order, token=None, suffix=''):
        return self.anon('GET', f'{PUBLIC}/{order.id}{suffix}?access_token={token or order.access_token}')

    def answer(self, order, action, body=None, token=None):
        payload = {'access_token': token or order.access_token, **(body or {})}
        return self.anon('POST', f'{PUBLIC}/{order.id}/{action}', payload)

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def refusal(self, response, status, code, field=None):
        self.assertEqual(response.status_code, status, response.text)
        body = response.json()
        self.assertEqual((body['code'], body.get('field')), (code, field), response.text)
        return body

    def expire(self, order):
        order.validity_date = fields.Date.today() - timedelta(days=1)


@tagged('post_install', '-at_install', 'liwan')
class TestPublicQuotation(PublicCase):

    def test_the_page_is_anonymous_and_has_exactly_the_public_keys(self):
        order = self.sent(validity_date=fields.Date.today() + timedelta(days=5), note='<p>Pay soon</p>')
        response = self.get(order)
        self.assertNotIn('set-cookie', {key.lower() for key in response.headers})
        body = self.ok(response)
        self.assertEqual(set(body) - BRIDGE_KEYS, PUBLIC_KEYS)
        self.assertEqual(set(body['lines'][0]), LINE_KEYS)
        self.assertEqual((body['id'], body['number'], body['state']), (order.id, order.name, 'sent'))
        self.assertEqual((body['company_name'], body['customer_name']), (order.company_id.name, 'Customer'))
        self.assertEqual(body['validity_date'], (fields.Date.today() + timedelta(days=5)).isoformat())
        self.assertIn('Pay soon', body['terms'])
        currency = order.currency_id
        self.assertEqual(body['currency'], {'id': currency.id, 'name': currency.name, 'symbol': currency.symbol})
        self.assertEqual((body['amount_untaxed'], body['amount_tax'], body['amount_total']), (90.0, 0.0, 90.0))
        self.assertEqual(body['lines'][0]['kind'], 'product')
        self.assertEqual(body['lines'][0]['quantity'], 2)
        self.assertEqual(
            (body['answer_mode'], body['answer'], body['answered_at'], body['signed_by'], body['can_accept'], body['can_decline'], body['expired']),
            ('accept', None, None, None, True, True, False),
        )
        text = response.text
        for secret in ('buyer@example.test', 'access_token', self.agent.name, self.agent.login):
            self.assertNotIn(secret, text)

    def test_every_refusal_is_the_same_404(self):
        order = self.sent()
        draft = self.quotation()
        draft._portal_ensure_token()
        never_sent = self.quotation()
        never_sent.write({'state': 'sent'})
        never_sent._portal_ensure_token()
        online = self.sent()
        online.liwan_staff_document = False
        cases = {
            'wrong token': self.get(order, token='not-the-token'),
            'no token': self.anon('GET', f'{PUBLIC}/{order.id}'),
            'long token': self.get(order, token='x' * 500),
            'non-ascii token': self.get(order, token='%C3%A9'),
            'non-ascii token, missing order': self.anon('GET', f'{PUBLIC}/{order.id + 100000}?access_token=%C3%A9'),
            'another orders token': self.get(order, token=online.access_token),
            'draft': self.get(draft),
            'never sent': self.get(never_sent),
            'online order': self.get(online),
            'missing order': self.anon('GET', f'{PUBLIC}/{order.id + 100000}?access_token={order.access_token}'),
        }
        bodies = set()
        for label, response in cases.items():
            with self.subTest(case=label):
                self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'), response.text)
                bodies.add(response.text)
        self.assertEqual(len(bodies), 1)

    def test_the_post_routes_refuse_the_same_way_and_change_nothing(self):
        order = self.sent()
        for action in ('accept', 'decline'):
            for token in ('not-the-token', None, 'x' * 500, 'é'):
                with self.subTest(action=action, token=token):
                    response = self.anon('POST', f'{PUBLIC}/{order.id}/{action}', {'access_token': token} if token else {})
                    self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))
            missing = self.anon('POST', f'{PUBLIC}/{order.id + 100000}/{action}', {'access_token': 'é'})
            self.assertEqual((missing.status_code, missing.json()['code']), (404, 'not_found'))
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer), ('sent', False))

    def test_a_confirmed_and_a_cancelled_quotation_stay_readable(self):
        confirmed = self.sent()
        confirmed.action_confirm()
        cancelled = self.sent()
        cancelled.action_cancel()
        self.assertEqual(self.ok(self.get(confirmed))['state'], 'confirmed')
        body = self.ok(self.get(cancelled))
        self.assertEqual((body['state'], body['can_accept'], body['can_decline'], body['answer']), ('cancelled', False, False, None))

    def test_the_page_works_in_both_scopes_and_both_commercial_modes(self):
        for mode in MODES:
            self.set_mode(mode)
            for name, scope in self.scopes.items():
                with self.subTest(commercial_mode=mode, scope=name):
                    order = self.sent(scope=scope)
                    self.assertEqual(self.ok(self.get(order))['company_name'], scope.company.name)
                    self.assertEqual(self.ok(self.answer(order, 'accept'))['answer'], 'accepted')

    def test_a_closed_feature_closes_the_public_routes(self):
        order = self.sent()
        set_probe_feature(self, key='sales.enabled', enabled=False)
        for response in (self.get(order), self.get(order, suffix='/pdf'), self.answer(order, 'accept'), self.answer(order, 'decline')):
            self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))

    def test_a_read_only_branch_refuses_the_answers_and_still_shows_the_page(self):
        order = self.sent()
        self.env['liwan.tenant.branch'].create({
            'branch_uid': 'sales-public-ro', 'company_id': order.company_id.id, 'operation_id': 'op-sales', 'read_only': True,
        })
        self.assertEqual(self.get(order).status_code, 200)
        for action in ('accept', 'decline'):
            response = self.answer(order, action)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'branch_read_only'), response.text)
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer), ('sent', False))

    def test_a_read_only_tenant_refuses_the_answers_and_still_shows_the_page(self):
        order = self.sent()
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'status': 'suspended', 'suspension_reason': 'non_payment'})
        self.assertEqual(self.get(order).status_code, 200)
        for action in ('accept', 'decline'):
            response = self.answer(order, action)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'tenant_read_only'), response.text)
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer), ('sent', False))


@tagged('post_install', '-at_install', 'liwan')
class TestPublicAccept(PublicCase):

    def test_accepting_records_the_answer_and_leaves_the_order_sent(self):
        order = self.sent('accept', False)
        mails = self.env['mail.mail'].search_count([])
        body = self.ok(self.answer(order, 'accept'))
        self.assertEqual((body['state'], body['answer'], body['can_accept'], body['can_decline']), ('sent', 'accepted', False, False))
        self.assertTrue(body['answered_at'].endswith('Z'))
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer), ('sent', 'accepted'))
        self.assertTrue(order.liwan_answered_on)
        self.assertEqual(self.env['mail.mail'].search_count([]), mails)

    def test_accepting_confirms_the_order_when_the_snapshot_says_so(self):
        order = self.sent('accept', True)
        self.set_answer('accept', False)
        mails = self.env['mail.mail'].search_count([])
        body = self.ok(self.answer(order, 'accept'))
        self.assertEqual((body['state'], body['answer']), ('confirmed', 'accepted'))
        order.invalidate_recordset()
        self.assertEqual(order.state, 'sale')
        self.assertEqual(self.env['mail.mail'].search_count([]), mails)

    def test_a_mode_accept_refuses_the_signature_fields(self):
        order = self.sent('accept')
        for field in ('signed_by', 'signature', 'signature_method'):
            with self.subTest(field=field):
                self.refusal(self.answer(order, 'accept', {field: 'x'}), 422, 'unknown_field', field)
        self.refusal(self.answer(order, 'accept', {'reason': 'x'}), 422, 'unknown_field', 'reason')
        order.invalidate_recordset()
        self.assertFalse(order.liwan_answer)

    def test_a_signed_acceptance_stores_the_signature(self):
        order = self.sent('accept_and_sign', True)
        body = self.ok(self.answer(order, 'accept', {'signed_by': '  Layla Buyer ', 'signature': png_base64(), 'signature_method': 'drawn'}))
        self.assertEqual((body['answer'], body['signed_by'], body['state']), ('accepted', 'Layla Buyer', 'confirmed'))
        order.invalidate_recordset()
        self.assertTrue(order.signature)
        self.assertEqual((order.signed_by, order.liwan_signature_method), ('Layla Buyer', 'drawn'))
        self.assertTrue(order.signed_on)

    def test_a_signature_is_required_and_validated(self):
        order = self.sent('accept_and_sign')
        good = png_base64()
        jpeg_like = base64.b64encode(b'\xff\xd8\xff\xe0' + b'0' * 50).decode()
        too_big = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'0' * 50_000).decode()
        cases = [
            ({}, 'signature_required'),
            ({'signed_by': 'Buyer'}, 'signature_required'),
            ({'signature': good}, 'signature_required'),
            ({'signed_by': '   ', 'signature': good}, 'signature_required'),
            ({'signed_by': 'x' * 121, 'signature': good}, 'signature_invalid'),
            ({'signed_by': 5, 'signature': good}, 'signature_invalid'),
            ({'signed_by': 'Buyer', 'signature': f'data:image/png;base64,{good}'}, 'signature_invalid'),
            ({'signed_by': 'Buyer', 'signature': '%%%not base64%%%'}, 'signature_invalid'),
            ({'signed_by': 'Buyer', 'signature': jpeg_like}, 'signature_invalid'),
            ({'signed_by': 'Buyer', 'signature': too_big}, 'signature_invalid'),
            ({'signed_by': 'Buyer', 'signature': base64.b64encode(b'\x89PNG\r\n\x1a\nnot an image').decode()}, 'signature_invalid'),
            ({'signed_by': 'Buyer', 'signature': 7}, 'signature_invalid'),
        ]
        for body, code in cases:
            with self.subTest(body=list(body), code=code):
                self.refusal(self.answer(order, 'accept', body), 422, code)
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer, order.signature), ('sent', False, False))
        self.ok(self.answer(order, 'accept', {'signed_by': 'x' * 120, 'signature': good, 'signature_method': 'typed'}))

    def test_the_signature_method_is_required_with_a_signature_and_refused_without_one(self):
        order = self.sent('accept_and_sign')
        signed = {'signed_by': 'Buyer', 'signature': png_base64()}
        for body in (signed, {**signed, 'signature_method': 'scribble'}, {**signed, 'signature_method': None},
                     {**signed, 'signature_method': 'draw'}, {**signed, 'signature_method': 5}):
            with self.subTest(body=body):
                self.refusal(self.answer(order, 'accept', body), 422, 'invalid', 'signature_method')
        for body in ({'signature_method': 'drawn'}, {'signed_by': 'Buyer', 'signature_method': 'typed'}):
            with self.subTest(body=body):
                self.refusal(self.answer(order, 'accept', body), 422, 'invalid', 'signature_method')
        order.invalidate_recordset()
        self.assertEqual((order.liwan_answer, order.liwan_signature_method), (False, False))

    def test_typed_signatures_follow_the_snapshot_taken_at_send(self):
        typed = {'signed_by': 'Buyer', 'signature': png_base64(), 'signature_method': 'typed'}
        drawn = {**typed, 'signature_method': 'drawn'}
        draw_only = self.sent('accept_and_sign', signature_methods='draw')
        self.assertEqual(self.ok(self.get(draw_only))['signature_methods'], 'draw')
        self.refusal(self.answer(draw_only, 'accept', typed), 422, 'invalid', 'signature_method')
        draw_only.invalidate_recordset()
        self.assertFalse(draw_only.liwan_answer)
        self.ok(self.answer(draw_only, 'accept', drawn))
        draw_only.invalidate_recordset()
        self.assertEqual(draw_only.liwan_signature_method, 'drawn')
        both = self.sent('accept_and_sign', signature_methods='draw_or_type')
        self.assertEqual(self.ok(self.get(both))['signature_methods'], 'draw_or_type')
        self.set_signature_methods('draw')
        self.ok(self.answer(both, 'accept', typed))
        both.invalidate_recordset()
        self.assertEqual(both.liwan_signature_method, 'typed')
        staff = self.api_as(self.agent, 'GET', f'/api/v1/sales/orders/{both.id}').json()['customer_answer']
        self.assertEqual(staff['signature_method'], 'typed')

    def test_a_none_mode_allows_no_answer_at_all(self):
        order = self.sent('none')
        body = self.ok(self.get(order))
        self.assertEqual((body['answer_mode'], body['can_accept'], body['can_decline']), ('none', False, False))
        for action in ('accept', 'decline'):
            self.refusal(self.answer(order, action), 422, 'answer_not_allowed')

    def test_a_quotation_is_answered_once(self):
        for first, second in (('accept', 'accept'), ('accept', 'decline'), ('decline', 'accept'), ('decline', 'decline')):
            with self.subTest(first=first, second=second):
                order = self.sent()
                self.ok(self.answer(order, first))
                self.refusal(self.answer(order, second), 422, 'already_answered')

    def test_a_staff_cancelled_or_confirmed_quotation_takes_no_answer(self):
        cancelled = self.sent()
        cancelled.action_cancel()
        confirmed = self.sent()
        confirmed.action_confirm()
        for order in (cancelled, confirmed):
            for action in ('accept', 'decline'):
                self.refusal(self.answer(order, action), 422, 'already_answered')

    def test_an_expired_quotation_cannot_be_accepted_but_can_be_declined(self):
        order = self.sent('accept', True)
        self.expire(order)
        body = self.ok(self.get(order))
        self.assertEqual((body['expired'], body['can_accept'], body['can_decline']), (True, False, True))
        self.refusal(self.answer(order, 'accept'), 422, 'quotation_expired')
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer), ('sent', False))
        self.assertEqual(self.ok(self.answer(order, 'decline'))['state'], 'cancelled')


@tagged('post_install', '-at_install', 'liwan')
class TestPublicDeclineAndPdf(PublicCase):

    def test_declining_cancels_the_quotation_and_keeps_the_reason(self):
        order = self.sent()
        body = self.ok(self.answer(order, 'decline', {'reason': 'Too expensive'}))
        self.assertEqual((body['state'], body['answer'], body['can_accept'], body['can_decline']), ('cancelled', 'declined', False, False))
        order.invalidate_recordset()
        self.assertEqual((order.state, order.liwan_answer, order.liwan_decline_reason), ('cancel', 'declined', 'Too expensive'))
        self.assertTrue(order.liwan_answered_on)
        staff = self.api_as(self.agent, 'GET', f'/api/v1/sales/orders/{order.id}').json()['customer_answer']
        self.assertEqual((staff['answer'], staff['decline_reason']), ('declined', 'Too expensive'))
        self.assertTrue(staff['answered_at'].endswith('Z'))

    def test_a_reason_is_optional_and_bounded(self):
        order = self.sent()
        self.refusal(self.answer(order, 'decline', {'reason': 'x' * 1001}), 422, 'invalid', 'reason')
        self.refusal(self.answer(order, 'decline', {'reason': 5}), 422, 'invalid', 'reason')
        self.refusal(self.answer(order, 'decline', {'signature': 'x'}), 422, 'unknown_field', 'signature')
        self.assertEqual(self.ok(self.answer(order, 'decline'))['answer'], 'declined')
        order.invalidate_recordset()
        self.assertFalse(order.liwan_decline_reason)
        boundary = self.sent()
        self.ok(self.answer(boundary, 'decline', {'reason': 'x' * 1000}))

    def test_a_signed_declining_mode_may_decline(self):
        order = self.sent('accept_and_sign')
        self.assertEqual(self.ok(self.answer(order, 'decline'))['state'], 'cancelled')

    def test_the_pdf_follows_the_page_visibility(self):
        order = self.sent()
        with self.pdf_engine() as render:
            response = self.get(order, suffix='/pdf')
        self.assertEqual((response.status_code, response.headers['Content-Type']), (200, 'application/pdf'))
        self.assertEqual(response.content, FAKE_PDF)
        self.assertNotIn('set-cookie', {key.lower() for key in response.headers})
        (_report, report_ref, res_ids), _kwargs = render.call_args
        self.assertEqual((report_ref, res_ids), ('sale.action_report_saleorder', order.ids))
        for refused in (self.get(order, token='nope', suffix='/pdf'), self.get(self.quotation(), token='nope', suffix='/pdf')):
            self.assertEqual((refused.status_code, refused.json()['code']), (404, 'not_found'))

    def test_the_pdf_carries_the_signature_only_when_signed(self):
        seen = []

        def render(report, report_ref, res_ids, data=None):
            seen.append(report.env.context.get('sale_include_signature'))
            return FAKE_PDF, 'pdf'

        report = type(self.env['ir.actions.report'])
        order = self.sent('accept_and_sign')
        with patch.object(report, '_render_qweb_pdf', autospec=True, side_effect=render):
            unsigned_get = self.get(order, suffix='/pdf')
            self.ok(self.answer(order, 'accept', {'signed_by': 'Buyer', 'signature': png_base64(), 'signature_method': 'drawn'}))
            signed_get = self.get(order, suffix='/pdf')
        self.assertEqual((unsigned_get.status_code, signed_get.status_code), (200, 200))
        self.assertEqual([bool(flag) for flag in seen], [False, True])


@tagged('post_install', '-at_install', 'liwan')
class TestPublicPdfLimit(PublicCase):

    def pdfs(self, order, count, token=None):
        with self.pdf_engine():
            return [self.get(order, token=token, suffix='/pdf') for _ in range(count)]

    def test_the_pdf_answers_429_past_its_budget_for_that_quotation_only(self):
        order, other = self.sent(), self.sent()
        self.assertEqual({response.status_code for response in self.pdfs(order, PDF_LIMIT)}, {200})
        refused = self.pdfs(order, 1)[0]
        self.assertEqual((refused.status_code, refused.json()['code']), (429, 'rate_limited'), refused.text)
        # The page and the other quotation's PDF are not charged to this one.
        self.assertEqual(self.get(order).status_code, 200)
        self.assertEqual(self.pdfs(other, 1)[0].status_code, 200)

    def test_the_budget_turns_with_the_minute_window(self):
        order = self.sent()
        self.pdfs(order, PDF_LIMIT + 1)
        self.env.cr.execute(
            'UPDATE liwan_api_public_limit SET window_start = window_start - interval %s WHERE scope = %s AND res_id = %s',
            ['2 minutes', PDF_COUNTER, order.id],
        )
        self.assertEqual(self.pdfs(order, 1)[0].status_code, 200)

    def test_a_wrong_token_is_a_404_and_spends_nothing(self):
        order = self.sent()
        for refused in self.pdfs(order, PDF_LIMIT + 2, token='nope'):
            self.assertEqual(refused.status_code, 404)
        self.assertFalse(self.env['liwan.api.public.limit'].search([('scope', '=', PDF_COUNTER), ('res_id', '=', order.id)]))
        self.assertEqual(self.pdfs(order, 1)[0].status_code, 200)

    def test_the_counter_never_holds_the_token(self):
        order = self.sent()
        self.pdfs(order, 1)
        self.assertEqual(set(self.env['liwan.api.public.limit']._fields) & {'access_token', 'token'}, set())


@tagged('post_install', '-at_install', 'liwan')
class TestPublicAnswerBell(PublicCase):

    def bell(self, user):
        response = self.api_as(user, 'GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 200, response.text)
        return [item for item in response.json()['items'] if item['kind'] == 'sales.answered']

    def test_each_answer_rings_the_salesperson_once_with_a_link_to_the_order(self):
        accepted, signed, declined = self.sent(), self.sent('accept_and_sign'), self.sent()
        self.ok(self.answer(accepted, 'accept'))
        self.ok(self.answer(signed, 'accept', {'signed_by': 'Buyer', 'signature': png_base64(), 'signature_method': 'drawn'}))
        self.ok(self.answer(declined, 'decline', {'reason': 'Too dear'}))
        rows = {row['order_id']: row for row in self.bell(self.agent)}
        self.assertEqual(
            {order.id: (rows[order.id]['answer'], rows[order.id]['title']) for order in (accepted, signed, declined)},
            {accepted.id: ('accepted', accepted.name), signed.id: ('signed', signed.name), declined.id: ('declined', declined.name)},
        )
        self.assertEqual(set(rows[accepted.id]) - {'id', 'created_at', 'is_read'}, {'kind', 'order_id', 'answer', 'title'})
        self.assertNotIn('Too dear', str(rows))
        self.assertEqual(self.bell(self.agent2), [])

    def test_a_refused_answer_rings_nobody(self):
        order = self.sent()
        self.assertEqual(self.answer(order, 'accept', token='nope').status_code, 404)
        self.assertEqual(self.bell(self.agent), [])

    def test_an_order_with_no_salesperson_notifies_nobody(self):
        order = self.sent()
        order.user_id = False
        messages = self.env['mail.message'].search_count([('liwan_notification_kind', '=', 'sales.answered')])
        self.ok(self.answer(order, 'accept'))
        self.assertEqual(self.env['mail.message'].search_count([('liwan_notification_kind', '=', 'sales.answered')]), messages)

    def test_an_archived_salesperson_is_not_notified(self):
        order = self.sent()
        order.user_id.active = False
        messages = self.env['mail.message'].search_count([('liwan_notification_kind', '=', 'sales.answered')])
        self.ok(self.answer(order, 'accept'))
        self.assertEqual(self.env['mail.message'].search_count([('liwan_notification_kind', '=', 'sales.answered')]), messages)

    def test_an_acceptance_that_confirms_the_order_rings_the_salesperson_once(self):
        order = self.sent(confirms=True)
        self.ok(self.answer(order, 'accept'))
        self.assertEqual(order.state, 'sale')
        self.assertEqual([row['answer'] for row in self.bell(self.agent)], ['accepted'])

    def test_the_row_hides_when_the_salesperson_loses_the_order(self):
        order = self.sent()
        self.ok(self.answer(order, 'accept'))
        self.assertEqual(len(self.bell(self.agent)), 1)
        order.user_id = self.agent2
        self.assertEqual(self.bell(self.agent), [])

    def messages(self, order):
        return self.env['mail.message'].search([('liwan_notification_kind', '=', 'sales.answered'), ('res_id', '=', order.id)])

    def test_a_reopened_quotation_answered_again_rings_again(self):
        order = self.sent()
        self.ok(self.answer(order, 'accept'))
        self.act(self.agent, order.id, 'reopen')
        self.send_via_api(self.agent, order.id)
        self.ok(self.answer(order, 'accept'))
        self.assertEqual(len(self.messages(order)), 2)
        self.assertEqual(len(self.bell(self.agent)), 2)
        # One key per answering round: a repeat inside a round would collapse into one row.
        self.assertEqual(
            sorted(self.messages(order).mapped('liwan_notification_key')),
            [f'sales.answered:{order.id}:0', f'sales.answered:{order.id}:1'],
        )

    def test_the_bell_row_follows_the_company_of_the_order(self):
        order = self.sent(scope=self.in_branch)
        self.ok(self.answer(order, 'accept'))
        message = self.messages(order)
        # The row names the order and carries no company of its own: the order's company decides who sees it.
        self.assertEqual((message.model, message.res_id, message.record_company_id), ('sale.order', order.id, self.env['res.company']))
        self.assertEqual(order.company_id, self.branch)
        self.assertEqual([row['order_id'] for row in self.bell(self.in_branch.agent)], [order.id])
        self.assertEqual(self.bell(self.agent), [])

    def test_the_row_lock_comes_before_the_answerable_check(self):
        order = self.sent()
        self.ok(self.answer(order, 'accept'))
        calls = []

        def held(records, **_):
            calls.append(records.id)
            message = 'held'
            raise LockError(message)
        with patch.object(type(self.env['sale.order']), 'lock_for_update', held):
            response = self.answer(order, 'accept')
        # Already answered, yet the held lock wins: the check never ran before the lock.
        self.refusal(response, 409, 'conflict')
        self.assertEqual(calls, [order.id])

    def test_a_held_lock_is_a_conflict_that_answers_nothing(self):
        order = self.sent()
        with patch.object(type(self.env['sale.order']), 'lock_for_update', side_effect=LockError('held')):
            self.refusal(self.answer(order, 'decline', {'reason': 'x'}), 409, 'conflict')
        order.invalidate_recordset()
        self.assertFalse(order.liwan_answer)
        self.assertEqual(order.state, 'sent')
