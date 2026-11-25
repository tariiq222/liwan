# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the restore drill promises, proven offline against a filesystem store.

Each rule is checked by a test that fails when the rule is removed: an artifact whose
ciphertext or plaintext disagrees with its manifest is refused before a database is
created, a non-scratch or forbidden target is refused before anything is fetched, the
snapshot manifest frozen inside the artifact still pins its dump, object index and object
count, and the record is written atomically with the RPO/RTO verdicts computed from the
artifact's own capture time and the measured elapsed seconds.

``openssl`` runs for real through the injected runner; PostgreSQL is faked, because the
real one needs a server. Nothing here opens a socket or starts a database.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import subprocess
import tempfile
import time
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from deploy.backup import artifact, bucket, recover, snapshot, verify
from deploy.backup.capture import RPO_SECONDS, RTO_SECONDS, capture, status
from deploy.backup.cli import EXIT_NOT_VERIFIED, EXIT_OK, EXIT_REFUSED, main
from deploy.backup.drill import (
    NOT_COVERED,
    RECORD_SCHEMA_VERSION,
    drill_record_path,
    run_drill,
)
from deploy.backup.artifact import PASSPHRASE_ENVIRONMENT_VARIABLE
from deploy.backup.errors import BackupError
from deploy.backup.verify import PostgresConnection, RestoreTools
from deploy.s3_client import FilesystemStore, StorageError

TENANT = 'acme'
STAMP = '2026-11-08T00:00:00+00:00'
PASSPHRASE = 'correct horse battery staple for liwan'
DUMP_BYTES = b'PGDMP a restored dump'
ATTACHMENT_BYTES = b'restored attachment'
MODULES_ANSWER = 'liwan_api\nliwan_core\n'


class Completed:
    """The bit of ``subprocess.CompletedProcess`` the pipeline reads."""

    def __init__(self, returncode: int = 0, stdout: str = '') -> None:
        self.returncode, self.stdout = returncode, stdout


class OpensslRunner:
    """Records every argv and runs ``openssl`` for real; a later command is an error."""

    def __init__(self, handler=None) -> None:
        self.calls: list[list[str]] = []
        self._handler = handler or (lambda argv, **_kwargs: Completed())

    def __call__(self, argv, **kwargs):
        arguments = [str(argument) for argument in argv]
        self.calls.append(arguments)
        options = {name: value for name, value in kwargs.items() if name != 'check'}
        if Path(argv[0]).name == artifact.OPENSSL_BINARY:
            return subprocess.run(argv, check=False, **options)
        return self._handler(arguments, **options)

    def openssl_calls(self) -> list[list[str]]:
        return [call for call in self.calls if Path(call[0]).name == artifact.OPENSSL_BINARY]


class Postgres:
    """The PostgreSQL client seam: the provisioning and read-back answers, no server."""

    def __init__(self, *, modules: str = MODULES_ANSWER, stuck: str = '0\n',
                 attachments: str = 'ab/cdef\n', failing: str | None = None) -> None:
        self.modules, self.stuck, self.attachments = modules, stuck, attachments
        self.failing = failing
        self.calls: list[list[str]] = []

    def __call__(self, argv, input=None, **_kwargs) -> Completed:
        arguments = [str(argument) for argument in argv]
        self.calls.append(arguments)
        if self.failing and self.failing in (input or ''):
            return Completed(returncode=1)
        if Path(argv[0]).name == 'psql' and input is None:
            sql = arguments[arguments.index('-c') + 1]
            if 'ir_attachment' in sql:
                return Completed(stdout=self.attachments)
            if 'count(*)' in sql:
                return Completed(stdout=self.stuck)
            return Completed(stdout=self.modules)
        return Completed()

    def pg_restore_calls(self) -> list[list[str]]:
        return [call for call in self.calls if Path(call[0]).name == 'pg_restore']


