# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fetch the pinned OCA 19.0 repositories and print their Odoo addons path.

    python3 -B tools/oca_addons.py check
    python3 -B tools/oca_addons.py fetch [--dest DIR]
    python3 -B tools/oca_addons.py path [--dest DIR] [--check]

``deploy/oca-addons.json`` is the only list of OCA repositories and their commits. OCA code is
never copied into this repository: ``fetch`` (https only) clones each repository to exactly its
pinned commit under ``DIR/<repo name>`` and verifies HEAD; it is idempotent. ``path --check`` fails
unless every clone is at its pin. The destination is ``--dest``, else ``$WEBVUE_OCA_DIR``, else
``oca-19.0`` beside the main checkout (shared by every worktree). See ``docs/oca-addons.md``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PINS = REPO / 'deploy' / 'oca-addons.json'
DEFAULT_BASE_URL = 'https://github.com'
DEST_ENV = 'WEBVUE_OCA_DIR'
DEST_NAME = 'oca-19.0'
IMAGE_DEST = '/opt/oca'  # where deploy/odoo/Dockerfile puts the repositories
REPO_NAME = re.compile(r'OCA/[a-z0-9][a-z0-9_-]*')
SHA = re.compile(r'[0-9a-f]{40}')
# Seconds to wait before each retry of a fetch that failed on the network; a refused or unknown
# commit is never retried. The CI image build fetches every pin from github.com.
FETCH_RETRY_DELAYS = (10, 30)
TRANSIENT_FETCH = re.compile(
    r"could not resolve host|failed to connect|couldn't connect to server|connection timed out|"
    r'connection reset|operation timed out|early eof|rpc failed; (curl|http 5)|returned error: 5\d\d',
    re.IGNORECASE,
)


class OcaError(Exception):
    """A refused or failed step; the message is shown to the user."""


