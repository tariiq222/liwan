# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Commit subject and branch name rules (spec section 4 of the reference architecture)."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

TYPES = ('feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'ci', 'build', 'chore')
ARCH_LAYERS = Path(__file__).resolve().parent / 'arch_layers.json'
APP_RANK = 4
FIXED_AREAS = ('core', 'platform', 'api', 'web', 'cp', 'deploy', 'tools', 'docs', 'ci')


def app_areas(layers_path: Path = ARCH_LAYERS) -> tuple[str, ...]:
    """Application areas: the rank-4 addons of arch_layers.json without their `webvue_` prefix."""
    ranks = json.loads(layers_path.read_text(encoding='utf-8')).get('ranks', {})
    return tuple(sorted(name.removeprefix('webvue_') for name, rank in ranks.items() if rank == APP_RANK))


AREAS = (*FIXED_AREAS[:3], *app_areas(), *FIXED_AREAS[3:])
# Commits at or before this one predate the policy and are never checked.
POLICY_START = '7208cf961ecbeb60e988e840fe2ca7cd4c3a3b9d'
MAX_SUBJECT = 72

SUBJECT = re.compile(rf"^(?:{'|'.join(TYPES)})\((?:{'|'.join(AREAS)})\): \S")
SLUG = r'[a-z0-9]+(?:-[a-z0-9]+)*'
TASK_BRANCH = re.compile(rf"^codex/(?:{'|'.join(AREAS)})-{SLUG}$")
SPIKE_BRANCH = re.compile(rf'^spike/{SLUG}$')


def check_subject(subject: str) -> str | None:
    revert = re.fullmatch(r'Revert "(.+)"', subject)
    if revert:
        return check_subject(revert.group(1))
    if re.search(r'\bwip\b', subject, re.IGNORECASE):
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
