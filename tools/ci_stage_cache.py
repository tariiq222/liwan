"""Skip a CI job that already passed on exactly the same inputs.

    python3 -B tools/ci_stage_cache.py key --stage S [--extra E] [--commit REF]
    python3 -B tools/ci_stage_cache.py plan [--reuse-passes] --stages JSON --odoo-shards JSON --e2e-mock-shards JSON \\
        --rtl-stories-shards JSON --apps JSON --bridges JSON [--odoo-modules CSV]
    python3 -B tools/ci_stage_cache.py e2e-mock-shards   # JSON array of the e2e-mock shard numbers, for the workflow matrix
    python3 -B tools/ci_stage_cache.py rtl-stories-shards   # the same for the rtl-stories matrix

Only pull requests and merge-queue entries enable pass reuse.
``key`` prints the cache key a stage job saves when it passes: a hash of the tracked files the stage can
read (the ``RULES`` of ``tools/ci_scope.py``, where an addon file reaches only the Odoo stages, as in
``ci_scope.pull_request_stages``) and the matrix entry (``--extra``). ``plan`` prints the stages and matrix jobs still required, plus the
jobs whose results are reused. A shard retains its original total even when other shards are omitted.
``static`` is never cached: ``ci-result`` requires it.

Keys are read with the GitHub API and trusted only from the current ref. A failed lookup is
reported on stderr and reuses nothing.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import ci_scope

VERSION = 'v2'
KEY_PREFIX = f'ci-pass-{VERSION}-'
NEVER_CACHED = ('static',)
# The Odoo stages and `e2e-odoo` are the only stages an addon file can reach in a pull request
# (`ci_scope.pull_request_stages` leaves every other stage to the push to main).
ADDON_STAGES = (*ci_scope.ODOO_STAGES, 'e2e-odoo')
# The `e2e-mock` jobs: shard k of len(E2E_MOCK_SHARDS) of `deploy/ci/e2e-mock.sh --shard k/N`.
E2E_MOCK_SHARDS = [1, 2, 3]
# The `rtl-stories` jobs: shard k of len(RTL_STORIES_SHARDS) of `deploy/ci/rtl-stories.sh --shard k/N`.
RTL_STORIES_SHARDS = [1, 2, 3, 4]

Entry = tuple[str, str, str]  # (file mode, blob sha, path)


class CacheLookupError(RuntimeError):
    """The existing cache keys could not be read."""


@functools.cache
def rule_stages(path: str) -> tuple[str, ...]:
    return ci_scope.matching_rule(path)[1]


def is_addon_file(path: str) -> bool:
    return path.startswith('odoo-addons/') and path.count('/') >= 2


def is_input(path: str, stage: str) -> bool:
    """Whether a change to this tracked file can change the result of the stage."""
    if stage == 'static':
        return True
    if stage not in rule_stages(path):
        return False
    return not (is_addon_file(path) and stage not in ADDON_STAGES)


def tree_entries(repo: Path, commit: str) -> list[Entry]:
    try:
        listing = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-r', '-z', commit],
                                          stderr=subprocess.PIPE)
    except (OSError, subprocess.CalledProcessError) as error:
        raise CacheLookupError(f'cannot list the files of {commit}: {error}') from error
    entries = []
    for line in filter(None, listing.decode().split('\0')):
        meta, path = line.split('\t', 1)
        file_mode, _kind, sha = meta.split(' ')
        entries.append((file_mode, sha, path))
    return sorted(entries, key=lambda entry: entry[2])


def digest(entries: list[Entry], stage: str, extra: str = '') -> str:
    if stage not in ci_scope.STAGES:
        raise ValueError(f'unknown stage {stage!r}')
    hasher = hashlib.sha256('\0'.join((VERSION, stage, extra, '')).encode())
    for file_mode, sha, path in entries:
        if is_input(path, stage):
            hasher.update(f'{file_mode} {sha} {path}\0'.encode())
    return hasher.hexdigest()


def fingerprint(repo: Path, stage: str, extra: str = '', commit: str = 'HEAD') -> str:
    return digest(tree_entries(repo, commit), stage, extra)


def cache_key(stage: str, extra: str, tree_digest: str) -> str:
    return f'{KEY_PREFIX}{stage}-{hashlib.sha256(extra.encode()).hexdigest()[:12]}-{tree_digest}'


def shard_jobs(shards: list[int]) -> list[dict]:
    return [{'shard': shard, 'total': len(shards)} for shard in shards]


def job_extra(stage: str, job: dict, modules: str) -> str:
    """Match the cache key suffix saved by the corresponding workflow job."""
    if 'shard' in job:
        shard = f"{job['shard']}/{job['total']}"
        return f'{shard}|{modules}' if stage == 'odoo' else shard
    if 'group' in job:
        return f"{job['group']}|{modules}"
    return ''


def run_plan(entries: list[Entry], stages: list[str], existing: set[str], matrices: dict,
             modules: str) -> dict:
    pending_stages = []
    pending_matrices = {}
    reused = {}
    for stage in stages:
        jobs = matrices.get(stage, [{}])
        if not jobs:
            raise ValueError(f'no jobs for selected stage {stage}')
        pending = []
        for job in jobs:
            extra = job_extra(stage, job, modules)
            if existing and stage not in NEVER_CACHED:
                key = cache_key(stage, extra, digest(entries, stage, extra))
                if key in existing:
                    reused.setdefault(stage, []).append(job or stage)
                    continue
            pending.append(job)
        if pending:
            pending_stages.append(stage)
        if stage in matrices:
            pending_matrices[stage] = {'include': pending}
    return {'stages': pending_stages, 'matrices': pending_matrices, 'reused': reused}


def trusted_keys(listing: list[dict], ref: str) -> set[str]:
    """The keys saved by this ref; another ref's caches are not evidence for this run."""
    return {entry['key'] for entry in listing if entry['ref'] == ref}


