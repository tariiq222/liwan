# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restore drill: fetch the newest artifact, restore it into scratch, record the truth.

One fact lives here: whether the newest backup this tenant has can actually be
restored, how long that took, and when that was proven. The drill is the only thing
that may set ``restore_verified``; :mod:`deploy.backup_pipeline` reads the record and
never invents the answer, and :func:`deploy.backup_pipeline.restore_verified` reports
``True`` only for a record that is fresh against the caller's clock.

Proven here, offline, against :class:`s3_client.FilesystemStore` and injected process
runners:

* an artifact whose ciphertext or plaintext SHA-256 disagrees with its manifest is
  refused before any database is created, so a substituted or truncated upload cannot
  reach a restore;
* the target database must be a new scratch name and may not resemble
  ``odoo19``/``prod``/``production``/``postgres``/``template0``/``template1`` — the
  guard is :func:`deploy.restore_verify.validate_target_db`, imported rather than
  copied, so the drill and the restore verifier cannot drift apart;
* the record is written atomically (a temporary file in the same directory, then
  ``os.replace``), so a reader never sees half a record and a crash leaves the
  previous record intact;
* ``rpo_ok``/``rto_ok`` come from the artifact's capture time and the measured
  elapsed seconds, and the exit code follows the evidence: 0 verified, 3 not
  verified, 2 refused.

Not proven here: multi-node failover, a network failure mid-restore, concurrent
production load during the drill, a real bucket, and point-in-time recovery. The
record lists all five in ``not_covered``, because a drill that claimed them would be
claiming something it never did.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

try:  # imported as deploy.<module> (repository tests, PYTHONPATH=.)
    from deploy import backup_pipeline, restore_verify, s3_client
except ImportError:  # executed as a script from deploy/ (PYTHONPATH=deploy)
    import backup_pipeline
    import restore_verify
    import s3_client

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

RECORD_SCHEMA_VERSION = 1
RECORD_NAME = 'restore-drill.json'
BACKUP_DIR_NAME = 'backup'
STAGE_DIR_NAME = 'fetched'
PLAINTEXT_NAME = 'artifact.tar'
RESTORE_SCRIPT_NAME = 'restore_verify.py'
RESTORE_VERIFICATION_NAME = 'restore-verification.json'
ARTIFACT_CIPHERTEXT_NAME = backup_pipeline.ARTIFACT_CIPHERTEXT_NAME

RESTORE_TOOLS = ('pg_restore', 'createdb', 'psql')

EXIT_OK = 0
EXIT_REFUSED = 2
EXIT_NOT_VERIFIED = 3

# What one drill on one host cannot prove. The record carries this list so a reader
# of the evidence sees the boundary, not only the pass.
NOT_COVERED = (
    'multi-node failover',
    'network failure during the restore',
    'concurrent production load during capture or restore',
    'a real S3 bucket (the drill reads whatever store it is given)',
    'point-in-time recovery (full dump only, no WAL archiving)',
)


class DrillError(Exception):
    """The drill refused or failed; no record claims a verified restore."""


@dataclass(frozen=True)
class RestoreTools:
    """The three PostgreSQL client binaries a restore needs, already validated."""

    pg_restore: Path
    createdb: Path
    psql: Path

    @classmethod
    def from_environment(cls) -> RestoreTools:
        """Resolve the binaries from ``PATH``; a missing one is a refusal."""
        resolved = {}
        for name in RESTORE_TOOLS:
            found = shutil.which(name)
            if not found:
                message = f'{name} is not on PATH; the drill cannot restore anything'
                raise DrillError(message)
            resolved[name] = Path(found)
        return cls(**resolved)

    def as_argv_tail(self) -> list[str]:
        return ['--pg-restore', str(self.pg_restore), '--createdb', str(self.createdb),
                '--psql', str(self.psql)]


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise DrillError(message)


def _exit_code(completed: object) -> int:
    """The exit code a runner returned; a runner that returns none is refused."""
    code = getattr(completed, 'returncode', None)
    _require(code is not None, 'the process runner returned no exit code')
    return int(code)


def require_scratch_database(target_db: str) -> str:
    """Refuse anything that is not a new scratch name, using the verifier's own rule.

    The pattern lives in :mod:`deploy.restore_verify`; the drill imports it instead of
    repeating the regex, so the two tools cannot disagree about what is forbidden.
    """
    try:
        return restore_verify.validate_target_db(target_db)
    except restore_verify.RestoreError as error:
        raise DrillError(str(error)) from error


