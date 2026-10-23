# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Create, claim, check, list and clean up task worktrees.

    python3 -B tools/wt.py new <area>-<slug> --owner <who> --task <what> --scope <path> [--scope ...]
                               [--allow-overlap <reason>] [--base main] [--no-install] [--resume]
    python3 -B tools/wt.py claim --owner <who> [--task <what>] [--scope <path> ...] [--allow-overlap <reason>]
    python3 -B tools/wt.py check
    python3 -B tools/wt.py status
    python3 -B tools/wt.py gc [--apply] [--branch claude/<area>-<slug>]

``new`` creates ``.worktrees/<area>-<slug>``, the only location for task worktrees, under the main
checkout (also when run from a worktree) on branch ``claude/<area>-<slug>`` from ``--base`` (``main``, or a
``claude/`` integration branch), installs independent ``node_modules`` and ``.nuxt`` (never symlinked), and writes the
git-ignored ``.env.worktree`` with free Nuxt and Odoo ports and a scratch
database name (written before the install, so a failed install keeps its ports;
``--resume`` continues it). It also records the worktree's ownership claim (``tools/worktree_claims.py``):
the owner (session, agent or person), the task, the base and the workspace-relative paths the task will
change (``.`` is the whole repository, for an integration worktree). ``new`` refuses scopes that overlap the
active claim of another worktree unless ``--allow-overlap`` states the reason, which the claim keeps.
``claim``, run inside a task worktree, records a claim for a worktree that has none, lets its owner change or
refresh it, or takes over a claim that has expired (no commit, edited file or refresh for
``CLAIM_TTL_HOURS``); an expired claim stays listed but no longer blocks other claims.

``check`` reports every worktree that breaks a rule: outside ``.worktrees``, a branch that is not
``claude/<area>-<slug>`` or ``spike/<slug>``, a folder name that is not its branch's ``<area>-<slug>``, no claim,
and active claims that overlap without a stated reason; it exits 1 when there is one. It only reads: it never
moves, renames or removes a worktree, so a worktree that predates these rules is reported, never changed.
``status`` prints one table of every worktree, wherever it lives (``*`` marks one outside
``.worktrees``; ``missing`` one whose folder is gone), with its owner and claim state, then the violations. ``gc`` lists the worktrees and branches that are
merged into main with commits of their own, clean and held by no process, plus the scratch databases
of those worktrees nobody is connected to; it only prints unless ``--apply`` is given, which needs the
owner's authorization. Unmerged, dirty, current, in-use and missing worktrees and databases it cannot
tie to a worktree (``webvue_scratch_e2e``, hand-named ones) are never touched. ``--branch`` limits ``gc``
to that one branch's worktree and scratch database, says why a worktree it names is kept, and deletes the
local branch when it has no worktree and is merged into main.
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
from worktree_claims import (
    CLAIM_TTL_HOURS,
    Claim,
    ClaimError,
    is_expired,
    make_claim,
    overlapping,
    read_claim,
    write_claim,
)

NUXT_PORTS = range(3100, 3200)
ODOO_PORTS = range(8170, 8270)
DB_SLUG_MAX = 42
TAIL = 400
MAIN = 'main'
E2E_DATABASE = 'webvue_scratch_e2e'  # SCRATCH_DB in tools/e2e_isolated.mjs, a fixed database no worktree owns
SCRATCH_PREFIX = 'webvue_scratch_'
WORKTREES_DIR = '.worktrees'
INSTALL = (
    ['npm', 'ci', '--ignore-scripts', '--prefer-offline'],
    ['npm', '-w', 'apps/web', 'run', 'postinstall'],
)


class WorktreeError(Exception):
    """A refused or failed step; the message is shown to the user."""


class ClaimRequest(NamedTuple):
    """The ownership a caller asks for in ``new`` or ``claim``."""
    owner: str
    task: str
    scopes: tuple
    overlap_reason: str = ''


class WorktreeKept(WorktreeError):
    """``gc --branch`` found the named worktree but must keep it; the message says why."""


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
    return 'webvue_scratch_' + slug


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


def check_base(base):
    """Problem with a ``new --base``, or ``None``: task worktrees branch from main or a claude/ integration branch."""
    if base == MAIN or (base.startswith('claude/') and not check_branch(base)):
        return None
    return "--base '%s' must be %s or a claude/<area>-<slug> integration branch" % (base, MAIN)


