# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest
from datetime import datetime, timedelta

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
CUTOFF = datetime(2026, 10, 1, 12)


class FreeBaseCase(TransactionCase):

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


@tagged('post_install', '-at_install', 'liwan')
class TestFreeBaseAfterWithdrawal(FreeBaseCase):
    """A tenant whose paid application was withdrawn stays active on the free base (issue 491).

    The control plane closes the paid keys in the pushed ``features``; outside a trial,
    ``retained_read_features`` is derived locally from every key that was granted, so the closed
    application stays readable and exportable (read gates) and refuses writes (write gates),
    while sign-in and the base applications are untouched. Only a manual suspension refuses
    sign-in. A key open only during a trial is covered by ``TestTrialOnlyApplications``.
    """

    def _paid_granted(self):
        self._push(**{key: True for key in (BASE_KEY, *PAID_KEYS)})

    def _paid_withdrawn(self):
        self._push(**{key: False for key in PAID_KEYS})

    def test_withdrawal_keeps_sign_in_and_the_whole_tenant_active(self):
        self._paid_granted()
        self._paid_withdrawn()
        self.assertEqual(self.record.status, 'active')
        self.assertEqual(self.service._liwan_effective_state(), 'active')
        self.assertTrue(self.service._liwan_assert_login_allowed(self.employee))
        self.assertFalse(self.service._liwan_session_forbidden(self.employee))
        self.service._liwan_assert_lifecycle(write=True)

    def test_withdrawal_leaves_the_base_application_writable(self):
        self._paid_granted()
        self._paid_withdrawn()
        self.service.require(BASE_KEY)
        self.service.require_read(BASE_KEY)
        self.assertIn(BASE_KEY, self.service._liwan_writable_features())

    def test_withdrawal_locks_the_paid_application_to_reads_and_exports(self):
        self._paid_granted()
        self._paid_withdrawn()
        for key in PAID_KEYS:
            self.assertIn(key, self.record.retained_read_features)
            self.service.require_read(key)
            with self.assertRaises(LiwanAccessRule) as error:
                self.service.require(key)
            self.assertEqual(error.exception.code, 'feature_not_included')
            self.assertEqual(error.exception.status, 403)
            self.assertEqual(error.exception.details, {'reason': 'feature', 'feature': key})

    def test_me_lists_the_locked_application_as_readable_but_not_writable(self):
        self._paid_granted()
        self._paid_withdrawn()
        readable = set(self.service._liwan_readable_features())
        writable = set(self.service._liwan_writable_features())
        self.assertEqual(set(PAID_KEYS) & readable, set(PAID_KEYS))
        self.assertFalse(set(PAID_KEYS) & writable)
        self.assertIn(BASE_KEY, writable)

    def test_a_later_push_without_the_paid_keys_open_keeps_them_readable(self):
        self._paid_granted()
        self._paid_withdrawn()
        self._push(**{BASE_KEY: True})
        self.service.require_read('pmo.enabled')

    def test_upgrade_after_the_withdrawal_unlocks_writes_again(self):
        self._paid_granted()
        self._paid_withdrawn()
        self._push(**{key: True for key in PAID_KEYS})
        for key in PAID_KEYS:
            self.service.require(key)

    def test_only_a_manual_suspension_refuses_sign_in(self):
        self._paid_granted()
        self._paid_withdrawn()
        self.record.with_context(**{OPERATOR_CONTEXT: True}).write({'status': 'suspended'})
        with self.assertRaises(LiwanTenantSuspended):
            self.service._liwan_assert_login_allowed(self.employee)
        self.assertTrue(self.service._liwan_session_forbidden(self.employee))


