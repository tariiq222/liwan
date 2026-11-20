# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import hashlib
import hmac
from unittest.mock import MagicMock, patch
from urllib.parse import urlsplit

import requests
from urllib3.exceptions import NewConnectionError

from odoo.exceptions import ValidationError
from odoo.tests import new_test_user, tagged

from .common import LiwanIntegrationsCase, extend_registry
from odoo.addons.liwan_integrations_sa.models import connection_callback as callback
from odoo.addons.liwan_integrations_sa.providers import errors, twilio
from odoo.addons.liwan_integrations_sa.providers.twilio import client, signature

BASE = '/api/v1/integrations'
SID = 'AC' + '0123456789abcdef' * 2
OTHER_SID = 'AC' + 'fedcba9876543210' * 2
AUTH_TOKEN = 'twilio-auth-token-0123456789abcdef'
NUMBER = '+15005550006'
VOICE_NUMBER = '+15005550007'
SERVICE = 'MG' + 'a' * 32
NUMBERS = [
    {'value': NUMBER, 'label': '(500) 555-0006', 'sms': True, 'voice': False},
    {'value': VOICE_NUMBER, 'label': '(500) 555-0007', 'sms': False, 'voice': True},
]
SENDER_KEYS = {'id', 'connection_id', 'provider', 'channel', 'kind', 'value', 'is_default', 'active', 'created_at'}
CALLBACK_URL = 'https://liwan.test/api/v1/public/integrations/hooks/twilio/{id}/message-status'


def answer(status, payload):
    response = MagicMock(status_code=status)
    response.json.return_value = payload
    return response


def twilio_http(*responses):
    """Patch every Twilio HTTP call: no test opens a socket to Twilio."""
    return patch.object(client.requests, 'request', side_effect=list(responses))


def sign(url, params, token=AUTH_TOKEN):
    data = url + ''.join(f'{name}{params[name]}' for name in sorted(params))
    return base64.b64encode(hmac.new(token.encode(), data.encode(), hashlib.sha1).digest()).decode()


class FakeLogRow:
    """A log row as the message model of the next part answers a callback lookup."""

    def __init__(self, url):
        self.status_callback_url = url
        self.applied = []

    def _liwan_apply_callback_status(self, kind, params):
        self.applied.append((kind, dict(params)))
        return True


class TwilioCase(LiwanIntegrationsCase):

    def make_twilio(self, external_id=SID, company=None, **values):
        connection = self.env['liwan.integration.connection'].create({
            'company_id': (company or self.env.company).id, 'provider': 'twilio', 'external_id': external_id,
            'state': 'connected', **values,
        })
        connection._liwan_store_secrets({'auth_token': AUTH_TOKEN})
        return connection

    def with_sending_capabilities(self):
        """The messaging and voice capabilities later parts add, declared here with stand-in provider functions."""
        registry = type(self.env['liwan.integration.registry'])
        original = registry._liwan_provider_definitions

        def definitions(model):
            return tuple(
                {**item, 'capabilities': ('senders.list', 'messaging.send', 'voice.call')} if item['code'] == 'twilio' else item
                for item in original(model)
            )
        self.patch(registry, '_liwan_provider_definitions', definitions)
        for name in ('send_message', 'create_call'):
            self.startPatcher(patch.object(twilio, name, lambda *args: None, create=True))
        self.startPatcher(patch.object(twilio, 'list_numbers', return_value=NUMBERS))


