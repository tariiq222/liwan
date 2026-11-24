# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the backup package promises, proven offline against a filesystem store.

Every rule here is checked by a test that fails when the rule is removed: the passphrase
travels as a file path, an output is never overwritten, a capture uploads three objects
with the manifest last, the dump runs through the one pg_dump argv, a second capture of
the same stamp is refused, pruning never empties a tenant, and ``status`` follows a fresh
passing drill record instead of a constant.

The real ``openssl`` binary does the encryption, so a wrong flag is a failing test rather
than a surprise during an incident. Nothing here opens a socket, starts a database, or
sleeps.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from deploy.backup import artifact, lock as lock_module, recover, snapshot, store as store_module
from deploy.backup.artifact import PASSPHRASE_ENVIRONMENT_VARIABLE
from deploy.backup.capture import (
    CONTROL_PLANE_SOURCE,
    DELETE_BEYOND_WINDOW,
    KEEP_NEWEST,
    KEEP_UNRECOGNISED,
    RPO_SECONDS,
    RTO_SECONDS,
    PurgeReport,
    RetentionPolicy,
    capture,
    newest_age,
    prune,
    purge_tenant,
    recovery_objectives,
    status,
)
from deploy.backup.cli import (
    EXIT_NOT_VERIFIED,
    EXIT_OK,
    EXIT_REFUSED,
    REGISTRY_ENVIRONMENT_VARIABLE,
    main,
)
from deploy.backup.dump import build_pg_dump_argv, validate_db_name
from deploy.backup.errors import BackupError, PurgeIncompleteError
from deploy.backup.lock import LOCK_DIR_NAME, database_lock, lock_directory
from deploy.backup.manifest import (
    BackupManifest,
    STAMP_FORMAT,
    as_utc,
    parse_stamp,
)
from deploy.backup.snapshot import CaptureSource, filestore_digest, validate_filestore
from deploy.s3_client import FilesystemStore, StorageError

def drill_record_verified(record: Path, now: datetime | None = None) -> bool:
    """Whether the drill record at ``record`` reads as a verified restore right now."""
    return status(record=record, now=now)['restore_verified']


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
        if self._real_openssl and Path(argv[0]).name == artifact.OPENSSL_BINARY:
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
        # The real backup.perform_backup contract: an existing destination is refused
        # and only the output directory itself is created (its parent must exist).
        if output.exists() or not output.parent.is_dir():
            return Completed(returncode=1)
        output.mkdir(parents=False)
        (output / 'filestore' / 'ab').mkdir(parents=True)
        (output / 'database.dump').write_bytes(DUMP_BYTES)
        (output / 'filestore' / 'ab' / 'cdef').write_bytes(ATTACHMENT_BYTES)
        return Completed()

    return handler


def fake_pg_dump(writes: bool = True):
    """A stand-in for ``pg_dump``: it writes the file named by ``-f``, like the real one."""

    def handler(argv, **_kwargs) -> Completed:
        if not writes:
            return Completed(returncode=1)
        Path(argv[argv.index('-f') + 1]).write_bytes(DUMP_BYTES)
        return Completed()

    return handler


