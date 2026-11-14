# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import META_USE, TIKTOK_USE, LiwanIntegrationsCase, extend_registry
from odoo.addons.liwan_api.tests.common import set_probe_feature

EXTERNAL = {
    'code': 'test_external', 'owner': 'liwan_integrations_sa', 'auth': 'external', 'secrets': (),
    'generated_secrets': (), 'attributes': (), 'settings_path': '/settings/apps/test', 'exclusive': False,
}


@tagged('post_install', '-at_install', 'liwan')
class TestIntegrationRegistry(LiwanIntegrationsCase):

    @property
    def integration_registry(self):
        return self.env['liwan.integration.registry']

    def test_the_service_defines_meta_with_keys_and_tiktok_with_oauth(self):
        providers = self.integration_registry._liwan_provider_map()
        self.assertEqual((providers['meta']['auth'], providers['tiktok']['auth']), ('keys', 'oauth'))
        self.assertEqual(providers['meta']['secrets'], ('access_token', 'app_secret'))
        self.assertEqual(providers['meta']['generated_secrets'], ('verify_token',))
        self.assertEqual(providers['meta']['attributes'], ('app_id',))
        self.assertEqual(providers['tiktok']['secrets'], ())

    def test_a_registered_use_is_listed_and_open_only_with_its_feature(self):
        def test_uses(uses):
            return {use['key'] for use in uses if use['key'].startswith('test.')}

        self.assertEqual(test_uses(self.integration_registry._liwan_use_map().values()), {'test.meta', 'test.tiktok'})
        self.assertEqual(test_uses(self.integration_registry._liwan_open_uses()), {'test.meta', 'test.tiktok'})
        set_probe_feature(self, enabled=False)
        self.assertEqual(test_uses(self.integration_registry._liwan_open_uses()), set())

    def assert_invalid_provider(self, definition):
        extend_registry(self, providers=(definition,))
        with self.assertRaises(ValidationError):
            self.integration_registry._liwan_provider_map()

    def test_a_duplicate_provider_code_is_refused(self):
        self.assert_invalid_provider({**EXTERNAL, 'code': 'meta'})

    def test_a_provider_needs_an_owner_and_a_known_auth_type(self):
        self.assert_invalid_provider({**EXTERNAL, 'owner': ''})
        self.assert_invalid_provider({**EXTERNAL, 'auth': 'password'})

    def test_names_must_be_tuples_of_text(self):
        self.assert_invalid_provider({**EXTERNAL, 'secrets': ['access_token']})
        self.assert_invalid_provider({**EXTERNAL, 'attributes': (1,)})

    def test_an_external_provider_names_a_settings_path_and_stores_nothing(self):
        self.assert_invalid_provider({**EXTERNAL, 'settings_path': None})
        self.assert_invalid_provider({**EXTERNAL, 'secrets': ('access_token',)})
        self.assert_invalid_provider({**EXTERNAL, 'auth': 'keys'})

    def test_exclusive_must_be_a_boolean_and_the_service_providers_set_it(self):
        providers = self.integration_registry._liwan_provider_map()
        self.assertEqual((providers['tiktok']['exclusive'], providers['meta']['exclusive']), (True, False))
        self.assert_invalid_provider({k: v for k, v in EXTERNAL.items() if k != 'exclusive'})
        self.assert_invalid_provider({**EXTERNAL, 'exclusive': 'yes'})

    def test_an_oauth_provider_has_no_typed_secrets(self):
        self.assert_invalid_provider({**EXTERNAL, 'auth': 'oauth', 'settings_path': None, 'secrets': ('access_token',)})

    def assert_invalid_use(self, use):
        extend_registry(self, uses=(use,))
        with self.assertRaises(ValidationError):
            self.integration_registry._liwan_use_map()

    def test_a_use_is_validated(self):
        self.assert_invalid_use({**META_USE, 'key': 'test.meta'})
        self.assert_invalid_use({**META_USE, 'key': 'test.other', 'provider': 'nobody'})
        self.assert_invalid_use({**META_USE, 'key': 'test.other', 'owner': ''})
        self.assert_invalid_use({**META_USE, 'key': 'test.other', 'feature_key': 'nothing.enabled'})
        self.assert_invalid_use({**META_USE, 'key': 'test.other', 'scopes': ['read']})
        self.assert_invalid_use({**META_USE, 'key': 'test.other', 'webhook_path': 'no-slash'})
        self.assert_invalid_use({**TIKTOK_USE, 'key': 'test.other', 'feature_key': None})

    def test_the_base_answers_are_neutral(self):
        self.assertEqual(
            self.integration_registry._liwan_external_status('anything', self.env.company),
            {'state': 'not_configured', 'status_message': '', 'last_checked': None},
        )
        connection = self.make_meta()
        self.assertEqual(self.integration_registry._liwan_connection_uses(connection), ())