def _fetch_verified_artifact(
    store: s3_client.S3Store | s3_client.FilesystemStore,
    tenant: str,
    stage: Path,
    passphrase_file: Path,
    runner: Callable[..., object],
) -> tuple[backup_pipeline.ArtifactRef, backup_pipeline.BackupManifest, bytes]:
    """Fetch the newest artifact, prove both digests, and decrypt it.

    Returns the artifact reference, the parsed manifest, and the manifest bytes as
    they arrived. The bytes are returned rather than a digest alone so the restore
    verifier receives exactly the manifest that was just verified, and the record's
    digest names those same bytes.
    """
    ref = backup_pipeline.latest_artifact(store, tenant)
    if ref is None:
        message = f'tenant {tenant!r} has no artifact to drill'
        raise DrillError(message)
    manifest_bytes = store.get(ref.manifest_key)
    manifest = backup_pipeline.BackupManifest.from_json(manifest_bytes.decode('utf-8'))
    ciphertext = store.get(ref.artifact_key)
    ciphertext_sha256 = hashlib.sha256(ciphertext).hexdigest()
    if ciphertext_sha256 != manifest.ciphertext_sha256:
        message = (
            f'artifact {ref.artifact_key} does not match its manifest: '
            f'ciphertext sha256 {ciphertext_sha256} != {manifest.ciphertext_sha256}'
        )
        raise DrillError(message)

    _require(not stage.exists(), f'{stage} is not fresh; a drill needs its own scratch root')
    stage.mkdir(parents=True)
    encrypted = stage / ARTIFACT_CIPHERTEXT_NAME
    encrypted.write_bytes(ciphertext)
    plaintext = stage / PLAINTEXT_NAME
    plaintext_sha256 = backup_pipeline.decrypt_file(
        encrypted, plaintext, passphrase_file=passphrase_file, runner=runner,
    )
    if plaintext_sha256 != manifest.plaintext_sha256:
        message = (
            f'artifact {ref.artifact_key} decrypted to sha256 {plaintext_sha256}, '
            f'not the {manifest.plaintext_sha256} its manifest pinned'
        )
        raise DrillError(message)
    return ref, manifest, manifest_bytes


def _write_capture_manifest(backup_dir: Path, manifest_bytes: bytes) -> None:
    """Write the capture manifest the restore verifier insists on beside the dump.

    ``deploy/restore_verify.py`` requires ``database.dump``, ``filestore/`` and
    ``manifest.json`` in one directory. The artifact carries the first two; this
    writes the third from the bytes that were verified against the ciphertext, so the
    verifier records the capture-time manifest and not a synthesized one.
    """
    (backup_dir / 'manifest.json').write_bytes(manifest_bytes)


def _extract_archive(archive: Path, destination: Path) -> None:
    """Extract the artifact inside ``destination`` and nowhere else."""
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with tarfile.open(archive, 'r') as bundle:
        for member in bundle.getmembers():
            target = (root / member.name).resolve()
            _require(
                target == root or root in target.parents,
                f'the artifact holds a member outside the restore directory: {member.name}',
            )
            # `data` is the only filter that matches this check and also refuses
            # links, devices and absolute names on its own, so a member cannot be
            # written outside the root even if the check above changed. Naming it
            # explicitly also silences Python 3.12's pending-default warning, which
            # would otherwise reach the command line's stderr.
            _require(not (member.issym() or member.islnk() or member.isdev()),
                     f'the artifact holds a link or device member: {member.name}')
        _extract_all(bundle, destination)


def _extract_all(bundle: tarfile.TarFile, destination: Path) -> None:
    """Extract with the ``data`` filter where it exists (3.12+), else the checked members.

    Every member was proven to sit inside the destination above, so the 3.9 path is
    safe; the ``data`` filter additionally refuses links, devices and absolute names
    on its own, and naming it silences 3.12's pending-default warning.
    """
    if hasattr(tarfile, 'data_filter'):
        bundle.extractall(destination, filter='data')
    else:
        bundle.extractall(destination)


