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
        for name in ('pg_restore', 'createdb', 'psql'):
            tool = self.tmp / name
            tool.write_text('')
            self.tools[name] = str(tool)

    def run_verify(self, backup, psql_answers, target_db='webvue_restore_scratch'):
        answers = iter(psql_answers)

        def runner(argv, **_):
            return Completed(stdout=next(answers)) if Path(argv[0]).name == 'psql' else Completed()

        return rv.perform_restore(
            backup_dir=str(backup), target_db=target_db,
            target_filestore=str(self.tmp / 'restored' / target_db),
            pg_restore=self.tools['pg_restore'], createdb=self.tools['createdb'], psql=self.tools['psql'],
            runner=runner,
        )

    def test_refuses_forbidden_and_non_scratch_targets(self):
        backup = make_backup(self.tmp)
        for name in ('odoo19', 'production', 'customer_live', 'postgres', 'odoo19_scratch'):
            with self.assertRaises(rv.RestoreError):
                self.run_verify(backup, [], target_db=name)

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
