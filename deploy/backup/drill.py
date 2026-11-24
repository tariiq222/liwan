# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restore drill: fetch the newest artifact, restore it into scratch, record the truth.

One fact lives here: whether the newest backup this tenant has can actually be restored,
how long that took, and when that was proven. The drill is the only thing that writes a
``restore-drill.json``, and :func:`deploy.backup.status` reads that record and never
invents the answer.

Proven here, offline, against a filesystem store and injected process runners:

* an artifact whose ciphertext or plaintext SHA-256 disagrees with its manifest is refused
  before any database is created, so a substituted or truncated upload cannot reach a
  restore;
* the target database must be a new scratch name and may not resemble
  ``odoo19``/``prod``/``production``/``postgres``/``template0``/``template1`` — the guard is
  :func:`deploy.backup.verify.validate_target_db`, imported rather than copied;
* the record is written atomically (a temporary file in the same directory, then
  ``os.replace``), so a reader never sees half a record and a crash leaves the previous
  record intact;
* ``rpo_ok``/``rto_ok`` come from the artifact's capture time and the measured elapsed
  seconds, and the exit code follows the evidence: 0 verified, 3 not verified, 2 refused.

Not proven here: multi-node failover, a network failure mid-restore, concurrent production
load during the drill, a real bucket, and point-in-time recovery. The record lists all five
in ``not_covered``, because a drill that claimed them would be claiming something it never
did.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from deploy.backup.capture import RetentionPolicy, recovery_objectives
from deploy.backup.errors import require
from deploy.backup.manifest import as_utc
from deploy.backup.recover import fetch_artifact, latest_artifact
from deploy.backup.verify import (
    PostgresConnection,
    RestoreTools,
    restore_verified,
    validate_target_db,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

    from deploy.backup.store import ObjectStore

RECORD_SCHEMA_VERSION = 1
RECORD_NAME = 'restore-drill.json'
BACKUP_DIR_NAME = 'backup'

# What one drill on one host cannot prove. The record carries this list so a reader of the
# evidence sees the boundary, not only the pass.
NOT_COVERED = (
    'multi-node failover',
    'network failure during the restore',
    'concurrent production load during capture or restore',
    'a real S3 bucket (the drill reads whatever store it is given)',
    'point-in-time recovery (full dump only, no WAL archiving)',
)


def run_drill(
    store: ObjectStore,
    tenant: str,
    *,
    scratch_root: Path,
    target_db: str,
    passphrase_file: Path,
    runner: Callable[..., object] = subprocess.run,
    now: datetime | None = None,
    policy: RetentionPolicy | None = None,
    tools: RestoreTools | None = None,
    record_path: Path | None = None,
    pg: PostgresConnection,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, object]:
    """Restore the newest artifact into a scratch database and record what happened.

    The database name is checked before anything is fetched, the digests before a database
    is created, and the record is replaced atomically at the end. ``elapsed_seconds`` is
    measured with a monotonic clock around the whole drill, so a slow fetch or a slow
    restore is charged to the RTO it consumes.
    """
    database = validate_target_db(target_db)
    require(scratch_root.is_absolute(), 'the scratch root must be an absolute path')
    require(not _target_filestore(scratch_root, database).exists(),
            'the target filestore already exists; a restore needs a fresh one')
    started_at = as_utc(now)
    active = policy or RetentionPolicy()
    binaries = tools or RestoreTools.from_environment(runner=runner)
    destination = record_path or drill_record_path(scratch_root)
    ref = latest_artifact(store, tenant)
    require(ref is not None, f'tenant {tenant!r} has no artifact to drill')
    scratch_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    began = clock()
    with tempfile.TemporaryDirectory(prefix='restore-', dir=scratch_root) as private:
        fetched = fetch_artifact(
            store, ref, Path(private) / BACKUP_DIR_NAME,
            passphrase_file=passphrase_file, runner=runner,
        )
        result = restore_verified(
            artifact=fetched.artifact_dir,
            target_db=database,
            target_filestore=_target_filestore(scratch_root, database),
            tools=binaries,
            pg=pg,
        )
    elapsed_seconds = clock() - began
    finished_at = started_at + timedelta(seconds=elapsed_seconds)
    rpo_ok, rto_ok = recovery_objectives(
        fetched.manifest.captured_at, started_at, elapsed_seconds, active,
    )
    record = {
        'schema_version': RECORD_SCHEMA_VERSION,
        'started_at': started_at.isoformat(),
        'finished_at': finished_at.isoformat(),
        'elapsed_seconds': elapsed_seconds,
        'tenant': tenant,
        'target_db': database,
        'artifact_key': fetched.ref.artifact_key,
        'artifact_captured_at': fetched.manifest.captured_at.isoformat(),
        'source_manifest_sha256': fetched.manifest_sha256,
        'restore_verified': result['restore_verified'] is True and rpo_ok and rto_ok,
        'rpo_ok': rpo_ok,
        'rto_ok': rto_ok,
        'checks': result.get('checks', {}),
        'not_covered': list(NOT_COVERED),
    }
    _write_record(destination, record)
    return record


def drill_record_path(scratch_root: Path) -> Path:
    """Where a drill under this scratch root writes its record."""
    return scratch_root / RECORD_NAME


def _target_filestore(scratch_root: Path, target_db: str) -> Path:
    """The filestore path the restore insists on, inside the scratch root."""
    return scratch_root / 'filestore' / target_db


def _write_record(record_path: Path, payload: Mapping[str, object]) -> None:
    """Write the record atomically: a sibling temporary file, then ``os.replace``."""
    record_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = record_path.with_name(f'.{record_path.name}.tmp')
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    os.replace(temporary, record_path)
