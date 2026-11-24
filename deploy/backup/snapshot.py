# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The plaintext snapshot one capture copies, and the manifest frozen inside the artifact.

The snapshot is ``database.dump`` from ``pg_dump -Fc`` beside an exact copy of the
filestore, in a directory the capture owns. Its manifest pins the bytes the copy holds —
the dump digest, the filestore tree digest and the file count — so a restore can tell a
dump or an attachment that changed after the copy.

The filestore must hold only regular files and directories: a symlink or a special file
is refused, because a restore cannot reproduce it and a link can point outside the copy.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from deploy.backup.artifact import sha256_file
from deploy.backup.dump import build_pg_dump_argv, run_checked, validate_db_name
from deploy.backup.errors import BackupError, require
from deploy.backup.lock import database_lock
from deploy.backup.manifest import CONSISTENCY_UNVERIFIED
from deploy.backup.quiet import QUIESCE_NOT_REQUIRED

if TYPE_CHECKING:
    from collections.abc import Callable

DUMP_NAME = 'database.dump'
FILESTORE_NAME = 'filestore'
MANIFEST_NAME = 'manifest.json'
# The snapshot has no recovery claim of its own: the capture copies a running database.
RECOVERY_READY = False


@dataclass(frozen=True)
class CaptureSource:
    """The database and filestore one capture copies.

    ``filestore=None`` is the database-only source of the control plane, which has no
    filestore; no other source may be database-only.
    """

    db_name: str
    filestore: Path | None
    pg_dump: Path
    pg_host: str | None = None
    pg_port: str | None = None
    pg_user: str | None = None


def validate_filestore(path_str: str | Path, db_name: str) -> Path:
    """``<data_dir>/filestore/<db_name>`` as a real directory, or a refusal."""
    require(not Path(path_str).is_symlink(), 'filestore path must not be a symlink')
    require(bool(str(path_str)), 'filestore is required')
    path = Path(path_str)
    require(path.is_absolute(), 'filestore must be an absolute path')
    filestore = path.resolve()
    require(filestore.is_dir(), 'filestore is not an existing directory')
    require(filestore.name == db_name, 'filestore directory basename must match the database name')
    require(filestore.parent.name == 'filestore', 'filestore path must be <data_dir>/filestore/<db_name>')
    filestore_files(filestore)
    return filestore


def filestore_files(root: Path) -> list[str]:
    """Relative POSIX paths of every regular file under ``root``, sorted.

    A symlink (even a dangling one or one to a directory) and a special file (fifo,
    socket, device) are refused: a restore cannot reproduce them, and a link can point
    outside the copy, so the digest of such a tree would not describe what a restore reads.
    """
    files: list[str] = []
    for directory, subdirectories, names in os.walk(root, onerror=_unreadable_directory):
        for name in (*subdirectories, *names):
            path = Path(directory, name)
            relative = path.relative_to(root).as_posix()
            require(
                not path.is_symlink(),
                f'filestore holds a symlink, which a restore cannot reproduce: {relative}',
            )
            require(
                path.is_dir() or path.is_file(),
                f'filestore holds a special file, which a restore cannot reproduce: {relative}',
            )
        files.extend(Path(directory, name).relative_to(root).as_posix() for name in names)
    return sorted(files)


def filestore_digest(root: Path) -> tuple[str, int]:
    """The tree digest and file count of a filestore: one fact, computed one way.

    The digest is the SHA-256 of one line per regular file,
    ``<file sha256>  <relative path>``, in sorted path order (the ``sha256sum`` line
    format). It changes when a file's bytes, name or place change, or a file is added or
    removed; empty directories and file metadata are not part of it.
    """
    files = filestore_files(root)
    tree = hashlib.sha256()
    for relative in files:
        tree.update(f'{sha256_file(root / relative)}  '.encode('ascii') + os.fsencode(relative) + b'\n')
    return tree.hexdigest(), len(files)


def snapshot(
    source: CaptureSource,
    destination: Path,
    *,
    runner: Callable[..., object],
    quiesce: str | None = None,
) -> dict[str, object]:
    """Copy the source into the new ``destination`` and write the snapshot manifest.

    One backup per database at a time: the per-database lock is held around the dump, so
    a second run for the same database is refused instead of racing the first. A
    ``pg_dump`` that wrote no file, or wrote a symlink, is a failure and writes no
    manifest.
    """
    database = validate_db_name(source.db_name)
    require(destination.is_absolute(), 'the snapshot directory must be an absolute path')
    require(not destination.exists(), 'the snapshot directory already exists; refusing to overwrite')
    destination.mkdir(mode=0o700, parents=False)
    dump_path = destination / DUMP_NAME
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
    filestore_copy = destination / FILESTORE_NAME
    filestore_sha256: str | None = None
    filestore_file_count = 0
    if source.filestore is not None:
        # The source tree held no symlink when it was validated, so none is carried: a link
        # that appeared since is followed and stored as a regular file, never copied as a link.
        shutil.copytree(str(source.filestore), str(filestore_copy))
        require(filestore_copy.is_dir(), 'filestore copy failed; no success manifest written')
        filestore_sha256, filestore_file_count = filestore_digest(filestore_copy)
    payload = {
        'db_name': database,
        'database_dump': DUMP_NAME,
        'database_dump_sha256': sha256_file(dump_path),
        'filestore_copy': FILESTORE_NAME if source.filestore is not None else None,
        'filestore_sha256': filestore_sha256,
        'filestore_file_count': filestore_file_count,
        'consistency': CONSISTENCY_UNVERIFIED,
        'recovery_ready': RECOVERY_READY,
        'quiesce': quiesce or QUIESCE_NOT_REQUIRED,
    }
    write_manifest(destination / MANIFEST_NAME, payload)
    return payload


def write_manifest(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def _unreadable_directory(error: OSError) -> None:
    raise BackupError(f'filestore directory cannot be read: {error.filename}: {error.strerror}')
