# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime
from unittest.mock import MagicMock, patch

import requests

from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .campaign_common import BASE, CampaignCase
from .common import ACCESS_TOKEN, PHONE_ID
from .health_common import HEALTH_BODY, account_event, meta, meta_error, process
from odoo.addons.webvue_inbox.adapters import whatsapp

CREDENTIALS = whatsapp.Credentials(PHONE_ID, '200000000001', ACCESS_TOKEN)


def error_response(code, status=400, message='boom'):
    return meta({'error': {'message': message, 'code': code}}, status)


@tagged('post_install', '-at_install', 'webvue')
class TestProviderError(CampaignCase):

    def call(self, response):
        with patch.object(requests, 'request', return_value=response), self.assertRaises(whatsapp.ProviderError) as raised:
            whatsapp.send_text(CREDENTIALS, '966500000000', 'hi')
        return raised.exception

    def test_the_error_code_of_meta_is_kept_and_decides_whether_a_retry_may_help(self):
        for code, retryable in ((131049, False), (131050, False), (190, False), (130429, True), (131056, True), (80007, True), (4, True), (131057, True), (131000, True)):
            with self.subTest(code=code):
                error = self.call(error_response(code))
                self.assertEqual((error.code, error.retryable, str(error)), (code, retryable, 'boom'))

    def test_a_server_error_is_retryable_and_a_missing_code_is_none(self):
        self.assertEqual((self.call(meta_error('down', 503)).retryable, self.call(meta_error('down', 503)).code), (True, None))
        self.assertEqual(self.call(error_response('x')).code, None)
        self.assertEqual(self.call(error_response(True)).code, None)


@tagged('post_install', '-at_install', 'webvue')
class TestSendTemplate(CampaignCase):

    def send(self, **kwargs):
        mock = self.sending_meta(**{key: kwargs.pop(key) for key in ('held',) if key in kwargs})
        with patch.object(requests, 'request', mock):
            result = whatsapp.send_template(CREDENTIALS, '966500000000', 'offer', 'ar', ['Sara'], **kwargs)
        return result, mock.calls[0]

    def test_the_cloud_api_is_the_default_path(self):
        result, (_method, url, payload) = self.send()
        self.assertTrue(url.endswith(f'/{PHONE_ID}/messages'))
        self.assertNotIn('product_policy', payload)
        self.assertEqual((result.held, result.provider_id.startswith('wamid.CAMP')), (False, True))

    def test_the_marketing_messages_api_posts_to_its_own_path_with_the_fallback_policy(self):
        result, (_method, url, payload) = self.send(marketing_api=True, held=True)
        self.assertTrue(url.endswith(f'/{PHONE_ID}/marketing_messages'))
        self.assertEqual((payload['product_policy'], payload['type'], payload['template']['name']), ('CLOUD_API_FALLBACK', 'template', 'offer'))
        self.assertTrue(result.held)

    def test_a_status_webhook_carries_its_error_code(self):
        payload = wa.status('wamid.S1', 'failed', error='Per-user limit')
        payload['entry'][0]['changes'][0]['value']['statuses'][0]['errors'][0]['code'] = 131049
        events = whatsapp.parse_events(payload, PHONE_ID, '200000000001')
        self.assertEqual((events[0].error, events[0].error_code), ('Per-user limit', 131049))
        plain = whatsapp.parse_events(wa.status('wamid.S2', 'read'), PHONE_ID, '200000000001')
        self.assertEqual(plain[0].error_code, None)

    def test_marketing_preferences_are_parsed_and_other_categories_ignored(self):
        payload = self.keyword_event('966500000001', 'stop')
        item = {'wa_id': '966500000002', 'category': 'utility_messages', 'value': 'stop', 'timestamp': '1790000000'}
        payload['entry'][0]['changes'][0]['value']['user_preferences'].append(item)
        payload['entry'][0]['changes'][0]['value']['user_preferences'].append({**item, 'category': 'marketing_messages', 'value': 'maybe'})
        events = whatsapp.parse_events(payload, PHONE_ID, '200000000001')
        self.assertEqual(events, [whatsapp.UserPreferenceUpdate('966500000001', 'stop', datetime(2026, 9, 21, 14, 13, 20))])


