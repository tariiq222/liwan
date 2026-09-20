# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fail-closed CLI wrappers for isolated Odoo and Playwright E2E checks.

Every isolation value is a required CLI flag. The wrappers never default to
the local dev topology (database ``odoo19``, Odoo ``:8069``, Nuxt
``http://localhost:3000``) and never take those values from the process
environment. Subprocess invocation uses an argv list with ``shell=False``.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING, NoReturn
from urllib.parse import urlparse

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

NASQ_ADDONS = ('nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_hr', 'nasq_chat')
SCRATCH_LIFECYCLE_TOKEN = 'CREATE_NEW_SCRATCH'
FORBIDDEN_DB_RE = re.compile(
    r'(?:^|_)(odoo19|production|postgres|template0|template1)(?:_|$)',
    re.IGNORECASE,
)
FORBIDDEN_DB_EXACT = frozenset({
    'odoo19',
    'production',
    'prod',
    'postgres',
    'template0',
    'template1',
})
FORBIDDEN_PORTS = frozenset({80, 443, 3000, 5432, 8069, 8072})
LOOPBACK_HOSTS = frozenset({'127.0.0.1', 'localhost', '::1'})
SCRATCH_DB_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
MODULE_RE = re.compile(r'^[a-z0-9_]+$')
TAG_RE = re.compile(r'^[-/A-Za-z0-9_.:]+$')
HTTP_PATHS = frozenset({'', '/'})
WS_PATHS = frozenset({'/websocket'})


class IsolationError(Exception):
    """Validation or policy failure; not a subprocess result."""


def fail(message: str) -> NoReturn:
    raise IsolationError(message)


def validate_scratch_lifecycle(value: str) -> str:
    if value != SCRATCH_LIFECYCLE_TOKEN:
        fail(
            'scratch database requires --scratch-lifecycle CREATE_NEW_SCRATCH; '
            'a name containing "scratch" does not prove a new isolated database',
        )
    return value


def validate_scratch_db(name: str, *, lifecycle: str) -> str:
    validate_scratch_lifecycle(lifecycle)
    if not name or name != name.strip():
        fail('scratch database name is required and must not have surrounding whitespace')
    lowered = name.lower()
    if lowered in FORBIDDEN_DB_EXACT or FORBIDDEN_DB_RE.search(name):
        fail('refusing odoo19/production/postgres database names')
    if 'scratch' not in lowered:
        fail('scratch database name must contain "scratch"')
    if not SCRATCH_DB_RE.fullmatch(name):
        fail('scratch database name must match [A-Za-z][A-Za-z0-9_]*')
    return name


def validate_port(port: int) -> int:
    if not isinstance(port, int) or isinstance(port, bool):
        fail('port must be an integer')
    if port < 1024 or port > 65535:
        fail('port must be in 1024-65535 and not a privileged default')
    if port in FORBIDDEN_PORTS:
        fail('refusing default/dev ports 80/443/3000/5432/8069/8072')
    return port


def _validate_url(url: str, *, schemes: set[str], what: str, allowed_paths: set[str]) -> str:
    if not url or url != url.strip():
        fail(f'{what} is required and must not have surrounding whitespace')
    parsed = urlparse(url)
    if parsed.scheme not in schemes:
        fail(f'{what} scheme must be one of {sorted(schemes)}')
    if parsed.username or parsed.password:
        fail(f'{what} must not contain credentials')
    if not parsed.hostname:
        fail(f'{what} host is required')
    host = parsed.hostname.lower()
    if host not in LOOPBACK_HOSTS:
        fail(f'{what} host must be loopback 127.0.0.1, localhost, or ::1')
    if parsed.port is None:
        fail(f'{what} must include an explicit non-default port')
    validate_port(parsed.port)
    if parsed.query or parsed.fragment or parsed.params:
        fail(f'{what} must not include query, fragment, or params')
    path = parsed.path or ''
    if path not in allowed_paths:
        fail(f'{what} path is not allowed')
    return url


def validate_base_url(url: str) -> str:
    return _validate_url(url, schemes={'http', 'https'}, what='base url', allowed_paths=HTTP_PATHS)


def validate_odoo_url(url: str) -> str:
    return _validate_url(url, schemes={'http', 'https'}, what='odoo url', allowed_paths=HTTP_PATHS)


def validate_ws_url(url: str) -> str:
    return _validate_url(url, schemes={'ws', 'wss'}, what='websocket url', allowed_paths=WS_PATHS)


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
    # Keep venv interpreter symlinks as given so site-packages stay on sys.path.
    if path.is_symlink():
        if not path.exists():
            fail(f'{what} is not an existing file')
        return path
    resolved = path.resolve()
    if not resolved.is_file():
        fail(f'{what} is not an existing file')
    return resolved


def validate_worktree_addons(worktree: str, addons_path: str) -> tuple[Path, Path]:
    worktree_dir = validate_existing_dir(worktree, what='worktree')
    addons_dir = validate_existing_dir(addons_path, what='worktree addons path')
    expected = (worktree_dir / 'odoo-addons').resolve()
    if addons_dir != expected:
        fail('worktree addons path must be <worktree>/odoo-addons')
    missing = [name for name in NASQ_ADDONS if not (addons_dir / name / '__manifest__.py').is_file()]
    if missing:
        fail(f'worktree addons path is missing nasq manifests: {", ".join(missing)}')
    return worktree_dir, addons_dir


def validate_core_addons(odoo_bin: Path) -> Path:
    """Official core addons live next to odoo-bin at odoo/addons (base is here)."""
    core = (odoo_bin.parent / 'odoo' / 'addons').resolve()
    base_manifest = core / 'base' / '__manifest__.py'
    if not core.is_dir() or not base_manifest.is_file():
        fail('odoo-bin root must contain odoo/addons/base/__manifest__.py')
    return core


def validate_stock_addons(path_str: str) -> Path:
    """Official extra addons (project, hr). base is not stored here on standard Odoo."""
    stock = validate_existing_dir(path_str, what='stock Odoo addons path')
    missing = [
        name
        for name in ('project', 'hr')
        if not (stock / name / '__manifest__.py').is_file()
    ]
    if missing:
        fail(f'stock Odoo addons path must contain official {", ".join(missing)} manifests')
    return stock


def validate_modules(raw: str) -> str:
    if not raw or raw != raw.strip():
        fail('modules list is required')
    parts = raw.split(',')
    if any(not MODULE_RE.fullmatch(part) for part in parts):
        fail('modules must be comma-separated [a-z0-9_]+ names')
    if 'nasq_core' not in parts:
        fail('modules list must include nasq_core')
    return raw


def validate_test_tags(raw: str) -> str:
    if not raw or raw != raw.strip():
        fail('test tags are required')
    parts = raw.split(',')
    if any(not TAG_RE.fullmatch(part) for part in parts):
        fail('test tags contain unsupported characters')
    return raw


def build_odoo_argv(
    *,
    python: str,
    odoo_bin: str,
    odoo_conf: str,
    stock_addons: str,
    worktree_addons: str,
    scratch_db: str,
    scratch_lifecycle: str,
    http_port: int,
    modules: str,
    test_tags: str,
) -> list[str]:
    python_path = validate_existing_file(python, what='python interpreter')
    bin_path = validate_existing_file(odoo_bin, what='odoo-bin')
    conf_path = validate_existing_file(odoo_conf, what='odoo conf')
    stock = validate_stock_addons(stock_addons)
    core = validate_core_addons(bin_path)
    if stock == core:
        fail('stock extra addons path must not be the core odoo/addons directory')
    _worktree, addons = validate_worktree_addons(
        str(Path(worktree_addons).resolve().parent),
        worktree_addons,
    )
    db = validate_scratch_db(scratch_db, lifecycle=scratch_lifecycle)
    port = validate_port(http_port)
    mods = validate_modules(modules)
    tags = validate_test_tags(test_tags)
    addons_joined = f'{core},{stock},{addons}'
    return [
        str(python_path),
        str(bin_path),
        '-c',
        str(conf_path),
        f'--addons-path={addons_joined}',
        '-d',
        db,
        '-i',
        mods,
        '--test-tags',
        tags,
        '--http-port',
        str(port),
        '--http-interface',
        '127.0.0.1',
        '--max-cron-threads',
        '0',
        '--stop-after-init',
    ]


def build_install_argv(
    *,
    python: str,
    odoo_bin: str,
    odoo_conf: str,
    stock_addons: str,
    worktree_addons: str,
    scratch_db: str,
    scratch_lifecycle: str,
    http_port: int,
    modules: str,
) -> list[str]:
    argv = build_odoo_argv(
        python=python,
        odoo_bin=odoo_bin,
        odoo_conf=odoo_conf,
        stock_addons=stock_addons,
        worktree_addons=worktree_addons,
        scratch_db=scratch_db,
        scratch_lifecycle=scratch_lifecycle,
        http_port=http_port,
        modules=modules,
        test_tags='/nasq_core',
    )
    tag_at = argv.index('--test-tags')
    del argv[tag_at:tag_at + 2]
    return argv


def build_upgrade_argv(
    *,
    python: str,
    odoo_bin: str,
    odoo_conf: str,
    stock_addons: str,
    worktree_addons: str,
    scratch_db: str,
    scratch_lifecycle: str,
    http_port: int,
    modules: str,
    test_tags: str,
) -> list[str]:
    argv = build_odoo_argv(
        python=python,
        odoo_bin=odoo_bin,
        odoo_conf=odoo_conf,
        stock_addons=stock_addons,
        worktree_addons=worktree_addons,
        scratch_db=scratch_db,
        scratch_lifecycle=scratch_lifecycle,
        http_port=http_port,
        modules=modules,
        test_tags=test_tags,
    )
    argv[argv.index('-i')] = '-u'
    return argv


def build_runtime_argv(
    *,
    python: str,
    odoo_bin: str,
    odoo_conf: str,
    stock_addons: str,
    worktree_addons: str,
    scratch_db: str,
    scratch_lifecycle: str,
    http_port: int,
) -> list[str]:
    python_path = validate_existing_file(python, what='python interpreter')
    bin_path = validate_existing_file(odoo_bin, what='odoo-bin')
    conf_path = validate_existing_file(odoo_conf, what='odoo conf')
    stock = validate_stock_addons(stock_addons)
    core = validate_core_addons(bin_path)
    if stock == core:
        fail('stock extra addons path must not be the core odoo/addons directory')
    _worktree, addons = validate_worktree_addons(
        str(Path(worktree_addons).resolve().parent),
        worktree_addons,
    )
    db = validate_scratch_db(scratch_db, lifecycle=scratch_lifecycle)
    port = validate_port(http_port)
    addons_joined = f'{core},{stock},{addons}'
    return [
        str(python_path),
        str(bin_path),
        '-c',
        str(conf_path),
        f'--addons-path={addons_joined}',
        '-d',
        db,
        '--http-port',
        str(port),
        '--http-interface',
        '127.0.0.1',
        '--max-cron-threads',
        '0',
        f'--db-filter=^{db}$',
    ]


def build_shell_argv(
    *,
    python: str,
    odoo_bin: str,
    odoo_conf: str,
    stock_addons: str,
    worktree_addons: str,
    scratch_db: str,
    scratch_lifecycle: str,
) -> list[str]:
    python_path = validate_existing_file(python, what='python interpreter')
    bin_path = validate_existing_file(odoo_bin, what='odoo-bin')
    conf_path = validate_existing_file(odoo_conf, what='odoo conf')
    stock = validate_stock_addons(stock_addons)
    core = validate_core_addons(bin_path)
    if stock == core:
        fail('stock extra addons path must not be the core odoo/addons directory')
    _worktree, addons = validate_worktree_addons(
        str(Path(worktree_addons).resolve().parent),
        worktree_addons,
    )
    db = validate_scratch_db(scratch_db, lifecycle=scratch_lifecycle)
    addons_joined = f'{core},{stock},{addons}'
    return [
        str(python_path),
        str(bin_path),
        'shell',
        '-c',
        str(conf_path),
        f'--addons-path={addons_joined}',
        '-d',
        db,
        '--no-http',
    ]


def build_e2e_env(
    *,
    base_url: str,
    odoo_url: str,
    ws_url: str,
    scratch_db: str,
    scratch_lifecycle: str,
    parent_env: Mapping[str, str] | None = None,
) -> dict[str, str]:
    db = validate_scratch_db(scratch_db, lifecycle=scratch_lifecycle)
    env = dict(parent_env if parent_env is not None else os.environ)
    # Explicit flags overwrite any inherited Nuxt/Playwright defaults.
    env['E2E_BASE_URL'] = validate_base_url(base_url)
    env['NUXT_ODOO_URL'] = validate_odoo_url(odoo_url)
    env['NUXT_PUBLIC_WS_URL'] = validate_ws_url(ws_url)
    env['NUXT_ODOO_DB'] = db
    return env


def build_e2e_argv() -> list[str]:
    return ['npm', '-w', 'apps/web', 'run', 'test:e2e']


def run_argv(
    argv: Sequence[str],
    *,
    cwd: str,
    env: Mapping[str, str] | None = None,
    runner=subprocess.run,
) -> int:
    if not isinstance(argv, (list, tuple)) or not argv:
        fail('argv must be a non-empty list')
    if any(not isinstance(item, str) for item in argv):
        fail('argv entries must be strings')
    if any('\n' in item or '\r' in item or '\x00' in item for item in argv):
        fail('argv entries must not contain newlines or NUL')
    cwd_path = validate_existing_dir(cwd, what='subprocess cwd')
    completed = runner(
        list(argv),
        cwd=str(cwd_path),
        env=dict(env) if env is not None else None,
        shell=False,
        check=False,
    )
    return int(completed.returncode)


def _add_odoo_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('--worktree', required=True)
    parser.add_argument('--addons-path', required=True, help='selected worktree odoo-addons directory')
    parser.add_argument('--stock-addons', required=True, help='upstream Odoo addons directory')
    parser.add_argument('--python', required=True, help='absolute python used to launch odoo-bin')
    parser.add_argument('--odoo-bin', required=True)
    parser.add_argument('--odoo-conf', required=True)
    parser.add_argument('--scratch-db', required=True)
    parser.add_argument(
        '--scratch-lifecycle',
        required=True,
        help='must be CREATE_NEW_SCRATCH; name-only scratch is not accepted',
    )
    parser.add_argument('--http-port', required=True, type=int)
    parser.add_argument('--modules', required=True)
    parser.add_argument('--test-tags', required=True)


def _add_e2e_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('--worktree', required=True)
    parser.add_argument('--addons-path', required=True)
    parser.add_argument('--scratch-db', required=True)
    parser.add_argument(
        '--scratch-lifecycle',
        required=True,
        help='must be CREATE_NEW_SCRATCH; name-only scratch is not accepted',
    )
    parser.add_argument('--base-url', required=True, help='Playwright base URL; never defaults to localhost:3000')
    parser.add_argument('--odoo-url', required=True)
    parser.add_argument('--ws-url', required=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='check_isolated.py',
        description='Fail-closed isolated Odoo and E2E runners. No environment fallbacks.',
    )
    sub = parser.add_subparsers(dest='command', required=True)
    odoo_parser = sub.add_parser('odoo', help='run Odoo tests on an explicit scratch database')
    _add_odoo_flags(odoo_parser)
    upgrade_parser = sub.add_parser('upgrade', help='upgrade nasq modules on an explicit scratch database')
    _add_odoo_flags(upgrade_parser)
    runtime_parser = sub.add_parser('runtime', help='serve Odoo on an explicit scratch database without stop-after-init')
    runtime_parser.add_argument('--worktree', required=True)
    runtime_parser.add_argument('--addons-path', required=True, help='selected worktree odoo-addons directory')
    runtime_parser.add_argument('--stock-addons', required=True, help='upstream Odoo addons directory')
    runtime_parser.add_argument('--python', required=True, help='absolute python used to launch odoo-bin')
    runtime_parser.add_argument('--odoo-bin', required=True)
    runtime_parser.add_argument('--odoo-conf', required=True)
    runtime_parser.add_argument('--scratch-db', required=True)
    runtime_parser.add_argument(
        '--scratch-lifecycle',
        required=True,
        help='must be CREATE_NEW_SCRATCH; name-only scratch is not accepted',
    )
    runtime_parser.add_argument('--http-port', required=True, type=int)
    e2e_parser = sub.add_parser('e2e', help='run Playwright against an explicit non-default base URL')
    _add_e2e_flags(e2e_parser)
    return parser


def _command_odoo_like(args: argparse.Namespace, *, builder, runner=subprocess.run) -> int:
    _worktree, addons = validate_worktree_addons(args.worktree, args.addons_path)
    if addons != Path(args.addons_path).resolve():
        fail('addons path failed resolution check')
    argv = builder(
        python=args.python,
        odoo_bin=args.odoo_bin,
        odoo_conf=args.odoo_conf,
        stock_addons=args.stock_addons,
        worktree_addons=str(addons),
        scratch_db=args.scratch_db,
        scratch_lifecycle=args.scratch_lifecycle,
        http_port=args.http_port,
        modules=args.modules,
        test_tags=args.test_tags,
    )
    odoo_root = validate_existing_file(args.odoo_bin, what='odoo-bin').parent
    return run_argv(argv, cwd=str(odoo_root), env=os.environ, runner=runner)


def command_odoo(args: argparse.Namespace, *, runner=subprocess.run) -> int:
    return _command_odoo_like(args, builder=build_odoo_argv, runner=runner)


def command_upgrade(args: argparse.Namespace, *, runner=subprocess.run) -> int:
    return _command_odoo_like(args, builder=build_upgrade_argv, runner=runner)


def command_runtime(args: argparse.Namespace, *, runner=subprocess.run) -> int:
    _worktree, addons = validate_worktree_addons(args.worktree, args.addons_path)
    if addons != Path(args.addons_path).resolve():
        fail('addons path failed resolution check')
    argv = build_runtime_argv(
        python=args.python,
        odoo_bin=args.odoo_bin,
        odoo_conf=args.odoo_conf,
        stock_addons=args.stock_addons,
        worktree_addons=str(addons),
        scratch_db=args.scratch_db,
        scratch_lifecycle=args.scratch_lifecycle,
        http_port=args.http_port,
    )
    odoo_root = validate_existing_file(args.odoo_bin, what='odoo-bin').parent
    return run_argv(argv, cwd=str(odoo_root), env=os.environ, runner=runner)


def command_e2e(args: argparse.Namespace, *, runner=subprocess.run) -> int:
    worktree, _addons = validate_worktree_addons(args.worktree, args.addons_path)
    env = build_e2e_env(
        base_url=args.base_url,
        odoo_url=args.odoo_url,
        ws_url=args.ws_url,
        scratch_db=args.scratch_db,
        scratch_lifecycle=args.scratch_lifecycle,
        parent_env=os.environ,
    )
    return run_argv(build_e2e_argv(), cwd=str(worktree), env=env, runner=runner)


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(list(argv) if argv is not None else None)
        if args.command == 'odoo':
            return command_odoo(args)
        if args.command == 'upgrade':
            return command_upgrade(args)
        if args.command == 'runtime':
            return command_runtime(args)
        if args.command == 'e2e':
            return command_e2e(args)
        fail('unknown command')
    except IsolationError as error:
        sys.stderr.write(f'{error}\n')
        return 2


if __name__ == '__main__':
    sys.exit(main())
