# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What a verified restore promises, proven offline against a fake PostgreSQL.

The frozen manifest is the point: the dump digest, the object index digest, the object
count and the object bytes the capture pinned are compared before any database is created,
so an artifact that changed after the copy cannot be reported as restored. The target database must be a new
scratch name and may not resemble a live one. The provisioning, isolation, ``pg_restore``
and read-back commands are faked; nothing here opens a socket or starts a database.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from deploy.backup import bucket, verify
from deploy.backup.artifact import CONTENTS_MEMBER, OBJECTS_DIRECTORY
from deploy.backup.errors import BackupError
from deploy.backup.verify import PostgresConnection, RestoreTools, restore_verified


class Completed:
    def __init__(self, returncode=0, stdout=''):
        self.returncode, self.stdout = returncode, stdout


MODULES_ANSWER = 'liwan_api\nliwan_core\nliwan_hr\n'


def make_backup(root: Path, files=('ab/abcdef',)) -> Path:
    backup_dir = root / 'backup'
    (backup_dir / OBJECTS_DIRECTORY).mkdir(parents=True)
    (backup_dir / 'database.dump').write_bytes(b'PGDMP')
    for name in files:
        path = backup_dir / OBJECTS_DIRECTORY / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'x')
    write_manifest(backup_dir)
    return backup_dir


def write_manifest(backup_dir: Path) -> None:
    """The snapshot manifest and object index as this package pins the bytes now on disk."""
    contents = bucket.tree_manifest(backup_dir / OBJECTS_DIRECTORY)
    (backup_dir / CONTENTS_MEMBER).write_bytes(contents.index)
    (backup_dir / 'manifest.json').write_text(json.dumps({
        'db_name': 'src',
        'consistency': 'UNVERIFIED',
        'database_sha256': hashlib.sha256((backup_dir / 'database.dump').read_bytes()).hexdigest(),
        'contents_sha256': contents.index_sha256,
        'contents_object_count': contents.object_count,
        'contents_object_bytes': contents.object_bytes,
    }), encoding='utf-8')


