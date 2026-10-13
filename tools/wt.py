# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Create a task worktree with its own dependencies, ports and scratch DB name.

    python3 -B tools/wt.py new <area>-<slug> [--base main] [--no-install]

Creates ``.worktrees/<area>-<slug>`` on branch ``codex/<area>-<slug>``, installs
independent ``node_modules`` and ``.nuxt`` (never symlinked), and writes the
git-ignored ``.env.worktree`` with free Nuxt and Odoo ports and a scratch
database name. Removing a worktree or branch needs the owner's authorization
and is deliberately not offered here.
"""
from __future__ import annotations

import argparse
import re
import socket
import subprocess
import sys
from pathlib import Path

from git_policy import check_branch

REPO = Path(__file__).resolve().parents[1]
WORKTREES = REPO / '.worktrees'
NUXT_PORTS = range(3100, 3200)
ODOO_PORTS = range(8170, 8270)
DB_SLUG_MAX = 42


class WorktreeError(Exception):
    """A refused or failed step; the message is shown to the user."""


def database_name(suffix):
    slug = re.sub(r'[^a-z0-9]+', '_', suffix.lower()).strip('_')[:DB_SLUG_MAX].rstrip('_')
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


def used_ports(worktrees_dir):
    used = set()
    for env in worktrees_dir.glob('*/.env.worktree'):
        for match in re.finditer(r'^(?:NUXT_PORT|ODOO_HTTP_PORT)=(\d+)$', env.read_text(encoding='utf-8'), re.MULTILINE):
            used.add(int(match.group(1)))
    return used


def port_is_free(port):
    with socket.socket() as sock:
        return sock.connect_ex(('127.0.0.1', port)) != 0


def sh(argv, cwd):
    result = subprocess.run(argv, cwd=cwd, check=False, text=True, capture_output=True)
    if result.returncode:
        message = '%s failed: %s' % (' '.join(argv[:3]), (result.stderr or result.stdout).strip()[-400:])
        raise WorktreeError(message)
    return result.stdout.strip()


def create(suffix, base, install):
    branch = 'codex/' + suffix
    problem = check_branch(branch)
    if problem or branch in ('codex/', 'main'):
        raise WorktreeError(problem or 'invalid name')
    path = WORKTREES / suffix
    if path.exists():
        message = '%s already exists' % path
        raise WorktreeError(message)
    sh(['git', 'worktree', 'add', str(path), '-b', branch, base], REPO)
    if install:
        sh(['npm', 'ci', '--ignore-scripts', '--prefer-offline'], path)
        sh(['npm', '-w', 'apps/web', 'run', 'postinstall'], path)
    used = used_ports(WORKTREES)
    nuxt = pick_port(NUXT_PORTS, used, port_is_free)
    odoo = pick_port(ODOO_PORTS, used, port_is_free)
    (path / '.env.worktree').write_text(env_content(nuxt, odoo, database_name(suffix)), encoding='utf-8')
    return path, branch, nuxt, odoo


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    new = sub.add_parser('new')
    new.add_argument('name', help='<area>-<slug>, e.g. pmo-task-filters')
    new.add_argument('--base', default='main')
    new.add_argument('--no-install', action='store_true')
    args = parser.parse_args(argv)
    path, branch, nuxt, odoo = create(args.name, args.base, not args.no_install)
    sys.stdout.write('worktree %s on %s\nNuxt port %d, Odoo port %d, see %s/.env.worktree\n' % (path, branch, nuxt, odoo, path))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except WorktreeError as exc:
        sys.stderr.write('wt: %s\n' % exc)
        sys.exit(2)
