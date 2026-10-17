"""Prepare, check and accept an exact local no-ff merge commit without pushing."""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import signal
import subprocess
import sys
import uuid
from pathlib import Path

from git_policy import check_branch


class GateError(RuntimeError):
    """A prerequisite or check failed; promotion is forbidden."""


def git(repo: Path, *args: str) -> str:
    try:
        result = subprocess.run(['git', *args], cwd=repo, capture_output=True,
                                text=True, timeout=180, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GateError(f'git could not run: {error}') from error
    if result.returncode:
        raise GateError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.rstrip('\n')


FETCH_MAIN_REF = 'refs/heads/main:refs/remotes/origin/main'


@contextlib.contextmanager
def terminate_as_interrupt():
    """Turn SIGTERM into KeyboardInterrupt so cleanup and report writing still run."""
    def interrupted(signum, frame):
        raise KeyboardInterrupt(f'interrupted by signal {signum}')
    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


def fetch_origin_main(main: Path) -> str:
    """Fetch origin's main and return its commit."""
    git(main, 'fetch', '--no-tags', 'origin', FETCH_MAIN_REF)
    return git(main, 'rev-parse', 'refs/remotes/origin/main')


def worktrees(repo: Path) -> dict[str, Path]:
    found = {}
    current = None
    for entry in git(repo, 'worktree', 'list', '--porcelain', '-z').split('\0'):
        if entry.startswith('worktree '):
            current = Path(entry[len('worktree '):])
        elif entry.startswith('branch ') and current is not None:
            found[entry[len('branch '):]] = current
    return found


def require_clean(repo: Path, label: str, *, untracked: bool) -> None:
    status = git(repo, 'status', '--porcelain=v1', '-z',
                 '--untracked-files=all' if untracked else '--untracked-files=no')
    if status:
        raise GateError(f'{label} must be clean; preserve or commit its changes first')
    for marker in ('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'):
        location = Path(git(repo, 'rev-parse', '--git-path', marker))
        if not location.is_absolute():
            location = repo / location
        if location.exists():
            raise GateError(f'{label} has an unfinished Git operation: {marker}')


def require_replaceable_directory(main: Path, path: Path, base_files: set[str]) -> None:
    """A tracked directory can disappear only when it contains no extra local data."""
    def cannot_read(error):
        raise GateError(f'cannot inspect local directory collision: {error}') from error

    for current, dirs, files in os.walk(path, followlinks=False, onerror=cannot_read):
        for name in dirs + files:
            child = Path(current) / name
            relative = child.relative_to(main).as_posix()
            if child.is_dir() and not child.is_symlink():
                if any(tracked.startswith(relative + '/') for tracked in base_files):
                    continue
            elif relative in base_files:
                continue
            raise GateError(f'untracked/ignored directory content collision: {relative}')
    prefix = path.relative_to(main).as_posix() + '/'
    if not any(tracked.startswith(prefix) for tracked in base_files):
        raise GateError(f'untracked directory collision: {path.relative_to(main)}')


def require_no_collisions(main: Path, base: str, commit: str) -> None:
    base_files = set(filter(None, git(main, 'ls-tree', '-r', '--name-only', '-z', base).split('\0')))
    next_files = set(filter(None, git(main, 'ls-tree', '-r', '--name-only', '-z', commit).split('\0')))
    added = git(main, 'diff', '--name-only', '--diff-filter=A', '--no-renames', '-z', base, commit)
    changed = git(main, 'diff', '--name-only', '--no-renames', '-z', base, commit)
    for name in filter(None, changed.split('\0')):
        path = main / name
        for parent in path.relative_to(main).parents:
            ancestor = main / parent
            if ancestor.is_symlink():
                raise GateError(f'symlink parent collision: {name}')
            if os.path.lexists(ancestor) and not ancestor.is_dir():
                relative = parent.as_posix()
                if relative not in base_files or relative in next_files:
                    raise GateError(f'non-directory parent collision: {name}')
    for name in filter(None, added.split('\0')):
        path = main / name
        if os.path.lexists(path):
            if path.is_dir() and not path.is_symlink():
                require_replaceable_directory(main, path, base_files)
            else:
                raise GateError(f'untracked/ignored path collision: {name}')


@contextlib.contextmanager
def merge_lock(main: Path):
    common = Path(git(main, 'rev-parse', '--git-common-dir'))
    if not common.is_absolute():
        common = main / common
    with (common / 'webvue-merge.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise GateError('another local main merge gate is running') from error
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def verify_candidate(candidate: Path, base: str, commit: str, report_dir: Path) -> None:
    runner = candidate / 'tools/local_ci.py'
    if not runner.is_file():
        raise GateError('local CI runner is missing from the candidate')
    report_dir.mkdir()
    command = [sys.executable, '-B', str(runner), '--base', base, '--commit', commit,
               '--report-dir', str(report_dir)]
    with (report_dir / 'runner.log').open('w') as log:
        try:
            process = subprocess.Popen(command, cwd=candidate, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as error:
            raise GateError(f'local CI runner could not start: {error}') from error
        try:
            code = process.wait()
        except BaseException:
            # Signal only the process group created for this gate's verifier.
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            raise
    if code:
        raise GateError(f'local CI runner failed ({code}); see {report_dir}')
    try:
        receipt = json.loads((report_dir / 'report.json').read_text())
    except (OSError, ValueError) as error:
        raise GateError(f'local CI runner receipt is missing or invalid: {report_dir}') from error
    if (receipt.get('base'), receipt.get('commit'), receipt.get('status')) != (base, commit, 'passed'):
        raise GateError('local CI runner did not certify this exact candidate')


def remove_candidate(main: Path, candidate: Path, result: dict) -> None:
    """Drop the detached candidate once main holds its commit; reports and checks stay."""
    try:
        git(main, 'worktree', 'remove', '--force', str(candidate))
    except GateError as error:
        result.update(candidate_removed=False, candidate_error=str(error))
    else:
        result['candidate_removed'] = True


def merge_branch(repo: Path, source: str) -> dict:
    if not source.startswith('codex/') or check_branch(source):
        raise GateError('source must be a local codex/<area>-<slug> task branch')
    trees = worktrees(repo)
    main = trees.get('refs/heads/main')
    if main is None:
        raise GateError('main must have a local checkout')
    main = main.resolve()
    with merge_lock(main):
        if git(main, 'symbolic-ref', 'HEAD') != 'refs/heads/main':
            raise GateError('main checkout must be on main')
        require_clean(main, 'main', untracked=False)
        source_tree = trees.get(f'refs/heads/{source}')
        if source_tree:
            require_clean(source_tree, 'source worktree', untracked=True)
        source_sha = git(main, 'rev-parse', '--verify', f'refs/heads/{source}^{{commit}}')
        if 'origin' in git(main, 'remote').splitlines():
            remote = fetch_origin_main(main)
            if git(main, 'merge-base', remote, 'refs/heads/main') != remote:
                raise GateError('main is behind or diverged from origin/main; integrate it first')
        base = git(main, 'rev-parse', 'refs/heads/main')
        if git(main, 'merge-base', base, source_sha) == source_sha:
            return {'status': 'already_merged', 'commit': base, 'source': source_sha}
        scratch = main / '.superpowers' / 'merge-main'
        for path in (main / '.superpowers', scratch):
            if path.is_symlink():
                raise GateError(f'refusing symlink report directory: {path}')
        # Require the repository's ignore rule, rather than hiding files ourselves.
        if not git(main, 'check-ignore', '.superpowers/merge-main/probe'):
            raise GateError('merge report directory must be ignored')
        run_dir = scratch / uuid.uuid4().hex
        run_dir.mkdir(parents=True)
        candidate = run_dir / 'candidate'
        report_path = run_dir / 'merge.json'
        result = {'status': 'preparing', 'base': base, 'source': source_sha,
                  'branch': source, 'main': str(main), 'candidate': str(candidate),
                  'report': str(report_path)}
        try:
            git(main, 'worktree', 'add', '--detach', str(candidate), base)
            git(candidate, 'merge', '--no-ff', '--no-edit', '-m', f"Merge branch '{source}'", source_sha)
            commit = git(candidate, 'rev-parse', 'HEAD')
            result.update(commit=commit, tree=git(candidate, 'rev-parse', 'HEAD^{tree}'))
            require_no_collisions(main, base, commit)
            result['status'] = 'checking'
            report_path.write_text(json.dumps(result, indent=2) + '\n')
            verify_candidate(candidate, base, commit, run_dir / 'checks')
            require_clean(candidate, 'candidate', untracked=True)
            if git(candidate, 'rev-parse', 'HEAD') != commit:
                raise GateError('candidate moved during checks')
            if git(main, 'rev-parse', 'refs/heads/main') != base:
                raise GateError('main moved during checks; rebuild against its new tip')
            if git(main, 'rev-parse', f'refs/heads/{source}') != source_sha:
                raise GateError('source moved during checks; rebuild against its new tip')
            if git(main, 'symbolic-ref', 'HEAD') != 'refs/heads/main':
                raise GateError('main checkout changed branch during checks')
            require_clean(main, 'main', untracked=False)
            current_source = worktrees(main).get(f'refs/heads/{source}')
            if current_source:
                require_clean(current_source, 'source worktree', untracked=True)
            require_no_collisions(main, base, commit)
            # This is the existing no-ff commit checked above, never a new merge.
            result['status'] = 'promoting'
            report_path.write_text(json.dumps(result, indent=2) + '\n')
            git(main, 'merge', '--ff-only', '--no-edit', commit)
            result['status'] = 'promoted'
            if git(main, 'rev-parse', 'HEAD') != commit:
                raise GateError('main changed during promotion; inspect its actual state')
            require_clean(main, 'main after promotion', untracked=False)
            result['status'] = 'merged'
        except BaseException as error:
            promotion_started = result['status'] in ('promoting', 'promoted')
            result.update(status='promotion_interrupted' if promotion_started else 'failed',
                          error=str(error) or type(error).__name__)
            if promotion_started:
                result['actual_main'] = git(main, 'rev-parse', 'refs/heads/main')
            raise
        finally:
            report_path.write_text(json.dumps(result, indent=2) + '\n')
        # Main already holds the commit; an interrupt here must not turn the report into a failure.
        remove_candidate(main, candidate, result)
        report_path.write_text(json.dumps(result, indent=2) + '\n')
        return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('branch', help='local codex/<area>-<slug> branch')
    args = parser.parse_args(argv)

    try:
        with terminate_as_interrupt():
            result = merge_branch(Path(__file__).resolve().parents[1], args.branch)
    except (GateError, OSError, KeyboardInterrupt) as error:
        print(f'Merge gate stopped: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
