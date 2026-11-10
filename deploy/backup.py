# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Manual, opt-in candidate copy of a PostgreSQL dump plus filestore.

This is not a scheduler, restorer, process manager, or recovery tool. It does
not stop services or inspect database sessions. A closed HTTP port is not
quiescence. Every successful run writes consistency='UNVERIFIED' and
recovery_ready=false. The result is not recovery-ready.

The manifest pins the bytes it copied: the SHA-256 of ``database.dump`` and a
tree digest plus file count of the filestore copy, so ``restore_verify.py`` can
tell a dump or an attachment that changed after the copy. The filestore must
hold only regular files and directories; a symlink or special file is refused.
One database has one backup at a time: a second run is refused while the first
holds the lock.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, NoReturn

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Mapping, Sequence

OPT_IN_TOKEN = 'MANUAL_BACKUP_OPT_IN'
UNVERIFIED_TOKEN = 'CANDIDATE_BACKUP_UNVERIFIED'
CONSISTENCY_UNVERIFIED = 'UNVERIFIED'
DUMP_NAME = 'database.dump'
FILESTORE_NAME = 'filestore'
HASH_BLOCK_BYTES = 1024 * 1024
SHA256_RE = re.compile(r'[a-f0-9]{64}')
LOCK_DIR_NAME = 'liwan-backup-locks'
LOCK_FILE_MODE = 0o644
FORBIDDEN_DB_EXACT = frozenset({
    'odoo19',
    'production',
    'prod',
    'postgres',
    'template0',
    'template1',
})
FORBIDDEN_DB_RE = re.compile(
    r'(?:^|_)(odoo19|production|postgres|template0|template1)(?:_|$)',
    re.IGNORECASE,
)
DB_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
UNRESOLVED = (
    'retention policy is not defined',
    'backup encryption is not implemented',
    'offsite replication is not implemented',
    'RPO is not defined',
    'RTO is not defined',
    'authoritative Odoo process and DB-session quiescence is not implemented',
    'this tool does not prove production backup assurance',
    'this candidate copy is not recovery-ready',
)


class BackupError(Exception):
    """Validation failure before any copy."""


class BackupDeclined(Exception):
    """Operator asked for a consistency claim this tool cannot make."""


def fail(message: str) -> NoReturn:
    raise BackupError(message)


def decline(message: str) -> NoReturn:
    raise BackupDeclined(message)


def validate_db_name(name: str) -> str:
    if not name or name != name.strip():
        fail('database name is required')
    if name.lower() in FORBIDDEN_DB_EXACT or FORBIDDEN_DB_RE.search(name):
        fail('refusing odoo19/production/postgres database names')
    if not DB_NAME_RE.fullmatch(name):
        fail('database name must match [A-Za-z][A-Za-z0-9_]*')
    return name


def validate_opt_in(value: str) -> str:
    if value != OPT_IN_TOKEN:
        fail('backup requires --opt-in MANUAL_BACKUP_OPT_IN; true/yes/1 is not evidence')
    return value


def validate_unverified_ack(value: str) -> str:
    if value != UNVERIFIED_TOKEN:
        fail(
            'backup requires --acknowledge-unverified CANDIDATE_BACKUP_UNVERIFIED; '
            'this command cannot certify consistency',
        )
    return value


def validate_existing_dir(path_str: str, *, what: str) -> Path:
    if not path_str or path_str != path_str.strip():
        fail(f'{what} is required')
    path = Path(path_str)
    if not path.is_absolute():
        fail(f'{what} must be an absolute path')
    resolved = path.resolve()
    if not resolved.is_dir():
        fail(f'{what} is not an existing directory')
    return resolved


def validate_existing_file(path_str: str, *, what: str) -> Path:
    if not path_str or path_str != path_str.strip():
        fail(f'{what} is required')
    path = Path(path_str)
    if not path.is_absolute():
        fail(f'{what} must be an absolute path')
    resolved = path.resolve()
    if not resolved.is_file():
        fail(f'{what} is not an existing file')
    return resolved


def validate_filestore(path_str: str, db_name: str) -> Path:
    if Path(path_str).is_symlink():
        fail('filestore path must not be a symlink')
    filestore = validate_existing_dir(path_str, what='filestore')
    if filestore.name != db_name:
        fail('filestore directory basename must match the database name')
    if filestore.parent.name != 'filestore':
        fail('filestore path must be <data_dir>/filestore/<db_name>')
    filestore_files(filestore)
    return filestore


def _unreadable_directory(error: OSError) -> NoReturn:
    fail(f'filestore directory cannot be read: {error.filename}: {error.strerror}')