def load_pins(pins_file):
    try:
        data = json.loads(Path(pins_file).read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise OcaError('cannot read %s: %s' % (pins_file, exc)) from None
    errors = validate(data)
    if errors:
        raise OcaError('invalid %s:\n  %s' % (pins_file, '\n  '.join(errors)))
    return data


def validate(data):
    """Schema problems of a pin file as a list of messages; empty when valid."""
    if not isinstance(data, dict) or not isinstance(data.get('repos'), list) or not data['repos']:
        return ['"repos" must be a non-empty list']
    errors, seen = [], set()
    for entry in data['repos']:
        name = entry.get('repo') if isinstance(entry, dict) else None
        if not isinstance(name, str) or not REPO_NAME.fullmatch(name):
            errors.append('repo %r must look like OCA/<name>' % (name,))
            continue
        if name in seen:
            errors.append('duplicate repo %s' % name)
        seen.add(name)
        if not isinstance(entry.get('branch'), str) or not entry['branch']:
            errors.append('%s: branch must be a non-empty string' % name)
        if not isinstance(entry.get('commit'), str) or not SHA.fullmatch(entry['commit']):
            errors.append('%s: commit must be a full 40-character lowercase sha' % name)
    for item in data.get('python_requirements', []):
        if not isinstance(item, dict) or item.get('repo') not in seen or not item.get('packages'):
            errors.append('python_requirements entry %r must name a pinned repo and its packages' % (item,))
    return errors


def pins_digest(pins_file=PINS):
    """Short digest of the pin file, for cache and template keys."""
    return hashlib.sha256(Path(pins_file).read_bytes()).hexdigest()[:16]


def main_checkout():
    """The main checkout, found from the shared git dir so any worktree gives the same answer."""
    try:
        result = subprocess.run(
            ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
            cwd=REPO, check=False, text=True, capture_output=True)
    except OSError:  # no git (the runtime image): the checkout itself is the base
        return REPO
    common = Path(result.stdout.strip())
    return common.parent if result.returncode == 0 and common.name == '.git' else REPO


def default_dest(environ=None):
    value = (os.environ if environ is None else environ).get(DEST_ENV)
    return Path(value) if value else main_checkout().parent / DEST_NAME


def repo_dir(dest, repo):
    return Path(dest) / repo.split('/', 1)[1]


def addons_path(pins, dest):
    return ','.join(str(repo_dir(dest, entry['repo'])) for entry in pins['repos'])


def image_path(pins_file=PINS):
    """The addons path of the pinned repositories inside the Odoo image."""
    return addons_path(load_pins(pins_file), IMAGE_DEST)


def git(*args, cwd=None):
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    try:
        result = subprocess.run(['git', *args], cwd=cwd, check=False, text=True, capture_output=True, env=env)
    except OSError as exc:
        raise OcaError('cannot run git: %s' % exc) from None
    if result.returncode:
        raise OcaError('git %s failed: %s' % (' '.join(args[:2]), result.stderr.strip()))
    return result.stdout.strip()


def current_head(target):
    try:
        return git('rev-parse', 'HEAD', cwd=target)
    except OcaError:
        return None


def verify_repo(entry, dest):
    """Raise ``OcaError`` unless ``dest/<name>`` is a git checkout at exactly the pin with no local changes.

    Ignored files (``__pycache__``) are tolerated; ``fetch`` removes them.
    """
    target = repo_dir(dest, entry['repo'])
    fix = 'run: python3 -B tools/oca_addons.py fetch'
    if not (target / '.git').is_dir():
        raise OcaError('%s is not fetched at %s; %s' % (entry['repo'], target, fix))
    head = current_head(target)
    if head != entry['commit']:
        raise OcaError('%s is at %s, expected %s; %s' % (entry['repo'], head, entry['commit'], fix))
    if git('status', '--porcelain', cwd=target):
        raise OcaError('%s has local changes in %s; %s' % (entry['repo'], target, fix))


def verify_all(pins, dest):
    for entry in pins['repos']:
        verify_repo(entry, dest)


def repo_url(base_url, repo, allow_local_base):
    if not base_url.startswith('https://') and not allow_local_base:
        raise OcaError('base URL %r must start with https://' % base_url)
    return '%s/%s.git' % (base_url.rstrip('/'), repo)


def fetch_commit(url, commit, target):
    """``git fetch`` one commit, retrying only failures that ``TRANSIENT_FETCH`` names."""
    for delay in FETCH_RETRY_DELAYS:
        try:
            return git('fetch', '-q', '--depth', '1', url, commit, cwd=target)
        except OcaError as exc:
            if not TRANSIENT_FETCH.search(str(exc)):
                raise
            sys.stderr.write('oca_addons: %s; retrying in %ds\n' % (exc, delay))
            time.sleep(delay)
    return git('fetch', '-q', '--depth', '1', url, commit, cwd=target)


def fetch_repo(entry, dest, base_url, allow_local_base=False):
    """Make ``dest/<name>`` a checkout of exactly ``entry['commit']``; returns ``'kept'`` or ``'fetched'``.

    ``allow_local_base`` is for tests only: it lets ``base_url`` be a local path instead of https.
    A directory that is not a git checkout (a fetch that died) is removed first, and a new one is
    removed again if the fetch fails, so a half-made clone is never left behind.
    """
    target = repo_dir(dest, entry['repo'])
    commit = entry['commit']
    url = repo_url(base_url, entry['repo'], allow_local_base)
    existing = (target / '.git').is_dir()
    if not existing:
        shutil.rmtree(target, ignore_errors=True)
        target.mkdir(parents=True)
    try:
        if not existing:
            git('init', '-q', cwd=target)
        kept = existing and current_head(target) == commit
        if not kept:
            fetch_commit(url, commit, target)
        git('checkout', '-q', '--force', '--detach', commit if kept else 'FETCH_HEAD', cwd=target)
        git('clean', '-qfdx', cwd=target)
        verify_repo(entry, dest)
    except BaseException:
        if not existing:
            shutil.rmtree(target, ignore_errors=True)
        raise
    return 'kept' if kept else 'fetched'


def fetch_all(pins, dest, base_url, allow_local_base=False):
    return {entry['repo']: fetch_repo(entry, dest, base_url, allow_local_base) for entry in pins['repos']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('command', choices=('check', 'fetch', 'path'))
    parser.add_argument('--dest', help='directory that holds the clones (default: $%s or <main checkout parent>/%s)'
                        % (DEST_ENV, DEST_NAME))
    parser.add_argument('--pins', default=str(PINS), help='pin file (default: deploy/oca-addons.json)')
    parser.add_argument('--check', action='store_true',
                        help='with path: fail unless every repository is fetched at its pin')
    parser.add_argument('--base-url', default=os.environ.get('WEBVUE_OCA_BASE_URL', DEFAULT_BASE_URL),
                        help='git host the repositories are fetched from')
    args = parser.parse_args(argv)
    pins = load_pins(args.pins)
    dest = Path(args.dest) if args.dest else default_dest()
    if args.command == 'check':
        sys.stdout.write('%d repositories pinned\n' % len(pins['repos']))
    elif args.command == 'path':
        if args.check:
            verify_all(pins, dest)
        sys.stdout.write(addons_path(pins, dest) + '\n')
    else:
        for repo, state in fetch_all(pins, dest, args.base_url).items():
            sys.stdout.write('%s %s %s\n' % (repo, state, repo_dir(dest, repo)))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except OcaError as exc:
        sys.stderr.write('oca_addons: %s\n' % exc)
        sys.exit(2)