@tagged('post_install', '-at_install', 'liwan')
class TestTwilioProvider(TwilioCase):

    def test_twilio_is_a_keys_provider_with_its_auth_token_as_webhook_secret(self):
        provider = self.env['liwan.integration.registry']._liwan_provider_map()['twilio']
        self.assertEqual(
            (provider['auth'], provider['secrets'], provider['webhook_secrets'], provider['generated_secrets'], provider['exclusive']),
            ('keys', ('auth_token',), ('auth_token',), (), False),
        )
        self.assertEqual(provider['capabilities'], ('senders.list', 'messaging.send', 'messaging.status'))
        use = self.env['liwan.integration.registry']._liwan_use_map()['twilio.messaging']
        self.assertEqual((use['provider'], use['feature_key'], use['webhook_path']), ('twilio', 'integrations.enabled', None))

    def test_a_capability_the_module_does_not_implement_fails_the_registry(self):
        extend_registry(self, providers=({
            'code': 'test_caps', 'owner': 'liwan_integrations_sa', 'auth': 'keys', 'secrets': ('key',),
            'generated_secrets': (), 'attributes': (), 'webhook_secrets': (), 'settings_path': None, 'exclusive': False,
            'external_id_pattern': r'\d+', 'capabilities': ('messaging.send',),
        },))
        with self.assertRaises(ValidationError):
            self.env['liwan.integration.registry']._liwan_provider_map()

    def test_an_unknown_capability_fails_the_registry(self):
        registry = type(self.env['liwan.integration.registry'])
        original = registry._liwan_provider_definitions
        self.patch(registry, '_liwan_provider_definitions', lambda model: tuple(
            {**item, 'capabilities': ('fax.send',)} if item['code'] == 'twilio' else item for item in original(model)
        ))
        with self.assertRaises(ValidationError):
            self.env['liwan.integration.registry']._liwan_provider_map()

    def test_probe_reads_the_account_name_with_basic_auth(self):
        with twilio_http(answer(200, {'friendly_name': 'Acme', 'status': 'active'})) as call:
            self.assertEqual(twilio.probe(SID, {'auth_token': AUTH_TOKEN}), 'Acme')
        self.assertEqual(call.call_args.args[:2], ('GET', f'https://api.twilio.com/2010-04-01/Accounts/{SID}.json'))
        self.assertEqual(call.call_args.kwargs['auth'], (SID, AUTH_TOKEN))

    def test_probe_refuses_a_suspended_or_closed_account(self):
        for payload in ({'friendly_name': 'Acme', 'status': 'suspended'}, {'friendly_name': 'Acme', 'status': 'closed'}):
            with self.subTest(status=payload['status']), twilio_http(answer(200, payload)), \
                    self.assertRaises(errors.ProviderError) as raised:
                twilio.probe(SID, {'auth_token': AUTH_TOKEN})
            self.assertIn(payload['status'], str(raised.exception))
        with twilio_http(answer(401, {'code': 20005, 'message': 'Account not active'})), self.assertRaises(errors.ProviderError) as raised:
            twilio.probe(SID, {'auth_token': AUTH_TOKEN})
        self.assertIn('not active', str(raised.exception))

    def test_errors_are_mapped_to_retryable_unconfirmed_or_final(self):
        refused = requests.ConnectionError(NewConnectionError(None, 'refused'))
        cases = (
            (refused, True, False),
            (requests.ConnectTimeout(), True, False),
            (requests.ReadTimeout(), False, True),
            (answer(429, {'code': 20429, 'message': 'Too many requests'}), True, False),
            (answer(503, {}), False, True),
            (answer(401, {'code': 20003, 'message': 'Authenticate'}), False, False),
        )
        for outcome, retryable, unconfirmed in cases:
            with self.subTest(outcome=outcome), twilio_http(outcome), self.assertRaises(errors.ProviderError) as raised:
                client.call('GET', client.account_url(SID), {'auth_token': AUTH_TOKEN}, SID)
            self.assertEqual((raised.exception.retryable, raised.exception.unconfirmed), (retryable, unconfirmed))
            self.assertNotIn(AUTH_TOKEN, str(raised.exception))

    def test_list_numbers_reads_capabilities_and_follows_pages(self):
        first = {'incoming_phone_numbers': [{'phone_number': NUMBER, 'friendly_name': 'a', 'capabilities': {'sms': True, 'voice': False}}],
                 'next_page_uri': f'/2010-04-01/Accounts/{SID}/IncomingPhoneNumbers.json?Page=1'}
        second = {'incoming_phone_numbers': [{'phone_number': VOICE_NUMBER, 'capabilities': {'sms': False, 'voice': True}}], 'next_page_uri': None}
        with twilio_http(answer(200, first), answer(200, second)) as call:
            numbers = twilio.list_numbers(SID, {'auth_token': AUTH_TOKEN})
        self.assertEqual(numbers, [
            {'value': NUMBER, 'label': 'a', 'sms': True, 'voice': False},
            {'value': VOICE_NUMBER, 'label': '', 'sms': False, 'voice': True},
        ])
        self.assertEqual(call.call_count, 2)

    def test_the_signature_is_hmac_sha1_of_the_url_and_sorted_params(self):
        url = 'https://liwan.test/hook?x=1'
        params = {'MessageStatus': 'delivered', 'MessageSid': 'SM1', 'AccountSid': SID}
        expected = sign(url, params)
        self.assertEqual(signature.compute(AUTH_TOKEN, url, params), expected)
        self.assertEqual(signature.compute(AUTH_TOKEN, url, {key: [value] for key, value in params.items()}), expected)
        self.assertTrue(signature.verify(AUTH_TOKEN, url, params, expected))
        self.assertFalse(signature.verify(AUTH_TOKEN, url + '&y=2', params, expected))
        self.assertFalse(signature.verify('another-token-0123456789', url, params, expected))
        self.assertFalse(signature.verify(AUTH_TOKEN, url, params, None))
        self.assertTrue(twilio.verify_callback({'auth_token': AUTH_TOKEN}, url, params, {'x-twilio-signature': expected}))