def _restore_argv(
    *,
    restore_script: Path,
    backup_dir: Path,
    target_db: str,
    target_filestore: Path,
    tools: RestoreTools,
    pg_host: str | None,
    pg_port: str | None,
    pg_user: str | None,
) -> list[str]:
    argv = [
        sys.executable,
        str(restore_script),
        '--backup-dir',
        str(backup_dir),
        '--target-db',
        target_db,
        '--target-filestore',
        str(target_filestore),
        *tools.as_argv_tail(),
    ]
    for flag, value in (('--pg-host', pg_host), ('--pg-port', pg_port), ('--pg-user', pg_user)):
        if value:
            argv.extend([flag, str(value)])
    return argv


def _read_restore_result(backup_dir: Path, exit_code: int) -> dict[str, object]:
    """The verifier's own record of the restore, not just its exit code.

    ``restore_verify.py`` writes ``restore-verification.json`` beside the restored
    artifact; the drill reads that file because it is the evidence an operator can
    inspect afterwards. A missing or unreadable file is a broken drill, which is a
    refusal, not a "not verified" verdict.
    """
    written = backup_dir / RESTORE_VERIFICATION_NAME
    _require(
        written.is_file(),
        f'{RESTORE_VERIFICATION_NAME} was not written (restore exit code {exit_code})',
    )
    try:
        payload = json.loads(written.read_text(encoding='utf-8'))
    except ValueError as error:
        message = f'{RESTORE_VERIFICATION_NAME} is not valid JSON'
        raise DrillError(message) from error
    _require(isinstance(payload, dict), f'{RESTORE_VERIFICATION_NAME} is not an object')
    _require('restore_verified' in payload,
             f'{RESTORE_VERIFICATION_NAME} carries no restore_verified field')
    return payload


def _write_record(record_path: Path, payload: Mapping[str, object]) -> None:
    """Write the record atomically: a sibling temporary file, then ``os.replace``."""
    record_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = record_path.with_name(f'.{record_path.name}.tmp')
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    os.replace(temporary, record_path)


def run_drill(
    store: s3_client.S3Store | s3_client.FilesystemStore,
    tenant: str,
    *,
    scratch_root: Path,
    target_db: str,
    passphrase_file: Path,
    runner: Callable[..., object] = subprocess.run,
    now: datetime | None = None,
    policy: backup_pipeline.RetentionPolicy | None = None,
    tools: RestoreTools | None = None,
    record_path: Path | None = None,
    pg_host: str | None = None,
    pg_port: str | None = None,
    pg_user: str | None = None,
    restore_script: Path | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, object]:
    """Restore the newest artifact into a scratch database and record what happened.

    The digests are checked before a database is created, the database name is
    checked before anything is fetched, and the record is replaced atomically at the
    end. ``elapsed_seconds`` is measured with a monotonic clock around the whole
    drill, so a slow fetch or a slow restore is charged to the RTO it consumes.
    """
    database = require_scratch_database(target_db)
    _require(scratch_root.is_absolute(), 'the scratch root must be an absolute path')
    _require(not _target_filestore(scratch_root, database).exists(),
             'the target filestore already exists; a restore needs a fresh one')
    started_at = backup_pipeline.as_utc(now)
    active = policy or backup_pipeline.RetentionPolicy()
    binaries = tools or RestoreTools.from_environment()
    script = restore_script or Path(__file__).with_name(RESTORE_SCRIPT_NAME)
    destination = record_path or scratch_root / RECORD_NAME
    scratch_root.mkdir(parents=True, exist_ok=True)

    began = clock()
    stage = scratch_root / STAGE_DIR_NAME
    ref, manifest, manifest_bytes = _fetch_verified_artifact(
        store, tenant, stage, passphrase_file, runner,
    )
    backup_dir = scratch_root / BACKUP_DIR_NAME
    _extract_archive(stage / PLAINTEXT_NAME, backup_dir)
    _write_capture_manifest(backup_dir, manifest_bytes)
    argv = _restore_argv(
        restore_script=script,
        backup_dir=backup_dir,
        target_db=database,
        target_filestore=_target_filestore(scratch_root, database),
        tools=binaries,
        pg_host=pg_host,
        pg_port=pg_port,
        pg_user=pg_user,
    )
    completed = runner(argv, shell=False, check=False, capture_output=True, text=True)
    exit_code = _exit_code(completed)
    result = _read_restore_result(backup_dir, exit_code)
    elapsed_seconds = clock() - began
    finished_at = started_at + timedelta(seconds=elapsed_seconds)
    artifact_age_seconds = (finished_at - manifest.captured_at).total_seconds()
    passed = result['restore_verified'] is True and exit_code == 0
    record = {
        'schema_version': RECORD_SCHEMA_VERSION,
        'started_at': started_at.isoformat(),
        'finished_at': finished_at.isoformat(),
        'elapsed_seconds': elapsed_seconds,
        'tenant': tenant,
        'target_db': database,
        'artifact_key': ref.artifact_key,
        'artifact_captured_at': manifest.captured_at.isoformat(),
        'source_manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(),
        'restore_verified': passed,
        'rpo_ok': 0 <= artifact_age_seconds <= active.rpo_seconds,
        'rto_ok': elapsed_seconds <= active.rto_seconds,
        'checks': result.get('checks', {}),
        'not_covered': list(NOT_COVERED),
    }
    _write_record(destination, record)
    return record


