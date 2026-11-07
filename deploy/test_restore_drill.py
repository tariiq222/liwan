# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the restore drill promises, proven offline against a filesystem store.

Each rule is checked by a test that fails when the rule is removed: a mismatched
digest never reaches a restore, a non-scratch or forbidden target is refused before
anything is fetched, and the record is written atomically with the RPO/RTO verdicts
computed from the artifact's own capture time and the measured elapsed seconds.

``openssl`` runs for real through the injected runner; the restore itself is faked,
because a real one needs PostgreSQL. Nothing here opens a socket or starts a database.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from deploy import backup_pipeline as bp
from deploy import restore_drill as drill
from deploy.s3_client import FilesystemStore

TENANT = 'acme'
STAMP = '2026-11-08T00:00:00+00:00'
PASSPHRASE = 'correct horse battery staple for liwan'
DUMP_BYTES = b'PGDMP a restored dump'
ATTACHMENT_BYTES = b'restored attachment'


@dataclass
class Completed:
    """The bit of ``subprocess.CompletedProcess`` the drill reads."""

    returncode: int = 0
    stdout: str = ''


class RecordingRunner:
    """Delegates to a handler, keeps every argv, and runs ``openssl`` for real."""

    def __init__(self, handler) -> None:
        self.calls: list[list[str]] = []
        self._handler = handler

    def __call__(self, argv, **kwargs):
        arguments = [str(argument) for argument in argv]
        self.calls.append(arguments)
        options = {name: value for name, value in kwargs.items() if name != 'check'}
        if Path(argv[0]).name == bp.OPENSSL_BINARY:
            return subprocess.run(argv, check=False, **options)
        return self._handler(arguments, **options)


def _real_openssl(handler) -> RecordingRunner:
    return RecordingRunner(handler)


class Runner(RecordingRunner):
    """A fake restore that writes the verifier's record; openssl runs for real."""

    def __init__(self, *, verified: bool = True, exit_code: int = 0,
                 writes_record: bool = True) -> None:
        self._verified = verified
        self._exit_code = exit_code
        self._writes_record = writes_record
        super().__init__(self._restore)

    def _restore(self, arguments, **_kwargs) -> Completed:
        backup_dir = Path(arguments[arguments.index('--backup-dir') + 1])
        # deploy/restore_verify.py refuses a backup directory that lacks any of the
        # three; the fake enforces the same precondition so the drill is proven to
        # stage all of them, not merely the two the artifact happens to carry.
        required = ('database.dump', 'filestore', 'manifest.json')
        missing = [name for name in required if not (backup_dir / name).exists()]
        if missing:
            message = f'restore_verify would refuse {backup_dir}: missing {missing}'
            raise AssertionError(message)
        if self._writes_record:
            (backup_dir / drill.RESTORE_VERIFICATION_NAME).write_text(json.dumps({
                'restore_verified': self._verified,
                'checks': {'liwan_modules_installed': 5, 'modules_stuck_mid_transition': 0,
                           'attachment_files_referenced': 1, 'missing_attachment_files': []},
            }), encoding='utf-8')
        return Completed(returncode=self._exit_code, stdout='{"restore_verified": false}')

    def restore_calls(self) -> list[list[str]]:
        return [call for call in self.calls if Path(call[0]).name != bp.OPENSSL_BINARY]


