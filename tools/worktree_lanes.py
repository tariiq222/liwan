# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The lane pool: permanent worktrees under ``.worktrees/``, each held by one task at a time.

A lane is a worktree of ``<main checkout>/.worktrees/`` whose own git directory (``.git/worktrees/<id>/``) holds
``liwan-take.json``. The record is never tracked, never shows in ``git status`` and disappears with the worktree.
One task is one branch and one lane, taken by its orchestrator for the workers. ``tools/wt.py`` writes the record on ``lane add``,
``take`` and ``done``; ``take`` and ``lane add`` run under ``pool_lock`` so two sessions cannot take the same lane.
``commit_refusal`` is the rule behind the pre-commit guard of ``tools/hooks.py``.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
from pathlib import Path
from typing import NamedTuple

TAKE_FILE = 'liwan-take.json'
POOL_LOCK_FILE = 'liwan-lane-pool.lock'  # in the shared git directory, one lock for every take or add
WORKTREES_DIR = '.worktrees'
MAIN = 'main'
LANE_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]*')


class LaneError(Exception):
    """A refused or unreadable lane record; the message is shown to the user."""


class Take(NamedTuple):
    branch: str | None  # the branch the lane holds, or None while it rests on a detached origin/main
    holder: str | None  # the session, agent or person writing in the lane
    task: str | None
    taken_at: int | None
    lock_hash: str | None  # hash of package-lock.json at the last dependency install
    orchestrator: str | None = None  # the session that took the lane for a worker and closes it at the end

    @property
    def occupied(self):
        return self.branch is not None

    def as_json(self):
        return self._asdict()


def resting(lock_hash=None):
    return Take(None, None, None, None, lock_hash)


def validate_name(name):
    if not LANE_NAME.fullmatch(name):
        message = "'%s' is not a lane name: use letters, digits, - and _ (one folder name under %s/)" % (name, WORKTREES_DIR)
        raise LaneError(message)
    return name


def take_path(git_dir):
    return Path(git_dir) / TAKE_FILE


def optional_text(data, key):
    value = data[key]
    if value is not None and not isinstance(value, str):
        message = '%s must be a string or null' % key
        raise TypeError(message)
    return value


def take_from_json(data):
    taken_at = data['taken_at']
    if taken_at is not None and not isinstance(taken_at, int):
        message = 'taken_at must be an integer or null'
        raise TypeError(message)
    return Take(
        optional_text(data, 'branch'), optional_text(data, 'holder'), optional_text(data, 'task'), taken_at,
        optional_text(data, 'lock_hash'), optional_text(data, 'orchestrator') if 'orchestrator' in data else None)


def read_take(git_dir):
    """The record stored in ``git_dir``, or ``None`` when the worktree is not a lane."""
    path = take_path(git_dir)
    if not path.is_file():
        return None
    try:
        return take_from_json(json.loads(path.read_text(encoding='utf-8')))
    except (ValueError, KeyError, TypeError) as error:
        message = 'unreadable lane record %s: %s' % (path, error)
        raise LaneError(message) from error


def write_take(git_dir, take):
    """Replace the record in one step, so the commit guard never reads a half-written file."""
    path = take_path(git_dir)
    draft = path.with_name(path.name + '.tmp')
    draft.write_text(json.dumps(take.as_json(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(draft, path)


@contextlib.contextmanager
def pool_lock(common_git_dir):
    """Hold the lane pool for one read-check-write; a second take or add waits its turn."""
    with open(Path(common_git_dir) / POOL_LOCK_FILE, 'w', encoding='utf-8') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def lane_name_of(root, path):
    """The lane name when ``path`` is a direct child of ``<root>/.worktrees``, else ``None``."""
    path = Path(path).resolve()
    pool = (Path(root) / WORKTREES_DIR).resolve()
    return path.name if path.parent == pool else None


def commit_refusal(branch, take, linked):
    """Why a commit is refused, or ``None`` when it may proceed.

    ``branch`` is the checked-out branch (empty when detached), ``take`` the lane record of the checkout
    (``None`` when it has none) and ``linked`` whether the checkout is a linked worktree. The main checkout on a
    branch other than ``main`` is not refused.
    """
    wt = 'npm run wt --'
    if branch == MAIN:
        return 'the checked-out branch is main; commit on a task branch: %s take <branch> --holder <who> --orchestrator <id>' % wt
    if take is None:
        if linked:
            template = (
                'this worktree is not a lane; add it with: %s lane add <name> --holder <who> --orchestrator <id> --task <what>, '
                'or take a free lane with: %s take <branch> --holder <who> --orchestrator <id>')
            return template % (wt, wt)
        return None
    if not take.occupied:
        return 'this lane is resting; take it for a branch with: %s take <branch> --holder <who> --orchestrator <id> --lane <name>' % wt
    if branch != take.branch:
        template = 'this lane holds %s but %s is checked out; another session moved it. Do not commit here; return with: git switch %s'
        return template % (take.branch, branch or 'a detached HEAD', take.branch)
    return None