def _target_filestore(scratch_root: Path, target_db: str) -> Path:
    """The filestore path restore_verify.py insists on, inside the scratch root."""
    return scratch_root / 'filestore' / target_db


def drill_record_path(scratch_root: Path) -> Path:
    """Where a drill under this scratch root writes its record."""
    return scratch_root / RECORD_NAME


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='restore_drill.py',
        description=(
            'Restore the newest artifact into a scratch database, measure it against '
            'RPO 1 h / RTO 4 h, and write an atomic drill record.'
        ),
    )
    commands = parser.add_subparsers(dest='command', required=True)

    run = commands.add_parser('run', help='fetch, verify, restore and record')
    run.add_argument('--tenant', required=True)
    run.add_argument('--scratch-root', required=True, type=Path)
    run.add_argument('--target-db', required=True)
    run.add_argument('--store-root', type=Path, help='a filesystem store instead of a bucket')
    run.add_argument('--pg-host')
    run.add_argument('--pg-port')
    run.add_argument('--pg-user')
    run.add_argument('--now', help='override the drill start time, ISO 8601 (tests only)')

    report = commands.add_parser('status', help='report the last drill record')
    report.add_argument('--record', required=True, type=Path)
    report.add_argument('--now', help='override the current time, ISO 8601 (tests only)')
    return parser


def _parse_now(raw: str | None) -> datetime | None:
    if raw is None:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError as error:
        message = f'--now must be ISO 8601: {raw!r}'
        raise DrillError(message) from error


def _write_json(payload: Mapping[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + '\n')


def _run_command(
    args: argparse.Namespace,
    runner: Callable[..., object],
    tools: RestoreTools | None,
) -> int:
    record = run_drill(
        backup_pipeline.build_store(args.store_root, os.environ),
        args.tenant,
        scratch_root=args.scratch_root,
        target_db=args.target_db,
        passphrase_file=backup_pipeline.passphrase_from_environment(os.environ),
        now=_parse_now(args.now),
        pg_host=args.pg_host,
        pg_port=args.pg_port,
        pg_user=args.pg_user,
        runner=runner,
        tools=tools,
    )
    _write_json(record)
    return EXIT_OK if record['restore_verified'] else EXIT_NOT_VERIFIED


def _status_command(
    args: argparse.Namespace,
    _runner: Callable[..., object],
    _tools: RestoreTools | None,
) -> int:
    report = backup_pipeline.status(args.record, _parse_now(args.now))
    _write_json(report)
    return EXIT_OK if report['restore_verified'] else EXIT_NOT_VERIFIED


def main(
    argv: Sequence[str] | None = None,
    runner: Callable[..., object] = subprocess.run,
    tools: RestoreTools | None = None,
) -> int:
    """Run one subcommand.

    ``runner`` and ``tools`` are the two seams the offline tests replace: the
    binaries the restore needs are resolved from ``PATH`` only when none is given.
    """
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    handlers = {'run': _run_command, 'status': _status_command}
    try:
        return handlers[args.command](args, runner, tools)
    except (DrillError, backup_pipeline.PipelineError, s3_client.StorageError) as error:
        sys.stderr.write(f'restore_drill: {error}\n')
        return EXIT_REFUSED


if __name__ == '__main__':
    raise SystemExit(main())
