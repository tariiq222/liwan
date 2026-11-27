# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Run the lane pool: add, lock, take and return lanes, check and list worktrees, clean up leftovers.

    npm run wt -- lane add <name> [--holder <who> --orchestrator <id> --task <what>] [--no-install]
    npm run wt -- lane lock <name>
    npm run wt -- lane remove <name>
    npm run wt -- take <branch> --holder <who> --orchestrator <id> [--task <what>] [--lane <name>]
    npm run wt -- done [--lane <name>] [--park]
    npm run wt -- done --orchestrator <id> [--park]
    npm run wt -- status
    npm run wt -- check
    npm run wt -- gc [--apply] [--branch <branch>]

A lane is a permanent worktree at ``.worktrees/<name>`` (see ``tools/worktree_lanes.py``): one task is one branch and one
lane, taken by its orchestrator for the workers. Between tasks a lane rests on a detached ``origin/main``. Every lane is a
locked worktree: ``gh pr merge --delete-branch`` removes a linked worktree that has the head branch checked out (gh 2.106
runs ``git worktree remove -- <path>``) before it deletes the branches, which took pool lanes instead of returning them, and
that removal fails on a locked worktree. ``lane add`` and ``take`` lock the lane, ``lane lock`` locks one that exists,
``done`` leaves the lock on, and ``lane remove`` unlocks first. ``lane add`` creates a lane
(a worktree at ``origin/main`` with its ``.env.worktree``, free ports, scratch database name and dependencies) or adopts
an existing worktree under ``.worktrees/`` in place; adopting a worktree that is on a branch needs ``--holder``,
``--orchestrator`` and ``--task`` and drops its record files of the removed claim model. ``take`` gives a branch to the first resting clean lane
(or the one named by ``--lane``): it starts the branch from ``origin/main`` without upstream, or resumes a parked local
branch, records the holder and task, and reinstalls dependencies when ``package-lock.json`` changed since the last
install. It refuses ``main``, an occupied or dirty lane, and says "no free lane" with each lane's holder when all are taken.
``done`` returns a clean lane (the current one, or ``--lane``) to a detached ``origin/main`` once its branch is merged
and deletes the branch; ``--park`` keeps the unmerged branch so a later ``take`` of the same name resumes it.
``done --orchestrator <id>`` does the same for every lane that orchestrator took, keeps going past a lane it must
refuse (dirty, unmerged), prints the reason for each lane left and exits 1 when any remained.

``status`` prints one table of every worktree (``*`` marks one outside ``.worktrees``; ``missing`` one whose folder is
gone) with its holder, the files two occupied lanes both change, and the violations. ``check`` only reads and exits 1
when a worktree is neither the main checkout nor a lane, a lane is not locked, a lane's checked-out branch differs from
its record, an occupied lane has no holder or no orchestrator, or two lanes change the same addon's ``migrations/``. ``gc`` lists the leftover
non-lane worktrees and branches that are merged into main with commits of their own, clean and held by no process,
plus the scratch databases of those worktrees nobody is connected to; it only prints unless ``--apply`` is given,
which needs the owner's authorization. A lane is never removed by ``gc``; ``lane remove`` deletes a resting
clean lane that nothing uses, with its worktree and scratch database. ``--branch`` limits ``gc`` to that one branch's
worktree and scratch database, says why a worktree it names is kept, and deletes the local branch when it has no
worktree and is merged into main.
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
from worktree_lanes import (
    MAIN,
    WORKTREES_DIR,
    LaneError,
    Take,
    lane_name_of,
    pool_lock,
    read_take,
    resting,
    validate_name,
    write_take,
)

# Vendor administration owns 3100 and its live-proof build owns 3103, even while idle.
NUXT_PORTS = tuple(port for port in range(3100, 3200) if port not in {3100, 3103})
ODOO_PORTS = range(8170, 8270)
DB_SLUG_MAX = 42
TAIL = 400
E2E_DATABASE = 'liwan_scratch_e2e'  # SCRATCH_DB in tools/e2e_isolated.mjs, a fixed database no worktree owns
SCRATCH_PREFIX = 'liwan_scratch_'
LANE_BASE = 'origin/main'
LOCK_FILE = 'package-lock.json'
REMOVED_RECORDS = ('liwan-lane.json', 'liwan-claim.json')  # record files of the removed fixed-lane and claim model
GIT_DIR = '.git'  # the main checkout's git directory, shared by every worktree
LANE_LOCK_REASON = 'LiwanOS lane pool; return it with npm run wt -- done instead of removing it'  # shown by git when a removal is refused
MIGRATIONS = re.compile(r'odoo-addons/([^/]+)/migrations/')
INSTALL = (
    ['npm', 'ci', '--ignore-scripts', '--prefer-offline'],
    ['npm', '-w', 'apps/web', 'run', 'postinstall'],
)


