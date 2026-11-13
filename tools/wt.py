# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Set up and run the fixed lanes; create, claim, check, list and clean up temporary task worktrees.

    python3 -B tools/wt.py lane setup <lane> [--no-install]
    python3 -B tools/wt.py lane start <lane> <branch>
    python3 -B tools/wt.py lane finish <lane>
    python3 -B tools/wt.py claim --owner <session> [--task <what>] [--scope <path> ...] [--allow-overlap <reason>]
    python3 -B tools/wt.py release --owner <session>
    python3 -B tools/wt.py new <area>-<slug> --owner <who> --task <what> --scope <path> [--scope ...]
                               [--allow-overlap <reason>] [--base main] [--no-install] [--resume]
    python3 -B tools/wt.py check
    python3 -B tools/wt.py status
    python3 -B tools/wt.py gc [--apply] [--branch codex/<area>-<slug>]

The four fixed lanes (``claude-1``, ``claude-2``, ``codex-1``, ``codex-2``) are permanent worktrees at
``.worktrees/<lane>`` and are never removed. Between tasks a lane rests on a detached ``origin/main``.
``lane setup`` creates (or adopts) the lane worktree, its ``.env.worktree`` with free ports, its lane record
(``liwan-lane.json``, see ``tools/worktree_claims.py``) and its dependencies. ``lane start`` begins the
task branch from ``origin/main`` in a clean lane that rests or holds a merged branch, and refuses a lane that left
its recorded branch; ``lane finish`` returns the lane to a detached
``origin/main`` once its branch is merged and deletes the branch. Several agent sessions then work on that one
branch: ``claim``, run inside a lane, records or refreshes the claim of the session named by ``--owner``
(a first claim needs ``--task`` and ``--scope``), refuses scopes that overlap an active claim of another
session or worktree unless ``--allow-overlap`` states the reason, and takes over an expired claim of the lane
that overlaps it; ``release`` removes the claim of a session. Both run under one repository-wide lock, so
sessions that claim at the same moment are checked one after the other. The pre-commit lane guard of ``tools/hooks.py``
refuses a commit outside the committing session's claim.

Temporary task worktrees stay for exceptions the owner authorises. ``new`` creates
``.worktrees/<area>-<slug>``, a location for them (a lane name is refused), under the main
checkout (also when run from a worktree) on branch ``codex/<area>-<slug>`` from ``--base`` (``main`` or
any valid branch), installs independent ``node_modules`` and ``.nuxt`` (never symlinked), and writes the
git-ignored ``.env.worktree`` with free Nuxt and Odoo ports and a scratch
database name (written before the install, so a failed install keeps its ports;
``--resume`` continues it). It also records the worktree's ownership claim (``tools/worktree_claims.py``):
the owner (session, agent or person), the task, the base and the workspace-relative paths the task will
change (``.`` is the whole repository, for an integration worktree). ``new`` refuses scopes that overlap the
active claim of another worktree unless ``--allow-overlap`` states the reason, which the claim keeps.
``claim``, run inside a task worktree, records a claim for a worktree that has none, lets its owner change or
refresh it, or takes over a claim that has expired (no commit, edited file or refresh for
``CLAIM_TTL_HOURS``); an expired claim stays listed but no longer blocks other claims.

``check`` reports every worktree that breaks a rule: outside ``.worktrees``, an invalid Git branch name,
a folder name that does not match its branch suffix, no claim,
and active claims that overlap without a stated reason; a lane is exempt from the first three and instead
reports a missing lane record or a branch that differs from the recorded one. It exits 1 when there is one. It only reads: it never
moves, renames or removes a worktree, so a worktree that predates these rules is reported, never changed.
``status`` prints one table of every worktree, wherever it lives (``*`` marks one outside
``.worktrees``; ``missing`` one whose folder is gone), with its owner (for a lane, its session owners) and claim state, then the violations. ``gc`` lists the worktrees and branches that are
merged into main with commits of their own, clean and held by no process, plus the scratch databases
of those worktrees nobody is connected to; it only prints unless ``--apply`` is given, which needs the
owner's authorization. Unmerged, dirty, current, in-use and missing worktrees and databases it cannot
tie to a worktree (``liwan_scratch_e2e``, hand-named ones) are never touched. A fixed lane is never removed. ``--branch`` limits ``gc``
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
    LANES,
    WORKTREES_DIR,
    Claim,
    ClaimError,
    Lane,
    claims_lock,
    is_expired,
    make_claim,
    overlapping,
    read_claim,
    read_lane,
    write_claim,
    write_lane,
)

