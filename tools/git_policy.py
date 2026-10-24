# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Commit subject and branch name rules (spec section 4 of the reference architecture).

Task branches also never change the generated API files (docs/api/openapi.json and
docs/api/route-capabilities.json): the orchestrator regenerates them once at integration, so
parallel branches do not conflict on them.
"""
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
GENERATED = ('docs/api/openapi.json', 'docs/api/route-capabilities.json')
# Branches that may carry regenerated files: main and any orchestrator integration branch.
INTEGRATION_BRANCH = re.compile(r'^[A-Za-z0-9._-]+/tools-integrate-.+$')
# Any normal task branch is accepted: the owner chooses the name, so no prefix or area is
# required. Only a malformed ref (or main/HEAD itself) is reported.
BRANCH_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._/-]*$')

SUBJECT = re.compile(rf"^(?:{'|'.join(TYPES)})\((?:{'|'.join(AREAS)})\): \S")


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
    """Accept any normal branch name; only a ref Git would reject is a violation."""
    if not BRANCH_NAME.match(name) or '..' in name or '//' in name or name.endswith(('.', '/')):
        return f"branch '{name}' is not a valid branch name"
    return None


def check_generated_commits(branch: str, touching: dict[str, list[str]]) -> list[str]:
    """Problems for the commits of ``branch`` (``{generated path: [sha, ...]}``) that modify a generated file."""
    if branch == 'main' or INTEGRATION_BRANCH.match(branch):
        return []
    return [
        f'{sha}: task branch {branch} must not modify {path}; the orchestrator '
        f'regenerates it at integration (python3 tools/api_surface.py on <prefix>/tools-integrate-*)'
        for path, shas in touching.items() for sha in shas
    ]


def _git(*args: str) -> str:
    done = subprocess.run(['git', *args], capture_output=True, text=True, check=False, shell=False)
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout


def commits(base: str) -> list[tuple[str, str]]:
    out = _git('log', '--no-merges', '--format=%h%x09%s', f'{base}..HEAD', f'^{POLICY_START}')
    return [tuple(line.split('\t', 1)) for line in out.splitlines() if line]


def generated_commits(base: str) -> dict[str, list[str]]:
    return {
        path: _git('log', '--no-merges', '--format=%h', f'{base}..HEAD', f'^{POLICY_START}', '--', path).split()
        for path in GENERATED
    }


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
        problems.extend(check_generated_commits(branch, generated_commits(args.base)))
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
