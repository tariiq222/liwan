# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Render the one stack definition from an environment file.

``compose.yml`` is a compose template. Its only structural variation is a block between ``# @if LIWAN_STACK_<NAME>``
and ``# @endif`` lines: it stays when that key of the env file is exactly ``true`` and goes when it is ``false``. Blocks
do not nest, every block is closed, every block's key is a toggle of this template (``TOGGLES``), and each of those is present in
the env file and exactly ``true`` or ``false``; anything else is refused before a file is written. Another ``LIWAN_STACK_`` key
is ignored and named once on stderr (``ignored: <names>``): it belongs to a newer or older stack. Everything else is compose's own ``${VAR}`` interpolation. Nothing here reads
or tests the name of an environment: the env file is the whole difference between environments.

Sizing comes from ``deploy/odoo_sizing.py``: ``sizing.env`` (beside the rendered compose file) carries the values the
template interpolates, and ``odoo_conf`` renders the Odoo config with the same plan. The Odoo config template takes strict
``{{KEY}}`` placeholders: a key the template needs and the caller did not give, or one the template does not use, is refused.

    python3 -B -m deploy.stack.render <env file> [<more env files>]   # prints the rendered compose file
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

from deploy import odoo_sizing
from deploy.release.common import parse_env_text

STACK = Path(__file__).resolve().parent
CADDYFILE = STACK / 'Caddyfile'  # the one edge of every environment
TOGGLES = frozenset({'LIWAN_STACK_COMMERCIAL_EDGE', 'LIWAN_STACK_DB_HOST_LINK'})
TOGGLE_PREFIX = 'LIWAN_STACK_'
IF_LINE = re.compile(r'^\s*# @if (\S+)\s*$')
ENDIF_LINE = re.compile(r'^\s*# @endif\s*$')
PLACEHOLDER = re.compile(r'\{\{([A-Z0-9_]+)\}\}')
BOOLEANS = {'true': True, 'false': False}
SIZING_FILE = 'sizing.env'


class StackError(Exception):
    """The template, the env file or the placeholder keys cannot produce a stack."""


def read_env(*paths: Path) -> dict[str, str]:
    """Merge env files in order (later wins), parsed exactly as the release command parses them (``common.parse_env_text``)."""
    values: dict[str, str] = {}
    for path in paths:
        values.update(parse_env_text(Path(path).read_text(encoding='utf-8')))
    return values


def toggles_of(env: dict[str, str]) -> dict[str, bool]:
    """The toggles this template uses (``TOGGLES``), each present and exactly ``true`` or ``false``. Another ``LIWAN_STACK_`` key
    belongs to a newer or older stack and is ignored here (``ignored_toggles`` names it); a misspelled known one fails because the
    real toggle is then missing."""
    result = {}
    for name in sorted(TOGGLES):
        if name not in env:
            raise StackError(f'{name} is missing from the env file (true or false)')
        if env[name] not in BOOLEANS:
            raise StackError(f'{name} must be exactly true or false')
        result[name] = BOOLEANS[env[name]]
    return result


def ignored_toggles(env: dict[str, str]) -> list[str]:
    """The ``LIWAN_STACK_`` keys of the env that this template does not use, by name only."""
    return sorted(name for name in env if name.startswith(TOGGLE_PREFIX) and name not in TOGGLES)


def note_ignored(env: dict[str, str]) -> None:
    ignored = ignored_toggles(env)
    if ignored:
        sys.stderr.write(f'render: ignored: {", ".join(ignored)}\n')


def render_template(text: str, toggles: dict[str, bool]) -> str:
    """The template with each ``# @if`` block kept or dropped by its toggle, marker lines removed."""
    output: list[str] = []
    open_key: str | None = None
    keep = True
    for number, line in enumerate(text.splitlines(keepends=True), 1):
        start = IF_LINE.match(line)
        if start:
            if open_key is not None:
                raise StackError(f'line {number}: blocks do not nest ({open_key} is still open)')
            if start.group(1) not in TOGGLES:
                raise StackError(f'line {number}: unknown toggle {start.group(1)}')
            open_key, keep = start.group(1), toggles[start.group(1)]
        elif ENDIF_LINE.match(line):
            if open_key is None:
                raise StackError(f'line {number}: # @endif without a block')
            open_key, keep = None, True
        elif keep:
            output.append(line)
    if open_key is not None:
        raise StackError(f'block {open_key} is never closed')
    return ''.join(output)


def render_stack(env: dict[str, str]) -> str:
    return render_template((STACK / 'compose.yml').read_text(encoding='utf-8'), toggles_of(env))


def sizing_variables() -> dict[str, str]:
    return odoo_sizing.compose_variables(odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions()))


def render_placeholders(template: str, values: dict[str, str]) -> str:
    """Fill every ``{{KEY}}`` of the template; refuse a missing key and a key the template does not use."""
    needed = set(PLACEHOLDER.findall(template))
    missing, unused = sorted(needed - set(values)), sorted(set(values) - needed)
    if missing or unused:
        raise StackError(f'odoo.conf.template keys differ: missing {missing}, unused {unused}')
    return PLACEHOLDER.sub(lambda match: values[match.group(1)], template)


