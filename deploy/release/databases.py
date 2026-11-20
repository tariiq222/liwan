"""SQL and filestore helpers of the pre-upgrade snapshot and its rollback (pure functions, no command is run)."""
from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path

from deploy.releases.postgres import identifier


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def snapshot_name(database: str) -> str:
    return 'liwan_pre_' + hashlib.sha256(database.encode()).hexdigest()[:16]


def grant_statements(database: str, grants: list[list], owner: str) -> list[str]:
    """Rebuild recorded ``aclexplode`` rows on a database that has PostgreSQL's default ACL (a renamed copy).

    PUBLIC and the owner start from nothing, so a reduced owner entry comes back exactly as it was.
    """
    db = identifier(database)
    statements = [f'REVOKE ALL ON DATABASE {db} FROM PUBLIC', f'REVOKE ALL ON DATABASE {db} FROM {identifier(owner)}']
    for grantee, privilege, grantable in grants:
        target = 'PUBLIC' if grantee == '' else identifier(grantee)
        option = ' WITH GRANT OPTION' if grantable else ''
        statements.append(f'GRANT {privilege} ON DATABASE {db} TO {target}{option}')
    return statements


def terminate_sql(database: str) -> str:
    return ('SELECT pg_terminate_backend(pid) FROM pg_stat_activity '
            f'WHERE datname = {literal(database)} AND pid <> pg_backend_pid();\n')


def reopen_sql(database: str) -> str:
    return f'ALTER DATABASE {identifier(database)} ALLOW_CONNECTIONS true;\n'


def snapshot_sql(database: str) -> str:
    """Closed to new connections first, so no client can reconnect between the terminate and the copy."""
    db, snap = identifier(database), identifier(snapshot_name(database))
    return (f'ALTER DATABASE {db} ALLOW_CONNECTIONS false;\n' + terminate_sql(database)
            + f'DROP DATABASE IF EXISTS {snap} WITH (FORCE);\n'
            f'CREATE DATABASE {snap} TEMPLATE {db} STRATEGY FILE_COPY;\n'
            f'ALTER DATABASE {db} ALLOW_CONNECTIONS true;\n')


def swap_sql(database: str, live: bool) -> str:
    """Close and drop the live database only when it still exists; a resumed swap may find it already gone."""
    db, snap = identifier(database), identifier(snapshot_name(database))
    drop = (f'ALTER DATABASE {db} ALLOW_CONNECTIONS false;\n' + terminate_sql(database)
            + f'DROP DATABASE {db} WITH (FORCE);\n') if live else ''
    return drop + f'ALTER DATABASE {snap} RENAME TO {db};\n'


def restore_filestore(live: Path) -> None:
    """live -> live.failed, live.pre -> live, remove live.failed; each step resumes from what it finds."""
    pre, failed = live.with_name(live.name + '.pre'), live.with_name(live.name + '.failed')
    if pre.exists() and live.exists():
        if failed.exists():
            shutil.rmtree(failed)
        os.replace(live, failed)
    if pre.exists():
        os.replace(pre, live)
    if failed.exists():
        shutil.rmtree(failed)


def tree_bytes(root: Path) -> int:
    """Apparent size of every file under ``root`` (hard links counted in full: the safe side for a disk check)."""
    return sum(path.stat().st_size for path in root.rglob('*') if path.is_file()) if root.exists() else 0
