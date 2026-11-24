# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one command line of the backup package.

``capture``, ``prune``, ``purge``, ``age``, ``status``, ``fetch``, ``verify`` and ``drill``.
Exit codes follow the evidence: 0 the command did what it says, 2 refused (nothing was
written or deleted), 3 not verified (the run finished but did not prove what it reports).
A refusal is one line on stderr with the ``backup_pipeline:`` prefix the release and the
alerts already match on, never a traceback.

The command is `python3 -B -m deploy.backup <command>`; ``runner`` is the process seam the
offline tests replace with a fake that never starts a database.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from deploy import s3_client
from deploy.backup.artifact import passphrase_from_environment
from deploy.backup.capture import (
    CONTROL_PLANE_SOURCE,
    DEFAULT_PURGE_SETTLE_SECONDS,
    capture as capture_artifact,
    newest_age,
    prune,
    purge_tenant,
    status as drill_status,
)
from deploy.backup.drill import run_drill
from deploy.backup.dump import validate_db_name
from deploy.backup.errors import BackupError, PurgeIncompleteError, TenantRetiredError, require
from deploy.backup.manifest import CAPTURE_KINDS, require_tenant
from deploy.backup.recover import fetch_artifact, latest_artifact, newest_of_kind
from deploy.backup.snapshot import CaptureSource, validate_filestore
from deploy.backup.store import build_store
from deploy.backup.verify import PostgresConnection, RestoreTools, restore_verified

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from deploy.backup.store import ObjectStore

EXIT_OK = 0
EXIT_REFUSED = 2
EXIT_NOT_VERIFIED = 3
REGISTRY_ENVIRONMENT_VARIABLE = 'LIWAN_TENANT_REGISTRY_PATH'


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='python3 -B -m deploy.backup',
        description=(
            'Encrypted backup pipeline: capture into an S3-compatible bucket, enforce the '
            'retention policy, fetch one artifact back, restore it into scratch and report '
            'the recovery status. RPO 1 h, RTO 4 h, hourly kept 7 days, daily kept 30 days.'
        ),
    )
    commands = parser.add_subparsers(dest='command', required=True)

    take = commands.add_parser('capture', help='capture, encrypt and upload one artifact')
    _add_source_arguments(take)
    take.add_argument('--kind', required=True, choices=CAPTURE_KINDS)
    take.add_argument('--work-root', required=True, type=Path)
    take.add_argument('--data-dir', type=Path, help='trusted Odoo data directory containing filestore/ (tenant)')
    take.add_argument('--db-name', help='the database to dump: --control-plane, or a candidate copy')
    take.add_argument('--filestore', type=Path,
                      help='an explicit <data_dir>/filestore/<db_name> for a candidate copy')
    take.add_argument('--pg-dump', required=True, type=Path)
    take.add_argument('--pg-host')
    take.add_argument('--pg-port')
    take.add_argument('--pg-user')
    take.add_argument('--now', help='override the capture time, ISO 8601 (tests only)')

    retention = commands.add_parser('prune', help='delete artifacts beyond the retention windows')
    _add_source_arguments(retention)
    retention.add_argument('--now', help='override the current time, ISO 8601 (tests only)')

    purge = commands.add_parser(
        'purge',
        help='delete every backup of a retired tenant (not the retention prune: nothing is kept)',
    )
    purge.add_argument('--tenant', required=True, help='the registry tenant id; the control plane source is refused')
    purge.add_argument('--settle-seconds', type=float, default=DEFAULT_PURGE_SETTLE_SECONDS,
                       help='the wait between the two passes, for a capture still uploading')

    freshness = commands.add_parser('age', help='report the age of the newest artifact against the RPO')
    _add_source_arguments(freshness)
    freshness.add_argument('--now', help='override the current time, ISO 8601 (tests only)')

    report = commands.add_parser('status', help='report RPO, RTO and the verified restore')
    report.add_argument('--record', required=True, type=Path,
                        help='the drill record (restore-drill.json) to read')
    report.add_argument('--now', help='override the current time, ISO 8601 (tests only)')

    fetch = commands.add_parser('fetch', help='fetch, authenticate and extract one artifact')
    _add_source_arguments(fetch)
    fetch.add_argument('--destination', required=True, type=Path, help='a new absolute directory for the artifact')
    fetch.add_argument('--kind', choices=CAPTURE_KINDS,
                       help='fetch the newest artifact of this kind; default: the newest retention artifact')

    restore = commands.add_parser('verify', help='restore one extracted artifact into a scratch database')
    restore.add_argument('--backup-dir', required=True, type=Path,
                         help='the artifact directory: database.dump, filestore/ and manifest.json')
    restore.add_argument('--target-db', required=True)
    restore.add_argument('--target-filestore', required=True, type=Path)
    restore.add_argument('--pg-restore', required=True)
    restore.add_argument('--psql', required=True)
    restore.add_argument('--pg-user', required=True)
    restore.add_argument('--pg-host')
    restore.add_argument('--pg-port')

    restore_drill = commands.add_parser('drill', help='fetch the newest artifact and drill a restore of it')
    restore_drill.add_argument('--tenant', required=True)
    restore_drill.add_argument('--scratch-root', required=True, type=Path)
    restore_drill.add_argument('--target-db', required=True)
    restore_drill.add_argument('--pg-user', required=True)
    restore_drill.add_argument('--pg-host')
    restore_drill.add_argument('--pg-port')
    restore_drill.add_argument('--record', type=Path,
                               help='where to write the record; default: <scratch-root>/restore-drill.json')
    restore_drill.add_argument('--now', help='override the drill start time, ISO 8601 (tests only)')
    restore_drill.add_argument('--store-root', type=Path, help='a filesystem store instead of a bucket')

    for subparser in (take, retention, purge, freshness, fetch):
        subparser.add_argument('--store-root', type=Path, help='a filesystem store instead of a bucket')
    return parser


