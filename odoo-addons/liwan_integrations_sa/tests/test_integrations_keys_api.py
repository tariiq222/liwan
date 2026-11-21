# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import (
    ACCESS_TOKEN,
    ACCOUNT_ID,
    APP_SECRET,
    META_BODY,
    LiwanIntegrationsCase,
    extend_registry,
)
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models import secret_box
from odoo.addons.liwan_integrations_sa.providers import errors, meta

BASE = '/api/v1/integrations'
CONNECTION_KEYS = {
    'ref', 'id', 'provider', 'auth', 'external_id', 'label', 'app_id', 'state', 'status_message', 'last_checked',
    'token_expires_at', 'secrets', 'used_by', 'webhooks', 'settings_path',
}
PROVIDER_KEYS = {'code', 'auth', 'secrets', 'generated_secrets', 'attributes', 'uses', 'settings_path'}
GOOD_PROBE = patch.object(meta, 'probe', return_value='Acme Business')


@tagged('post_install', '-at_install', 'liwan')
class TestIntegrationKeysApi(LiwanIntegrationsCase):

    def setUp(self):
        super().setUp()
        self.login(self.admin)

    def connect(self, **body):
        with GOOD_PROBE:
            return self.api('POST', f'{BASE}/connections', {**META_BODY, **body})

    def test_the_providers_are_those_with_an_open_use(self):
        result = self.api('GET', f'{BASE}/providers')
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(body['total'], len(body['items']))
        by_code = {item['code']: item for item in body['items']}
        self.assertLessEqual({'meta', 'tiktok'}, set(by_code))
        self.assertEqual(set(by_code['meta']), PROVIDER_KEYS)
        self.assertEqual(by_code['meta']['secrets'], ['access_token', 'app_secret'])
        self.assertEqual(by_code['meta']['generated_secrets'], ['verify_token'])
        self.assertEqual(by_code['tiktok']['generated_secrets'], [])
        self.assertEqual(by_code['meta']['attributes'], ['app_id'])
        self.assertIn({'key': 'test.meta', 'owner': 'liwan_integrations_sa'}, by_code['meta']['uses'])
        set_probe_feature(self, enabled=False)
        closed = self.api('GET', f'{BASE}/providers').json()['items']
        self.assertFalse({use['key'] for item in closed for use in item['uses']} & {'test.meta', 'test.tiktok'})

    def test_connect_stores_encrypted_secrets_and_answers_the_whitelisted_shape(self):
        result = self.connect(label='Main account')
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        self.assertEqual(set(body), CONNECTION_KEYS)
        self.assertEqual(
            (body['ref'], body['provider'], body['auth'], body['external_id'], body['state'], body['label'], body['app_id']),
            (f'connection:{body["id"]}', 'meta', 'keys', ACCOUNT_ID, 'connected', 'Acme Business', '1122334455'),
        )
        self.assertEqual(
            body['secrets'],
            [{'name': 'access_token', 'present': True}, {'name': 'app_secret', 'present': True}, {'name': 'verify_token', 'present': True}],
        )
        self.assertIn({'use': 'test.meta', 'url': 'https://liwan.test/api/v1/test/hooks/meta'}, body['webhooks'])
        self.assertTrue(all(hook['url'].startswith('https://liwan.test/') for hook in body['webhooks']))
        self.assertNoSecrets(result)
        connection = self.env['liwan.integration.connection'].browse(body['id'])
        self.assertEqual(connection._liwan_secret('access_token'), ACCESS_TOKEN)
        self.assertFalse(any(ACCESS_TOKEN in value for value in connection.secret_ids.mapped('value_enc')))
        self.assertNotIn(connection._liwan_secret('verify_token'), result.text)

    def test_a_refused_key_is_422_integration_rejected_and_stores_nothing(self):
        with patch.object(meta, 'probe', side_effect=errors.ProviderError('Invalid OAuth access token', retryable=False)):
            result = self.api('POST', f'{BASE}/connections', META_BODY)
        self.assertError(result, 422, 'integration_rejected')
        self.assertNoSecrets(result)
        self.assertFalse(self.env['liwan.integration.connection'].search([('external_id', '=', ACCOUNT_ID)]))

    def test_a_bad_body_is_422_invalid_naming_the_field(self):
        cases = (
            ({'provider': 'nobody'}, 'provider'),
            ({'provider': 'tiktok'}, 'provider'),
            ({'extra': 1}, 'extra'),
            ({'external_id': ''}, 'external_id'),
            ({'secrets': {'access_token': ACCESS_TOKEN}}, 'secrets'),
            ({'secrets': {**META_BODY['secrets'], 'other': 'x' * 12}}, 'secrets'),
            ({'secrets': {'access_token': 'short', 'app_secret': APP_SECRET}}, 'secrets'),
            ({'secrets': {'access_token': 'x' * 1025, 'app_secret': APP_SECRET}}, 'secrets'),
            ({'external_id': 'x' * 65}, 'external_id'),
            ({'external_id': '../me'}, 'external_id'),
            ({'external_id': '123?fields=x'}, 'external_id'),
            ({'external_id': '1234'}, 'external_id'),
            ({'secrets': ['x']}, 'secrets'),
        )
        for override, field in cases:
            with self.subTest(field=field, override=override):
                result = self.connect(**override)
                self.assertError(result, 422, 'invalid')
                self.assertEqual(result.json()['field'], field)
        body = {key: value for key, value in META_BODY.items() if key != 'secrets'}
        self.assertError(self.api('POST', f'{BASE}/connections', body), 422, 'invalid')

    def test_the_same_account_cannot_be_connected_twice(self):
        self.assertEqual(self.connect().status_code, 201)
        result = self.connect()
        self.assertError(result, 422, 'invalid')
        self.assertEqual(result.json()['field'], 'external_id')

    def test_patch_edits_the_label_and_app_id_without_probing(self):
        connection = self.make_meta()
        with patch.object(meta, 'probe', side_effect=AssertionError('no probe')):
            result = self.api('PATCH', f'{BASE}/connections/{connection.id}', {'label': 'Renamed', 'app_id': None})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((result.json()['label'], result.json()['app_id']), ('Renamed', None))

    def test_patch_with_new_secrets_probes_and_a_refusal_keeps_the_old_ones(self):
        connection = self.make_meta()
        new_token = 'EAAB-new-token-9876543210'
        with patch.object(meta, 'probe', side_effect=errors.ProviderError('bad', retryable=False)):
            refused = self.api('PATCH', f'{BASE}/connections/{connection.id}', {'secrets': {'access_token': new_token}})
        self.assertError(refused, 422, 'integration_rejected')
        self.assertEqual(connection._liwan_secret('access_token'), ACCESS_TOKEN)
        with GOOD_PROBE as probe:
            accepted = self.api('PATCH', f'{BASE}/connections/{connection.id}', {'secrets': {'access_token': new_token}})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        probe.assert_called_once_with(ACCOUNT_ID, {'access_token': new_token, 'app_secret': APP_SECRET})
        self.assertEqual(connection._liwan_secret('access_token'), new_token)
        self.assertNoSecrets(accepted, new_token)

    def test_patch_disables_and_pending_reprobes(self):
        connection = self.make_meta()
        disabled = self.api('PATCH', f'{BASE}/connections/{connection.id}', {'state': 'disabled'})
        self.assertEqual((disabled.status_code, disabled.json()['state']), (200, 'disabled'))
        with GOOD_PROBE:
            enabled = self.api('PATCH', f'{BASE}/connections/{connection.id}', {'state': 'pending'})
        self.assertEqual((enabled.status_code, enabled.json()['state']), (200, 'connected'))

    def test_a_passing_test_or_new_secrets_leave_a_disabled_connection_disabled(self):
        connection = self.make_meta(state='disabled')
        with GOOD_PROBE:
            tested = self.api('POST', f'{BASE}/connections/{connection.id}/test')
            patched = self.api('PATCH', f'{BASE}/connections/{connection.id}', {'secrets': {'access_token': 'EAAB-new-token-9876543210'}})
        self.assertEqual((tested.status_code, tested.json()['state'], tested.json()['label']), (200, 'disabled', 'Acme Business'))
        self.assertEqual((patched.status_code, patched.json()['state']), (200, 'disabled'))

    def test_patch_refuses_other_states_unknown_fields_and_attributes_the_provider_lacks(self):
        connection = self.make_meta()
        for body, field in (({'state': 'connected'}, 'state'), ({'external_id': '1'}, 'external_id'), ({}, None)):
            with self.subTest(body=body):
                result = self.api('PATCH', f'{BASE}/connections/{connection.id}', body)
                self.assertError(result, 422, 'invalid')
                self.assertEqual(result.json().get('field'), field)

    def test_test_records_the_probe_answer(self):
        connection = self.make_meta(state='pending')
        with patch.object(meta, 'probe', side_effect=errors.ProviderError('Token expired', retryable=False)):
            failed = self.api('POST', f'{BASE}/connections/{connection.id}/test')
        self.assertEqual((failed.status_code, failed.json()['state'], failed.json()['status_message']), (200, 'error', 'Token expired'))
        with GOOD_PROBE:
            passed = self.api('POST', f'{BASE}/connections/{connection.id}/test')
        self.assertEqual((passed.json()['state'], passed.json()['status_message']), ('connected', ''))

    def test_rotate_returns_the_new_value_once_and_only_for_a_generated_secret(self):
        connection = self.make_meta()
        before = connection._liwan_secret('verify_token')
        result = self.api('POST', f'{BASE}/connections/{connection.id}/secrets/verify_token/rotate')
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), {'name', 'value'})
        self.assertEqual((body['name'], body['value']), ('verify_token', connection._liwan_secret('verify_token')))
        self.assertNotEqual(body['value'], before)
        read = self.api('GET', f'{BASE}/connections/{connection.id}')
        self.assertNotIn(body['value'], read.text)
        self.assertNoSecrets(read)
        refused = self.api('POST', f'{BASE}/connections/{connection.id}/secrets/access_token/rotate')
        self.assertError(refused, 422, 'invalid')

    def test_delete_removes_the_connection_and_its_secrets(self):
        connection = self.make_meta()
        secrets = connection.secret_ids
        result = self.api('DELETE', f'{BASE}/connections/{connection.id}')
        self.assertEqual(result.status_code, 204, result.text)
        self.assertFalse(connection.exists())
        self.assertFalse(secrets.exists())
        self.assertError(self.api('GET', f'{BASE}/connections/{connection.id}'), 404, 'not_found')

    def test_delete_is_refused_while_a_use_holds_the_connection(self):
        connection = self.make_meta()
        extend_registry(self, method_overrides={'_liwan_connection_uses': lambda model, row: ('test.meta',)})
        result = self.api('DELETE', f'{BASE}/connections/{connection.id}')
        self.assertError(result, 409, 'in_use')
        self.assertIn('test.meta', result.json()['message'])
        self.assertEqual(result.json()['details'], {'uses': ['test.meta']})
        self.assertTrue(connection.exists())
        read = self.api('GET', f'{BASE}/connections/{connection.id}').json()
        self.assertEqual(read['used_by'], ['test.meta'])

    def test_a_webhook_url_needs_the_public_base_while_providers_list_without_one(self):
        self.env['ir.config_parameter'].sudo().set_param('web.base.url', '')
        connection = self.make_meta()
        self.assertEqual(self.api('GET', f'{BASE}/providers').status_code, 200)
        self.assertError(self.api('GET', f'{BASE}/connections/{connection.id}'), 422, 'invalid')

    def test_the_list_holds_the_current_company_only(self):
        mine = self.make_meta()
        other_company = self.env['res.company'].create({'name': 'Integrations company B'})
        foreign = self.make_meta(external_id='999999999999', company=other_company)
        body = self.api('GET', f'{BASE}/connections').json()
        ids = {item['id'] for item in body['items']}
        self.assertIn(mine.id, ids)
        self.assertNotIn(foreign.id, ids)
        self.assertEqual(body['total'], len(body['items']))
        for method, path, payload in (
            ('GET', f'/connections/{foreign.id}', None),
            ('PATCH', f'/connections/{foreign.id}', {'label': 'x'}),
            ('POST', f'/connections/{foreign.id}/test', None),
            ('POST', f'/connections/{foreign.id}/secrets/verify_token/rotate', None),
            ('DELETE', f'/connections/{foreign.id}', None),
        ):
            with self.subTest(method=method, path=path):
                self.assertError(self.api(method, BASE + path, payload), 404, 'not_found')
        self.assertTrue(foreign.exists())

    def test_every_route_needs_its_capability_and_the_feature(self):
        connection = self.make_meta()
        reads = (
            ('GET', f'{BASE}/providers', None), ('GET', f'{BASE}/connections', None),
            ('GET', f'{BASE}/connections/{connection.id}', None),
        )
        writes = (
            ('POST', f'{BASE}/connections', META_BODY),
            ('PATCH', f'{BASE}/connections/{connection.id}', {'label': 'x'}),
            ('POST', f'{BASE}/connections/{connection.id}/test', None),
            ('POST', f'{BASE}/connections/{connection.id}/secrets/verify_token/rotate', None),
            ('DELETE', f'{BASE}/connections/{connection.id}', None),
            ('POST', f'{BASE}/oauth/tiktok/start', {'uses': ['test.tiktok']}),
        )
        self.authenticate('api_emp', 'api_emp_pass_123')
        for method, path, payload in (*reads, *writes):
            with self.subTest(user='employee', method=method, path=path):
                result = self.api(method, path, payload)
                self.assertEqual(result.status_code, 403, result.text)
                self.assertEqual(result.json()['code'], 'forbidden')
        self.login(self.reader)
        for method, path, payload in reads:
            with self.subTest(user='reader', method=method, path=path):
                self.assertEqual(self.api(method, path, payload).status_code, 200)
        for method, path, payload in writes:
            with self.subTest(user='reader', method=method, path=path):
                self.assertError(self.api(method, path, payload), 403, 'forbidden')
        set_probe_feature(self, key='integrations.enabled', enabled=False)
        self.login(self.admin)
        for method, path, payload in (*reads, *writes):
            with self.subTest(user='feature closed', method=method, path=path):
                self.assertError(self.api(method, path, payload), 403, 'feature_not_included')

    def test_no_answer_carries_a_stored_secret(self):
        connection = self.make_meta()
        paths = (f'{BASE}/providers', f'{BASE}/connections', f'{BASE}/connections/{connection.id}')
        for path in paths:
            response = self.api('GET', path)
            self.assertNoSecrets(response, connection._liwan_secret('verify_token'))
        self.assertNotIn('value_enc', self.api('GET', paths[1]).text)

    def test_stored_values_never_reach_a_secret_box_other_than_the_service_purpose(self):
        connection = self.make_meta()
        stored = connection.secret_ids[:1].value_enc
        with self.assertRaises(UserError):
            secret_box.decrypt(self.env, 'liwan_inbox', stored)
