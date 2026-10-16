# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

PROBE_APP = 'webvue_probe_app'


@tagged('post_install', '-at_install', 'webvue')
class TestLegacyGrants(TransactionCase):
    """The one-shot legacy grants come from the feature registry: the platform names no application (ruling H.10)."""

    def setUp(self):
        super().setUp()
        registry = type(self.env['webvue.feature.registry'])
        features, modules = registry._webvue_feature_definitions, registry._webvue_module_definitions
        probe = (
            {'key': 'probe_app.enabled', 'type': 'boolean', 'owner': PROBE_APP, 'module': PROBE_APP},
            {'key': 'probe_app.max_items', 'type': 'limit', 'owner': PROBE_APP, 'module': PROBE_APP},
        )
        self.patch(registry, '_webvue_feature_definitions', lambda model: (*features(model), *probe))
        self.patch(registry, '_webvue_module_definitions', lambda model: (*modules(model), {'id': PROBE_APP}))
        self.service = self.env['webvue.entitlement.service'].sudo()

    def test_a_selected_application_gets_every_feature_it_registers(self):
        features = self.service._webvue_legacy_features_for((PROBE_APP,))
        self.assertIs(features['probe_app.enabled'], True)
        self.assertIsNone(features['probe_app.max_items'])
        for key in ('users.limit', 'storage.limit_mb', 'branches.extra_limit'):
            self.assertIsNone(features[key], key)

    def test_an_application_neither_selected_nor_installed_gets_nothing(self):
        features = self.service._webvue_legacy_features_for(())
        self.assertNotIn('probe_app.enabled', features)
        self.assertNotIn('probe_app.max_items', features)

    def test_an_installed_unselected_application_is_withheld(self):
        registry = type(self.env['webvue.feature.registry'])
        installed = registry._webvue_installed_module_ids
        self.patch(registry, '_webvue_installed_module_ids', lambda model: (*installed(model), PROBE_APP))
        features = self.service._webvue_legacy_features_for(())
        self.assertIs(features['probe_app.enabled'], False)
        self.assertIsNone(features['probe_app.max_items'])

    def test_the_allow_list_is_the_registered_module_ids(self):
        profile = self.env.ref('webvue_platform.tenant_profile')
        self.env.cr.execute('UPDATE webvue_tenant_profile SET policy_revision = 0 WHERE id = %s', [profile.id])
        profile.invalidate_recordset()
        with self.assertRaisesRegex(ValidationError, 'webvue_not_registered'):
            profile._webvue_initialize_legacy_policy(('webvue_not_registered',))
        profile._webvue_initialize_legacy_policy((PROBE_APP,))
        self.assertIs(profile.features['probe_app.enabled'], True)
        self.assertIn('probe_app.enabled', profile.retained_read_features)
