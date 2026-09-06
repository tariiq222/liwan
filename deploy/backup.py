# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Manual, opt-in candidate copy of a PostgreSQL dump plus filestore.

This is not a scheduler, restorer, process manager, or recovery tool. It does
not stop services or inspect database sessions. A closed HTTP port is not
quiescence. Every successful run writes consistency='UNVERIFIED' and
recovery_ready=false. The result is not recovery-ready.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, NoReturn

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

OPT_IN_TOKEN = 'MANUAL_BACKUP_OPT_IN'
UNVERIFIED_TOKEN = 'CANDIDATE_BACKUP_UNVERIFIED'
CONSISTENCY_UNVERIFIED = 'UNVERIFIED'
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
    filestore = validate_existing_dir(path_str, what='filestore')
    if filestore.name != db_name:
        fail('filestore directory basename must match the database name')
    if filestore.parent.name != 'filestore':
        fail('filestore path must be <data_dir>/filestore/<db_name>')
    return filestore


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
    argv = [str(dump_bin), '-Fc', '--no-password', '-d', db, '-f', str(out)]
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
    dump_name: str,
    filestore_name: str,
    http_observation: dict[str, str] | None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        'created_at': datetime.now(timezone.utc).isoformat(),
        'db_name': db,
        'filestore_source': str(store),
        'database_dump': dump_name,
        'filestore_copy': filestore_name,
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

    destination = Path(output_dir)
    if not destination.is_absolute():
        fail('output directory must be an absolute path')
    if destination.exists():
        fail('output directory already exists; refuse overwrite or delete')
    if not destination.parent.is_dir():
        fail('output directory parent must already exist')
    destination.mkdir(parents=False)

    dump_path = destination / 'database.dump'
    filestore_dest = destination / 'filestore'
    argv = build_pg_dump_argv(
        pg_dump=pg_dump,
        db_name=db,
        output_file=str(dump_path),
        pg_host=pg_host,
        pg_port=pg_port,
        pg_user=pg_user,
    )
    completed = runner(argv, cwd=str(destination), env=os.environ, shell=False, check=False)
    if completed.returncode != 0 or not dump_path.is_file():
        fail('pg_dump failed; no success manifest written')
    copier(str(store), str(filestore_dest), symlinks=True)
    if not filestore_dest.is_dir():
        fail('filestore copy failed; no success manifest written')

    payload = candidate_manifest_payload(
        db=db,
        store=store,
        dump_name=dump_path.name,
        filestore_name=filestore_dest.name,
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
