"""Close a task: merge gate, clean up its worktree, branch and scratch database, push main.

    python3 -B tools/ship.py codex/<area>-<slug> [--no-push] [--no-clean] [--full]

Runs ``merge_main.merge_branch`` (an already merged branch is fine), then ``wt.py gc --apply --branch``
for that one task, then offers to push main to origin. Running it is the owner's authorization for the
merge and the cleanup of that task only. The push is asked for with ``[y/N]`` and happens only after
an exact ``y``/``yes`` typed on a terminal; with no terminal (agents, CI) it is skipped and the
command to run by hand is printed. It never forces a push and exits 1 on any failure.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import merge_main
import wt

ANSWERS_YES = ('y', 'yes')
PUSH_REF = 'refs/heads/main:refs/heads/main'


class ShipError(RuntimeError):
    """The push step was refused or failed."""


def fetch_origin(main: Path) -> str:
    if 'origin' not in merge_main.git(main, 'remote').splitlines():
        raise ShipError('no origin remote is configured')
    return merge_main.fetch_origin_main(main)


def confirm(count: int) -> bool:
    try:
        answer = input(f'Push {count} commit(s) to origin/main? [y/N] ')
    except EOFError:
        return False
    return answer.strip().lower() in ANSWERS_YES


def push_main(repo: Path) -> None:
    main = merge_main.worktrees(repo)['refs/heads/main']
    remote = fetch_origin(main)
    pending = merge_main.git(main, 'log', '--oneline', 'refs/remotes/origin/main..refs/heads/main')
    if not pending:
        print('ship: main already matches origin/main')
        return
    if merge_main.git(main, 'merge-base', remote, 'refs/heads/main') != remote:
        raise ShipError('main is not a fast-forward of origin/main; integrate origin/main first')
    print(pending)
    if not sys.stdin.isatty():
        print('ship: not a terminal: push skipped; run  git push origin main  yourself')
        return
    if not confirm(len(pending.splitlines())):
        print('ship: push declined; nothing was pushed')
        return
    merge_main.git(main, 'push', 'origin', PUSH_REF)
    pushed = merge_main.git(main, 'rev-parse', 'refs/heads/main')
    if fetch_origin(main) != pushed:
        raise ShipError('origin/main does not match main after the push')
    print(f'ship: pushed {pushed} to origin/main')


def clean_task(branch: str) -> bool:
    try:
        print(wt.gc(wt.repo_root(), True, Path.cwd(), branch))
    except wt.WorktreeKept as error:
        print(f'ship: merged, but the task was not cleaned up:\n{error}', file=sys.stderr)
        return False
    except wt.WorktreeError as error:
        print(f'ship: cleanup failed: {error}', file=sys.stderr)
        return False
    return True


def ship_branch(repo: Path, branch: str, *, clean: bool, push: bool, full: bool = False) -> int:
    try:
        result = merge_main.merge_branch(repo, branch, full=full)
    except merge_main.GateError as error:
        print(f'ship: merge gate stopped: {error}', file=sys.stderr)
        return 1
    print(f"ship: {branch} {result['status']} at {result['commit']}")
    if result.get('candidate_removed') is False:
        print(f"ship: warning: candidate worktree {result['candidate']} was not removed: "
              f"{result['candidate_error']}", file=sys.stderr)
    succeeded = clean_task(branch) if clean else True
    if push:
        try:
            push_main(repo)
        except (merge_main.GateError, ShipError) as error:
            print(f'ship: push failed: {error}', file=sys.stderr)
            return 1
    return 0 if succeeded else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('branch', help='local codex/<area>-<slug> branch')
    parser.add_argument('--no-push', action='store_true', help='do not offer to push main')
    parser.add_argument('--no-clean', action='store_true', help='keep the task worktree, branch and scratch database')
    parser.add_argument('--full', action='store_true', help='run all twelve CI stages whatever the change')
    args = parser.parse_args(argv)
    try:
        with merge_main.terminate_as_interrupt():
            return ship_branch(Path(__file__).resolve().parents[1], args.branch,
                               clean=not args.no_clean, push=not args.no_push, full=args.full)
    except OSError as error:
        print(f'ship: {error}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('ship: interrupted; check git status and npm run wt -- status', file=sys.stderr)
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