@tagged('post_install', '-at_install', 'liwan')
class TestTrialOnlyApplications(FreeBaseCase):
    """Owner decision 2026-11-18: only a bought application stays readable after it closes.

    During a trial ``retained_read_features`` takes the open keys of ``post_trial_features``
    (what the customer keeps: plan base and paid lines), never the trial grant itself, so an
    application open only during the trial is neither readable nor writable once it ends.
    """

    def setUp(self):
        super().setUp()
        self.clock = CUTOFF - timedelta(seconds=1)
        self.patch(type(self.service), '_liwan_trial_now', lambda service: self.clock)
        self.operator = self.record.with_context(**{OPERATOR_CONTEXT: True})
        closed = {**self.record.features, BASE_KEY: True, **dict.fromkeys(PAID_KEYS, False)}
        self.operator.write({'features': closed, 'retained_read_features': []})

    def _kept(self, paid=()):
        return {**(self.record.post_trial_features or self.record.features), BASE_KEY: True,
                **{key: key in paid for key in PAID_KEYS}}

    def _trial(self, paid=()):
        kept = self._kept(paid)
        self.operator.write({
            'features': {**self.record.features, BASE_KEY: True, **dict.fromkeys(PAID_KEYS, True)},
            'trial_ends_at': CUTOFF, 'post_trial_features': kept,
            'post_trial_modules': [], 'post_trial_digest': 'b' * 64,
            'commercial_revision_id': 'trial-revision', 'commercial_digest': 'a' * 64,
            'commercial_valid_until_revision': self.record.commercial_valid_until_revision + 1,
        })

    def _end_trial(self):
        self.clock = CUTOFF
        self.assertTrue(self.operator._liwan_apply_post_trial())

    def _assert_closed(self, key):
        with self.assertRaises(LiwanAccessRule):
            self.service.require_read(key)
        with self.assertRaises(LiwanAccessRule):
            self.service.require(key)

    def test_one_trial_write_adds_no_trial_only_key_to_the_retained_list(self):
        self._trial()
        self.assertFalse(set(PAID_KEYS) & set(self.record.retained_read_features))
        for key in PAID_KEYS:
            self.service.require(key)

    def test_trial_only_application_is_closed_once_the_trial_ends(self):
        self._trial()
        self.clock = CUTOFF
        for key in PAID_KEYS:
            self._assert_closed(key)
        self.assertFalse(set(PAID_KEYS) & set(self.service._liwan_readable_features()))
        self._end_trial()
        self.assertFalse(set(PAID_KEYS) & set(self.record.retained_read_features))
        for key in PAID_KEYS:
            self._assert_closed(key)
        self.assertFalse(set(PAID_KEYS) & set(self.service._liwan_readable_features()))

    def test_paid_application_stays_readable_after_a_later_withdrawal(self):
        self._trial(paid=PAID_KEYS)
        self.assertEqual(set(PAID_KEYS) & set(self.record.retained_read_features), set(PAID_KEYS))
        self._end_trial()
        for key in PAID_KEYS:
            self.service.require(key)
        self._push(**dict.fromkeys(PAID_KEYS, False))
        readable = set(self.service._liwan_readable_features())
        writable = set(self.service._liwan_writable_features())
        for key in PAID_KEYS:
            self.service.require_read(key)
            self.assertIn(key, readable)
            self.assertNotIn(key, writable)
            with self.assertRaises(LiwanAccessRule):
                self.service.require(key)

    def test_free_base_kept_after_the_trial_stays_writable(self):
        self._trial()
        self._end_trial()
        self.service.require(BASE_KEY)
        self.assertIn(BASE_KEY, self.service._liwan_writable_features())

    def test_push_after_the_cutoff_before_the_cron_retains_no_trial_only_key(self):
        self._trial()
        self.clock = CUTOFF
        self._push(**dict.fromkeys(PAID_KEYS, True))
        self.assertFalse(set(PAID_KEYS) & set(self.record.retained_read_features))
        self._end_trial()
        for key in PAID_KEYS:
            self._assert_closed(key)

    def test_paid_during_the_trial_then_cancelled_stays_readable(self):
        self._trial()
        self.operator.write({'post_trial_features': self._kept(paid=PAID_KEYS)})
        self.operator.write({'post_trial_features': self._kept()})
        self.assertEqual(set(PAID_KEYS) & set(self.record.retained_read_features), set(PAID_KEYS))
        self._end_trial()
        for key in PAID_KEYS:
            self.service.require_read(key)
            with self.assertRaises(LiwanAccessRule):
                self.service.require(key)

    def test_early_trial_end_with_features_retains_the_granted_keys(self):
        self._trial()
        self.operator.write({
            'features': {**self.record.features, **dict.fromkeys(PAID_KEYS, True)},
            'trial_ends_at': False,
        })
        self.assertFalse(self.record.trial_ends_at)
        self.assertEqual(set(PAID_KEYS) & set(self.record.retained_read_features), set(PAID_KEYS))
        for key in PAID_KEYS:
            self.service.require(key)