class DrillCase(unittest.TestCase):
    """A store holding one real captured artifact, a scratch root and a fake PostgreSQL."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix='liwan-drill-')).resolve()
        self.passphrase_file = self.root / 'passphrase'
        self.passphrase_file.write_text(PASSPHRASE + '\n', encoding='utf-8')
        self.passphrase_file.chmod(0o600)
        self.store = FilesystemStore(self.root / 'bucket')
        self.scratch_root = self.root / 'scratch'
        self.pg_dump = self.root / 'pg_dump'
        self.pg_dump.write_text('', encoding='utf-8')
        self.filestore = self.root / 'data' / 'filestore' / 'liwan_scratch'
        (self.filestore / 'ab').mkdir(parents=True)
        (self.filestore / 'ab' / 'cdef').write_bytes(ATTACHMENT_BYTES)
        self.manifest = self.capture(now=datetime.fromisoformat(STAMP))
        self.postgres = Postgres()
        self.tools = RestoreTools(
            pg_restore=self.binary('pg_restore'), psql=self.binary('psql'), runner=self.postgres,
        )
        patcher = mock.patch.object(verify, 'expected_modules',
                                    return_value=['liwan_api', 'liwan_core'])
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self) -> None:
        for path in sorted(self.root.rglob('*'), reverse=True):
            if path.is_symlink() or not path.is_dir():
                path.unlink()
            else:
                path.rmdir()
        self.root.rmdir()

    def binary(self, name: str) -> Path:
        path = self.root / name
        path.write_text('', encoding='utf-8')
        return path

    def capture(self, *, now: datetime, kind: str = 'hourly') -> object:
        def fake_pg_dump(argv, **_kwargs) -> Completed:
            Path(argv[argv.index('-f') + 1]).write_bytes(DUMP_BYTES)
            return Completed()

        return capture(
            store=self.store,
            tenant=TENANT,
            source=snapshot.CaptureSource(
                db_name='liwan_scratch', bucket=bucket.DirectoryBucket(self.filestore),
                pg_dump=self.pg_dump,
            ),
            kind=kind,
            work_root=self.root / 'capture-work' / kind,
            passphrase_file=self.passphrase_file,
            now=now,
            runner=OpensslRunner(fake_pg_dump),
        )

    def run_drill(self, *, target_db: str = 'liwan_drill_scratch', now: datetime | None = None,
                  runner=None, record_path: Path | None = None,
                  scratch_root: Path | None = None, postgres: Postgres | None = None,
                  clock=None) -> dict[str, object]:
        return run_drill(
            self.store,
            TENANT,
            scratch_root=scratch_root or self.scratch_root,
            target_db=target_db,
            passphrase_file=self.passphrase_file,
            runner=runner or OpensslRunner(),
            now=now or datetime.fromisoformat(STAMP) + timedelta(minutes=5),
            tools=self.tools if postgres is None else replace(self.tools, runner=postgres),
            record_path=record_path,
            pg=PostgresConnection(user='scratch_operator'),
            clock=clock or time.monotonic,
        )

    def record(self) -> dict[str, object]:
        path = drill_record_path(self.scratch_root)
        return json.loads(path.read_text(encoding='utf-8'))

    def artifact_key(self, kind: str = 'hourly', captured_at: datetime | None = None) -> str:
        stamp = captured_at or datetime.fromisoformat(STAMP)
        return artifact.artifact_prefix(TENANT, kind, stamp) + artifact.ARTIFACT_CIPHERTEXT_NAME

    def manifest_key(self) -> str:
        return self.artifact_key().rsplit('/', 1)[0] + '/' + artifact.MANIFEST_NAME


class TestSuccessfulDrill(DrillCase):
    def test_it_writes_every_field_the_record_must_carry(self):
        record = self.run_drill()
        for field in ('schema_version', 'started_at', 'finished_at', 'elapsed_seconds',
                      'tenant', 'target_db', 'artifact_key', 'artifact_captured_at',
                      'source_manifest_sha256', 'restore_verified', 'rpo_ok', 'rto_ok',
                      'checks', 'not_covered'):
            self.assertIn(field, record)
        self.assertEqual(record['schema_version'], RECORD_SCHEMA_VERSION)
        self.assertEqual(record['tenant'], TENANT)
        self.assertEqual(record['target_db'], 'liwan_drill_scratch')
        self.assertEqual(record['artifact_key'], self.artifact_key())
        self.assertTrue(record['restore_verified'])
        self.assertEqual(record['not_covered'], list(NOT_COVERED))

    def test_the_record_on_disk_matches_what_was_returned(self):
        returned = self.run_drill()
        self.assertEqual(self.record(), json.loads(json.dumps(returned)))

    def test_the_source_manifest_digest_names_the_manifest_it_read(self):
        record = self.run_drill()
        self.assertEqual(
            record['source_manifest_sha256'],
            hashlib.sha256(self.store.get(self.manifest_key())).hexdigest(),
        )

    def test_the_inner_manifest_still_pins_the_dump_the_index_and_the_count(self):
        (self.root / 'fetched').mkdir()
        destination = self.root / 'fetched' / 'artifact'
        fetched = recover.fetch_artifact(
            self.store, recover.latest_artifact(self.store, TENANT), destination,
            passphrase_file=self.passphrase_file, runner=OpensslRunner(),
        )
        pinned = json.loads((fetched.artifact_dir / artifact.MANIFEST_NAME).read_text(encoding='utf-8'))
        contents = bucket.tree_manifest(fetched.artifact_dir / artifact.OBJECTS_DIRECTORY)
        self.assertEqual(pinned['database_sha256'], hashlib.sha256(DUMP_BYTES).hexdigest())
        self.assertEqual(
            (pinned['contents_sha256'], pinned['contents_object_count']),
            (contents.index_sha256, contents.object_count),
        )
        self.assertEqual(pinned['contents_object_bytes'], len(ATTACHMENT_BYTES))
        self.assertEqual(pinned['contents_object_count'], 1)
        self.assertEqual(pinned['consistency'], 'UNVERIFIED')
        self.assertNotIn('quiesce', pinned)

    def test_the_rpo_uses_the_artifact_capture_time(self):
        record = self.run_drill(now=datetime.fromisoformat(STAMP) + timedelta(minutes=30))
        self.assertTrue(record['rpo_ok'])
        stale = self.run_drill(
            now=datetime.fromisoformat(STAMP) + timedelta(seconds=RPO_SECONDS + 60),
            scratch_root=self.root / 'stale-scratch',
        )
        self.assertFalse(stale['rpo_ok'])
        self.assertFalse(stale['restore_verified'])

    def test_the_rto_uses_the_measured_elapsed_seconds(self):
        inside_ticks = iter([100.0, 100.0 + RTO_SECONDS])
        inside = self.run_drill(
            scratch_root=self.root / 'fast', target_db='liwan_fast_scratch',
            now=datetime.fromisoformat(STAMP), clock=lambda: next(inside_ticks),
        )
        self.assertTrue(inside['rto_ok'])
        self.assertTrue(inside['rpo_ok'])
        self.assertTrue(inside['restore_verified'])
        self.assertEqual(inside['elapsed_seconds'], RTO_SECONDS)
        outside_ticks = iter([100.0, 100.0 + RTO_SECONDS + 1])
        outside = self.run_drill(
            scratch_root=self.root / 'slow', target_db='liwan_slow_scratch',
            now=datetime.fromisoformat(STAMP), clock=lambda: next(outside_ticks),
        )
        self.assertFalse(outside['rto_ok'])
        self.assertFalse(outside['restore_verified'])

    def test_it_restores_into_the_declared_scratch_database_and_filestore(self):
        record = self.run_drill(postgres=self.postgres)
        argv = self.postgres.pg_restore_calls()[0]
        self.assertEqual(argv[argv.index('-d') + 1], 'liwan_drill_scratch')
        target = self.scratch_root / 'filestore' / 'liwan_drill_scratch'
        self.assertEqual((target / 'ab' / 'cdef').read_bytes(), ATTACHMENT_BYTES)
        self.assertEqual(record['target_db'], target.name)

    def test_the_fetched_artifact_is_private_and_removed_after_the_restore(self):
        self.run_drill()
        self.assertEqual(sorted(path.name for path in self.scratch_root.iterdir()),
                         sorted(['filestore', drill_record_path(self.scratch_root).name]))

    def test_the_passphrase_never_appears_in_any_argv(self):
        runner = OpensslRunner()
        self.run_drill(runner=runner)
        for call in runner.calls:
            self.assertNotIn(PASSPHRASE, call)
        decrypt = runner.openssl_calls()[-1]
        self.assertEqual(decrypt[decrypt.index('-pass') + 1], 'file:' + str(self.passphrase_file))

    def test_the_newest_artifact_is_the_one_drilled(self):
        daily = self.capture(now=datetime.fromisoformat(STAMP) + timedelta(hours=2), kind='daily')
        record = self.run_drill(now=datetime.fromisoformat(STAMP) + timedelta(hours=3))
        self.assertEqual(record['artifact_key'], self.artifact_key('daily', daily.captured_at))


class TestRefusals(DrillCase):
    def test_a_non_scratch_target_is_refused(self):
        for name in ('liwan_customer', 'liwan_dev'):
            with self.subTest(name=name), self.assertRaises(BackupError):
                self.run_drill(target_db=name)
        self.assertFalse(drill_record_path(self.scratch_root).exists())

    def test_a_forbidden_name_is_refused_even_with_scratch_in_it(self):
        for name in ('odoo19', 'prod', 'production', 'postgres', 'template0', 'template1',
                     'odoo19_scratch', 'production_scratch', 'template0_scratch',
                     'liwan_prod_scratch'):
            with self.subTest(name=name), self.assertRaises(BackupError):
                self.run_drill(target_db=name)
        self.assertFalse(drill_record_path(self.scratch_root).exists())

    def test_a_refused_target_fetches_nothing(self):
        runner = OpensslRunner()
        with self.assertRaises(BackupError):
            self.run_drill(target_db='odoo19', runner=runner)
        self.assertEqual(runner.calls, [])

    def test_an_artifact_whose_ciphertext_disagrees_with_its_manifest_is_refused(self):
        key = self.artifact_key()
        ciphertext = self.store.get(key)
        self.store.delete(key)
        self.store.put(key, bytes([ciphertext[0] ^ 1]) + ciphertext[1:])
        with self.assertRaisesRegex(BackupError, 'ciphertext digest differs'):
            self.run_drill()
        self.assertEqual(self.postgres.calls, [])
        self.assertFalse(drill_record_path(self.scratch_root).exists())

    def test_a_truncated_artifact_is_refused_by_the_ciphertext_digest(self):
        key = self.artifact_key()
        ciphertext = self.store.get(key)
        self.store.delete(key)
        self.store.put(key, ciphertext[:len(ciphertext) // 2])
        with self.assertRaises((BackupError, StorageError)):
            self.run_drill()
        self.assertEqual(self.postgres.calls, [])

    def test_a_manifest_that_pins_the_wrong_plaintext_digest_is_refused(self):
        # Model a producer bug: the authenticated manifest pins a wrong plaintext digest.
        # The drill must still decrypt and compare it before restoring.
        wrong = replace(self.manifest, plaintext_sha256='0' * 64)
        self.store.delete(self.manifest_key())
        self.store.put(self.manifest_key(), wrong.to_json(self.passphrase_file).encode('utf-8'))
        with self.assertRaisesRegex(BackupError, 'did not pin'):
            self.run_drill()
        self.assertEqual(self.postgres.calls, [])

    def test_an_outer_manifest_that_disagrees_with_the_inner_manifest_is_refused(self):
        for field_name, bad_value in (
            ('database_sha256', 'f' * 64),
            ('contents_sha256', 'f' * 64),
            ('contents_object_count', 99),
            ('contents_object_bytes', 999),
        ):
            with self.subTest(field=field_name):
                wrong = replace(self.manifest, **{field_name: bad_value})
                self.store.delete(self.manifest_key())
                self.store.put(self.manifest_key(), wrong.to_json(self.passphrase_file).encode('utf-8'))
                destination = self.root / f'mismatch-{field_name}'
                with self.assertRaisesRegex(BackupError, 'inner manifest disagrees') as refused:
                    recover.fetch_artifact(
                        self.store, recover.latest_artifact(self.store, TENANT), destination,
                        passphrase_file=self.passphrase_file, runner=OpensslRunner(),
                    )
                self.assertIn(field_name, str(refused.exception))
                self.assertEqual(list(destination.iterdir()), [])
                with self.assertRaisesRegex(BackupError, 'inner manifest disagrees'):
                    self.run_drill(scratch_root=self.root / f'drill-mismatch-{field_name}')
                self.assertEqual(self.postgres.calls, [])

    def test_a_transplanted_manifest_for_another_tenant_is_refused_before_download(self):
        class ObservableStore(FilesystemStore):
            downloads: list[str]

            def __init__(self, root) -> None:
                super().__init__(root)
                self.downloads = []

            def get_file(self, key, target, *, expected_size):
                self.downloads.append(key)
                return super().get_file(key, target, expected_size=expected_size)

        other_tenant = 'another-tenant'
        store = ObservableStore(self.root / 'other-bucket')
        prefix = artifact.artifact_prefix(other_tenant, 'hourly', datetime.fromisoformat(STAMP))
        store.put(prefix + artifact.ARTIFACT_CIPHERTEXT_NAME, self.store.get(self.artifact_key()))
        manifest = json.loads(self.store.get(self.manifest_key()))
        manifest['tenant'] = other_tenant
        store.put(prefix + artifact.MANIFEST_NAME, json.dumps(manifest).encode('utf-8'))
        with self.assertRaisesRegex(BackupError, 'authentication failed'):
            run_drill(
                store, other_tenant, scratch_root=self.scratch_root,
                target_db='liwan_drill_scratch', passphrase_file=self.passphrase_file,
                runner=OpensslRunner(), now=datetime.fromisoformat(STAMP),
                tools=self.tools, pg=PostgresConnection(user='scratch_operator'),
            )
        self.assertEqual(store.downloads, [])

    def test_the_manifest_identity_must_match_the_requested_bucket_key(self):
        for change in ({'kind': 'daily'},
                       {'captured_at': datetime.fromisoformat(STAMP) + timedelta(seconds=1)}):
            with self.subTest(change=change):
                wrong = replace(self.manifest, **change)
                self.store.delete(self.manifest_key())
                self.store.put(self.manifest_key(), wrong.to_json(self.passphrase_file).encode('utf-8'))
                with self.assertRaisesRegex(BackupError, 'does not match the artifact key'):
                    self.run_drill(scratch_root=self.root / f'drill-{next(iter(change))}')
                self.assertEqual(self.postgres.calls, [])

    def test_an_unreadable_manifest_is_refused(self):
        self.store.delete(self.manifest_key())
        self.store.put(self.manifest_key(), b'not a manifest')
        with self.assertRaises(BackupError):
            self.run_drill()

    def test_a_tenant_with_no_artifact_is_refused(self):
        with self.assertRaisesRegex(BackupError, 'no artifact to drill'):
            run_drill(
                self.store, 'empty', scratch_root=self.scratch_root,
                target_db='liwan_empty_scratch', passphrase_file=self.passphrase_file,
                runner=OpensslRunner(), now=datetime.fromisoformat(STAMP),
                tools=self.tools, pg=PostgresConnection(user='scratch_operator'),
            )

    def test_a_restore_that_does_not_verify_is_recorded_as_not_verified(self):
        record = self.run_drill(postgres=Postgres(attachments='ab/cdef\ncd/missing\n'))
        self.assertFalse(record['restore_verified'])
        self.assertFalse(self.record()['restore_verified'])

    def test_a_restore_that_fails_is_a_refusal_and_leaves_no_record(self):
        with self.assertRaises(BackupError):
            self.run_drill(postgres=Postgres(failing='CREATE DATABASE'))
        self.assertFalse(drill_record_path(self.scratch_root).exists())

    def test_a_target_filestore_that_already_exists_is_refused(self):
        (self.scratch_root / 'filestore' / 'liwan_drill_scratch').mkdir(parents=True)
        with self.assertRaises(BackupError):
            self.run_drill()

    def test_a_relative_scratch_root_is_refused(self):
        with self.assertRaises(BackupError):
            run_drill(
                self.store, TENANT, scratch_root=Path('scratch'),
                target_db='liwan_relative_scratch', passphrase_file=self.passphrase_file,
                runner=OpensslRunner(), now=datetime.fromisoformat(STAMP),
                tools=self.tools, pg=PostgresConnection(user='scratch_operator'),
            )


class TestRecordWriting(DrillCase):
    def test_the_record_is_replaced_atomically_and_no_temporary_file_is_left(self):
        record_path = drill_record_path(self.scratch_root)
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
        record_path = drill_record_path(self.scratch_root)
        record_path.parent.mkdir(parents=True, exist_ok=True)
        record_path.write_text(json.dumps({'restore_verified': False}), encoding='utf-8')
        with self.assertRaises(BackupError):
            self.run_drill(record_path=record_path, postgres=Postgres(failing='CREATE DATABASE'))
        self.assertEqual(json.loads(record_path.read_text(encoding='utf-8')),
                         {'restore_verified': False})


class TestStatusAfterADrill(DrillCase):
    def test_a_fresh_passing_drill_reads_as_verified_from_the_pipeline(self):
        # The clock is real here: the point is that a drill which just finished
        # reads back as fresh without any caller-supplied `now`.
        started_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        def fake_pg_dump(argv, **_kwargs) -> Completed:
            Path(argv[argv.index('-f') + 1]).write_bytes(DUMP_BYTES)
            return Completed()

        capture(store=self.store, tenant='fresh', source=snapshot.CaptureSource(
            db_name='liwan_scratch', bucket=bucket.DirectoryBucket(self.filestore),
            pg_dump=self.pg_dump,
        ), kind='hourly', work_root=self.root / 'fresh-work',
            passphrase_file=self.passphrase_file, now=started_at,
            runner=OpensslRunner(fake_pg_dump))
        clock = iter([0.0, 60.0])
        run_drill(
            self.store, 'fresh', scratch_root=self.root / 'fresh-scratch',
            target_db='liwan_status_scratch', passphrase_file=self.passphrase_file,
            runner=OpensslRunner(), now=started_at, tools=self.tools,
            pg=PostgresConnection(user='scratch_operator'), clock=lambda: next(clock),
        )
        report = status(record=drill_record_path(self.root / 'fresh-scratch'))
        self.assertTrue(report['rpo_ok'])
        self.assertTrue(report['rto_ok'])
        self.assertTrue(report['restore_verified'])


class TestCommandLine(DrillCase):
    def run_main(self, argv) -> tuple[int, str, str]:
        """Run the CLI with the PostgreSQL runner injected, never a real database."""
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = main(argv, runner=OpensslRunner(), tools=self.tools)
        return code, stdout.getvalue(), stderr.getvalue()

    def run_argv(self, *extra: str) -> list[str]:
        return [
            'drill', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'liwan_cli_scratch', '--store-root', str(self.root / 'bucket'),
            '--pg-user', 'scratch_operator', '--now', STAMP, *extra,
        ]

    def test_status_of_a_missing_record_exits_three(self):
        code, stdout, _stderr = self.run_main(['status', '--record', str(self.root / 'absent.json')])
        self.assertEqual(code, EXIT_NOT_VERIFIED)
        self.assertFalse(json.loads(stdout)['restore_verified'])

    def test_a_refused_target_exits_two(self):
        code, _stdout, stderr = self.run_main([
            'drill', '--tenant', TENANT, '--scratch-root', str(self.scratch_root),
            '--target-db', 'odoo19', '--store-root', str(self.root / 'bucket'),
            '--pg-user', 'scratch_operator',
        ])
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('backup_pipeline:', stderr)

    def test_a_missing_passphrase_variable_exits_two(self):
        with _environment({}, clear=(PASSPHRASE_ENVIRONMENT_VARIABLE,)):
            code, _stdout, stderr = self.run_main(self.run_argv())
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn(PASSPHRASE_ENVIRONMENT_VARIABLE, stderr)

    def test_a_successful_run_exits_zero_and_prints_the_record(self):
        with _environment({PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}):
            code, stdout, stderr = self.run_main(self.run_argv())
        self.assertEqual((code, stderr), (EXIT_OK, ''))
        self.assertTrue(json.loads(stdout)['restore_verified'])

    def test_a_restore_that_misses_the_rpo_exits_three_in_run_and_status(self):
        argv = [*self.run_argv()[:-1], '2026-11-08T06:00:00+00:00']
        with _environment({PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}):
            code, stdout, stderr = self.run_main(argv)
        self.assertEqual((code, stderr), (EXIT_NOT_VERIFIED, ''))
        self.assertFalse(json.loads(stdout)['rpo_ok'])
        code, stdout, stderr = self.run_main([
            'status', '--record', str(drill_record_path(self.scratch_root)),
            '--now', '2026-11-08T06:00:01+00:00',
        ])
        self.assertEqual((code, stderr), (EXIT_NOT_VERIFIED, ''))
        self.assertFalse(json.loads(stdout)['restore_verified'])

    def test_a_restore_that_does_not_verify_exits_three(self):
        self.tools = replace(self.tools, runner=Postgres(attachments='ab/cdef\ncd/missing\n'))
        with _environment({PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}):
            code, stdout, stderr = self.run_main(self.run_argv())
        self.assertEqual((code, stderr), (EXIT_NOT_VERIFIED, ''))
        self.assertFalse(json.loads(stdout)['restore_verified'])


class _environment:
    """Set environment variables for the duration of a test block."""

    def __init__(self, values, clear=()) -> None:
        self._values = dict(values)
        self._clear = tuple(clear)
        self._saved: dict[str, str | None] = {}

    def __enter__(self):
        for name in tuple(self._values) + self._clear:
            self._saved[name] = os.environ.get(name)
        for name in self._clear:
            os.environ.pop(name, None)
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