# Vendor administration owns 3100 and its live-proof build owns 3103, even while idle.
NUXT_PORTS = tuple(port for port in range(3100, 3200) if port not in {3100, 3103})
ODOO_PORTS = range(8170, 8270)
DB_SLUG_MAX = 42
TAIL = 400
MAIN = 'main'
E2E_DATABASE = 'liwan_scratch_e2e'  # SCRATCH_DB in tools/e2e_isolated.mjs, a fixed database no worktree owns
SCRATCH_PREFIX = 'liwan_scratch_'
LANE_BASE = 'origin/main'
GIT_DIR = '.git'  # the main checkout's git directory, shared by every worktree
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
    """Problem with a ``new --base``, or ``None``: main or any valid branch may be a base."""
    if base == MAIN or not check_branch(base):
        return None
    return "--base '%s' must be %s or a valid branch name" % (base, MAIN)


def git_dir(path):
    """The worktree's own git directory (``.git/worktrees/<id>``, or ``.git`` for the main checkout)."""
    return Path(sh(['git', 'rev-parse', '--absolute-git-dir'], path))


def claim_conflicts(request, others):
    """Lines describing each active claim of ``others`` whose scopes overlap ``request``'s."""
    lines = []
    for other in others:
        for claim in other.active_claims():
            pairs = overlapping(request.scopes, claim.scopes)
            lines += ['%s overlaps %s of %s (owner %s, task: %s)' % (
                mine, theirs, other.path, claim.owner, claim.task) for mine, theirs in pairs]
    return lines


def refuse_conflicts(request, others):
    conflicts = claim_conflicts(request, others)
    if conflicts and not request.overlap_reason:
        advice = 'narrow --scope, wait for that worktree, or pass --allow-overlap "<reason>" after agreeing with its owner'
        message = 'the scopes overlap an active claim:\n  %s\n%s' % ('\n  '.join(conflicts), advice)
        raise WorktreeError(message)


def prepare_worktree(root, path, entries, suffix, install):
    """Write the worktree's ``.env.worktree`` when missing and install its dependencies; the env file's path."""
    env = path / '.env.worktree'
    if not env.exists():
        used = used_ports(root / WORKTREES_DIR, [p for p, _ in entries])
        nuxt = pick_port(NUXT_PORTS, used, port_is_free)
        odoo = pick_port(ODOO_PORTS, used | {nuxt}, port_is_free)
        env.write_text(env_content(nuxt, odoo, database_name(suffix)), encoding='utf-8')
    if install and not (path / 'node_modules').is_dir():
        install_dependencies(path)
    return env


def create(suffix, base, install, request, resume=False):
    if suffix in LANES:
        message = "'%s' is a fixed lane; set it up with: python3 -B tools/wt.py lane setup %s" % (suffix, suffix)
        raise WorktreeError(message)
    if '/' in suffix:
        message = 'worktree suffix must be a single directory name'
        raise WorktreeError(message)
    branch = 'codex/' + suffix
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
    env = prepare_worktree(root, path, entries, suffix, install)
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
    lane: Lane | None = None
    is_lane: bool = False
    expired_sessions: tuple = ()  # owners of the lane's session claims that expired

    def claim_states(self):
        """``[(claim, expired)]``: the one claim of a task worktree, or every session claim of a lane."""
        if self.is_lane:
            return [(claim, claim.owner in self.expired_sessions) for claim in (self.lane.sessions if self.lane else ())]
        return [(self.claim, self.claim_expired)] if self.claim else []

    def active_claims(self):
        return [claim for claim, expired in self.claim_states() if not expired]


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


