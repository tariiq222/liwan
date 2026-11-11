# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Semgrep gate for the files changed against the base branch.

Scope: files changed against ``--base`` (committed, staged, unstaged and
untracked) whose suffix is in SUFFIXES. A path is skipped when its first
component is ``docs`` or any component is in SKIP_COMPONENTS (``node_modules``,
``tests``, ``fixtures`` and similar), or when its name matches TEST_NAME.

Enforced, exit code 1:
* any Semgrep finding of severity ERROR, from the registry rulesets pinned in LOCK;
* any finding from a secrets rule;
* any line of a scanned file that carries the Semgrep inline-ignore marker (MARKER)
  but not in the form ``<marker>: <rule-id> -- <reason>``, i.e. a bare or
  reason-less suppression.

Reported but not failing: WARNING findings (``warn``) and files Semgrep could
not fully parse (``warn parse``); such files may be only partly scanned.

The rulesets are pinned: LOCK (tools/semgrep_rules.lock.json) holds the sha256 of each
ruleset as the registry serves it. The gate scans with a verified copy from the rules
cache (``LIWAN_SEMGREP_RULES_CACHE``, default ``~/.cache/liwan-semgrep-rules``; CI keeps it
in the Actions cache) or downloads it from the registry and refuses a body whose hash
differs, so a registry change never alters the gate without a reviewed commit:
``--update-lock`` downloads the current rulesets and rewrites LOCK with today's date.

Needs network access when the cache lacks a ruleset (``--metrics=off``: no usage data
is sent); when semgrep or the registry is unreachable, or a ruleset changed upstream,
the gate fails closed with exit code 3 unless ``--allow-offline`` is given.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LOCK = REPO / 'tools' / 'semgrep_rules.lock.json'
REGISTRY = 'https://semgrep.dev/c/'
RULES_CACHE_ENV = 'LIWAN_SEMGREP_RULES_CACHE'
SUFFIXES = ('.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.sh', '.bash')
SKIP_COMPONENTS = frozenset({'node_modules', '.nuxt', '.output', 'storybook-static', '__tests__', 'tests', 'fixtures'})
TEST_NAME = re.compile(r'(^|/)(test_[^/]*\.py|[^/]*\.(test|spec)\.[jt]s|[^/]*\.e2e\.ts)$')
MARKER = 'nosem' + 'grep'  # spelled in two parts so this file does not carry the marker itself
SUPPRESSION_OK = re.compile(MARKER + r':\s*\S+\s+--\s+\S')
EXIT_UNAVAILABLE = 3


def select_files(paths):
    """Changed paths that should be scanned: source files outside tests and generated output."""
    chosen = []
    for path in paths:
        if not path.endswith(SUFFIXES) or TEST_NAME.search(path):
            continue
        parts = path.split('/')
        if parts[0] == 'docs' or SKIP_COMPONENTS.intersection(parts):
            continue
        chosen.append(path)
    return sorted(set(chosen))


def blocking(findings):
    """Findings that fail the gate: ERROR severity or any secrets rule."""
    return [
        f for f in findings
        if f.get('extra', {}).get('severity') == 'ERROR' or '.secrets.' in f.get('check_id', '') or f.get('check_id', '').startswith('secrets')
    ]


def unjustified_suppressions(path, text):
    """Line numbers in ``text`` that carry MARKER without a rule id and a reason."""
    return [
        number for number, line in enumerate(text.splitlines(), 1)
        if MARKER in line and not SUPPRESSION_OK.search(line)
    ]


def changed_paths(base):
    def lines(*args):
        out = subprocess.run(['git', '-c', 'core.quotepath=off', *args], cwd=REPO, capture_output=True, text=True, check=True)
        return out.stdout.splitlines()

    merge_base = lines('merge-base', base, 'HEAD')[0]
    return lines('diff', '--name-only', '--diff-filter=ACMR', merge_base) + lines('ls-files', '-o', '--exclude-standard')


class RulesetError(RuntimeError):
    """A pinned ruleset could not be obtained with its pinned content."""


def load_lock(path=LOCK):
    """The pinned rulesets: ``{ruleset: sha256}``."""
    return json.loads(path.read_text(encoding='utf-8'))['rulesets']