@tagged('post_install', '-at_install', 'liwan')
class TestTwilioConnectApi(TwilioCase):

    def setUp(self):
        super().setUp()
        self.login(self.admin)

    def connect(self, external_id=SID):
        return self.api('POST', f'{BASE}/connections', {'provider': 'twilio', 'external_id': external_id, 'secrets': {'auth_token': AUTH_TOKEN}})

    def test_twilio_is_offered_and_connects_with_the_account_name(self):
        providers = {item['code']: item for item in self.api('GET', f'{BASE}/providers').json()['items']}
        self.assertEqual(providers['twilio']['secrets'], ['auth_token'])
        with twilio_http(answer(200, {'friendly_name': 'Acme Twilio', 'status': 'active'})):
            result = self.connect()
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        self.assertEqual((body['state'], body['label'], body['webhooks']), ('connected', 'Acme Twilio', []))
        self.assertEqual(body['secrets'], [{'name': 'auth_token', 'present': True}])
        self.assertNotIn(AUTH_TOKEN, result.text)

    def test_a_wrong_token_a_malformed_sid_and_a_suspended_account_are_refused_without_leaking_the_token(self):
        with twilio_http(answer(401, {'code': 20003, 'message': 'Authenticate'})):
            wrong = self.connect()
        self.assertError(wrong, 422, 'integration_rejected')
        self.assertIn('Authenticate', wrong.json()['message'])
        with twilio_http(answer(200, {'friendly_name': 'Acme', 'status': 'suspended'})):
            suspended = self.connect()
        self.assertError(suspended, 422, 'integration_rejected')
        self.assertIn('suspended', suspended.json()['message'])
        with twilio_http():
            malformed = self.connect(external_id='AC123')
        self.assertError(malformed, 422, 'invalid')
        for response in (wrong, suspended, malformed):
            self.assertNotIn(AUTH_TOKEN, response.text)
        self.assertFalse(self.env['liwan.integration.connection'].search([('provider', '=', 'twilio')]))

    def test_a_failed_test_records_a_status_message_without_the_token(self):
        connection = self.make_twilio()
        with twilio_http(answer(401, {'code': 20003, 'message': 'Authenticate'})):
            result = self.api('POST', f'{BASE}/connections/{connection.id}/test')
        self.assertEqual(result.json()['state'], 'error')
        self.assertNotIn(AUTH_TOKEN, connection.status_message or '')
        self.assertNotIn(AUTH_TOKEN, result.text)

    def test_a_missing_declared_secret_is_refused_before_any_call(self):
        connection = self.env['liwan.integration.connection'].create({'provider': 'twilio', 'external_id': SID})
        with twilio_http() as call:
            self.assertFalse(connection._liwan_test())
        call.assert_not_called()
        self.assertIn('auth_token', connection.status_message)