def main(
    argv: Sequence[str] | None = None,
    runner=subprocess.run,
    tools: RestoreTools | None = None,
) -> int:
    """Run one subcommand; ``runner`` and ``tools`` are the seams the offline tests replace."""
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    handlers = {
        'capture': _run_capture,
        'prune': _run_prune,
        'purge': _run_purge,
        'age': _run_age,
        'status': _run_status,
        'fetch': _run_fetch,
        'verify': _run_verify,
        'drill': _run_drill,
    }
    try:
        return handlers[args.command](args, runner, tools)
    except PurgeIncompleteError as error:
        _write_json({**error.report.as_dict(), 'status': 'incomplete'})
        return EXIT_NOT_VERIFIED
    except (BackupError, s3_client.StorageError) as error:
        # s3_client's message carries no credential; this line never adds one.
        sys.stderr.write(f'backup_pipeline: {error}\n')
        return EXIT_REFUSED


def _add_source_arguments(parser: argparse.ArgumentParser) -> None:
    """Exactly one source: a tenant, or the control plane's own database."""
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--tenant')
    group.add_argument('--control-plane', action='store_true',
                       help=f'the control plane database, stored under {CONTROL_PLANE_SOURCE}/')


def _source_name(args: argparse.Namespace) -> str:
    return CONTROL_PLANE_SOURCE if args.control_plane else require_tenant(args.tenant)


def _capture_source(args: argparse.Namespace) -> CaptureSource:
    """The source the flags name: the control plane, an explicit candidate pair, or the registry."""
    if args.control_plane:
        require(args.data_dir is None, '--data-dir belongs to a tenant capture, not --control-plane')
        require(args.filestore is None, '--filestore belongs to a candidate copy, not --control-plane')
        require(args.db_name is not None, '--control-plane needs --db-name')
        return CaptureSource(args.db_name, None, args.pg_dump, args.pg_host, args.pg_port, args.pg_user)
    require_tenant(args.tenant)
    if args.filestore is not None:
        require(args.db_name is not None, '--filestore needs --db-name: the two name one copy')
        require(args.data_dir is None, '--data-dir and --filestore name two different sources')
        filestore = validate_filestore(args.filestore, args.db_name)
        return CaptureSource(args.db_name, filestore, args.pg_dump, args.pg_host, args.pg_port, args.pg_user)
    require(args.data_dir is not None, 'a tenant capture needs --data-dir')
    require(args.db_name is None, 'a tenant capture takes its database from the registry, not --db-name')
    return _registry_source(args)


def _registry_source(args: argparse.Namespace) -> CaptureSource:
    """The database and filestore the published tenant registry binds, or a refusal."""
    tenant = require_tenant(args.tenant)
    data_dir = args.data_dir
    require(data_dir.is_absolute() and data_dir.is_dir(),
            '--data-dir must be the absolute path to the existing Odoo data directory')
    binding = registry_binding(tenant)
    # A suspended tenant is still backed up (the binding ignores `enabled`); a retired one is not.
    if binding['retired']:
        raise TenantRetiredError(tenant)
    filestore = data_dir.resolve() / 'filestore' / str(binding['filestore'])
    require(filestore.is_dir() and filestore.resolve() == filestore,
            'the registered filestore must be an existing directory under the Odoo data directory without links')
    return CaptureSource(
        str(binding['database']), filestore, args.pg_dump, args.pg_host, args.pg_port, args.pg_user,
    )


def registry_binding(tenant: str) -> dict[str, object]:
    """The published binding of one tenant: database, filestore and whether it is retired."""
    registry = Path(os.environ.get(REGISTRY_ENVIRONMENT_VARIABLE, ''))
    require(registry.is_absolute(), f'{REGISTRY_ENVIRONMENT_VARIABLE} must be an absolute tenant registry path')
    resolver = Path(__file__).resolve().parents[1] / 'shared' / 'backup-binding.mjs'
    try:
        result = subprocess.run(
            ['node', str(resolver), str(registry), tenant],
            check=False, capture_output=True, text=True, timeout=10,
        )
        require(result.returncode == 0, 'tenant registry is unavailable or the tenant has no published binding')
        binding = json.loads(result.stdout)
        database = _registry_db_name(binding['database'])
        store_name = _registry_db_name(binding['filestore'])
        retired = binding.get('retired', False)
        require(isinstance(retired, bool), 'the tenant registry binding is malformed')
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, BackupError) as error:
        raise BackupError('could not read a valid tenant registry binding') from error
    require(database == store_name, 'tenant registry database and filestore do not match')
    return {'database': database, 'filestore': store_name, 'retired': retired}


