# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import logging
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged

from .common import ACCESS_TOKEN, LiwanInboxCase
from .health_common import HEALTH_BODY, meta, meta_error
from .media_samples import PDF, PNG
from odoo.addons.liwan_api.tests.common import set_probe_feature

PIN = '482913'
PROFILE = {'data': [{
    'about': 'We sell', 'address': 'Riyadh', 'description': 'A shop', 'email': 'hi@acme.test',
    'websites': ['https://acme.test'], 'vertical': 'RETAIL', 'profile_picture_url': 'https://pps.whatsapp.net/a.jpg',
}]}
PROFILE_SHAPE = {
    'about': 'We sell', 'address': 'Riyadh', 'description': 'A shop', 'email': 'hi@acme.test',
    'websites': ['https://acme.test'], 'vertical': 'retail', 'picture_url': 'https://pps.whatsapp.net/a.jpg',
}


class LogCapture(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


@tagged('post_install', '-at_install', 'liwan')
class TestBusinessProfileApi(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reports_only = cls._capability_user('inbox_reports_only', 'inbox.reports.read')

    def path(self, suffix=''):
        return f'/api/v1/inbox/channels/{self.channel.id}{suffix}'

    def call(self, method, suffix='', body=None, responses=(), user=None):
        """Call the API as `user` while Meta answers `responses` in order (the last one repeats)."""
        self.login(user or self.manager)
        queue = list(responses) or [meta({'success': True})]
        mocked = MagicMock(side_effect=lambda *args, **kwargs: queue.pop(0) if len(queue) > 1 else queue[0])
        with patch.object(requests, 'request', mocked):
            return self.api(method, self.path(suffix), body), mocked

    def test_get_reads_meta_live(self):
        response, mocked = self.call('GET', '/profile', responses=[meta(PROFILE)])
        self.assertEqual(response.json(), PROFILE_SHAPE)
        (call,) = mocked.call_args_list
        self.assertEqual((call.args[0], call.args[1].rsplit('/', 2)[-2:]), ('GET', [self.channel.phone_number_id, 'whatsapp_business_profile']))
        self.assertIn('profile_picture_url', call.kwargs['params']['fields'])
        self.assertEqual(call.kwargs['headers'], {'Authorization': f'Bearer {ACCESS_TOKEN}'})

    def test_an_empty_profile_has_null_texts_and_no_websites(self):
        response, _ = self.call('GET', '/profile', responses=[meta({'data': [{'vertical': 'UNDEFINED'}]})])
        self.assertEqual(response.json(), {
            'about': None, 'address': None, 'description': None, 'email': None, 'websites': [], 'vertical': None, 'picture_url': None,
        })

    def test_patch_sends_exactly_the_given_fields_and_rereads(self):
        response, mocked = self.call('PATCH', '/profile', {
            'about': 'New about', 'websites': ['https://a.test', 'http://b.test'], 'vertical': 'beauty', 'email': '',
        }, responses=[meta({'success': True}), meta(PROFILE)])
        self.assertEqual(response.json(), PROFILE_SHAPE)
        write, read = mocked.call_args_list
        self.assertEqual(write.args[0], 'POST')
        self.assertEqual(write.kwargs['json'], {
            'messaging_product': 'whatsapp', 'about': 'New about', 'websites': ['https://a.test', 'http://b.test'],
            'vertical': 'BEAUTY', 'email': '',
        })
        self.assertEqual(read.args[0], 'GET')

    def test_a_null_vertical_clears_it(self):
        _, mocked = self.call('PATCH', '/profile', {'vertical': None}, responses=[meta({'success': True}), meta(PROFILE)])
        self.assertEqual(mocked.call_args_list[0].kwargs['json']['vertical'], '')

    def test_meta_limits_are_checked_before_anything_is_sent(self):
        cases = (
            ({'about': ''}, 'about'), ({'about': 'x' * 140}, 'about'), ({'address': 'x' * 257}, 'address'),
            ({'description': 'x' * 513}, 'description'), ({'email': 'nope'}, 'email'), ({'email': 'a@b.co' + 'x' * 130}, 'email'),
            ({'websites': ['https://a', 'https://b', 'https://c']}, 'websites'), ({'websites': ['ftp://a.test']}, 'websites'),
            ({'websites': ['https://' + 'a' * 250]}, 'websites'), ({'vertical': 'bogus'}, 'vertical'), ({'bogus': 1}, 'bogus'), ({}, None),
        )
        for body, field in cases:
            response, mocked = self.call('PATCH', '/profile', body)
            self.assertError(response, 422, 'invalid')
            self.assertEqual(response.json().get('field'), field, body)
            self.assertEqual(mocked.call_count, 0)
        boundary, _ = self.call('PATCH', '/profile', {
            'about': 'x' * 139, 'address': 'x' * 256, 'description': 'x' * 512, 'websites': [], 'email': 'a@' + 'b' * 120 + '.co',
        }, responses=[meta({'success': True}), meta(PROFILE)])
        self.assertEqual(boundary.status_code, 200, boundary.text)

    def test_a_refusal_by_meta_is_a_422_with_its_text(self):
        response, _ = self.call('PATCH', '/profile', {'about': 'x'}, responses=[meta_error('(#100) Invalid parameter')])
        self.assertError(response, 422, 'invalid')
        self.assertIn('Invalid parameter', response.json()['message'])

    def test_a_picture_goes_to_meta_through_the_resumable_upload(self):
        self.channel.app_id = '300000000001'
        body = {'name': 'logo.png', 'mimetype': 'image/png', 'data': base64.b64encode(PNG).decode()}
        response, mocked = self.call('PUT', '/profile/picture', body, responses=[
            meta({'id': 'upload:abc'}), meta({'h': 'handle-1'}), meta({'success': True}), meta(PROFILE),
        ])
        self.assertEqual(response.json(), PROFILE_SHAPE)
        session, upload, write, _read = mocked.call_args_list
        self.assertTrue(session.args[1].endswith('/300000000001/uploads'))
        self.assertEqual(session.kwargs['params'], {'file_name': 'logo.png', 'file_length': len(PNG), 'file_type': 'image/png'})
        self.assertEqual((upload.kwargs['data'], upload.kwargs['headers']['Authorization']), (PNG, f'OAuth {ACCESS_TOKEN}'))
        self.assertEqual(write.kwargs['json'], {'messaging_product': 'whatsapp', 'profile_picture_handle': 'handle-1'})
        self.assertFalse(self.env['ir.attachment'].search([('name', '=', 'logo.png')]))

    def test_a_picture_needs_the_app_id_and_an_image(self):
        body = {'name': 'logo.png', 'mimetype': 'image/png', 'data': base64.b64encode(PNG).decode()}
        response, mocked = self.call('PUT', '/profile/picture', body)
        self.assertEqual((response.status_code, response.json().get('field')), (422, 'app_id'))
        self.channel.app_id = '300000000001'
        for bad in ({**body, 'data': base64.b64encode(PDF).decode(), 'mimetype': 'application/pdf'}, {**body, 'data': '!!'}):
            response, mocked = self.call('PUT', '/profile/picture', bad)
            self.assertEqual((response.status_code, response.json().get('field')), (422, 'data'))
        self.assertEqual(mocked.call_count, 0)

    def test_the_display_name_request_starts_a_review(self):
        response, mocked = self.call('POST', '/display-name', {'name': 'New Acme'})
        self.assertEqual(mocked.call_args.kwargs['json'], {'new_display_name': 'New Acme'})
        self.assertEqual((response.json()['health']['name_status'], response.json()['health']['requested_name']), ('pending_review', 'New Acme'))
        self.assertEqual(self.env['liwan.inbox.channel.alert'].search([('channel_id', '=', self.channel.id)]).kind, 'name_pending')
        self.assertError(self.call('POST', '/display-name', {'name': 'ab'})[0], 422, 'invalid')

    def test_the_pin_is_six_digits_and_never_kept_logged_or_returned(self):
        capture = LogCapture()
        logging.getLogger().addHandler(capture)
        self.addCleanup(logging.getLogger().removeHandler, capture)
        for bad in ({'pin': '12345'}, {'pin': '1234567'}, {'pin': 'abcdef'}, {'pin': 123456}, {}, {'pin': PIN, 'x': 1}):
            self.assertError(self.call('POST', '/two-step-pin', bad)[0], 422, 'invalid')
        response, mocked = self.call('POST', '/two-step-pin', {'pin': PIN})
        self.assertEqual((response.status_code, response.text), (204, ''))
        self.assertEqual(mocked.call_args.kwargs['json'], {'pin': PIN})
        self.assertError(self.call('POST', '/two-step-pin', {'pin': PIN})[0], 429, 'rate_limited')
        self.channel.pin_attempted_at = fields.Datetime.now() - timedelta(minutes=2)
        failing, _ = self.call('POST', '/two-step-pin', {'pin': PIN}, responses=[meta_error('Request failed')])
        self.assertNotIn(PIN, failing.text)
        self.assertFalse([line for line in capture.lines if PIN in line])
        self.env.cr.execute('SELECT count(*) FROM liwan_inbox_channel WHERE access_token_enc LIKE %s OR last_error LIKE %s', [f'%{PIN}%'] * 2)
        self.assertEqual(self.env.cr.fetchone()[0], 0)

    def test_register_refreshes_the_health_and_surfaces_meta_errors(self):
        response, mocked = self.call('POST', '/register', {'pin': PIN}, responses=[meta({'success': True}), meta(HEALTH_BODY)])
        register, health = mocked.call_args_list
        self.assertTrue(register.args[1].endswith(f'/{self.channel.phone_number_id}/register'))
        self.assertEqual(register.kwargs['json'], {'messaging_product': 'whatsapp', 'pin': PIN})
        self.assertEqual(response.json()['health']['verified_name'], 'Acme')
        self.assertEqual(health.args[0], 'GET')
        again, again_calls = self.call('POST', '/register', {'pin': PIN})
        self.assertError(again, 429, 'rate_limited')
        self.assertEqual(again_calls.call_count, 0)
        self.channel.register_attempted_at = fields.Datetime.now() - timedelta(minutes=2)
        failing, _ = self.call('POST', '/register', {'pin': PIN}, responses=[meta_error('(#133016) Account could not be registered')])
        self.assertError(failing, 422, 'invalid')
        self.assertIn('133016', failing.json()['message'])
        self.assertNotIn(PIN, failing.text)

    def test_only_channel_managers_use_the_actions(self):
        routes = (
            ('GET', '/profile', None), ('PATCH', '/profile', {'about': 'x'}), ('POST', '/display-name', {'name': 'Acme'}),
            ('POST', '/two-step-pin', {'pin': PIN}), ('POST', '/register', {'pin': PIN}), ('GET', '/alerts', None),
            ('POST', '/template-insights', {}), ('POST', '/analytics/sync', {}),
        )
        for user in (self.templates_only, self.reports_only, self.agent, self.supervisor):
            for method, suffix, body in routes:
                response, mocked = self.call(method, suffix, body, user=user)
                self.assertError(response, 403, 'forbidden')
                self.assertEqual(mocked.call_count, 0)

    def test_the_whatsapp_sub_feature_gates_the_profile(self):
        set_probe_feature(self, key='inbox.whatsapp', enabled=False)
        self.assertEqual(self.call('PATCH', '/profile', {'about': 'x'})[0].status_code, 403)

    def test_alerts_are_listed_newest_first_with_a_total(self):
        for index in range(3):
            self.channel._liwan_alert('quality_changed', 'warning', quality_rating='yellow', reason=f'r{index}')
        response, _ = self.call('GET', '/alerts?limit=2')
        body = response.json()
        self.assertEqual((body['total'], len(body['items'])), (3, 2))
        self.assertEqual(set(body['items'][0]), {
            'id', 'kind', 'severity', 'occurred_at', 'quality_rating', 'messaging_limit', 'previous_messaging_limit',
            'requested_name', 'reason', 'expires_at',
        })
