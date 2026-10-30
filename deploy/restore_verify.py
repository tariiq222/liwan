# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restore a backup.py candidate into a NEW scratch database and prove it is usable.

Writes restore-verification.json beside the backup. Never edits manifest.json:
the capture-time consistency claim stays UNVERIFIED; this records that the copy
was actually restored and what was checked.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

FORBIDDEN_DB_RE = re.compile(r'(?:^|_)(odoo19|production|prod|postgres|template0|template1)(?:_|$)', re.IGNORECASE)
DB_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
SQL_INSTALLED = "SELECT count(*) FROM ir_module_module WHERE name LIKE 'liwan\\_%' AND state = 'installed'"
SQL_STUCK = "SELECT count(*) FROM ir_module_module WHERE state IN ('to upgrade', 'to install', 'to remove')"
SQL_ATTACHMENTS = 'SELECT DISTINCT store_fname FROM ir_attachment WHERE store_fname IS NOT NULL ORDER BY 1'


class RestoreError(Exception):
    """Validation or restore failure; no verification record claims success."""


def validate_target_db(name: str) -> str:
    if not DB_NAME_RE.match(name) or FORBIDDEN_DB_RE.search(name) or 'scratch' not in name.lower():
        raise RestoreError('target database must be a new scratch name and must not resemble a live database')
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


def perform_restore(*, backup_dir, target_db, target_filestore, pg_restore, createdb, psql,
                    pg_host=None, pg_port=None, pg_user=None, runner=subprocess.run) -> dict:
    db = validate_target_db(target_db)
    backup = Path(backup_dir)
    dump, store, manifest = backup / 'database.dump', backup / 'filestore', backup / 'manifest.json'
    if not (backup.is_absolute() and dump.is_file() and store.is_dir() and manifest.is_file()):
        raise RestoreError('backup directory must be absolute and contain database.dump, filestore/ and manifest.json')
    destination = Path(target_filestore)
    if not destination.is_absolute() or destination.exists() or destination.name != db:
        raise RestoreError('target filestore must be a new absolute path ending in the target database name')
    tools = {
        'pg_restore': _tool(pg_restore, 'pg_restore'),
        'createdb': _tool(createdb, 'createdb'),
        'psql': _tool(psql, 'psql'),
    }
    conn = _conn(pg_host, pg_port, pg_user)

    def run(argv):
        done = runner(argv, capture_output=True, text=True, shell=False, check=False)
        if done.returncode != 0:
            raise RestoreError(f'{Path(argv[0]).name} failed with exit code {done.returncode}')
        return done.stdout

    run([tools['createdb'], *conn, db])
    run([tools['pg_restore'], *conn, '--no-owner', '--exit-on-error', '-d', db, str(dump)])
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(str(store), str(destination), symlinks=True)

    def query(sql):
        return run([tools['psql'], *conn, '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql])

    installed = int(query(SQL_INSTALLED).strip() or 0)
    stuck = int(query(SQL_STUCK).strip() or 0)
    referenced = [line for line in query(SQL_ATTACHMENTS).splitlines() if line]
    missing = [name for name in referenced if not (destination / name).is_file()]
    result = {
        'restore_verified': installed > 0 and stuck == 0 and not missing,
        'verified_at': datetime.now(timezone.utc).isoformat(),
        'restored_into': db,
        'source_manifest': json.loads(manifest.read_text(encoding='utf-8')),
        'checks': {
            'liwan_modules_installed': installed,
            'modules_stuck_mid_transition': stuck,
            'attachment_files_referenced': len(referenced),
            'missing_attachment_files': missing,
        },
        'not_covered': ['capture-time quiescence', 'encryption', 'offsite copy', 'retention', 'RPO', 'RTO'],
    }
    (backup / 'restore-verification.json').write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8',
    )
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('--backup-dir', '--target-db', '--target-filestore', '--pg-restore', '--createdb', '--psql'):
        parser.add_argument(flag, required=True)
    for flag in ('--pg-host', '--pg-port', '--pg-user'):
        parser.add_argument(flag)
    args = parser.parse_args(argv)
    try:
        result = perform_restore(**vars(args))
    except RestoreError as error:
        print(f'restore_verify: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result['checks'], ensure_ascii=False))
    return 0 if result['restore_verified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
