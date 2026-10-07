# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT

LOGGER = 'odoo.addons.nasq_platform.models.tenant_profile'


@tagged('post_install', '-at_install', 'nasq')
class TestFeatureRegistration(TransactionCase):
    """G5: an application installed after the one-shot policy gets its keys, closed."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('nasq_platform.tenant_profile')
        cls.features = cls.env['nasq.feature.registry']
        cls.apps = cls.features._nasq_installed_module_ids()

    def _app(self):
        if not self.apps:
            self.skipTest('needs an installed application')
        return self.apps[0]

    def _initialize(self):
        self.record._nasq_initialize_legacy_policy(self.apps)

    def _grow_registry(self, *extra):
        registry = type(self.features)
        definitions = registry._nasq_feature_definitions
        self.patch(registry, '_nasq_feature_definitions', lambda model: (*definitions(model), *extra))

    def _keys(self, app):
        return (
            {'key': 'zz_probe.enabled', 'type': 'boolean', 'owner': app, 'module': app},
            {'key': 'zz_probe.max_items', 'type': 'limit', 'owner': app, 'module': app},
        )

    def test_installed_application_keys_are_registered_closed_once(self):
        app = self._app()
        self._initialize()
        before = self.record.policy_revision
        retained = list(self.record.retained_read_features)
        self._grow_registry(*self._keys(app))
        self.assertTrue(self.record._nasq_register_missing_features())
        self.assertIs(self.record.features['zz_probe.enabled'], False)
        self.assertEqual(self.record.features['zz_probe.max_items'], 0)
        self.assertIs(type(self.record.features['zz_probe.max_items']), int)
        self.assertEqual(self.record.policy_revision, before + 1)
        self.assertEqual(self.record.retained_read_features, retained)
        self.assertFalse(self.env['nasq.entitlement.service']._nasq_feature_read('zz_probe.enabled'))
        self.assertFalse(self.record._nasq_register_missing_features())
        self.assertEqual(self.record.policy_revision, before + 1)

    def test_registry_load_runs_the_registration(self):
        app = self._app()
        self._initialize()
        self._grow_registry(*self._keys(app))
        self.record._register_hook()
        self.assertIs(self.record.features['zz_probe.enabled'], False)

    def test_an_existing_value_is_never_changed(self):
        app = self._app()
        self._initialize()
        self._grow_registry(*self._keys(app))
        self.record.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**self.record.features, 'zz_probe.enabled': True, 'zz_probe.max_items': 7},
        })
        self.assertFalse(self.record._nasq_register_missing_features())
        self.assertIs(self.record.features['zz_probe.enabled'], True)
        self.assertEqual(self.record.features['zz_probe.max_items'], 7)

    def test_a_policy_it_cannot_complete_is_logged_not_raised(self):
        app = self._app()
        self._initialize()
        before = dict(self.record.features)
        # A new platform key needs its own migration; registration never invents one.
        platform = {'key': 'zz_platform.limit', 'type': 'limit', 'owner': 'nasq_platform', 'module': 'nasq_platform'}
        self._grow_registry(*self._keys(app), platform)
        with self.assertLogs(LOGGER, level='WARNING'):
            self.assertFalse(self.record._nasq_register_missing_features())
        self.assertEqual(dict(self.record.features), before)

    def test_an_uninitialized_tenant_is_left_alone(self):
        if self.record._nasq_policy_initialized(self.record):
            self.skipTest('the tenant policy is already initialized in this database')
        app = self._app()
        self._grow_registry(*self._keys(app))
        self.assertFalse(self.record._nasq_register_missing_features())
        self.assertEqual(self.record.policy_revision, 0)
