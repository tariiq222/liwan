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
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from deploy import backup, restore_verify
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
        # Stop at the database boundary: exercise the production CLI parser first.
        with patch.object(restore_verify, 'perform_restore', return_value={'restore_verified': True, 'checks': {}}), \
                contextlib.redirect_stdout(io.StringIO()):
            restore_verify.main(arguments[2:])
        backup_dir = Path(arguments[arguments.index('--backup-dir') + 1])
        # deploy/restore_verify.py refuses a backup directory that lacks any of the
        # three; the fake enforces the same precondition so the drill is proven to
        # stage all of them, not merely the two the artifact happens to carry.
        required = ('database.dump', 'filestore', 'manifest.json')
        missing = [name for name in required if not (backup_dir / name).exists()]
        if missing:
            message = f'restore_verify would refuse {backup_dir}: missing {missing}'
            raise AssertionError(message)
        self.backup_dir = backup_dir
        self.staged = {name: (backup_dir / name).read_bytes() for name in ('database.dump', 'filestore/ab/cdef', 'manifest.json')}
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
            psql=self.root / 'psql',
        )
        for tool in (self.tools.pg_restore, self.tools.psql):
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
                     kind: str = 'hourly', alter_after_manifest: bool = False) -> bp.BackupManifest:
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
            # The manifest deploy/backup.py itself writes, from its own helpers.
            backup.write_manifest(output / 'manifest.json', backup.candidate_manifest_payload(
                db='liwan_scratch', store=filestore, backup_dir=output, http_observation=None))
            if alter_after_manifest:
                # Same size, different bytes: the file changed after backup.py pinned it.
                (output / 'filestore' / 'ab' / 'cdef').write_bytes(b'x' * len(ATTACHMENT_BYTES))
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
            record_path=record_path, pg_user='scratch_operator',
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
        runner = Runner()
        record = self.run_drill(runner=runner)
        self.assertFalse(runner.backup_dir.exists())
        self.assertEqual(
            record['source_manifest_sha256'], hashlib.sha256(self.store.get(self.manifest_key())).hexdigest(),
        )

    def test_the_rpo_uses_the_artifact_capture_time(self):
        record = self.run_drill(now=datetime.fromisoformat(STAMP) + timedelta(minutes=30))
        self.assertTrue(record['rpo_ok'])
        stale = self.run_drill(
            now=datetime.fromisoformat(STAMP) + timedelta(seconds=bp.RPO_SECONDS + 60),
            scratch_root=self.root / 'stale-scratch',
        )
        self.assertFalse(stale['rpo_ok'])
        self.assertFalse(stale['restore_verified'])

    def test_the_rto_uses_the_measured_elapsed_seconds(self):
        ticks = iter([100.0, 100.0 + bp.RTO_SECONDS])
        inside = drill.run_drill(
            self.store, TENANT, scratch_root=self.root / 'fast', target_db='liwan_fast_scratch',
            passphrase_file=self.passphrase_file, runner=Runner(),
            now=datetime.fromisoformat(STAMP), tools=self.tools, pg_user='scratch_operator', clock=lambda: next(ticks),
        )
        self.assertTrue(inside['rto_ok'])
        self.assertTrue(inside['rpo_ok'])
        self.assertTrue(inside['restore_verified'])
        self.assertEqual(inside['elapsed_seconds'], bp.RTO_SECONDS)
        ticks = iter([100.0, 100.0 + bp.RTO_SECONDS + 1])
        outside = drill.run_drill(
            self.store, TENANT, scratch_root=self.root / 'slow', target_db='liwan_slow_scratch',
            passphrase_file=self.passphrase_file, runner=Runner(),
            now=datetime.fromisoformat(STAMP), tools=self.tools, pg_user='scratch_operator', clock=lambda: next(ticks),
        )
        self.assertFalse(outside['rto_ok'])
        self.assertFalse(outside['restore_verified'])

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
        runner = Runner()
        self.run_drill(runner=runner)
        self.assertEqual(runner.staged['database.dump'], DUMP_BYTES)
        self.assertEqual(runner.staged['filestore/ab/cdef'], ATTACHMENT_BYTES)
        pinned = json.loads(runner.staged['manifest.json'])
        self.assertEqual(pinned['database_dump_sha256'], hashlib.sha256(DUMP_BYTES).hexdigest())
        self.assertEqual(pinned['filestore_file_count'], 1)
        self.assertNotEqual(runner.staged['manifest.json'], self.store.get(self.manifest_key()))
        self.assertFalse(runner.backup_dir.exists())

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


