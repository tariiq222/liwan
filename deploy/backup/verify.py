# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restore one artifact into a NEW scratch database and prove it is usable.

The dump and the filestore are first compared with the SHA-256 digests and file count the
snapshot manifest pinned, so a file that changed after the copy is a failed restore, not a
verified one. The database is then created with the provisioning recipe, closed to
``PUBLIC`` before any data is restored, restored in one transaction, and read back: every
release module installed, no module stuck mid-transition, every referenced attachment
present.

The result is written to ``restore-verification.json`` beside the artifact. The manifest
itself is never edited: the capture-time consistency claim stays ``UNVERIFIED``, and this
file records that the copy was actually restored and what was checked.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from deploy.backup import snapshot
from deploy.backup.artifact import sha256_file
from deploy.backup.dump import validate_existing_file
from deploy.backup.errors import BackupError, require
from deploy.backup.manifest import CONSISTENCY_UNVERIFIED, SHA256_RE
from deploy.release.tenant_postgres import tenant_create_database_sql, tenant_isolation_sql

if TYPE_CHECKING:
    from collections.abc import Callable

VERIFICATION_NAME = 'restore-verification.json'
RESTORE_TOOLS = ('pg_restore', 'psql')
FORBIDDEN_DB_RE = re.compile(r'(?:^|_)(odoo19|production|prod|postgres|template0|template1)(?:_|$)', re.IGNORECASE)
DB_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
SQL_INSTALLED_NAMES = "SELECT name FROM ir_module_module WHERE name LIKE 'liwan\\_%' AND state = 'installed' ORDER BY name"
SQL_STUCK = "SELECT count(*) FROM ir_module_module WHERE state IN ('to upgrade', 'to install', 'to remove')"
SQL_ATTACHMENTS = 'SELECT DISTINCT store_fname FROM ir_attachment WHERE store_fname IS NOT NULL ORDER BY 1'
NOT_COVERED = (
    'capture-time quiescence',
    'encryption of the artifact at rest',
    'offsite copy',
    'retention',
    'RPO',
    'RTO',
)


@dataclass(frozen=True)
class RestoreTools:
    """The PostgreSQL client binaries a restore needs, and the process seam it runs them through."""

    pg_restore: Path
    psql: Path
    runner: Callable[..., object] = subprocess.run

    @classmethod
    def from_environment(cls, *, runner: Callable[..., object] = subprocess.run) -> RestoreTools:
        """Resolve the binaries from ``PATH``; a missing one is a refusal."""
        resolved = {}
        for name in RESTORE_TOOLS:
            found = shutil.which(name)
            require(found is not None, f'{name} is not on PATH; the restore cannot run')
            resolved[name] = Path(found)
        return cls(runner=runner, **resolved)

    def as_argv(self) -> list[str]:
        """The two flags this tool set maps to on a command line."""
        return ['--pg-restore', str(self.pg_restore), '--psql', str(self.psql)]


@dataclass(frozen=True)
class PostgresConnection:
    """Where the restore connects, and the role the restored database stays open to."""

    user: str
    host: str | None = None
    port: str | None = None

    def argv(self) -> list[str]:
        arguments = []
        for flag, value in (('-h', self.host), ('-p', self.port), ('-U', self.user)):
            if value:
                arguments += [flag, str(value)]
        return arguments


def expected_modules() -> list[str]:
    """The release modules a complete restore must show installed.

    ``tools/catalog_check.py --release-modules`` is the one list the release, the upgrade and
    the restore share; reading it here is what turns "one liwan module is installed" into
    "every module this release installs is installed". An unreadable catalog is a failed
    check, never a skipped one.
    """
    catalog = Path(__file__).resolve().parents[2] / 'tools' / 'catalog_check.py'
    require(catalog.is_file(), 'the release module list is unavailable: tools/catalog_check.py is missing')
    done = subprocess.run(
        [sys.executable, '-B', str(catalog), '--release-modules'],
        capture_output=True, text=True, check=False, shell=False,
    )
    require(done.returncode == 0,
            f'the release module list could not be read: {done.stderr.strip()[-300:]}')
    modules = sorted(name.strip() for name in done.stdout.split(',') if name.strip())
    require(bool(modules), 'the release module list is empty: a restore cannot be verified against it')
    return modules


