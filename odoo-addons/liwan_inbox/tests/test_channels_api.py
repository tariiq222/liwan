# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import MagicMock, patch

import requests

from odoo.tests import tagged

from .common import ACCESS_TOKEN, APP_SECRET, CHANNEL_KEYS, LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.adapters import errors, whatsapp
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

NEW_CHANNEL = {
    'name': 'Branch line', 'kind': 'whatsapp', 'phone_number_id': '300000000001',
    'business_account_id': '400000000001', 'access_token': 'x' * 20, 'app_secret': 'y' * 20,
}


@tagged('post_install', '-at_install', 'liwan')
class TestChannelsApi(LiwanInboxCase):

    def test_the_handshake_token_is_never_read_and_rotates_once(self):
        self.login(self.manager)
        before = self.channel._liwan_verify_token()
        self.assertTrue(before)
        read = self.api('GET', f'/api/v1/inbox/channels/{self.channel.id}')
        self.assertNotIn(before, read.text)
        self.assertTrue(read.json()['has_verify_token'])
        rotated = self.api('POST', f'/api/v1/inbox/channels/{self.channel.id}/verify-token')
        self.assertEqual(rotated.status_code, 200, rotated.text)
        token = rotated.json()['verify_token']
        self.assertNotEqual(token, before)
        self.assertEqual(self.channel._liwan_verify_token(), token)
        # The old token no longer completes the handshake.
        self.assertError(self.verify_token_query(before), 403, 'forbidden')
        self.assertEqual(self.verify_token_query(token).status_code, 200)

    def verify_token_query(self, token):
        return self.get(f'/api/v1/inbox/hooks/whatsapp?hub.mode=subscribe&hub.verify_token={token}&hub.challenge=9')

    def test_the_callback_url_follows_the_pinned_public_origin_not_the_request_host(self):
        # Provisioning pins `web.base.url` to the tenant's public https host.
        self.env['ir.config_parameter'].sudo().set_param('web.base.url', 'https://acme.liwan.example/')
        self.login(self.manager)
        self.assertEqual(
            self.get(f'/api/v1/inbox/channels/{self.channel.id}').json()['callback_url'],
            'https://acme.liwan.example/api/v1/inbox/hooks/whatsapp',
        )
        self.env['ir.config_parameter'].sudo().set_param('web.base.url', 'http://plain.example.test')
        self.assertEqual(
            self.get(f'/api/v1/inbox/channels/{self.channel.id}').json()['callback_url'],
            'https://plain.example.test/api/v1/inbox/hooks/whatsapp',
            'an http origin is offered as https, the way the previous build did',
        )

    def test_a_missing_public_origin_is_a_stated_422_not_a_relative_hook_url(self):
        # Provisioning pins `web.base.url`; a request served before it is set must say so, not hand the
        # administrator a bare `/api/v1/...` path that no provider can call.
        self.login(self.manager)
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('web.base.url', '')
        response = self.get(f'/api/v1/inbox/channels/{self.channel.id}')
        self.assertError(response, 422, 'invalid')
        body = response.json()
        self.assertEqual(body['details']['reason'], 'inbox_public_base_missing')
        self.assertNotIn('/api/v1/inbox/hooks', response.text)

    def test_create_returns_the_shape_without_secrets_and_stores_ciphertext(self):
        self.login(self.manager)
        result = self.api('POST', '/api/v1/inbox/channels', {**NEW_CHANNEL, 'department_id': self.department.id})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), CHANNEL_KEYS)
        self.assertEqual((body['state'], body['has_access_token'], body['has_app_secret']), ('draft', True, True))
        # The hook URL is the public origin provisioning pinned, never this request's own Host: a shared
        # tenant's request Host is its database name and a dedicated install may answer on localhost.
        self.assertEqual(body['callback_url'], 'https://liwan.test/api/v1/inbox/hooks/whatsapp')
        self.assertFalse(body['has_verify_token'])
        self.assertNotIn('x' * 20, result.text)
        self.env.cr.execute('SELECT access_token_enc, app_secret_enc FROM liwan_inbox_channel WHERE id = %s', [body['id']])
        stored = self.env.cr.fetchone()
        self.assertTrue(all(value and 'x' * 20 not in value and 'y' * 20 not in value for value in stored))
        channel = self.env['liwan.inbox.channel'].browse(body['id'])
        self.assertEqual(channel._liwan_credentials().access_token, 'x' * 20)
        self.assertEqual(channel._liwan_app_secret(), 'y' * 20)

    def test_missing_master_key_is_422_and_nothing_is_stored(self):
        self.login(self.manager)
        before = self.env['liwan.inbox.channel'].search_count([])
        with patch.dict('os.environ', {'LIWAN_INBOX_SECRET_KEY': ''}):
            result = self.api('POST', '/api/v1/inbox/channels', NEW_CHANNEL)
        self.assertError(result, 422, 'invalid')
        self.assertIn('not configured', result.json()['message'])
        self.assertEqual(self.env['liwan.inbox.channel'].search_count([]), before)

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
        self.assertEqual(self.reload(self.channel)._liwan_credentials().access_token, 'z' * 20)
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
            self.assertEqual(self.api('POST', path).json()['state'], 'disabled')
        passing = MagicMock(status_code=200)
        passing.json.return_value = {}
        with patch.object(requests, 'request', MagicMock(return_value=passing)):
            self.assertEqual(self.api('POST', path).json()['state'], 'connected')

    def test_a_duplicate_phone_number_id_names_its_reason(self):
        self.login(self.manager)
        result = self.api('POST', '/api/v1/inbox/channels', {**NEW_CHANNEL, 'phone_number_id': self.channel.phone_number_id})
        self.assertEqual(result.json()['details'], {'reason': 'inbox_phone_number_taken'})
        empty = self.make_channel(phone_id='500000000001')
        self.assertEqual(self.api('DELETE', f'/api/v1/inbox/channels/{empty.id}').status_code, 204)
        self.assertFalse(empty.exists())

    def test_the_channel_limit_is_claimed_on_create(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        used = self.env['liwan.entitlement.service']._liwan_count_channels()
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
        healthy = MagicMock(status_code=200)
        healthy.json.return_value = {'display_phone_number': '+966 50 111 2222', 'verified_name': 'Acme'}
        with patch.object(requests, 'request', MagicMock(return_value=healthy)) as mocked:
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
        stale = self.env['liwan.inbox.template'].create({
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
        with patch.object(whatsapp, 'list_templates', side_effect=errors.ProviderError('rate limited', retryable=True)):
            self.assertError(self.api('POST', f'/api/v1/inbox/channels/{self.channel.id}/templates/sync'), 422, 'invalid')

    def test_the_whatsapp_sub_feature_gates_channel_creation(self):
        set_probe_feature(self, key='inbox.whatsapp', enabled=False)
        self.login(self.manager)
        self.assertEqual(self.api('POST', '/api/v1/inbox/channels', NEW_CHANNEL).status_code, 403)

    def test_encryption_round_trip_and_key_binding(self):
        secret_values = self.env['liwan.inbox.channel']._liwan_secret_values(access_token=APP_SECRET)
        self.assertNotIn(APP_SECRET, secret_values['access_token_enc'])
        with patch.dict('os.environ', {'LIWAN_INBOX_SECRET_KEY': 'A' * 43 + '='}):
            self.channel.access_token_enc = secret_values['access_token_enc']
            with self.assertRaisesRegex(Exception, 'cannot be decrypted'):
                self.channel._liwan_credentials()

    def test_a_channels_only_role_reads_a_channel_that_has_a_department(self):
        self.channel.department_id = self.department
        self.login(self._capability_user('inbox_channels_dept_only', 'inbox.channels.manage'))
        listing = self.api('GET', '/api/v1/inbox/channels')
        self.assertEqual(listing.status_code, 200, listing.text)
        detail = self.api('GET', f'/api/v1/inbox/channels/{self.channel.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()['department']['id'], self.department.id)
        self.assertError(self.api('GET', '/api/v1/inbox/departments'), 403, 'forbidden')
