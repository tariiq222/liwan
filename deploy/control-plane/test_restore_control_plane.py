"""The control plane restore, proven offline: no database, no socket, real openssl.

``psql`` and ``pg_restore`` are a scripted runner that answers like the real tools; the
encryption is the real ``openssl`` binary, so the artifact a restore reads is one the
pipeline's own capture produced.
"""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from restore_control_plane import (
    EXIT_NOT_VERIFIED,
    EXIT_OK,
    EXIT_REFUSED,
    STAMP_PRESENT_SQL,
    STAMP_SQL,
    VERIFY_SQL,
    checks_for,
    main,
)

from deploy import backup_pipeline as bp
from deploy.s3_client import FilesystemStore

PASSPHRASE = 'correct horse battery staple for liwan'
DUMP = b'PGDMP control plane dump'
OBSERVED = {
    'tables': {'customers': 3, 'invoices': 5},
    'invoice_sequence': {'last_value': 41, 'is_called': True},
    'latest_invoice_number': 'NSQ-2026-000040',
    'highest_invoice_serial': 40,
    'migration': 56,
}


@dataclass
class Completed:
    returncode: int = 0
    stdout: str = ''
    stderr: str = ''


class ScriptedTools:
    """Answers psql and pg_restore like the real tools; openssl and pg_dump run for real or write the dump."""

    def __init__(self, *, observed=None, source=None, create_fails=False, has_state_table=True) -> None:
        self.calls: list[list[str]] = []
        self._observed = observed or OBSERVED
        self._source = source or OBSERVED
        self._create_fails = create_fails
        self._has_state_table = has_state_table

    def __call__(self, argv, **kwargs):
        argv = [str(argument) for argument in argv]
        self.calls.append(argv)
        name = Path(argv[0]).name
        if name == 'openssl':
            return subprocess.run(argv, check=False, **{k: v for k, v in kwargs.items() if k != 'check'})
        if name == 'pg_dump':
            Path(argv[argv.index('-f') + 1]).write_bytes(DUMP)
            return Completed()
        if name == 'pg_restore':
            return Completed()
        if '-c' in argv and argv[argv.index('-c') + 1].startswith('CREATE DATABASE'):
            return Completed(1, stderr='ERROR:  database already exists\n') if self._create_fails else Completed()
        if '-c' in argv and argv[argv.index('-c') + 1] == STAMP_PRESENT_SQL:
            return Completed(stdout='t\n' if self._has_state_table else 'f\n')
        if '-c' in argv and argv[argv.index('-c') + 1] == STAMP_SQL:
            return Completed()
        database = argv[argv.index('-d') + 1]
        return Completed(stdout=json.dumps(self._source if database == 'liwan_control_scratch_source' else self._observed))

    def calls_to(self, name: str) -> list[list[str]]:
        return [call for call in self.calls if Path(call[0]).name == name]


class RestoreCase(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix='liwan-cp-restore-')).resolve()
        self.passphrase = self.root / 'passphrase'
        self.passphrase.write_text(PASSPHRASE + '\n', encoding='utf-8')
        self.passphrase.chmod(0o600)
        self.bucket = self.root / 'bucket'
        pg_dump = self.root / 'pg_dump'
        pg_dump.write_text('', encoding='utf-8')
        bp.capture(
            store=FilesystemStore(self.bucket), tenant=bp.CONTROL_PLANE_SOURCE,
            source=bp.CaptureSource('liwan_control', None, pg_dump), kind='hourly',
            work_root=self.root / 'work', passphrase_file=self.passphrase,
            now=datetime.now(timezone.utc), runner=ScriptedTools(),
        )
        self._environment = dict(os.environ)
        os.environ[bp.PASSPHRASE_ENVIRONMENT_VARIABLE] = str(self.passphrase)

    def tearDown(self) -> None:
        os.environ.clear()
        os.environ.update(self._environment)
        for path in sorted(self.root.rglob('*'), key=lambda item: len(item.parts), reverse=True):
            path.unlink() if path.is_file() or path.is_symlink() else path.rmdir()
        self.root.rmdir()

    def run_restore(self, tools: ScriptedTools, *extra: str, scratch: str = 'scratch', target: str = 'liwan_control_scratch_x'):
        argv = ['restore', '--store-root', str(self.bucket), '--scratch-root', str(self.root / scratch),
                '--target-db', target, '--psql', '/bin/psql', '--pg-restore', '/bin/pg_restore', *extra]
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = main(argv, runner=tools)
        return code, stdout.getvalue(), stderr.getvalue()


