# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanIntegrationsCase, extend_registry
from odoo.addons.liwan_api.tests.common import PROBE_FEATURE, set_probe_feature

BASE = '/api/v1/integrations'
EXTERNAL = {
    'code': 'test_external', 'owner': 'liwan_integrations_sa', 'auth': 'external', 'secrets': (),
    'generated_secrets': (), 'attributes': (), 'settings_path': '/settings/apps/test', 'exclusive': False,
}
EXTERNAL_USE = {
    'key': 'test.external', 'provider': 'test_external', 'owner': 'liwan_integrations_sa', 'feature_key': PROBE_FEATURE,
    'scopes': (), 'webhook_path': None,
}
CONNECTION_KEYS = {
    'ref', 'id', 'provider', 'auth', 'external_id', 'label', 'app_id', 'state', 'status_message', 'last_checked',
    'token_expires_at', 'secrets', 'used_by', 'webhooks', 'settings_path',
}


@tagged('post_install', '-at_install', 'liwan')
class TestExternalProvider(LiwanIntegrationsCase):
    """An external provider has no stored row: its owner derives the status and the service shows it."""

    def setUp(self):
        super().setUp()
        self.statuses = {'state': 'pending', 'status_message': '1 of 2 done', 'last_checked': None}

        def status(model, code, company):
            return self.statuses if code == 'test_external' else {'state': 'not_configured', 'status_message': '', 'last_checked': None}

        extend_registry(self, providers=(EXTERNAL,), uses=(EXTERNAL_USE,), method_overrides={'_liwan_external_status': status})
        self.login(self.admin)

    def external(self):
        items = self.api('GET', f'{BASE}/connections').json()['items']
        return next(item for item in items if item['provider'] == 'test_external')

    def test_the_list_shows_the_derived_status_of_an_external_provider(self):
        item = self.external()
        self.assertEqual(set(item), CONNECTION_KEYS)
        self.assertEqual(
            (item['ref'], item['id'], item['auth'], item['state'], item['status_message'], item['settings_path']),
            ('external:test_external', None, 'external', 'pending', '1 of 2 done', '/settings/apps/test'),
        )
        self.assertEqual(
            (item['external_id'], item['app_id'], item['secrets'], item['webhooks'], item['used_by']),
            (None, None, [], [], ['test.external']),
        )
        self.statuses['state'] = 'connected'
        self.assertEqual(self.external()['state'], 'connected')

    def test_no_row_is_stored_for_it_and_it_cannot_be_connected_by_keys(self):
        self.external()
        self.assertFalse(self.env['liwan.integration.connection'].search([('provider', '=', 'test_external')]))
        body = {'provider': 'test_external', 'external_id': '1', 'secrets': {'access_token': 'x' * 12}}
        result = self.api('POST', f'{BASE}/connections', body)
        self.assertEqual((result.status_code, result.json()['field']), (422, 'provider'))
        providers = {item['code']: item for item in self.api('GET', f'{BASE}/providers').json()['items']}
        self.assertEqual(providers['test_external']['settings_path'], '/settings/apps/test')

    def test_it_is_offered_only_while_a_use_is_open(self):
        set_probe_feature(self, enabled=False)
        items = self.api('GET', f'{BASE}/connections').json()['items']
        self.assertNotIn('test_external', {item['provider'] for item in items})