def load_manifest_integrity(manifest_path: Path) -> dict[str, object]:
    """The snapshot manifest, if it names its database and pins the bytes as this package writes them.

    A manifest without the digests and the file count is not one this package wrote: there is
    nothing to verify the copy against, so it is refused before any database is touched. A
    manifest that claims a stronger consistency than a running copy can have is refused for
    the same reason: the claim is the one thing this package never makes.
    """
    try:
        payload = json.loads(manifest_path.read_text(encoding='utf-8'))
    except ValueError as error:
        raise BackupError(f'{snapshot.MANIFEST_NAME} is not valid JSON: {error}') from None
    if not isinstance(payload, dict):
        raise BackupError(f'{snapshot.MANIFEST_NAME} is not a JSON object')
    require(
        isinstance(payload.get('db_name'), str) and bool(payload['db_name']),
        f'{snapshot.MANIFEST_NAME} does not name the database it copied',
    )
    consistency = payload.get('consistency', CONSISTENCY_UNVERIFIED)
    require(
        consistency == CONSISTENCY_UNVERIFIED,
        f'{snapshot.MANIFEST_NAME} claims consistency {consistency!r}: this package cannot '
        f'certify more than {CONSISTENCY_UNVERIFIED}',
    )
    pinned = all(
        isinstance(payload.get(name), str) and bool(SHA256_RE.fullmatch(payload[name]))
        for name in ('database_dump_sha256', 'filestore_sha256')
    )
    count = payload.get('filestore_file_count')
    require(
        pinned and isinstance(count, int) and not isinstance(count, bool) and count >= 0,
        f'{snapshot.MANIFEST_NAME} does not pin the backup: it needs database_dump_sha256, '
        f'filestore_sha256 and filestore_file_count as this package writes them',
    )
    return payload


def check_backup_integrity(manifest: dict[str, object], dump: Path, store: Path) -> dict[str, object]:
    """Compare the dump and the filestore with what the manifest pinned.

    A symlink or special file in the backup is refused; a digest or count that differs is
    listed in ``mismatches`` so the restore record shows it and cannot verify.
    """
    require(not dump.is_symlink(), 'database.dump is a symlink: a restore reads a regular file only')
    try:
        filestore_sha256, file_count = snapshot.filestore_digest(store)
    except BackupError as error:
        raise BackupError(f'the backup filestore cannot be restored: {error}') from None
    actual = {
        'database_dump_sha256': sha256_file(dump),
        'filestore_sha256': filestore_sha256,
        'filestore_file_count': file_count,
    }
    return {
        'mismatches': [key for key, value in actual.items() if manifest[key] != value],
        'filestore_files_expected': manifest['filestore_file_count'],
        'filestore_files_actual': file_count,
    }


def validate_target_db(name: str) -> str:
    """A new scratch database name that does not resemble a live one."""
    require(
        bool(DB_NAME_RE.match(name)) and not FORBIDDEN_DB_RE.search(name) and 'scratch' in name.lower(),
        'target database must be a new scratch name and must not resemble a live database',
    )
    return name


