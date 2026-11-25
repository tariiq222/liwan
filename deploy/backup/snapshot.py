# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The plaintext snapshot one capture copies, and the manifest frozen inside the artifact.

The snapshot is ``database.dump`` from ``pg_dump -Fc`` beside the bucket half: every object
of the tenant bucket under its own key, and ``objects.index`` pinning each one by SHA-256.
Its manifest pins the bytes the copy holds — the dump digest, the index digest, the object
count and the object bytes — so a restore can tell a dump or an object that changed after
the copy.

The bucket is read through an injected :class:`deploy.backup.bucket.BucketSource`, so the
rule about what a complete copy is never depends on a live endpoint. ``bucket=None`` is the
database-only source of the control plane: its contents half is the empty index, written
the same way, so one format describes both.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from deploy.backup.artifact import DATABASE_MEMBER, MANIFEST_NAME, sha256_file
from deploy.backup.bucket import BucketSource, copy_out, list_tree
from deploy.backup.dump import build_pg_dump_argv, run_checked, validate_db_name
from deploy.backup.errors import require
from deploy.backup.lock import database_lock
from deploy.backup.manifest import CONSISTENCY_UNVERIFIED

if TYPE_CHECKING:
    from collections.abc import Callable

# The snapshot has no recovery claim of its own: the capture copies a running database.
RECOVERY_READY = False


@dataclass(frozen=True)
class CaptureSource:
    """The database and bucket one capture copies.

    ``bucket=None`` is the database-only source of the control plane, which has no bucket;
    no other source may be database-only.
    """

    db_name: str
    bucket: BucketSource | None
    pg_dump: Path
    pg_host: str | None = None
    pg_port: str | None = None
    pg_user: str | None = None


def validate_filestore(path_str: str | Path, db_name: str) -> Path:
    """``<data_dir>/filestore/<db_name>`` as a real directory, or a refusal.

    The CLI's local bucket source names a directory the operator owns; it must be the
    tenant's own directory, with no link anywhere under it, before it is read as a bucket.
    """
    require(not Path(path_str).is_symlink(), 'filestore path must not be a symlink')
    require(bool(str(path_str)), 'filestore is required')
    path = Path(path_str)
    require(path.is_absolute(), 'filestore must be an absolute path')
    filestore = path.resolve()
    require(filestore.is_dir(), 'filestore is not an existing directory')
    require(filestore.name == db_name, 'filestore directory basename must match the database name')
    require(filestore.parent.name == 'filestore', 'filestore path must be <data_dir>/filestore/<db_name>')
    list_tree(filestore)
    return filestore


def snapshot(
    source: CaptureSource,
    destination: Path,
    *,
    runner: Callable[..., object],
) -> dict[str, object]:
    """Copy the source into the new ``destination`` and write the snapshot manifest.

    One backup per database at a time: the per-database lock is held around the dump, so
    a second run for the same database is refused instead of racing the first. A
    ``pg_dump`` that wrote no file, or wrote a symlink, is a failure and writes no
    manifest; the bucket half is read only after the dump exists, so a refused dump copies
    no objects.
    """
    database = validate_db_name(source.db_name)
    require(destination.is_absolute(), 'the snapshot directory must be an absolute path')
    require(not destination.exists(), 'the snapshot directory already exists; refusing to overwrite')
    destination.mkdir(mode=0o700, parents=False)
    dump_path = destination / DATABASE_MEMBER
    with database_lock(database):
        argv = build_pg_dump_argv(
            pg_dump=str(source.pg_dump),
            db_name=database,
            output_file=str(dump_path),
            pg_host=source.pg_host,
            pg_port=source.pg_port,
            pg_user=source.pg_user,
        )
        run_checked(runner, argv, 'pg_dump')
    require(dump_path.is_file() and not dump_path.is_symlink(),
            'pg_dump failed; no success manifest written')
    contents = copy_out(source.bucket, destination)
    payload = {
        'db_name': database,
        'database_sha256': sha256_file(dump_path),
        **contents.payload(),
        'consistency': CONSISTENCY_UNVERIFIED,
        'recovery_ready': RECOVERY_READY,
    }
    write_manifest(destination / MANIFEST_NAME, payload)
    return payload


def write_manifest(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')