def git_dir(path):
    """The worktree's own git directory (``.git/worktrees/<id>``, or ``.git`` for the main checkout)."""
    return Path(sh(['git', 'rev-parse', '--absolute-git-dir'], path))


def claim_conflicts(request, others):
    """Lines describing each active claim of ``others`` whose scopes overlap ``request``'s."""
    lines = []
    for other in others:
        if other.claim is None or other.claim_expired:
            continue
        pairs = overlapping(request.scopes, other.claim.scopes)
        lines += ['%s overlaps %s of %s (owner %s, task: %s)' % (
            mine, theirs, other.path, other.claim.owner, other.claim.task) for mine, theirs in pairs]
    return lines


def refuse_conflicts(request, others):
    conflicts = claim_conflicts(request, others)
    if conflicts and not request.overlap_reason:
        advice = 'narrow --scope, wait for that worktree, or pass --allow-overlap "<reason>" after agreeing with its owner'
        message = 'the scopes overlap an active claim:\n  %s\n%s' % ('\n  '.join(conflicts), advice)
        raise WorktreeError(message)


def create(suffix, base, install, request, resume=False):
    branch = 'claude/' + suffix
    problem = check_branch(branch) or check_base(base)
    if problem:
        raise WorktreeError(problem)
    root = repo_root()
    path = root / WORKTREES_DIR / suffix
    entries = parse_worktrees(sh(['git', 'worktree', 'list', '--porcelain'], root))
    registered = any(Path(p).resolve() == path.resolve() and ref == 'refs/heads/' + branch for p, ref in entries)
    if path.exists() and not (resume and registered):
        message = '%s already exists' % path
        raise WorktreeError(message)
    try:
        claim = make_claim(request.owner, request.task, base, request.scopes, time.time(), request.overlap_reason)
    except ClaimError as error:
        raise WorktreeError(str(error)) from error
    others = [w for w in inspect_all(root, sizes=False) if not w.is_main and w.path.resolve() != path.resolve()]
    refuse_conflicts(request._replace(scopes=claim.scopes), others)
    if not path.exists():
        sh(['git', 'worktree', 'add', str(path), '-b', branch, base], root)
    write_claim(git_dir(path), claim)
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
    claim: Claim | None = None
    claim_expired: bool = False


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
    suffix = branch[len('claude/'):] if branch and branch.startswith('claude/') else None
    return Worktree(
        path=path, branch=branch, is_main=False, canonical=(root / WORKTREES_DIR) in path.parents, ahead=0, behind=0,
        merged=False, dirty=False, age_days=0, size=None, database=database_name(suffix) if suffix else None,
        ports=[], missing=True)


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


def last_activity(path, commit_time, changed, claim):
    """Latest of the last commit, the newest edited file and the claim refresh, in epoch seconds."""
    times = [commit_time] + ([claim.refreshed_at] if claim else [])
    for name in changed:
        try:
            times.append(int((path / name).lstat().st_mtime))
        except OSError:
            continue  # a deleted path has no modification time
    return max(times)


def load_claim(path):
    try:
        return read_claim(git_dir(path))
    except ClaimError as error:
        raise WorktreeError(str(error)) from error


