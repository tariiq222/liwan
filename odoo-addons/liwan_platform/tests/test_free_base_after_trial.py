# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import (
    OPERATOR_CONTEXT,
    LiwanTenantSuspended,
)

BASE_APP = 'liwan_meetings'
PAID_APP = 'liwan_pmo'
BASE_KEY = 'meetings.enabled'
PAID_KEYS = ('pmo.enabled', 'pmo.change_control', 'pmo.baselines', 'pmo.evm')


@tagged('post_install', '-at_install', 'liwan')
class TestFreeBaseAfterTrial(TransactionCase):
    """A tenant whose paid application was withdrawn stays active on the free base (issue 491).

    The control plane closes the paid keys in the pushed ``features``; ``retained_read_features``
    is derived locally from every key that was ever granted, so the closed application stays
    readable and exportable (read gates) and refuses writes (write gates), while sign-in and
    the base applications are untouched. Only a manual suspension refuses sign-in.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        installed = {
            module.name for module in cls.env['ir.module.module'].sudo().search([
                ('name', 'in', [BASE_APP, PAID_APP]), ('state', '=', 'installed'),
            ])
        }
        if {BASE_APP, PAID_APP} - installed:
            raise unittest.SkipTest(f'needs {BASE_APP} and {PAID_APP} installed')
        cls.service = cls.env['liwan.entitlement.service'].sudo()
        cls.record = cls.env.ref('liwan_platform.tenant_profile')
        cls.record._liwan_initialize_legacy_policy(cls.env['liwan.feature.registry']._liwan_installed_module_ids())
        cls.employee = new_test_user(cls.env, login='free_base_emp', groups='liwan_core.group_employee')

    def _push(self, **changes):
        features = {**self.record.features, **changes}
        self.record.with_context(**{OPERATOR_CONTEXT: True}).write({'features': features})

    def _trial_started(self):
        self._push(**{key: True for key in (BASE_KEY, *PAID_KEYS)})

    def _trial_ended(self):
        self._push(**{key: False for key in PAID_KEYS})

    def test_trial_end_keeps_sign_in_and_the_whole_tenant_active(self):
        self._trial_started()
        self._trial_ended()
        self.assertEqual(self.record.status, 'active')
        self.assertEqual(self.service._liwan_effective_state(), 'active')
        self.assertTrue(self.service._liwan_assert_login_allowed(self.employee))
        self.assertFalse(self.service._liwan_session_forbidden(self.employee))
        self.service._liwan_assert_lifecycle(write=True)

    def test_trial_end_leaves_the_base_application_writable(self):
        self._trial_started()
        self._trial_ended()
        self.service.require(BASE_KEY)
        self.service.require_read(BASE_KEY)
        self.assertIn(BASE_KEY, self.service._liwan_writable_features())

    def test_trial_end_locks_the_paid_application_to_reads_and_exports(self):
        self._trial_started()
        self._trial_ended()
        for key in PAID_KEYS:
            self.assertIn(key, self.record.retained_read_features)
            self.service.require_read(key)
            with self.assertRaises(LiwanAccessRule) as error:
                self.service.require(key)
            self.assertEqual(error.exception.code, 'feature_not_included')
            self.assertEqual(error.exception.status, 403)
            self.assertEqual(error.exception.details, {'reason': 'feature', 'feature': key})

    def test_me_lists_the_locked_application_as_readable_but_not_writable(self):
        self._trial_started()
        self._trial_ended()
        readable = set(self.service._liwan_readable_features())
        writable = set(self.service._liwan_writable_features())
        self.assertEqual(set(PAID_KEYS) & readable, set(PAID_KEYS))
        self.assertFalse(set(PAID_KEYS) & writable)
        self.assertIn(BASE_KEY, writable)

    def test_a_later_push_without_the_paid_keys_open_keeps_them_readable(self):
        self._trial_started()
        self._trial_ended()
        self._push(**{BASE_KEY: True})
        self.service.require_read('pmo.enabled')

    def test_upgrade_after_the_trial_unlocks_writes_again(self):
        self._trial_started()
        self._trial_ended()
        self._push(**{key: True for key in PAID_KEYS})
        for key in PAID_KEYS:
            self.service.require(key)

    def test_only_a_manual_suspension_refuses_sign_in(self):
        self._trial_started()
        self._trial_ended()
        self.record.with_context(**{OPERATOR_CONTEXT: True}).write({'status': 'suspended'})
        with self.assertRaises(LiwanTenantSuspended):
            self.service._liwan_assert_login_allowed(self.employee)
        self.assertTrue(self.service._liwan_session_forbidden(self.employee))
