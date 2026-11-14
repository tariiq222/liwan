# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restore the control plane database from its newest backup and prove the copy.

One fact lives here: whether the newest ``control-plane`` artifact of the backup
pipeline restores into a NEW database and carries the billing truth it should. The
artifact is authenticated and decrypted by :func:`deploy.backup_pipeline.fetch_verified_dump`,
restored with ``pg_restore`` into a database this run creates (an existing database is
refused, never overwritten), then read back:

* row counts of the key tables (customers, subscriptions, orders, invoices, payment
  attempts and events, credit and debit notes, the outbox, the audit log, the tenant
  registry bindings, vendor accounts);
* the ``invoice_number_seq`` position, which must be ahead of the highest issued
  invoice number, or the next invoice would reuse a number a customer already holds;
* the highest ``schema_migrations`` version (``--expect-migration`` refuses a copy older
  than the control plane build that will run on it);
* ``control_plane_state.restored_at`` is stamped with the restore time (``restore`` only), so a
  restored control plane commits no workspace deletion until the hold has passed again: the
  backup may predate a customer's withdrawal, and replaying that deletion would destroy a
  workspace the customer kept. A backup older than the table has no deletion to replay and
  is left unstamped (the record says so);
* with ``--compare-with``, equality of all of the above with a live database, for a
  drill taken while the source still exists.

The result is written atomically to ``control-plane-restore.json``. Exit codes follow
the other drills: 0 verified, 3 not verified, 2 refused. Nothing here starts the
control plane, re-points a worker, or contacts the payment provider: those steps, and
the reconciliation after a restore older than the loss, are in
``docs/operations/control-plane-backup-restore.md``. Credentials come from the libpq
environment (``PGPASSFILE``), never from an argument.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import TYPE_CHECKING

try:  # imported as deploy.<module> (PYTHONPATH=.)
    from deploy import backup, backup_pipeline, s3_client
except ImportError:  # executed with PYTHONPATH=deploy
    import backup
    import backup_pipeline
    import s3_client

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

RECORD_NAME = 'control-plane-restore.json'
EXIT_OK = 0
EXIT_REFUSED = 2
EXIT_NOT_VERIFIED = 3
# The tables whose rows are billing truth or the means to reach it. A missing one fails
# the verification, so a dump of the wrong database cannot pass.
KEY_TABLES = (
    'tenants', 'customers', 'subscriptions', 'orders', 'invoices', 'invoice_lines',
    'invoice_adjustments', 'payment_attempts', 'payment_events', 'commercial_outbox',
    'audit_events', 'shared_registry_bindings', 'vendor_accounts',
)
_COUNTS_SQL = ', '.join(f"'{table}', (SELECT count(*) FROM {table})" for table in KEY_TABLES)
VERIFY_SQL = f"""SELECT json_build_object(
  'tables', json_build_object({_COUNTS_SQL}),
  'invoice_sequence', (SELECT json_build_object('last_value', last_value, 'is_called', is_called) FROM invoice_number_seq),
  'latest_invoice_number', (SELECT max(number) FROM invoices),
  'highest_invoice_serial', (SELECT max(split_part(number, '-', 3)::bigint) FROM invoices),
  'migration', (SELECT max(version) FROM schema_migrations))"""


