# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from deploy import backup as backup_script
from deploy import restore_verify as rv


class Completed:
    def __init__(self, returncode=0, stdout=''):
        self.returncode, self.stdout = returncode, stdout


MODULES_ANSWER = 'liwan_api\nliwan_core\nliwan_hr\n'


def make_backup(root: Path, files=('ab/abcdef',)) -> Path:
    backup_dir = root / 'backup'
    (backup_dir / 'filestore').mkdir(parents=True)
    (backup_dir / 'database.dump').write_bytes(b'PGDMP')
    for name in files:
        path = backup_dir / 'filestore' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'x')
    write_manifest(backup_dir)
    return backup_dir


def write_manifest(backup_dir: Path) -> None:
    """The manifest as backup.py pins the bytes now on disk."""
    filestore_sha256, file_count = backup_script.filestore_digest(backup_dir / 'filestore')
    (backup_dir / 'manifest.json').write_text(json.dumps({
        'db_name': 'src',
        'consistency': 'UNVERIFIED',
        'database_dump_sha256': hashlib.sha256((backup_dir / 'database.dump').read_bytes()).hexdigest(),
        'filestore_sha256': filestore_sha256,
        'filestore_file_count': file_count,
    }))


class TestRestoreVerify(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.tools = {}
        for name in ('pg_restore', 'psql'):
            tool = self.tmp / name
            tool.write_text('')
            self.tools[name] = str(tool)
        # The release module list is a separate concern: these tests pin the verification logic.
        self.expected = ['liwan_api', 'liwan_core', 'liwan_hr']
        patcher = mock.patch.object(rv, 'expected_modules', return_value=self.expected)
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

        return rv.perform_restore(
            backup_dir=str(backup), target_db=target_db,
            target_filestore=str(self.tmp / 'restored' / target_db),
            pg_restore=self.tools['pg_restore'], psql=self.tools['psql'],
            pg_user=pg_user, runner=runner,
        )

    def test_refuses_forbidden_and_non_scratch_targets(self):
        backup = make_backup(self.tmp)
        for name in ('odoo19', 'production', 'customer_live', 'postgres', 'odoo19_scratch'):
            with self.assertRaises(rv.RestoreError):
                self.run_verify(backup, [], target_db=name)

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
        with self.assertRaises(rv.RestoreError):
            self.run_verify(backup, [], failing='CREATE DATABASE')
        self.assertEqual([Path(argv[0]).name for argv, _ in self.calls], ['psql'])
        self.assertFalse((self.tmp / 'restored' / 'liwan_restore_scratch').exists())
        self.assertFalse((backup / 'restore-verification.json').exists())

    def test_aborts_before_pg_restore_when_the_isolation_fails(self):
        backup = make_backup(self.tmp)
        with self.assertRaises(rv.RestoreError):
            self.run_verify(backup, [], failing='REVOKE CONNECT')
        self.assertEqual([Path(argv[0]).name for argv, _ in self.calls], ['psql', 'psql'])
        self.assertFalse((self.tmp / 'restored' / 'liwan_restore_scratch').exists())
        self.assertFalse((backup / 'restore-verification.json').exists())

    def test_refuses_a_missing_role_or_unquotable_database_before_any_command(self):
        backup = make_backup(self.tmp)
        for kwargs in ({'pg_user': None}, {'pg_user': 'bad role'}, {'target_db': 'liwan_Restore_scratch'}):
            with self.subTest(**kwargs), self.assertRaises(rv.RestoreError):
                self.run_verify(backup, [], **kwargs)
            self.assertEqual(self.calls, [])

    def test_refuses_incomplete_backup(self):
        backup = make_backup(self.tmp)
        (backup / 'database.dump').unlink()
        with self.assertRaises(rv.RestoreError):
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
        with mock.patch.object(rv, 'expected_modules', return_value=[]):
            self.assertFalse(self.run_verify(backup, [MODULES_ANSWER, '0\n', 'ab/abcdef\n'])['restore_verified'])

    def test_an_unreadable_release_list_fails_the_restore(self):
        backup = make_backup(self.tmp)
        with mock.patch.object(rv, 'expected_modules', side_effect=rv.RestoreError('missing catalog')):
            with self.assertRaises(rv.RestoreError):
                self.run_verify(backup, [MODULES_ANSWER, '0\n', 'ab/abcdef\n'])


    def passing_answers(self):
        return [MODULES_ANSWER, '0\n', 'ab/abcdef\n']

    def test_a_verified_restore_has_no_integrity_mismatch(self):
        backup = make_backup(self.tmp)
        result = self.run_verify(backup, self.passing_answers())
        self.assertEqual(result['checks']['backup_integrity_mismatches'], [])
        self.assertEqual(result['checks']['filestore_files_expected'], 1)
        self.assertEqual(result['checks']['filestore_files_actual'], 1)

    def test_a_dump_with_wrong_content_is_detected(self):
        backup = make_backup(self.tmp)
        (backup / 'database.dump').write_bytes(b'PGDMX')
        result = self.run_verify(backup, self.passing_answers())
        self.assertFalse(result['restore_verified'])
        self.assertEqual(result['checks']['backup_integrity_mismatches'], ['database_dump_sha256'])
        self.assertFalse(json.loads((backup / 'restore-verification.json').read_text())['restore_verified'])

    def test_a_filestore_file_with_wrong_content_is_detected(self):
        """Same name, same size, different bytes: the count matches and the digest does not."""
        backup = make_backup(self.tmp)
        (backup / 'filestore' / 'ab' / 'abcdef').write_bytes(b'y')
        result = self.run_verify(backup, self.passing_answers())
        self.assertFalse(result['restore_verified'])
        self.assertEqual(result['checks']['backup_integrity_mismatches'], ['filestore_sha256'])

    def test_an_added_and_a_removed_filestore_file_change_the_count(self):
        backup = make_backup(self.tmp)
        (backup / 'filestore' / 'cd').mkdir()
        (backup / 'filestore' / 'cd' / 'extra').write_bytes(b'x')
        result = self.run_verify(backup, self.passing_answers())
        self.assertFalse(result['restore_verified'])
        self.assertEqual(
            result['checks']['backup_integrity_mismatches'], ['filestore_sha256', 'filestore_file_count'],
        )
        self.assertEqual(result['checks']['filestore_files_expected'], 1)
        self.assertEqual(result['checks']['filestore_files_actual'], 2)

    def test_a_symlink_in_the_backup_filestore_is_refused_before_any_command(self):
        backup = make_backup(self.tmp)
        (backup / 'filestore' / 'ab' / 'escape').symlink_to('/etc/hosts')
        with self.assertRaisesRegex(rv.RestoreError, 'symlink'):
            self.run_verify(backup, [])
        self.assertEqual(self.calls, [])
        self.assertFalse((backup / 'restore-verification.json').exists())

    def test_a_symlinked_dump_is_refused_before_any_command(self):
        backup = make_backup(self.tmp)
        real = self.tmp / 'real.dump'
        real.write_bytes(b'PGDMP')
        (backup / 'database.dump').unlink()
        (backup / 'database.dump').symlink_to(real)
        with self.assertRaisesRegex(rv.RestoreError, 'symlink'):
            self.run_verify(backup, [])
        self.assertEqual(self.calls, [])

    def test_the_filestore_copy_does_not_carry_links(self):
        backup = make_backup(self.tmp)
        with mock.patch.object(rv.shutil, 'copytree', wraps=rv.shutil.copytree) as copytree:
            self.run_verify(backup, self.passing_answers())
        self.assertFalse(copytree.call_args.kwargs.get('symlinks', False))

    def test_a_manifest_without_the_digests_is_refused_before_any_command(self):
        for pinned in ({}, {'database_dump_sha256': 'a' * 64, 'filestore_sha256': 'a' * 64},
                       {'database_dump_sha256': 'nothex', 'filestore_sha256': 'a' * 64, 'filestore_file_count': 1},
                       {'database_dump_sha256': 'a' * 64, 'filestore_sha256': 'a' * 64, 'filestore_file_count': True}):
            with self.subTest(pinned=pinned):
                backup = make_backup(Path(tempfile.mkdtemp()))
                (backup / 'manifest.json').write_text(json.dumps({'db_name': 'src', **pinned}))
                with self.assertRaisesRegex(rv.RestoreError, 'does not pin the backup'):
                    self.run_verify(backup, [])
                self.assertEqual(self.calls, [])

    def test_an_unreadable_manifest_is_refused(self):
        backup = make_backup(self.tmp)
        (backup / 'manifest.json').write_text('{not json')
        with self.assertRaisesRegex(rv.RestoreError, 'not valid JSON'):
            self.run_verify(backup, [])


if __name__ == '__main__':
    unittest.main()
