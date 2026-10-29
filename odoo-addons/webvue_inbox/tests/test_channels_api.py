# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import MagicMock, patch

import requests

from odoo.tests import tagged

from .common import ACCESS_TOKEN, APP_SECRET, WebVueInboxCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_inbox.adapters import whatsapp
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

CHANNEL_KEYS = {
    'id', 'name', 'kind', 'state', 'department', 'phone_number_id', 'business_account_id', 'has_access_token',
    'has_app_secret', 'app_id', 'verify_token', 'callback_url', 'last_error', 'last_event_at',
}
NEW_CHANNEL = {
    'name': 'Branch line', 'kind': 'whatsapp', 'phone_number_id': '300000000001',
    'business_account_id': '400000000001', 'access_token': 'x' * 20, 'app_secret': 'y' * 20,
}


@tagged('post_install', '-at_install', 'webvue')
class TestChannelsApi(WebVueInboxCase):

    def test_create_returns_the_shape_without_secrets_and_stores_ciphertext(self):
        self.login(self.manager)
        result = self.api('POST', '/api/v1/inbox/channels', {**NEW_CHANNEL, 'department_id': self.department.id})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), CHANNEL_KEYS)
        self.assertEqual((body['state'], body['has_access_token'], body['has_app_secret']), ('draft', True, True))
        self.assertTrue(body['callback_url'].startswith('https://') and body['callback_url'].endswith('/api/v1/inbox/hooks/whatsapp'))
        self.assertGreaterEqual(len(body['verify_token']), 32)
        self.assertNotIn('x' * 20, result.text)
        self.env.cr.execute('SELECT access_token_enc, app_secret_enc FROM webvue_inbox_channel WHERE id = %s', [body['id']])
        stored = self.env.cr.fetchone()
        self.assertTrue(all(value and 'x' * 20 not in value and 'y' * 20 not in value for value in stored))
        channel = self.env['webvue.inbox.channel'].browse(body['id'])
        self.assertEqual(channel._webvue_credentials().access_token, 'x' * 20)
        self.assertEqual(channel._webvue_app_secret(), 'y' * 20)

    def test_missing_master_key_is_422_and_nothing_is_stored(self):
        self.login(self.manager)
        before = self.env['webvue.inbox.channel'].search_count([])
        with patch.dict('os.environ', {'WEBVUE_INBOX_SECRET_KEY': ''}):
            result = self.api('POST', '/api/v1/inbox/channels', NEW_CHANNEL)
        self.assertError(result, 422, 'invalid')
        self.assertIn('not configured', result.json()['message'])
        self.assertEqual(self.env['webvue.inbox.channel'].search_count([]), before)

    def test_validation_errors(self):
        self.login(self.manager)
        for change in (
            {'phone_number_id': 'abc'}, {'access_token': 'short'}, {'kind': 'telegram'}, {'bogus': 1},
            {'name': ''}, {'department_id': 999999},
        ):
            self.assertError(self.api('POST', '/api/v1/inbox/channels', {**NEW_CHANNEL, **change}), 422, 'invalid')
        missing = {key: value for key, value in NEW_CHANNEL.items() if key != 'app_secret'}
        self.assertError(self.api('POST', '/api/v1/inbox/channels', missing), 422, 'invalid')
        self.assertError(self.api('POST', '/api/v1/inbox/channels', {**NEW_CHANNEL, 'phone_number_id': self.channel.phone_number_id}), 422, 'invalid')

    def test_only_channel_managers_manage_channels(self):
        for user in (self.agent, self.supervisor, self.outsider):
            self.login(user)
            self.assertError(self.get('/api/v1/inbox/channels'), 403, 'forbidden')
            self.assertError(self.api('POST', '/api/v1/inbox/channels', NEW_CHANNEL), 403, 'forbidden')

    def test_list_get_patch_delete(self):
        self.login(self.manager)
        listed = self.get('/api/v1/inbox/channels').json()
        self.assertIn(self.channel.id, [c['id'] for c in listed['items']])
        self.assertEqual(self.get(f'/api/v1/inbox/channels/{self.channel.id}').json()['phone_number_id'], self.channel.phone_number_id)
        path = f'/api/v1/inbox/channels/{self.channel.id}'
        patched = self.api('PATCH', path, {'name': 'Renamed', 'state': 'disabled', 'access_token': 'z' * 20})
        self.assertEqual((patched.status_code, patched.json()['name'], patched.json()['state']), (200, 'Renamed', 'disabled'))
        self.assertEqual(self.reload(self.channel)._webvue_credentials().access_token, 'z' * 20)
        self.assertError(self.api('PATCH', path, {'state': 'error'}), 422, 'invalid')
        self.assertError(self.api('PATCH', path, {'state': 'connected'}), 422, 'invalid')
        self.assertError(self.get('/api/v1/inbox/channels/999999999'), 404, 'not_found')

    def test_delete_refuses_a_channel_with_conversations(self):
        self.make_conversation()
        self.login(self.manager)
        result = self.api('DELETE', f'/api/v1/inbox/channels/{self.channel.id}')
        self.assertError(result, 422, 'invalid')
        self.assertEqual(result.json()['details'], {'reason': 'inbox_channel_has_conversations'})

    def test_a_passing_test_enables_a_disabled_channel_and_a_failing_one_does_not(self):
        self.login(self.manager)
        path = f'/api/v1/inbox/channels/{self.channel.id}/test'
        self.channel.state = 'disabled'
        failing = MagicMock(status_code=401)
        failing.json.return_value = {'error': {'message': 'Invalid OAuth access token'}}
        with patch.object(requests, 'request', MagicMock(return_value=failing)):
            self.assertEqual(self.api('POST', path).json()['state'], 'error')
        with patch.object(requests, 'request', MagicMock(return_value=MagicMock(status_code=200))):
            self.assertEqual(self.api('POST', path).json()['state'], 'connected')

    def test_a_duplicate_phone_number_id_names_its_reason(self):
        self.login(self.manager)
        result = self.api('POST', '/api/v1/inbox/channels', {**NEW_CHANNEL, 'phone_number_id': self.channel.phone_number_id})
        self.assertEqual(result.json()['details'], {'reason': 'inbox_phone_number_taken'})
        empty = self.make_channel(phone_id='500000000001')
        self.assertEqual(self.api('DELETE', f'/api/v1/inbox/channels/{empty.id}').status_code, 204)
        self.assertFalse(empty.exists())

    def test_the_channel_limit_is_claimed_on_create(self):
        profile = self.env.ref('webvue_platform.tenant_profile')
        used = self.env['webvue.entitlement.service']._webvue_count_channels()
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.channels': used}})
        self.login(self.manager)
        result = self.api('POST', '/api/v1/inbox/channels', NEW_CHANNEL)
        self.assertEqual(result.status_code, 403, result.text)
        self.assertEqual(result.json()['code'], 'feature_not_included')
        self.assertEqual(result.json()['details'], {'reason': 'limit', 'limit_key': 'inbox.channels'})
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.channels': used + 1}})
        self.assertEqual(self.api('POST', '/api/v1/inbox/channels', NEW_CHANNEL).status_code, 200)

    def test_connection_test_sets_connected_or_error(self):
        self.login(self.manager)
        path = f'/api/v1/inbox/channels/{self.channel.id}/test'
        with patch.object(requests, 'request', MagicMock(return_value=MagicMock(status_code=200))) as mocked:
            result = self.api('POST', path)
        self.assertEqual((result.json()['state'], result.json()['last_error']), ('connected', None))
        self.assertEqual(mocked.call_args.kwargs['headers'], {'Authorization': f'Bearer {ACCESS_TOKEN}'})
        failing = MagicMock(status_code=401)
        failing.json.return_value = {'error': {'message': 'Invalid OAuth access token'}}
        with patch.object(requests, 'request', MagicMock(return_value=failing)):
            result = self.api('POST', path)
        self.assertEqual((result.json()['state'], result.json()['last_error']), ('error', 'Invalid OAuth access token'))
        self.assertNotIn(ACCESS_TOKEN, result.text)

    def test_template_sync_upserts_and_removes(self):
        stale = self.env['webvue.inbox.template'].create({
            'channel_id': self.channel.id, 'name': 'stale', 'language': 'ar', 'status': 'approved', 'body': 'x',
        })
        remote = [{
            'name': 'order_ready', 'language': 'ar', 'category': 'UTILITY', 'status': 'APPROVED',
            'components': [{'type': 'HEADER', 'text': 'ignored'}, {'type': 'BODY', 'text': 'Hi {{1}}, order {{2}} / {{1}}'}],
        }]
        self.login(self.manager)
        with patch.object(whatsapp, 'list_templates', return_value=remote):
            result = self.api('POST', f'/api/v1/inbox/channels/{self.channel.id}/templates/sync')
        items = result.json()['items']
        self.assertEqual([(t['name'], t['param_count'], t['body']) for t in items], [('order_ready', 2, 'Hi {{1}}, order {{2}} / {{1}}')])
        self.assertFalse(stale.exists())
        with patch.object(whatsapp, 'list_templates', side_effect=whatsapp.ProviderError('rate limited', retryable=True)):
            self.assertError(self.api('POST', f'/api/v1/inbox/channels/{self.channel.id}/templates/sync'), 422, 'invalid')

    def test_the_whatsapp_sub_feature_gates_channel_creation(self):
        set_probe_feature(self, key='inbox.whatsapp', enabled=False)
        self.login(self.manager)
        self.assertEqual(self.api('POST', '/api/v1/inbox/channels', NEW_CHANNEL).status_code, 403)

    def test_encryption_round_trip_and_key_binding(self):
        secret_values = self.env['webvue.inbox.channel']._webvue_secret_values(access_token=APP_SECRET)
        self.assertNotIn(APP_SECRET, secret_values['access_token_enc'])
        with patch.dict('os.environ', {'WEBVUE_INBOX_SECRET_KEY': 'A' * 43 + '='}):
            self.channel.access_token_enc = secret_values['access_token_enc']
            with self.assertRaisesRegex(Exception, 'cannot be decrypted'):
                self.channel._webvue_credentials()
