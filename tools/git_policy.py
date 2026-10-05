# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Commit subject and branch name rules (spec section 4 of the reference architecture)."""
from __future__ import annotations

import argparse
import re
import subprocess
import sys

TYPES = ('feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'ci', 'build', 'chore')
AREAS = ('core', 'platform', 'api', 'pmo', 'hr', 'chat', 'web', 'cp', 'deploy', 'tools', 'docs', 'ci')
# Commits at or before this one predate the policy and are never checked.
POLICY_START = '7208cf961ecbeb60e988e840fe2ca7cd4c3a3b9d'
MAX_SUBJECT = 72

SUBJECT = re.compile(rf"^(?:{'|'.join(TYPES)})\((?:{'|'.join(AREAS)})\): \S")
SLUG = r'[a-z0-9]+(?:-[a-z0-9]+)*'
TASK_BRANCH = re.compile(rf"^codex/(?:{'|'.join(AREAS)})-{SLUG}$")
SPIKE_BRANCH = re.compile(rf'^spike/{SLUG}$')


def check_subject(subject: str) -> str | None:
    if subject.startswith(('Merge ', 'Revert "')):
        return None
    if re.match(r'wip\b', subject, re.IGNORECASE):
        return 'wip commits stay on the task branch and are squashed or reworded before merge'
    if not SUBJECT.match(subject):
        return f"expected 'type(scope): subject' with type in {TYPES} and scope in {AREAS}"
    if len(subject) > MAX_SUBJECT:
        return f'subject is {len(subject)} characters, limit is {MAX_SUBJECT}'
    return None


def check_branch(name: str) -> str | None:
    if name in ('main', 'HEAD') or TASK_BRANCH.match(name) or SPIKE_BRANCH.match(name):
        return None
    return f"branch '{name}' must be main, codex/<area>-<slug> or spike/<slug>; areas: {AREAS}"


def _git(*args: str) -> str:
    done = subprocess.run(['git', *args], capture_output=True, text=True, check=False, shell=False)
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout


def commits(base: str) -> list[tuple[str, str]]:
    out = _git('log', '--no-merges', '--format=%h%x09%s', f'{base}..HEAD', f'^{POLICY_START}')
    return [tuple(line.split('\t', 1)) for line in out.splitlines() if line]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='git ref to compare against, e.g. origin/main')
    args = parser.parse_args(argv)
    try:
        problems = []
        branch_problem = check_branch(_git('rev-parse', '--abbrev-ref', 'HEAD').strip())
        if branch_problem:
            problems.append(branch_problem)
        for sha, subject in commits(args.base):
            problem = check_subject(subject)
            if problem:
                problems.append(f'{sha} {subject!r}: {problem}')
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 2
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