def filestore_files(root: Path) -> list[str]:
    """Relative POSIX paths of every regular file under ``root``, sorted.

    A symlink (even a dangling one or one to a directory) and a special file (fifo, socket,
    device) are refused: a restore cannot reproduce them, and a link can point outside the
    copy, so the digest of such a tree would not describe what a restore reads.
    """
    files: list[str] = []
    for directory, subdirectories, names in os.walk(root, onerror=_unreadable_directory):
        for name in (*subdirectories, *names):
            path = Path(directory, name)
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                fail(f'filestore holds a symlink, which a restore cannot reproduce: {relative}')
            if not (path.is_dir() or path.is_file()):
                fail(f'filestore holds a special file, which a restore cannot reproduce: {relative}')
        files.extend(Path(directory, name).relative_to(root).as_posix() for name in names)
    return sorted(files)


def sha256_file(path: Path) -> str:
    """The SHA-256 of a file's bytes, streamed so a large dump is never held in memory."""
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(HASH_BLOCK_BYTES):
            digest.update(block)
    return digest.hexdigest()


def filestore_digest(root: Path) -> tuple[str, int]:
    """The tree digest and file count of a filestore: one fact, computed one way.

    The digest is the SHA-256 of one line per regular file, ``<file sha256>  <relative path>``,
    in sorted path order (the ``sha256sum`` line format). It changes when a file's
    bytes, name or place change, or a file is added or removed; empty directories and file
    metadata are not part of it. A symlink or special file raises :class:`BackupError`.
    """
    files = filestore_files(root)
    tree = hashlib.sha256()
    for relative in files:
        tree.update(f'{sha256_file(root / relative)}  '.encode('ascii') + os.fsencode(relative) + b'\n')
    return tree.hexdigest(), len(files)


def parse_host_port(raw: str, *, flag: str) -> tuple[str, int]:
    if not raw or ':' not in raw:
        fail(f'{flag} must be HOST:PORT')
    host, _, port_s = raw.rpartition(':')
    if not host or not port_s.isdigit():
        fail(f'{flag} must be HOST:PORT')
    port = int(port_s)
    if port < 1 or port > 65535:
        fail(f'{flag} port out of range')
    return host, port


def observe_http_port(
    host: str,
    port: int,
    *,
    connector: Callable[[str, int], int] | None = None,
) -> dict[str, str]:
    """Record TCP reachability. Non-zero connect_ex is not a stopped-writer proof."""
    connect = connector or _connect_ex
    result = connect(host, port)
    if result == 0:
        decline(
            f'HTTP listener reachable on {host}:{port}; '
            'refusing even a candidate copy while that port accepts connections. '
            'A closed port would still not certify quiescence.',
        )
    return {
        'listen': f'{host}:{port} connect_ex={result}',
        'interpretation': (
            'connect_ex!=0 is not proof that Odoo, cron, remote writers, '
            'or database sessions are stopped'
        ),
        'certifies_consistency': 'false',
    }


def _connect_ex(host: str, port: int) -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    try:
        return int(sock.connect_ex((host, port)))
    finally:
        sock.close()


def build_pg_dump_argv(
    *,
    pg_dump: str,
    db_name: str,
    output_file: str,
    pg_host: str | None = None,
    pg_port: str | None = None,
    pg_user: str | None = None,
) -> list[str]:
    dump_bin = validate_existing_file(pg_dump, what='pg_dump')
    db = validate_db_name(db_name)
    out = Path(output_file)
    if not out.is_absolute():
        fail('pg_dump output path must be absolute')
    argv = [str(dump_bin), '-Fc', '--serializable-deferrable', '--no-password', '-d', db, '-f', str(out)]
    if pg_host:
        argv.extend(['-h', pg_host])
    if pg_port:
        if not pg_port.isdigit():
            fail('pg port must be numeric')
        argv.extend(['-p', pg_port])
    if pg_user:
        if not re.fullmatch(r'[A-Za-z0-9_]+', pg_user):
            fail('pg user contains unsupported characters')
        argv.extend(['-U', pg_user])
    if any(token in {'--password', '-W'} for token in argv):
        fail('pg_dump argv must not include a password flag')
    return argv


