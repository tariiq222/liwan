# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .test_read_only_excess import ExcessCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

MIB = 1048576
FILE_BYTES = 2 * MIB
CUTOFF = datetime(2026, 10, 1, 12)
TRIAL_DIGEST = 'a' * 64
FALLBACK_DIGEST = 'b' * 64


@tagged('post_install', '-at_install', 'liwan')
class TestTrialStorage(ExcessCase):

    def _files(self):
        baseline = sum(self.env['ir.attachment'].search([('type', '=', 'binary')]).mapped('file_size'))
        limit = -(-baseline // MIB) + 2
        values = [
            {'name': f'F{index}.txt', 'raw': bytes([65 + index]) * FILE_BYTES, 'mimetype': 'text/plain',
             'public': index == 2}
            for index in range(3)
        ]
        files = self.env['ir.attachment'].create(values)
        self.assertEqual(len(set(files.mapped('create_date'))), 1)
        return limit, files

    def test_storage_retains_the_oldest_prefix_and_checks_warm_binary_access(self):
        limit, (oldest, middle, newest) = self._files()
        self.assertEqual(len(newest.raw), FILE_BYTES)
        self.assertTrue(newest.datas)
        self._set_limit('storage.limit_mb', limit)
        self.assertEqual((oldest.liwan_storage_blocked, middle.liwan_storage_blocked, newest.liwan_storage_blocked),
                         (False, True, True))
        self.assertGreater(self.service._liwan_count_usage('storage.limit_mb'), limit)
        self.assertEqual(self.service._liwan_blocked_storage_bytes(), 2 * FILE_BYTES)
        self.assertEqual(self.service._liwan_excess_counts()['storage.limit_mb'], 4)
        self.assertEqual(newest.read(['name', 'file_size'])[0]['file_size'], FILE_BYTES)
        self.assertTrue(newest.with_context(bin_size=True).datas)
        for field in ('raw', 'datas', 'db_datas'):
            with self.assertRaises(LiwanAccessRule) as caught:
                newest[field]
            self.assertEqual(caught.exception.code, 'storage_excess_blocked')
        with self.assertRaises(LiwanAccessRule):
            self.env['ir.binary']._get_stream_from(newest)
        self.assertTrue(self.service._liwan_excess_is_settled())
        oldest.unlink()
        self.assertFalse(middle.liwan_storage_blocked)
        self.assertTrue(newest.liwan_storage_blocked)
        self._set_limit('storage.limit_mb', limit + 2)
        self.assertEqual(len(newest.raw), FILE_BYTES)
        self.assertTrue(self.service._liwan_excess_is_settled())

    def test_branding_bytes_reserve_capacity_without_being_blocked(self):
        logo = self.env['ir.attachment'].create({
            'name': 'Brand logo', 'raw': b'X' * MIB, 'mimetype': 'text/plain',
            'res_model': 'res.company', 'res_field': 'logo', 'res_id': self.record.root_company_id.id,
        })
        upload = self.env['ir.attachment'].create({'name': 'customer data', 'raw': b'user'})
        self._set_limit('storage.limit_mb', 0)
        self.assertFalse(logo.liwan_storage_blocked)
        self.assertEqual(len(logo.raw), MIB)
        self.assertTrue(upload.liwan_storage_blocked)
        self.assertTrue(self.service._liwan_excess_is_settled())

    def test_storage_proof_checks_flags_before_advertising_settlement(self):
        limit, files = self._files()
        self._set_limit('storage.limit_mb', limit)
        self.assertEqual(self.service._liwan_excess_capabilities(), {'users.limit', 'branches.extra_limit', 'storage.limit_mb'})
        self.service._liwan_apply_flags(files[-1], {'liwan_storage_blocked': False})
        self.assertFalse(self.service._liwan_excess_is_settled())
        self.assertTrue(self.service._liwan_settle_excess())
        self.assertTrue(self.service._liwan_excess_is_settled())


@tagged('post_install', '-at_install', 'liwan')
class TestAutonomousTrialExpiry(ExcessCase):

    def setUp(self):
        super().setUp()
        self.clock = CUTOFF - timedelta(seconds=1)
        self.patch(type(self.service), '_liwan_trial_now', lambda service: self.clock)
        self.operator = self.record.with_context(**{OPERATOR_CONTEXT: True})

    def _trial(self, fallback, **values):
        self.operator.write({
            'trial_ends_at': CUTOFF, 'post_trial_features': fallback,
            'post_trial_modules': [], 'post_trial_digest': FALLBACK_DIGEST,
            'commercial_revision_id': 'initial-trial-revision', 'commercial_digest': TRIAL_DIGEST,
            'commercial_valid_until_revision': 1, **values,
        })

    def test_cutoff_is_effective_before_cron_and_materialization_keeps_live_ai_keys(self):
        live = {**self.record.features, 'ai.balance.granted': 190, 'ai.allowance.trial': 0, 'ai.allowance.monthly': 12}
        fallback = {**live, 'users.limit': 1, 'ai.balance.granted': 7, 'ai.allowance.trial': 7, 'ai.allowance.monthly': 7}
        if 'ai.balance.granted' not in self.service._liwan_registry()._liwan_feature_map():
            self.skipTest('requires the registered AI entitlement addon')
        self._trial(fallback, features=live)
        self.assertEqual(self.service._liwan_features_payload(self.record), live)
        self.clock = CUTOFF
        expected = {**live, 'users.limit': 1}
        self.assertEqual(self.service._liwan_features_payload(self.record), expected)
        self.assertEqual(self.record.features, live)
        self.assertEqual(self.record.commercial_digest, TRIAL_DIGEST)
        self.assertFalse(self.service._liwan_excess_is_settled())
        self.assertTrue(self.operator._liwan_apply_post_trial())
        self.assertEqual(self.record.features, expected)
        self.assertEqual(self.record.commercial_digest, FALLBACK_DIGEST)
        self.assertEqual(self.record.commercial_revision_id, 'initial-trial-revision')
        self.assertFalse(self.record.trial_ends_at)
        self.assertFalse(self.operator._liwan_apply_post_trial())

    def test_cronless_storage_and_account_limits_refuse_before_materialization(self):
        employee = new_test_user(self.env, login='expiring_employee', groups='liwan_core.group_employee')
        attachment = self._write_as(employee)
        self.assertEqual(attachment.raw, b'x' * 10)
        fallback = {**self.record.features, 'users.limit': 0, 'storage.limit_mb': 0}
        self._trial(fallback)
        self.clock = CUTOFF
        self.assertFalse(employee.liwan_read_only)
        with self.assertRaises(LiwanAccessRule) as caught:
            attachment.with_user(employee).write({'name': 'denied.txt'})
        self.assertEqual(caught.exception.code, 'user_read_only')
        with self.assertRaises(LiwanAccessRule) as caught:
            attachment.raw
        self.assertEqual(caught.exception.code, 'storage_excess_blocked')
        self.assertEqual(self.record.trial_ends_at, CUTOFF)

    def test_cronless_branch_write_obeys_fallback_before_flags_are_materialized(self):
        company_id = self.operator._liwan_apply_branches(
            'trial-branch', 'trial-target', [{'branch_id': 'trial-branch', 'name': 'Trial Branch'}],
        )[0]['odoo_company_id']
        company = self.env['res.company'].browse(company_id)
        manager = new_test_user(self.env, login='trial_branch_manager', groups='base.group_system')
        branch_contact = self.env['res.partner'].create({'name': 'Branch contact', 'company_id': company_id})
        self._trial({**self.record.features, 'branches.extra_limit': 0})
        self.clock = CUTOFF
        self.assertFalse(company.liwan_read_only)
        with self.assertRaises(LiwanAccessRule) as caught:
            branch_contact.with_user(manager).sudo().write({'name': 'denied'})
        self.assertEqual(caught.exception.code, 'branch_read_only')
        self.assertEqual(self.record.trial_ends_at, CUTOFF)

    def test_same_revision_cannot_reopen_expired_trial_but_authorized_new_target_can(self):
        fallback = {**self.record.features, 'storage.limit_mb': 0}
        self._trial(fallback)
        self.operator.write({'trial_ends_at': CUTOFF + timedelta(seconds=1), 'commercial_valid_until_revision': 2})
        self.clock = CUTOFF + timedelta(seconds=1)
        with self.assertRaises(ValidationError):
            self.operator.write({'trial_ends_at': CUTOFF + timedelta(days=1), 'commercial_valid_until_revision': 3})
        self.assertTrue(self.operator._liwan_apply_post_trial())
        with self.assertRaises(ValidationError):
            self.operator.write({'trial_ends_at': CUTOFF + timedelta(days=1), 'post_trial_features': fallback,
                                 'post_trial_modules': [], 'post_trial_digest': FALLBACK_DIGEST,
                                 'commercial_valid_until_revision': 3})
        self._trial(fallback, trial_ends_at=CUTOFF + timedelta(days=1), commercial_revision_id='authorized-reopen',
                    commercial_valid_until_revision=3, features={**fallback, 'storage.limit_mb': 100})
        self.assertEqual(self.service._liwan_limit_value('storage.limit_mb'), 100)

    def test_trial_cron_applies_the_fallback_without_lifting_manual_suspension(self):
        self._trial({**self.record.features, 'storage.limit_mb': 0}, status='suspended')
        self.clock = CUTOFF
        cron = self.env.ref('liwan_platform.ir_cron_apply_post_trial')
        self.assertEqual((cron.interval_number, cron.interval_type, cron.user_id), (5, 'minutes', self.env.ref('base.user_root')))
        self.env['liwan.tenant.profile'].with_user(cron.user_id)._liwan_cron_apply_post_trial()
        self.assertEqual(self.record.status, 'suspended')
        self.assertFalse(self.record.trial_ends_at)
        self.assertEqual(self.record.features['storage.limit_mb'], 0)

    def test_trial_tuple_requires_authority_and_preserves_legacy_expiry_outside_trials(self):
        with self.assertRaises(AccessError) as caught:
            self.record.write({'trial_ends_at': CUTOFF})
        self.assertIn('trusted operator', str(caught.exception))
        with self.assertRaises(ValidationError):
            self.operator.write({'trial_ends_at': CUTOFF, 'post_trial_digest': FALLBACK_DIGEST})
        self.operator.write({'commercial_valid_until': fields.Date.to_date('2000-01-01')})
        self.assertEqual(self.service._liwan_effective_state(self.record), 'expired')
        self._trial(self.record.features)
        self.assertEqual(self.service._liwan_effective_state(self.record), 'active')
