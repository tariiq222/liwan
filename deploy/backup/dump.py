# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The external processes this package runs, and the one ``pg_dump`` command line.

Two rules live here. Which database names may be copied at all: a name that resembles a
live or template database is refused before a process starts. And the exact ``pg_dump``
argv: a custom-format archive of a serializable, deferrable snapshot with no password
flag, because the secret travels through libpq's own environment and never an argument.

:func:`run_checked` is the process seam every module shares; the tests replace it by
injecting a runner.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING

from deploy.backup.errors import BackupError, require

if TYPE_CHECKING:
    from collections.abc import Callable

FORBIDDEN_DB_EXACT = frozenset({
    'odoo19',
    'production',
    'prod',
    'postgres',
    'template0',
    'template1',
})
FORBIDDEN_DB_RE = re.compile(
    r'(?:^|_)(odoo19|production|prod|postgres|template0|template1)(?:_|$)',
    re.IGNORECASE,
)
DB_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
PG_USER_RE = re.compile(r'[A-Za-z0-9_]+')
# A command a database container runs: a bare name on its PATH or an absolute path inside it.
CONTAINER_COMMAND_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]*$')
PG_DUMP_COMMAND = 'pg_dump'


def validate_db_name(name: str) -> str:
    """A database name that may be copied: not a live-looking one and a safe identifier."""
    if not name or name != name.strip():
        raise BackupError('database name is required')
    if name.lower() in FORBIDDEN_DB_EXACT or FORBIDDEN_DB_RE.search(name):
        raise BackupError('refusing odoo19/production/postgres database names')
    if not DB_NAME_RE.fullmatch(name):
        raise BackupError('database name must match [A-Za-z][A-Za-z0-9_]*')
    return name


def validate_existing_file(path_str: str | Path, *, what: str) -> Path:
    """An absolute path to an existing file, or a refusal."""
    require(bool(str(path_str)), f'{what} is required')
    path = Path(path_str)
    require(path.is_absolute(), f'{what} must be an absolute path')
    resolved = path.resolve()
    require(resolved.is_file(), f'{what} is not an existing file')
    return resolved


def validate_container_command(name: str | None) -> str:
    """The dump command a database container runs: its own ``pg_dump``, or an absolute path inside it."""
    command = PG_DUMP_COMMAND if name is None else name
    require(isinstance(command, str) and bool(command), 'pg_dump is required')
    if command.startswith('/'):
        require('..' not in command.split('/'), 'pg_dump container path must not traverse')
        return command
    require(bool(CONTAINER_COMMAND_RE.fullmatch(command)), 'pg_dump container command must be a bare name')
    return command


def validate_container_output(target: str) -> str:
    """An absolute, non-traversing output path inside the container."""
    require(target != '-', 'pg_dump output must not be "-"; omit output_file to stream to stdout')
    out = Path(target)
    require(out.is_absolute(), 'pg_dump output path must be absolute')
    require('..' not in out.parts, 'pg_dump output path must not traverse')
    return str(out)


def build_pg_dump_argv(
    *,
    pg_dump: str | None = None,
    db_name: str,
    output_file: str | None = None,
    pg_host: str | None = None,
    pg_port: str | None = None,
    pg_user: str | None = None,
    container: bool = False,
) -> list[str]:
    """The only ``pg_dump`` command line in this repository.

    ``container=True`` builds the same archive command for a process inside the database
    container: the command is a bare name on that container's ``PATH`` (or an absolute path
    inside it, and it may be omitted), so it need not exist on the machine building the argv.
    Omit ``output_file`` to stream the archive to stdout without ``-f``. An explicit output
    must be an absolute, non-traversing path inside the container; ``-`` is a literal file
    name and is refused. The host form requires an existing local binary and an absolute
    output file.
    """
    if container:
        dump_command = validate_container_command(pg_dump)
        out = None if output_file is None else validate_container_output(output_file)
    else:
        require(pg_dump is not None, 'pg_dump is required')
        dump_command = str(validate_existing_file(pg_dump, what='pg_dump'))
        require(bool(output_file), 'pg_dump output file is required')
        out_path = Path(output_file)
        require(out_path.is_absolute(), 'pg_dump output path must be absolute')
        out = str(out_path)
    db = validate_db_name(db_name)
    argv = [dump_command, '-Fc', '--serializable-deferrable', '--no-password', '-d', db]
    if out is not None:
        argv.extend(['-f', out])
    if pg_host:
        argv.extend(['-h', pg_host])
    if pg_port:
        require(pg_port.isdigit(), 'pg port must be numeric')
        argv.extend(['-p', pg_port])
    if pg_user:
        require(bool(PG_USER_RE.fullmatch(pg_user)), 'pg user contains unsupported characters')
        argv.extend(['-U', pg_user])
    if any(token in {'--password', '-W'} for token in argv):
        raise BackupError('pg_dump argv must not include a password flag')
    return argv


def run_checked(runner: Callable[..., object], argv: list[str], what: str) -> object:
    """Run one command and refuse a non-zero exit; nothing is trusted before it returns."""
    completed = runner(argv, shell=False, check=False, capture_output=True, text=True)
    returncode = getattr(completed, 'returncode', None)
    if returncode != 0:
        raise BackupError(f'{what} failed with exit code {returncode}')
    return completed
