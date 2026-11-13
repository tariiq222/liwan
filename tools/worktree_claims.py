# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Ownership claims of task worktrees and the record of the fixed lanes.

A claim is ``liwan-claim.json`` in the worktree's own git directory (``.git/worktrees/<id>/``), so
it is never tracked, never shows in ``git status`` and disappears with ``git worktree remove``.
``tools/wt.py`` writes it on ``new``, replaces or refreshes it on ``claim`` and reads it for ``status``,
``check`` and the overlap refusal. A claim whose worktree saw no activity (commit, edited file or
claim refresh) for ``CLAIM_TTL_HOURS`` is expired: it is still listed, but its scopes no longer block.

The four fixed lanes (``LANES``) are permanent worktrees shared by several agent sessions. A lane keeps
``liwan-lane.json`` in its git directory: the branch the lane started and one claim per session (keyed by
the claim owner, its ``base`` is the lane's branch). A session claim expires ``CLAIM_TTL_HOURS`` after its
last refresh. Sessions claim and release at the same time, so ``tools/wt.py`` does both under ``claims_lock``
and ``write_lane`` replaces the record in one step, which keeps a reader from seeing half a file.
``commit_refusal`` is the rule behind the pre-commit lane guard of ``tools/hooks.py``: a commit
in a lane must be made on the started branch by a session whose claim covers every staged path.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os
import posixpath
import time
from pathlib import Path
from typing import NamedTuple

CLAIM_FILE = 'liwan-claim.json'
LANE_FILE = 'liwan-lane.json'
CLAIMS_LOCK_FILE = 'liwan-claims.lock'  # in the shared git directory, one lock for every claim write
LANES = ('claude-1', 'claude-2', 'codex-1', 'codex-2')
WORKTREES_DIR = '.worktrees'
SESSION_ENV = 'LIWAN_SESSION'  # the session id a commit in a lane is made under
WHOLE_REPOSITORY = '.'  # the integration scope: overlaps every other scope, so it always needs a stated reason
CLAIM_TTL_HOURS = 24
SECONDS_PER_HOUR = 3600


class ClaimError(Exception):
    """A refused or unreadable claim; the message is shown to the user."""


class Claim(NamedTuple):
    owner: str
    task: str
    base: str
    scopes: tuple
    claimed_at: int
    refreshed_at: int
    overlap_reason: str = ''

    def as_json(self):
        return {
            'owner': self.owner, 'task': self.task, 'base': self.base, 'scopes': list(self.scopes), 'claimed_at': self.claimed_at,
            'refreshed_at': self.refreshed_at, 'overlap_reason': self.overlap_reason,
        }


class Lane(NamedTuple):
    branch: str | None  # the branch the lane started, or None while the lane rests on a detached origin/main
    sessions: tuple  # one Claim per session, keyed by Claim.owner

    def as_json(self):
        return {'branch': self.branch, 'sessions': [claim.as_json() for claim in self.sessions]}


def normalize_scope(raw):
    """A workspace-relative POSIX path prefix without a trailing slash, or ``.`` for the whole repository.

    Absolute paths and paths that leave the repository are refused.
    """
    text = raw.strip().replace('\\', '/')
    if not text or text.startswith('/'):
        message = "scope '%s' must be a workspace-relative path such as tools/wt.py or apps/web/app/pages/hr" % raw
        raise ClaimError(message)
    normal = posixpath.normpath(text)
    if normal.split('/')[0] == '..':
        message = "scope '%s' must name a path inside the repository" % raw
        raise ClaimError(message)
    return normal


def scopes_overlap(first, second):
    """Whether one path prefix contains the other, compared by whole path segments."""
    if WHOLE_REPOSITORY in (first, second):
        return True
    return first == second or first.startswith(second + '/') or second.startswith(first + '/')


def overlapping(scopes, other_scopes):
    """``[(mine, theirs)]`` for every pair of overlapping scopes."""
    return [(mine, theirs) for mine in scopes for theirs in other_scopes if scopes_overlap(mine, theirs)]


def make_claim(owner, task, base, scopes, now, overlap_reason='', claimed_at=None):
    """A validated claim; ``claimed_at`` keeps the original time when the same owner refreshes it."""
    if not owner.strip():
        message = 'a claim needs an owner (--owner): the session, agent or person that writes in this worktree'
        raise ClaimError(message)
    if not task.strip():
        message = 'a claim needs a task description (--task)'
        raise ClaimError(message)
    if not scopes:
        message = 'a claim needs at least one --scope: the paths this task will change (. for the whole repository)'
        raise ClaimError(message)
    normal = tuple(sorted({normalize_scope(scope) for scope in scopes}))
    start = int(now) if claimed_at is None else int(claimed_at)
    return Claim(owner.strip(), task.strip(), base, normal, start, int(now), overlap_reason.strip())


def claim_path(git_dir):
    return Path(git_dir) / CLAIM_FILE


def claim_from_json(data):
    return Claim(
        owner=data['owner'], task=data['task'], base=data['base'], scopes=tuple(data['scopes']), claimed_at=int(data['claimed_at']),
        refreshed_at=int(data['refreshed_at']), overlap_reason=str(data.get('overlap_reason', '')))


def read_claim(git_dir):
    """The claim stored in ``git_dir``, or ``None`` when the worktree was never claimed."""
    path = claim_path(git_dir)
    if not path.is_file():
        return None
    try:
        return claim_from_json(json.loads(path.read_text(encoding='utf-8')))
    except (ValueError, KeyError, TypeError) as error:
        message = 'unreadable claim %s: %s' % (path, error)
        raise ClaimError(message) from error


def write_claim(git_dir, claim):
    claim_path(git_dir).write_text(json.dumps(claim.as_json(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def is_expired(last_activity, now=None, ttl_hours=CLAIM_TTL_HOURS):
    now = time.time() if now is None else now
    return now - last_activity > ttl_hours * SECONDS_PER_HOUR


def lane_path(git_dir):
    return Path(git_dir) / LANE_FILE


def lane_branch(data):
    branch = data['branch']
    if branch is not None and not isinstance(branch, str):
        message = 'branch must be a string or null'
        raise TypeError(message)
    return branch


def read_lane(git_dir):
    """The lane record stored in ``git_dir``, or ``None`` when the lane was never set up."""
    path = lane_path(git_dir)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return Lane(lane_branch(data), tuple(claim_from_json(item) for item in data['sessions']))
    except (ValueError, KeyError, TypeError) as error:
        message = 'unreadable lane record %s: %s' % (path, error)
        raise ClaimError(message) from error


def write_lane(git_dir, lane):
    """Replace the lane record in one step, so the commit guard never reads a half-written file."""
    path = lane_path(git_dir)
    draft = path.with_name(path.name + '.tmp')
    draft.write_text(json.dumps(lane.as_json(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(draft, path)


@contextlib.contextmanager
def claims_lock(common_git_dir):
    """Hold the repository's claims for one read-check-write; a second claim or release waits its turn.

    Without it two sessions that claim at the same moment both pass the overlap check and the later
    write drops the earlier claim.
    """
    with open(Path(common_git_dir) / CLAIMS_LOCK_FILE, 'w', encoding='utf-8') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def covers(scope, path):
    """Whether the staged ``path`` is the scope or lies below it, compared by whole path segments."""
    return scope == WHOLE_REPOSITORY or path == scope or path.startswith(scope + '/')


def scope_refusal(lane_name, lane, claim, outside):
    """The refusal for staged paths outside ``claim``, naming the session whose claim covers each one."""
    lines = []
    for path in outside:
        holders = [other.owner for other in lane.sessions if other.owner != claim.owner and any(covers(s, path) for s in other.scopes)]
        lines.append('  %s%s' % (path, ' (claimed by session %s)' % ', '.join(holders) if holders else ''))
    template = (
        'staged paths outside the claim of session %s in lane %s (scopes: %s):\n%s\n'
        'unstage them, or widen the claim with: python3 -B tools/wt.py claim --owner %s --scope <every scope>')
    return template % (claim.owner, lane_name, ', '.join(claim.scopes), '\n'.join(lines), claim.owner)


def commit_refusal(lane_name, lane, branch, session, staged, merging):
    """Why a commit in the fixed lane ``lane_name`` is refused, or ``None`` when the session may commit.

    ``branch`` is the checked-out branch (empty when detached), ``session`` the id from ``SESSION_ENV`` and
    ``staged`` every staged path, deletions and both sides of a rename included. A merge in progress is
    exempt from the scope rule only: its paths come from the merged branch, not from the session.
    """
    wt = 'python3 -B tools/wt.py'
    if lane is None:
        return 'lane %s has no record; set it up with: %s lane setup %s' % (lane_name, wt, lane_name)
    if lane.branch is None:
        return 'lane %s is resting; start a branch with: %s lane start %s <branch>' % (lane_name, wt, lane_name)
    if branch != lane.branch:
        template = 'lane %s is on %s but its started branch is %s; another session moved it. Do not commit here; return with: git switch %s'
        return template % (lane_name, branch or 'a detached HEAD', lane.branch, lane.branch)
    if not session:
        return 'no session id; set %s=<owner> on the commit command, the owner used in: %s claim --owner <owner>' % (SESSION_ENV, wt)
    claim = next((item for item in lane.sessions if item.owner == session), None)
    if claim is None:
        template = 'session %s has no claim in lane %s; record one with: %s claim --owner %s --task <what> --scope <path>'
        return template % (session, lane_name, wt, session)
    outside = [path for path in staged if not any(covers(scope, path) for scope in claim.scopes)]
    if outside and not merging:
        return scope_refusal(lane_name, lane, claim, outside)
    return None
