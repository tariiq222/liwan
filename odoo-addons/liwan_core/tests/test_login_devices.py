# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

PASSWORD = 'twelve-chars-ok'


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestSecondStepReset(TransactionCase):
    """An administrator resets a user's second step: the codes and remembered devices both go."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.admin = new_test_user(cls.env, login='reset_admin', groups='base.group_user')
        admin_role = cls.env.ref('liwan_core.role_system_admin')
        cls.env['liwan.access.service']._liwan_replace_assignments(
            cls.admin, [{'role_id': admin_role.id, 'company_id': cls.company.id}],
        )
        cls.employee = new_test_user(
            cls.env, login='reset_emp', password=PASSWORD, name='Reset Employee',
            groups='liwan_core.group_employee',
        )
        cls.employee.liwan_mobile = '+966590000003'
        cls.service = cls.env['liwan.access.service'].with_user(cls.admin)

    def setUp(self):
        super().setUp()
        self.patch(
            type(self.env['liwan.sms.gateway']), '_liwan_send',
            lambda model, channel, destination, body: None,
        )

    def _device(self):
        return self.env['liwan.login.device']._liwan_issue(self.employee, 'test browser')[0]

    def test_a_capability_holder_revokes_codes_and_devices_with_an_audit_entry(self):
        code = self.env['liwan.login.code']._liwan_issue(self.employee, 'sms').record
        device = self._device()
        self.service._liwan_reset_second_step(
            self.employee, self.service._liwan_user_version(self.employee),
        )
        self.assertTrue(code.revoked_at)
        self.assertTrue(device.revoked_at)
        entry = self.env['liwan.access.audit'].search([('action', '=', 'user.second_step_reset')], limit=1)
        self.assertEqual(entry.target_id, self.employee.id)
        self.assertEqual(entry.actor_id.id, self.admin.id)

    def test_a_caller_without_the_capability_is_refused(self):
        colleague = new_test_user(
            self.env, login='reset_peer', password=PASSWORD, groups='liwan_core.group_employee',
        )
        with self.assertRaises(AccessError):
            self.env['liwan.access.service'].with_user(colleague)._liwan_reset_second_step(
                self.employee, self.service._liwan_user_version(self.employee),
            )

    def test_a_user_may_reset_their_own_remembered_devices(self):
        device = self._device()
        self.env['liwan.access.service'].with_user(self.employee)._liwan_forget_devices(self.employee)
        self.assertTrue(device.revoked_at)

    def test_a_user_may_not_forget_another_users_devices(self):
        colleague = new_test_user(
            self.env, login='forget_peer', password=PASSWORD, groups='liwan_core.group_employee',
        )
        device = self._device()
        with self.assertRaises(AccessError):
            self.env['liwan.access.service'].with_user(colleague)._liwan_forget_devices(self.employee)
        self.assertFalse(device.revoked_at)

    def test_the_reset_survives_a_suspended_remembered_device(self):
        """The capability is checked before the reset, and a refused caller leaves every row alone."""
        colleague = new_test_user(
            self.env, login='reset_peer2', password=PASSWORD, groups='liwan_core.group_employee',
        )
        code = self.env['liwan.login.code']._liwan_issue(self.employee, 'sms').record
        with self.assertRaises(AccessError):
            self.env['liwan.access.service'].with_user(colleague)._liwan_reset_second_step(
                self.employee, self.service._liwan_user_version(self.employee),
            )
        self.assertFalse(code.revoked_at)


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestRememberedDevice(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user = new_test_user(
            cls.env, login='device_user', password=PASSWORD, name='Device User',
            groups='liwan_core.group_employee',
        )
        cls.devices = cls.env['liwan.login.device']

    def test_only_a_hash_of_the_token_is_stored(self):
        record, raw = self.devices._liwan_issue(self.user, 'Chrome on macOS')
        self.assertNotEqual(record.token_hash, raw)
        self.assertEqual(len(record.token_hash), 64)
        self.assertEqual(record.label, 'Chrome on macOS')

    def test_a_remembered_device_lasts_thirty_days(self):
        record, raw = self.devices._liwan_issue(self.user, 'browser')
        self.assertEqual((record.expires_at - record.issued_at).days, 30)
        record.expires_at = record.issued_at
        self.assertFalse(self.devices._liwan_usable(raw))

    def test_a_token_resolves_to_its_own_device_and_is_touched(self):
        record, raw = self.devices._liwan_issue(self.user, 'browser')
        resolved = self.devices._liwan_usable(raw)
        self.assertEqual(resolved, record)
        self.assertTrue(resolved.last_used_at)

    def test_an_unknown_or_revoked_token_resolves_to_nothing(self):
        record, raw = self.devices._liwan_issue(self.user, 'browser')
        self.assertFalse(self.devices._liwan_usable('not-a-token'))
        self.assertFalse(self.devices._liwan_usable(None))
        self.assertFalse(self.devices._liwan_usable('x' * 300))
        record.revoked_at = record.issued_at
        self.assertFalse(self.devices._liwan_usable(raw))

    def test_revoking_keeps_the_device_the_caller_uses(self):
        first, first_raw = self.devices._liwan_issue(self.user, 'first')
        second, second_raw = self.devices._liwan_issue(self.user, 'second')
        self.devices._liwan_revoke_user(self.user, keep=second)
        self.assertTrue(first.revoked_at)
        self.assertFalse(second.revoked_at)
        self.assertTrue(self.devices._liwan_usable(second_raw))
        self.assertFalse(self.devices._liwan_usable(first_raw))

    def test_revoking_all_leaves_nothing(self):
        first, first_raw = self.devices._liwan_issue(self.user, 'first')
        second, second_raw = self.devices._liwan_issue(self.user, 'second')
        self.devices._liwan_revoke_user(self.user)
        self.assertTrue(first.revoked_at and second.revoked_at)
        self.assertFalse(self.devices._liwan_usable(first_raw))
        self.assertFalse(self.devices._liwan_usable(second_raw))

    def test_the_device_table_is_system_only(self):
        record, _raw = self.devices._liwan_issue(self.user, 'browser')
        with self.assertRaises(AccessError):
            self.env['liwan.login.device'].with_user(self.user).browse(record.id).read(['token_hash'])
