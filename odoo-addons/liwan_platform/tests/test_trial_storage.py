# Part of Odoo. See LICENSE file for full copyright and licensing details.
from base64 import b64encode
from datetime import datetime, timedelta
from io import BytesIO
from unittest import TestCase

from PIL import Image

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .test_read_only_excess import ExcessCase
from odoo.addons.base.models.assetsbundle import AssetsBundle
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
        baseline = self.service._liwan_count_storage_bytes()
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

    def test_canonical_company_logo_survives_zero_quota_but_private_avatar_does_not(self):
        stream = BytesIO()
        Image.new('RGB', (24, 24), (10, 100, 240)).save(stream, format='PNG')
        logo = b64encode(stream.getvalue())
        company = self.record.root_company_id
        company.write({'logo': logo})
        avatar = self.env['res.partner'].create({'name': 'Personal avatar', 'image_1920': logo})
        Attachment = self.env['ir.attachment']
        backing = Attachment.search([
            ('res_model', '=', 'res.partner'), ('res_field', '=', 'image_1920'),
            ('res_id', '=', company.partner_id.id),
        ])
        personal = Attachment.search([
            ('res_model', '=', 'res.partner'), ('res_field', '=', 'image_1920'),
            ('res_id', '=', avatar.id),
        ])
        self.assertGreater(backing.file_size, 0)
        self.assertGreater(personal.file_size, 0)
        self._set_limit('storage.limit_mb', 0)
        self.assertFalse(backing.liwan_storage_blocked)
        self.assertTrue(personal.liwan_storage_blocked)
        company.invalidate_recordset(['logo'])
        company.partner_id.invalidate_recordset(['image_1920'])
        self.assertTrue(company.logo)
        self.assertTrue(self.service._liwan_excess_is_settled())

    def test_native_language_flags_remain_available_when_storage_is_exhausted(self):
        flags = self.env['ir.attachment'].search([
            ('res_model', '=', 'res.lang'), ('res_field', '=', 'flag_image'), ('file_size', '>', 0),
        ])
        self.assertTrue(flags)
        self._set_limit('storage.limit_mb', 0)
        self.assertFalse(any(flags.mapped('liwan_storage_blocked')))
        languages = self.env['res.lang'].browse(flags.mapped('res_id'))
        languages.invalidate_recordset(['flag_image', 'flag_image_url'])
        self.assertTrue(any(languages.mapped('flag_image_url')))

    def test_native_generated_web_asset_can_be_saved_at_zero_quota(self):
        self._set_limit('storage.limit_mb', 0)
        gross = self.service._liwan_count_storage_bytes()
        asset = AssetsBundle('liwan.storage.fixture', [], env=self.env).save_attachment('css', 'body { color: red; }')
        self.assertEqual(asset.raw, b'body { color: red; }')
        self.assertFalse(asset.liwan_storage_blocked)
        self.assertGreater(self.service._liwan_count_storage_bytes(), gross)
        with self.assertRaises(LiwanAccessRule):
            self.env['ir.attachment'].create({'name': 'root private file', 'raw': b'data'})

    def test_attachment_rejects_direct_storage_fields_and_url_with_existing_bytes(self):
        Attachment = self.env['ir.attachment']
        attachment = Attachment.create({'name': 'content.txt', 'raw': b'first payload', 'mimetype': 'text/plain'})
        with self.assertRaises(ValidationError):
            Attachment.create({'name': 'database input', 'db_datas': b'unsupported'})
        with self.assertRaises(ValidationError):
            Attachment.create({'name': 'noncanonical raw input', 'raw': memoryview(b'unsupported')})
        with self.assertRaises(ValidationError):
            attachment.write({'db_datas': b'unsupported'})
        with self.assertRaises(ValidationError):
            attachment.write({'type': 'url', 'url': 'https://example.test/file'})
        self.assertEqual((attachment.type, attachment.raw, attachment.file_size), ('binary', b'first payload', 13))
        attachment.write({'type': 'url', 'url': 'https://example.test/file', 'raw': False})
        self.assertEqual((attachment.type, attachment.file_size), ('url', 0))
        self.assertFalse(attachment.raw)

    def test_storage_planning_visits_every_batch_and_keeps_total_exact(self):
        Attachment = self.env['ir.attachment']
        files = Attachment.create([
            {'name': f'Batch file {index}', 'raw': b'xx', 'mimetype': 'text/plain'}
            for index in range(260)
        ])
        self._set_limit('storage.limit_mb', 0)
        blocked, _close, _reopen, total = self.service._liwan_storage_plan()
        self.assertTrue(set(files.ids) <= blocked)
        self.assertGreaterEqual(total, 520)
        self.assertTrue(all(files.mapped('liwan_storage_blocked')))
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

    def test_overdue_binary_and_host_reads_share_one_projection_until_metadata_changes(self):
        Attachment = self.env['ir.attachment']
        first, second = Attachment.create([
            {'name': 'cached-1.txt', 'raw': b'first', 'mimetype': 'text/plain'},
            {'name': 'cached-2.txt', 'raw': b'second', 'mimetype': 'text/plain'},
        ])
        self.assertEqual(first.raw, b'first')
        self.assertTrue(second.datas)
        fallback = {**self.record.features, 'storage.limit_mb': 0}
        self._trial(fallback)
        scans = []
        original = type(Attachment).search_fetch

        def track(attachments, domain, field_names, *args, **kwargs):
            if 'liwan_storage_blocked' in field_names and 'file_size' in field_names:
                scans.append(1)
            return original(attachments, domain, field_names, *args, **kwargs)

        self.patch(type(Attachment), 'search_fetch', track)
        self.clock = CUTOFF
        # These reads are pure; an Odoo savepoint rollback would intentionally clear the cursor cache.
        with TestCase.assertRaises(self, LiwanAccessRule):
            first.raw
        batches = len(scans)
        self.assertGreater(batches, 0)
        for row in (first, second):
            for field in ('raw', 'datas'):
                with TestCase.assertRaises(self, LiwanAccessRule):
                    row[field]
        before = self.service._liwan_blocked_storage_bytes()
        self.service._liwan_excess_counts()
        self.assertEqual(len(scans), batches)
        first.unlink()
        self.assertEqual(self.service._liwan_blocked_storage_bytes(), before - len(b'first'))
        self.operator.write({'post_trial_features': {**fallback, 'storage.limit_mb': None}})
        self.assertEqual(second.raw, b'second')
        second.write({'raw': b'new content'})
        self.assertEqual(second.raw, b'new content')

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
