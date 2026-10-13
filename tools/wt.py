# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Create a task worktree with its own dependencies, ports and scratch DB name.

    python3 -B tools/wt.py new <area>-<slug> [--base main] [--no-install] [--resume]

Creates ``.worktrees/<area>-<slug>`` under the main checkout (also when run from a
worktree) on branch ``codex/<area>-<slug>``, installs independent ``node_modules`` and ``.nuxt`` (never symlinked), and writes the
git-ignored ``.env.worktree`` with free Nuxt and Odoo ports and a scratch
database name (written before the install, so a failed install keeps its ports;
``--resume`` continues it). Removing a worktree or branch needs the owner's
authorization and is deliberately not offered here.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import socket
import subprocess
import sys
from pathlib import Path

from git_policy import check_branch

NUXT_PORTS = range(3100, 3200)
ODOO_PORTS = range(8170, 8270)
DB_SLUG_MAX = 42
TAIL = 400
INSTALL = (
    ['npm', 'ci', '--ignore-scripts', '--prefer-offline'],
    ['npm', '-w', 'apps/web', 'run', 'postinstall'],
)


class WorktreeError(Exception):
    """A refused or failed step; the message is shown to the user."""


def clean_env(environ):
    """``environ`` without the npm variables a parent ``npm run`` sets.

    A nested ``npm ci`` that inherits ``npm_command=run``, ``npm_config_local_prefix`` and
    friends fails with exit 1 and no output, so ``npm run wt`` could not install dependencies.
    """
    return {k: v for k, v in environ.items() if not k.startswith('npm_') and k != 'INIT_CWD'}


def run(argv, cwd):
    """``(returncode, combined output)``; a missing program is code 127."""
    try:
        result = subprocess.run(
            argv, cwd=cwd, check=False, text=True, capture_output=True, env=clean_env(os.environ))
    except OSError as exc:
        return 127, 'cannot run %s: %s' % (argv[0], exc)
    return result.returncode, result.stdout + result.stderr


def sh(argv, cwd):
    code, output = run(argv, cwd)
    if code:
        message = '%s failed (exit %d): %s' % (' '.join(argv[:3]), code, output.strip()[-TAIL:])
        raise WorktreeError(message)
    return output.strip()


def repo_root():
    """The main checkout, found from the shared git dir so any worktree works."""
    common = sh(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], Path(__file__).resolve().parent)
    common_dir = Path(common)
    if not common_dir.is_dir() or common_dir.name != '.git':
        message = 'cannot find the main checkout: git common dir %s is not a .git directory' % common
        raise WorktreeError(message)
    return common_dir.parent


def database_name(suffix):
    slug = re.sub(r'[^a-z0-9]+', '_', suffix.lower()).strip('_')
    if len(slug) > DB_SLUG_MAX:
        digest = hashlib.sha1(slug.encode('utf-8')).hexdigest()[:6]
        slug = slug[:DB_SLUG_MAX - 7].rstrip('_') + '_' + digest
    return 'nasq_scratch_' + slug


def pick_port(candidates, used, is_free):
    for port in candidates:
        if port not in used and is_free(port):
            return port
    message = 'no free port in %d-%d' % (candidates[0], candidates[-1])
    raise WorktreeError(message)


def env_content(nuxt_port, odoo_port, database):
    return (
        '# Per-worktree dev settings; git-ignored. Start Odoo with --http-port=$ODOO_HTTP_PORT, an explicit\n'
        '# --addons-path and this scratch database, then Nuxt with --port $NUXT_PORT.\n'
        'NUXT_PORT=%d\nODOO_HTTP_PORT=%d\n'
        'NUXT_ODOO_URL=http://127.0.0.1:%d\nNUXT_ODOO_DB=%s\n'
        'NUXT_PUBLIC_WS_URL=ws://localhost:%d/websocket\n'
    ) % (nuxt_port, odoo_port, odoo_port, database, odoo_port)


