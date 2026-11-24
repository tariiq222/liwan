# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The storage orphan report, on a temporary ``file`` storage.

No S3 stand-in exists here: the comparison, the grace period and the failure states are protocol independent, and
the OCA code that maps a failed listing to an exception is pinned (``s3fs/errors.py``). The directory a run reads is
a temporary directory, so no bucket and no credential are involved.
"""
import json
import os
import shutil
import tempfile
import time
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import TransactionCase, tagged

from odoo.addons.base.models.ir_autovacuum import is_autovacuum
from odoo.addons.liwan_platform.models.storage_orphan_check import (
    GRACE_HOURS,
    KEPT_RUNS,
)

STORAGE_CODE = 'liwan_test_orphans'
DAY = 86400
SECRET = 'AKIA-THIS-MUST-NOT-APPEAR'


@tagged('post_install', '-at_install', 'liwan')
class OrphanCheckCase(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Run = cls.env['liwan.storage.orphan.check']
        cls.Object = cls.env['liwan.storage.orphan.object']
        cls.Attachment = cls.env['ir.attachment']

    def setUp(self):
        super().setUp()
        self.temp_dir = tempfile.mkdtemp(prefix='liwan_orphan_')
        self.addCleanup(shutil.rmtree, self.temp_dir, ignore_errors=True)
        # fs_attachment caches the storage codes and the default code on the registry.
        self.env.registry.clear_cache()
        self.storage = self.env['fs.storage'].create({
            'name': 'LiwanOS orphan check storage',
            'code': STORAGE_CODE,
            'protocol': 'file',
            'directory_path': self.temp_dir,
            'use_as_default_for_attachments': True,
            'autovacuum_gc': True,
        })
        self.addCleanup(self.env.registry.clear_cache)

    # helpers

    def _run_check(self):
        self.Run._liwan_cron_check_orphans()
        return self._latest_run()

    def _latest_run(self):
        return self.Run.search([('fs_storage_code', '=', STORAGE_CODE)], order='id desc', limit=1)

    def _create_attachment(self, size=97, name='stored.txt'):
        return self.Attachment.create({
            'name': name, 'raw': os.urandom(size), 'mimetype': 'text/plain',
        })

    def _object_path(self, attachment):
        return os.path.join(self.temp_dir, attachment.store_fname.split('://', 1)[1])

    def _write_object(self, key, content, age_days=None):
        path = os.path.join(self.temp_dir, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as handle:
            handle.write(content)
        if age_days is not None:
            self._age(path, age_days)
        return path

    def _age(self, path, age_days):
        stamp = time.time() - age_days * DAY
        os.utime(path, (stamp, stamp))


@tagged('post_install', '-at_install', 'liwan')
class TestStockFileGarbageCollector(OrphanCheckCase):
    """The pinned ``fs.file.gc`` stays the only deleter; the check only reports what it misses."""

    def test_a1_the_gc_runs_from_the_stock_autovacuum_and_has_no_second_schedule(self):
        gc = self.env['fs.file.gc']
        self.assertTrue(is_autovacuum(type(gc)._gc_files))
        self.assertEqual(self.env.ref('base.autovacuum_job').model_id.model, 'ir.autovacuum')
        self.assertFalse(self.env['ir.cron'].search_count([('model_id.model', '=', 'fs.file.gc')]))

    def test_a2_the_gc_removes_the_object_and_its_mark_row(self):
        attachment = self._create_attachment()
        store_fname = attachment.store_fname
        path = self._object_path(attachment)
        self.assertTrue(os.path.isfile(path))
        attachment.unlink()
        self.assertTrue(self.env['fs.file.gc'].search_count([('store_fname', '=', store_fname)]))
        self.env['fs.file.gc']._gc_files_unsafe()
        self.assertFalse(os.path.exists(path))
        self.assertFalse(self.env['fs.file.gc'].search_count([('store_fname', '=', store_fname)]))

    def test_a3_a_failed_delete_leaves_the_object_and_the_check_reports_it(self):
        attachment = self._create_attachment()
        store_fname = attachment.store_fname
        key = store_fname.split('://', 1)[1]
        path = self._object_path(attachment)
        self._age(path, 3)
        attachment.unlink()
        with patch('fsspec.implementations.dirfs.DirFileSystem.rm', side_effect=PermissionError('denied')):
            self.env['fs.file.gc']._gc_files_unsafe()
        # The pinned GC logs the failure at debug level and drops the mark, so the object is never retried.
        self.assertTrue(os.path.isfile(path))
        self.assertFalse(self.env['fs.file.gc'].search_count([('store_fname', '=', store_fname)]))
        run = self._run_check()
        self.assertEqual(run.state, 'orphans_found')
        self.assertEqual(run.object_ids.mapped('key'), [key])


@tagged('post_install', '-at_install', 'liwan')
class TestOrphanObjects(OrphanCheckCase):
    """One run of the comparison, one reported state."""

    def test_b1_an_old_object_without_a_record_is_reported(self):
        self._write_object('aa/bb/orphan-blob', b'x' * 123, age_days=3)
        run = self._run_check()
        self.assertEqual((run.state, run.objects_listed, run.orphan_count), ('orphans_found', 1, 1))
        self.assertEqual((run.orphan_bytes, run.missing_count), (123, 0))
        object_row = run.object_ids
        self.assertEqual(object_row.mapped('key'), ['aa/bb/orphan-blob'])
        self.assertEqual(object_row.size, 123)
        self.assertTrue(object_row.last_modified)

    def test_b2_an_object_inside_the_grace_period_is_not_reported(self):
        self._write_object('fresh-blob', b'x' * 50, age_days=(GRACE_HOURS - 1) / 24)
        run = self._run_check()
        self.assertEqual((run.state, run.objects_listed, run.orphan_count), ('ok', 1, 0))
        self.assertEqual(run.orphan_bytes, 0)
        self.assertFalse(run.object_ids)

    def test_b3_an_object_waiting_for_the_gc_is_not_an_orphan(self):
        attachment = self._create_attachment()
        store_fname = attachment.store_fname
        self._age(self._object_path(attachment), 3)
        attachment.unlink()
        self.assertTrue(self.env['fs.file.gc'].search_count([('store_fname', '=', store_fname)]))
        run = self._run_check()
        self.assertEqual((run.state, run.orphan_count), ('ok', 0))
        self.assertFalse(run.object_ids)

    def test_b4_the_marker_and_objects_outside_the_storage_are_not_counted(self):
        marker = self.storage._get_marker_file_name()
        self._write_object(marker, b'', age_days=3)
        outside = tempfile.mkdtemp(prefix='liwan_orphan_outside_')
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)
        with open(os.path.join(outside, 'foreign-blob'), 'wb') as handle:
            handle.write(b'x' * 10)
        run = self._run_check()
        self.assertEqual((run.state, run.objects_listed, run.orphan_count), ('ok', 1, 0))
        self.assertFalse(run.object_ids)

    def test_b5_an_optimized_renamed_path_is_recognised(self):
        self.storage.write({'optimizes_directory_path': True})
        attachment = self._create_attachment(name='renamed name.txt')
        key = attachment.store_fname.split('://', 1)[1]
        self.assertIn('/', key)
        self.assertTrue(attachment.fs_filename)
        self.assertTrue(os.path.isfile(self._object_path(attachment)))
        run = self._run_check()
        self.assertEqual((run.state, run.objects_listed, run.orphan_count, run.missing_count), ('ok', 1, 0, 0))
        self.assertEqual(run.object_ids.mapped('key'), [])

    def _aged(self, attachment):
        """A record old enough for its missing object to be reported instead of waiting out the grace period."""
        self.env.flush_all()
        # create_date is a magic column the ORM ignores on write, so the test backdates it directly.
        self.env.cr.execute(
            'UPDATE ir_attachment SET create_date = %s WHERE id = %s',
            [fields.Datetime.now() - timedelta(hours=GRACE_HOURS + 1), attachment.id],
        )
        self.env.invalidate_all()
        return attachment

    def test_b6_a_record_without_an_object_is_counted_missing(self):
        attachment = self._aged(self._create_attachment())
        os.unlink(self._object_path(attachment))
        run = self._run_check()
        self.assertEqual((run.state, run.objects_listed, run.missing_count), ('missing_found', 0, 1))
        self.assertEqual(run.orphan_count, 0)

    def test_b6_a_record_inside_the_grace_period_is_not_missing_yet(self):
        attachment = self._create_attachment()
        os.unlink(self._object_path(attachment))
        run = self._run_check()
        self.assertEqual((run.state, run.missing_count), ('ok', 0))

    def test_b6_a_field_attachment_is_neither_an_orphan_nor_missed(self):
        """``ir.attachment._search`` hides ``res_field`` rows from a plain domain unless both sides are named."""
        partner = self.env['res.partner'].create({'name': 'field carrier'})
        attachment = self.Attachment.create({
            'name': 'field.bin',
            'raw': os.urandom(60000),
            'mimetype': 'application/octet-stream',
            'res_model': 'res.partner',
            'res_id': partner.id,
            'res_field': 'image_1920',
        })
        self.assertEqual(attachment.res_field, 'image_1920')
        self.assertGreater(attachment.file_size, 51200)
        self.assertTrue(attachment.store_fname.startswith(f'{STORAGE_CODE}://'))
        run = self._run_check()
        self.assertEqual((run.state, run.orphan_count, run.missing_count), ('ok', 0, 0))
        self._aged(attachment)
        os.unlink(self._object_path(attachment))
        run = self._run_check()
        self.assertEqual((run.state, run.missing_count), ('missing_found', 1))

    def test_b7_without_a_storage_nothing_runs_and_no_row_is_written(self):
        before = self.Run.search_count([])
        self.storage.unlink()
        self.env.registry.clear_cache()
        self.Run._liwan_cron_check_orphans()
        self.assertEqual(self.Run.search_count([]), before)

    def test_b8_each_failure_records_its_state_without_raising_or_an_orphan_row(self):
        self._write_object('old-orphan', b'x' * 5, age_days=3)
        cases = [
            (PermissionError('denied'), 'auth_failed'),
            (OSError('connection reset'), 'unreachable'),
            (Exception('a botocore connection error is not an OSError'), 'unreachable'),
        ]
        for error, state in cases:
            with self.subTest(state=state), patch('fsspec.implementations.dirfs.DirFileSystem.walk', side_effect=error):
                run = self._run_check()
                self.assertEqual((run.state, run.objects_listed), (state, 0))
                self.assertFalse(run.object_ids)

    def test_b9_an_incomplete_listing_is_a_state_and_writes_no_orphan_row(self):
        self._write_object('old-orphan', b'x' * 5, age_days=3)
        incomplete = [('', {}, {'blob': {'name': 'blob', 'size': None, 'mtime': time.time()}})]
        with patch('fsspec.implementations.dirfs.DirFileSystem.walk', return_value=incomplete):
            run = self._run_check()
        self.assertEqual((run.state, run.objects_listed), ('incomplete', 0))
        self.assertFalse(run.object_ids)

    def test_b10_no_option_or_exception_text_reaches_the_row_or_the_log(self):
        self.storage.write({'options': json.dumps({'key': SECRET, 'secret': SECRET})})
        with patch('fsspec.implementations.dirfs.DirFileSystem.walk', side_effect=OSError(f'reset {SECRET}')):
            with self.assertLogs('odoo.addons.liwan_platform.models.storage_orphan_check', level='WARNING') as logs:
                run = self._run_check()
        self.assertEqual(run.state, 'unreachable')
        output = '\n'.join(logs.output)
        self.assertNotIn(SECRET, output)
        self.assertIn(STORAGE_CODE, output)
        self.assertIn('unreachable', output)
        values = str(run.read(['fs_storage_code', 'state', 'objects_listed', 'orphan_count', 'missing_count']))
        self.assertNotIn(SECRET, values)
        self.assertNotIn('options', values)

    def test_b13_the_listing_asks_the_filesystem_for_a_fresh_walk(self):
        with patch('fsspec.implementations.dirfs.DirFileSystem.walk', return_value=[]) as walk:
            run = self._run_check()
        self.assertEqual((run.state, run.objects_listed), ('ok', 0))
        walk.assert_called_once_with('', detail=True, on_error='raise', refresh=True)

    def test_b14_a_failing_run_never_raises_so_the_cron_survives(self):
        """Odoo deactivates a cron after five failures over seven days; the row is the report, not the exception."""
        with patch('fsspec.implementations.dirfs.DirFileSystem.walk', side_effect=OSError('connection reset')):
            self.assertIsNone(self.Run._liwan_cron_check_orphans())
        run = self._latest_run()
        self.assertEqual(run.state, 'unreachable')

    def test_b11_each_run_owns_its_objects_and_the_last_thirty_runs_are_kept(self):
        path = self._write_object('old-orphan', b'x' * 5, age_days=3)
        first = self._run_check()
        self.assertEqual(first.orphan_count, 1)
        os.unlink(path)
        second = self._run_check()
        self.assertEqual(second.orphan_count, 0)
        self.assertEqual(first.object_ids.mapped('key'), ['old-orphan'])
        self.assertFalse(second.object_ids)
        self.Run.search([('fs_storage_code', '=', STORAGE_CODE)]).unlink()
        runs = [self._run_check() for _ in range(KEPT_RUNS + 1)]
        kept = self.Run.search([('fs_storage_code', '=', STORAGE_CODE)], order='id desc')
        self.assertEqual(len(kept), KEPT_RUNS)
        self.assertNotIn(runs[0].id, kept.ids)
        self.assertEqual(kept[0].id, runs[-1].id)

    def test_b12_the_check_is_scheduled_daily_as_the_system_user(self):
        cron = self.env.ref('liwan_platform.ir_cron_check_storage_orphans')
        self.assertEqual((cron.interval_number, cron.interval_type), (1, 'days'))
        self.assertEqual(cron.user_id, self.env.ref('base.user_root'))
        self.assertIn('_liwan_cron_check_orphans', cron.code)