class DrillCase(unittest.TestCase):
    """A store holding one real captured artifact, and an empty scratch root."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix='liwan-drill-')).resolve()
        self.passphrase_file = self.root / 'passphrase'
        self.passphrase_file.write_text(PASSPHRASE + '\n', encoding='utf-8')
        self.passphrase_file.chmod(0o600)
        self.store = FilesystemStore(self.root / 'bucket')
        self.scratch_root = self.root / 'scratch'
        self.source_root = self.root / 'source'
        self.manifest = self.capture(now=datetime.fromisoformat(STAMP))
        self.tools = drill.RestoreTools(
            pg_restore=self.root / 'pg_restore',
            createdb=self.root / 'createdb',
            psql=self.root / 'psql',
        )
        for tool in (self.tools.pg_restore, self.tools.createdb, self.tools.psql):
            tool.write_text('', encoding='utf-8')

    def tearDown(self) -> None:
        for path in sorted(self.root.rglob('*'), reverse=True):
            if path.is_symlink() or path.is_file():
                path.unlink()
            else:
                path.rmdir()
        self.root.rmdir()

    def capture(self, *, now: datetime, kind: str = 'hourly') -> bp.BackupManifest:
        return self.capture_into(self.store, TENANT, now=now, kind=kind)

    def capture_into(self, store, tenant: str, *, now: datetime,
                     kind: str = 'hourly') -> bp.BackupManifest:
        """A real capture whose encrypted bytes are produced by the pipeline itself."""
        filestore = self.root / 'data' / 'filestore' / 'liwan_scratch'
        filestore.mkdir(parents=True, exist_ok=True)
        pg_dump = self.root / 'pg_dump'
        pg_dump.write_text('', encoding='utf-8')

        def fake_backup(argv, **_kwargs):
            """Fake ``deploy/backup.py``; ``openssl`` still runs for real."""
            output = Path(argv[argv.index('--output-dir') + 1])
            (output / 'filestore' / 'ab').mkdir(parents=True, exist_ok=True)
            (output / 'database.dump').write_bytes(DUMP_BYTES)
            (output / 'filestore' / 'ab' / 'cdef').write_bytes(ATTACHMENT_BYTES)
            return Completed()

        return bp.capture(
            store=store,
            tenant=tenant,
            source=bp.CaptureSource(db_name='liwan_scratch', filestore=filestore,
                                    pg_dump=pg_dump),
            kind=kind,
            work_root=self.root / 'capture-work' / tenant / kind,
            passphrase_file=self.passphrase_file,
            now=now,
            runner=_real_openssl(fake_backup),
        )

    def run_drill(self, *, target_db: str = 'liwan_drill_scratch', now: datetime | None = None,
                  runner=None, record_path: Path | None = None,
                  scratch_root: Path | None = None) -> dict[str, object]:
        return drill.run_drill(
            self.store,
            TENANT,
            scratch_root=scratch_root or self.scratch_root,
            target_db=target_db,
            passphrase_file=self.passphrase_file,
            runner=runner or Runner(),
            now=now or datetime.fromisoformat(STAMP) + timedelta(minutes=5),
            tools=self.tools,
            record_path=record_path,
        )

    def record(self) -> dict[str, object]:
        path = drill.drill_record_path(self.scratch_root)
        return json.loads(path.read_text(encoding='utf-8'))

    def artifact_key(self) -> str:
        return self.store.list(f'{TENANT}/')[0].rsplit('/', 1)[0] + '/' + bp.ARTIFACT_CIPHERTEXT_NAME

    def manifest_key(self) -> str:
        return self.artifact_key().rsplit('/', 1)[0] + '/' + bp.MANIFEST_NAME


class TestSuccessfulDrill(DrillCase):
    def test_it_writes_every_field_the_record_must_carry(self):
        started_at = datetime.fromisoformat(STAMP) + timedelta(minutes=5)
        record = self.run_drill(now=started_at)
        for field in ('schema_version', 'started_at', 'finished_at', 'elapsed_seconds',
                      'tenant', 'target_db', 'artifact_key', 'source_manifest_sha256',
                      'restore_verified', 'rpo_ok', 'rto_ok', 'not_covered'):
            self.assertIn(field, record)
        self.assertEqual(record['schema_version'], drill.RECORD_SCHEMA_VERSION)
        self.assertEqual(record['tenant'], TENANT)
        self.assertEqual(record['target_db'], 'liwan_drill_scratch')
        self.assertEqual(record['artifact_key'], self.artifact_key())
        self.assertTrue(record['restore_verified'])
        self.assertEqual(record['not_covered'], list(drill.NOT_COVERED))

    def test_the_record_on_disk_matches_what_was_returned(self):
        returned = self.run_drill()
        self.assertEqual(self.record(), json.loads(json.dumps(returned)))

    def test_the_source_manifest_digest_names_the_manifest_it_read(self):
        record = self.run_drill()
        staged = (self.scratch_root / drill.BACKUP_DIR_NAME / 'manifest.json').read_bytes()
        self.assertEqual(record['source_manifest_sha256'], hashlib.sha256(staged).hexdigest())
        self.assertEqual(staged, self.store.get(self.manifest_key()))

    def test_the_rpo_uses_the_artifact_capture_time(self):
        record = self.run_drill(now=datetime.fromisoformat(STAMP) + timedelta(minutes=30))
        self.assertTrue(record['rpo_ok'])
        stale = self.run_drill(
            now=datetime.fromisoformat(STAMP) + timedelta(seconds=bp.RPO_SECONDS + 60),
            scratch_root=self.root / 'stale-scratch',
        )
        self.assertFalse(stale['rpo_ok'])

    def test_the_rto_uses_the_measured_elapsed_seconds(self):
        ticks = iter([100.0, 100.0 + bp.RTO_SECONDS])
        inside = drill.run_drill(
            self.store, TENANT, scratch_root=self.root / 'fast', target_db='liwan_fast_scratch',
            passphrase_file=self.passphrase_file, runner=Runner(),
            now=datetime.fromisoformat(STAMP), tools=self.tools, clock=lambda: next(ticks),
        )
        self.assertTrue(inside['rto_ok'])
        self.assertEqual(inside['elapsed_seconds'], bp.RTO_SECONDS)
        ticks = iter([100.0, 100.0 + bp.RTO_SECONDS + 1])
        outside = drill.run_drill(
            self.store, TENANT, scratch_root=self.root / 'slow', target_db='liwan_slow_scratch',
            passphrase_file=self.passphrase_file, runner=Runner(),
            now=datetime.fromisoformat(STAMP), tools=self.tools, clock=lambda: next(ticks),
        )
        self.assertFalse(outside['rto_ok'])

    def test_it_restores_into_the_declared_scratch_database(self):
        runner = Runner()
        self.run_drill(runner=runner)
        argv = runner.restore_calls()[0]
        self.assertEqual(argv[argv.index('--target-db') + 1], 'liwan_drill_scratch')
        self.assertEqual(Path(argv[argv.index('--target-filestore') + 1]),
                         self.scratch_root / 'filestore' / 'liwan_drill_scratch')

    def test_the_restore_script_is_the_repository_one(self):
        runner = Runner()
        self.run_drill(runner=runner)
        self.assertEqual(Path(runner.restore_calls()[0][1]).name, 'restore_verify.py')

    def test_it_stages_everything_restore_verify_needs_before_restoring(self):
        self.run_drill()
        backup_dir = self.scratch_root / drill.BACKUP_DIR_NAME
        self.assertEqual((backup_dir / 'database.dump').read_bytes(), DUMP_BYTES)
        self.assertEqual((backup_dir / 'filestore' / 'ab' / 'cdef').read_bytes(),
                         ATTACHMENT_BYTES)
        # The verifier requires a manifest; the drill must supply the verified one,
        # byte for byte, so the restore records the capture-time manifest.
        self.assertEqual((backup_dir / 'manifest.json').read_bytes(),
                         self.store.get(self.manifest_key()))

    def test_the_passphrase_never_appears_in_any_argv(self):
        runner = Runner()
        self.run_drill(runner=runner)
        for call in runner.calls:
            self.assertNotIn(PASSPHRASE, call)
        decrypt = next(call for call in runner.calls if Path(call[0]).name == bp.OPENSSL_BINARY)
        self.assertEqual(decrypt[-1], 'file:' + str(self.passphrase_file))

    def test_the_newest_artifact_is_the_one_drilled(self):
        daily = self.capture(now=datetime.fromisoformat(STAMP) + timedelta(hours=2),
                             kind='daily')
        record = self.run_drill(now=datetime.fromisoformat(STAMP) + timedelta(hours=3))
        self.assertEqual(record['artifact_key'], bp.artifact_prefix(
            TENANT, 'daily', daily.captured_at,
        ) + bp.ARTIFACT_CIPHERTEXT_NAME)


class TestRefusals(DrillCase):
    def test_a_non_scratch_target_is_refused(self):
        with self.assertRaises(drill.DrillError):
            self.run_drill(target_db='liwan_customer')

    def test_a_forbidden_name_is_refused_even_with_scratch_in_it(self):
        for name in ('odoo19', 'prod', 'production', 'postgres', 'template0', 'template1',
                     'odoo19_scratch', 'production_scratch', 'template0_scratch',
                     'liwan_prod_scratch'):
            with self.subTest(name=name), self.assertRaises(drill.DrillError):
                self.run_drill(target_db=name)
        self.assertFalse(drill.drill_record_path(self.scratch_root).exists())

    def test_a_refused_target_fetches_nothing(self):
        runner = Runner()
        with self.assertRaises(drill.DrillError):
            self.run_drill(target_db='odoo19', runner=runner)
        self.assertEqual(runner.calls, [])

    def test_an_artifact_whose_sha256_disagrees_with_its_manifest_is_refused(self):
        manifest = bp.BackupManifest.from_json(
            self.store.get(self.manifest_key()).decode('utf-8'),
        )
        tampered = dict(manifest.payload(), ciphertext_sha256='0' * 64)
        self.store.delete(self.manifest_key())
        self.store.put(self.manifest_key(),
                       (json.dumps(tampered, indent=2, sort_keys=True) + '\n').encode('utf-8'))
        runner = Runner()
        with self.assertRaises(drill.DrillError):
            self.run_drill(runner=runner)
        self.assertEqual(runner.restore_calls(), [])
        self.assertFalse(drill.drill_record_path(self.scratch_root).exists())

    def test_a_truncated_artifact_is_refused_by_the_ciphertext_digest(self):
        key = self.artifact_key()
        ciphertext = self.store.get(key)
        self.store.delete(key)
        self.store.put(key, ciphertext[:len(ciphertext) // 2])
        with self.assertRaises(drill.DrillError):
            self.run_drill()

    def test_a_manifest_that_pins_the_wrong_plaintext_digest_is_refused(self):
        payload = json.loads(self.store.get(self.manifest_key()))
        payload['plaintext_sha256'] = '0' * 64
        # The ciphertext digest is untouched, so the artifact is accepted and the
        # decrypted plaintext is what fails the comparison.
        payload['ciphertext_sha256'] = hashlib.sha256(self.store.get(self.artifact_key())).hexdigest()
        self.store.delete(self.manifest_key())
        self.store.put(self.manifest_key(), json.dumps(payload).encode('utf-8'))
        runner = Runner()
        with self.assertRaises(drill.DrillError):
            self.run_drill(runner=runner)
        self.assertEqual(runner.restore_calls(), [])

    def test_an_unreadable_manifest_is_refused(self):
        self.store.delete(self.manifest_key())
        self.store.put(self.manifest_key(), b'not a manifest')
        with self.assertRaises(bp.PipelineError):
            self.run_drill()

    def test_a_tenant_with_no_artifact_is_refused(self):
        with self.assertRaises(drill.DrillError):
            drill.run_drill(
                self.store, 'empty', scratch_root=self.scratch_root,
                target_db='liwan_empty_scratch', passphrase_file=self.passphrase_file,
                runner=Runner(), now=datetime.fromisoformat(STAMP), tools=self.tools,
            )

    def test_a_failing_restore_is_recorded_as_not_verified(self):
        record = self.run_drill(runner=Runner(verified=False, exit_code=1))
        self.assertFalse(record['restore_verified'])
        self.assertFalse(self.record()['restore_verified'])

    def test_a_passing_record_from_a_failing_process_is_not_verified(self):
        # The verifier's JSON and its exit code are two pieces of evidence; the drill
        # trusts neither alone, so a contradiction cannot produce a "verified" record.
        record = self.run_drill(runner=Runner(verified=True, exit_code=1))
        self.assertFalse(record['restore_verified'])
        self.assertFalse(self.record()['restore_verified'])

    def test_a_restore_that_writes_no_record_is_refused(self):
        with self.assertRaises(drill.DrillError):
            self.run_drill(runner=Runner(writes_record=False))

    def test_a_target_filestore_that_already_exists_is_refused(self):
        (self.scratch_root / 'filestore' / 'liwan_drill_scratch').mkdir(parents=True)
        with self.assertRaises(drill.DrillError):
            self.run_drill()

    def test_a_relative_scratch_root_is_refused(self):
        with self.assertRaises(drill.DrillError):
            drill.run_drill(
                self.store, TENANT, scratch_root=Path('scratch'),
                target_db='liwan_relative_scratch', passphrase_file=self.passphrase_file,
                runner=Runner(), now=datetime.fromisoformat(STAMP), tools=self.tools,
            )


class TestRecordWriting(DrillCase):
    def test_the_record_is_replaced_atomically_and_no_temporary_file_is_left(self):
        record_path = drill.drill_record_path(self.scratch_root)
        record_path.parent.mkdir(parents=True, exist_ok=True)
        record_path.write_text(json.dumps({'restore_verified': False}), encoding='utf-8')
        self.run_drill()
        self.assertTrue(self.record()['restore_verified'])
        self.assertEqual(list(record_path.parent.glob('.*.tmp')), [])

    def test_a_custom_record_path_is_honoured(self):
        custom = self.root / 'reports' / 'drill.json'
        self.run_drill(record_path=custom)
        self.assertTrue(json.loads(custom.read_text(encoding='utf-8'))['restore_verified'])

    def test_a_failure_after_the_artifact_was_fetched_leaves_the_old_record_alone(self):
        record_path = drill.drill_record_path(self.scratch_root)
        record_path.parent.mkdir(parents=True, exist_ok=True)
        record_path.write_text(json.dumps({'restore_verified': False}), encoding='utf-8')
        with self.assertRaises(drill.DrillError):
            self.run_drill(record_path=record_path, runner=Runner(writes_record=False))
        self.assertEqual(json.loads(record_path.read_text(encoding='utf-8')),
                         {'restore_verified': False})


class TestStatusAfterADrill(DrillCase):
    def test_a_fresh_passing_drill_reads_as_verified_from_the_pipeline(self):
        # The clock is real here: the point is that a drill which just finished
        # reads back as fresh without any caller-supplied `now`.
        started_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        store = FilesystemStore(self.root / 'fresh-bucket')
        manifest = self.capture_into(store, 'fresh', now=started_at)
        ticks = iter([0.0, 60.0])
        drill.run_drill(
            store, 'fresh', scratch_root=self.root / 'fresh-scratch',
            target_db='liwan_status_scratch', passphrase_file=self.passphrase_file,
            runner=Runner(), now=started_at, tools=self.tools, clock=lambda: next(ticks),
        )
        record_path = drill.drill_record_path(self.root / 'fresh-scratch')
        report = bp.status(record_path)
        self.assertEqual(report['artifact_captured_at'], manifest.captured_at.isoformat())
        self.assertTrue(report['rpo_ok'])
        self.assertTrue(report['rto_ok'])
        self.assertTrue(report['restore_verified'])
        self.assertTrue(bp.restore_verified(record_path))


class TestCommandLine(DrillCase):
    def run_main(self, argv) -> tuple[int, str, str]:
        """Run the CLI with the restore runner injected, never a real database."""
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = drill.main(argv, runner=Runner(), tools=self.tools)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_status_of_a_missing_record_exits_three(self):
        code, stdout, _stderr = self.run_main([
            'status', '--record', str(self.root / 'absent.json'),
        ])
        self.assertEqual(code, drill.EXIT_NOT_VERIFIED)
        self.assertFalse(json.loads(stdout)['restore_verified'])

    def test_a_refused_target_exits_two(self):
        code, _stdout, stderr = self.run_main([
            'run', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'odoo19', '--store-root', str(self.root / 'bucket'),
        ])
        self.assertEqual(code, drill.EXIT_REFUSED)
        self.assertIn('restore_drill:', stderr)

    def test_a_missing_passphrase_variable_exits_two(self):
        code, _stdout, stderr = self.run_main([
            'run', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'liwan_cli_scratch', '--store-root', str(self.root / 'bucket'),
        ])
        self.assertEqual(code, drill.EXIT_REFUSED)
        self.assertIn(bp.PASSPHRASE_ENVIRONMENT_VARIABLE, stderr)

    def test_a_successful_run_exits_zero_and_prints_the_record(self):
        argv = [
            'run', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'liwan_cli_scratch', '--store-root', str(self.root / 'bucket'),
            '--now', STAMP,
        ]
        with _environment({bp.PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}):
            code, stdout, stderr = self.run_main(argv)
        self.assertEqual((code, stderr), (drill.EXIT_OK, ''))
        self.assertTrue(json.loads(stdout)['restore_verified'])

    def test_a_failing_restore_exits_three(self):
        argv = [
            'run', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'liwan_cli_scratch', '--store-root', str(self.root / 'bucket'),
            '--now', STAMP,
        ]
        stdout = io.StringIO()
        with _environment({bp.PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}), \
                contextlib.redirect_stdout(stdout):
            code = drill.main(argv, runner=Runner(verified=False, exit_code=1),
                              tools=self.tools)
        self.assertEqual(code, drill.EXIT_NOT_VERIFIED)
        self.assertFalse(json.loads(stdout.getvalue())['restore_verified'])


class _environment:
    """Set environment variables for the duration of a test block."""

    def __init__(self, values) -> None:
        self._values = dict(values)
        self._saved: dict[str, str | None] = {}

    def __enter__(self):
        for name in self._values:
            self._saved[name] = os.environ.get(name)
        os.environ.update(self._values)
        return self

    def __exit__(self, *_exception):
        for name, value in self._saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        return False


if __name__ == '__main__':
    unittest.main()