def env_ports(env):
    """Ports named in one ``.env.worktree`` file; nothing when it is missing."""
    if not env.is_file():
        return set()
    text = env.read_text(encoding='utf-8')
    return {int(m.group(1)) for m in re.finditer(r'^(?:NUXT_PORT|ODOO_HTTP_PORT)=(\d+)$', text, re.MULTILINE)}


def parse_worktrees(porcelain):
    """``[(path, branch ref or None)]`` from ``git worktree list --porcelain``."""
    entries = []
    for block in porcelain.strip().split('\n\n'):
        path, branch = None, None
        for line in block.splitlines():
            if line.startswith('worktree '):
                path = line[len('worktree '):]
            elif line.startswith('branch '):
                branch = line[len('branch '):]
        if path:
            entries.append((path, branch))
    return entries


def used_ports(worktrees_dir, worktree_paths=()):
    used = set()
    for env in worktrees_dir.glob('*/.env.worktree'):
        used |= env_ports(env)
    for path in worktree_paths:
        used |= env_ports(Path(path) / '.env.worktree')
    return used


def port_is_free(port):
    for family, host in ((socket.AF_INET, '127.0.0.1'), (socket.AF_INET6, '::1')):
        try:
            sock = socket.socket(family)
        except OSError:
            continue  # no IPv6 on this host
        with sock:
            sock.settimeout(1)
            if sock.connect_ex((host, port)) == 0:
                return False
    return True


def install_dependencies(path):
    recovery = 'cd %s && npm ci --ignore-scripts && npm -w apps/web run postinstall' % path
    for argv in INSTALL:
        code, output = run(argv, path)
        if code:
            message = '%s failed (exit %d): %s\nrecover with: %s' % (' '.join(argv[:3]), code, output.strip()[-TAIL:], recovery)
            raise WorktreeError(message)


def create(suffix, base, install, resume=False):
    branch = 'codex/' + suffix
    problem = check_branch(branch)
    if problem:
        raise WorktreeError(problem)
    root = repo_root()
    path = root / '.worktrees' / suffix
    entries = parse_worktrees(sh(['git', 'worktree', 'list', '--porcelain'], root))
    registered = any(Path(p).resolve() == path.resolve() and ref == 'refs/heads/' + branch for p, ref in entries)
    if path.exists():
        if not (resume and registered):
            message = '%s already exists' % path
            raise WorktreeError(message)
    else:
        sh(['git', 'worktree', 'add', str(path), '-b', branch, base], root)
    env = path / '.env.worktree'
    if not env.exists():
        used = used_ports(root / '.worktrees', [p for p, _ in entries])
        nuxt = pick_port(NUXT_PORTS, used, port_is_free)
        odoo = pick_port(ODOO_PORTS, used | {nuxt}, port_is_free)
        env.write_text(env_content(nuxt, odoo, database_name(suffix)), encoding='utf-8')
    if install and not (path / 'node_modules').is_dir():
        install_dependencies(path)
    values = dict(re.findall(r'^(NUXT_PORT|ODOO_HTTP_PORT)=(\d+)$', env.read_text(encoding='utf-8'), re.MULTILINE))
    return path, branch, int(values['NUXT_PORT']), int(values['ODOO_HTTP_PORT'])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    new = sub.add_parser('new')
    new.add_argument('name', help='<area>-<slug>, e.g. pmo-task-filters')
    new.add_argument('--base', default='main')
    new.add_argument('--no-install', action='store_true')
    new.add_argument('--resume', action='store_true', help='continue a worktree whose creation failed part way')
    args = parser.parse_args(argv)
    path, branch, nuxt, odoo = create(args.name, args.base, not args.no_install, args.resume)
    sys.stdout.write('worktree %s on %s\nNuxt port %d, Odoo port %d, see %s/.env.worktree\n' % (path, branch, nuxt, odoo, path))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except WorktreeError as exc:
        sys.stderr.write('wt: %s\n' % exc)
        sys.exit(2)