class TestRestoreVerify(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.tools = {}
        for name in ('pg_restore', 'psql'):
            tool = self.tmp / name
            tool.write_text('', encoding='utf-8')
            self.tools[name] = tool
        # The release module list is a separate concern: these tests pin the verification logic.
        self.expected = ['liwan_api', 'liwan_core', 'liwan_hr']
        patcher = mock.patch.object(verify, 'expected_modules', return_value=self.expected)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_verify(self, backup, psql_answers, target_db='liwan_restore_scratch', pg_user='odoo', failing=None):
        answers = iter(psql_answers)
        self.calls = []

        def runner(argv, **kwargs):
            self.calls.append((argv, kwargs.get('input')))
            # `failing` is the marker of the script that psql must fail on.
            if failing and failing in (kwargs.get('input') or ''):
                return Completed(returncode=1)
            if Path(argv[0]).name == 'psql' and kwargs.get('input') is None:
                return Completed(stdout=next(answers))
            return Completed()

        return restore_verified(
            artifact=Path(backup).resolve(),
            target_db=target_db,
            target_filestore=self.tmp / 'restored' / target_db,
            tools=RestoreTools(
                pg_restore=self.tools['pg_restore'], psql=self.tools['psql'], runner=runner,
            ),
            pg=PostgresConnection(user=pg_user),
        )

    def test_refuses_a_target_that_is_not_a_new_scratch_database(self):
        backup = make_backup(self.tmp)
        for name in ('liwan_dev', 'odoo19', 'odoo19_scratch', 'production', 'liwan_prod_scratch',
                     'customer_live', 'postgres'):
            with self.subTest(name=name), self.assertRaises(BackupError):
                self.run_verify(backup, [], target_db=name)
        self.assertEqual(self.calls, [])

    def test_creates_with_the_tenant_recipe_then_closes_to_public_before_pg_restore(self):
        backup = make_backup(self.tmp)
        self.run_verify(backup, [MODULES_ANSWER, '0\n', 'ab/abcdef\n'])
        names = [Path(argv[0]).name for argv, _ in self.calls]
        self.assertEqual(names[:3], ['psql', 'psql', 'pg_restore'])
        self.assertIn('--no-acl', self.calls[2][0])
        (create_argv, create), (isolation_argv, isolation) = self.calls[:2]
        for argv in (create_argv, isolation_argv):
            self.assertIn('ON_ERROR_STOP=1', argv)
            self.assertEqual(argv[argv.index('-d') + 1], 'postgres')
        self.assertEqual(create, "CREATE DATABASE \"liwan_restore_scratch\" ENCODING 'unicode' LC_COLLATE 'C' TEMPLATE template0;\n")
        self.assertIn('REVOKE CONNECT ON DATABASE "liwan_restore_scratch" FROM PUBLIC;', isolation)
        self.assertIn('GRANT CONNECT ON DATABASE "liwan_restore_scratch" TO "odoo";', isolation)
        self.assertIn('public_connect_not_revoked', isolation)

    def test_aborts_before_isolation_and_pg_restore_when_the_create_fails(self):
        backup = make_backup(self.tmp)
        with self.assertRaises(BackupError):
            self.run_verify(backup, [], failing='CREATE DATABASE')
        self.assertEqual([Path(argv[0]).name for argv, _ in self.calls], ['psql'])
        self.assertFalse((self.tmp / 'restored' / 'liwan_restore_scratch').exists())
        self.assertFalse((backup / 'restore-verification.json').exists())

    def test_aborts_before_pg_restore_when_the_isolation_fails(self):
        backup = make_backup(self.tmp)
        with self.assertRaises(BackupError):
            self.run_verify(backup, [], failing='REVOKE CONNECT')
        self.assertEqual([Path(argv[0]).name for argv, _ in self.calls], ['psql', 'psql'])
        self.assertFalse((self.tmp / 'restored' / 'liwan_restore_scratch').exists())
        self.assertFalse((backup / 'restore-verification.json').exists())

    def test_refuses_a_missing_or_unquotable_role_before_any_command(self):
        backup = make_backup(self.tmp)
        for kwargs in ({'pg_user': None}, {'pg_user': 'bad role'}):
            with self.subTest(**kwargs), self.assertRaises(BackupError):
                self.run_verify(backup, [], **kwargs)
            self.assertEqual(self.calls, [])

    def test_refuses_incomplete_backup(self):
        backup = make_backup(self.tmp)
        (backup / 'database.dump').unlink()
        with self.assertRaises(BackupError):
            self.run_verify(backup, [])

    def test_passes_when_modules_installed_and_attachments_present(self):
        backup = make_backup(self.tmp)
        result = self.run_verify(backup, [MODULES_ANSWER, '0\n', 'ab/abcdef\n'])
        self.assertTrue(result['restore_verified'])
        self.assertEqual(result['checks']['missing_attachment_files'], [])
        written = json.loads((backup / 'restore-verification.json').read_text())
        self.assertTrue(written['restore_verified'])
        self.assertEqual(json.loads((backup / 'manifest.json').read_text())['consistency'], 'UNVERIFIED')

    def test_fails_when_an_attachment_file_is_missing(self):
        backup = make_backup(self.tmp)
        result = self.run_verify(backup, [MODULES_ANSWER, '0\n', 'ab/abcdef\ncd/missing\n'])
        self.assertFalse(result['restore_verified'])
        self.assertEqual(result['checks']['missing_attachment_files'], ['cd/missing'])

    def test_fails_when_a_module_is_stuck(self):
        backup = make_backup(self.tmp)
        self.assertFalse(self.run_verify(backup, [MODULES_ANSWER, '2\n', 'ab/abcdef\n'])['restore_verified'])

    def test_fails_when_an_expected_release_module_is_missing(self):
        """One installed liwan module is not a verified restore (issue #465)."""
        backup = make_backup(self.tmp)
        result = self.run_verify(backup, ['liwan_api\n', '0\n', 'ab/abcdef\n'])
        self.assertFalse(result['restore_verified'])
        self.assertEqual(result['checks']['missing_modules'], ['liwan_core', 'liwan_hr'])
        self.assertEqual(result['checks']['liwan_modules_expected'], 3)

    def test_restores_in_one_transaction(self):
        """A dump cut short must leave no half-written database behind (issue #465)."""
        backup = make_backup(self.tmp)
        self.run_verify(backup, [MODULES_ANSWER, '0\n', 'ab/abcdef\n'])
        pg_restore_argv = next(argv for argv, _ in self.calls if Path(argv[0]).name == 'pg_restore')
        self.assertIn('--single-transaction', pg_restore_argv)

    def test_an_empty_expected_list_never_verifies(self):
        backup = make_backup(self.tmp)
        with mock.patch.object(verify, 'expected_modules', return_value=[]):
            self.assertFalse(self.run_verify(backup, [MODULES_ANSWER, '0\n', 'ab/abcdef\n'])['restore_verified'])

    def test_an_unreadable_release_list_fails_the_restore(self):
        backup = make_backup(self.tmp)
        with mock.patch.object(verify, 'expected_modules', side_effect=BackupError('missing catalog')):
            with self.assertRaises(BackupError):
                self.run_verify(backup, [MODULES_ANSWER, '0\n', 'ab/abcdef\n'])

    def passing_answers(self):
        return [MODULES_ANSWER, '0\n', 'ab/abcdef\n']

    def test_a_verified_restore_has_no_integrity_mismatch(self):
        backup = make_backup(self.tmp)
        result = self.run_verify(backup, self.passing_answers())
        self.assertEqual(result['checks']['backup_integrity_mismatches'], [])
        self.assertEqual(result['checks']['missing_objects'], [])
        self.assertEqual(result['checks']['objects_expected'], 1)
        self.assertEqual(result['checks']['objects_actual'], 1)
        pinned = result['source_manifest']
        self.assertEqual(pinned['database_sha256'], hashlib.sha256(b'PGDMP').hexdigest())
        self.assertEqual(pinned['contents_object_count'], 1)
        self.assertEqual(
            pinned['contents_sha256'],
            bucket.tree_manifest(backup / OBJECTS_DIRECTORY).index_sha256,
        )

    def test_a_dump_with_wrong_content_is_detected(self):
        backup = make_backup(self.tmp)
        (backup / 'database.dump').write_bytes(b'PGDMX')
        result = self.run_verify(backup, self.passing_answers())
        self.assertFalse(result['restore_verified'])
        self.assertEqual(result['checks']['backup_integrity_mismatches'], ['database_sha256'])
        self.assertFalse(json.loads((backup / 'restore-verification.json').read_text())['restore_verified'])

    def test_an_object_with_wrong_content_is_detected(self):
        """Same name, same size, different bytes: the count matches and the digest does not."""
        backup = make_backup(self.tmp)
        (backup / OBJECTS_DIRECTORY / 'ab' / 'abcdef').write_bytes(b'y')
        result = self.run_verify(backup, self.passing_answers())
        self.assertFalse(result['restore_verified'])
        self.assertEqual(result['checks']['backup_integrity_mismatches'], ['contents_sha256'])
        self.assertEqual(result['checks']['missing_objects'], ['ab/abcdef'])

    def test_an_added_object_changes_the_count_and_the_bytes(self):
        backup = make_backup(self.tmp)
        (backup / OBJECTS_DIRECTORY / 'cd').mkdir()
        (backup / OBJECTS_DIRECTORY / 'cd' / 'extra').write_bytes(b'x')
        result = self.run_verify(backup, self.passing_answers())
        self.assertFalse(result['restore_verified'])
        self.assertEqual(
            result['checks']['backup_integrity_mismatches'],
            ['contents_sha256', 'contents_object_count', 'contents_object_bytes'],
        )
        self.assertEqual(result['checks']['missing_objects'], ['cd/extra'])
        self.assertEqual(result['checks']['objects_expected'], 1)
        self.assertEqual(result['checks']['objects_actual'], 2)

    def test_a_symlink_in_the_backup_objects_is_refused_before_any_command(self):
        backup = make_backup(self.tmp)
        (backup / OBJECTS_DIRECTORY / 'ab' / 'escape').symlink_to('/etc/hosts')
        with self.assertRaisesRegex(BackupError, 'symlink'):
            self.run_verify(backup, [])
        self.assertEqual(self.calls, [])
        self.assertFalse((backup / 'restore-verification.json').exists())

    def test_a_symlinked_dump_is_refused_before_any_command(self):
        backup = make_backup(self.tmp)
        real = self.tmp / 'real.dump'
        real.write_bytes(b'PGDMP')
        (backup / 'database.dump').unlink()
        (backup / 'database.dump').symlink_to(real)
        with self.assertRaisesRegex(BackupError, 'symlink'):
            self.run_verify(backup, [])
        self.assertEqual(self.calls, [])

    def test_the_object_copy_does_not_carry_links(self):
        backup = make_backup(self.tmp)
        with mock.patch.object(verify.shutil, 'copytree', wraps=verify.shutil.copytree) as copytree:
            self.run_verify(backup, self.passing_answers())
        self.assertFalse(copytree.call_args.kwargs.get('symlinks', False))

    def test_a_manifest_without_the_digests_is_refused_before_any_command(self):
        complete = {'database_sha256': 'a' * 64, 'contents_sha256': 'b' * 64,
                    'contents_object_count': 1, 'contents_object_bytes': 1}
        for pinned in ({}, {key: complete[key] for key in ('database_sha256', 'contents_sha256')},
                       dict(complete, database_sha256='nothex'), dict(complete, contents_object_count=True),
                       dict(complete, contents_sha256='0' * 64),
                       dict(complete, contents_object_count=0, contents_object_bytes=4)):
            with self.subTest(pinned=pinned):
                root = Path(tempfile.mkdtemp()).resolve()
                self.addCleanup(shutil.rmtree, root, True)
                backup = make_backup(root)
                (backup / 'manifest.json').write_text(json.dumps({
                    'db_name': 'src', 'consistency': 'UNVERIFIED', **pinned,
                }), encoding='utf-8')
                with self.assertRaisesRegex(BackupError, 'does not pin the backup'):
                    self.run_verify(backup, [])
                self.assertEqual(self.calls, [])

    def test_an_unreadable_manifest_is_refused(self):
        backup = make_backup(self.tmp)
        (backup / 'manifest.json').write_text('{not json')
        with self.assertRaisesRegex(BackupError, 'not valid JSON'):
            self.run_verify(backup, [])


if __name__ == '__main__':
    unittest.main()