def _registry_db_name(value: object) -> str:
    require(isinstance(value, str), 'the tenant registry binding is malformed')
    return validate_db_name(value)


def _tenant_is_retired(args: argparse.Namespace) -> bool:
    """Whether the registry marks the tenant retired.

    Any doubt answers no, so a missing registry never hides a stale backup.
    """
    if args.control_plane or not os.environ.get(REGISTRY_ENVIRONMENT_VARIABLE):
        return False
    try:
        return bool(registry_binding(args.tenant)['retired'])
    except BackupError:
        return False


def _parse_now(raw: str | None) -> datetime | None:
    """The optional clock override; a bad value is a refusal, not a silent default."""
    if raw is None:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError as error:
        raise BackupError(f'--now must be ISO 8601: {raw!r}') from error


def _write_json(payload: Mapping[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + '\n')


def _store(args: argparse.Namespace) -> ObjectStore:
    return build_store(args.store_root, os.environ)


def _run_capture(args: argparse.Namespace, runner, _tools) -> int:
    passphrase_file = passphrase_from_environment(os.environ)
    try:
        source = _capture_source(args)
    except TenantRetiredError:
        _write_json({'status': 'skipped', 'reason': 'retired', 'source': _source_name(args)})
        return EXIT_OK
    manifest = capture_artifact(
        store=_store(args),
        tenant=_source_name(args),
        source=source,
        kind=args.kind,
        work_root=args.work_root,
        passphrase_file=passphrase_file,
        now=_parse_now(args.now),
        runner=runner,
    )
    _write_json({**manifest.payload(), 'status': 'captured'})
    return EXIT_OK


def _run_prune(args: argparse.Namespace, _runner, _tools) -> int:
    report = prune(_store(args), _source_name(args), now=_parse_now(args.now))
    _write_json(report.as_dict())
    return EXIT_OK


def _run_purge(args: argparse.Namespace, _runner, _tools) -> int:
    report = purge_tenant(_store(args), args.tenant, args.settle_seconds)
    _write_json({**report.as_dict(), 'status': 'purged'})
    return EXIT_OK


def _run_age(args: argparse.Namespace, _runner, _tools) -> int:
    if _tenant_is_retired(args):
        # Its artifacts are purged with the workspace; "no backup" is the expected state, not a stale one.
        _write_json({'source': _source_name(args), 'status': 'skipped', 'reason': 'retired', 'stale': False})
        return EXIT_OK
    report = newest_age(_store(args), _source_name(args), _parse_now(args.now))
    _write_json(report)
    return EXIT_NOT_VERIFIED if report['stale'] else EXIT_OK


def _run_status(args: argparse.Namespace, _runner, _tools) -> int:
    report = drill_status(record=args.record, now=_parse_now(args.now))
    _write_json(report)
    return EXIT_OK if report['restore_verified'] else EXIT_NOT_VERIFIED


def _run_fetch(args: argparse.Namespace, runner, _tools) -> int:
    store = _store(args)
    source = _source_name(args)
    ref = (
        newest_of_kind(store, source, args.kind) if args.kind
        else latest_artifact(store, source)
    )
    require(ref is not None, f'source {source!r} has no complete artifact to fetch')
    fetched = fetch_artifact(
        store, ref, args.destination,
        passphrase_file=passphrase_from_environment(os.environ), runner=runner,
    )
    _write_json({
        **fetched.manifest.payload(),
        'status': 'fetched',
        'fetched_to': str(fetched.artifact_dir),
        'source_manifest_sha256': fetched.manifest_sha256,
    })
    return EXIT_OK


def _run_verify(args: argparse.Namespace, runner, _tools) -> int:
    result = restore_verified(
        artifact=args.backup_dir,
        target_db=args.target_db,
        target_filestore=args.target_filestore,
        tools=RestoreTools(
            pg_restore=Path(args.pg_restore), psql=Path(args.psql), runner=runner,
        ),
        pg=PostgresConnection(user=args.pg_user, host=args.pg_host, port=args.pg_port),
    )
    _write_json({**result['checks'], 'restore_verified': result['restore_verified']})
    return EXIT_OK if result['restore_verified'] else EXIT_NOT_VERIFIED


def _run_drill(args: argparse.Namespace, runner, tools) -> int:
    record = run_drill(
        _store(args),
        args.tenant,
        scratch_root=args.scratch_root,
        target_db=args.target_db,
        passphrase_file=passphrase_from_environment(os.environ),
        runner=runner,
        now=_parse_now(args.now),
        tools=tools or RestoreTools.from_environment(runner=runner),
        record_path=args.record,
        pg=PostgresConnection(user=args.pg_user, host=args.pg_host, port=args.pg_port),
    )
    _write_json(record)
    return EXIT_OK if record['restore_verified'] else EXIT_NOT_VERIFIED


if __name__ == '__main__':
    raise SystemExit(main())