@tagged('post_install', '-at_install', 'webvue')
class TestSendingHealth(CampaignCase):

    def setUp(self):
        super().setUp()
        self.path = f'{BASE}/channels/{self.channel.id}/sending'

    def graph(self, onboarding='ONBOARDED', phone=None, fail=None):
        def answer(method, url, **kwargs):
            if fail:
                return meta_error(fail)
            if url.endswith(f'/{PHONE_ID}'):
                return meta(phone or HEALTH_BODY)
            return meta({'marketing_messages_onboarding_status': onboarding} if onboarding else {})
        return MagicMock(side_effect=answer)

    def test_refresh_reads_the_tier_quality_and_onboarding_from_meta(self):
        self.login(self.campaigns_only)
        with patch.object(requests, 'request', self.graph()):
            sending = self.api('POST', f'{self.path}/refresh', {}).json()
        self.assertEqual(
            (sending['messaging_limit'], sending['quality_rating'], sending['marketing_onboarding'], sending['marketing_api']),
            ('tier_2k', 'green', 'onboarded', 'cloud_api'),
        )
        self.assertEqual((sending['used_24h'], sending['remaining_24h']), (0, 2000))
        self.assertIsNotNone(sending['checked_at'])
        with patch.object(requests, 'request', self.graph(onboarding=None)):
            self.assertEqual(self.api('POST', f'{self.path}/refresh', {}).json()['marketing_onboarding'], 'not_started')
        with patch.object(requests, 'request', self.graph(onboarding='WEIRD')):
            self.assertEqual(self.api('POST', f'{self.path}/refresh', {}).json()['marketing_onboarding'], 'unknown')

    def test_a_meta_refusal_answers_422_with_its_text(self):
        self.login(self.campaigns_only)
        with patch.object(requests, 'request', self.graph(fail='Invalid OAuth access token')):
            response = self.api('POST', f'{self.path}/refresh', {})
        self.assertError(response, 422, 'invalid')
        self.assertIn('Invalid OAuth access token', response.json()['message'])

    def test_the_budget_counts_the_customers_messaged_outside_a_window_over_the_whole_account(self):
        for _ in range(3):
            self.make_contact()
        self.launched()
        self.run_campaigns()
        self.channel.messaging_limit = 'tier_250'
        self.login(self.campaigns_only)
        sending = self.get(self.path).json()
        self.assertEqual((sending['used_24h'], sending['remaining_24h']), (3, 247))
        self.channel.messaging_limit = 'unlimited'
        self.assertEqual(self.get(self.path).json()['remaining_24h'], None)
        self.channel.messaging_limit = 'tier_10k'

    def test_a_reply_inside_the_window_costs_no_budget(self):
        conversation = self.make_conversation()
        self.env['webvue.inbox.message']._webvue_queue_free_form(conversation, {'body': 'hello'})
        self.env['webvue.inbox.message']._webvue_queue_template(conversation, self.template, ['Sara'])
        self.assertEqual(self.channel._webvue_used_addresses(), set())

    def test_only_a_channel_manager_chooses_the_marketing_api(self):
        self.login(self.campaigns_only)
        self.assertError(self.api('PATCH', self.path, {'marketing_api': 'marketing_messages'}), 403, 'forbidden')
        self.login(self.manager)
        self.assertEqual(self.api('PATCH', self.path, {'marketing_api': 'marketing_messages'}).json()['marketing_api'], 'marketing_messages')
        self.assertError(self.api('PATCH', self.path, {'marketing_api': 'sms'}), 422, 'invalid')
        self.assertError(self.api('PATCH', self.path, {}), 422, 'invalid')

    def test_the_account_limit_webhook_reaches_every_channel_of_the_business_account(self):
        sibling = self.make_channel(phone_id='100000000066')
        payload = account_event('business_capability_update', {'max_daily_conversations_per_business': 100000})
        process(self, self.channel, payload)
        process(self, sibling, payload)
        self.assertEqual((self.channel.messaging_limit, sibling.messaging_limit), ('tier_100k', 'tier_100k'))
        process(self, self.channel, account_event(
            'phone_number_quality_update', {'display_phone_number': '+966 50 111 2222', 'event': 'UPGRADE', 'max_daily_conversations_per_business': 'TIER_UNLIMITED'},
        ))
        self.assertIn(self.channel.messaging_limit, ('tier_100k', 'unlimited'))
        self.channel.messaging_limit = 'tier_10k'