def rules_cache():
    return Path(os.environ.get(RULES_CACHE_ENV) or Path.home() / '.cache' / 'liwan-semgrep-rules')


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def download(ruleset):
    request = urllib.request.Request(REGISTRY + ruleset, headers={'User-Agent': 'liwan-semgrep-gate'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except (urllib.error.URLError, OSError) as error:
        raise RulesetError(f'{ruleset}: registry unreachable: {error}') from error


def pinned_ruleset(ruleset, digest, cache, fetch=download):
    """A local file holding exactly the pinned ruleset, from the cache or the registry."""
    cached = cache / f'{digest}.yml'
    if cached.is_file() and sha256(cached.read_bytes()) == digest:
        return cached
    body = fetch(ruleset)
    served = sha256(body)
    if served != digest:
        raise RulesetError(f'{ruleset} changed upstream (pinned {digest[:12]}, served {served[:12]}): review the '
                           'rule changes, then run python3 -B tools/semgrep_gate.py --update-lock and commit the lock')
    cache.mkdir(parents=True, exist_ok=True)
    partial = cache / f'{digest}.yml.partial'
    partial.write_bytes(body)
    partial.replace(cached)
    return cached


def update_lock(path=LOCK, fetch=download, today=None):
    """Pin the rulesets the registry serves now (the same ruleset names)."""
    rulesets = {ruleset: sha256(fetch(ruleset)) for ruleset in load_lock(path)}
    reviewed = (today or datetime.date.today()).isoformat()
    path.write_text(json.dumps({'reviewed': reviewed, 'rulesets': rulesets}, indent=2) + '\n', encoding='utf-8')
    return rulesets


def run_semgrep(files, lock):
    cache = rules_cache()
    configs = [pinned_ruleset(ruleset, digest, cache) for ruleset, digest in lock.items()]
    with tempfile.TemporaryDirectory(prefix='liwan-semgrep-') as tmp:
        output = Path(tmp) / 'out.json'
        cmd = ['semgrep', 'scan', '--metrics=off', '--disable-version-check', '--quiet', '--json', '--output', str(output)]
        for config in configs:
            cmd += ['--config', str(config)]
        result = subprocess.run(cmd + files, cwd=REPO, capture_output=True, text=True, check=False)
        if not output.exists():
            return None, (result.stderr or result.stdout).strip()[-400:]
        return json.loads(output.read_text(encoding='utf-8')), ''


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--base', default='main')
    parser.add_argument('--allow-offline', action='store_true')
    parser.add_argument('--update-lock', action='store_true', help='pin the rulesets the registry serves now')
    args = parser.parse_args(argv)
    if args.update_lock:
        for ruleset, digest in update_lock().items():
            sys.stdout.write(f'semgrep_gate: pinned {ruleset} {digest}\n')
        return 0
    files = select_files(changed_paths(args.base))
    if not files:
        sys.stdout.write('semgrep_gate: no changed source files to scan\n')
        return 0
    lock = load_lock()  # a missing or unreadable lock is an error of its own, never "semgrep is not installed"
    try:
        data, error = run_semgrep(files, lock)
    except FileNotFoundError:
        data, error = None, 'semgrep is not installed'
    except RulesetError as failure:
        data, error = None, str(failure)
    if data is None or (data.get('errors') and not data.get('paths', {}).get('scanned')):
        sys.stderr.write('semgrep_gate: scan unavailable: %s\n' % error)
        return 0 if args.allow_offline else EXIT_UNAVAILABLE
    findings = data.get('results', [])
    failing = blocking(findings)
    parse_errors = [e for e in data.get('errors', []) if e.get('path')]
    for error in parse_errors:
        sys.stdout.write('warn parse %s\n' % error['path'])
    bad_suppressions = 0
    for path in files:
        try:
            text = (REPO / path).read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue
        for number in unjustified_suppressions(path, text):
            bad_suppressions += 1
            sys.stdout.write('FAIL suppression %s:%d\n' % (path, number))
    for finding in findings:
        mark = 'FAIL' if finding in failing else 'warn'
        sys.stdout.write('%s %s:%d %s\n' % (mark, finding['path'], finding['start']['line'], finding['check_id'].split('.')[-1]))
    sys.stdout.write('semgrep_gate: %d files, %d findings, %d blocking, %d bad suppressions, %d parse warnings\n' % (
        len(files), len(findings), len(failing), bad_suppressions, len(parse_errors)))
    return 1 if failing or bad_suppressions else 0


if __name__ == '__main__':
    sys.exit(main())