class TestRestore(RestoreCase):
    def test_a_good_backup_restores_and_is_recorded_as_verified(self):
        tools = ScriptedTools()
        code, stdout, stderr = self.run_restore(tools, '--expect-migration', '56')
        self.assertEqual((code, stderr), (EXIT_OK, ''))
        record = json.loads((self.root / 'scratch' / 'control-plane-restore.json').read_text(encoding='utf-8'))
        self.assertEqual(json.loads(stdout), record)
        self.assertTrue(record['restore_verified'])
        self.assertEqual((record['source'], record['rpo_ok'], record['rto_ok']), ('control-plane', True, True))
        self.assertEqual(record['observed'], OBSERVED)

    def test_the_dump_is_restored_into_the_new_database_without_owners_or_a_password(self):
        tools = ScriptedTools()
        self.run_restore(tools, '--owner-role', 'liwan_control')
        (argv,) = tools.calls_to('pg_restore')
        self.assertEqual(argv[argv.index('-d') + 1], 'liwan_control_scratch_x')
        self.assertEqual(Path(argv[-3] if '--role' in argv else argv[-1]).name, 'database.dump')
        self.assertTrue({'--no-owner', '--no-acl', '--exit-on-error'} <= set(argv))
        self.assertEqual(argv[argv.index('--role') + 1], 'liwan_control')
        self.assertFalse({'--password', '-W'} & set(argv))

    def test_the_verification_reads_the_restored_database_and_not_a_guess(self):
        tools = ScriptedTools()
        self.run_restore(tools)
        reads = [call for call in tools.calls_to('psql') if VERIFY_SQL in call]
        self.assertEqual([call[call.index('-d') + 1] for call in reads], ['liwan_control_scratch_x'])

    def test_the_restore_time_is_stamped_in_the_restored_database_after_pg_restore(self):
        tools = ScriptedTools()
        code, stdout, _stderr = self.run_restore(tools)
        self.assertEqual(code, EXIT_OK)
        self.assertTrue(json.loads(stdout)['restored_at_stamped'])
        order = [call for call in tools.calls if Path(call[0]).name in ('pg_restore', 'psql')]
        stamp = next(index for index, call in enumerate(order) if STAMP_SQL in call)
        self.assertGreater(stamp, next(index for index, call in enumerate(order) if Path(call[0]).name == 'pg_restore'))
        self.assertEqual(order[stamp][order[stamp].index('-d') + 1], 'liwan_control_scratch_x')
        # The verification reads after the stamp, so a failed stamp can never leave a verified record.
        self.assertGreater(next(index for index, call in enumerate(order) if VERIFY_SQL in call), stamp)

    def test_a_backup_older_than_the_state_table_is_left_unstamped_and_says_so(self):
        tools = ScriptedTools(has_state_table=False)
        code, stdout, _stderr = self.run_restore(tools)
        self.assertEqual(code, EXIT_OK)
        self.assertFalse(json.loads(stdout)['restored_at_stamped'])
        self.assertFalse([call for call in tools.calls if STAMP_SQL in call])

    def test_a_failed_stamp_is_a_refusal_not_a_verified_copy(self):
        class Broken(ScriptedTools):
            def __call__(self, argv, **kwargs):
                if STAMP_SQL in [str(argument) for argument in argv]:
                    return Completed(1, stderr='ERROR:  permission denied for table control_plane_state\n')
                return super().__call__(argv, **kwargs)
        code, _stdout, stderr = self.run_restore(Broken())
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('stamping the restore time', stderr)

    def test_an_existing_target_database_is_refused_before_pg_restore_runs(self):
        tools = ScriptedTools(create_fails=True)
        code, _stdout, stderr = self.run_restore(tools)
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('already exists', stderr)
        self.assertEqual(tools.calls_to('pg_restore'), [])

    def test_a_tampered_artifact_is_refused_before_any_database_is_touched(self):
        (artifact,) = self.bucket.rglob(bp.ARTIFACT_CIPHERTEXT_NAME)
        data = bytearray(artifact.read_bytes())
        data[40] ^= 0xFF
        artifact.write_bytes(bytes(data))
        tools = ScriptedTools()
        code, _stdout, stderr = self.run_restore(tools)
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('does not match its manifest', stderr)
        self.assertEqual(tools.calls_to('psql') + tools.calls_to('pg_restore'), [])

    def test_a_wrong_passphrase_is_refused(self):
        self.passphrase.write_text('another passphrase of enough length\n', encoding='utf-8')
        tools = ScriptedTools()
        code, _stdout, stderr = self.run_restore(tools)
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('authentication', stderr)
        self.assertEqual(tools.calls_to('psql'), [])

    def test_a_database_that_is_not_a_scratch_name_or_is_a_live_name_is_refused(self):
        for index, name in enumerate(('odoo19', 'postgres', 'bad name', 'drop;table')):
            with self.subTest(name=name):
                tools = ScriptedTools()
                code, _stdout, _stderr = self.run_restore(tools, scratch=f'scratch-{index}', target=name)
                self.assertEqual(code, EXIT_REFUSED)
                self.assertEqual(tools.calls, [])

    def test_an_existing_scratch_root_is_refused(self):
        (self.root / 'scratch').mkdir()
        tools = ScriptedTools()
        code, _stdout, stderr = self.run_restore(tools)
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('--scratch-root', stderr)
        self.assertEqual(tools.calls, [])

    def test_a_restored_copy_older_than_the_control_plane_build_is_not_verified(self):
        code, stdout, _stderr = self.run_restore(ScriptedTools(), '--expect-migration', '57')
        self.assertEqual(code, EXIT_NOT_VERIFIED)
        self.assertFalse(json.loads(stdout)['checks']['migration_at_least_expected'])

    def test_a_difference_from_the_live_source_is_not_verified(self):
        drifted = {**OBSERVED, 'tables': {'customers': 4, 'invoices': 5}}
        code, stdout, _stderr = self.run_restore(
            ScriptedTools(source=drifted), '--compare-with', 'liwan_control_scratch_source')
        self.assertEqual(code, EXIT_NOT_VERIFIED)
        self.assertFalse(json.loads(stdout)['checks']['tables_equal_to_source'])

    def test_a_failed_read_names_the_database_and_is_a_refusal(self):
        class Broken(ScriptedTools):
            def __call__(self, argv, **kwargs):
                if VERIFY_SQL in [str(argument) for argument in argv]:
                    return Completed(1, stderr='ERROR:  relation "invoices" does not exist\n')
                return super().__call__(argv, **kwargs)

        code, _stdout, stderr = self.run_restore(Broken())
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('invoices', stderr)
        self.assertTrue(stderr.startswith('restore_control_plane:'))


class TestChecks(unittest.TestCase):
    def test_a_sequence_at_or_behind_the_highest_invoice_would_reuse_a_number(self):
        for last_value, is_called, ok in ((39, True, False), (40, True, True), (40, False, False), (41, False, True)):
            observed = {**OBSERVED, 'invoice_sequence': {'last_value': last_value, 'is_called': is_called}}
            with self.subTest(last_value=last_value, is_called=is_called):
                self.assertEqual(checks_for(observed, None, None)['sequence_ahead_of_invoices'], ok)

    def test_no_invoices_and_a_fresh_sequence_pass(self):
        observed = {**OBSERVED, 'highest_invoice_serial': None, 'invoice_sequence': {'last_value': 1, 'is_called': False}}
        self.assertTrue(all(checks_for(observed, None, None).values()))

    def test_a_database_without_migrations_is_not_the_control_plane(self):
        self.assertFalse(checks_for({**OBSERVED, 'migration': None}, None, None)['migrations_present'])


if __name__ == '__main__':
    unittest.main()