def restore_verified(
    *,
    artifact: Path,
    target_db: str,
    target_filestore: Path | str,
    tools: RestoreTools,
    pg: PostgresConnection,
) -> dict[str, object]:
    """Restore the artifact into a new scratch database and return the verification record.

    The digest check runs before any command, the database name before anything is created,
    and each step stops the run before the next: a failed create leaves no isolation or
    ``pg_restore`` behind, and a ``pg_restore`` cut short leaves no half-written database.
    """
    db = validate_target_db(target_db)
    backup_path = Path(artifact)
    dump = backup_path / snapshot.DUMP_NAME
    store = backup_path / snapshot.FILESTORE_NAME
    manifest_path = backup_path / snapshot.MANIFEST_NAME
    require(
        backup_path.is_absolute() and dump.is_file() and store.is_dir() and manifest_path.is_file(),
        f'the artifact must be an absolute directory holding {snapshot.DUMP_NAME}, '
        f'{snapshot.FILESTORE_NAME}/ and {snapshot.MANIFEST_NAME}',
    )
    destination = Path(target_filestore)
    require(
        destination.is_absolute() and not destination.exists() and destination.name == db,
        'target filestore must be a new absolute path ending in the target database name',
    )
    pg_restore = validate_existing_file(tools.pg_restore, what='pg_restore')
    psql = validate_existing_file(tools.psql, what='psql')
    # The restored database stays open to the role the restore connects as once PUBLIC is closed.
    require(bool(pg.user), 'a postgres user is required: it is the role the restored database stays open to')
    source_manifest = load_manifest_integrity(manifest_path)
    integrity = check_backup_integrity(source_manifest, dump, store)
    try:
        create, isolation = (
            tenant_create_database_sql(db) + ';\n',
            tenant_isolation_sql(db, pg.user),
        )
    except ValueError as error:
        raise BackupError(f'database or role cannot be quoted for provisioning: {error}') from None
    conn = pg.argv()

    def run(argv: list[str], input: str | None = None) -> str:
        done = tools.runner(argv, input=input, capture_output=True, text=True, shell=False, check=False)
        if done.returncode != 0:
            raise BackupError(f'{Path(argv[0]).name} failed with exit code {done.returncode}')
        return done.stdout

    # Created by the provisioning recipe, so a restored tenant sorts like a provisioned one,
    # then closed to PUBLIC before any data is restored into it. psql stops on the first
    # error and a failure raises, so neither the isolation nor pg_restore runs after a
    # failed step.
    admin = [str(psql), *conn, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres']
    run(admin, input=create)
    run(admin, input=isolation)
    # Source grants may reference tenant runtime roles absent from the isolated scratch host.
    # One transaction per restore: a dump cut short leaves no half-written database behind, so
    # a later check can never read a partially applied schema as a verified restore.
    run([str(pg_restore), *conn, '--no-owner', '--no-acl', '--exit-on-error',
         '--single-transaction', '-d', db, str(dump)])
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(str(store), str(destination))

    def query(sql: str) -> str:
        return run([str(psql), *conn, '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql])

    installed_names = [line for line in query(SQL_INSTALLED_NAMES).splitlines() if line]
    expected = expected_modules()
    missing_modules = sorted(set(expected) - set(installed_names))
    stuck = int(query(SQL_STUCK).strip() or 0)
    referenced = [line for line in query(SQL_ATTACHMENTS).splitlines() if line]
    missing = [name for name in referenced if not (destination / name).is_file()]
    result = {
        'restore_verified': (
            bool(expected) and not missing_modules and stuck == 0 and not missing
            and not integrity['mismatches']
        ),
        'verified_at': datetime.now(timezone.utc).isoformat(),
        'restored_into': db,
        'source_manifest': source_manifest,
        'checks': {
            'backup_integrity_mismatches': integrity['mismatches'],
            'filestore_files_expected': integrity['filestore_files_expected'],
            'filestore_files_actual': integrity['filestore_files_actual'],
            'liwan_modules_installed': len(installed_names),
            'liwan_modules_expected': len(expected),
            'missing_modules': missing_modules,
            'modules_stuck_mid_transition': stuck,
            'attachment_files_referenced': len(referenced),
            'missing_attachment_files': missing,
        },
        'not_covered': list(NOT_COVERED),
    }
    (backup_path / VERIFICATION_NAME).write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8',
    )
    return result
