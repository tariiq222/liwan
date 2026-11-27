# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Commit subject, branch name and silent-revert rules (spec section 4 of the reference architecture)."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Iterable
from pathlib import Path

TYPES = ('feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'ci', 'build', 'chore')
ARCH_LAYERS = Path(__file__).resolve().parent / 'arch_layers.json'
APP_RANK = 4
FIXED_AREAS = ('core', 'platform', 'api', 'web', 'cp', 'deploy', 'tools', 'docs', 'ci')


def app_areas(layers_path: Path = ARCH_LAYERS) -> tuple[str, ...]:
    """Application areas: the rank-4 addons of arch_layers.json without their `liwan_` prefix."""
    ranks = json.loads(layers_path.read_text(encoding='utf-8')).get('ranks', {})
    return tuple(sorted(name.removeprefix('liwan_') for name, rank in ranks.items() if rank == APP_RANK))


AREAS = (*FIXED_AREAS[:3], *app_areas(), *FIXED_AREAS[3:])
# Commits at or before this one predate the policy and are never checked.
POLICY_START = '7208cf961ecbeb60e988e840fe2ca7cd4c3a3b9d'
MAX_SUBJECT = 72

SUBJECT = re.compile(rf"^(?:{'|'.join(TYPES)})\((?:{'|'.join(AREAS)})\): \S")

# A staged change that reverses a recent main commit without saying so is a lost merge, not an edit.
ZERO_SHA = '0' * 40
REVERT_WINDOW = 25
REVERTS_TRAILER = re.compile(r'^\s*Reverts:\s*([0-9a-fA-F]{7,40})\b', re.MULTILINE)
# The body line `git revert` writes; with the trailer it names the commit a change intends to undo.
THIS_REVERTS = re.compile(r'^\s*This reverts commit ([0-9a-fA-F]{7,40})\b', re.MULTILINE)
REVERT_SUBJECT = re.compile(r'Revert "(.+)"')


def check_subject(subject: str) -> str | None:
    revert = REVERT_SUBJECT.fullmatch(subject)
    if revert:
        return check_subject(revert.group(1))
    if re.search(r'\bwip\b', subject, re.IGNORECASE):
        return "wip commits stay on the task branch and are reworded before merge; never rewrite another worker's history"
    if not SUBJECT.match(subject):
        return f"expected 'type(scope): subject' with type in {TYPES} and scope in {AREAS}"
    if len(subject) > MAX_SUBJECT:
        return f'subject is {len(subject)} characters, limit is {MAX_SUBJECT}'
    return None


def check_branch(name: str) -> str | None:
    """Accept any normal branch name; only a ref Git would reject is a violation."""
    if name == 'HEAD':  # rev-parse --abbrev-ref uses this for detached CI checkouts.
        return None
    # Check a literal full ref, so @{-1} cannot expand to a previous branch.
    valid = subprocess.run(['git', 'check-ref-format', 'refs/heads/' + name],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode == 0
    if name.startswith('-') or not valid:
        return f"branch '{name}' is not a valid branch name"
    return None


def _git(*args: str, cwd: Path | None = None) -> str:
    done = subprocess.run(['git', *args], capture_output=True, text=True, check=False, shell=False, cwd=cwd)
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout


def _ref_exists(ref: str, cwd: Path | None) -> bool:
    done = subprocess.run(['git', 'rev-parse', '-q', '--verify', ref],
                          capture_output=True, text=True, check=False, cwd=cwd)
    return done.returncode == 0


def _merge_base(base: str, head: str, cwd: Path | None) -> str | None:
    """The common ancestor, or ``None`` when git cannot compute one (unrelated or shallow history)."""
    done = subprocess.run(['git', 'merge-base', base, head], capture_output=True, text=True, check=False, cwd=cwd)
    return done.stdout.strip() if done.returncode == 0 else None


def commits(base: str) -> list[tuple[str, str]]:
    out = _git('log', '--no-merges', '--format=%h%x09%s', f'{base}..HEAD', f'^{POLICY_START}')
    return [tuple(line.split('\t', 1)) for line in out.splitlines() if line]


def parse_raw_diff(output: str) -> dict[str, tuple[str, str]]:
    """``{path: (before_blob, after_blob)}`` of `git diff --raw --no-renames --no-abbrev` output."""
    changes = {}
    for line in output.splitlines():
        if not line.startswith(':'):
            continue
        meta, _, path = line.partition('\t')
        fields = meta[1:].split()
        if len(fields) < 5 or not path:
            continue
        changes[path] = (fields[2], fields[3])
    return changes


def parse_first_parent_history(output: str) -> list[dict]:
    """Newest-first commits of `git log --first-parent -m --raw --format=COMMIT...`, never past POLICY_START."""
    history: list[dict] = []
    commit = None
    for line in output.splitlines():
        if line.startswith('COMMIT\t'):
            sha, parents, subject = line[len('COMMIT\t'):].split('\t', 2)
            if sha == POLICY_START:
                break
            if any(entry['sha'] == sha for entry in history):
                commit = None  # a merge that printed a second section: keep the first section only
                continue
            commit = {'sha': sha, 'parents': parents.split(), 'subject': subject, 'changes': {}}
            history.append(commit)
        elif commit is not None:
            commit['changes'].update(parse_raw_diff(line))
    return history


def acknowledged_reverts(messages: Iterable[str]) -> tuple[set[str], set[str]]:
    """Inner subjects of `Revert "..."` commits, and the lowered `Reverts:`/`This reverts commit` sha prefixes."""
    subjects: set[str] = set()
    prefixes = set()
    for message in messages:
        lines = [line for line in message.splitlines() if line.strip() and not line.lstrip().startswith('#')]
        revert = REVERT_SUBJECT.fullmatch(lines[0].strip()) if lines else None
        if revert:
            subjects.add(revert.group(1))
        prefixes.update(match.lower() for match in REVERTS_TRAILER.findall(message))
        prefixes.update(match.lower() for match in THIS_REVERTS.findall(message))
    return subjects, prefixes


def _silent_revert_problem(sha: str, subject: str, undone: list[str], total: int) -> str:
    listing = ', '.join(undone[:5]) + (' ...' if len(undone) > 5 else '')
    return (f'{sha[:9]} {subject!r} is silently reverted ({len(undone)}/{total} files: {listing}); '
            'a stale tree after `git reset --soft origin/main` does this. '
            f'Rebase onto the target branch with `git rebase origin/main`; if the reversal is intentional, '
            f'use `git revert` or add a `Reverts: {sha[:9]}` trailer.')


def find_silent_reverts(diff_changes: dict[str, tuple[str, str]], history: list[dict],
                        messages: Iterable[str]) -> list[str]:
    """Commits of ``history`` whose change this diff undoes without a `Revert`/`Reverts:` acknowledgement."""
    reverted_subjects, prefixes = acknowledged_reverts(messages)
    undone: dict[str, list[tuple[str, str]]] = {}
    for path, (base_blob, new_blob) in diff_changes.items():
        if base_blob == new_blob:
            continue
        for entry in history:
            change = entry['changes'].get(path)
            if change is None:
                continue
            before, after = change
            if before != after and new_blob == before:
                undone.setdefault(entry['sha'], []).append((path, before))
                break
    problems = []
    for entry in history:
        restored = undone.get(entry['sha'])
        if not restored:
            continue
        # Acknowledged by its own subject, by its sha, or by the merged branch head of a merge commit.
        # Never by `parents[0]`: that is the previous main commit, so `Reverts: <older main sha>` would
        # otherwise acknowledge the next merge on main.
        acknowledged = entry['subject'] in reverted_subjects or any(
            candidate.startswith(prefix) for prefix in prefixes
            for candidate in (entry['sha'], *entry['parents'][1:]))
        if acknowledged:
            continue
        # A modification or deletion restored to its exact pre-commit blob, or every file of the commit undone:
        # the second case catches clobbering a pure-add PR, and the first avoids flagging a later partial cleanup.
        exact = any(before != ZERO_SHA for _, before in restored)
        complete = len(restored) == len(entry['changes']) and bool(entry['changes'])
        if exact or complete:
            problems.append(_silent_revert_problem(entry['sha'], entry['subject'],
                                                    sorted(path for path, _ in restored), len(entry['changes'])))
    return problems


def check_branch_silent_reverts(base: str, head: str = 'HEAD', *, cwd: Path | None = None,
                                window: int = REVERT_WINDOW) -> list[str]:
    """Silent reverts of recent ``base`` commits in ``base..head``."""
    merge_base = _merge_base(base, head, cwd)
    if merge_base is None:
        return []
    diff_changes = parse_raw_diff(_git('-c', 'core.quotepath=false', 'diff', '--raw', '--no-renames',
                                       '--no-abbrev', merge_base, head, cwd=cwd))
    if not diff_changes:
        return []
    history = parse_first_parent_history(_git(
        '-c', 'core.quotepath=false', 'log', '--first-parent', '-m', '-n', str(window), '--raw', '--no-renames',
        '--no-abbrev', '--format=COMMIT\t%H\t%P\t%s', merge_base, cwd=cwd))
    messages = _git('log', '--format=%B%x00', f'{merge_base}..{head}', cwd=cwd).split('\x00')
    return find_silent_reverts(diff_changes, history, messages)


def check_staged_silent_reverts(message: str, *, base_ref: str = 'origin/main', cwd: Path | None = None,
                                window: int = REVERT_WINDOW) -> list[str]:
    """Silent reverts of recent ``base_ref`` commits in the index about to be committed with ``message``."""
    lines = [line for line in message.splitlines() if line.strip() and not line.lstrip().startswith('#')]
    if lines and lines[0].strip().startswith('Merge '):
        return []
    if not (_ref_exists('HEAD', cwd) and _ref_exists(base_ref, cwd)):
        return []
    anchor = _merge_base(base_ref, 'HEAD', cwd)
    if anchor is None:
        return []
    diff_changes = parse_raw_diff(_git('-c', 'core.quotepath=false', 'diff', '--cached', '--raw', '--no-renames',
                                       '--no-abbrev', 'HEAD', cwd=cwd))
    if not diff_changes:
        return []
    if _git('rev-parse', 'HEAD', cwd=cwd).strip() != anchor:
        # Editing or amending a file the feature branch already changed is not a revert.
        owned = _git('-c', 'core.quotepath=false', 'diff', '--name-only', anchor, 'HEAD', cwd=cwd).splitlines()
        diff_changes = {path: blobs for path, blobs in diff_changes.items() if path not in set(owned)}
        if not diff_changes:
            return []
    history = parse_first_parent_history(_git(
        '-c', 'core.quotepath=false', 'log', '--first-parent', '-m', '-n', str(window), '--raw', '--no-renames',
        '--no-abbrev', '--format=COMMIT\t%H\t%P\t%s', anchor, cwd=cwd))
    return find_silent_reverts(diff_changes, history, [message])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='git ref to compare against, e.g. origin/main')
    args = parser.parse_args(argv)
    try:
        problems = []
        branch = _git('rev-parse', '--abbrev-ref', 'HEAD').strip()
        branch_problem = check_branch(branch)
        if branch_problem:
            problems.append(branch_problem)
        for sha, subject in commits(args.base):
            problem = check_subject(subject)
            if problem:
                problems.append(f'{sha} {subject!r}: {problem}')
        problems.extend(check_branch_silent_reverts(args.base))
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 2
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