class RestoreError(Exception):
    """The restore was refused or failed; no record claims a verified copy."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RestoreError(message)


def _connection(args: argparse.Namespace) -> list[str]:
    argv: list[str] = []
    for flag, value in (('-h', args.pg_host), ('-p', args.pg_port), ('-U', args.pg_user)):
        if value:
            argv += [flag, str(value)]
    return argv


def _run(runner: Callable[..., object], argv: list[str], what: str) -> str:
    completed = runner(argv, shell=False, check=False, capture_output=True, text=True)
    if getattr(completed, 'returncode', None) != 0:
        lines = (getattr(completed, 'stderr', '') or '').strip().splitlines()
        raise RestoreError(f'{what} failed: {lines[-1] if lines else "no error output"}')
    return getattr(completed, 'stdout', '') or ''


def _target(name: str) -> str:
    try:
        return backup.validate_db_name(name)
    except backup.BackupError as error:
        raise RestoreError(str(error)) from error


def observe(args: argparse.Namespace, database: str, runner: Callable[..., object]) -> dict[str, object]:
    """Read the verification facts of one database."""
    output = _run(runner, [args.psql, '-X', '-At', '-v', 'ON_ERROR_STOP=1', *_connection(args),
                           '-d', _target(database), '-c', VERIFY_SQL], f'reading {database}')
    try:
        return json.loads(output)
    except ValueError as error:
        raise RestoreError(f'{database} answered with something that is not the verification JSON') from error


STAMP_PRESENT_SQL = "SELECT to_regclass('public.control_plane_state') IS NOT NULL"
STAMP_SQL = 'UPDATE control_plane_state SET restored_at = now() WHERE singleton = true'


def stamp_restored(args: argparse.Namespace, database: str, runner: Callable[..., object]) -> bool:
    """Record the restore time in the restored database; False when the backup predates the table."""
    connection = [args.psql, '-X', '-At', '-v', 'ON_ERROR_STOP=1', *_connection(args), '-d', _target(database)]
    if _run(runner, [*connection, '-c', STAMP_PRESENT_SQL], f'checking {database}').strip() != 't':
        return False
    _run(runner, [*connection, '-c', STAMP_SQL], f'stamping the restore time in {database}')
    return True


def checks_for(observed: Mapping[str, object], compare: Mapping[str, object] | None,
               expect_migration: int | None) -> dict[str, bool]:
    """Every verdict as a named boolean, so a failure says what failed."""
    sequence = observed['invoice_sequence']
    next_serial = int(sequence['last_value']) + (1 if sequence['is_called'] else 0)
    highest = observed['highest_invoice_serial']
    migration = observed['migration']
    checks = {
        'sequence_ahead_of_invoices': highest is None or next_serial > int(highest),
        'migrations_present': migration is not None,
        'migration_at_least_expected': expect_migration is None or (migration is not None and migration >= expect_migration),
    }
    if compare is not None:
        for field in ('tables', 'invoice_sequence', 'migration'):
            checks[f'{field}_equal_to_source'] = observed[field] == compare[field]
    return checks


def restore(args: argparse.Namespace, runner: Callable[..., object]) -> int:
    started_at = backup_pipeline.as_utc(None)
    began = time.monotonic()
    target = _target(args.target_db)
    scratch = args.scratch_root
    _require(scratch.is_absolute() and not scratch.exists(), '--scratch-root must be a new absolute directory')
    scratch.mkdir(mode=0o700, parents=True)
    store = backup_pipeline.build_store(args.store_root, os.environ)
    passphrase_file = backup_pipeline.passphrase_from_environment(os.environ)
    ref, manifest, dump = backup_pipeline.fetch_verified_dump(
        store, backup_pipeline.CONTROL_PLANE_SOURCE, scratch / 'fetched', passphrase_file, runner)
    connection = _connection(args)
    _run(runner, [args.psql, '-X', '-v', 'ON_ERROR_STOP=1', *connection, '-d', 'postgres',
                  '-c', f'CREATE DATABASE "{target}"'], f'creating {target}')
    restore_argv = [args.pg_restore, '--no-owner', '--no-acl', '--exit-on-error', *connection, '-d', target, str(dump)]
    if args.owner_role:
        restore_argv += ['--role', args.owner_role]
    _run(runner, restore_argv, 'pg_restore')
    stamped = stamp_restored(args, target, runner)
    observed = observe(args, target, runner)
    compare = observe(args, args.compare_with, runner) if args.compare_with else None
    checks = checks_for(observed, compare, args.expect_migration)
    elapsed = time.monotonic() - began
    rpo_ok, rto_ok = backup_pipeline.recovery_objectives(
        manifest.captured_at, started_at, elapsed, backup_pipeline.RetentionPolicy())
    verified = all(checks.values())
    record = {
        'restore_verified': verified,
        'source': ref.tenant,
        'artifact_kind': ref.kind,
        'artifact_captured_at': manifest.captured_at.isoformat(),
        'started_at': started_at.isoformat(),
        'backup_age_seconds_at_start': (started_at - manifest.captured_at).total_seconds(),
        'elapsed_seconds': round(elapsed, 3),
        'rpo_ok': rpo_ok,
        'rto_ok': rto_ok,
        'target_db': target,
        'restored_at_stamped': stamped,
        'checks': checks,
        'observed': observed,
    }
    _write_record(scratch / RECORD_NAME, record)
    sys.stdout.write(json.dumps(record, indent=2, sort_keys=True) + '\n')
    return EXIT_OK if verified else EXIT_NOT_VERIFIED


def verify(args: argparse.Namespace, runner: Callable[..., object]) -> int:
    """Read an already restored database; nothing is created or changed."""
    observed = observe(args, args.target_db, runner)
    compare = observe(args, args.compare_with, runner) if args.compare_with else None
    checks = checks_for(observed, compare, args.expect_migration)
    verified = all(checks.values())
    sys.stdout.write(json.dumps({'restore_verified': verified, 'target_db': args.target_db,
                                 'checks': checks, 'observed': observed}, indent=2, sort_keys=True) + '\n')
    return EXIT_OK if verified else EXIT_NOT_VERIFIED


def _write_record(path: Path, payload: Mapping[str, object]) -> None:
    """Atomic: a reader never sees half a record, and a crash keeps the previous one."""
    descriptor, temporary = tempfile.mkstemp(prefix='.record-', dir=path.parent)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        handle.write(json.dumps(payload, indent=2, sort_keys=True) + '\n')
    os.replace(temporary, path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='restore_control_plane.py',
        description='Restore the control plane database from its newest backup into a new database and verify it.',
    )
    commands = parser.add_subparsers(dest='command', required=True)
    for name, help_text in (('restore', 'fetch, restore into a new database and verify'),
                            ('verify', 'verify an already restored database')):
        command = commands.add_parser(name, help=help_text)
        command.add_argument('--target-db', required=True)
        command.add_argument('--compare-with', help='a live database whose counts and sequence must be equal')
        command.add_argument('--expect-migration', type=int, help='the lowest schema_migrations version accepted')
        command.add_argument('--psql', default=shutil.which('psql'))
        command.add_argument('--pg-host')
        command.add_argument('--pg-port')
        command.add_argument('--pg-user')
        if name == 'restore':
            command.add_argument('--scratch-root', required=True, type=Path, help='a new private directory')
            command.add_argument('--store-root', type=Path, help='a filesystem store instead of the bucket')
            command.add_argument('--pg-restore', default=shutil.which('pg_restore'))
            command.add_argument('--owner-role', help='the role that will own the restored objects (SET ROLE)')
    return parser


def main(argv: Sequence[str] | None = None, runner: Callable[..., object] = subprocess.run) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    try:
        for tool in ('psql', 'pg_restore'):
            if hasattr(args, tool):
                _require(bool(getattr(args, tool)), f'{tool} is not on PATH; pass --{tool.replace("_", "-")}')
        return {'restore': restore, 'verify': verify}[args.command](args, runner)
    except (RestoreError, backup_pipeline.PipelineError, s3_client.StorageError) as error:
        sys.stderr.write(f'restore_control_plane: {error}\n')
        return EXIT_REFUSED


if __name__ == '__main__':
    raise SystemExit(main())