class VerifyingRunner(RecordingRunner):
    """Runs the real ``restore_verify.perform_restore``; only PostgreSQL is faked."""

    MODULES = 'liwan_api\nliwan_core\n'

    def __init__(self) -> None:
        super().__init__(self._restore)

    def _restore(self, arguments, **_kwargs) -> Completed:
        options = dict(zip(arguments[2::2], arguments[3::2]))
        with patch.object(restore_verify, 'expected_modules', return_value=['liwan_api', 'liwan_core']):
            result = restore_verify.perform_restore(
                backup_dir=options['--backup-dir'], target_db=options['--target-db'],
                target_filestore=options['--target-filestore'], pg_restore=options['--pg-restore'],
                psql=options['--psql'], pg_user=options['--pg-user'], runner=self._postgres,
            )
        return Completed(returncode=0 if result['restore_verified'] else 1)

    def _postgres(self, argv, input=None, **_kwargs) -> Completed:
        if Path(argv[0]).name != 'psql' or input is not None:
            return Completed()
        sql = argv[argv.index('-c') + 1]
        if 'ir_attachment' in sql:
            return Completed(stdout='ab/cdef\n')
        return Completed(stdout='0\n' if 'count(*)' in sql else self.MODULES)


class TestManifestIsVerified(DrillCase):
    """The drill hands restore_verify the manifest backup.py wrote, and nothing mocks the check."""

    def test_the_extracted_backup_passes_the_real_integrity_check(self):
        record = self.run_drill(runner=VerifyingRunner())
        self.assertTrue(record['restore_verified'])
        self.assertEqual(record['checks']['backup_integrity_mismatches'], [])
        self.assertEqual(record['checks']['filestore_files_expected'], 1)
        self.assertEqual(record['checks']['filestore_files_actual'], 1)

    def test_a_file_altered_after_capture_is_reported_and_not_verified(self):
        self.store = FilesystemStore(self.root / 'altered-bucket')
        self.capture_into(self.store, TENANT, now=datetime.fromisoformat(STAMP), alter_after_manifest=True)
        record = self.run_drill(runner=VerifyingRunner())
        self.assertFalse(record['restore_verified'])
        self.assertEqual(record['checks']['backup_integrity_mismatches'], ['filestore_sha256'])


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
        key = self.artifact_key()
        ciphertext = self.store.get(key)
        self.store.delete(key)
        self.store.put(key, bytes([ciphertext[0] ^ 1]) + ciphertext[1:])
        runner = Runner()
        with self.assertRaisesRegex(drill.DrillError, 'ciphertext sha256'):
            self.run_drill(runner=runner)
        self.assertEqual(runner.calls, [])
        self.assertFalse(drill.drill_record_path(self.scratch_root).exists())

    def test_a_truncated_artifact_is_refused_by_the_ciphertext_digest(self):
        key = self.artifact_key()
        ciphertext = self.store.get(key)
        self.store.delete(key)
        self.store.put(key, ciphertext[:len(ciphertext) // 2])
        with self.assertRaises(drill.DrillError):
            self.run_drill()

    def test_a_manifest_that_pins_the_wrong_plaintext_digest_is_refused(self):
        # Model a producer bug: the authenticated manifest pins a wrong plaintext
        # digest. The drill must still decrypt and compare before restoring.
        wrong = replace(self.manifest, plaintext_sha256='0' * 64)
        self.store.delete(self.manifest_key())
        self.store.put(self.manifest_key(), wrong.to_json(self.passphrase_file).encode())
        runner = Runner()
        with self.assertRaisesRegex(drill.DrillError, 'decrypted to sha256'):
            self.run_drill(runner=runner)
        self.assertEqual(runner.restore_calls(), [])

    def test_transplanted_ciphertext_with_rewritten_tenant_is_refused_before_download(self):
        class ObservableStore(FilesystemStore):
            def __init__(self, root):
                super().__init__(root)
                self.downloads = []

            def get_file(self, key, target, *, expected_size):
                self.downloads.append(key)
                return super().get_file(key, target, expected_size=expected_size)

        other_tenant = 'another-tenant'
        store = ObservableStore(self.root / 'other-bucket')
        prefix = bp.artifact_prefix(other_tenant, 'hourly', datetime.fromisoformat(STAMP))
        store.put(prefix + bp.ARTIFACT_CIPHERTEXT_NAME, self.store.get(self.artifact_key()))
        manifest = json.loads(self.store.get(self.manifest_key()))
        manifest['tenant'] = other_tenant
        store.put(prefix + bp.MANIFEST_NAME, json.dumps(manifest).encode())
        with self.assertRaisesRegex(bp.PipelineError, 'manifest authentication'):
            drill.run_drill(
                store, other_tenant, scratch_root=self.scratch_root,
                target_db='liwan_drill_scratch', passphrase_file=self.passphrase_file,
                runner=Runner(), now=datetime.fromisoformat(STAMP), tools=self.tools,
                pg_user='scratch_operator',
            )
        self.assertEqual(store.downloads, [])

    def test_manifest_identity_must_match_the_requested_bucket_key(self):
        for change in ({'tenant': 'other'}, {'kind': 'daily'},
                       {'captured_at': datetime.fromisoformat(STAMP) + timedelta(seconds=1)}):
            with self.subTest(change=change):
                wrong = replace(self.manifest, **change)
                self.store.delete(self.manifest_key())
                self.store.put(self.manifest_key(), wrong.to_json(self.passphrase_file).encode())
                runner = Runner()
                with self.assertRaises(drill.DrillError):
                    self.run_drill(runner=runner, scratch_root=self.root / f'drill-{next(iter(change))}')
                self.assertEqual(runner.calls, [])

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
                runner=Runner(), now=datetime.fromisoformat(STAMP), tools=self.tools, pg_user='scratch_operator',
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
                runner=Runner(), now=datetime.fromisoformat(STAMP), tools=self.tools, pg_user='scratch_operator',
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
            runner=Runner(), now=started_at, tools=self.tools, pg_user='scratch_operator', clock=lambda: next(ticks),
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
            '--target-db', 'odoo19', '--store-root', str(self.root / 'bucket'), '--pg-user', 'scratch_operator',
        ])
        self.assertEqual(code, drill.EXIT_REFUSED)
        self.assertIn('restore_drill:', stderr)

    def test_a_missing_passphrase_variable_exits_two(self):
        code, _stdout, stderr = self.run_main([
            'run', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'liwan_cli_scratch', '--store-root', str(self.root / 'bucket'), '--pg-user', 'scratch_operator',
        ])
        self.assertEqual(code, drill.EXIT_REFUSED)
        self.assertIn(bp.PASSPHRASE_ENVIRONMENT_VARIABLE, stderr)

    def test_a_successful_run_exits_zero_and_prints_the_record(self):
        argv = [
            'run', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'liwan_cli_scratch', '--store-root', str(self.root / 'bucket'), '--pg-user', 'scratch_operator',
            '--now', STAMP,
        ]
        with _environment({bp.PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}):
            code, stdout, stderr = self.run_main(argv)
        self.assertEqual((code, stderr), (drill.EXIT_OK, ''))
        self.assertTrue(json.loads(stdout)['restore_verified'])

    def test_a_restore_that_misses_rpo_exits_three_in_run_and_status(self):
        run = [
            'run', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'liwan_cli_scratch', '--store-root', str(self.root / 'bucket'),
            '--pg-user', 'scratch_operator', '--now', '2026-11-08T06:00:00+00:00',
        ]
        with _environment({bp.PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}):
            code, stdout, stderr = self.run_main(run)
        self.assertEqual((code, stderr), (drill.EXIT_NOT_VERIFIED, ''))
        self.assertFalse(json.loads(stdout)['rpo_ok'])
        code, stdout, stderr = self.run_main([
            'status', '--record', str(drill.drill_record_path(self.scratch_root)),
            '--now', '2026-11-08T06:00:01+00:00',
        ])
        self.assertEqual((code, stderr), (drill.EXIT_NOT_VERIFIED, ''))
        self.assertFalse(json.loads(stdout)['restore_verified'])

    def test_a_failing_restore_exits_three(self):
        argv = [
            'run', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'liwan_cli_scratch', '--store-root', str(self.root / 'bucket'), '--pg-user', 'scratch_operator',
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
