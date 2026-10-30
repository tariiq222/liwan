# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Ownership claims of task worktrees: who owns one, for which task, and which paths it will change.

A claim is ``liwan-claim.json`` in the worktree's own git directory (``.git/worktrees/<id>/``), so
it is never tracked, never shows in ``git status`` and disappears with ``git worktree remove``.
``tools/wt.py`` writes it on ``new``, replaces or refreshes it on ``claim`` and reads it for ``status``,
``check`` and the overlap refusal. A claim whose worktree saw no activity (commit, edited file or
claim refresh) for ``CLAIM_TTL_HOURS`` is expired: it is still listed, but its scopes no longer block.
"""
from __future__ import annotations

import json
import posixpath
import time
from pathlib import Path
from typing import NamedTuple

CLAIM_FILE = 'liwan-claim.json'
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


def read_claim(git_dir):
    """The claim stored in ``git_dir``, or ``None`` when the worktree was never claimed."""
    path = claim_path(git_dir)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return Claim(
            owner=data['owner'], task=data['task'], base=data['base'], scopes=tuple(data['scopes']), claimed_at=int(data['claimed_at']),
            refreshed_at=int(data['refreshed_at']), overlap_reason=str(data.get('overlap_reason', '')))
    except (ValueError, KeyError, TypeError) as error:
        message = 'unreadable claim %s: %s' % (path, error)
        raise ClaimError(message) from error


def write_claim(git_dir, claim):
    claim_path(git_dir).write_text(json.dumps(claim.as_json(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def is_expired(last_activity, now=None, ttl_hours=CLAIM_TTL_HOURS):
    now = time.time() if now is None else now
    return now - last_activity > ttl_hours * SECONDS_PER_HOUR