def write_manifest(path: Path, payload: Mapping[str, object]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def candidate_manifest_payload(
    *,
    db: str,
    store: Path,
    backup_dir: Path,
    http_observation: dict[str, str] | None,
) -> dict[str, object]:
    """The manifest of the copy in ``backup_dir``: what it holds and the digests of its bytes."""
    filestore_sha256, filestore_file_count = filestore_digest(backup_dir / FILESTORE_NAME)
    payload: dict[str, object] = {
        'created_at': datetime.now(timezone.utc).isoformat(),
        'db_name': db,
        'filestore_source': str(store),
        'database_dump': DUMP_NAME,
        'database_dump_sha256': sha256_file(backup_dir / DUMP_NAME),
        'filestore_copy': FILESTORE_NAME,
        'filestore_sha256': filestore_sha256,
        'filestore_file_count': filestore_file_count,
        'opt_in': OPT_IN_TOKEN,
        'acknowledge_unverified': UNVERIFIED_TOKEN,
        'consistency': CONSISTENCY_UNVERIFIED,
        'recovery_ready': False,
        'atomic': False,
        'kind': 'non-atomic candidate copy',
        'http_port_observation': http_observation or {
            'listen': 'not observed',
            'interpretation': 'no HTTP observation was requested; still UNVERIFIED',
            'certifies_consistency': 'false',
        },
        'not_recovery_ready_reason': (
            'No authoritative check of the Odoo process, cron, remote writers, '
            'or PostgreSQL sessions. TCP connect_ex is not quiescence. '
            'Operator must independently verify maintenance window and restore-test. '
            'This artifact is not recovery-ready.'
        ),
        'unresolved': list(UNRESOLVED),
        'actions_not_performed': [
            'restore',
            'schedule',
            'delete',
            'stop',
            'start',
            'docker compose',
            'session drain',
            'consistent snapshot',
        ],
    }
    return payload


def lock_directory(lock_dir: str | None) -> Path:
    """The directory that holds the per-database lock files.

    An explicit ``--lock-dir`` must be an existing absolute directory. The default is a private
    directory under the system temporary directory; it is refused unless this user owns it, so
    another user cannot plant a lock directory (or a symlink to one) there.
    """
    if lock_dir:
        return validate_existing_dir(lock_dir, what='lock directory')
    directory = Path(tempfile.gettempdir()) / LOCK_DIR_NAME
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        fail(f'default lock directory {directory} is not a directory owned by this user; pass --lock-dir')
    return directory


def open_lock_file(path: Path) -> int:
    """Open (creating it if needed) the lock file read-only and return its descriptor.

    ``flock`` needs no write access, and the file holds no data, so it is created ``0644``
    (set explicitly, the umask must not narrow it) and a second user can lock the file the
    first one left behind. A symlink is refused, and so is anything but a regular file; the
    open never blocks, so a FIFO planted in a shared directory cannot hang the run.
    """
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    try:
        try:
            descriptor, created = os.open(path, flags | os.O_CREAT | os.O_EXCL, LOCK_FILE_MODE), True
        except FileExistsError:
            descriptor, created = os.open(path, flags), False
    except OSError as error:
        fail(f'cannot open the backup lock {path}: {error.strerror}')
    try:
        if created:
            os.fchmod(descriptor, LOCK_FILE_MODE)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            fail(f'the backup lock {path} is not a regular file')
    except OSError as error:
        os.close(descriptor)
        fail(f'cannot prepare the backup lock {path}: {error.strerror}')
    except BackupError:
        os.close(descriptor)
        raise
    return descriptor


@contextmanager
def database_lock(db: str, lock_dir: str | None) -> Iterator[None]:
    """Hold an exclusive, non-blocking ``flock`` on this database's lock file.

    The lock lives as long as the file descriptor, so it is released on every exit path: a
    normal return, an exception, or the process dying. A second run for the same database is
    refused at once; runs for other databases do not wait on it.
    """
    path = lock_directory(lock_dir) / f'{db}.lock'
    descriptor = open_lock_file(path)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail(f'another backup of database {db} is already running (lock {path}); refusing a concurrent run')
        except OSError as error:
            fail(f'cannot lock {path}: {error.strerror}')
        yield
    finally:
        os.close(descriptor)


def perform_backup(
    *,
    opt_in: str,
    acknowledge_unverified: str,
    db_name: str,
    filestore: str,
    output_dir: str,
    pg_dump: str,
    pg_host: str | None = None,
    pg_port: str | None = None,
    pg_user: str | None = None,
    observe_http_port_value: str | None = None,
    lock_dir: str | None = None,
    runner=subprocess.run,
    copier=shutil.copytree,
    connector: Callable[[str, int], int] | None = None,
) -> Path:
    validate_opt_in(opt_in)
    validate_unverified_ack(acknowledge_unverified)
    db = validate_db_name(db_name)
    store = validate_filestore(filestore, db)
    dump_bin = validate_existing_file(pg_dump, what='pg_dump')
    del dump_bin
    http_observation = None
    if observe_http_port_value:
        host, port = parse_host_port(observe_http_port_value, flag='--observe-http-port')
        http_observation = observe_http_port(host, port, connector=connector)

    with database_lock(db, lock_dir):
        return _write_candidate(
            db=db,
            store=store,
            output_dir=output_dir,
            pg_dump=pg_dump,
            pg_connection=(pg_host, pg_port, pg_user),
            http_observation=http_observation,
            runner=runner,
            copier=copier,
        )


def _write_candidate(
    *,
    db: str,
    store: Path,
    output_dir: str,
    pg_dump: str,
    pg_connection: tuple[str | None, str | None, str | None],
    http_observation: dict[str, str] | None,
    runner,
    copier,
) -> Path:
    destination = Path(output_dir)
    if not destination.is_absolute():
        fail('output directory must be an absolute path')
    if destination.exists():
        fail('output directory already exists; refuse overwrite or delete')
    if not destination.parent.is_dir():
        fail('output directory parent must already exist')
    destination.mkdir(parents=False)

    dump_path = destination / DUMP_NAME
    filestore_dest = destination / FILESTORE_NAME
    pg_host, pg_port, pg_user = pg_connection
    argv = build_pg_dump_argv(
        pg_dump=pg_dump,
        db_name=db,
        output_file=str(dump_path),
        pg_host=pg_host,
        pg_port=pg_port,
        pg_user=pg_user,
    )
    completed = runner(argv, cwd=str(destination), env=os.environ, shell=False, check=False)
    if completed.returncode != 0 or not dump_path.is_file() or dump_path.is_symlink():
        fail('pg_dump failed; no success manifest written')
    # The source tree held no symlink when it was validated, so none is carried: a link that
    # appeared since is followed and stored as a regular file, never copied as a link.
    copier(str(store), str(filestore_dest))
    if not filestore_dest.is_dir():
        fail('filestore copy failed; no success manifest written')

    payload = candidate_manifest_payload(
        db=db,
        store=store,
        backup_dir=destination,
        http_observation=http_observation,
    )
    if payload['consistency'] != CONSISTENCY_UNVERIFIED or payload['recovery_ready'] is not False:
        fail('internal error: refused to write a consistency claim')
    manifest_path = destination / 'manifest.json'
    write_manifest(manifest_path, payload)
    return manifest_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='backup.py',
        description=(
            'Manual non-atomic candidate DB+filestore copy. '
            'Writes consistency=UNVERIFIED. Not recovery-ready. '
            'No restore, schedule, delete, or service stop.'
        ),
    )
    parser.add_argument('--opt-in', required=True, help=f'must be {OPT_IN_TOKEN}')
    parser.add_argument(
        '--acknowledge-unverified',
        required=True,
        help=f'must be {UNVERIFIED_TOKEN}',
    )
    parser.add_argument(
        '--observe-http-port',
        help='optional HOST:PORT observation only; closed is not quiescence proof',
    )
    parser.add_argument('--db-name', required=True)
    parser.add_argument('--filestore', required=True, help='<data_dir>/filestore/<db_name>')
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--pg-dump', required=True, help='absolute pg_dump executable')
    parser.add_argument('--pg-host')
    parser.add_argument('--pg-port')
    parser.add_argument('--pg-user')
    parser.add_argument(
        '--lock-dir',
        help='absolute directory for the per-database lock file; '
        f'default: a private {LOCK_DIR_NAME} directory under the system temporary directory',
    )
    parser.add_argument('--verify-port', help=argparse.SUPPRESS)
    parser.add_argument('--pid-file', help=argparse.SUPPRESS)
    parser.add_argument('--quiesced', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--assume-stopped', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--live', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--consistent', action='store_true', help=argparse.SUPPRESS)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(list(argv) if argv is not None else None)
        if args.consistent:
            decline('refusing --consistent; this tool cannot certify a consistent backup')
        if args.quiesced or args.assume_stopped or args.live:
            decline(
                'boolean quiescence/live flags are not stop evidence and are not accepted',
            )
        if args.verify_port or args.pid_file:
            decline(
                'HTTP/pid checks cannot verify writers or DB sessions; '
                'refusing --verify-port/--pid-file. Optional --observe-http-port '
                'records reachability only and never upgrades consistency',
            )
        perform_backup(
            opt_in=args.opt_in,
            acknowledge_unverified=args.acknowledge_unverified,
            db_name=args.db_name,
            filestore=args.filestore,
            output_dir=args.output_dir,
            pg_dump=args.pg_dump,
            pg_host=args.pg_host,
            pg_port=args.pg_port,
            pg_user=args.pg_user,
            observe_http_port_value=args.observe_http_port,
            lock_dir=args.lock_dir,
        )
    except BackupDeclined as error:
        sys.stderr.write(f'DECLINED: {error}\n')
        return 3
    except BackupError as error:
        sys.stderr.write(f'{error}\n')
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
