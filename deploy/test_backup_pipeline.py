# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the backup pipeline promises, proven offline against a filesystem store.

Every rule here is checked by a test that fails when the rule is removed: the
passphrase travels as a file path, an output is never overwritten, a capture uploads
three objects with the manifest last, pruning never empties a tenant, and
``restore_verified`` follows a fresh passing drill record instead of a constant.

The real ``openssl`` binary does the encryption, so a wrong flag is a failing test
rather than a surprise during an incident. Nothing here opens a socket, starts a
database, or sleeps.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from deploy import backup_pipeline as bp
from deploy.s3_client import FilesystemStore, StorageError

PASSPHRASE = 'correct horse battery staple for liwan'
TENANT = 'acme'
DUMP_BYTES = b'PGDMP a candidate dump'
ATTACHMENT_BYTES = b'attachment payload'
STAMP = '2026-11-08T00:00:00+00:00'


@dataclass
class Completed:
    """The bit of ``subprocess.CompletedProcess`` the pipeline reads."""

    returncode: int = 0
    stdout: str = ''


class Runner:
    """A process runner that runs ``openssl`` for real and fakes everything else.

    Faking is what keeps the tests offline: the pipeline's own commands (the capture
    and the restore) are Python scripts that need a database, while the encryption is
    one binary that must not be faked, because the point of the test is that the
    exact argv produces a file openssl itself can decrypt. A test that needs openssl
    itself to fail asks for the handler with ``real_openssl=False``.
    """

    def __init__(self, handler=None, *, real_openssl: bool = True) -> None:
        self.calls: list[list[str]] = []
        self._handler = handler or _no_command
        self._real_openssl = real_openssl

    def __call__(self, argv, **kwargs):
        arguments = [str(argument) for argument in argv]
        self.calls.append(arguments)
        options = {name: value for name, value in kwargs.items() if name != 'check'}
        if self._real_openssl and Path(argv[0]).name == bp.OPENSSL_BINARY:
            return subprocess.run(argv, check=False, **options)
        return self._handler(arguments, **options)

    def calls_to(self, name: str) -> list[list[str]]:
        return [call for call in self.calls if Path(call[0]).name == name]

    def every_argument(self) -> str:
        return '\n'.join(argument for call in self.calls for argument in call)


def _no_command(argv, **_kwargs) -> Completed:
    message = f'no command was expected in this test: {argv}'
    raise AssertionError(message)


def fake_backup(writes: bool = True):
    """A stand-in for ``deploy/backup.py``: it writes what a real capture writes."""

    def handler(argv, **_kwargs) -> Completed:
        if '--output-dir' not in argv:
            return Completed(returncode=1)
        output = Path(argv[argv.index('--output-dir') + 1])
        if not writes:
            return Completed(returncode=2)
        (output / 'filestore' / 'ab').mkdir(parents=True, exist_ok=True)
        (output / 'database.dump').write_bytes(DUMP_BYTES)
        (output / 'filestore' / 'ab' / 'cdef').write_bytes(ATTACHMENT_BYTES)
        return Completed()

    return handler