def inspect_worktree(root, path, ref, now=None, sizes=True):
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
    claim = load_claim(wt_path)
    env = env_values(wt_path)
    ports = [int(env[k]) for k in ('NUXT_PORT', 'ODOO_HTTP_PORT') if k in env]
    return Worktree(
        path=wt_path, branch=ref[len('refs/heads/'):] if ref else None, is_main=wt_path.resolve() == root.resolve(),
        canonical=(root / WORKTREES_DIR) in wt_path.resolve().parents or wt_path.resolve() == root.resolve(),
        ahead=ahead, behind=behind, merged=merged, dirty=bool(changed), age_days=max(0, int((now - commit_time) // 86400)),
        size=dir_size_kb(wt_path / 'node_modules') if sizes else None, database=env.get('NUXT_ODOO_DB'), ports=ports,
        own_commits=own_commits, claim=claim,
        claim_expired=claim is not None and is_expired(last_activity(wt_path, commit_time, changed, claim), now))


def inspect_all(root, sizes=True):
    entries = parse_worktrees(sh(['git', 'worktree', 'list', '--porcelain'], root))
    return [inspect_worktree(root, path, ref, sizes=sizes) for path, ref in entries]


def branch_violation(worktree):
    """Why the worktree's branch or folder name breaks the naming rule, or ``None``."""
    if not worktree.branch:
        return 'no branch (detached HEAD); task worktrees are on claude/<area>-<slug>'
    problem = check_branch(worktree.branch)
    if problem:
        return problem
    expected = worktree.branch.split('/', 1)[1] if '/' in worktree.branch else None
    if expected and worktree.path.name != expected:
        return "folder '%s' does not match its branch %s (expected %s/%s)" % (
            worktree.path.name, worktree.branch, WORKTREES_DIR, expected)
    return None


def violations(worktrees):
    """``[(worktree, problem)]`` for every rule a task worktree breaks; the main checkout is not checked."""
    found = []
    tasks = [w for w in worktrees if not w.is_main]
    for w in tasks:
        if not w.canonical:
            found.append((w, 'outside %s/; task worktrees live only in <main checkout>/%s/<area>-<slug>' % (
                WORKTREES_DIR, WORKTREES_DIR)))
        if w.missing:
            continue
        problem = branch_violation(w)
        if problem:
            found.append((w, problem))
        if w.claim is None:
            found.append((w, 'no ownership claim; its owner records one with: wt.py claim --owner ... --task ... --scope ...'))
    for index, w in enumerate(tasks):
        for other in tasks[index + 1:]:
            if not (w.claim and other.claim) or w.claim_expired or other.claim_expired:
                continue
            if w.claim.overlap_reason or other.claim.overlap_reason:
                continue
            for mine, theirs in overlapping(w.claim.scopes, other.claim.scopes):
                found.append((w, 'scope %s overlaps %s of %s without a stated reason' % (mine, theirs, other.path)))
    return found


def format_violations(found, root):
    if not found:
        return 'no rule violations'
    lines = ['%d rule violations (reported only; nothing was moved, renamed or removed):' % len(found)]
    lines += ['  %s: %s' % (display_name(w, root), problem) for w, problem in found]
    return '\n'.join(lines)


def display_name(worktree, root):
    if worktree.is_main:
        return '.'
    if worktree.canonical and not worktree.missing:
        return str(worktree.path.resolve().relative_to(root))
    return str(worktree.path)


def claim_label(worktree):
    if worktree.is_main or worktree.missing:
        return '-'
    if worktree.claim is None:
        return 'unclaimed'
    return '%s%s' % (worktree.claim.owner, ' (expired)' if worktree.claim_expired else '')


def format_status(worktrees, root):
    header = ('WORKTREE', 'BRANCH', 'OWNER', 'AHEAD/BEHIND', 'MERGED', 'DIRTY', 'AGE', 'NODE_MODULES', 'SCRATCH DB', 'PORTS')
    rows = [header]
    for w in worktrees:
        name = display_name(w, root) + ('' if w.canonical else ' *')
        if w.missing:
            rows.append((name, w.branch or '(detached)', '-', 'missing', '-', '-', '-', '-', w.database or '-', '-'))
            continue
        rows.append((
            name, w.branch or '(detached)', claim_label(w),
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
    claims = [w for w in others if w.claim]
    summary += '; %d claimed, %d expired (claims expire after %dh without activity)' % (
        len(claims), sum(w.claim_expired for w in claims), CLAIM_TTL_HOURS)
    return '\n'.join(lines + ['', summary, '', format_violations(violations(worktrees), root)])


def update_claim(root, current, request, now=None):
    """Record, change, refresh or take over the claim of the task worktree containing ``current``."""
    now = time.time() if now is None else now
    worktrees = inspect_all(root, sizes=False)
    mine = next((w for w in worktrees if not w.is_main and not w.missing and inside(current.resolve(), w.path.resolve())), None)
    if mine is None:
        message = 'run claim inside a task worktree under %s/, not the main checkout' % WORKTREES_DIR
        raise WorktreeError(message)
    old = mine.claim
    if old and old.owner != request.owner.strip() and not mine.claim_expired:
        template = 'this worktree is claimed by %s (task: %s) and the claim is active; ask that owner, or wait %dh without activity for it to expire'
        message = template % (old.owner, old.task, CLAIM_TTL_HOURS)
        raise WorktreeError(message)
    keep = old and old.owner == request.owner.strip()
    task = request.task or (old.task if old else '')
    scopes = request.scopes or (old.scopes if old else ())
    reason = request.overlap_reason or (old.overlap_reason if keep else '')
    base = old.base if old else MAIN
    try:
        claim = make_claim(request.owner, task, base, scopes, now, reason, old.claimed_at if keep else None)
    except ClaimError as error:
        raise WorktreeError(str(error)) from error
    others = [w for w in worktrees if not w.is_main and w is not mine]
    refuse_conflicts(request._replace(scopes=claim.scopes, overlap_reason=claim.overlap_reason), others)
    write_claim(git_dir(mine.path), claim)
    action = 'refreshed' if keep else 'took over the expired claim of %s' % old.owner if old else 'recorded'
    return '%s claim of %s: owner %s, task: %s, scopes: %s' % (
        action, mine.path, claim.owner, claim.task, ', '.join(claim.scopes))


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


def keep_reason(worktree, busy, current):
    """Why ``gc`` keeps this worktree, or ``None`` when it may be removed (never main or the current one)."""
    reasons = (
        (worktree.is_main, 'it is the main checkout'),
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
        done, failed = try_each([('worktree %s' % w.path, ['git', 'worktree', 'remove', str(w.path)], root)])
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
    if branch is not None and (not branch.startswith('claude/') or check_branch(branch)):
        message = '--branch must be a local claude/<area>-<slug> task branch'
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


def add_claim_arguments(parser, required):
    parser.add_argument('--owner', required=True, help='the session, agent or person that writes in this worktree')
    parser.add_argument('--task', required=required, help='one line: what this worktree is for')
    parser.add_argument('--scope', action='append', default=[], required=required,
                        help='a workspace-relative path the task will change; repeat it; . is the whole repository')
    parser.add_argument('--allow-overlap', default='', metavar='REASON',
                        help='claim scopes that overlap another active claim, with the reason agreed with its owner')


def claim_request(args):
    return ClaimRequest(args.owner, args.task or '', tuple(args.scope), args.allow_overlap)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    new = sub.add_parser('new')
    new.add_argument('name', help='<area>-<slug>, e.g. pmo-task-filters')
    new.add_argument('--base', default=MAIN, help='main, or a claude/<area>-<slug> integration branch')
    new.add_argument('--no-install', action='store_true')
    new.add_argument('--resume', action='store_true', help='continue a worktree whose creation failed part way')
    add_claim_arguments(new, required=True)
    claim = sub.add_parser('claim', help='record, change, refresh or take over the claim of the current worktree')
    add_claim_arguments(claim, required=False)
    sub.add_parser('check', help='report rule violations of every worktree; exit 1 when there is one')
    sub.add_parser('status')
    collect = sub.add_parser('gc')
    collect.add_argument('--apply', action='store_true', help='remove what is listed (needs the owner\'s authorization)')
    collect.add_argument('--branch', help='only this branch\'s worktree and scratch database (claude/<area>-<slug>)')
    args = parser.parse_args(argv)
    if args.command == 'status':
        root = repo_root()
        sys.stdout.write(format_status(inspect_all(root), root) + '\n')
        return 0
    if args.command == 'check':
        root = repo_root()
        found = violations(inspect_all(root, sizes=False))
        sys.stdout.write(format_violations(found, root) + '\n')
        return 1 if found else 0
    if args.command == 'claim':
        sys.stdout.write(update_claim(repo_root(), Path.cwd(), claim_request(args)) + '\n')
        return 0
    if args.command == 'gc':
        sys.stdout.write(gc(repo_root(), args.apply, Path.cwd(), args.branch) + '\n')
        return 0
    path, branch, nuxt, odoo = create(args.name, args.base, not args.no_install, claim_request(args), args.resume)
    sys.stdout.write('worktree %s on %s\nNuxt port %d, Odoo port %d, see %s/.env.worktree\n' % (path, branch, nuxt, odoo, path))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except WorktreeError as exc:
        sys.stderr.write('wt: %s\n' % exc)
        sys.exit(2)