def load_lane(path):
    try:
        return read_lane(git_dir(path))
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
    is_main = wt_path.resolve() == root.resolve()
    canonical = (root / WORKTREES_DIR) in wt_path.resolve().parents or is_main
    is_lane = not is_main and canonical and wt_path.name in LANES
    lane = load_lane(wt_path) if is_lane else None
    return Worktree(
        path=wt_path, branch=ref[len('refs/heads/'):] if ref else None, is_main=is_main, canonical=canonical,
        ahead=ahead, behind=behind, merged=merged, dirty=bool(changed), age_days=max(0, int((now - commit_time) // 86400)),
        size=dir_size_kb(wt_path / 'node_modules') if sizes else None, database=env.get('NUXT_ODOO_DB'), ports=ports,
        own_commits=own_commits, claim=claim,
        claim_expired=claim is not None and is_expired(last_activity(wt_path, commit_time, changed, claim), now),
        lane=lane, is_lane=is_lane,
        expired_sessions=tuple(c.owner for c in lane.sessions if is_expired(c.refreshed_at, now)) if lane else ())


def inspect_all(root, sizes=True):
    entries = parse_worktrees(sh(['git', 'worktree', 'list', '--porcelain'], root))
    return [inspect_worktree(root, path, ref, sizes=sizes) for path, ref in entries]


def branch_violation(worktree):
    """Why the worktree's branch or folder name breaks the naming rule, or ``None``."""
    if not worktree.branch:
        return 'no branch (detached HEAD); task worktrees are on any normal branch'
    problem = check_branch(worktree.branch)
    if problem:
        return problem
    expected = worktree.branch.split('/', 1)[1] if '/' in worktree.branch else None
    if expected and worktree.path.name != expected:
        return "folder '%s' does not match its branch %s (expected %s/%s)" % (
            worktree.path.name, worktree.branch, WORKTREES_DIR, expected)
    return None


def lane_violation(worktree):
    """Why a fixed lane breaks a rule, or ``None``: no lane record, or a branch other than the recorded one."""
    name = worktree.path.name
    if worktree.lane is None:
        return 'no lane record; set it up with: wt.py lane setup %s' % name
    if worktree.branch != worktree.lane.branch:
        return 'lane is on %s but its recorded branch is %s; another session moved it, return with: git switch %s' % (
            worktree.branch or 'a detached HEAD', worktree.lane.branch or 'none (resting)', worktree.lane.branch or '--detach origin/main')
    return None


def task_violations(worktree):
    """Problems of one non-main worktree other than claim overlap; lanes are exempt from the task rules."""
    found = []
    if not worktree.canonical:
        found.append('outside %s/; task worktrees live only in <main checkout>/%s/<area>-<slug>' % (WORKTREES_DIR, WORKTREES_DIR))
    if worktree.missing:
        return found
    if worktree.is_lane:
        problem = lane_violation(worktree)
        return found + ([problem] if problem else [])
    problem = branch_violation(worktree)
    if problem:
        found.append(problem)
    if worktree.claim is None:
        found.append('no ownership claim; its owner records one with: wt.py claim --owner ... --task ... --scope ...')
    return found


def holder(worktree, claim):
    """How a claim is named in an overlap message: the worktree path, plus the session for a lane."""
    return '%s session %s' % (worktree.path, claim.owner) if worktree.is_lane else str(worktree.path)


def violations(worktrees):
    """``[(worktree, problem)]`` for every rule a worktree breaks; the main checkout is not checked."""
    tasks = [w for w in worktrees if not w.is_main]
    found = [(w, problem) for w in tasks for problem in task_violations(w)]
    held = [(w, claim) for w in tasks for claim in w.active_claims()]
    for index, (w, claim) in enumerate(held):
        for other, other_claim in held[index + 1:]:
            if claim.overlap_reason or other_claim.overlap_reason:
                continue
            for mine, theirs in overlapping(claim.scopes, other_claim.scopes):
                found.append((w, 'scope %s overlaps %s of %s without a stated reason' % (mine, theirs, holder(other, other_claim))))
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
    if worktree.is_lane:
        return ', '.join('%s%s' % (c.owner, ' (expired)' if expired else '') for c, expired in worktree.claim_states()) or '-'
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
    claims = [state for w in others for state in w.claim_states()]
    summary += '; %d claimed, %d expired (claims expire after %dh without activity)' % (
        len(claims), sum(expired for _, expired in claims), CLAIM_TTL_HOURS)
    return '\n'.join(lines + ['', summary, '', format_violations(violations(worktrees), root)])


def containing_worktree(worktrees, current):
    """The non-main worktree whose folder holds ``current``, or ``None``."""
    return next((w for w in worktrees if not w.is_main and not w.missing and inside(current.resolve(), w.path.resolve())), None)


def require_record(name, lane):
    """``lane``, the record of the fixed lane ``name``; a lane without one must be set up first."""
    if lane is None:
        message = 'lane %s has no record; set it up with: python3 -B tools/wt.py lane setup %s' % (name, name)
        raise WorktreeError(message)
    return lane


def update_session_claim(mine, worktrees, request, now):
    """Record, change or refresh the claim of one session in the lane ``mine``; expired overlapping claims are taken over."""
    lane = require_record(mine.path.name, mine.lane)
    if lane.branch is None:
        message = 'lane %s has no started branch; start one with: python3 -B tools/wt.py lane start %s <branch>' % (
            mine.path.name, mine.path.name)
        raise WorktreeError(message)
    owner = request.owner.strip()
    old = next((c for c in lane.sessions if c.owner == owner), None)
    task = request.task or (old.task if old else '')
    scopes = request.scopes or (old.scopes if old else ())
    reason = request.overlap_reason or (old.overlap_reason if old else '')
    try:
        claim = make_claim(owner, task, lane.branch, scopes, now, reason, old.claimed_at if old else None)
    except ClaimError as error:
        raise WorktreeError(str(error)) from error
    peers = [c for c in lane.sessions if c.owner != owner]
    taken = [c for c in peers if c.owner in mine.expired_sessions and overlapping(claim.scopes, c.scopes)]
    kept = tuple(c for c in peers if c not in taken)
    others = [w for w in worktrees if not w.is_main and w is not mine] + [mine._replace(lane=Lane(lane.branch, kept))]
    refuse_conflicts(request._replace(scopes=claim.scopes, overlap_reason=claim.overlap_reason), others)
    write_lane(git_dir(mine.path), Lane(lane.branch, kept + (claim,)))
    action = 'refreshed' if old else 'took over the expired claim of %s' % taken[0].owner if taken else 'recorded'
    return '%s claim of %s: owner %s, task: %s, scopes: %s' % (action, mine.path, claim.owner, claim.task, ', '.join(claim.scopes))


def update_claim(root, current, request, now=None):
    """Record, change, refresh or take over the claim of the worktree containing ``current``."""
    now = time.time() if now is None else now
    worktrees = inspect_all(root, sizes=False)
    mine = containing_worktree(worktrees, current)
    if mine is None:
        message = 'run claim inside a lane or task worktree under %s/, not the main checkout' % WORKTREES_DIR
        raise WorktreeError(message)
    if mine.is_lane:
        return update_session_claim(mine, worktrees, request, now)
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


def release_claim(root, current, owner):
    """Remove the claim of session ``owner`` from the lane containing ``current``."""
    mine = containing_worktree(inspect_all(root, sizes=False), current)
    if mine is None or not mine.is_lane:
        message = 'run release inside a fixed lane (%s)' % ', '.join(LANES)
        raise WorktreeError(message)
    lane = require_record(mine.path.name, mine.lane)
    remaining = tuple(c for c in lane.sessions if c.owner != owner.strip())
    if len(remaining) == len(lane.sessions):
        message = 'session %s has no claim in lane %s' % (owner.strip(), mine.path.name)
        raise WorktreeError(message)
    write_lane(git_dir(mine.path), Lane(lane.branch, remaining))
    return 'released the claim of session %s in lane %s' % (owner.strip(), mine.path.name)


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
        (worktree.is_lane, 'it is a fixed lane; return it with: wt.py lane finish %s' % worktree.path.name),
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


def lane_folder(root, name):
    if name not in LANES:
        message = "'%s' is not a fixed lane (%s)" % (name, ', '.join(LANES))
        raise WorktreeError(message)
    return root / WORKTREES_DIR / name


def lane_worktree(root, name):
    """The lane's folder; the lane must be one of ``LANES`` and already set up."""
    path = lane_folder(root, name)
    if not path.is_dir():
        message = 'lane %s is not set up; run: python3 -B tools/wt.py lane setup %s' % (name, name)
        raise WorktreeError(message)
    return path


def current_branch(path):
    return sh(['git', 'branch', '--show-current'], path)


def merged_into_base(path):
    return run(['git', 'merge-base', '--is-ancestor', 'HEAD', LANE_BASE], path)[0] == 0


def require_recorded_branch(name, lane, held):
    """Refuse a lane whose checked-out branch ``held`` is not the one its record names; a resting lane is detached.

    A lane that left its branch still has that branch's work and session claims, so neither ``lane start`` nor
    ``lane finish`` may replace its record.
    """
    if held == (lane.branch or ''):
        return
    template = 'lane %s is on %s but its recorded branch is %s; return with: git switch %s'
    message = template % (name, held or 'a detached HEAD', lane.branch or 'none (resting)', lane.branch or '--detach ' + LANE_BASE)
    raise WorktreeError(message)


def require_clean(path):
    if changed_paths(path):
        message = 'lane %s has uncommitted changes; commit or discard them first' % path.name
        raise WorktreeError(message)


def rest_lane(path, branch):
    """Return the lane at ``path`` to a detached origin/main, delete its merged ``branch`` and clear its record."""
    sh(['git', 'switch', '--detach', LANE_BASE], path)
    sh(['git', 'branch', '-d', branch], path)
    write_lane(git_dir(path), Lane(None, ()))


def lane_setup(root, name, install):
    """Create (or adopt) the lane worktree, its env file, its record and its dependencies."""
    path = lane_folder(root, name)
    entries = parse_worktrees(sh(['git', 'worktree', 'list', '--porcelain'], root))
    registered = any(Path(p).resolve() == path.resolve() for p, _ in entries)
    if path.exists() and not registered:
        message = '%s exists but is not a registered worktree; move it away first' % path
        raise WorktreeError(message)
    if not path.exists():
        sh(['git', 'fetch', 'origin', MAIN], root)
        sh(['git', 'worktree', 'add', '--detach', str(path), LANE_BASE], root)
    if load_lane(path) is None:
        write_lane(git_dir(path), Lane(current_branch(path) or None, ()))
    env = prepare_worktree(root, path, entries, name, install)
    values = dict(re.findall(r'^(NUXT_PORT|ODOO_HTTP_PORT)=(\d+)$', env.read_text(encoding='utf-8'), re.MULTILINE))
    return 'lane %s at %s\nNuxt port %s, Odoo port %s, see %s' % (name, path, values['NUXT_PORT'], values['ODOO_HTTP_PORT'], env)


def lane_start(root, name, branch):
    """Start ``branch`` from origin/main in a clean lane on its recorded branch; a merged branch it holds is finished first."""
    problem = check_branch(branch)
    if problem or branch in (MAIN, 'HEAD'):
        message = problem or "'%s' cannot be a lane branch" % branch
        raise WorktreeError(message)
    path = lane_worktree(root, name)
    lane = require_record(name, load_lane(path))
    require_recorded_branch(name, lane, current_branch(path))
    require_clean(path)
    sh(['git', 'fetch', 'origin', MAIN], root)
    if lane.branch and not merged_into_base(path):
        message = 'lane %s still holds %s, which is not merged into %s; finish or merge it first' % (name, lane.branch, LANE_BASE)
        raise WorktreeError(message)
    if lane.branch:
        rest_lane(path, lane.branch)
    sh(['git', 'switch', '-c', branch, '--no-track', LANE_BASE], path)
    write_lane(git_dir(path), Lane(branch, ()))
    return 'lane %s started %s from %s' % (name, branch, LANE_BASE)


def lane_finish(root, name):
    """Return the lane to a detached origin/main after its branch is merged, and delete the branch."""
    path = lane_worktree(root, name)
    lane = require_record(name, load_lane(path))
    if lane.branch is None:
        message = 'lane %s is already resting; there is nothing to finish' % name
        raise WorktreeError(message)
    require_recorded_branch(name, lane, current_branch(path))
    require_clean(path)
    sh(['git', 'fetch', 'origin', MAIN], root)
    if not merged_into_base(path):
        message = 'lane %s: %s is not merged into %s yet' % (name, lane.branch, LANE_BASE)
        raise WorktreeError(message)
    rest_lane(path, lane.branch)
    return 'lane %s finished %s and rests on %s' % (name, lane.branch, LANE_BASE)


def add_claim_arguments(parser, required):
    parser.add_argument('--owner', required=True, help='the session, agent or person that writes in this worktree')
    parser.add_argument('--task', required=required, help='one line: what this worktree is for')
    parser.add_argument('--scope', action='append', default=[], required=required,
                        help='a workspace-relative path the task will change; repeat it; . is the whole repository')
    parser.add_argument('--allow-overlap', default='', metavar='REASON',
                        help='claim scopes that overlap another active claim, with the reason agreed with its owner')


def claim_request(args):
    return ClaimRequest(args.owner, args.task or '', tuple(args.scope), args.allow_overlap)


def run_lane(root, args):
    if args.lane_command == 'setup':
        return lane_setup(root, args.name, not args.no_install)
    if args.lane_command == 'start':
        return lane_start(root, args.name, args.branch)
    return lane_finish(root, args.name)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    new = sub.add_parser('new')
    new.add_argument('name', help='<area>-<slug>, e.g. pmo-task-filters')
    new.add_argument('--base', default=MAIN, help='main, or a codex/<area>-<slug> integration branch')
    new.add_argument('--no-install', action='store_true')
    new.add_argument('--resume', action='store_true', help='continue a worktree whose creation failed part way')
    add_claim_arguments(new, required=True)
    claim = sub.add_parser('claim', help='record, change, refresh or take over the claim of the current lane session or worktree')
    add_claim_arguments(claim, required=False)
    release = sub.add_parser('release', help='remove the claim of a session from the current lane')
    release.add_argument('--owner', required=True, help='the session whose claim is removed')
    lane = sub.add_parser('lane', help='set up, start and finish a fixed lane')
    lane_sub = lane.add_subparsers(dest='lane_command', required=True)
    setup = lane_sub.add_parser('setup', help='create or adopt the lane worktree, its env file, record and dependencies')
    setup.add_argument('name', help='one of: ' + ', '.join(LANES))
    setup.add_argument('--no-install', action='store_true')
    start = lane_sub.add_parser('start', help='start a task branch from origin/main in a resting lane')
    start.add_argument('name')
    start.add_argument('branch')
    lane_sub.add_parser('finish', help='return a lane whose branch is merged to a detached origin/main').add_argument('name')
    sub.add_parser('check', help='report rule violations of every worktree; exit 1 when there is one')
    sub.add_parser('status')
    collect = sub.add_parser('gc')
    collect.add_argument('--apply', action='store_true', help='remove what is listed (needs the owner\'s authorization)')
    collect.add_argument('--branch', help='only this branch\'s worktree and scratch database (codex/<area>-<slug>)')
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
        root = repo_root()
        with claims_lock(root / GIT_DIR):
            sys.stdout.write(update_claim(root, Path.cwd(), claim_request(args)) + '\n')
        return 0
    if args.command == 'release':
        root = repo_root()
        with claims_lock(root / GIT_DIR):
            sys.stdout.write(release_claim(root, Path.cwd(), args.owner) + '\n')
        return 0
    if args.command == 'lane':
        sys.stdout.write(run_lane(repo_root(), args) + '\n')
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
