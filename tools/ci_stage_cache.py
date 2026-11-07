"""Skip a CI stage that already passed on exactly the same inputs.

    python3 -B tools/ci_stage_cache.py key --stage S [--extra E] [--commit REF]
    python3 -B tools/ci_stage_cache.py cached --stages JSON --odoo-shards JSON --apps JSON --bridges JSON \\
        [--odoo-modules CSV]

Only a pull request or a merge-queue entry skips a stage; the workflow runs this module for no other event.
``key`` prints the cache key a stage job saves when it passes: a hash of the tracked files the stage can
read (the ``RULES`` of ``tools/ci_scope.py``, where an addon file reaches only the Odoo stages, as in
``ci_scope.pull_request_stages``) and the matrix entry (``--extra``). ``cached`` prints, as a JSON array, the
selected stages whose every job already saved its key; the ``scope`` job of ``.github/workflows/ci.yml``
leaves them out of the stages to run. A matrix stage counts as cached only when every one of its entries has
a key. ``static`` is never cached: ``ci-result`` requires it.

Keys are read with the GitHub API and trusted only from the current ref, so another pull request's caches
never skip a stage. A failed lookup is reported on stderr and caches nothing.
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


def matrix_extras(stage: str, odoo_shards: list, apps: list, bridges: list, modules: str) -> list[str]:
    """The `--extra` of every job of a stage, exactly as the workflow passes it to `key`."""
    if stage == 'odoo':
        return [f'{shard}/{len(odoo_shards)}|{modules}' for shard in odoo_shards]
    if stage == 'odoo-app-standalone':
        return [f'{group}|{modules}' for group in apps]
    if stage == 'odoo-bridge':
        return [f'{group}|{modules}' for group in bridges]
    return ['']


def cached_stages(entries: list[Entry], stages: list[str], existing: set[str],
                  odoo_shards: list, apps: list, bridges: list, modules: str) -> list[str]:
    """The selected stages whose every job has already passed on these inputs."""
    cached = []
    for stage in stages:
        if stage in NEVER_CACHED:
            continue
        extras = matrix_extras(stage, odoo_shards, apps, bridges, modules)
        keys = [cache_key(stage, extra, digest(entries, stage, extra)) for extra in extras]
        if keys and all(key in existing for key in keys):
            cached.append(stage)
    return cached


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


def run_cached(args: argparse.Namespace, lookup) -> int:
    try:
        existing = existing_keys(lookup)
        entries = tree_entries(Path.cwd(), 'HEAD')
    except CacheLookupError as error:
        print(f'ci_stage_cache: warning: {error}; no stage is skipped', file=sys.stderr)
        print('[]')
        return 0
    print(json.dumps(cached_stages(entries, json.loads(args.stages), existing,
                                   json.loads(args.odoo_shards), json.loads(args.apps),
                                   json.loads(args.bridges), args.odoo_modules)))
    return 0


def main(argv: list[str] | None = None, lookup=gh_cache_listing) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    keying = sub.add_parser('key', help='print the cache key a passing job of a stage saves')
    keying.add_argument('--stage', required=True, choices=ci_scope.STAGES)
    keying.add_argument('--extra', default='', help='the matrix entry of the job')
    keying.add_argument('--commit', default='HEAD')
    caching = sub.add_parser('cached', help='print the selected stages that already passed, as a JSON array')
    caching.add_argument('--stages', required=True, help='JSON array of the selected stages')
    caching.add_argument('--odoo-shards', required=True, help='JSON array of the odoo shard numbers')
    caching.add_argument('--apps', required=True, help='JSON array of the odoo-app-standalone groups')
    caching.add_argument('--bridges', required=True, help='JSON array of the odoo-bridge groups')
    caching.add_argument('--odoo-modules', default='', help='comma-separated affected modules (empty: all)')
    args = parser.parse_args(argv)
    if args.command == 'cached':
        return run_cached(args, lookup)
    try:
        tree_digest = fingerprint(Path.cwd(), args.stage, args.extra, args.commit)
    except CacheLookupError as error:
        print(f'ci_stage_cache: {error}', file=sys.stderr)
        return 1
    print(cache_key(args.stage, args.extra, tree_digest))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