class WorktreeError(Exception):
    """A refused or failed step; the message is shown to the user."""


class WorktreeKept(WorktreeError):
    """``gc --branch`` found the named worktree but must keep it; the message says why."""


class LaneInfo(NamedTuple):
    name: str
    path: Path
    take: Take
    locked: bool


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
    if not common_dir.is_dir() or common_dir.name != GIT_DIR:
        message = 'cannot find the main checkout: git common dir %s is not a .git directory' % common
        raise WorktreeError(message)
    return common_dir.parent


def database_name(suffix):
    slug = re.sub(r'[^a-z0-9]+', '_', suffix.lower()).strip('_')
    if len(slug) > DB_SLUG_MAX:
        digest = hashlib.sha1(slug.encode('utf-8')).hexdigest()[:6]
        slug = slug[:DB_SLUG_MAX - 7].rstrip('_') + '_' + digest
    return 'liwan_scratch_' + slug


def pick_port(candidates, used, is_free):
    for port in candidates:
        if port not in used and is_free(port):
            return port
    message = 'no free port in %d-%d' % (candidates[0], candidates[-1])
    raise WorktreeError(message)


def env_content(nuxt_port, odoo_port, database):
    return (
        '# Per-worktree dev settings; git-ignored. Start Odoo with --http-port=$ODOO_HTTP_PORT, an explicit\n'
        '# --addons-path and this scratch database, then Nuxt with --port $NUXT_PORT. Append the pinned OCA\n'
        '# addons (shared by all worktrees, see docs/oca-addons.md): python3 -B tools/oca_addons.py fetch | path.\n'
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


class WorktreeEntry(NamedTuple):
    path: str
    branch: str | None  # the checked-out ref, or None on a detached HEAD
    locked: bool


def parse_worktrees(porcelain):
    """``[WorktreeEntry]`` from ``git worktree list --porcelain``; a ``locked`` line may or may not carry a reason."""
    entries = []
    for block in porcelain.strip().split('\n\n'):
        path, branch, locked = None, None, False
        for line in block.splitlines():
            if line.startswith('worktree '):
                path = line[len('worktree '):]
            elif line.startswith('branch '):
                branch = line[len('branch '):]
            elif line == 'locked' or line.startswith('locked '):
                locked = True
        if path:
            entries.append(WorktreeEntry(path, branch, locked))
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


def git_dir(path):
    """The worktree's own git directory (``.git/worktrees/<id>``, or ``.git`` for the main checkout)."""
    return Path(sh(['git', 'rev-parse', '--absolute-git-dir'], path))


def lock_worktree(path, locked, root):
    """Lock the worktree at ``path`` with the lane reason, unless ``locked`` (read from the worktree listing) says it is.

    ``git worktree lock`` fails on a worktree that is already locked, so the state is read first.
    """
    if not locked:
        sh(['git', 'worktree', 'lock', '--reason', LANE_LOCK_REASON, str(path)], root)


def worktree_removal(path, locked):
    """``[(label, argv)]`` steps that remove the worktree at ``path``: ``git worktree remove`` refuses a locked one, so it is unlocked first."""
    steps = [('unlock %s' % path, ['git', 'worktree', 'unlock', str(path)])] if locked else []
    return steps + [('worktree %s' % path, ['git', 'worktree', 'remove', str(path)])]


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
    take: Take | None = None  # the lane record; set only for a lane
    locked: bool = False  # the worktree is locked, so git refuses to remove it

    @property
    def is_lane(self):
        return self.take is not None


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


def changed_paths(path):
    """Workspace-relative paths ``git status`` reports in the worktree at ``path``."""
    output = run(['git', 'status', '--porcelain', '-z', '--untracked-files=all'], path)
    if output[0]:
        message = 'git status failed in %s: %s' % (path, output[1].strip()[-TAIL:])
        raise WorktreeError(message)
    entries = output[1].split('\0')
    paths, index = [], 0
    while index < len(entries):
        entry = entries[index]
        if len(entry) > 3:
            paths.append(entry[3:])
            if entry[0] in 'RC':
                index += 1  # a rename or copy is followed by its source path
        index += 1
    return paths


def missing_worktree(root, path, ref):
    """A registered worktree whose folder is gone; a lane-folder one keeps the scratch database its name gives."""
    canonical = (root / WORKTREES_DIR) in path.parents
    return Worktree(
        path=path, branch=ref[len('refs/heads/'):] if ref else None, is_main=False, canonical=canonical, ahead=0, behind=0,
        merged=False, dirty=False, age_days=0, size=None, database=database_name(path.name) if canonical else None,
        ports=[], missing=True)


def load_take(path):
    try:
        return read_take(git_dir(path))
    except LaneError as error:
        raise WorktreeError(str(error)) from error


def inspect_worktree(root, path, ref, now=None, sizes=True, locked=False):
    """Everything ``status``, ``check`` and ``gc`` need to know about one registered worktree."""
    now = time.time() if now is None else now
    wt_path = Path(path)
    if not wt_path.is_dir():
        return missing_worktree(root, wt_path, ref)
    head = sh(['git', 'rev-parse', 'HEAD'], wt_path)
    behind, ahead = map(int, sh(['git', 'rev-list', '--left-right', '--count', '%s...%s' % (MAIN, head)], root).split())
    merged = run(['git', 'merge-base', '--is-ancestor', head, MAIN], root)[0] == 0
    own_commits = head not in sh(['git', 'rev-list', '--first-parent', MAIN], root).split()
    changed = changed_paths(wt_path)
    commit_time = int(sh(['git', 'log', '-1', '--format=%ct'], wt_path))
    env = env_values(wt_path)
    ports = [int(env[k]) for k in ('NUXT_PORT', 'ODOO_HTTP_PORT') if k in env]
    is_main = wt_path.resolve() == root.resolve()
    canonical = (root / WORKTREES_DIR) in wt_path.resolve().parents or is_main
    return Worktree(
        path=wt_path, branch=ref[len('refs/heads/'):] if ref else None, is_main=is_main, canonical=canonical,
        ahead=ahead, behind=behind, merged=merged, dirty=bool(changed), age_days=max(0, int((now - commit_time) // 86400)),
        size=dir_size_kb(wt_path / 'node_modules') if sizes else None, database=env.get('NUXT_ODOO_DB'), ports=ports,
        own_commits=own_commits, take=load_take(wt_path) if lane_name_of(root, wt_path) else None, locked=locked)


def inspect_all(root, sizes=True):
    entries = parse_worktrees(sh(['git', 'worktree', 'list', '--porcelain'], root))
    return [inspect_worktree(root, entry.path, entry.branch, sizes=sizes, locked=entry.locked) for entry in entries]


def lane_changes(worktrees):
    """``{lane name: paths}`` each occupied lane changes: committed since the merge base with origin/main, edited or untracked."""
    changes = {}
    for w in worktrees:
        if w.is_lane and w.take.occupied and not w.missing:
            committed = sh(['git', 'diff', '--name-only', '--no-renames', '-z', LANE_BASE + '...HEAD'], w.path).split('\0')
            changes[w.path.name] = frozenset(path for path in committed if path) | frozenset(changed_paths(w.path))
    return changes


def shared_files(changes):
    """``[(first lane, second lane, paths)]`` for every pair of lanes that change a common path."""
    names = sorted(changes)
    return [
        (first, second, sorted(changes[first] & changes[second]))
        for index, first in enumerate(names) for second in names[index + 1:] if changes[first] & changes[second]]


def migration_addons(paths):
    return {match.group(1) for match in map(MIGRATIONS.match, paths) if match}


def lane_violations(worktree):
    """Problems of one lane: the checked-out branch differs from the record, an occupied lane has no holder, or the lane is not locked."""
    take = worktree.take
    problems = []
    if (worktree.branch or '') != (take.branch or ''):
        template = 'lane %s but %s is checked out; another session moved it, return with: git switch %s'
        state = 'holds %s' % take.branch if take.occupied else 'rests'
        problems.append(template % (state, worktree.branch or 'a detached HEAD', take.branch or '--detach ' + LANE_BASE))
    if take.occupied and not (take.holder or '').strip():
        problems.append('occupied lane has no holder; record one with: npm run wt -- done --park, then take it again')
    if take.occupied and not (take.orchestrator or '').strip():
        problems.append('occupied lane has no orchestrator; record one with: npm run wt -- done --park, then take it again')
    if not worktree.locked:
        problems.append('lane is not locked, so a tool can remove it; lock it with: npm run wt -- lane lock %s' % worktree.path.name)
    return problems


def non_lane_violation(worktree):
    if worktree.missing:
        return 'folder is missing (git worktree prune)'
    if not worktree.canonical:
        return 'outside %s/ and not a lane; remove it with: git worktree remove' % WORKTREES_DIR
    return 'not a lane; adopt it with: npm run wt -- lane add %s --holder <who> --orchestrator <id> --task <what>, or remove it once merged' % worktree.path.name


def violations(worktrees, changes):
    """``[(worktree, problem)]`` for every rule a worktree breaks; the main checkout is not checked."""
    others = [w for w in worktrees if not w.is_main]
    found = []
    for w in others:
        found += [(w, problem) for problem in (lane_violations(w) if w.is_lane and not w.missing else [])]
        if not w.is_lane:
            found.append((w, non_lane_violation(w)))
    by_name = {w.path.name: w for w in others}
    addons = {name: migration_addons(paths) for name, paths in changes.items()}
    names = sorted(addons)
    for index, first in enumerate(names):
        for second in names[index + 1:]:
            for addon in sorted(addons[first] & addons[second]):
                template = 'lane %s and lane %s both change odoo-addons/%s/migrations/'
                found.append((by_name[first], template % (first, second, addon)))
    return found


def format_violations(found, root):
    if not found:
        return 'no rule violations'
    lines = ['%d rule violations (reported only; nothing was moved, renamed or removed):' % len(found)]
    lines += ['  %s: %s' % (display_name(w, root), problem) for w, problem in found]
    return '\n'.join(lines)


def format_shared(changes):
    shared = shared_files(changes)
    if not shared:
        return 'shared files: none'
    lines = ['shared files (changed in two lanes at once, reported only):']
    lines += ['  %s and %s: %s' % (first, second, ', '.join(paths)) for first, second, paths in shared]
    return '\n'.join(lines)


def holder_label(worktree):
    if not worktree.is_lane or worktree.missing:
        return '-'
    return (worktree.take.holder or '(no holder)') if worktree.take.occupied else 'resting'


def orchestrator_label(worktree):
    if not worktree.is_lane or worktree.missing or not worktree.take.occupied:
        return '-'
    return worktree.take.orchestrator or '(no orchestrator)'


def format_status(worktrees, root, changes):
    header = (
        'WORKTREE', 'BRANCH', 'ORCHESTRATOR', 'HOLDER', 'AHEAD/BEHIND', 'MERGED', 'DIRTY', 'AGE', 'NODE_MODULES', 'SCRATCH DB', 'PORTS')
    rows = []
    for w in sorted(worktrees, key=lambda item: (orchestrator_label(item) == '-', orchestrator_label(item))):
        name = display_name(w, root) + ('' if w.canonical else ' *')
        if w.missing:
            rows.append((name, w.branch or '(detached)', '-', '-', 'missing', '-', '-', '-', '-', w.database or '-', '-'))
            continue
        rows.append((
            name, w.branch or '(detached)', orchestrator_label(w), holder_label(w),
            '+%d/-%d' % (w.ahead, w.behind), 'yes' if w.merged else 'no', 'yes' if w.dirty else 'no',
            format_age(w.age_days), format_size(w.size), w.database or '-', ','.join(map(str, w.ports)) or '-'))
    rows.insert(0, header)
    widths = [max(len(row[i]) for row in rows) for i in range(len(header))]
    lines = ['  '.join(cell.ljust(width) for cell, width in zip(row, widths)).rstrip() for row in rows]
    others = [w for w in worktrees if not w.is_main]
    summary = '%d worktrees: %d merged, %d dirty, %d outside %s (*)' % (
        len(others), sum(w.merged for w in others), sum(w.dirty for w in others),
        sum(not w.canonical for w in others), WORKTREES_DIR)
    missing = sum(w.missing for w in others)
    if missing:
        summary += ', %d folder missing (git worktree prune; unlock a locked lane first: git worktree unlock <path>)' % missing
    lanes = [w for w in others if w.is_lane]
    summary += '; %d lanes, %d occupied' % (len(lanes), sum(w.take.occupied for w in lanes))
    return '\n'.join(lines + ['', summary, '', format_shared(changes), '', format_violations(violations(worktrees, changes), root)])


def keep_reason(worktree, busy, current):
    """Why ``gc`` keeps this worktree, or ``None`` when it may be removed (never main or the current one)."""
    reasons = (
        (worktree.is_main, 'it is the main checkout'),
        (worktree.is_lane, 'it is a lane; a lane is never removed'),
        (worktree.missing, 'its folder is missing'),
        (not worktree.branch, 'it has no branch'),
        (not worktree.missing and inside(current.resolve(), worktree.path.resolve()),
         'it is the current directory; run this from the main checkout'),
        (worktree.dirty, 'it has uncommitted changes'),
        (not worktree.missing and in_use(worktree, busy), 'a process is running in it'),
        (not worktree.merged, 'its branch is not merged into %s' % MAIN),
        (not worktree.own_commits, 'its branch has no commits of its own'),
    )
    return next((text for failed, text in reasons if failed), None)


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
    """Merged, clean worktrees with commits of their own that no process holds."""
    return [w for w in worktrees if keep_reason(w, busy, current) is None]


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


def apply_gc(root, victims, databases, stale_branches=()):
    if sh(['git', 'branch', '--show-current'], root) != MAIN:
        message = 'the main checkout %s is not on %s; refusing to delete branches' % (root, MAIN)
        raise WorktreeError(message)
    failures, kept = [], set()
    for w in victims:
        done, failed = try_each([(label, argv, root) for label, argv in worktree_removal(w.path, w.locked)])
        failures += failed
        if done:
            failures += try_each([('branch %s' % w.branch, ['git', 'branch', '-d', w.branch], root)])[1]
        else:
            kept.add(w.database)
    for name in stale_branches:
        failures += try_each([('branch %s' % name, ['git', 'branch', '-d', name], root)])[1]
    for name in sorted(set(databases) - kept):
        failures += try_each([('database %s' % name, ['dropdb', '--if-exists', name], root)])[1]
    return failures


def merged_local_branch(root, branch):
    """Whether ``branch`` exists locally and is merged into main; a missing branch is not an error."""
    if run(['git', 'rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], root)[0]:
        return False
    return run(['git', 'merge-base', '--is-ancestor', 'refs/heads/' + branch, MAIN], root)[0] == 0


def gc(root, apply, current, branch=None):
    if branch is not None and (branch in ('main', 'HEAD') or check_branch(branch)):
        message = '--branch must be a local task branch'
        raise WorktreeError(message)
    worktrees = inspect_all(root)
    busy = busy_paths()
    victims = removable(worktrees, busy, current)
    scope = [w for w in worktrees if branch is None or w.branch == branch]
    victims = [w for w in victims if w in scope]
    survivors = [w for w in worktrees if w not in victims]
    databases = abandoned_databases([w for w in scope if w.missing] + victims, survivors)
    lines = ['%s worktree %s (branch %s)' % ('removing' if apply else 'would remove', w.path, w.branch) for w in victims]
    lines += ['%s database %s' % ('dropping' if apply else 'would drop', name) for name in databases]
    lines += ['skipped: folder missing for %s (run git worktree prune)' % w.path for w in scope if w.missing]
    stale_branches = []
    if branch:
        kept = [w for w in scope if not w.missing and w not in victims]
        lines += ['kept: worktree %s (branch %s): %s' % (w.path, w.branch, keep_reason(w, busy, current)) for w in kept]
        if kept:
            raise WorktreeKept('\n'.join(lines))
        if not scope and merged_local_branch(root, branch):
            stale_branches.append(branch)
            lines.append('%s branch %s' % ('deleting' if apply else 'would delete', branch))
    if not victims and not databases and not stale_branches:
        return '\n'.join(lines + ['nothing to clean'])
    if not apply:
        lines.append('removing a worktree also deletes its ignored files (.env.worktree, .nuxt, node_modules)')
        lines.append('dry run; repeat with --apply to do it')
        return '\n'.join(lines)
    failures = apply_gc(root, victims, databases, stale_branches)
    if failures:
        raise WorktreeError('\n'.join(lines + ['failed:'] + failures))
    return '\n'.join(lines)


def current_branch(path):
    return sh(['git', 'branch', '--show-current'], path)


def merged_into_base(path):
    return run(['git', 'merge-base', '--is-ancestor', 'HEAD', LANE_BASE], path)[0] == 0


def require_clean(path):
    if changed_paths(path):
        message = 'lane %s has uncommitted changes; commit or discard them first' % path.name
        raise WorktreeError(message)


def display_name(worktree, root):
    if worktree.is_main:
        return '.'
    if worktree.canonical and not worktree.missing:
        return str(worktree.path.resolve().relative_to(root))
    return str(worktree.path)


def lock_digest(path):
    """Hash of the worktree's ``package-lock.json``, or ``None`` when it has none."""
    lock = path / LOCK_FILE
    return hashlib.sha256(lock.read_bytes()).hexdigest() if lock.is_file() else None


def sync_dependencies(path, recorded):
    """Install dependencies when ``package-lock.json`` differs from the hash recorded at the last install; the hash now valid."""
    current = lock_digest(path)
    if current == recorded:
        return recorded
    install_dependencies(path)
    return current


def write_env(root, path, entries, name):
    """The worktree's ``.env.worktree``, written with free ports when missing."""
    env = path / '.env.worktree'
    if not env.exists():
        used = used_ports(root / WORKTREES_DIR, [entry.path for entry in entries])
        nuxt = pick_port(NUXT_PORTS, used, port_is_free)
        odoo = pick_port(ODOO_PORTS, used | {nuxt}, port_is_free)
        env.write_text(env_content(nuxt, odoo, database_name(name)), encoding='utf-8')
    return env


def find_lanes(root):
    """Every lane of the pool (a worktree directly under ``.worktrees/`` with a record), sorted by name."""
    lanes = []
    for entry in parse_worktrees(sh(['git', 'worktree', 'list', '--porcelain'], root)):
        name = lane_name_of(root, entry.path)
        if name is None or not Path(entry.path).is_dir():
            continue
        take = load_take(Path(entry.path))
        if take is not None:
            lanes.append(LaneInfo(name, Path(entry.path), take, entry.locked))
    return sorted(lanes, key=lambda lane: lane.name)


def describe_lanes(lanes):
    return '\n'.join(
        '  %s: %s' % (lane.name, 'held by %s on %s' % (lane.take.holder or '(no holder)', lane.take.branch) if lane.take.occupied else 'resting')
        for lane in lanes) or '  (no lanes)'


def named_lane(lanes, name):
    lane = next((item for item in lanes if item.name == name), None)
    if lane is None:
        message = "no lane '%s'; lanes:\n%s\nadd one with: npm run wt -- lane add %s" % (name, describe_lanes(lanes), name)
        raise WorktreeError(message)
    return lane


def require_recorded_branch(name, take, held):
    """Refuse a lane whose checked-out branch ``held`` is not the one its record names; a resting lane is detached.

    A lane that left its branch still has that branch's work, so neither ``take`` nor ``done`` may replace its record.
    """
    if held == (take.branch or ''):
        return
    template = 'lane %s is on %s but its record says %s; return with: git switch %s'
    message = template % (name, held or 'a detached HEAD', take.branch or 'resting', take.branch or '--detach ' + LANE_BASE)
    raise WorktreeError(message)


def lane_ready(lane):
    """Whether a resting lane is on a detached HEAD with a clean tree."""
    return not lane.take.occupied and not current_branch(lane.path) and not changed_paths(lane.path)


def pick_lane(lanes, name):
    """The lane named ``name``, or the first resting clean one; a lane that is taken or not clean is refused."""
    if name:
        lane = named_lane(lanes, name)
        if lane.take.occupied:
            message = 'lane %s is held by %s on %s' % (name, lane.take.holder or '(no holder)', lane.take.branch)
            raise WorktreeError(message)
        require_recorded_branch(name, lane.take, current_branch(lane.path))
        require_clean(lane.path)
        return lane
    lane = next((item for item in lanes if lane_ready(item)), None)
    if lane is None:
        message = 'no free lane; lanes:\n%s\nadd one with: npm run wt -- lane add <name>' % describe_lanes(lanes)
        raise WorktreeError(message)
    return lane


def take_lane(root, branch, holder, orchestrator, task, lane_name, now=None):
    """Give ``branch`` to a lane: start it from origin/main, or resume the local branch of a parked task."""
    problem = check_branch(branch)
    if problem or branch in (MAIN, 'HEAD'):
        message = problem or "'%s' cannot be a lane branch" % branch
        raise WorktreeError(message)
    holder = holder.strip()
    if not holder:
        message = 'take needs --holder: the session, agent or person that writes in the lane'
        raise WorktreeError(message)
    orchestrator = orchestrator.strip()
    if not orchestrator:
        message = 'take needs --orchestrator: the session that takes lanes for its workers and closes them at the end'
        raise WorktreeError(message)
    lanes = find_lanes(root)
    held = next((lane for lane in lanes if lane.take.branch == branch), None)
    if held:
        message = 'branch %s is already held by lane %s (%s)' % (branch, held.name, held.take.holder or 'no holder')
        raise WorktreeError(message)
    lane = pick_lane(lanes, lane_name)
    lock_worktree(lane.path, lane.locked, root)
    sh(['git', 'fetch', 'origin', MAIN], root)
    exists = run(['git', 'rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], root)[0] == 0
    sh(['git', 'switch', branch] if exists else ['git', 'switch', '--no-track', '-c', branch, LANE_BASE], lane.path)
    stale = lock_digest(lane.path) != lane.take.lock_hash
    # a changed lock file leaves the hash empty until the install succeeds, so a failed install is retried by the next take
    record = Take(
        branch, holder, task.strip(), int(time.time() if now is None else now), None if stale else lane.take.lock_hash, orchestrator)
    write_take(git_dir(lane.path), record)
    if stale:
        write_take(git_dir(lane.path), record._replace(lock_hash=sync_dependencies(lane.path, None)))
    return 'lane %s at %s holds %s for %s' % (lane.name, lane.path, branch, holder)


def done_lane(root, lane_name, current, park):
    """Return a clean lane to a detached origin/main; delete its branch once merged, or keep it with ``park``."""
    lanes = find_lanes(root)
    if lane_name:
        lane = named_lane(lanes, lane_name)
    else:
        lane = next((item for item in lanes if inside(current.resolve(), item.path.resolve())), None)
        if lane is None:
            message = 'run done inside a lane, or name it with --lane; lanes:\n%s' % describe_lanes(lanes)
            raise WorktreeError(message)
    return finish_lane(root, lane, park)


def finish_lane(root, lane, park):
    take = lane.take
    if not take.occupied:
        message = 'lane %s is already resting; there is nothing to finish' % lane.name
        raise WorktreeError(message)
    require_recorded_branch(lane.name, take, current_branch(lane.path))
    require_clean(lane.path)
    sh(['git', 'fetch', 'origin', MAIN], root)
    if not park and not merged_into_base(lane.path):
        message = 'lane %s: %s is not merged into %s yet; wait for the merge, or keep the branch with: npm run wt -- done --park' % (
            lane.name, take.branch, LANE_BASE)
        raise WorktreeError(message)
    sh(['git', 'switch', '--detach', LANE_BASE], lane.path)
    if not park:
        sh(['git', 'branch', '-d', take.branch], lane.path)
    write_take(git_dir(lane.path), resting(take.lock_hash))
    return 'lane %s %s %s and rests on %s' % (lane.name, 'parked' if park else 'finished', take.branch, LANE_BASE)


def done_orchestrator(root, orchestrator, park):
    """Finish every lane ``orchestrator`` took; a lane that must be refused is left and reported, the rest still close."""
    orchestrator = orchestrator.strip()
    if not orchestrator:
        message = 'done needs a non-empty --orchestrator'
        raise WorktreeError(message)
    lanes = [lane for lane in find_lanes(root) if lane.take.occupied and lane.take.orchestrator == orchestrator]
    if not lanes:
        message = 'orchestrator %s holds no lane; lanes:\n%s' % (orchestrator, describe_lanes(find_lanes(root)))
        raise WorktreeError(message)
    lines, left = [], 0
    for lane in lanes:
        try:
            lines.append(finish_lane(root, lane, park))
        except WorktreeError as error:
            left += 1
            lines.append('left: %s' % error)
    lines.append('%d of %d lanes of %s returned; %d left' % (len(lanes) - left, len(lanes), orchestrator, left))
    return '\n'.join(lines), 1 if left else 0


def add_lane(root, name, holder, orchestrator, task, install, now=None):
    """Create the lane ``name`` at origin/main, or adopt the existing worktree of that name under ``.worktrees/``; either way it is locked."""
    validate_name(name)
    path = root / WORKTREES_DIR / name
    entries = parse_worktrees(sh(['git', 'worktree', 'list', '--porcelain'], root))
    registered = {Path(entry.path).resolve(): entry.locked for entry in entries}
    if path.exists() and path.resolve() not in registered:
        message = '%s exists but is not a registered worktree; move it away first' % path
        raise WorktreeError(message)
    fresh = not path.exists()
    if not fresh and load_take(path) is not None:
        message = 'lane %s already exists at %s' % (name, path)
        raise WorktreeError(message)
    branch = None if fresh else current_branch(path) or None
    if branch and not (holder.strip() and orchestrator.strip() and task.strip()):
        message = 'worktree %s is on %s; adopting it needs --holder, --orchestrator and --task' % (name, branch)
        raise WorktreeError(message)
    if fresh:
        sh(['git', 'fetch', 'origin', MAIN], root)
        sh(['git', 'worktree', 'add', '--detach', str(path), LANE_BASE], root)
    lock_worktree(path, registered.get(path.resolve(), False), root)
    git_path = git_dir(path)
    for stale in REMOVED_RECORDS:
        (git_path / stale).unlink(missing_ok=True)
    recorded = lock_digest(path) if (path / 'node_modules').is_dir() else None
    take = Take(
        branch, holder.strip(), task.strip(), int(time.time() if now is None else now), recorded, orchestrator.strip(),
    ) if branch else resting(recorded)
    write_take(git_path, take)
    env = write_env(root, path, entries, name)
    if install:
        lock_hash = sync_dependencies(path, recorded)
        write_take(git_path, take._replace(lock_hash=lock_hash))
    values = dict(re.findall(r'^(NUXT_PORT|ODOO_HTTP_PORT)=(\d+)$', env.read_text(encoding='utf-8'), re.MULTILINE))
    state = 'holds %s' % branch if branch else 'rests'
    return 'lane %s at %s %s\nNuxt port %s, Odoo port %s, see %s' % (name, path, state, values['NUXT_PORT'], values['ODOO_HTTP_PORT'], env)


def remove_lane(root, name, current):
    """Remove a resting clean lane that nothing uses: its worktree, its record and its scratch database."""
    lane = named_lane(find_lanes(root), name)
    if lane.take.occupied:
        message = 'lane %s is held by %s on %s; rest it first with: npm run wt -- done --lane %s' % (
            name, lane.take.holder or '(no holder)', lane.take.branch, name)
        raise WorktreeError(message)
    if changed_paths(lane.path):
        message = 'lane %s has uncommitted changes; commit or discard them, then rest it with: npm run wt -- done --lane %s' % (name, name)
        raise WorktreeError(message)
    if not merged_into_base(lane.path):
        head = sh(['git', 'rev-parse', '--short', 'HEAD'], lane.path)
        message = 'lane %s: HEAD %s is not merged into %s and would be lost; put those commits on a branch first (git switch -c <branch>)' % (
            name, head, LANE_BASE)
        raise WorktreeError(message)
    if inside(current.resolve(), lane.path.resolve()):
        message = 'it is the current directory; run this from another checkout'
        raise WorktreeError('lane %s: %s' % (name, message))
    if any(inside(path, lane.path.resolve()) for path in busy_paths()):
        message = 'lane %s: a process is running in it' % name
        raise WorktreeError(message)
    worktrees = inspect_all(root, sizes=False)
    databases = abandoned_databases(
        [w for w in worktrees if w.path.resolve() == lane.path.resolve()], [w for w in worktrees if w.path.resolve() != lane.path.resolve()])
    for _, argv in worktree_removal(lane.path, lane.locked):
        sh(argv, root)
    for database in databases:
        sh(['dropdb', '--if-exists', database], root)
    return 'removed lane %s%s' % (name, ' and dropped database %s' % ', '.join(databases) if databases else '')


def lock_lane(root, name):
    """Lock the lane ``name`` so that no tool removes it; a lane that already is locked is left as it is."""
    lane = named_lane(find_lanes(root), name)
    lock_worktree(lane.path, lane.locked, root)
    return 'lane %s at %s %s' % (name, lane.path, 'is already locked' if lane.locked else 'locked')


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    lane = sub.add_parser('lane', help='add or remove a lane')
    lane_sub = lane.add_subparsers(dest='lane_command', required=True)
    add = lane_sub.add_parser('add', help='create a lane, or adopt an existing worktree under .worktrees/')
    add.add_argument('name', help='one folder name under .worktrees/')
    add.add_argument('--holder', default='', help='the holder, needed when the adopted worktree is on a branch')
    add.add_argument('--orchestrator', default='', help='the orchestrator session, needed when the adopted worktree is on a branch')
    add.add_argument('--task', default='', help='one line: what the adopted branch is for')
    add.add_argument('--no-install', action='store_true')
    lock = lane_sub.add_parser('lock', help='lock a lane so that no tool removes its worktree')
    lock.add_argument('name')
    remove = lane_sub.add_parser('remove', help='remove a resting clean lane, its worktree and its scratch database')
    remove.add_argument('name')
    take = sub.add_parser('take', help='give a branch to a free lane')
    take.add_argument('branch')
    take.add_argument('--holder', required=True, help='the session, agent or person that writes in the lane')
    take.add_argument('--orchestrator', required=True, help='the orchestrator session that closes the lane at the end')
    take.add_argument('--task', default='', help='one line: what the branch is for')
    take.add_argument('--lane', help='take this lane instead of the first free one')
    done = sub.add_parser('done', help='return a lane whose branch is merged to a detached origin/main')
    target = done.add_mutually_exclusive_group()
    target.add_argument('--lane', help='the lane to return (default: the current directory\'s lane)')
    target.add_argument('--orchestrator', help='return every lane this orchestrator took')
    done.add_argument('--park', action='store_true', help='keep the unmerged branch; a later take of it resumes it')
    sub.add_parser('check', help='report rule violations of every worktree; exit 1 when there is one')
    sub.add_parser('status')
    collect = sub.add_parser('gc')
    collect.add_argument('--apply', action='store_true', help='remove what is listed (needs the owner\'s authorization)')
    collect.add_argument('--branch', help='only this branch\'s worktree and scratch database')
    return parser


def run_command(root, args):
    if args.command == 'status':
        worktrees = inspect_all(root)
        return format_status(worktrees, root, lane_changes(worktrees))
    if args.command == 'check':
        worktrees = inspect_all(root, sizes=False)
        found = violations(worktrees, lane_changes(worktrees))
        return format_violations(found, root), 1 if found else 0
    if args.command == 'gc':
        return gc(root, args.apply, Path.cwd(), args.branch)
    with pool_lock(root / GIT_DIR):
        if args.command == 'take':
            return take_lane(root, args.branch, args.holder, args.orchestrator, args.task, args.lane)
        if args.command == 'done':
            if args.orchestrator is not None:
                return done_orchestrator(root, args.orchestrator, args.park)
            return done_lane(root, args.lane, Path.cwd(), args.park)
        if args.lane_command == 'remove':
            return remove_lane(root, args.name, Path.cwd())
        if args.lane_command == 'lock':
            return lock_lane(root, args.name)
        return add_lane(root, args.name, args.holder, args.orchestrator, args.task, not args.no_install)


def main(argv=None):
    args = build_parser().parse_args(argv)
    result = run_command(repo_root(), args)
    text, code = result if isinstance(result, tuple) else (result, 0)
    sys.stdout.write(text + '\n')
    return code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (WorktreeError, LaneError) as exc:
        sys.stderr.write('wt: %s\n' % exc)
        sys.exit(2)