@tagged('post_install', '-at_install', 'liwan')
class TestTwilioSenders(TwilioCase):

    def setUp(self):
        super().setUp()
        self.with_sending_capabilities()
        self.connection = self.make_twilio()
        self.login(self.admin)

    def add(self, **body):
        return self.api('POST', f'{BASE}/senders', {'connection_id': self.connection.id, **body})

    def test_senders_follow_the_channel_rules(self):
        for channel, kind, value in (
            ('sms', 'alphanumeric', 'LIWAN'), ('sms', 'number', NUMBER), ('sms', 'service', SERVICE),
            ('whatsapp', 'number', '+966500000000'), ('whatsapp', 'service', SERVICE), ('voice', 'number', VOICE_NUMBER),
        ):
            with self.subTest(channel=channel, kind=kind):
                result = self.add(channel=channel, kind=kind, value=value)
                self.assertEqual(result.status_code, 201, result.text)
                self.assertEqual(set(result.json()), SENDER_KEYS)
        for channel, kind, value in (
            ('whatsapp', 'alphanumeric', 'LIWAN'), ('voice', 'service', SERVICE), ('sms', 'alphanumeric', 'TWELVECHARSX'),
            ('sms', 'alphanumeric', '12345'), ('sms', 'service', 'MG123'), ('whatsapp', 'number', '0500000000'),
        ):
            with self.subTest(refused=(channel, kind, value)):
                self.assertError(self.add(channel=channel, kind=kind, value=value), 422, 'invalid')

    def test_a_number_not_on_the_account_or_without_the_capability_is_refused(self):
        self.assertError(self.add(channel='sms', kind='number', value='+15005550099'), 422, 'invalid')
        self.assertError(self.add(channel='sms', kind='number', value=VOICE_NUMBER), 422, 'invalid')
        self.assertError(self.add(channel='voice', kind='number', value=NUMBER), 422, 'invalid')

    def test_a_channel_the_provider_does_not_declare_is_refused(self):
        registry = type(self.env['liwan.integration.registry'])
        original = registry._liwan_provider_definitions
        self.patch(registry, '_liwan_provider_definitions', lambda model: tuple(
            {**item, 'capabilities': ('senders.list',)} if item['code'] == 'twilio' else item for item in original(model)
        ))
        self.assertError(self.add(channel='sms', kind='alphanumeric', value='LIWAN'), 422, 'invalid')

    def test_an_active_sender_is_unique_per_channel_and_one_default_per_channel(self):
        first = self.add(channel='sms', kind='alphanumeric', value='LIWAN', is_default=True).json()
        self.assertError(self.add(channel='sms', kind='alphanumeric', value='LIWAN'), 422, 'invalid')
        self.assertEqual(self.add(channel='whatsapp', kind='service', value=SERVICE, is_default=True).status_code, 201)
        second = self.add(channel='sms', kind='service', value=SERVICE, is_default=True).json()
        senders = self.env['liwan.integration.sender'].browse([first['id'], second['id']])
        self.assertEqual(senders.mapped('is_default'), [False, True])
        patched = self.api('PATCH', f'{BASE}/senders/{first["id"]}', {'is_default': True})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(senders.mapped('is_default'), [True, False])
        self.assertError(self.api('PATCH', f'{BASE}/senders/{first["id"]}', {'value': 'OTHER'}), 422, 'invalid')

    def test_delete_archives_and_the_list_filters(self):
        sender = self.add(channel='sms', kind='alphanumeric', value='LIWAN', is_default=True).json()
        self.assertEqual(self.api('DELETE', f'{BASE}/senders/{sender["id"]}').status_code, 204)
        row = self.env['liwan.integration.sender'].with_context(active_test=False).browse(sender['id'])
        self.assertEqual((row.exists().id, row.active, row.is_default), (sender['id'], False, False))
        self.assertEqual(self.api('GET', f'{BASE}/senders').json(), {'items': [], 'total': 0})
        archived = self.api('GET', f'{BASE}/senders?active=false&channel=sms').json()
        self.assertEqual([item['id'] for item in archived['items']], [sender['id']])
        self.assertEqual(self.add(channel='sms', kind='alphanumeric', value='LIWAN').status_code, 201)
        self.assertError(self.api('PATCH', f'{BASE}/senders/{sender["id"]}', {'active': True}), 422, 'invalid')

    def test_the_list_is_newest_first_and_another_company_sees_nothing(self):
        ids = [self.add(channel='sms', kind='alphanumeric', value=value).json()['id'] for value in ('ONE', 'TWO')]
        listed = self.api('GET', f'{BASE}/senders?connection_id={self.connection.id}').json()
        self.assertEqual(([item['id'] for item in listed['items']], listed['total']), (ids[::-1], 2))
        branch = self.env['res.company'].create({'name': 'Twilio branch'})
        other = self.make_twilio(OTHER_SID, company=branch)
        foreign = self.env['liwan.integration.sender'].create({
            'company_id': branch.id, 'connection_id': other.id, 'channel': 'sms', 'kind': 'alphanumeric', 'value': 'OTHER',
        })
        self.assertNotIn(foreign.id, [item['id'] for item in self.api('GET', f'{BASE}/senders').json()['items']])
        self.assertError(self.api('PATCH', f'{BASE}/senders/{foreign.id}', {'active': False}), 404, 'not_found')
        self.assertError(self.add(connection_id=other.id, channel='sms', kind='alphanumeric', value='MINE'), 404, 'not_found')

    def test_available_lists_the_account_numbers_and_needs_manage(self):
        result = self.api('GET', f'{BASE}/senders/available?connection_id={self.connection.id}')
        self.assertEqual(result.json(), {'items': NUMBERS, 'total': 2})
        self.login(self.reader)
        self.assertEqual(self.api('GET', f'{BASE}/senders/available?connection_id={self.connection.id}').status_code, 403)
        self.assertEqual(self.api('GET', f'{BASE}/senders').status_code, 200)

    def test_a_provider_failure_while_listing_answers_502(self):
        with patch.object(twilio, 'list_numbers', side_effect=errors.ProviderError('Authenticate', retryable=False)):
            result = self.api('GET', f'{BASE}/senders/available?connection_id={self.connection.id}')
        self.assertError(result, 502, 'provider_error')

    def test_delete_of_a_connection_with_an_active_sender_answers_in_use_until_it_is_archived(self):
        sender = self.add(channel='sms', kind='alphanumeric', value='LIWAN').json()
        refused = self.api('DELETE', f'{BASE}/connections/{self.connection.id}')
        self.assertError(refused, 409, 'in_use')
        self.assertEqual(refused.json()['details'], {'uses': ['twilio.messaging']})
        self.api('DELETE', f'{BASE}/senders/{sender["id"]}')
        secrets = self.connection.secret_ids
        self.assertEqual(self.api('DELETE', f'{BASE}/connections/{self.connection.id}').status_code, 204)
        self.assertFalse(self.connection.exists() or secrets.exists())
        self.assertFalse(self.env['liwan.integration.sender'].with_context(active_test=False).browse(sender['id']).exists())

    def test_communication_settings_default_then_change(self):
        self.assertEqual(self.api('GET', f'{BASE}/communication-settings').json(), {'daily_message_limit': 1000})
        changed = self.api('PATCH', f'{BASE}/communication-settings', {'daily_message_limit': 250})
        self.assertEqual(changed.json(), {'daily_message_limit': 250})
        for value in (0, 100001, '5', True):
            self.assertError(self.api('PATCH', f'{BASE}/communication-settings', {'daily_message_limit': value}), 422, 'invalid')
        self.login(self.reader)
        self.assertEqual(self.api('GET', f'{BASE}/communication-settings').json(), {'daily_message_limit': 250})
        self.assertEqual(self.api('PATCH', f'{BASE}/communication-settings', {'daily_message_limit': 5}).status_code, 403)


