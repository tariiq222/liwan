# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restore a backup.py candidate into a NEW scratch database and prove it is usable.

Writes restore-verification.json beside the backup. Never edits manifest.json:
the capture-time consistency claim stays UNVERIFIED; this records that the copy
was actually restored and what was checked. The dump and the filestore are first
compared with the SHA-256 digests and file count the manifest pinned, so a file
that changed after the copy is a failed restore, not a verified one.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

try:  # imported as deploy.<module> (repository tests, PYTHONPATH=.)
    from deploy import backup
except ImportError:  # executed as a script from deploy/ (PYTHONPATH=deploy)
    import backup

FORBIDDEN_DB_RE = re.compile(r'(?:^|_)(odoo19|production|prod|postgres|template0|template1)(?:_|$)', re.IGNORECASE)
DB_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
SQL_INSTALLED_NAMES = "SELECT name FROM ir_module_module WHERE name LIKE 'liwan\\_%' AND state = 'installed' ORDER BY name"
SQL_STUCK = "SELECT count(*) FROM ir_module_module WHERE state IN ('to upgrade', 'to install', 'to remove')"
SQL_ATTACHMENTS = 'SELECT DISTINCT store_fname FROM ir_attachment WHERE store_fname IS NOT NULL ORDER BY 1'


RELEASE_POSTGRES = Path(__file__).resolve().parent / 'releases' / 'postgres.py'


def expected_modules() -> list[str]:
    """The release modules a complete restore must show installed.

    ``tools/catalog_check.py --release-modules`` is the one list the release, the upgrade and
    the restore stage share; reading it here is what turns "one liwan module is installed" into
    "every module this release installs is installed" (issue #465). An unreadable catalog is a
    failed check, never a skipped one.
    """
    catalog = Path(__file__).resolve().parent.parent / 'tools' / 'catalog_check.py'
    if not catalog.is_file():
        raise RestoreError('the release module list is unavailable: tools/catalog_check.py is missing')
    done = subprocess.run(
        [sys.executable, '-B', str(catalog), '--release-modules'],
        capture_output=True, text=True, check=False, shell=False,
    )
    if done.returncode != 0:
        raise RestoreError(f'the release module list could not be read: {done.stderr.strip()[-300:]}')
    modules = sorted(name.strip() for name in done.stdout.split(',') if name.strip())
    if not modules:
        raise RestoreError('the release module list is empty: a restore cannot be verified against it')
    return modules


class RestoreError(Exception):
    """Validation or restore failure; no verification record claims success."""


def load_manifest_integrity(manifest: Path) -> dict:
    """The manifest, if it pins the dump and the filestore bytes as backup.py writes them.

    A manifest without the digests and the file count is not a backup.py manifest: there is
    nothing to verify the copy against, so it is refused before any database is touched.
    """
    try:
        payload = json.loads(manifest.read_text(encoding='utf-8'))
    except ValueError as error:
        raise RestoreError(f'manifest.json is not valid JSON: {error}') from None
    count = payload.get('filestore_file_count') if isinstance(payload, dict) else None
    if not (
        isinstance(payload, dict)
        and all(isinstance(payload.get(key), str) and backup.SHA256_RE.fullmatch(payload[key])
                for key in ('database_dump_sha256', 'filestore_sha256'))
        and isinstance(count, int) and not isinstance(count, bool) and count >= 0
    ):
        message = (
            'manifest.json does not pin the backup: it needs database_dump_sha256, '
            'filestore_sha256 and filestore_file_count as deploy/backup.py writes them'
        )
        raise RestoreError(message)
    return payload


def check_backup_integrity(manifest: dict, dump: Path, store: Path) -> dict:
    """Compare the dump and the filestore with what the manifest pinned.

    A symlink or special file in the backup raises :class:`RestoreError`; a digest or count
    that differs is listed in ``mismatches`` so the restore record shows it and cannot verify.
    """
    if dump.is_symlink():
        message = 'database.dump is a symlink: a restore reads a regular file only'
        raise RestoreError(message)
    try:
        filestore_sha256, file_count = backup.filestore_digest(store)
    except backup.BackupError as error:
        raise RestoreError(f'the backup filestore cannot be restored: {error}') from None
    actual = {
        'database_dump_sha256': backup.sha256_file(dump),
        'filestore_sha256': filestore_sha256,
        'filestore_file_count': file_count,
    }
    return {
        'mismatches': [key for key, value in actual.items() if manifest[key] != value],
        'filestore_files_expected': manifest['filestore_file_count'],
        'filestore_files_actual': file_count,
    }


