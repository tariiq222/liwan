# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Create, list and clean up task worktrees.

    python3 -B tools/wt.py new <area>-<slug> [--base main] [--no-install] [--resume]
    python3 -B tools/wt.py status
    python3 -B tools/wt.py gc [--apply]

``new`` creates ``.worktrees/<area>-<slug>``, the only location for task worktrees, under the main
checkout (also when run from a worktree) on branch ``codex/<area>-<slug>``, installs independent ``node_modules`` and ``.nuxt`` (never symlinked), and writes the
git-ignored ``.env.worktree`` with free Nuxt and Odoo ports and a scratch
database name (written before the install, so a failed install keeps its ports;
``--resume`` continues it).

``status`` prints one table of every worktree, wherever it lives (``*`` marks one outside
``.worktrees``; ``missing`` one whose folder is gone). ``gc`` lists the worktrees and branches that are
merged into main with commits of their own, clean and held by no process, plus the scratch databases
of those worktrees nobody is connected to; it only prints unless ``--apply`` is given, which needs the
owner's authorization. Unmerged, dirty, current, in-use and missing worktrees and databases it cannot
tie to a worktree (``nasq_scratch_e2e``, hand-named ones) are never touched.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import NamedTuple

from git_policy import check_branch
from odoo_test import GC_DB

NUXT_PORTS = range(3100, 3200)
ODOO_PORTS = range(8170, 8270)
DB_SLUG_MAX = 42
TAIL = 400
MAIN = 'main'
E2E_DATABASE = 'nasq_scratch_e2e'  # SCRATCH_DB in tools/e2e_isolated.mjs, a fixed database no worktree owns
SCRATCH_PREFIX = 'nasq_scratch_'
WORKTREES_DIR = '.worktrees'
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
    path = root / WORKTREES_DIR / suffix
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
        used = used_ports(root / WORKTREES_DIR, [p for p, _ in entries])
        nuxt = pick_port(NUXT_PORTS, used, port_is_free)
        odoo = pick_port(ODOO_PORTS, used | {nuxt}, port_is_free)
        env.write_text(env_content(nuxt, odoo, database_name(suffix)), encoding='utf-8')
    if install and not (path / 'node_modules').is_dir():
        install_dependencies(path)
    values = dict(re.findall(r'^(NUXT_PORT|ODOO_HTTP_PORT)=(\d+)$', env.read_text(encoding='utf-8'), re.MULTILINE))
    return path, branch, int(values['NUXT_PORT']), int(values['ODOO_HTTP_PORT'])


class Worktree(NamedTuple):
    path: Path
    branch: str | None
    is_main: bool
    canonical: bool
    ahead: int
    behind: int
    merged: bool
    dirty: bool
    age_days: int
    size: int | None
    database: str | None
    ports: list
    missing: bool = False
    own_commits: bool = True


AGE_UNITS = ((365, 'y'), (30, 'mo'), (1, 'd'))


def env_values(path):
    """``{KEY: value}`` of a worktree's ``.env.worktree``; empty when it is missing."""
    env = Path(path) / '.env.worktree'
    if not env.is_file():
        return {}
    return dict(re.findall(r'^([A-Z_]+)=(.*)$', env.read_text(encoding='utf-8'), re.MULTILINE))