def odoo_conf_values(env: dict[str, str]) -> dict[str, str]:
    """The placeholder values of ``odoo.conf.template``: the two secrets of the env file and the sizing plan's Odoo budget."""
    sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
    return {
        'DB_PASSWORD': env['DB_PASSWORD'],
        'LIWAN_ODOO_ADMIN_PASSWD': env['LIWAN_ODOO_ADMIN_PASSWD'],
        'ODOO_WORKERS': str(sizing.workers),
        'ODOO_MAX_CRON_THREADS': str(sizing.max_cron_threads),
        'ODOO_DB_MAXCONN': str(sizing.db_maxconn),
        'ODOO_LIMIT_MEMORY_SOFT': str(sizing.limit_memory_soft),
        'ODOO_LIMIT_MEMORY_HARD': str(sizing.limit_memory_hard),
    }


def odoo_conf(env: dict[str, str]) -> str:
    """The rendered Odoo config; it holds secrets, so the caller writes it with the owner and mode the validator demands."""
    missing = [key for key in ('DB_PASSWORD', 'LIWAN_ODOO_ADMIN_PASSWD') if not env.get(key)]
    if missing:
        raise StackError(f'the env file lacks {", ".join(missing)}')
    return render_placeholders((STACK / 'odoo.conf.template').read_text(encoding='utf-8'), odoo_conf_values(env))


@contextlib.contextmanager
def rendered_stack(*env_files: Path):
    """Yield the path of the rendered compose file, with ``sizing.env`` beside it (pass it as an extra ``--env-file``)."""
    text = render_stack(read_env(*env_files))
    with tempfile.TemporaryDirectory() as directory:
        compose = Path(directory) / 'compose.yml'
        compose.write_text(text, encoding='utf-8')
        (Path(directory) / SIZING_FILE).write_text(
            ''.join(f'{name}={value}\n' for name, value in sizing_variables().items()), encoding='utf-8')
        yield compose


BUNDLE_CONTRACT = 1
BUNDLE_COMPOSE, BUNDLE_ODOO_CONF, BUNDLE_MANIFEST = 'compose.yml', 'odoo.conf', 'stack.json'
BUNDLE_DIRECTORY_MODE = 0o700
BUNDLE_FILE_MODE = 0o600
EXIT_USAGE = 2


def write_private(path: Path, text: str) -> None:
    """A new file at mode 0600 from its first byte; a bundle file holds interpolated secrets or sits beside one."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, BUNDLE_FILE_MODE)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        handle.write(text)
    path.chmod(BUNDLE_FILE_MODE)


def write_bundle(env_files: list[Path], out: Path) -> None:
    """The whole stack of this checkout for one environment, in ``out``: the compose file, the sizing values (an extra
    ``--env-file``), the Odoo config and ``stack.json``, the manifest the release command reads (it never reads this
    checkout's templates itself, so each release renders with its own code)."""
    env = read_env(*env_files)
    compose, odoo = render_stack(env), odoo_conf(env)
    note_ignored(env)
    write_private(out / BUNDLE_COMPOSE, compose)
    write_private(out / SIZING_FILE, ''.join(f'{name}={value}\n' for name, value in sizing_variables().items()))
    write_private(out / BUNDLE_ODOO_CONF, odoo)
    write_private(out / BUNDLE_MANIFEST, json.dumps({
        'contract': BUNDLE_CONTRACT, 'compose': BUNDLE_COMPOSE, 'envFiles': [SIZING_FILE], 'odooConf': BUNDLE_ODOO_CONF,
        'projectDirectory': 'deploy'}, indent=2) + '\n')


def bundle_main(argv: list[str]) -> int:
    env_files: list[Path] = []
    out = None
    arguments = iter(argv)
    for argument in arguments:
        value = next(arguments, None)
        if value is None or argument not in ('--env-file', '--out'):
            sys.stderr.write(USAGE)
            return EXIT_USAGE
        if argument == '--env-file':
            env_files.append(Path(value))
        else:
            out = Path(value)
    if out is None or not env_files:
        sys.stderr.write(USAGE)
        return EXIT_USAGE
    if not out.is_dir() or stat.S_IMODE(out.stat().st_mode) != BUNDLE_DIRECTORY_MODE:
        sys.stderr.write(f'render: {out} must be an existing directory with mode 0700\n')
        return EXIT_USAGE
    try:
        write_bundle(env_files, out)
    except StackError as error:
        sys.stderr.write(f'render: {error}\n')
        return 1
    except OSError as error:
        sys.stderr.write(f'render: {error.filename or "a file"}: {error.strerror}\n')
        return 1
    return 0


USAGE = ('usage: render.py bundle --env-file <env file> [--env-file <env file> ...] --out <directory 0700>\n'
         '       render.py <env file> [<env file> ...]   (the compose file on stdout)\n')


def main(argv: list[str]) -> int:
    if argv[:1] == ['bundle']:
        return bundle_main(argv[1:])
    if not argv or argv[0].startswith('--'):
        sys.stderr.write(USAGE)
        return EXIT_USAGE
    try:
        env = read_env(*(Path(path) for path in argv))
        sys.stdout.write(render_stack(env))
        note_ignored(env)
    except StackError as error:
        sys.stderr.write(f'render: {error}\n')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
