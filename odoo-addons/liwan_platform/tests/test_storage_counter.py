# Part of Odoo. See LICENSE file for full copyright and licensing details.
from io import BytesIO

from PIL import Image
from psycopg2.errors import SerializationFailure

from odoo import SUPERUSER_ID, api
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, tagged
from odoo.tools import SQL, mute_logger

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

MIB = 1048576


@tagged('post_install', '-at_install', 'liwan')
class TestStorageCounter(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.env.ref('liwan_platform.tenant_profile')
        cls.service = cls.env['liwan.entitlement.service'].sudo()
        cls.Attachment = cls.env['ir.attachment']
        cls.service._liwan_recount_storage()

    def _used(self):
        return self.service._liwan_profile().storage_used_bytes

    def _limit_above_usage(self, headroom_mib=1000):
        used = self.service._liwan_count_storage_bytes()
        self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**self.profile.features, 'storage.limit_mb': -(-used // MIB) + headroom_mib},
        })

    def _statements(self, action):
        self.env.flush_all()
        before = self.cr.sql_log_count
        action()
        self.env.flush_all()
        return self.cr.sql_log_count - before

    def _bulk(self, count):
        self.Attachment.create([{'name': f'bulk{index}.txt', 'raw': b'x', 'mimetype': 'text/plain'} for index in range(count)])

    def test_unlink_and_create_cost_does_not_grow_with_attachments(self):
        self._limit_above_usage()
        self._bulk(10)
        small = self.Attachment.create({'name': 'probe.txt', 'raw': b'abc', 'mimetype': 'text/plain'})
        small_create = self._statements(lambda: self.Attachment.create({'name': 'c.txt', 'raw': b'abc', 'mimetype': 'text/plain'}))
        small_unlink = self._statements(small.unlink)
        self._bulk(300)
        large = self.Attachment.create({'name': 'probe.txt', 'raw': b'abc', 'mimetype': 'text/plain'})
        large_create = self._statements(lambda: self.Attachment.create({'name': 'c.txt', 'raw': b'abc', 'mimetype': 'text/plain'}))
        large_unlink = self._statements(large.unlink)
        self.assertEqual(large_create, small_create)
        self.assertEqual(large_unlink, small_unlink)

    def test_total_follows_every_attachment_change(self):
        def assert_exact():
            self.assertEqual(self._used(), self.service._liwan_count_storage_bytes())

        record = self.Attachment.create({'name': 'a.txt', 'raw': b'x' * 100, 'mimetype': 'text/plain'})
        assert_exact()
        record.write({'raw': b'x' * 5000})
        assert_exact()
        record.write({'raw': b'x' * 40})
        assert_exact()
        record.write({'type': 'url', 'raw': False, 'url': 'https://example.test/a'})
        assert_exact()
        record.write({'type': 'binary', 'raw': b'y' * 70})
        assert_exact()
        record.unlink()
        assert_exact()

    def test_total_follows_a_multi_record_write_and_a_copy(self):
        first, second = self.Attachment.create([
            {'name': 'a.txt', 'raw': b'x' * 100, 'mimetype': 'text/plain'},
            {'name': 'b.txt', 'raw': b'y' * 300, 'mimetype': 'text/plain'},
        ])
        (first | second).write({'raw': b'z' * 50})
        self.assertEqual(self._used(), self.service._liwan_count_storage_bytes())
        first.copy()
        self.assertEqual(self._used(), self.service._liwan_count_storage_bytes())
        (first | second).write({'raw': b'z' * 5000})
        self.assertEqual(self._used(), self.service._liwan_count_storage_bytes())

    def test_a_shrunk_image_is_counted_at_its_stored_size(self):
        image = Image.linear_gradient('L').resize((4000, 3000)).convert('RGB')
        buffer = BytesIO()
        image.save(buffer, format='JPEG', quality=95)
        content = buffer.getvalue()
        self._limit_above_usage()
        record = self.Attachment.create({'name': 'big.jpg', 'raw': content, 'mimetype': 'image/jpeg', 'res_model': 'res.partner'})
        self.assertNotEqual(record.file_size, len(content))
        self.assertEqual(self._used(), self.service._liwan_count_storage_bytes())
        record.write({'raw': content})
        self.assertEqual(self._used(), self.service._liwan_count_storage_bytes())

    def test_the_blocked_flag_index_serves_the_orm_predicate(self):
        attachments = self.Attachment.sudo()
        query = attachments._search([('liwan_storage_blocked', '=', True)], limit=1)
        self.env.flush_all()
        self.cr.execute('SET LOCAL enable_seqscan = off')
        self.cr.execute(SQL('EXPLAIN %s', query.select('ir_attachment.id')))
        plan = '\n'.join(row[0] for row in self.cr.fetchall())
        self.assertIn('liwan_storage_blocked_idx', plan)

    def test_a_negative_claim_that_underflows_recounts(self):
        self.Attachment.create({'name': 'a.txt', 'raw': b'x' * 100, 'mimetype': 'text/plain'})
        exact = self.service._liwan_count_storage_bytes()
        self.service._liwan_profile()._liwan_set_storage_used(10)
        with self.assertLogs('odoo.addons.liwan_platform.models.entitlement_service_storage', 'WARNING'):
            self.service._liwan_claim_storage(-50)
        self.assertEqual(self._used(), exact)

    def test_the_total_cannot_be_given_at_creation(self):
        with self.assertRaises(ValidationError):
            self.env['liwan.tenant.profile'].sudo().create({'storage_used_bytes': 5})

    def test_recount_repairs_drift(self):
        self.Attachment.create({'name': 'a.txt', 'raw': b'x' * 100, 'mimetype': 'text/plain'})
        exact = self.service._liwan_count_storage_bytes()
        self.cr.execute('UPDATE liwan_tenant_profile SET storage_used_bytes = 7')
        self.profile.invalidate_recordset()
        self.assertEqual(self.service._liwan_recount_storage(), (7, exact))
        self.assertEqual(self._used(), exact)

    def test_only_the_storage_service_writes_the_total(self):
        with self.assertRaises(AccessError):
            self.profile.sudo().write({'storage_used_bytes': 1})

    def test_a_new_limit_starts_from_an_exact_total(self):
        self.cr.execute('UPDATE liwan_tenant_profile SET storage_used_bytes = 0')
        self.profile.invalidate_recordset()
        self._limit_above_usage()
        self.assertEqual(self._used(), self.service._liwan_count_storage_bytes())

    def test_blocked_attachments_still_trigger_the_full_plan(self):
        record = self.Attachment.create({'name': 'a.txt', 'raw': b'x' * (2 * MIB), 'mimetype': 'text/plain'})
        self._limit_above_usage(headroom_mib=0)
        self.assertFalse(record.liwan_storage_blocked)
        self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**self.profile.features, 'storage.limit_mb': 1},
        })
        self.assertTrue(record.liwan_storage_blocked)
        self.assertGreater(self.service._liwan_blocked_storage_bytes(), 0)
        self._limit_above_usage()
        self.assertFalse(record.liwan_storage_blocked)
        self.assertEqual(self.service._liwan_blocked_storage_bytes(), 0)