class PipelineCase(unittest.TestCase):
    """A temporary tree with a passphrase file, a store and a work root."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix='liwan-pipeline-')).resolve()
        self.passphrase_file = self.write_passphrase()
        self.store = FilesystemStore(self.root / 'bucket')
        self.work_root = self.root / 'work'
        self.runner = Runner(fake_backup())

    def tearDown(self) -> None:
        for path in sorted(self.root.rglob('*'), reverse=True):
            path.unlink() if path.is_file() else path.rmdir()
        self.root.rmdir()

    def write_passphrase(self, content: str = PASSPHRASE, mode: int = 0o600) -> Path:
        path = self.root / f'passphrase-{mode:o}'
        path.write_text(content + '\n', encoding='utf-8')
        path.chmod(mode)
        return path

    def source(self) -> bp.CaptureSource:
        filestore = self.root / 'data' / 'filestore' / 'liwan_scratch'
        filestore.mkdir(parents=True, exist_ok=True)
        pg_dump = self.root / 'pg_dump'
        pg_dump.write_text('', encoding='utf-8')
        return bp.CaptureSource(db_name='liwan_scratch', filestore=filestore, pg_dump=pg_dump)

    def capture(self, *, kind: str = 'hourly', captured_at: str = STAMP,
                runner=None) -> bp.BackupManifest:
        return bp.capture(
            store=self.store,
            tenant=TENANT,
            source=self.source(),
            kind=kind,
            work_root=self.work_root,
            passphrase_file=self.passphrase_file,
            now=datetime.fromisoformat(captured_at),
            runner=runner or self.runner,
        )

    def put_artifact(self, kind: str, captured_at: datetime) -> str:
        """A placeholder artifact under the real key layout, enough for a prune."""
        prefix = bp.artifact_prefix(TENANT, kind, captured_at)
        for name in (bp.ARTIFACT_CIPHERTEXT_NAME, bp.CHECKSUMS_NAME, bp.MANIFEST_NAME):
            self.store.put(prefix + name, b'placeholder')
        return prefix

    def write_record(self, payload, *, name: str = 'restore-drill.json') -> Path:
        path = self.root / name
        text = payload if isinstance(payload, str) else json.dumps(payload)
        path.write_text(text, encoding='utf-8')
        return path


class TestEncryption(PipelineCase):
    def test_round_trip_with_the_real_openssl_binary(self):
        plaintext = self.root / 'plain.bin'
        plaintext.write_bytes(b'\x00binary payload\xff' * 200)
        ciphertext = self.root / 'cipher.bin'
        decrypted = self.root / 'decrypted.bin'

        ciphertext_sha256 = bp.encrypt_file(
            plaintext, ciphertext, passphrase_file=self.passphrase_file, runner=self.runner,
        )
        plaintext_sha256 = bp.decrypt_file(
            ciphertext, decrypted, passphrase_file=self.passphrase_file, runner=self.runner,
        )

        self.assertEqual(ciphertext_sha256, bp.sha256_file(ciphertext))
        self.assertEqual(plaintext_sha256, bp.sha256_file(plaintext))
        self.assertEqual(decrypted.read_bytes(), plaintext.read_bytes())
        self.assertNotEqual(ciphertext.read_bytes(), plaintext.read_bytes())

    def test_the_passphrase_never_appears_in_any_argv(self):
        plaintext = self.root / 'plain.bin'
        plaintext.write_text('payload', encoding='utf-8')
        bp.encrypt_file(
            plaintext, self.root / 'cipher.bin',
            passphrase_file=self.passphrase_file, runner=self.runner,
        )
        encrypted = self.runner.calls_to(bp.OPENSSL_BINARY)
        self.assertEqual(len(encrypted), 1)
        self.assertNotIn(PASSPHRASE, self.runner.every_argument())
        self.assertIn('file:' + str(self.passphrase_file), encrypted[0])
        self.assertEqual(encrypted[0][encrypted[0].index('-pass') + 1],
                         'file:' + str(self.passphrase_file))
        self.assertNotIn('shell=True', self.runner.every_argument())

    def test_an_existing_ciphertext_is_never_overwritten(self):
        plaintext = self.root / 'plain.bin'
        plaintext.write_bytes(b'payload')
        ciphertext = self.root / 'cipher.bin'
        ciphertext.write_bytes(b'already here')
        with self.assertRaises(bp.PipelineError):
            bp.encrypt_file(plaintext, ciphertext, passphrase_file=self.passphrase_file,
                            runner=self.runner)
        self.assertEqual(ciphertext.read_bytes(), b'already here')
        self.assertEqual(self.runner.calls_to(bp.OPENSSL_BINARY), [])

    def test_an_existing_plaintext_is_never_overwritten_on_decrypt(self):
        source = self.root / 'source.bin'
        source.write_bytes(b'ciphertext stand-in')
        target = self.root / 'target.bin'
        target.write_bytes(b'already here')
        with self.assertRaises(bp.PipelineError):
            bp.decrypt_file(source, target, passphrase_file=self.passphrase_file,
                            runner=self.runner)
        self.assertEqual(target.read_bytes(), b'already here')

    def test_an_empty_or_short_passphrase_is_refused(self):
        plaintext = self.root / 'plain.bin'
        plaintext.write_bytes(b'payload')
        for content in ('', 'short', 'still-too-short'):
            with self.subTest(content=content):
                path = self.write_passphrase(content)
                with self.assertRaises(bp.PipelineError):
                    bp.encrypt_file(plaintext, self.root / f'cipher-{len(content)}.bin',
                                    passphrase_file=path, runner=self.runner)

    def test_a_passphrase_file_others_can_read_is_refused(self):
        path = self.write_passphrase(mode=0o644)
        with self.assertRaises(bp.PipelineError):
            bp.require_passphrase_file(path)

    def test_a_relative_or_missing_passphrase_path_is_refused(self):
        with self.assertRaises(bp.PipelineError):
            bp.require_passphrase_file(Path('passphrase'))
        with self.assertRaises(bp.PipelineError):
            bp.require_passphrase_file(self.root / 'absent')

    def test_a_failed_openssl_run_raises_and_returns_no_digest(self):
        plaintext = self.root / 'plain.bin'
        plaintext.write_bytes(b'payload')
        failing = Runner(lambda argv, **_kwargs: Completed(returncode=1), real_openssl=False)
        with self.assertRaises(bp.PipelineError):
            bp.encrypt_file(plaintext, self.root / 'cipher.bin',
                            passphrase_file=self.passphrase_file, runner=failing)

    def test_the_openssl_argv_is_a_list_the_passphrase_never_enters(self):
        plaintext = self.root / 'plain.bin'
        ciphertext = self.root / 'cipher.bin'
        encrypt = bp.openssl_argv(plaintext, ciphertext, self.passphrase_file, decrypt=False)
        decrypt = bp.openssl_argv(ciphertext, plaintext, self.passphrase_file, decrypt=True)
        self.assertIsInstance(encrypt, list)
        self.assertEqual(encrypt[:3], ['openssl', 'enc', '-aes-256-cbc'])
        self.assertEqual(decrypt[:3], ['openssl', 'enc', '-d'])
        for argv in (encrypt, decrypt):
            self.assertIn('-pbkdf2', argv)
            self.assertIn('-salt', argv)
            self.assertNotIn(PASSPHRASE, argv)
            self.assertFalse(any(argument.startswith('-pass') and argument != '-pass'
                                 for argument in argv))


class TestArchive(PipelineCase):
    def staged_tree(self) -> Path:
        staged = self.root / 'staged'
        (staged / 'filestore' / 'ab').mkdir(parents=True)
        (staged / 'database.dump').write_bytes(DUMP_BYTES)
        (staged / 'filestore' / 'ab' / 'cdef').write_bytes(ATTACHMENT_BYTES)
        return staged

    def test_the_same_input_produces_the_same_bytes(self):
        staged = self.staged_tree()
        first = self.root / 'first.tar'
        second = self.root / 'second.tar'
        self.assertEqual(bp.archive_filestore(staged, first), bp.archive_filestore(staged, second))
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_a_changed_metadata_does_not_change_the_digest(self):
        # The digest must be a fact about the data, not about the filesystem the tree
        # happens to sit on: another host, another umask, another mtime would
        # otherwise produce a different archive for the very same bytes.
        staged = self.staged_tree()
        before = bp.archive_filestore(staged, self.root / 'before.tar')
        for path in staged.rglob('*'):
            os.utime(path, (1_000_000, 1_000_000))
            path.chmod(0o700 if path.is_dir() else 0o600)
        after = bp.archive_filestore(staged, self.root / 'after.tar')
        self.assertEqual(before, after)
        self.assertEqual((self.root / 'before.tar').read_bytes(),
                         (self.root / 'after.tar').read_bytes())

    def test_a_changed_attachment_changes_the_digest(self):
        staged = self.staged_tree()
        before = bp.archive_filestore(staged, self.root / 'before.tar')
        (staged / 'filestore' / 'ab' / 'cdef').write_bytes(b'a different payload')
        after = bp.archive_filestore(staged, self.root / 'after.tar')
        self.assertNotEqual(before, after)

    def test_an_existing_target_is_refused(self):
        staged = self.staged_tree()
        target = self.root / 'taken.tar'
        target.write_bytes(b'existing')
        with self.assertRaises(bp.PipelineError):
            bp.archive_filestore(staged, target)
        self.assertEqual(target.read_bytes(), b'existing')

    def test_the_archive_holds_the_dump_and_the_filestore(self):
        staged = self.staged_tree()
        archive = self.root / 'artifact.tar'
        bp.archive_filestore(staged, archive)
        with tarfile.open(archive) as bundle:
            names = sorted(bundle.getnames())
            payloads = {member.name: bundle.extractfile(member).read()
                        for member in bundle.getmembers() if member.isfile()}
        self.assertEqual(names, ['database.dump', 'filestore', 'filestore/ab',
                                 'filestore/ab/cdef'])
        self.assertEqual(payloads['database.dump'], DUMP_BYTES)
        self.assertEqual(payloads['filestore/ab/cdef'], ATTACHMENT_BYTES)

    def test_a_symlink_is_refused(self):
        staged = self.root / 'staged'
        staged.mkdir()
        (staged / 'database.dump').write_bytes(DUMP_BYTES)
        (staged / 'escape').symlink_to('/etc/hosts')
        with self.assertRaises(bp.PipelineError):
            bp.archive_filestore(staged, self.root / 'artifact.tar')


class TestManifest(PipelineCase):
    def manifest(self, **overrides) -> bp.BackupManifest:
        fields = {
            'tenant': TENANT,
            'kind': 'hourly',
            'captured_at': datetime(2026, 11, 8, tzinfo=timezone.utc),
            'plaintext_sha256': 'a' * 64,
            'ciphertext_sha256': 'b' * 64,
            'plaintext_bytes': 10,
            'ciphertext_bytes': 32,
        }
        fields.update(overrides)
        return bp.BackupManifest(**fields)

    def test_json_round_trip_keeps_every_field(self):
        manifest = self.manifest()
        self.assertEqual(bp.BackupManifest.from_json(manifest.to_json()), manifest)
        self.assertEqual(manifest.consistency, 'UNVERIFIED')
        self.assertEqual(manifest.cipher, 'aes-256-cbc-pbkdf2')

    def test_consistency_can_never_be_upgraded(self):
        payload = json.loads(self.manifest().to_json())
        payload['consistency'] = 'CONSISTENT'
        with self.assertRaises(bp.PipelineError):
            bp.BackupManifest.from_json(json.dumps(payload))

    def test_a_malformed_manifest_is_refused(self):
        for text in ('', 'not json', '{}', '[]'):
            with self.subTest(text=text), self.assertRaises(bp.PipelineError):
                bp.BackupManifest.from_json(text)

    def test_a_non_utc_or_naive_capture_time_is_refused(self):
        naive = datetime(2026, 11, 8)
        with self.assertRaises(bp.PipelineError):
            self.manifest(captured_at=naive)
        with self.assertRaises(bp.PipelineError):
            self.manifest(captured_at=datetime(2026, 11, 8, tzinfo=timezone(timedelta(hours=3))))

    def test_a_non_sha256_digest_or_zero_size_is_refused(self):
        with self.assertRaises(bp.PipelineError):
            self.manifest(plaintext_sha256='not-a-digest')
        with self.assertRaises(bp.PipelineError):
            self.manifest(ciphertext_bytes=0)

    def test_a_tenant_that_could_leave_its_prefix_is_refused(self):
        for tenant in ('../acme', 'Acme', '', 'a/b'):
            with self.subTest(tenant=tenant), self.assertRaises(bp.PipelineError):
                self.manifest(tenant=tenant)


class TestCapture(PipelineCase):
    def keys(self, kind: str = 'hourly', stamp: str = STAMP) -> list[str]:
        prefix = bp.artifact_prefix(TENANT, kind, datetime.fromisoformat(stamp))
        return self.store.list(prefix)

    def test_it_uploads_exactly_the_artifact_the_checksums_and_the_manifest(self):
        manifest = self.capture()
        self.assertEqual(self.keys(), [
            f'{TENANT}/hourly/2026-11-08T000000Z/{bp.ARTIFACT_CIPHERTEXT_NAME}',
            f'{TENANT}/hourly/2026-11-08T000000Z/{bp.CHECKSUMS_NAME}',
            f'{TENANT}/hourly/2026-11-08T000000Z/{bp.MANIFEST_NAME}',
        ])
        self.assertGreater(self.store.head(self.keys()[0]), 0)
        uploaded = bp.BackupManifest.from_json(self.store.get(self.keys()[2]).decode('utf-8'))
        self.assertEqual(uploaded, manifest)
        self.assertEqual(uploaded.consistency, 'UNVERIFIED')

    def test_the_checksums_cover_the_artifact_and_the_manifest(self):
        manifest = self.capture()
        listing = self.store.get(self.keys()[1]).decode('utf-8').splitlines()
        manifest_bytes = self.store.get(self.keys()[2])
        self.assertEqual(listing, [
            f'{manifest.ciphertext_sha256}  {bp.ARTIFACT_CIPHERTEXT_NAME}',
            f'{hashlib.sha256(manifest_bytes).hexdigest()}  {bp.MANIFEST_NAME}',
        ])

    def test_the_manifest_is_uploaded_last(self):
        self.capture()
        uploaded = list(self.store.list(f'{TENANT}/'))
        self.assertTrue(uploaded[-1].endswith(bp.MANIFEST_NAME))
        self.assertTrue(uploaded[-2].endswith(bp.CHECKSUMS_NAME))

    def test_it_never_uploads_plaintext(self):
        self.capture()
        for key in self.store.list(f'{TENANT}/'):
            payload = self.store.get(key)
            self.assertNotIn(DUMP_BYTES, payload)
            self.assertNotIn(ATTACHMENT_BYTES, payload)

    def test_a_capture_failure_uploads_no_manifest(self):
        failing = Runner(fake_backup(writes=False))
        with self.assertRaises(bp.PipelineError):
            self.capture(runner=failing)
        self.assertEqual(self.store.list(f'{TENANT}/'), [])

    def test_a_store_failure_after_the_artifact_uploads_no_manifest(self):
        class FailingStore(FilesystemStore):
            def put(self, key, data):
                if key.endswith(bp.CHECKSUMS_NAME):
                    message = 'the bucket refused the write'
                    raise StorageError(message)
                super().put(key, data)

        failing_store = FailingStore(self.root / 'broken')
        with self.assertRaises(StorageError):
            bp.capture(
                store=failing_store,
                tenant=TENANT,
                source=self.source(),
                kind='hourly',
                work_root=self.work_root,
                passphrase_file=self.passphrase_file,
                now=datetime.fromisoformat(STAMP),
                runner=self.runner,
            )
        self.assertEqual(
            [key for key in failing_store.list(f'{TENANT}/') if key.endswith(bp.MANIFEST_NAME)],
            [],
        )

    def test_a_capture_without_a_dump_from_backup_py_is_refused(self):
        empty = Runner(lambda argv, **_kwargs: Completed())
        with self.assertRaises(bp.PipelineError):
            self.capture(runner=empty)
        self.assertEqual(self.store.list(f'{TENANT}/'), [])

    def test_a_second_capture_of_the_same_stamp_is_refused(self):
        self.capture()
        with self.assertRaises(bp.PipelineError):
            self.capture()

    def test_the_capture_never_claims_quiescence(self):
        self.assertIn('UNVERIFIED', self.capture().consistency)

    def test_it_passes_the_opt_in_tokens_backup_py_requires(self):
        self.capture()
        argv = self.runner.calls[0]
        self.assertIn('--opt-in', argv)
        self.assertEqual(argv[argv.index('--opt-in') + 1], 'MANUAL_BACKUP_OPT_IN')
        self.assertEqual(argv[argv.index('--acknowledge-unverified') + 1],
                         'CANDIDATE_BACKUP_UNVERIFIED')


class TestPrune(PipelineCase):
    def now(self) -> datetime:
        return datetime(2026, 11, 8, tzinfo=timezone.utc)

    def test_the_newest_hourly_and_daily_survive_ancient_timestamps(self):
        hourly = self.put_artifact('hourly', self.now() - timedelta(days=200))
        daily = self.put_artifact('daily', self.now() - timedelta(days=400))
        report = bp.prune(self.store, TENANT, self.now())
        self.assertEqual(report.deleted, ())
        self.assertEqual(len(self.store.list(hourly)), 3)
        self.assertEqual(len(self.store.list(daily)), 3)

    def test_only_artifacts_beyond_the_window_are_deleted(self):
        fresh = self.put_artifact('hourly', self.now() - timedelta(days=3))
        stale = self.put_artifact('hourly', self.now() - timedelta(days=8))
        report = bp.prune(self.store, TENANT, self.now())
        self.assertEqual(self.store.list(stale), [])
        self.assertEqual(len(self.store.list(fresh)), 3)
        stale_stamp = (self.now() - timedelta(days=8)).strftime(bp.STAMP_FORMAT)
        self.assertEqual({action.key.split('/')[2] for action in report.deleted}, {stale_stamp})

    def test_an_older_artifact_inside_the_window_is_kept(self):
        newest = self.put_artifact('hourly', self.now() - timedelta(hours=1))
        older = self.put_artifact('hourly', self.now() - timedelta(days=6, hours=23))
        report = bp.prune(self.store, TENANT, self.now())
        self.assertEqual(report.deleted, ())
        self.assertEqual(len(self.store.list(newest)), 3)
        self.assertEqual(len(self.store.list(older)), 3)

    def test_the_daily_window_is_thirty_days(self):
        self.put_artifact('daily', self.now() - timedelta(days=1))
        kept = self.put_artifact('daily', self.now() - timedelta(days=29))
        gone = self.put_artifact('daily', self.now() - timedelta(days=31))
        bp.prune(self.store, TENANT, self.now())
        self.assertEqual(len(self.store.list(kept)), 3)
        self.assertEqual(self.store.list(gone), [])

    def test_every_decision_is_named_in_the_report(self):
        self.put_artifact('hourly', self.now() - timedelta(days=1))
        self.put_artifact('hourly', self.now() - timedelta(days=40))
        report = bp.prune(self.store, TENANT, self.now())
        reasons = {action.key: action.reason for action in report.kept + report.deleted}
        self.assertEqual(len(reasons), 6)
        self.assertEqual(set(reasons.values()),
                         {bp.KEEP_NEWEST, bp.DELETE_BEYOND_WINDOW})
        self.assertEqual(report.as_dict()['tenant'], TENANT)
        self.assertEqual(len(report.as_dict()['deleted']), 3)

    def test_an_unrecognised_object_is_kept_and_named(self):
        self.put_artifact('hourly', self.now() - timedelta(days=400))
        self.store.put(f'{TENANT}/notes/operator.txt', b'do not delete me')
        report = bp.prune(self.store, TENANT, self.now())
        self.assertEqual([action.reason for action in report.kept
                          if action.key.endswith('operator.txt')], [bp.KEEP_UNRECOGNISED])
        self.assertEqual(self.store.get(f'{TENANT}/notes/operator.txt'), b'do not delete me')

    def test_another_tenant_is_untouched(self):
        other = bp.artifact_prefix('other', 'hourly', self.now() - timedelta(days=400))
        self.store.put(other + bp.MANIFEST_NAME, b'other tenant')
        bp.prune(self.store, TENANT, self.now())
        self.assertEqual(self.store.get(other + bp.MANIFEST_NAME), b'other tenant')

    def test_an_empty_tenant_prunes_nothing(self):
        report = bp.prune(self.store, TENANT, self.now())
        self.assertEqual((report.kept, report.deleted), ((), ()))

    def test_an_invalid_tenant_is_refused(self):
        with self.assertRaises(bp.PipelineError):
            bp.prune(self.store, '../escape', self.now())


class TestRestoreVerified(PipelineCase):
    def record(self, *, finished_at: datetime, verified: bool = True,
               name: str = 'restore-drill.json') -> Path:
        return self.write_record({
            'restore_verified': verified,
            'finished_at': finished_at.isoformat(),
            'elapsed_seconds': 600,
        }, name=name)

    def now(self) -> datetime:
        return datetime(2026, 11, 8, 12, tzinfo=timezone.utc)

    def test_no_record_is_not_verified(self):
        self.assertFalse(bp.restore_verified(self.root / 'absent.json', self.now()))

    def test_a_failed_record_is_not_verified(self):
        path = self.record(finished_at=self.now() - timedelta(minutes=5), verified=False)
        self.assertFalse(bp.restore_verified(path, self.now()))

    def test_a_malformed_record_is_not_verified(self):
        for text in ('not json', '[]', '{"restore_verified": "true", "finished_at": "x"}',
                     '{"restore_verified": true}'):
            with self.subTest(text=text):
                path = self.write_record(text, name=f'malformed-{len(text)}.json')
                self.assertFalse(bp.restore_verified(path, self.now()))

    def test_a_fresh_successful_record_is_verified(self):
        path = self.record(finished_at=self.now() - timedelta(minutes=5))
        self.assertTrue(bp.restore_verified(path, self.now()))

    def test_a_record_older_than_the_rpo_window_flips_back_to_false(self):
        fresh = self.record(finished_at=self.now() - timedelta(seconds=bp.RPO_SECONDS))
        self.assertTrue(bp.restore_verified(fresh, self.now()))
        self.assertFalse(bp.restore_verified(fresh, self.now() + timedelta(seconds=1)))

    def test_a_record_that_finished_in_the_future_is_not_verified(self):
        path = self.record(finished_at=self.now() + timedelta(minutes=5))
        self.assertFalse(bp.restore_verified(path, self.now()))

    def test_the_policy_is_the_one_source_of_the_windows(self):
        path = self.record(finished_at=self.now() - timedelta(seconds=90))
        relaxed = bp.RetentionPolicy(rpo_seconds=60, rto_seconds=60)
        self.assertFalse(bp.restore_verified(path, self.now(), relaxed))
        self.assertTrue(bp.restore_verified(path, self.now(), bp.RetentionPolicy()))
        self.assertEqual(bp.RetentionPolicy().hourly_keep_days, 7)
        self.assertEqual(bp.RetentionPolicy().daily_keep_days, 30)
        self.assertEqual((bp.RPO_SECONDS, bp.RTO_SECONDS), (3600, 4 * 3600))


class TestStatus(PipelineCase):
    def now(self) -> datetime:
        return datetime(2026, 11, 8, 12, tzinfo=timezone.utc)

    def record(self, *, captured_age: int, elapsed_seconds: float, finished_age: int = 30) -> Path:
        now = self.now()
        return self.write_record({
            'restore_verified': True,
            'artifact_captured_at': (now - timedelta(seconds=captured_age)).isoformat(),
            'finished_at': (now - timedelta(seconds=finished_age)).isoformat(),
            'elapsed_seconds': elapsed_seconds,
        })

    def test_rpo_is_ok_at_the_boundary_and_not_one_second_past_it(self):
        at_limit = self.record(captured_age=bp.RPO_SECONDS, elapsed_seconds=60)
        self.assertTrue(bp.status(at_limit, self.now())['rpo_ok'])
        past_limit = self.record(captured_age=bp.RPO_SECONDS + 1, elapsed_seconds=60)
        self.assertFalse(bp.status(past_limit, self.now())['rpo_ok'])

    def test_rto_is_ok_at_the_boundary_and_not_one_second_past_it(self):
        at_limit = self.record(captured_age=60, elapsed_seconds=bp.RTO_SECONDS)
        self.assertTrue(bp.status(at_limit, self.now())['rto_ok'])
        past_limit = self.record(captured_age=60, elapsed_seconds=bp.RTO_SECONDS + 1)
        self.assertFalse(bp.status(past_limit, self.now())['rto_ok'])

    def test_the_age_is_the_artifacts_age_not_the_drills_age(self):
        path = self.record(captured_age=1800, elapsed_seconds=60, finished_age=10)
        self.assertEqual(bp.status(path, self.now())['last_backup_age_seconds'], 1800)

    def test_no_record_reports_no_proof(self):
        report = bp.status(self.root / 'absent.json', self.now())
        self.assertEqual(report, {
            'record_exists': False,
            'rpo_ok': False,
            'rto_ok': False,
            'restore_verified': False,
            'last_backup_age_seconds': None,
            'artifact_captured_at': None,
            'finished_at': None,
        })

    def test_a_record_past_both_windows_reports_both_false(self):
        path = self.record(captured_age=2 * 24 * 3600, elapsed_seconds=1,
                           finished_age=2 * 24 * 3600)
        report = bp.status(path, self.now())
        self.assertFalse(report['rpo_ok'])
        self.assertFalse(report['restore_verified'])


class TestCommandLine(PipelineCase):
    def run_main(self, argv) -> tuple[int, str, str]:
        """Run the CLI with the capture runner injected, never a real database."""
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = bp.main(argv, runner=self.runner)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_status_reports_a_missing_record_as_not_verified(self):
        code, stdout, _stderr = self.run_main(['status', '--record', str(self.root / 'absent.json')])
        self.assertEqual(code, bp.EXIT_NOT_VERIFIED)
        self.assertFalse(json.loads(stdout)['restore_verified'])

    def test_status_reports_a_fresh_record_as_verified(self):
        path = self.write_record({
            'restore_verified': True,
            'artifact_captured_at': datetime.now(timezone.utc).isoformat(),
            'finished_at': datetime.now(timezone.utc).isoformat(),
            'elapsed_seconds': 60,
        })
        code, stdout, _stderr = self.run_main(['status', '--record', str(path)])
        self.assertEqual(code, bp.EXIT_OK)
        self.assertTrue(json.loads(stdout)['restore_verified'])

    def test_capture_through_the_environment_and_a_filesystem_store(self):
        source = self.source()
        argv = [
            'capture', '--tenant', TENANT, '--kind', 'daily',
            '--work-root', str(self.work_root), '--db-name', source.db_name,
            '--filestore', str(source.filestore), '--pg-dump', str(source.pg_dump),
            '--store-root', str(self.root / 'cli-bucket'), '--now', STAMP,
        ]
        environ = {bp.PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}
        with _environment(environ):
            code, stdout, stderr = self.run_main(argv)
        self.assertEqual((code, stderr), (bp.EXIT_OK, ''))
        self.assertEqual(json.loads(stdout)['status'], 'captured')
        self.assertEqual(
            len(FilesystemStore(self.root / 'cli-bucket').list(f'{TENANT}/daily/')), 3,
        )

    def test_capture_without_the_passphrase_variable_is_a_refusal(self):
        source = self.source()
        argv = [
            'capture', '--tenant', TENANT, '--kind', 'hourly',
            '--work-root', str(self.work_root), '--db-name', source.db_name,
            '--filestore', str(source.filestore), '--pg-dump', str(source.pg_dump),
            '--store-root', str(self.root / 'cli-bucket'), '--now', STAMP,
        ]
        with _environment({}, clear=(bp.PASSPHRASE_ENVIRONMENT_VARIABLE,)):
            code, _stdout, stderr = self.run_main(argv)
        self.assertEqual(code, bp.EXIT_REFUSED)
        self.assertIn(bp.PASSPHRASE_ENVIRONMENT_VARIABLE, stderr)
        self.assertEqual(FilesystemStore(self.root / 'cli-bucket').list(f'{TENANT}/'), [])
        self.assertFalse(self.work_root.exists())

    def test_prune_prints_its_report_as_json(self):
        self.put_artifact('hourly', datetime.fromisoformat(STAMP))
        code, stdout, _stderr = self.run_main([
            'prune', '--tenant', TENANT, '--store-root', str(self.root / 'bucket'),
            '--now', '2026-11-09T00:00:00+00:00',
        ])
        self.assertEqual(code, bp.EXIT_OK)
        self.assertEqual(json.loads(stdout)['tenant'], TENANT)

    def test_a_refusal_exits_two_without_a_traceback(self):
        code, _stdout, stderr = self.run_main([
            'prune', '--tenant', '../escape', '--store-root', str(self.root / 'bucket'),
        ])
        self.assertEqual(code, bp.EXIT_REFUSED)
        self.assertIn('backup_pipeline:', stderr)


class _environment:
    """Set and clear environment variables for the duration of a test block."""

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


class TestKeysAndStamps(PipelineCase):
    def test_the_key_layout_is_tenant_then_kind_then_utc_stamp(self):
        self.assertEqual(
            bp.artifact_prefix(TENANT, 'hourly', datetime(2026, 11, 8, 5, 4, 3,
                                                          tzinfo=timezone.utc)),
            'acme/hourly/2026-11-08T050403Z/',
        )
        with self.assertRaises(bp.PipelineError):
            bp.artifact_prefix(TENANT, 'weekly', datetime.now(timezone.utc))

    def test_a_stamp_must_be_the_written_format(self):
        self.assertEqual(bp.parse_stamp('2026-11-08T000000Z'),
                         datetime(2026, 11, 8, tzinfo=timezone.utc))
        for stamp in ('2026-11-08', '2026-11-08T00:00:00Z', 'nonsense'):
            with self.subTest(stamp=stamp), self.assertRaises(bp.PipelineError):
                bp.parse_stamp(stamp)

    def test_a_stamp_without_a_timezone_is_refused_by_the_clock_guard(self):
        with self.assertRaises(bp.PipelineError):
            bp.as_utc(datetime(2026, 11, 8))


if __name__ == '__main__':
    unittest.main()