def gh_cache_listing(repository: str) -> list[dict]:
    """Every Actions cache whose key starts with the stage-pass prefix, as `{key, ref}` dicts."""
    try:
        output = subprocess.check_output(
            ['gh', 'api', '--paginate', f'repos/{repository}/actions/caches?key={KEY_PREFIX}&per_page=100',
             '--jq', '.actions_caches[] | {key: .key, ref: .ref}'],
            text=True, stderr=subprocess.PIPE)
    except (OSError, subprocess.CalledProcessError) as error:
        raise CacheLookupError(f'cannot list the Actions caches of {repository}: {error}') from error
    return [json.loads(line) for line in output.splitlines() if line.strip()]


def existing_keys(lookup) -> set[str]:
    repository, ref = os.environ.get('GITHUB_REPOSITORY'), os.environ.get('GITHUB_REF')
    if not repository or not ref:
        raise CacheLookupError('GITHUB_REPOSITORY and GITHUB_REF must be set')
    return trusted_keys(lookup(repository), ref)


def print_plan(args: argparse.Namespace, lookup) -> int:
    existing = set()
    entries = []
    if args.reuse_passes:
        try:
            existing = existing_keys(lookup)
            if existing:
                entries = tree_entries(Path.cwd(), 'HEAD')
        except CacheLookupError as error:
            print(f'ci_stage_cache: warning: {error}; no job is skipped', file=sys.stderr)
            existing = set()

    matrices = {
        'odoo': shard_jobs(json.loads(args.odoo_shards)),
        'e2e-mock': shard_jobs(json.loads(args.e2e_mock_shards)),
        'rtl-stories': shard_jobs(json.loads(args.rtl_stories_shards)),
        'odoo-app-standalone': [{'group': group} for group in json.loads(args.apps)],
        'odoo-bridge': [{'group': group} for group in json.loads(args.bridges)],
    }
    try:
        plan = run_plan(entries, json.loads(args.stages), existing, matrices, args.odoo_modules)
    except ValueError as error:
        print(f'ci_stage_cache: {error}', file=sys.stderr)
        return 1
    print(json.dumps(plan))
    return 0


def main(argv: list[str] | None = None, lookup=gh_cache_listing) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    keying = sub.add_parser('key', help='print the cache key a passing job of a stage saves')
    keying.add_argument('--stage', required=True, choices=ci_scope.STAGES)
    keying.add_argument('--extra', default='', help='the matrix entry of the job')
    keying.add_argument('--commit', default='HEAD')
    planning = sub.add_parser('plan', help='print the required stages, matrix jobs, and reused jobs as JSON')
    planning.add_argument('--reuse-passes', action='store_true', help='reuse successful jobs from this ref')
    planning.add_argument('--stages', required=True, help='JSON array of the selected stages')
    planning.add_argument('--odoo-shards', required=True, help='JSON array of the odoo shard numbers')
    planning.add_argument('--e2e-mock-shards', required=True, help='JSON array of the e2e-mock shard numbers')
    planning.add_argument('--rtl-stories-shards', required=True, help='JSON array of the rtl-stories shard numbers')
    planning.add_argument('--apps', required=True, help='JSON array of the odoo-app-standalone groups')
    planning.add_argument('--bridges', required=True, help='JSON array of the odoo-bridge groups')
    planning.add_argument('--odoo-modules', default='', help='comma-separated affected modules (empty: all)')
    sub.add_parser('e2e-mock-shards', help='print the e2e-mock shard numbers, as a JSON array')
    sub.add_parser('rtl-stories-shards', help='print the rtl-stories shard numbers, as a JSON array')
    args = parser.parse_args(argv)
    if args.command == 'plan':
        return print_plan(args, lookup)
    if args.command == 'e2e-mock-shards':
        print(json.dumps(E2E_MOCK_SHARDS))
        return 0
    if args.command == 'rtl-stories-shards':
        print(json.dumps(RTL_STORIES_SHARDS))
        return 0
    try:
        tree_digest = fingerprint(Path.cwd(), args.stage, args.extra, args.commit)
    except CacheLookupError as error:
        print(f'ci_stage_cache: {error}', file=sys.stderr)
        return 1
    print(cache_key(args.stage, args.extra, tree_digest))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