@tagged('post_install', '-at_install', 'liwan')
class TestStorageCounterConcurrency(TransactionCase):

    def _set_limit(self, limit_mb):
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
            profile = env.ref('liwan_platform.tenant_profile')
            previous = profile.features.get('storage.limit_mb')
            profile.write({'features': {**profile.features, 'storage.limit_mb': limit_mb}})
            cursor.commit()
            return previous

    def _claim(self, cursor, size):
        env = api.Environment(cursor, SUPERUSER_ID, {})
        env['liwan.entitlement.service']._liwan_claim_storage(size)

    def test_two_claims_that_fit_alone_do_not_fit_together(self):
        if not self.env.cr.dbname.startswith('liwan_scratch_'):
            self.fail('Committed concurrency fixtures require a liwan_scratch_ database.')
        used = self.env['liwan.entitlement.service']._liwan_count_storage_bytes()
        limit_mb = -(-used // MIB) + 2
        size = (limit_mb * MIB - used) // 2 + 1
        previous = self.env.ref('liwan_platform.tenant_profile').features.get('storage.limit_mb')
        try:
            self._set_limit(limit_mb)
            with self.registry.cursor() as stale:
                api.Environment(stale, SUPERUSER_ID, {}).ref('liwan_platform.tenant_profile').storage_used_bytes
                with self.registry.cursor() as first:
                    self._claim(first, size)
                    first.commit()
                with self.assertRaises(SerializationFailure), mute_logger('odoo.sql_db'):
                    self._claim(stale, size)
                stale.rollback()
            with self.registry.cursor() as retry:
                with self.assertRaises(LiwanAccessRule) as caught:
                    self._claim(retry, size)
                self.assertEqual(caught.exception.status, 403)
                retry.rollback()
            with self.registry.cursor() as check:
                env = api.Environment(check, SUPERUSER_ID, {})
                self.assertEqual(env['liwan.entitlement.service']._liwan_profile().storage_used_bytes, used + size)
        finally:
            # Restoring the limit also recounts, so the claimed bytes leave no residue.
            self._set_limit(previous)
