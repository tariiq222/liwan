# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The storage quota with attachment contents in an OCA ``fs_attachment`` backend.

The count sums ``ir_attachment.file_size`` and never reads ``store_fname``, so it does not depend on the fsspec
protocol. These tests use a temporary ``file`` storage: no S3 stand-in exists here, and the quota path is the same for
every protocol.

The 80% and 95% warnings live in ``liwan_notify`` (rank 3), which a ``liwan_platform`` test cannot import under R4:
the extension point the platform owns is checked here, the warnings themselves in ``liwan_notify``.
"""
import os
import shutil
import tempfile
from io import BytesIO

from PIL import Image

from odoo.tests import tagged

from .test_read_only_excess import ExcessCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

MIB = 1048576
STORAGE_CODE = 'liwan_test_fs'


@tagged('post_install', '-at_install', 'liwan')
class TestStorageCounterFs(ExcessCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Attachment = cls.env['ir.attachment']

    def setUp(self):
        super().setUp()
        self.temp_dir = tempfile.mkdtemp(prefix='liwan_fs_storage_')
        self.addCleanup(shutil.rmtree, self.temp_dir, ignore_errors=True)
        # fs_attachment caches the storage codes and the default code on the registry. Drop the cache on the way in and
        # on the way out, so a rolled-back test leaves no code behind for the next one.
        self.env.registry.clear_cache()
        self.storage = self.env['fs.storage'].create({
            'name': 'LiwanOS temporary attachment storage',
            'code': STORAGE_CODE,
            'protocol': 'file',
            'directory_path': self.temp_dir,
            'use_as_default_for_attachments': True,
        })
        self.addCleanup(self.env.registry.clear_cache)

    def _content(self, size):
        return os.urandom(size)

    def _create(self, size, name='file.txt'):
        return self.Attachment.create({'name': name, 'raw': self._content(size), 'mimetype': 'text/plain'})

    def _object_path(self, attachment):
        return os.path.join(self.temp_dir, attachment.store_fname.split('://', 1)[1])

    def _storage_files(self):
        """Every file under the temporary storage directory, as relative paths."""
        return {
            os.path.relpath(os.path.join(root, name), self.temp_dir)
            for root, _dirs, names in os.walk(self.temp_dir)
            for name in names
        }

    def _filestore_path(self, attachment):
        return os.path.join(self.Attachment._filestore(), attachment.checksum[:2], attachment.checksum)

    def _assert_stored_in_the_storage(self, attachment):
        """The content went to the fs storage: no filestore file and a real object under the temporary directory."""
        self.assertEqual(attachment.type, 'binary')
        self.assertTrue(attachment.store_fname.startswith(f'{STORAGE_CODE}://'), attachment.store_fname)
        self.assertTrue(os.path.isfile(self._object_path(attachment)))
        self.assertFalse(os.path.exists(self._filestore_path(attachment)))

    def _assert_refused(self, call):
        with self.assertRaises(LiwanAccessRule) as caught:
            call()
        self.assertEqual(caught.exception.code, 'feature_not_included')
        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(caught.exception.details['limit_key'], 'storage.limit_mb')

    def test_the_count_sums_content_stored_in_the_storage(self):
        baseline = self.service._liwan_recount_storage()[1]
        sizes = (97, 311, 1021)
        attachments = self.Attachment.create([
            {'name': f'stored-{index}.txt', 'raw': self._content(size), 'mimetype': 'text/plain'}
            for index, size in enumerate(sizes)
        ])
        for attachment in attachments:
            self._assert_stored_in_the_storage(attachment)
            self.assertEqual(attachment.file_size, len(attachment.raw))
        self.assertEqual(self.service._liwan_count_storage_bytes(), baseline + sum(sizes))
        self.assertEqual(self.service._liwan_recount_storage(), (baseline + sum(sizes), baseline + sum(sizes)))

    def test_create_over_the_limit_is_refused_and_writes_no_object(self):
        baseline = self.service._liwan_recount_storage()[1]
        self._set_limit('storage.limit_mb', baseline // MIB)
        self.assertEqual(self.Attachment._storage(), STORAGE_CODE)
        files_before = self._storage_files()
        self._assert_refused(lambda: self.Attachment.create(
            {'name': 'refused.txt', 'raw': self._content(4096), 'mimetype': 'text/plain'},
        ))
        # The claim runs before super().create(), so the object is never written and nothing is left behind.
        self.assertEqual(self._storage_files(), files_before)
        self.assertEqual(self.service._liwan_count_storage_bytes(), baseline)

    def test_write_growth_is_claimed_like_the_filestore(self):
        baseline = self.service._liwan_recount_storage()[1]
        attachment = self._create(200)
        self._assert_stored_in_the_storage(attachment)
        attachment.write({'raw': self._content(5000), 'mimetype': 'text/plain'})
        self._assert_stored_in_the_storage(attachment)
        self.assertEqual(attachment.file_size, 5000)
        self.assertEqual(self.service._liwan_count_storage_bytes(), baseline + 5000)
        used = self.service._liwan_count_storage_bytes()
        self._set_limit('storage.limit_mb', used // MIB)
        files_before = self._storage_files()
        self._assert_refused(lambda: attachment.write({'raw': self._content(6000), 'mimetype': 'text/plain'}))
        # The refused growth left the attachment and the storage as they were.
        self.assertEqual(attachment.file_size, 5000)
        self.assertEqual(len(attachment.raw), 5000)
        self.assertEqual(self._storage_files(), files_before)
        self.assertEqual(self.service._liwan_count_storage_bytes(), used)

    def test_unlink_releases_the_storage_bytes(self):
        baseline = self.service._liwan_recount_storage()[1]
        attachments = self.Attachment.create([
            {'name': f'removed-{index}.txt', 'raw': self._content(size), 'mimetype': 'text/plain'}
            for index, size in enumerate((100, 300, 700))
        ])
        for attachment in attachments:
            self._assert_stored_in_the_storage(attachment)
        total = sum(attachments.mapped('file_size'))
        self.assertEqual(self.service._liwan_count_storage_bytes(), baseline + total)
        attachments.unlink()
        self.assertEqual(self.service._liwan_count_storage_bytes(), baseline)
        self.assertEqual(self.service._liwan_recount_storage(), (baseline, baseline))

    def test_a_claim_through_the_storage_reports_the_usage_the_warnings_need(self):
        baseline = self.service._liwan_recount_storage()[1]
        limit_mb = -(-baseline // MIB) + 100
        self._set_limit('storage.limit_mb', limit_mb)
        calls = []
        self.patch(
            type(self.service), '_liwan_storage_claimed',
            lambda model, used_before, used_after, limit_bytes: calls.append((used_before, used_after, limit_bytes)),
        )
        attachment = self._create(777)
        self._assert_stored_in_the_storage(attachment)
        self.assertEqual(calls, [(baseline, baseline + 777, limit_mb * MIB)])

    def test_a_small_image_kept_in_the_database_is_still_counted(self):
        baseline = self.service._liwan_recount_storage()[1]
        buffer = BytesIO()
        Image.new('RGB', (4, 4), (10, 100, 240)).save(buffer, format='PNG')
        content = buffer.getvalue()
        self.assertLessEqual(len(content), 50 * 1024)
        attachment = self.Attachment.create({'name': 'tiny.png', 'raw': content, 'mimetype': 'image/png'})
        # The storage's default rule keeps images under 50 KiB in the database; the count reads file_size only.
        self.assertFalse(attachment.store_fname)
        self.assertTrue(attachment.db_datas)
        self.assertEqual(attachment.file_size, len(content))
        self.assertEqual(self.service._liwan_count_storage_bytes(), baseline + len(content))
        self.assertEqual(self.service._liwan_recount_storage(), (baseline + len(content), baseline + len(content)))