def validate_target_db(name: str) -> str:
    if not DB_NAME_RE.match(name) or FORBIDDEN_DB_RE.search(name) or 'scratch' not in name.lower():
        message = 'target database must be a new scratch name and must not resemble a live database'
        raise RestoreError(message)
    return name


def _tool(path: str, what: str) -> str:
    candidate = Path(path)
    if not candidate.is_absolute() or not candidate.is_file():
        raise RestoreError(f'{what} must be an absolute path to an existing executable')
    return str(candidate)


def _conn(pg_host, pg_port, pg_user) -> list[str]:
    argv = []
    for flag, value in (('-h', pg_host), ('-p', pg_port), ('-U', pg_user)):
        if value:
            argv += [flag, str(value)]
    return argv


def _tenant_database_sql(database: str, role: str) -> tuple[str, str]:
    """The create and PUBLIC-closing scripts of deploy/releases/postgres.py, the one source.

    Loaded by path because this file also runs as a script, where ``deploy`` is not a package.
    """
    spec = importlib.util.spec_from_file_location('liwan_release_postgres', RELEASE_POSTGRES)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        return module.tenant_create_database_sql(database) + ';\n', module.tenant_isolation_sql(database, role)
    except ValueError as error:
        raise RestoreError(f'database or role cannot be quoted for provisioning: {error}') from None


def perform_restore(*, backup_dir, target_db, target_filestore, pg_restore, psql,
                    pg_host=None, pg_port=None, pg_user=None, runner=subprocess.run) -> dict:
    db = validate_target_db(target_db)
    backup_path = Path(backup_dir)
    dump, store = backup_path / backup.DUMP_NAME, backup_path / backup.FILESTORE_NAME
    manifest = backup_path / 'manifest.json'
    if not (backup_path.is_absolute() and dump.is_file() and store.is_dir() and manifest.is_file()):
        message = 'backup directory must be absolute and contain database.dump, filestore/ and manifest.json'
        raise RestoreError(message)
    destination = Path(target_filestore)
    if not destination.is_absolute() or destination.exists() or destination.name != db:
        message = 'target filestore must be a new absolute path ending in the target database name'
        raise RestoreError(message)
    tools = {
        'pg_restore': _tool(pg_restore, 'pg_restore'),
        'psql': _tool(psql, 'psql'),
    }
    source_manifest = load_manifest_integrity(manifest)
    integrity = check_backup_integrity(source_manifest, dump, store)
    conn = _conn(pg_host, pg_port, pg_user)
    # The restored database stays open to the role the restore connects as once PUBLIC is closed.
    if not pg_user:
        message = '--pg-user is required: it is the role the restored database stays open to'
        raise RestoreError(message)
    create, isolation = _tenant_database_sql(db, pg_user)

    def run(argv, input=None):
        done = runner(argv, input=input, capture_output=True, text=True, shell=False, check=False)
        if done.returncode != 0:
            raise RestoreError(f'{Path(argv[0]).name} failed with exit code {done.returncode}')
        return done.stdout

    # Created by the provisioning recipe, so a restored tenant sorts like a provisioned one, then closed to
    # PUBLIC before any data is restored into it. psql stops on the first error and a failure raises, so
    # neither the isolation nor pg_restore runs after a failed step.
    admin = [tools['psql'], *conn, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres']
    run(admin, input=create)
    run(admin, input=isolation)
    # Source grants may reference tenant runtime roles absent from the isolated scratch host.
    # One transaction per restore: a dump cut short leaves no half-written database behind, so a
    # later check can never read a partially applied schema as a verified restore (issue #465).
    run([tools['pg_restore'], *conn, '--no-owner', '--no-acl', '--exit-on-error',
         '--single-transaction', '-d', db, str(dump)])
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(str(store), str(destination))

    def query(sql):
        return run([tools['psql'], *conn, '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql])

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
        'not_covered': ['capture-time quiescence', 'encryption', 'offsite copy', 'retention', 'RPO', 'RTO'],
    }
    (backup_path / 'restore-verification.json').write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8',
    )
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('--backup-dir', '--target-db', '--target-filestore', '--pg-restore', '--psql', '--pg-user'):
        parser.add_argument(flag, required=True)
    for flag in ('--pg-host', '--pg-port'):
        parser.add_argument(flag)
    args = parser.parse_args(argv)
    try:
        result = perform_restore(**vars(args))
    except RestoreError as error:
        sys.stderr.write(f'restore_verify: {error}\n')
        return 1
    sys.stdout.write(json.dumps(result['checks'], ensure_ascii=False) + '\n')
    return 0 if result['restore_verified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
