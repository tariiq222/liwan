# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta, timezone

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_core.models.access_service import CAPABILITIES, NasqAccessRule
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'nasq')
class TestEntitlements(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.env['nasq.tenant.profile'].sudo()
        cls.service = cls.env['nasq.entitlement.service'].sudo()
        cls.features = cls.env['nasq.feature.registry']
        cls.record = cls.env.ref('nasq_platform.tenant_profile')
        cls.record._nasq_initialize_legacy_policy(
            cls.features._nasq_installed_module_ids(),
        )
        cls.employee = new_test_user(
            cls.env, login='entitlement_emp', groups='nasq_core.group_employee',
        )

    def _operator(self):
        return self.record.with_context(**{OPERATOR_CONTEXT: True})

    def test_legacy_initializer_grants_installed_pillars_once(self):
        self.assertGreaterEqual(self.record.policy_revision, 1)
        self.assertEqual(self.record.status, 'active')
        self.assertFalse(self.record.valid_until)
        self.assertTrue(self.record.features['pmo.enabled'])
        self.assertTrue(self.record.features['meetings.enabled'])
        self.assertTrue(self.record.features['hr.enabled'])
        self.assertTrue(self.record.features['chat.enabled'])
        self.assertIsNone(self.record.features['users.limit'])
        self.assertIsNone(self.record.features['projects.max_projects'])
        self.assertIsNone(self.record.features['storage.limit_mb'])
        self.assertEqual(
            set(self.record.retained_read_features),
            {'pmo.enabled', 'meetings.enabled', 'hr.enabled', 'chat.enabled'},
        )
        first_revision = self.record.policy_revision
        self.record._nasq_initialize_legacy_policy(('nasq_pmo',))
        self.assertEqual(self.record.policy_revision, first_revision)
        self.assertTrue(self.record.features['hr.enabled'])

    def test_customer_cannot_write_policy_fields(self):
        with self.assertRaises(AccessError):
            self.record.with_user(self.employee).write({'status': 'suspended'})
        with self.assertRaises(AccessError):
            self.record.write({'features': dict(self.record.features)})

    def test_unknown_and_invalid_feature_types_are_rejected(self):
        with self.assertRaises(ValidationError):
            self._operator().write({'features': {**self.record.features, 'unknown.enabled': True}})
        with self.assertRaises(ValidationError):
            self._operator().write({'features': {**self.record.features, 'pmo.enabled': 1}})
        with self.assertRaises(ValidationError):
            self._operator().write({'features': {**self.record.features, 'users.limit': -1}})
        with self.assertRaises(ValidationError):
            self._operator().write({'features': {**self.record.features, 'users.limit': True}})

    def test_withdrawn_feature_keeps_retained_read(self):
        self._operator().write({
            'features': {**self.record.features, 'meetings.enabled': False},
        })
        self.assertFalse(self.service.get('meetings.enabled'))
        self.assertIn('meetings.enabled', self.record.retained_read_features)
        self.service.require_read('meetings.enabled')
        with self.assertRaises(NasqAccessRule) as error:
            self.service.require('meetings.enabled')
        self.assertEqual(error.exception.code, 'feature_not_included')
        self.assertEqual(error.exception.status, 403)

    def test_never_entitled_feature_is_not_readable(self):
        self._operator().write({
            'features': {**self.record.features, 'chat.enabled': False},
            'retained_read_features': [
                key for key in self.record.retained_read_features if key != 'chat.enabled'
            ],
        })
        with self.assertRaises(NasqAccessRule):
            self.service.require_read('chat.enabled')

    def test_expiry_clears_writes_but_keeps_reads(self):
        self._operator().write({
            'valid_until': datetime.now(timezone.utc).date() - timedelta(days=1),
        })
        self.assertEqual(self.service._nasq_effective_state(), 'expired')
        self.service.require_read('pmo.enabled')
        with self.assertRaises(NasqAccessRule) as error:
            self.service.require('pmo.enabled')
        self.assertEqual(error.exception.code, 'tenant_read_only')

    def test_xmlid_is_repaired_when_profile_row_survives(self):
        self.env['ir.model.data'].search([
            ('module', '=', 'nasq_platform'), ('name', '=', 'tenant_profile'),
        ]).unlink()
        repaired = self.profile._nasq_ensure_root_company()
        self.assertEqual(repaired, self.record)
        self.assertEqual(self.env.ref('nasq_platform.tenant_profile'), self.record)

    def test_registry_exposes_owned_keys_and_baseline_capabilities(self):
        self.assertEqual(set(self.features._nasq_module_map()), {
            'nasq_pmo', 'nasq_hr', 'nasq_chat',
        })
        self.assertEqual(set(self.features._nasq_boolean_keys()), {
            'pmo.enabled', 'meetings.enabled', 'hr.enabled', 'chat.enabled',
        })
        self.assertEqual(set(self.features._nasq_limit_keys()), {
            'users.limit', 'projects.max_projects', 'storage.limit_mb',
        })
        capability_map = self.env['nasq.access.service']._nasq_capability_map()
        self.assertEqual(set(capability_map), set(CAPABILITIES))
        self.assertEqual(len(capability_map), 28)
        self.assertNotIn('probe.inspect', capability_map)
        self.assertNotIn('probe.enabled', self.features._nasq_feature_map())

    def test_limit_null_is_unlimited_and_zero_is_closed(self):
        self.service.require_within_limit('users.limit', 1000)
        self._operator().write({'features': {**self.record.features, 'users.limit': 0}})
        with self.assertRaises(NasqAccessRule) as error:
            self.service.require_within_limit('users.limit', 1)
        self.assertEqual(error.exception.details['reason'], 'limit')