class PipelineCase(unittest.TestCase):
    """A temporary tree with a passphrase file, a store and a work root."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix='liwan-pipeline-')).resolve()
        self.passphrase_file = self.write_passphrase()
        self.store = FilesystemStore(self.root / 'bucket')
        self.work_root = self.root / 'work'
        self.runner = Runner(fake_pg_dump())

    def tearDown(self) -> None:
        for path in sorted(self.root.rglob('*'), reverse=True):
            if path.is_symlink() or not path.is_dir():
                path.unlink()
            else:
                path.rmdir()
        self.root.rmdir()

    def write_passphrase(self, content: str = PASSPHRASE, mode: int = 0o600) -> Path:
        path = self.root / f'passphrase-{mode:o}'
        path.write_text(content + '\n', encoding='utf-8')
        path.chmod(mode)
        return path

    def source(self) -> CaptureSource:
        filestore = self.root / 'data' / 'filestore' / 'liwan_scratch'
        if not filestore.is_symlink():
            filestore.mkdir(parents=True, exist_ok=True)
        pg_dump = self.root / 'pg_dump'
        pg_dump.write_text('', encoding='utf-8')
        return CaptureSource(db_name='liwan_scratch', filestore=filestore, pg_dump=pg_dump)

    def control_plane_source(self, db_name: str = 'liwan_control') -> CaptureSource:
        pg_dump = self.root / 'pg_dump'
        pg_dump.write_text('', encoding='utf-8')
        return CaptureSource(db_name=db_name, filestore=None, pg_dump=pg_dump)

    def capture_control_plane(self, *, kind: str = 'hourly', captured_at: str = STAMP,
                              runner=None, source: CaptureSource | None = None) -> BackupManifest:
        return capture(
            store=self.store,
            tenant=CONTROL_PLANE_SOURCE,
            source=source or self.control_plane_source(),
            kind=kind,
            work_root=self.work_root,
            passphrase_file=self.passphrase_file,
            now=datetime.fromisoformat(captured_at),
            runner=runner or Runner(fake_pg_dump()),
        )

    def capture(self, *, kind: str = 'hourly', captured_at: str = STAMP,
                runner=None) -> BackupManifest:
        return capture(
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
        prefix = artifact.artifact_prefix(TENANT, kind, captured_at)
        for name in (artifact.ARTIFACT_CIPHERTEXT_NAME, artifact.CHECKSUMS_NAME, artifact.MANIFEST_NAME):
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

        ciphertext_sha256 = artifact.encrypt_file(
            plaintext, ciphertext, passphrase_file=self.passphrase_file, runner=self.runner,
        )
        plaintext_sha256 = artifact.decrypt_file(
            ciphertext, decrypted, passphrase_file=self.passphrase_file, runner=self.runner,
        )

        self.assertEqual(ciphertext_sha256, artifact.sha256_file(ciphertext))
        self.assertEqual(plaintext_sha256, artifact.sha256_file(plaintext))
        self.assertEqual(decrypted.read_bytes(), plaintext.read_bytes())
        self.assertNotEqual(ciphertext.read_bytes(), plaintext.read_bytes())

    def test_the_passphrase_never_appears_in_any_argv(self):
        plaintext = self.root / 'plain.bin'
        plaintext.write_text('payload', encoding='utf-8')
        artifact.encrypt_file(
            plaintext, self.root / 'cipher.bin',
            passphrase_file=self.passphrase_file, runner=self.runner,
        )
        encrypted = self.runner.calls_to(artifact.OPENSSL_BINARY)
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
        with self.assertRaises(BackupError):
            artifact.encrypt_file(plaintext, ciphertext, passphrase_file=self.passphrase_file,
                            runner=self.runner)
        self.assertEqual(ciphertext.read_bytes(), b'already here')
        self.assertEqual(self.runner.calls_to(artifact.OPENSSL_BINARY), [])

    def test_an_existing_plaintext_is_never_overwritten_on_decrypt(self):
        source = self.root / 'source.bin'
        source.write_bytes(b'ciphertext stand-in')
        target = self.root / 'target.bin'
        target.write_bytes(b'already here')
        with self.assertRaises(BackupError):
            artifact.decrypt_file(source, target, passphrase_file=self.passphrase_file,
                            runner=self.runner)
        self.assertEqual(target.read_bytes(), b'already here')

    def test_an_empty_or_short_passphrase_is_refused(self):
        plaintext = self.root / 'plain.bin'
        plaintext.write_bytes(b'payload')
        for content in ('', 'short', 'still-too-short'):
            with self.subTest(content=content):
                path = self.write_passphrase(content)
                with self.assertRaises(BackupError):
                    artifact.encrypt_file(plaintext, self.root / f'cipher-{len(content)}.bin',
                                    passphrase_file=path, runner=self.runner)

    def test_a_passphrase_must_be_one_line_openssl_will_use(self):
        for content in ('\n' + PASSPHRASE, PASSPHRASE + '\nignored',
                        PASSPHRASE + '\x00ignored', 'x' * 1024):
            with self.subTest(content=repr(content[:20])), self.assertRaises(BackupError):
                artifact.require_passphrase_file(self.write_passphrase(content))

    def test_a_passphrase_file_others_can_read_is_refused(self):
        path = self.write_passphrase(mode=0o644)
        with self.assertRaises(BackupError):
            artifact.require_passphrase_file(path)

    def test_a_relative_or_missing_passphrase_path_is_refused(self):
        with self.assertRaises(BackupError):
            artifact.require_passphrase_file(Path('passphrase'))
        with self.assertRaises(BackupError):
            artifact.require_passphrase_file(self.root / 'absent')

    def test_a_failed_openssl_run_raises_and_returns_no_digest(self):
        plaintext = self.root / 'plain.bin'
        plaintext.write_bytes(b'payload')
        failing = Runner(lambda argv, **_kwargs: Completed(returncode=1), real_openssl=False)
        with self.assertRaises(BackupError):
            artifact.encrypt_file(plaintext, self.root / 'cipher.bin',
                            passphrase_file=self.passphrase_file, runner=failing)

    def test_the_openssl_argv_is_a_list_the_passphrase_never_enters(self):
        plaintext = self.root / 'plain.bin'
        ciphertext = self.root / 'cipher.bin'
        encrypt = artifact.openssl_argv(plaintext, ciphertext, self.passphrase_file, decrypt=False)
        decrypt = artifact.openssl_argv(ciphertext, plaintext, self.passphrase_file, decrypt=True)
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
        self.assertEqual(artifact.archive_snapshot(staged, first), artifact.archive_snapshot(staged, second))
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_a_changed_metadata_does_not_change_the_digest(self):
        # The digest must be a fact about the data, not about the filesystem the tree
        # happens to sit on: another host, another umask, another mtime would
        # otherwise produce a different archive for the very same bytes.
        staged = self.staged_tree()
        before = artifact.archive_snapshot(staged, self.root / 'before.tar')
        for path in staged.rglob('*'):
            os.utime(path, (1_000_000, 1_000_000))
            path.chmod(0o700 if path.is_dir() else 0o600)
        after = artifact.archive_snapshot(staged, self.root / 'after.tar')
        self.assertEqual(before, after)
        self.assertEqual((self.root / 'before.tar').read_bytes(),
                         (self.root / 'after.tar').read_bytes())

    def test_a_changed_attachment_changes_the_digest(self):
        staged = self.staged_tree()
        before = artifact.archive_snapshot(staged, self.root / 'before.tar')
        (staged / 'filestore' / 'ab' / 'cdef').write_bytes(b'a different payload')
        after = artifact.archive_snapshot(staged, self.root / 'after.tar')
        self.assertNotEqual(before, after)

    def test_an_existing_target_is_refused(self):
        staged = self.staged_tree()
        target = self.root / 'taken.tar'
        target.write_bytes(b'existing')
        with self.assertRaises(BackupError):
            artifact.archive_snapshot(staged, target)
        self.assertEqual(target.read_bytes(), b'existing')

    def test_the_archive_holds_the_dump_and_the_filestore(self):
        staged = self.staged_tree()
        archive = self.root / 'artifact.tar'
        artifact.archive_snapshot(staged, archive)
        with tarfile.open(archive) as bundle:
            names = sorted(bundle.getnames())
            payloads = {member.name: bundle.extractfile(member).read()
                        for member in bundle.getmembers() if member.isfile()}
        self.assertEqual(names, ['database.dump', 'filestore', 'filestore/ab',
                                 'filestore/ab/cdef'])
        self.assertEqual(payloads['database.dump'], DUMP_BYTES)
        self.assertEqual(payloads['filestore/ab/cdef'], ATTACHMENT_BYTES)

    def test_the_archive_is_pax_so_a_member_of_eight_gib_or_more_fits(self):
        staged = self.staged_tree()
        with mock.patch.object(tarfile, 'open', wraps=tarfile.open) as opened:
            artifact.archive_snapshot(staged, self.root / 'artifact.tar')
        self.assertEqual(opened.call_args.kwargs['format'], tarfile.PAX_FORMAT)
        # A real 8 GiB file is impractical here; the header is where the limit lives.
        huge = tarfile.TarInfo(name='database.dump')
        huge.size = 8 * 1024 ** 3
        with self.assertRaises(ValueError):
            huge.tobuf(tarfile.USTAR_FORMAT, 'utf-8', 'surrogateescape')
        header = huge.tobuf(tarfile.PAX_FORMAT, 'utf-8', 'surrogateescape')
        self.assertIn(b'size=8589934592', header)

    def test_a_path_longer_than_ustar_allows_round_trips(self):
        staged = self.staged_tree()
        deep = staged / 'filestore' / '/'.join(['d' * 90] * 3)
        deep.mkdir(parents=True)
        (deep / 'blob').write_bytes(ATTACHMENT_BYTES)
        archive = self.root / 'artifact.tar'
        first = artifact.archive_snapshot(staged, archive)
        with tarfile.open(archive) as bundle:
            name = 'filestore/' + '/'.join(['d' * 90] * 3) + '/blob'
            self.assertEqual(bundle.extractfile(name).read(), ATTACHMENT_BYTES)
        self.assertEqual(first, artifact.archive_snapshot(staged, self.root / 'again.tar'))

    def test_a_symlink_is_refused(self):
        staged = self.root / 'staged'
        staged.mkdir()
        (staged / 'database.dump').write_bytes(DUMP_BYTES)
        (staged / 'escape').symlink_to('/etc/hosts')
        with self.assertRaises(BackupError):
            artifact.archive_snapshot(staged, self.root / 'artifact.tar')


class TestManifest(PipelineCase):
    def manifest(self, **overrides) -> BackupManifest:
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
        return BackupManifest(**fields)

    def test_json_round_trip_keeps_every_field(self):
        manifest = self.manifest()
        self.assertEqual(
            BackupManifest.from_json(manifest.to_json(self.passphrase_file), self.passphrase_file),
            manifest,
        )
        self.assertEqual(manifest.consistency, 'UNVERIFIED')
        self.assertEqual(manifest.cipher, 'aes-256-cbc-pbkdf2')

    def test_consistency_can_never_be_upgraded(self):
        payload = json.loads(self.manifest().to_json(self.passphrase_file))
        payload['consistency'] = 'CONSISTENT'
        with self.assertRaises(BackupError):
            BackupManifest.from_json(json.dumps(payload), self.passphrase_file)

    def test_an_unsigned_or_ambiguously_encoded_manifest_is_refused(self):
        manifest = self.manifest()
        valid = manifest.to_json(self.passphrase_file)
        with self.assertRaisesRegex(BackupError, 'authentication tag'):
            BackupManifest.from_json(json.dumps(manifest.payload()), self.passphrase_file)
        duplicate = valid.replace('"tenant":', '"tenant": "other", "tenant":')
        with self.assertRaisesRegex(BackupError, 'duplicate fields'):
            BackupManifest.from_json(duplicate, self.passphrase_file)

    def test_a_manifest_signed_with_a_different_passphrase_is_refused(self):
        valid = self.manifest().to_json(self.passphrase_file)
        other_key = self.write_passphrase('different test-only passphrase', mode=0o400)
        with self.assertRaisesRegex(BackupError, 'manifest authentication failed'):
            BackupManifest.from_json(valid, other_key)

    def test_a_malformed_manifest_is_refused(self):
        for text in ('', 'not json', '{}', '[]'):
            with self.subTest(text=text), self.assertRaises(BackupError):
                BackupManifest.from_json(text, self.passphrase_file)

    def test_a_non_utc_or_naive_capture_time_is_refused(self):
        naive = datetime(2026, 11, 8)
        with self.assertRaises(BackupError):
            self.manifest(captured_at=naive)
        with self.assertRaises(BackupError):
            self.manifest(captured_at=datetime(2026, 11, 8, tzinfo=timezone(timedelta(hours=3))))

    def test_a_non_sha256_digest_or_zero_size_is_refused(self):
        with self.assertRaises(BackupError):
            self.manifest(plaintext_sha256='not-a-digest')
        with self.assertRaises(BackupError):
            self.manifest(ciphertext_bytes=0)

    def test_a_tenant_that_could_leave_its_prefix_is_refused(self):
        for tenant in ('../acme', 'Acme', '', 'a/b'):
            with self.subTest(tenant=tenant), self.assertRaises(BackupError):
                self.manifest(tenant=tenant)


class TestCapture(PipelineCase):
    def keys(self, kind: str = 'hourly', stamp: str = STAMP) -> list[str]:
        prefix = artifact.artifact_prefix(TENANT, kind, datetime.fromisoformat(stamp))
        return self.store.list(prefix)

    def test_it_uploads_exactly_the_artifact_the_checksums_and_the_manifest(self):
        manifest = self.capture()
        self.assertEqual(self.keys(), [
            f'{TENANT}/hourly/2026-11-08T000000Z/{artifact.ARTIFACT_CIPHERTEXT_NAME}',
            f'{TENANT}/hourly/2026-11-08T000000Z/{artifact.CHECKSUMS_NAME}',
            f'{TENANT}/hourly/2026-11-08T000000Z/{artifact.MANIFEST_NAME}',
        ])
        self.assertGreater(self.store.head(self.keys()[0]), 0)
        uploaded = BackupManifest.from_json(self.store.get(self.keys()[2]), self.passphrase_file)
        self.assertEqual(uploaded, manifest)
        self.assertEqual(uploaded.consistency, 'UNVERIFIED')

    def test_the_checksums_cover_the_artifact_and_the_manifest(self):
        manifest = self.capture()
        listing = self.store.get(self.keys()[1]).decode('utf-8').splitlines()
        manifest_bytes = self.store.get(self.keys()[2])
        self.assertEqual(listing, [
            f'{manifest.ciphertext_sha256}  {artifact.ARTIFACT_CIPHERTEXT_NAME}',
            f'{hashlib.sha256(manifest_bytes).hexdigest()}  {artifact.MANIFEST_NAME}',
        ])

    def test_the_manifest_is_uploaded_last(self):
        self.capture()
        uploaded = list(self.store.list(f'{TENANT}/'))
        self.assertTrue(uploaded[-1].endswith(artifact.MANIFEST_NAME))
        self.assertTrue(uploaded[-2].endswith(artifact.CHECKSUMS_NAME))

    def test_it_never_uploads_plaintext(self):
        self.capture()
        for key in self.store.list(f'{TENANT}/'):
            payload = self.store.get(key)
            self.assertNotIn(DUMP_BYTES, payload)
            self.assertNotIn(ATTACHMENT_BYTES, payload)

    def test_a_capture_failure_uploads_no_manifest(self):
        failing = Runner(fake_pg_dump(writes=False))
        with self.assertRaises(BackupError):
            self.capture(runner=failing)
        self.assertEqual(self.store.list(f'{TENANT}/'), [])

    def test_a_store_failure_after_the_artifact_uploads_no_manifest(self):
        class FailingStore(FilesystemStore):
            def put(self, key, data):
                if key.endswith(artifact.CHECKSUMS_NAME):
                    message = 'the bucket refused the write'
                    raise StorageError(message)
                super().put(key, data)

        failing_store = FailingStore(self.root / 'broken')
        with self.assertRaises(StorageError):
            capture(
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
            [key for key in failing_store.list(f'{TENANT}/') if key.endswith(artifact.MANIFEST_NAME)],
            [],
        )

    def test_the_staged_snapshot_it_dumps_into_is_refused_when_it_exists(self):
        # The staging directory is created by the snapshot, never reused: a second copy into
        # the same tree could mix two captures' bytes under one manifest.
        with tempfile.TemporaryDirectory() as private:
            existing = Path(private) / 'snapshot'
            existing.mkdir()
            with self.assertRaises(BackupError):
                snapshot.snapshot(self.source(), existing, runner=self.runner)
            self.assertEqual(list(existing.iterdir()), [])

    def test_a_capture_without_a_dump_from_backup_py_is_refused(self):
        empty = Runner(lambda argv, **_kwargs: Completed())
        with self.assertRaises(BackupError):
            self.capture(runner=empty)
        self.assertEqual(self.store.list(f'{TENANT}/'), [])

    def test_a_second_capture_of_the_same_stamp_is_refused(self):
        self.capture()
        with self.assertRaises(BackupError):
            self.capture()

    def test_capture_stages_privately_and_removes_all_temporary_data(self):
        roots = []

        def inspect(argv, **kwargs):
            staged = Path(argv[argv.index('-f') + 1]).parent
            roots.append(staged.parent)
            self.assertEqual(staged.parent.stat().st_mode & 0o777, 0o700)
            return fake_pg_dump()(argv, **kwargs)

        self.capture(runner=Runner(inspect))
        self.assertTrue(roots)
        self.assertFalse(roots[0].exists())

    def test_capture_cleans_up_plaintext_on_upload_failure(self):
        class BrokenStore(FilesystemStore):
            def put(self, key, data):
                msg = 'upload failed'
                raise StorageError(msg)

        with self.assertRaises(StorageError):
            capture(
                store=BrokenStore(self.root / 'broken'), tenant=TENANT, source=self.source(),
                kind='hourly', work_root=self.work_root, passphrase_file=self.passphrase_file,
                now=datetime.fromisoformat(STAMP), runner=self.runner,
            )
        self.assertEqual(list(self.work_root.iterdir()), [])

    def test_the_capture_never_claims_quiescence(self):
        self.assertIn('UNVERIFIED', self.capture().consistency)

    def test_the_dump_is_the_one_pg_dump_argv_and_carries_no_password_flag(self):
        self.capture()
        argv = self.runner.calls[0]
        self.assertEqual(argv[0], str(self.source().pg_dump))
        self.assertEqual(argv[1:4], ['-Fc', '--serializable-deferrable', '--no-password'])
        self.assertEqual(argv[argv.index('-d') + 1], 'liwan_scratch')
        self.assertTrue(Path(argv[argv.index('-f') + 1]).is_absolute())
        self.assertFalse({'--password', '-W'} & set(argv))
        self.assertFalse(any('PGPASSWORD' in argument for argument in argv))


class TestControlPlaneCapture(PipelineCase):
    """The control plane database is one more source of the same pipeline."""

    PREFIX = f'{CONTROL_PLANE_SOURCE}/hourly/2026-11-08T000000Z/'

    def test_it_uploads_the_same_three_objects_under_the_control_plane_prefix(self):
        manifest = self.capture_control_plane()
        self.assertEqual(self.store.list(self.PREFIX), [
            self.PREFIX + artifact.ARTIFACT_CIPHERTEXT_NAME,
            self.PREFIX + artifact.CHECKSUMS_NAME,
            self.PREFIX + artifact.MANIFEST_NAME,
        ])
        uploaded = BackupManifest.from_json(self.store.get(self.PREFIX + artifact.MANIFEST_NAME), self.passphrase_file)
        self.assertEqual((uploaded, uploaded.tenant, uploaded.consistency),
                         (manifest, CONTROL_PLANE_SOURCE, 'UNVERIFIED'))

    def test_the_artifact_decrypts_to_the_dump_and_its_snapshot_manifest(self):
        self.capture_control_plane()
        ciphertext = self.root / 'artifact.enc'
        ciphertext.write_bytes(self.store.get(self.PREFIX + artifact.ARTIFACT_CIPHERTEXT_NAME))
        plain = self.root / 'artifact.tar'
        artifact.decrypt_file(ciphertext, plain, passphrase_file=self.passphrase_file)
        with tarfile.open(plain) as archive:
            self.assertEqual(archive.getnames(), [snapshot.DUMP_NAME, snapshot.MANIFEST_NAME])
            self.assertEqual(archive.extractfile(snapshot.DUMP_NAME).read(), DUMP_BYTES)
            manifest = json.loads(archive.extractfile(snapshot.MANIFEST_NAME).read())
        self.assertIsNone(manifest['filestore_copy'])
        self.assertEqual(manifest['filestore_file_count'], 0)
        self.assertEqual(manifest['consistency'], 'UNVERIFIED')

    def test_it_runs_pg_dump_directly_and_never_backup_py_or_a_password_flag(self):
        runner = Runner(fake_pg_dump())
        self.capture_control_plane(runner=runner)
        dumps = runner.calls_to('pg_dump')
        self.assertEqual(len(dumps), 1)
        argv = dumps[0]
        self.assertIn('-Fc', argv)
        self.assertEqual(argv[argv.index('-d') + 1], 'liwan_control')
        self.assertFalse({'--password', '-W'} & set(argv))
        self.assertEqual(runner.calls_to('backup.py'), [])

    def test_it_never_uploads_plaintext(self):
        self.capture_control_plane()
        for key in self.store.list(f'{CONTROL_PLANE_SOURCE}/'):
            self.assertNotIn(DUMP_BYTES, self.store.get(key))

    def test_a_pg_dump_failure_uploads_nothing_and_leaves_no_staging(self):
        with self.assertRaises(BackupError):
            self.capture_control_plane(runner=Runner(fake_pg_dump(writes=False)))
        self.assertEqual(self.store.list(f'{CONTROL_PLANE_SOURCE}/'), [])
        self.assertEqual(list(self.work_root.iterdir()), [])

    def test_a_dump_that_wrote_no_file_is_refused(self):
        silent = Runner(lambda argv, **_kwargs: Completed())
        with self.assertRaises(BackupError):
            self.capture_control_plane(runner=silent)
        self.assertEqual(self.store.list(f'{CONTROL_PLANE_SOURCE}/'), [])

    def test_a_forbidden_database_name_is_refused_before_any_process_runs(self):
        runner = Runner()
        with self.assertRaises(BackupError):
            self.capture_control_plane(runner=runner, source=self.control_plane_source('odoo19'))
        self.assertEqual(runner.calls, [])

    def test_the_database_only_shape_belongs_to_the_control_plane_alone(self):
        with self.assertRaises(BackupError):
            capture(store=self.store, tenant=TENANT, source=self.control_plane_source(),
                       kind='hourly', work_root=self.work_root, passphrase_file=self.passphrase_file,
                       now=datetime.fromisoformat(STAMP), runner=Runner(fake_pg_dump()))
        with self.assertRaises(BackupError):
            capture(store=self.store, tenant=CONTROL_PLANE_SOURCE, source=self.source(),
                       kind='hourly', work_root=self.work_root, passphrase_file=self.passphrase_file,
                       now=datetime.fromisoformat(STAMP), runner=self.runner)
        self.assertEqual(self.store.list(''), [])

    def test_retention_applies_to_it_and_leaves_tenants_alone(self):
        stamps = {'old': '2026-10-01T000000Z', 'new': '2026-11-08T000000Z'}
        for stamp in stamps.values():
            self.capture_control_plane(captured_at=parse_stamp(stamp).isoformat())
        self.put_artifact('hourly', datetime.fromisoformat(STAMP))
        report = prune(self.store, CONTROL_PLANE_SOURCE, now=datetime.fromisoformat('2026-11-08T01:00:00+00:00'))
        self.assertEqual(sorted({action.key.split('/')[2] for action in report.deleted}), [stamps['old']])
        self.assertEqual(len(self.store.list(f'{TENANT}/')), 3)

    def test_the_newest_complete_backup_is_found_for_the_drill(self):
        self.capture_control_plane(captured_at='2026-11-08T00:00:00+00:00')
        self.capture_control_plane(captured_at='2026-11-08T00:30:00+00:00')
        newest = recover.latest_artifact(self.store, CONTROL_PLANE_SOURCE)
        self.assertEqual(newest.captured_at, datetime(2026, 11, 8, 0, 30, tzinfo=timezone.utc))


class TestNewestAge(PipelineCase):
    def test_a_source_with_no_artifact_is_stale_with_no_age(self):
        report = newest_age(self.store, CONTROL_PLANE_SOURCE, datetime.fromisoformat(STAMP))
        self.assertEqual((report['stale'], report['age_seconds']), (True, None))

    def test_the_age_is_stale_one_second_past_the_rpo_and_not_at_it(self):
        self.capture_control_plane()
        base = datetime.fromisoformat(STAMP)
        at_limit = newest_age(self.store, CONTROL_PLANE_SOURCE, base + timedelta(seconds=RPO_SECONDS))
        past = newest_age(self.store, CONTROL_PLANE_SOURCE, base + timedelta(seconds=RPO_SECONDS + 1))
        self.assertEqual((at_limit['stale'], at_limit['age_seconds']), (False, 3600.0))
        self.assertTrue(past['stale'])

    def test_a_capture_without_its_manifest_does_not_count(self):
        self.store.put(f'{CONTROL_PLANE_SOURCE}/hourly/2026-11-08T000000Z/{artifact.ARTIFACT_CIPHERTEXT_NAME}', b'x')
        report = newest_age(self.store, CONTROL_PLANE_SOURCE, datetime.fromisoformat(STAMP))
        self.assertIsNone(report['newest_captured_at'])


class TestPrune(PipelineCase):
    def now(self) -> datetime:
        return datetime(2026, 11, 8, tzinfo=timezone.utc)

    def test_the_newest_hourly_and_daily_survive_ancient_timestamps(self):
        hourly = self.put_artifact('hourly', self.now() - timedelta(days=200))
        daily = self.put_artifact('daily', self.now() - timedelta(days=400))
        report = prune(self.store, TENANT, self.now())
        self.assertEqual(report.deleted, ())
        self.assertEqual(len(self.store.list(hourly)), 3)
        self.assertEqual(len(self.store.list(daily)), 3)

    def test_only_artifacts_beyond_the_window_are_deleted(self):
        fresh = self.put_artifact('hourly', self.now() - timedelta(days=3))
        stale = self.put_artifact('hourly', self.now() - timedelta(days=8))
        report = prune(self.store, TENANT, self.now())
        self.assertEqual(self.store.list(stale), [])
        self.assertEqual(len(self.store.list(fresh)), 3)
        stale_stamp = (self.now() - timedelta(days=8)).strftime(STAMP_FORMAT)
        self.assertEqual({action.key.split('/')[2] for action in report.deleted}, {stale_stamp})

    def test_an_older_artifact_inside_the_window_is_kept(self):
        newest = self.put_artifact('hourly', self.now() - timedelta(hours=1))
        older = self.put_artifact('hourly', self.now() - timedelta(days=6, hours=23))
        report = prune(self.store, TENANT, self.now())
        self.assertEqual(report.deleted, ())
        self.assertEqual(len(self.store.list(newest)), 3)
        self.assertEqual(len(self.store.list(older)), 3)

    def test_the_daily_window_is_thirty_days(self):
        self.put_artifact('daily', self.now() - timedelta(days=1))
        kept = self.put_artifact('daily', self.now() - timedelta(days=29))
        gone = self.put_artifact('daily', self.now() - timedelta(days=31))
        prune(self.store, TENANT, self.now())
        self.assertEqual(len(self.store.list(kept)), 3)
        self.assertEqual(self.store.list(gone), [])

    def test_every_decision_is_named_in_the_report(self):
        self.put_artifact('hourly', self.now() - timedelta(days=1))
        self.put_artifact('hourly', self.now() - timedelta(days=40))
        report = prune(self.store, TENANT, self.now())
        reasons = {action.key: action.reason for action in report.kept + report.deleted}
        self.assertEqual(len(reasons), 6)
        self.assertEqual(set(reasons.values()),
                         {KEEP_NEWEST, DELETE_BEYOND_WINDOW})
        self.assertEqual(report.as_dict()['tenant'], TENANT)
        self.assertEqual(len(report.as_dict()['deleted']), 3)

    def test_ciphertext_without_a_manifest_does_not_justify_pruning_a_complete_backup(self):
        complete = self.put_artifact('hourly', self.now() - timedelta(days=8))
        partial = artifact.artifact_prefix('acme', 'hourly', self.now() - timedelta(hours=1))
        self.store.put(partial + artifact.ARTIFACT_CIPHERTEXT_NAME, b'ciphertext, manifest upload failed')
        report = prune(self.store, TENANT, self.now())
        self.assertEqual(report.deleted, ())
        self.assertEqual(len(self.store.list(complete)), 3)
        self.assertEqual(self.store.list(partial), [partial + artifact.ARTIFACT_CIPHERTEXT_NAME])
        self.assertEqual({action.reason for action in report.kept if action.key.startswith(partial)},
                         {KEEP_UNRECOGNISED})

    def test_an_unrecognised_object_is_kept_and_named(self):
        self.put_artifact('hourly', self.now() - timedelta(days=400))
        self.store.put(f'{TENANT}/notes/operator.txt', b'do not delete me')
        report = prune(self.store, TENANT, self.now())
        self.assertEqual([action.reason for action in report.kept
                          if action.key.endswith('operator.txt')], [KEEP_UNRECOGNISED])
        self.assertEqual(self.store.get(f'{TENANT}/notes/operator.txt'), b'do not delete me')

    def test_another_tenant_is_untouched(self):
        other = artifact.artifact_prefix('other', 'hourly', self.now() - timedelta(days=400))
        self.store.put(other + artifact.MANIFEST_NAME, b'other tenant')
        prune(self.store, TENANT, self.now())
        self.assertEqual(self.store.get(other + artifact.MANIFEST_NAME), b'other tenant')

    def test_an_empty_tenant_prunes_nothing(self):
        report = prune(self.store, TENANT, self.now())
        self.assertEqual((report.kept, report.deleted), ((), ()))

    def test_an_invalid_tenant_is_refused(self):
        with self.assertRaises(BackupError):
            prune(self.store, '../escape', self.now())


class TestLatestArtifact(PipelineCase):
    def test_ciphertext_without_a_manifest_is_not_the_latest_artifact(self):
        complete = datetime(2026, 11, 7, tzinfo=timezone.utc)
        self.put_artifact('hourly', complete)
        partial = artifact.artifact_prefix(TENANT, 'hourly', datetime(2026, 11, 8, tzinfo=timezone.utc))
        self.store.put(partial + artifact.ARTIFACT_CIPHERTEXT_NAME, b'ciphertext, manifest upload failed')
        latest = recover.latest_artifact(self.store, TENANT)
        self.assertIsNotNone(latest)
        self.assertEqual(latest.captured_at, complete)

    def test_a_tenant_with_only_a_manifestless_artifact_has_no_latest(self):
        partial = artifact.artifact_prefix(TENANT, 'daily', datetime(2026, 11, 8, tzinfo=timezone.utc))
        self.store.put(partial + artifact.ARTIFACT_CIPHERTEXT_NAME, b'ciphertext, manifest upload failed')
        self.assertIsNone(recover.latest_artifact(self.store, TENANT))


class TestRestoreVerified(PipelineCase):
    def record(self, *, finished_at: datetime, verified: bool = True,
               name: str = 'restore-drill.json') -> Path:
        return self.write_record({
            'restore_verified': verified,
            'finished_at': finished_at.isoformat(),
            'started_at': (finished_at - timedelta(seconds=600)).isoformat(),
            'artifact_captured_at': (finished_at - timedelta(seconds=601)).isoformat(),
            'elapsed_seconds': 600,
        }, name=name)

    def now(self) -> datetime:
        return datetime(2026, 11, 8, 12, tzinfo=timezone.utc)

    def test_no_record_is_not_verified(self):
        self.assertFalse(drill_record_verified(self.root / 'absent.json', self.now()))

    def test_a_failed_record_is_not_verified(self):
        path = self.record(finished_at=self.now() - timedelta(minutes=5), verified=False)
        self.assertFalse(drill_record_verified(path, self.now()))

    def test_a_malformed_record_is_not_verified(self):
        for text in ('not json', '[]', '{"restore_verified": "true", "finished_at": "x"}',
                     '{"restore_verified": true}'):
            with self.subTest(text=text):
                path = self.write_record(text, name=f'malformed-{len(text)}.json')
                self.assertFalse(drill_record_verified(path, self.now()))

    def test_a_fresh_successful_record_is_verified(self):
        path = self.record(finished_at=self.now() - timedelta(minutes=5))
        self.assertTrue(drill_record_verified(path, self.now()))

    def test_a_record_older_than_the_rpo_window_flips_back_to_false(self):
        fresh = self.record(finished_at=self.now() - timedelta(seconds=RPO_SECONDS))
        self.assertTrue(drill_record_verified(fresh, self.now()))
        self.assertFalse(drill_record_verified(fresh, self.now() + timedelta(seconds=1)))

    def test_a_record_that_finished_in_the_future_is_not_verified(self):
        path = self.record(finished_at=self.now() + timedelta(minutes=5))
        self.assertFalse(drill_record_verified(path, self.now()))

    def test_the_policy_is_the_one_source_of_the_windows(self):
        # `status` reads the default policy; the override lives in recovery_objectives, which
        # is where the drill and the status share the numbers.
        captured = self.now() - timedelta(seconds=90)
        self.assertEqual(recovery_objectives(captured, self.now(), 60, RetentionPolicy(rpo_seconds=60, rto_seconds=60)),
                         (False, True))
        self.assertEqual(recovery_objectives(captured, self.now(), 60, RetentionPolicy()), (True, True))
        self.assertTrue(drill_record_verified(self.record(finished_at=self.now() - timedelta(seconds=90)), self.now()))
        self.assertEqual(RetentionPolicy().hourly_keep_days, 7)
        self.assertEqual(RetentionPolicy().daily_keep_days, 30)
        self.assertEqual((RPO_SECONDS, RTO_SECONDS), (3600, 4 * 3600))


class TestStatus(PipelineCase):
    def now(self) -> datetime:
        return datetime(2026, 11, 8, 12, tzinfo=timezone.utc)

    def record(self, *, captured_age: int, elapsed_seconds: float, finished_age: int = 30) -> Path:
        now = self.now()
        return self.write_record({
            'restore_verified': True,
            'artifact_captured_at': (now - timedelta(seconds=captured_age + finished_age
                                                                        + elapsed_seconds)).isoformat(),
            'started_at': (now - timedelta(seconds=finished_age + elapsed_seconds)).isoformat(),
            'finished_at': (now - timedelta(seconds=finished_age)).isoformat(),
            'elapsed_seconds': elapsed_seconds,
        })

    def test_rpo_is_ok_at_the_boundary_and_not_one_second_past_it(self):
        at_limit = self.record(captured_age=RPO_SECONDS, elapsed_seconds=60)
        self.assertTrue(status(record=at_limit, now=self.now())['rpo_ok'])
        past_limit = self.record(captured_age=RPO_SECONDS + 1, elapsed_seconds=60)
        self.assertFalse(status(record=past_limit, now=self.now())['rpo_ok'])

    def test_rto_is_ok_at_the_boundary_and_not_one_second_past_it(self):
        at_limit = self.record(captured_age=60, elapsed_seconds=RTO_SECONDS)
        self.assertTrue(status(record=at_limit, now=self.now())['rto_ok'])
        past_limit = self.record(captured_age=60, elapsed_seconds=RTO_SECONDS + 1)
        self.assertFalse(status(record=past_limit, now=self.now())['rto_ok'])

    def test_the_age_is_the_artifacts_age_not_the_drills_age(self):
        path = self.record(captured_age=1730, elapsed_seconds=60, finished_age=10)
        self.assertEqual(status(record=path, now=self.now())['last_backup_age_seconds'], 1800)

    def test_freshly_finished_restore_with_missed_objectives_is_not_verified(self):
        path = self.record(captured_age=6 * 3600, elapsed_seconds=15000)
        report = status(record=path, now=self.now())
        self.assertFalse(report['rpo_ok'])
        self.assertFalse(report['rto_ok'])
        self.assertFalse(report['restore_verified'])

    def test_no_record_reports_no_proof(self):
        report = status(record=self.root / 'absent.json', now=self.now())
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
        report = status(record=path, now=self.now())
        self.assertFalse(report['rpo_ok'])
        self.assertFalse(report['restore_verified'])


class TestCommandLine(PipelineCase):
    def run_main(self, argv) -> tuple[int, str, str]:
        """Run the CLI with the capture runner injected, never a real database."""
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = main(argv, runner=self.runner)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_status_reports_a_missing_record_as_not_verified(self):
        code, stdout, _stderr = self.run_main(['status', '--record', str(self.root / 'absent.json')])
        self.assertEqual(code, EXIT_NOT_VERIFIED)
        self.assertFalse(json.loads(stdout)['restore_verified'])

    def test_status_reports_a_fresh_record_as_verified(self):
        now = datetime.now(timezone.utc)
        path = self.write_record({
            'restore_verified': True,
            'artifact_captured_at': (now - timedelta(minutes=2)).isoformat(),
            'started_at': (now - timedelta(minutes=1)).isoformat(),
            'finished_at': now.isoformat(),
            'elapsed_seconds': 60,
        })
        code, stdout, _stderr = self.run_main(['status', '--record', str(path)])
        self.assertEqual(code, EXIT_OK)
        self.assertTrue(json.loads(stdout)['restore_verified'])

    def capture_argv(self, *, tenant=TENANT) -> list[str]:
        source = self.source()
        return [
            'capture', '--tenant', tenant, '--kind', 'daily',
            '--work-root', str(self.work_root), '--data-dir', str(source.filestore.parent.parent),
            '--pg-dump', str(source.pg_dump), '--store-root', str(self.root / 'cli-bucket'),
            '--now', STAMP,
        ]

    def registry_environment(self) -> dict[str, str]:
        registry = self.root / 'registry.json'
        registry.write_text(json.dumps({
            'schemaVersion': 1, 'snapshotRevision': 1, 'targets': [
                {'host': 'acme.example', 'tenantId': TENANT, 'database': 'liwan_scratch',
                 'filestore': 'liwan_scratch', 'enabled': True, 'registryRevision': 1},
                {'host': 'other.example', 'tenantId': 'other', 'database': 'liwan_other',
                 'filestore': 'liwan_other', 'enabled': False, 'registryRevision': 1},
                {'host': 'gone.example', 'tenantId': 'gone', 'database': 'liwan_gone',
                 'filestore': 'liwan_gone', 'enabled': False, 'retired': True, 'registryRevision': 2},
                {'host': 'kept.example', 'tenantId': 'kept', 'database': 'liwan_kept',
                 'filestore': 'liwan_kept', 'enabled': False, 'retired': False, 'registryRevision': 2},
            ],
        }), encoding='utf-8')
        return {'LIWAN_TENANT_REGISTRY_PATH': str(registry)}

    def fetch_artifact_dir(self, store: FilesystemStore, tenant: str = TENANT) -> Path:
        """Fetch the newest artifact back and return its extracted tree."""
        ref = recover.latest_artifact(store, tenant)
        self.assertIsNotNone(ref)
        destination = Path(tempfile.mkdtemp(prefix='fetched-', dir=self.root)) / 'artifact'
        fetched = recover.fetch_artifact(
            store, ref, destination, passphrase_file=self.passphrase_file, runner=self.runner,
        )
        return fetched.artifact_dir

    def test_capture_uses_the_database_and_filestore_from_the_trusted_registry(self):
        source = self.source()
        attachment = source.filestore / 'ab' / 'cdef'
        attachment.parent.mkdir(parents=True)
        attachment.write_bytes(ATTACHMENT_BYTES)
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file), **self.registry_environment()}
        with _environment(environ):
            code, stdout, stderr = self.run_main(self.capture_argv())
        self.assertEqual((code, stderr), (EXIT_OK, ''))
        self.assertEqual(json.loads(stdout)['status'], 'captured')
        pg_dump = self.runner.calls_to('pg_dump')[0]
        self.assertEqual(pg_dump[pg_dump.index('-d') + 1], source.db_name)
        store = FilesystemStore(self.root / 'cli-bucket')
        fetched = self.fetch_artifact_dir(store)
        self.assertEqual((fetched / 'filestore' / 'ab' / 'cdef').read_bytes(), ATTACHMENT_BYTES)
        self.assertEqual(len(store.list(f'{TENANT}/daily/')), 3)

    def test_capture_protects_a_disabled_but_still_bound_tenant(self):
        argv = self.capture_argv(tenant='other')
        filestore = self.root / 'data' / 'filestore' / 'liwan_other'
        (filestore / 'ab').mkdir(parents=True)
        (filestore / 'ab' / 'cdef').write_bytes(ATTACHMENT_BYTES)
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file), **self.registry_environment()}
        with _environment(environ):
            code, _stdout, stderr = self.run_main(argv)
        self.assertEqual((code, stderr), (EXIT_OK, ''))
        pg_dump = self.runner.calls_to('pg_dump')[0]
        self.assertEqual(pg_dump[pg_dump.index('-d') + 1], 'liwan_other')
        store = FilesystemStore(self.root / 'cli-bucket')
        self.assertEqual(len(store.list('other/daily/')), 3)
        fetched = self.fetch_artifact_dir(store, tenant='other')
        self.assertEqual((fetched / 'filestore' / 'ab' / 'cdef').read_bytes(), ATTACHMENT_BYTES)

    def test_capture_skips_a_retired_tenant_without_failing_or_touching_anything(self):
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file), **self.registry_environment()}
        with _environment(environ):
            code, stdout, stderr = self.run_main(self.capture_argv(tenant='gone'))
        # A retired tenant is an outcome, not a failure: exit 0, a named status, no dump, no upload, no work directory.
        self.assertEqual((code, stderr), (EXIT_OK, ''))
        self.assertEqual(json.loads(stdout), {'status': 'skipped', 'reason': 'retired', 'source': 'gone'})
        self.assertEqual(self.runner.calls, [])
        self.assertEqual(FilesystemStore(self.root / 'cli-bucket').list('gone/'), [])
        self.assertFalse(self.work_root.exists())

    def test_capture_backs_up_a_suspended_tenant_that_is_explicitly_not_retired(self):
        argv = self.capture_argv(tenant='kept')
        (self.root / 'data' / 'filestore' / 'liwan_kept').mkdir()
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file), **self.registry_environment()}
        with _environment(environ):
            code, stdout, stderr = self.run_main(argv)
        self.assertEqual((code, stderr), (EXIT_OK, ''))
        self.assertEqual(json.loads(stdout)['status'], 'captured')

    def test_the_freshness_check_does_not_alert_for_a_retired_tenant(self):
        environ = self.registry_environment()
        with _environment(environ):
            code, stdout, _stderr = self.run_main(['age', '--tenant', 'gone', '--store-root', str(self.root / 'cli-bucket'), '--now', STAMP])
            self.assertEqual(code, EXIT_OK)
            self.assertEqual(json.loads(stdout), {'source': 'gone', 'status': 'skipped', 'reason': 'retired', 'stale': False})
            # A tenant that is not retired with no backup is still stale; so is one the registry cannot answer for.
            code, _stdout, _stderr = self.run_main(['age', '--tenant', 'kept', '--store-root', str(self.root / 'cli-bucket'), '--now', STAMP])
            self.assertEqual(code, EXIT_NOT_VERIFIED)
            code, _stdout, _stderr = self.run_main(['age', '--tenant', 'unknown', '--store-root', str(self.root / 'cli-bucket'), '--now', STAMP])
            self.assertEqual(code, EXIT_NOT_VERIFIED)

    def test_capture_refuses_an_unknown_tenant_or_pending_registry(self):
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file), **self.registry_environment()}
        with _environment(environ):
            code, _stdout, stderr = self.run_main(self.capture_argv(tenant='unknown'))
            self.assertEqual(code, EXIT_REFUSED)
            self.assertIn('tenant registry', stderr)
            (self.root / 'registry.json.pending').touch()
            code, _stdout, stderr = self.run_main(self.capture_argv())
            self.assertEqual(code, EXIT_REFUSED)
            self.assertIn('tenant registry', stderr)
        self.assertEqual(self.runner.calls, [])
        self.assertFalse(self.work_root.exists())

    def test_capture_refuses_a_filestore_link_to_another_database(self):
        source = self.source()
        source.filestore.rmdir()
        other_store = self.root / 'another' / 'filestore' / source.db_name
        other_store.mkdir(parents=True)
        source.filestore.symlink_to(other_store)
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file), **self.registry_environment()}
        with _environment(environ):
            code, _stdout, stderr = self.run_main(self.capture_argv())
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('filestore', stderr)
        self.assertEqual(self.runner.calls, [])
        source.filestore.unlink()

    def test_capture_without_the_passphrase_variable_is_a_refusal(self):
        with _environment(self.registry_environment(), clear=(PASSPHRASE_ENVIRONMENT_VARIABLE,)):
            code, _stdout, stderr = self.run_main(self.capture_argv())
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn(PASSPHRASE_ENVIRONMENT_VARIABLE, stderr)
        self.assertEqual(FilesystemStore(self.root / 'cli-bucket').list(f'{TENANT}/'), [])
        self.assertFalse(self.work_root.exists())

    def control_plane_argv(self, *extra: str) -> list[str]:
        return [
            'capture', '--control-plane', '--kind', 'hourly', '--work-root', str(self.work_root),
            '--pg-dump', str(self.control_plane_source().pg_dump), '--db-name', 'liwan_control',
            '--store-root', str(self.root / 'cli-bucket'), '--now', STAMP, *extra,
        ]

    def test_capture_control_plane_needs_no_registry_and_no_data_dir(self):
        runner = Runner(fake_pg_dump())
        self.runner = runner
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}
        with _environment(environ, clear=(REGISTRY_ENVIRONMENT_VARIABLE,)):
            code, stdout, stderr = self.run_main(self.control_plane_argv())
        self.assertEqual((code, stderr), (EXIT_OK, ''))
        self.assertEqual(json.loads(stdout)['tenant'], CONTROL_PLANE_SOURCE)
        self.assertEqual(len(FilesystemStore(self.root / 'cli-bucket').list(f'{CONTROL_PLANE_SOURCE}/hourly/')), 3)

    def test_capture_control_plane_refuses_a_data_dir_or_a_missing_db_name(self):
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}
        with _environment(environ):
            code, _stdout, stderr = self.run_main(self.control_plane_argv('--data-dir', str(self.root)))
            self.assertEqual(code, EXIT_REFUSED)
            self.assertIn('--data-dir', stderr)
            argv = self.control_plane_argv()
            del argv[argv.index('--db-name'):argv.index('--db-name') + 2]
            code, _stdout, stderr = self.run_main(argv)
            self.assertEqual(code, EXIT_REFUSED)
            self.assertIn('--db-name', stderr)
        self.assertEqual(self.runner.calls, [])

    def test_a_tenant_capture_refuses_a_db_name(self):
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file), **self.registry_environment()}
        with _environment(environ):
            code, _stdout, stderr = self.run_main([*self.capture_argv(), '--db-name', 'liwan_scratch'])
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('--db-name', stderr)

    def test_a_tenant_named_like_the_control_plane_cannot_write_its_prefix(self):
        source = self.source()
        registry = self.root / 'registry.json'
        registry.write_text(json.dumps({
            'schemaVersion': 1, 'snapshotRevision': 1, 'targets': [
                {'host': 'x.example', 'tenantId': CONTROL_PLANE_SOURCE, 'database': 'liwan_scratch',
                 'filestore': 'liwan_scratch', 'enabled': True, 'registryRevision': 1}]}), encoding='utf-8')
        environ = {PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file),
                   REGISTRY_ENVIRONMENT_VARIABLE: str(registry)}
        with _environment(environ):
            code, _stdout, stderr = self.run_main(self.capture_argv(tenant=CONTROL_PLANE_SOURCE))
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('database-only', stderr)
        self.assertEqual(self.runner.calls, [])
        self.assertTrue(source.filestore.is_dir())

    def test_a_source_is_required_and_the_two_are_exclusive(self):
        for argv in (['prune'], ['prune', '--tenant', TENANT, '--control-plane']):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                main(argv)

    def test_age_exits_three_when_the_control_plane_backup_is_stale(self):
        now = datetime.now(timezone.utc)
        self.capture_control_plane(captured_at=(now - timedelta(minutes=30)).isoformat())
        store_args = ['--store-root', str(self.root / 'bucket'), '--control-plane']
        code, stdout, _stderr = self.run_main(['age', *store_args])
        self.assertEqual((code, json.loads(stdout)['stale']), (EXIT_OK, False))
        later = (now + timedelta(hours=2)).isoformat()
        code, stdout, _stderr = self.run_main(['age', *store_args, '--now', later])
        self.assertEqual((code, json.loads(stdout)['source']), (EXIT_NOT_VERIFIED, CONTROL_PLANE_SOURCE))

    def test_prune_prints_its_report_as_json(self):
        self.put_artifact('hourly', datetime.fromisoformat(STAMP))
        code, stdout, _stderr = self.run_main([
            'prune', '--tenant', TENANT, '--store-root', str(self.root / 'bucket'),
            '--now', '2026-11-09T00:00:00+00:00',
        ])
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(json.loads(stdout)['tenant'], TENANT)

    def test_a_refusal_exits_two_without_a_traceback(self):
        code, _stdout, stderr = self.run_main([
            'prune', '--tenant', '../escape', '--store-root', str(self.root / 'bucket'),
        ])
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('backup_pipeline:', stderr)


class _ScriptedStore(FilesystemStore):
    """A filesystem store with seams: a list hook, a ghost key, a page cap and a delete that may do nothing."""

    def __init__(self, root, *, on_list=None, ghost=None, page=None, delete_is_noop=False, absent_is_success=False) -> None:
        super().__init__(root)
        self.on_list, self.ghost, self.page = on_list, ghost, page
        self.delete_is_noop, self.absent_is_success = delete_is_noop, absent_is_success
        self.list_calls = 0
        self.ghost_listed = False

    def list(self, prefix: str) -> list[str]:
        self.list_calls += 1
        if self.on_list is not None:
            self.on_list(self, self.list_calls)
        keys = super().list(prefix)
        if self.ghost is not None and not self.ghost_listed and keys:
            self.ghost_listed = True
            keys = sorted([*keys, self.ghost])
        return keys if self.page is None else keys[: self.page]

    def delete(self, key: str) -> None:
        if self.delete_is_noop:
            return
        if self.absent_is_success and not (self._root / key).is_file():
            return
        super().delete(key)


class TestPurgeTenant(PipelineCase):
    def put_tenant(self, tenant: str = TENANT, count: int = 2) -> list[str]:
        keys = []
        for index in range(count):
            prefix = artifact.artifact_prefix(tenant, 'hourly' if index % 2 == 0 else 'daily', datetime(2026, 11, 1 + index, tzinfo=timezone.utc))
            for name in (artifact.ARTIFACT_CIPHERTEXT_NAME, artifact.CHECKSUMS_NAME, artifact.MANIFEST_NAME):
                self.store.put(prefix + name, b'x')
                keys.append(prefix + name)
        return keys

    def purge(self, store=None, tenant: str = TENANT, settle: float = 30, sleeps=None) -> PurgeReport:
        sleeps = [] if sleeps is None else sleeps
        return purge_tenant(store or self.store, tenant, settle, sleep=sleeps.append)

    def test_every_object_of_the_tenant_goes_and_other_prefixes_stay(self):
        self.put_tenant()
        self.put_tenant('acme2')
        self.put_tenant('control-plane', 1)
        sleeps: list[float] = []
        report = self.purge(sleeps=sleeps)
        self.assertEqual(self.store.list(f'{TENANT}/'), [])
        self.assertEqual(len(self.store.list('acme2/')), 6)
        self.assertEqual(len(self.store.list('control-plane/')), 3)
        self.assertEqual((report.first_pass_deleted, report.second_pass_deleted, report.delete_errors, report.remaining), (6, 0, 0, 0))
        self.assertEqual(sleeps, [30])
        self.assertEqual(set(report.as_dict()), {'tenant', 'first_pass_deleted', 'second_pass_deleted', 'delete_errors', 'remaining'})

    def test_the_newest_backup_of_each_kind_does_not_survive_a_purge(self):
        self.put_artifact('hourly', datetime(2026, 11, 8, tzinfo=timezone.utc))
        self.put_artifact('daily', datetime(2026, 11, 8, tzinfo=timezone.utc))
        self.purge()
        self.assertEqual(self.store.list(f'{TENANT}/'), [])

    def test_an_empty_tenant_is_already_done(self):
        report = self.purge()
        self.assertEqual((report.first_pass_deleted, report.second_pass_deleted, report.remaining), (0, 0, 0))

    def test_a_second_run_changes_nothing(self):
        self.put_tenant()
        self.purge()
        self.assertEqual(self.purge().first_pass_deleted, 0)

    def test_a_key_removed_by_someone_else_before_its_delete_does_not_fail_the_purge(self):
        # The listing names a key that is already gone; this store raises when asked to delete it.
        self.put_tenant()
        ghost = f'{TENANT}/hourly/2026-11-09T000000Z/{artifact.MANIFEST_NAME}'
        store = _ScriptedStore(self.root / 'bucket', ghost=ghost)
        report = self.purge(store)
        self.assertEqual((report.delete_errors, report.remaining), (1, 0))
        self.assertEqual(store.list(f'{TENANT}/'), [])

    def test_a_store_that_treats_an_absent_key_as_success_is_handled(self):
        self.put_tenant()
        ghost = f'{TENANT}/hourly/2026-11-09T000000Z/{artifact.MANIFEST_NAME}'
        store = _ScriptedStore(self.root / 'bucket', ghost=ghost, absent_is_success=True)
        report = self.purge(store)
        self.assertEqual((report.delete_errors, report.remaining), (0, 0))
        self.assertEqual(report.first_pass_deleted, 7)

    def test_a_capture_that_uploads_during_the_settle_wait_is_removed_by_the_second_pass(self):
        self.put_tenant()
        late = artifact.artifact_prefix(TENANT, 'hourly', datetime(2026, 11, 14, tzinfo=timezone.utc)) + artifact.MANIFEST_NAME

        def upload_while_waiting(_seconds: float) -> None:
            self.store.put(late, b'late capture')

        report = purge_tenant(self.store, TENANT, 30, sleep=upload_while_waiting)
        self.assertEqual((report.first_pass_deleted, report.second_pass_deleted, report.remaining), (6, 1, 0))
        self.assertEqual(self.store.list(f'{TENANT}/'), [])

    def test_a_key_that_appears_after_the_second_pass_fails_the_purge(self):
        self.put_tenant()
        late = f'{TENANT}/hourly/2026-11-14T000000Z/{artifact.MANIFEST_NAME}'

        def upload_before_the_final_listing(store, call: int) -> None:
            # Calls: first pass 2, second pass 1, final listing 4th.
            if call == 4:
                FilesystemStore.put(store, late, b'too late')

        store = _ScriptedStore(self.root / 'bucket', on_list=upload_before_the_final_listing)
        with self.assertRaises(PurgeIncompleteError) as caught:
            self.purge(store)
        self.assertEqual(caught.exception.report.remaining, 1)
        self.assertEqual(store.list(f'{TENANT}/'), [late])

    def test_a_store_that_does_not_delete_fails_instead_of_looping(self):
        self.put_tenant()
        store = _ScriptedStore(self.root / 'bucket', delete_is_noop=True)
        with self.assertRaises(PurgeIncompleteError) as caught:
            self.purge(store)
        self.assertEqual(caught.exception.report.remaining, 6)
        self.assertLess(store.list_calls, 20)

    def test_a_prefix_larger_than_one_listing_page_is_emptied(self):
        self.put_tenant(count=7)
        store = _ScriptedStore(self.root / 'bucket', page=4)
        report = self.purge(store)
        self.assertEqual((report.first_pass_deleted, report.remaining), (21, 0))
        self.assertEqual(FilesystemStore.list(store, f'{TENANT}/'), [])

    def test_a_listing_that_names_a_foreign_key_is_refused_before_any_delete(self):
        class Foreign:
            deleted: list[str] = []

            def list(self, prefix: str) -> list[str]:
                return [f'{prefix}a', 'other/b']

            def delete(self, key: str) -> None:
                self.deleted.append(key)

        store = Foreign()
        with self.assertRaises(BackupError):
            purge_tenant(store, TENANT, 0, sleep=lambda _s: None)
        self.assertEqual(store.deleted, [])

    def test_an_id_the_registry_could_not_have_issued_is_refused_before_the_store_is_touched(self):
        class Untouchable:
            def list(self, prefix: str) -> list[str]:
                message = 'the store must not be listed'
                raise AssertionError(message)

            def delete(self, key: str) -> None:
                message = 'the store must not be written'
                raise AssertionError(message)

        for tenant in ('', 'a/b', 'acme/', '../x', '/acme', 'Acme', '1acme', '-acme', ' acme', 'acme ', 'a' * 64,
                       CONTROL_PLANE_SOURCE, None, 7, 'a b', 'acme\x00'):
            with self.subTest(tenant=tenant), self.assertRaises(BackupError):
                purge_tenant(Untouchable(), tenant, 0, sleep=lambda _s: None)

    def test_a_bad_settle_time_is_refused(self):
        for settle in (-1, float('nan'), float('inf'), 10**9, True, None, '5'):
            with self.subTest(settle=settle), self.assertRaises(BackupError):
                purge_tenant(self.store, TENANT, settle, sleep=lambda _s: None)

    def test_the_command_purges_and_prints_counts_only(self):
        keys = self.put_tenant()
        runner = Runner(fake_pg_dump())
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = main(['purge', '--tenant', TENANT, '--settle-seconds', '0', '--store-root', str(self.root / 'bucket')], runner=runner)
        self.assertEqual(code, EXIT_OK)
        report = json.loads(stdout.getvalue())
        self.assertEqual((report['status'], report['first_pass_deleted'], report['remaining']), ('purged', len(keys), 0))
        self.assertNotIn(TENANT + '/', stdout.getvalue())

    def test_the_command_refuses_the_control_plane_source_and_a_slash(self):
        self.put_tenant('control-plane', 1)
        for tenant in (CONTROL_PLANE_SOURCE, 'a/b', ''):
            stdout, stderr = io.StringIO(), io.StringIO()
            with self.subTest(tenant=tenant), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = main(['purge', '--tenant', tenant, '--settle-seconds', '0', '--store-root', str(self.root / 'bucket')],
                               runner=Runner(fake_pg_dump()))
            self.assertEqual(code, EXIT_REFUSED)
            self.assertIn('backup_pipeline:', stderr.getvalue())
        self.assertEqual(len(self.store.list('control-plane/')), 3)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            main(['purge', '--control-plane', '--tenant', TENANT])

    def test_the_command_exits_not_verified_when_objects_remain(self):
        self.put_tenant()
        stdout = io.StringIO()
        with mock.patch.object(store_module.s3_client, 'FilesystemStore', lambda root: _ScriptedStore(root, delete_is_noop=True)), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(io.StringIO()):
            code = main(['purge', '--tenant', TENANT, '--settle-seconds', '0', '--store-root', str(self.root / 'bucket')],
                           runner=Runner(fake_pg_dump()))
        self.assertEqual(code, EXIT_NOT_VERIFIED)
        self.assertEqual((json.loads(stdout.getvalue())['status'], json.loads(stdout.getvalue())['remaining']), ('incomplete', 6))


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


class TestDump(PipelineCase):
    """The one ``pg_dump`` command line and the database names refused before it runs."""

    def test_the_argv_is_a_custom_format_serializable_snapshot_with_no_password(self):
        argv = build_pg_dump_argv(
            pg_dump=str(self.source().pg_dump),
            db_name='liwan_scratch',
            output_file=str(self.root / 'database.dump'),
            pg_host='127.0.0.1',
            pg_port='5432',
            pg_user='odoo',
        )
        self.assertEqual(argv[1:4], ['-Fc', '--serializable-deferrable', '--no-password'])
        self.assertEqual(argv[argv.index('-d') + 1], 'liwan_scratch')
        self.assertEqual(
            (argv[argv.index('-h') + 1], argv[argv.index('-p') + 1], argv[argv.index('-U') + 1]),
            ('127.0.0.1', '5432', 'odoo'),
        )
        self.assertFalse({'--password', '-W'} & set(argv))
        self.assertNotIn('PGPASSWORD', ' '.join(argv))

    def test_a_live_looking_or_unsafe_database_name_is_refused(self):
        for name in ('odoo19', 'production', 'prod', 'postgres', 'template0', 'template1',
                     'acme_production', '9acme', 'acme-1', ''):
            with self.subTest(name=name), self.assertRaises(BackupError):
                validate_db_name(name)
        self.assertEqual(validate_db_name('liwan_scratch'), 'liwan_scratch')

    def test_a_missing_pg_dump_binary_is_refused(self):
        with self.assertRaises(BackupError):
            build_pg_dump_argv(
                pg_dump=str(self.root / 'absent'), db_name='liwan_scratch',
                output_file=str(self.root / 'database.dump'),
            )

    def test_the_container_form_names_the_command_without_requiring_it_locally_and_streams_the_archive(self):
        argv = build_pg_dump_argv(
            db_name='liwan_scratch', output_file='-', pg_host='db', pg_user='postgres', container=True,
        )
        self.assertEqual(argv, ['pg_dump', '-Fc', '--serializable-deferrable', '--no-password',
                                '-d', 'liwan_scratch', '-f', '-', '-h', 'db', '-U', 'postgres'])
        # A path inside the container is accepted as it is; the machine building the argv need not hold it.
        explicit = build_pg_dump_argv(
            pg_dump='/usr/local/bin/pg_dump', db_name='liwan_scratch', output_file='/dev/stdout', container=True,
        )
        self.assertEqual((explicit[0], explicit[explicit.index('-f') + 1]),
                         ('/usr/local/bin/pg_dump', '/dev/stdout'))

    def test_the_container_form_refuses_a_command_or_output_that_could_escape_the_shipped_line(self):
        for command in ('', ' pg_dump', 'pg dump', 'pg_dump; rm -rf /', '../pg_dump', '/usr/../pg_dump', 3):
            with self.subTest(command=command), self.assertRaises(BackupError):
                build_pg_dump_argv(pg_dump=command, db_name='liwan_scratch', output_file='-', container=True)
        for target in ('dump', '/tmp/x/../y', ''):
            with self.subTest(target=target), self.assertRaises(BackupError):
                build_pg_dump_argv(db_name='liwan_scratch', output_file=target, container=True)


class TestSnapshot(PipelineCase):
    def attachment(self, source: CaptureSource) -> Path:
        path = source.filestore / 'ab' / 'cdef'
        path.parent.mkdir(parents=True)
        path.write_bytes(ATTACHMENT_BYTES)
        return path

    def test_the_snapshot_manifest_pins_the_dump_and_the_filestore_tree(self):
        source = self.source()
        self.attachment(source)
        payload = snapshot.snapshot(source, self.root / 'snapshot', runner=self.runner)
        self.assertEqual(payload['database_dump_sha256'], hashlib.sha256(DUMP_BYTES).hexdigest())
        self.assertEqual(
            (payload['filestore_sha256'], payload['filestore_file_count']),
            filestore_digest(self.root / 'snapshot' / 'filestore'),
        )
        self.assertEqual(payload['filestore_file_count'], 1)
        self.assertEqual(payload['consistency'], 'UNVERIFIED')
        self.assertFalse(payload['recovery_ready'])
        self.assertEqual(payload['quiesce'], 'not_required')

    def test_a_staged_snapshot_directory_that_exists_is_refused(self):
        destination = self.root / 'snapshot'
        destination.mkdir()
        with self.assertRaises(BackupError):
            snapshot.snapshot(self.source(), destination, runner=self.runner)
        self.assertEqual(list(destination.iterdir()), [])
        self.assertEqual(self.runner.calls, [])

    def test_a_dump_that_wrote_no_file_is_refused(self):
        with self.assertRaises(BackupError):
            snapshot.snapshot(
                self.source(), self.root / 'snapshot', runner=Runner(fake_pg_dump(writes=False)),
            )
        self.assertFalse((self.root / 'snapshot' / snapshot.MANIFEST_NAME).exists())

    def test_the_filestore_digest_follows_the_content_and_the_names(self):
        filestore = self.source().filestore
        before = filestore_digest(filestore)
        (filestore / 'ab').mkdir()
        (filestore / 'ab' / 'one').write_bytes(b'x')
        changed = filestore_digest(filestore)
        self.assertNotEqual(before[0], changed[0])
        self.assertEqual((before[1], changed[1]), (0, 1))
        (filestore / 'ab' / 'one').write_bytes(b'z')
        self.assertNotEqual(changed[0], filestore_digest(filestore)[0])
        (filestore / 'ab' / 'one').rename(filestore / 'ab' / 'renamed')
        self.assertNotEqual(changed[0], filestore_digest(filestore)[0])
        self.assertEqual(filestore_digest(filestore)[1], 1)

    def test_an_empty_filestore_has_the_empty_digest_and_a_zero_count(self):
        self.assertEqual(filestore_digest(self.source().filestore), (hashlib.sha256(b'').hexdigest(), 0))

    def test_a_symlinked_file_a_dangling_link_or_a_linked_directory_is_refused(self):
        filestore = self.source().filestore
        links = filestore / 'ab'
        links.mkdir()
        (links / 'external').symlink_to('/etc/hosts')
        (links / 'dangling').symlink_to(self.root / 'missing')
        (links / 'outside').symlink_to(self.root, target_is_directory=True)
        for name in ('external', 'dangling', 'outside'):
            with self.subTest(name=name):
                self.assertTrue((links / name).is_symlink())
                with self.assertRaisesRegex(BackupError, 'symlink'):
                    validate_filestore(filestore, 'liwan_scratch')

    def test_a_special_file_is_refused(self):
        filestore = self.source().filestore
        (filestore / 'ab').mkdir()
        os.mkfifo(filestore / 'ab' / 'pipe')
        with self.assertRaisesRegex(BackupError, 'special file'):
            validate_filestore(filestore, 'liwan_scratch')

    def test_a_symlinked_filestore_root_is_refused(self):
        source = self.source()
        moved = self.root / 'elsewhere' / source.db_name
        moved.parent.mkdir()
        source.filestore.rename(moved)
        source.filestore.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(BackupError, 'must not be a symlink'):
            validate_filestore(source.filestore, source.db_name)


class TestLock(PipelineCase):
    """One backup per database: an exclusive lock in a private directory of this test's own."""

    DB = 'customerdb'

    def setUp(self) -> None:
        super().setUp()
        self.locks = self.root / 'locks'
        self.locks.mkdir()
        patcher = mock.patch.object(lock_module, 'lock_directory', return_value=self.locks)
        patcher.start()
        self.addCleanup(patcher.stop)

    def lock_path(self) -> Path:
        return self.locks / f'{self.DB}.lock'

    def test_a_second_concurrent_run_for_the_same_database_is_refused(self):
        with database_lock(self.DB):
            with self.assertRaisesRegex(BackupError, f'another backup of database {self.DB} is already running'):
                with database_lock(self.DB):
                    pass

    def test_a_run_is_allowed_again_after_the_lock_was_released(self):
        with database_lock(self.DB):
            pass
        with database_lock(self.DB):
            pass

    def test_the_lock_is_released_when_the_run_fails(self):
        with self.assertRaises(BackupError):
            snapshot.snapshot(
                self.source(), self.root / 'first', runner=Runner(fake_pg_dump(writes=False)),
            )
        self.assertTrue(snapshot.snapshot(self.source(), self.root / 'second', runner=self.runner))

    def test_the_lock_is_released_when_the_run_raises_unexpectedly(self):
        message = 'pg_dump could not start'

        def runner(_argv, **_kwargs):
            raise RuntimeError(message)

        with self.assertRaises(RuntimeError):
            snapshot.snapshot(self.source(), self.root / 'first', runner=runner)
        self.assertTrue(snapshot.snapshot(self.source(), self.root / 'second', runner=self.runner))

    def test_another_database_is_not_blocked(self):
        other = CaptureSource(
            db_name='otherdb', filestore=self.source().filestore, pg_dump=self.source().pg_dump,
        )
        with database_lock(self.DB):
            self.assertTrue(snapshot.snapshot(other, self.root / 'other', runner=self.runner))

    def test_a_lock_held_by_another_process_refuses_the_run(self):
        holder = subprocess.Popen(
            [sys.executable, '-B', '-c',
             'import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); '
             'import deploy.backup.lock as lock; lock.lock_directory = lambda: Path(sys.argv[3]); '
             'held = lock.database_lock(sys.argv[2]); held.__enter__(); '
             'print("locked", flush=True); sys.stdin.read()',
             str(Path(lock_module.__file__).parents[2]), self.DB, str(self.locks)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'locked')
            with self.assertRaisesRegex(BackupError, 'already running'):
                with database_lock(self.DB):
                    pass
        finally:
            holder.communicate()

    def test_the_command_line_refuses_a_held_lock_with_a_message_and_exit_code_two(self):
        source = self.source()
        argv = [
            'capture', '--tenant', TENANT, '--kind', 'daily', '--work-root', str(self.work_root),
            '--db-name', source.db_name, '--filestore', str(source.filestore),
            '--pg-dump', str(source.pg_dump), '--store-root', str(self.root / 'bucket'),
        ]
        stderr = io.StringIO()
        with database_lock(source.db_name), mock.patch('sys.stderr', stderr), \
                _environment({PASSPHRASE_ENVIRONMENT_VARIABLE: str(self.passphrase_file)}):
            code = main(argv, runner=self.runner)
        self.assertEqual(code, EXIT_REFUSED)
        self.assertIn('already running', stderr.getvalue())
        self.assertEqual(self.runner.calls, [])
        self.assertEqual(FilesystemStore(self.root / 'bucket').list(f'{TENANT}/'), [])

    def test_the_lock_file_is_created_0644_whatever_the_umask(self):
        previous = os.umask(0o077)
        try:
            with database_lock(self.DB):
                pass
        finally:
            os.umask(previous)
        self.assertEqual(self.lock_path().stat().st_mode & 0o777, 0o644)

    def test_a_read_only_lock_file_left_behind_is_lockable_again(self):
        with database_lock(self.DB):
            pass
        self.lock_path().chmod(0o444)
        with database_lock(self.DB):
            with self.assertRaisesRegex(BackupError, 'already running'):
                with database_lock(self.DB):
                    pass
        self.assertEqual(self.lock_path().stat().st_mode & 0o777, 0o444)

    def test_a_lock_file_that_cannot_be_opened_is_an_explicit_error(self):
        with mock.patch('deploy.backup.lock.os.open', side_effect=PermissionError(13, 'Permission denied')):
            with self.assertRaisesRegex(BackupError, 'cannot open the backup lock .*Permission denied'):
                with database_lock(self.DB):
                    pass

    def test_a_fifo_in_place_of_the_lock_file_is_refused_without_hanging(self):
        os.mkfifo(self.lock_path())
        with self.assertRaisesRegex(BackupError, 'not a regular file'):
            with database_lock(self.DB):
                pass

    def test_a_symlink_in_place_of_the_lock_file_is_refused(self):
        target = self.root / 'elsewhere'
        target.write_text('x', encoding='utf-8')
        self.lock_path().symlink_to(target)
        with self.assertRaisesRegex(BackupError, 'cannot open the backup lock'):
            with database_lock(self.DB):
                pass


class TestLockDirectory(PipelineCase):
    def test_the_default_lock_directory_is_private_and_owned_by_this_user(self):
        with mock.patch('deploy.backup.lock.tempfile.gettempdir', return_value=str(self.root)):
            directory = lock_directory()
        self.assertEqual(directory, self.root / LOCK_DIR_NAME)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)

    def test_a_default_lock_directory_that_is_a_symlink_is_refused(self):
        (self.root / 'locks').mkdir()
        (self.root / LOCK_DIR_NAME).symlink_to(self.root / 'locks', target_is_directory=True)
        with mock.patch('deploy.backup.lock.tempfile.gettempdir', return_value=str(self.root)):
            with self.assertRaisesRegex(BackupError, 'not a directory owned by this user'):
                lock_directory()


class TestKeysAndStamps(PipelineCase):
    def test_the_key_layout_is_tenant_then_kind_then_utc_stamp(self):
        self.assertEqual(
            artifact.artifact_prefix(TENANT, 'hourly', datetime(2026, 11, 8, 5, 4, 3,
                                                          tzinfo=timezone.utc)),
            'acme/hourly/2026-11-08T050403Z/',
        )
        with self.assertRaises(BackupError):
            artifact.artifact_prefix(TENANT, 'weekly', datetime.now(timezone.utc))

    def test_a_stamp_must_be_the_written_format(self):
        self.assertEqual(parse_stamp('2026-11-08T000000Z'),
                         datetime(2026, 11, 8, tzinfo=timezone.utc))
        for stamp in ('2026-11-08', '2026-11-08T00:00:00Z', 'nonsense'):
            with self.subTest(stamp=stamp), self.assertRaises(BackupError):
                parse_stamp(stamp)

    def test_a_stamp_without_a_timezone_is_refused_by_the_clock_guard(self):
        with self.assertRaises(BackupError):
            as_utc(datetime(2026, 11, 8))


if __name__ == '__main__':
    unittest.main()
