# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import tempfile
import unittest
from pathlib import Path

from deploy import restore_verify as rv


class Completed:
    def __init__(self, returncode=0, stdout=''):
        self.returncode, self.stdout = returncode, stdout


def make_backup(root: Path, files=('ab/abcdef',)) -> Path:
    backup = root / 'backup'
    (backup / 'filestore').mkdir(parents=True)
    (backup / 'database.dump').write_bytes(b'PGDMP')
    (backup / 'manifest.json').write_text(json.dumps({'db_name': 'src', 'consistency': 'UNVERIFIED'}))
    for name in files:
        path = backup / 'filestore' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'x')
    return backup


class TestRestoreVerify(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.tools = {}
        for name in ('pg_restore', 'psql'):
            tool = self.tmp / name
            tool.write_text('')
            self.tools[name] = str(tool)

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
        self.run_verify(backup, ['5\n', '0\n', 'ab/abcdef\n'])
        names = [Path(argv[0]).name for argv, _ in self.calls]
        self.assertEqual(names[:3], ['psql', 'psql', 'pg_restore'])
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
        result = self.run_verify(backup, ['5\n', '0\n', 'ab/abcdef\n'])
        self.assertTrue(result['restore_verified'])
        self.assertEqual(result['checks']['missing_attachment_files'], [])
        written = json.loads((backup / 'restore-verification.json').read_text())
        self.assertTrue(written['restore_verified'])
        self.assertEqual(json.loads((backup / 'manifest.json').read_text())['consistency'], 'UNVERIFIED')

    def test_fails_when_an_attachment_file_is_missing(self):
        backup = make_backup(self.tmp)
        result = self.run_verify(backup, ['5\n', '0\n', 'ab/abcdef\ncd/missing\n'])
        self.assertFalse(result['restore_verified'])
        self.assertEqual(result['checks']['missing_attachment_files'], ['cd/missing'])

    def test_fails_when_a_module_is_stuck(self):
        backup = make_backup(self.tmp)
        self.assertFalse(self.run_verify(backup, ['5\n', '2\n', 'ab/abcdef\n'])['restore_verified'])


if __name__ == '__main__':
    unittest.main()
