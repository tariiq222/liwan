# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from psycopg2 import IntegrityError

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'nasq')
class TestCommercialMode(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.env.ref('nasq_platform.tenant_profile')
        cls.employee = new_test_user(cls.env, login='commercial_employee', groups='nasq_core.group_employee')

    def independent(self):
        # Fixture-only conversion; production ORM conversion is deliberately forbidden.
        self.env.cr.execute("""
            UPDATE nasq_tenant_profile SET commercial_mode='non_saas',
                entitlement_source='local_policy', valid_until=NULL WHERE id=%s
        """, [self.profile.id])
        self.profile.invalidate_recordset()
        return self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True})

    def test_classification_pair(self):
        self.assertIn(self.profile.commercial_mode, ('saas', 'non_saas'))
        expected = 'control_plane' if self.profile.commercial_mode == 'saas' else 'local_policy'
        self.assertEqual(self.profile.entitlement_source, expected)

    def test_classification_immutable_even_for_operator(self):
        for values in (
            {'commercial_mode': 'saas'}, {'entitlement_source': 'local_policy'},
            {'commercial_mode': False, 'entitlement_source': False},
        ):
            with self.subTest(values=values), self.assertRaises(AccessError):
                self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write(values)

    def test_forged_context_does_not_grant_source_authority(self):
        with self.assertRaises(AccessError):
            self.profile.with_user(self.employee).with_context(**{OPERATOR_CONTEXT: True})._nasq_require_policy_source('local_policy')

    def test_forged_operator_context_cannot_write_policy(self):
        record = self.profile.with_user(self.employee).with_context(**{OPERATOR_CONTEXT: True})
        for values in (
            {'status': 'suspended'}, {'features': {}}, {'support_access_enabled': True},
            {'policy_revision': 99}, {'valid_until': False}, {'retained_read_features': []},
        ):
            with self.subTest(values=values), self.assertRaises(AccessError):
                record.write(values)
        with self.assertRaises(AccessError):
            self.env['nasq.entitlement.service'].with_user(self.employee).with_context(
                **{OPERATOR_CONTEXT: True},
            )._nasq_assert_operator()

    def test_independent_rejects_commercial_source(self):
        record = self.independent()
        self.assertTrue(record._nasq_require_policy_source('local_policy'))
        for source in ('control_plane', 'unknown', None):
            with self.subTest(source=source), self.assertRaises(AccessError):
                record._nasq_require_policy_source(source)

    def test_independent_rejects_expiry_without_altering_policy(self):
        record = self.independent()
        before = (record.status, record.policy_revision, record.features, record.support_access_enabled)
        with self.assertRaises(ValidationError):
            record.write({'valid_until': date(2020, 1, 1)})
        self.assertFalse(record.valid_until)
        self.assertEqual(before, (record.status, record.policy_revision, record.features, record.support_access_enabled))

    def test_independent_preserves_administrative_suspension(self):
        record = self.independent()
        record.write({'status': 'suspended', 'support_access_enabled': False})
        self.assertEqual(self.env['nasq.entitlement.service']._nasq_effective_state(record), 'suspended')
        self.assertFalse(record.support_access_enabled)

    def test_independent_runtime_uses_persisted_local_policy(self):
        record = self.independent()
        record._nasq_initialize_legacy_policy(
            self.env['nasq.feature.registry']._nasq_installed_module_ids(),
        )
        record.write({'status': 'active', 'support_access_enabled': False})
        service = self.env['nasq.entitlement.service'].with_user(self.employee)
        self.assertEqual(service._nasq_assert_lifecycle(write=True), 'active')
        self.assertTrue(service._nasq_assert_login_allowed(self.employee))
        self.assertFalse(service._nasq_session_forbidden(self.employee))
        self.assertFalse(record.valid_until)

    def test_independent_commercial_source_rejection_preserves_policy(self):
        record = self.independent()
        before = (record.status, record.policy_revision, record.features, record.valid_until)
        with self.assertRaises(AccessError):
            record._nasq_require_policy_source('control_plane')
        self.assertEqual(
            before, (record.status, record.policy_revision, record.features, record.valid_until),
        )

    def test_saas_rejects_local_policy_source_and_preserves_cutoff(self):
        # Fixture-only conversion; same immutable production boundary as independent().
        self.env.cr.execute("""
            UPDATE nasq_tenant_profile SET commercial_mode='saas',
                entitlement_source='control_plane', valid_until='2020-01-01'
            WHERE id=%s
        """, [self.profile.id])
        self.profile.invalidate_recordset()
        record = self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True})
        self.assertTrue(record._nasq_require_policy_source('control_plane'))
        with self.assertRaises(AccessError):
            record._nasq_require_policy_source('local_policy')
        self.assertEqual(record.valid_until, date(2020, 1, 1))
        record.write({'status': 'active'})
        self.assertEqual(self.env['nasq.entitlement.service']._nasq_effective_state(record), 'expired')

    def test_sql_rejects_invalid_pair(self):
        with self.assertRaises(IntegrityError), self.cr.savepoint():
            self.cr.execute("UPDATE nasq_tenant_profile SET commercial_mode='non_saas', entitlement_source='control_plane' WHERE id=%s", [self.profile.id])

    def test_sql_rejects_independent_cutoff(self):
        self.independent()
        with self.assertRaises(IntegrityError), self.cr.savepoint():
            self.cr.execute("UPDATE nasq_tenant_profile SET valid_until='2020-01-01' WHERE id=%s", [self.profile.id])