@tagged('post_install', '-at_install', 'liwan')
class TestTwilioCallback(TwilioCase):

    def setUp(self):
        super().setUp()
        self.connection = self.make_twilio()
        self.url = CALLBACK_URL.format(id=self.connection.id)
        self.row = FakeLogRow(self.url)
        self.params = {'MessageSid': 'SM1', 'MessageStatus': 'delivered', 'AccountSid': SID}
        Connection = type(self.env['liwan.integration.connection'])
        self.patch(Connection, '_liwan_callback_record', lambda connection, kind, params: self.row if params.get('MessageSid') in ('SM1', ['SM1']) else None)

    def post(self, params, signature_value, content_type='application/x-www-form-urlencoded', url=None):
        # The path only: `url_open` would request a full URL on the real network. The signature covers the full URL
        # the row (or the caller) stores, not the path the test opens.
        return self.url_open(
            urlsplit(url or self.url).path, data=params,
            headers={'X-Twilio-Signature': signature_value, 'Content-Type': content_type}, method='POST',
        )

    def test_a_signed_callback_applies_as_the_public_user(self):
        response = self.post(self.params, sign(self.url, self.params))
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(self.row.applied, [('message-status', {key: [value] for key, value in self.params.items()})])

    def test_a_wrong_signature_is_403_and_applies_nothing(self):
        response = self.post(self.params, sign(self.url, self.params, token='another-token-0123456789'))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.row.applied, [])

    def test_unknown_connection_kind_or_provider_is_404(self):
        for url in (
            CALLBACK_URL.format(id=self.connection.id + 1000), self.url.replace('message-status', 'fax-status'),
            self.url.replace('/twilio/', '/meta/'),
        ):
            with self.subTest(path=url):
                # An unknown path has no row, so the 404 comes before any signature check: the signature over
                # the URL the request names is still exercised on its own path.
                self.assertEqual(self.post(self.params, sign(url, self.params), url=url).status_code, 404)
        self.connection.state = 'disabled'
        self.assertEqual(self.post(self.params, sign(self.url, self.params)).status_code, 404)
        self.assertEqual(self.row.applied, [])

    def test_an_unknown_record_is_204_and_a_json_body_is_400(self):
        other = {**self.params, 'MessageSid': 'SM2'}
        self.assertEqual(self.post(other, 'anything').status_code, 204)
        self.assertEqual(self.post('{}', 'anything', content_type='application/json').status_code, 400)
        self.assertEqual(self.row.applied, [])

    def test_the_model_method_answers_result_codes_for_a_user_without_any_acl(self):
        nobody = new_test_user(self.env, login='twilio_nobody', groups='base.group_user')
        Connection = self.env(user=nobody)['liwan.integration.connection']
        headers = {'X-Twilio-Signature': sign(self.url, self.params)}
        bad = {'x-twilio-signature': sign(self.url, self.params, token='another-token-0123456789')}
        self.assertEqual(Connection._liwan_apply_callback('twilio', self.connection.id, 'message-status', self.params, bad), callback.FORBIDDEN)
        listed = {key: [value] for key, value in self.params.items()}
        self.assertEqual(Connection._liwan_apply_callback('twilio', self.connection.id, 'message-status', listed, headers), callback.APPLIED)
        self.assertEqual(Connection._liwan_apply_callback('twilio', 0, 'message-status', listed, headers), callback.NOT_FOUND)
        self.assertEqual(Connection._liwan_apply_callback('twilio', self.connection.id, 'message-status', None, headers), callback.INVALID)