def format_age(days):
    for size, unit in AGE_UNITS:
        if days >= size:
            return '%d%s' % (days // size, unit)
    return 'today'


def format_size(kilobytes):
    if kilobytes is None:
        return '-'
    return '%.1fG' % (kilobytes / 1048576) if kilobytes >= 1048576 else '%dM' % (kilobytes // 1024)


def dir_size_kb(path):
    if not path.is_dir():
        return None
    code, output = run(['du', '-sk', str(path)], path.parent)
    return int(output.split()[0]) if code == 0 and output.split() else None


def missing_worktree(root, path, ref):
    """A registered worktree whose folder is gone; its scratch database name follows from the branch."""
    branch = ref[len('refs/heads/'):] if ref else None
    suffix = branch[len('codex/'):] if branch and branch.startswith('codex/') else None
    return Worktree(
        path=path, branch=branch, is_main=False, canonical=(root / WORKTREES_DIR) in path.parents, ahead=0, behind=0,
        merged=False, dirty=False, age_days=0, size=None, database=database_name(suffix) if suffix else None,
        ports=[], missing=True)


def inspect_worktree(root, path, ref, now=None):
    """Everything ``status`` and ``gc`` need to know about one registered worktree."""
    now = time.time() if now is None else now
    wt_path = Path(path)
    if not wt_path.is_dir():
        return missing_worktree(root, wt_path, ref)
    head = sh(['git', 'rev-parse', 'HEAD'], wt_path)
    behind, ahead = map(int, sh(['git', 'rev-list', '--left-right', '--count', '%s...%s' % (MAIN, head)], root).split())
    merged = run(['git', 'merge-base', '--is-ancestor', head, MAIN], root)[0] == 0
    own_commits = head not in sh(['git', 'rev-list', '--first-parent', MAIN], root).split()
    dirty = bool(sh(['git', 'status', '--porcelain'], wt_path))
    commit_time = int(sh(['git', 'log', '-1', '--format=%ct'], wt_path))
    env = env_values(wt_path)
    ports = [int(env[k]) for k in ('NUXT_PORT', 'ODOO_HTTP_PORT') if k in env]
    return Worktree(
        path=wt_path, branch=ref[len('refs/heads/'):] if ref else None, is_main=wt_path.resolve() == root.resolve(),
        canonical=(root / WORKTREES_DIR) in wt_path.resolve().parents or wt_path.resolve() == root.resolve(),
        ahead=ahead, behind=behind, merged=merged, dirty=dirty, age_days=max(0, int((now - commit_time) // 86400)),
        size=dir_size_kb(wt_path / 'node_modules'), database=env.get('NUXT_ODOO_DB'), ports=ports,
        own_commits=own_commits)


def inspect_all(root):
    entries = parse_worktrees(sh(['git', 'worktree', 'list', '--porcelain'], root))
    return [inspect_worktree(root, path, ref) for path, ref in entries]


def format_status(worktrees, root):
    header = ('WORKTREE', 'BRANCH', 'AHEAD/BEHIND', 'MERGED', 'DIRTY', 'AGE', 'NODE_MODULES', 'SCRATCH DB', 'PORTS')
    rows = [header]
    for w in worktrees:
        if w.missing:
            rows.append((str(w.path) + ('' if w.canonical else ' *'), w.branch or '(detached)', 'missing', '-', '-', '-', '-', w.database or '-', '-'))
            continue
        name = '.' if w.is_main else str(w.path.resolve().relative_to(root)) if w.canonical else str(w.path)
        rows.append((
            name + ('' if w.canonical else ' *'), w.branch or '(detached)',
            '+%d/-%d' % (w.ahead, w.behind), 'yes' if w.merged else 'no', 'yes' if w.dirty else 'no',
            format_age(w.age_days), format_size(w.size), w.database or '-', ','.join(map(str, w.ports)) or '-'))
    widths = [max(len(row[i]) for row in rows) for i in range(len(header))]
    lines = ['  '.join(cell.ljust(width) for cell, width in zip(row, widths)).rstrip() for row in rows]
    others = [w for w in worktrees if not w.is_main]
    summary = '%d worktrees: %d merged, %d dirty, %d outside %s (*)' % (
        len(others), sum(w.merged for w in others), sum(w.dirty for w in others),
        sum(not w.canonical for w in others), WORKTREES_DIR)
    missing = sum(w.missing for w in others)
    if missing:
        summary += ', %d folder missing (git worktree prune)' % missing
    return '\n'.join(lines + ['', summary])


def busy_paths():
    """Directories that are the working directory of some running process."""
    code, output = run(['lsof', '-a', '-d', 'cwd', '-Fn'], Path.cwd())
    if code not in (0, 1):
        message = 'cannot tell which worktrees are in use: lsof failed (exit %d): %s' % (code, output.strip()[-TAIL:])
        raise WorktreeError(message)
    return {Path(line[1:]) for line in output.splitlines() if line.startswith('n')}


def inside(path, folder):
    """Whether ``path`` is ``folder`` or lies below it."""
    return path == folder or folder in path.parents


def in_use(worktree, busy):
    return any(inside(p, worktree.path.resolve()) for p in busy)


def removable(worktrees, busy, current):
    """Merged, clean worktrees with commits of their own that no process holds; never main or the current one."""
    return [
        w for w in worktrees
        if w.branch and not w.is_main and not w.missing and w.merged and w.own_commits and not w.dirty
        and not inside(current.resolve(), w.path.resolve()) and not in_use(w, busy)]


def scratch_databases():
    """``{name: open connections}`` for every scratch database."""
    if not shutil.which('psql'):
        message = 'cannot list scratch databases: psql is not installed'
        raise WorktreeError(message)
    query = 'select d.datname, coalesce(s.numbackends, 0) from pg_database d left join pg_stat_database s using (datname)'
    code, output = run(['psql', '-XAtq', '-F', '|', '-c', query, 'postgres'], Path.cwd())
    if code:
        message = 'cannot list scratch databases: psql failed (exit %d): %s' % (code, output.strip()[-TAIL:])
        raise WorktreeError(message)
    pairs = (line.rsplit('|', 1) for line in output.splitlines() if '|' in line)
    return {name: int(count) for name, count in pairs if name.startswith(SCRATCH_PREFIX)}


def abandoned_databases(owners, survivors):
    """Scratch databases of worktrees going away that no remaining worktree names and nobody is connected to."""
    wanted = {w.database for w in owners if w.database} - {w.database for w in survivors} - {E2E_DATABASE}
    if not wanted:
        return []
    databases = scratch_databases()
    return sorted(n for n in wanted if databases.get(n) == 0 and not GC_DB.fullmatch(n))


def try_each(steps):
    """Run ``(label, argv)`` steps in order; ``(done labels, failure messages)``, a failing step does not stop the rest."""
    done, failures = [], []
    for label, argv, cwd in steps:
        try:
            sh(argv, cwd)
            done.append(label)
        except WorktreeError as exc:
            failures.append('%s: %s' % (label, exc))
    return done, failures


def apply_gc(root, victims, databases):
    if sh(['git', 'branch', '--show-current'], root) != MAIN:
        message = 'the main checkout %s is not on %s; refusing to delete branches' % (root, MAIN)
        raise WorktreeError(message)
    failures, kept = [], set()
    for w in victims:
        done, failed = try_each([('worktree %s' % w.path, ['git', 'worktree', 'remove', str(w.path)], root)])
        failures += failed
        if done:
            failures += try_each([('branch %s' % w.branch, ['git', 'branch', '-d', w.branch], root)])[1]
        else:
            kept.add(w.database)
    for name in sorted(set(databases) - kept):
        failures += try_each([('database %s' % name, ['dropdb', '--if-exists', name], root)])[1]
    return failures


def gc(root, apply, current):
    worktrees = inspect_all(root)
    victims = removable(worktrees, busy_paths(), current)
    survivors = [w for w in worktrees if w not in victims]
    databases = abandoned_databases([w for w in worktrees if w.missing] + victims, survivors)
    lines = ['%s worktree %s (branch %s)' % ('removing' if apply else 'would remove', w.path, w.branch) for w in victims]
    lines += ['%s database %s' % ('dropping' if apply else 'would drop', name) for name in databases]
    lines += ['skipped: folder missing for %s (run git worktree prune)' % w.path for w in worktrees if w.missing]
    if not victims and not databases:
        return '\n'.join(lines + ['nothing to clean'])
    if not apply:
        lines.append('removing a worktree also deletes its ignored files (.env.worktree, .nuxt, node_modules)')
        lines.append('dry run; repeat with --apply to do it')
        return '\n'.join(lines)
    failures = apply_gc(root, victims, databases)
    if failures:
        raise WorktreeError('\n'.join(lines + ['failed:'] + failures))
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    new = sub.add_parser('new')
    new.add_argument('name', help='<area>-<slug>, e.g. pmo-task-filters')
    new.add_argument('--base', default='main')
    new.add_argument('--no-install', action='store_true')
    new.add_argument('--resume', action='store_true', help='continue a worktree whose creation failed part way')
    sub.add_parser('status')
    collect = sub.add_parser('gc')
    collect.add_argument('--apply', action='store_true', help='remove what is listed (needs the owner\'s authorization)')
    args = parser.parse_args(argv)
    if args.command == 'status':
        root = repo_root()
        sys.stdout.write(format_status(inspect_all(root), root) + '\n')
        return 0
    if args.command == 'gc':
        sys.stdout.write(gc(repo_root(), args.apply, Path.cwd()) + '\n')
        return 0
    path, branch, nuxt, odoo = create(args.name, args.base, not args.no_install, args.resume)
    sys.stdout.write('worktree %s on %s\nNuxt port %d, Odoo port %d, see %s/.env.worktree\n' % (path, branch, nuxt, odoo, path))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except WorktreeError as exc:
        sys.stderr.write('wt: %s\n' % exc)
        sys.exit(2)
