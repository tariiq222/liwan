# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.extras import Json

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

LOGGER = 'odoo.addons.liwan_platform.models.tenant_profile'


@tagged('post_install', '-at_install', 'liwan')
class TestFeatureRegistration(TransactionCase):
    """G5: an application installed after the one-shot policy gets its keys, closed."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('liwan_platform.tenant_profile')
        cls.features = cls.env['liwan.feature.registry']
        cls.apps = cls.features._liwan_installed_module_ids()

    def _app(self):
        if not self.apps:
            self.skipTest('needs an installed application')
        return self.apps[0]

    def _initialize(self):
        self.record._liwan_initialize_legacy_policy(self.apps)

    def _grow_registry(self, *extra):
        registry = type(self.features)
        definitions = registry._liwan_feature_definitions
        self.patch(registry, '_liwan_feature_definitions', lambda model: (*definitions(model), *extra))

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
        self.assertTrue(self.record._liwan_register_missing_features())
        self.assertIs(self.record.features['zz_probe.enabled'], False)
        self.assertEqual(self.record.features['zz_probe.max_items'], 0)
        self.assertIs(type(self.record.features['zz_probe.max_items']), int)
        self.assertEqual(self.record.policy_revision, before + 1)
        self.assertEqual(self.record.retained_read_features, retained)
        self.assertFalse(self.env['liwan.entitlement.service']._liwan_feature_read('zz_probe.enabled'))
        self.assertFalse(self.record._liwan_register_missing_features())
        self.assertEqual(self.record.policy_revision, before + 1)

    def test_registry_load_runs_the_registration(self):
        app = self._app()
        self._initialize()
        self._grow_registry(*self._keys(app))
        # A real registry setup: with a ready registry it reinstalls every model hook.
        self.registry._setup_models__(self.env.cr, [])
        self.record.invalidate_recordset()
        self.assertIs(self.record.features['zz_probe.enabled'], False)
        self.assertEqual(self.record.features['zz_probe.max_items'], 0)

    def test_a_failing_fast_path_read_leaves_the_transaction_usable(self):
        self._initialize()

        def broken(model, profile, service):
            model.env.cr.execute('SELECT * FROM liwan_no_such_table')

        self.patch(type(self.record), '_liwan_missing_features', broken)
        with self.assertLogs(LOGGER, level='WARNING'):
            self.assertFalse(self.record._liwan_register_missing_features())
        self.env.cr.execute('SELECT 1')  # the savepoint rolled back, the transaction is not aborted
        self.assertEqual(self.env.cr.fetchone(), (1,))

    def test_an_existing_value_is_never_changed(self):
        app = self._app()
        self._initialize()
        self._grow_registry(*self._keys(app))
        self.record.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**self.record.features, 'zz_probe.enabled': True, 'zz_probe.max_items': 7},
        })
        self.assertFalse(self.record._liwan_register_missing_features())
        self.assertIs(self.record.features['zz_probe.enabled'], True)
        self.assertEqual(self.record.features['zz_probe.max_items'], 7)

    def test_a_policy_it_cannot_complete_is_logged_not_raised(self):
        app = self._app()
        self._initialize()
        before = dict(self.record.features)
        # A new platform key needs its own migration; registration never invents one.
        platform = {'key': 'zz_platform.limit', 'type': 'limit', 'owner': 'liwan_platform', 'module': 'liwan_platform'}
        self._grow_registry(*self._keys(app), platform)
        with self.assertLogs(LOGGER, level='WARNING'):
            self.assertFalse(self.record._liwan_register_missing_features())
        self.assertEqual(dict(self.record.features), before)

    def test_an_uninitialized_tenant_is_left_alone(self):
        if self.record._liwan_policy_initialized(self.record):
            self.skipTest('the tenant policy is already initialized in this database')
        app = self._app()
        self._grow_registry(*self._keys(app))
        self.assertFalse(self.record._liwan_register_missing_features())
        self.assertEqual(self.record.policy_revision, 0)

    def test_nothing_missing_takes_no_lock_and_writes_nothing(self):
        self._initialize()
        self.record._liwan_register_missing_features()
        before = self.record.policy_revision

        def refuse(model):
            message = 'the no-op path must not lock'
            raise AssertionError(message)

        self.patch(type(self.record), '_liwan_lock', refuse)
        self.assertFalse(self.record._liwan_register_missing_features())
        self.assertEqual(self.record.policy_revision, before)

    def test_a_failure_while_writing_is_logged_not_raised(self):
        app = self._app()
        self._initialize()
        before = dict(self.record.features)
        self._grow_registry(*self._keys(app))

        def broken(model, vals):
            message = 'serialization failure'
            raise RuntimeError(message)

        self.patch(type(self.record), 'write', broken)
        with self.assertLogs(LOGGER, level='WARNING'):
            self.assertFalse(self.record._liwan_register_missing_features())
        self.assertEqual(dict(self.record.features), before)

    def test_a_stale_unknown_key_is_logged_not_raised(self):
        app = self._app()
        self._initialize()
        self.env.flush_all()
        stale = {**self.record.features, 'zz_stale.removed': True}
        self.env.cr.execute(
            'UPDATE liwan_tenant_profile SET features = %s WHERE id = %s',
            [Json(stale), self.record.id],
        )
        self.record.invalidate_recordset()
        self._grow_registry(*self._keys(app))
        with self.assertLogs(LOGGER, level='WARNING'):
            self.assertFalse(self.record._liwan_register_missing_features())
        self.assertNotIn('zz_probe.enabled', self.record.features)

    def test_the_public_user_sees_the_same_installed_modules(self):
        """A feature-gated public route (no session) reads the same installed set as a signed-in user."""
        public = self.env.ref('base.public_user')
        self.assertEqual(self.features.with_user(public)._liwan_installed_module_ids(), self.apps)
