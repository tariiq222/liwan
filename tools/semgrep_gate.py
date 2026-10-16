# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Semgrep gate for the files changed against the base branch.

Scope: files changed against ``--base`` (committed, staged, unstaged and
untracked) whose suffix is in SUFFIXES. A path is skipped when its first
component is ``docs`` or any component is in SKIP_COMPONENTS (``node_modules``,
``tests``, ``fixtures`` and similar), or when its name matches TEST_NAME.

Enforced, exit code 1:
* any Semgrep finding of severity ERROR, from the registry rulesets in RULESETS;
* any finding from a secrets rule;
* any line of a scanned file that carries the Semgrep inline-ignore marker (MARKER)
  but not in the form ``<marker>: <rule-id> -- <reason>``, i.e. a bare or
  reason-less suppression.

Reported but not failing: WARNING findings (``warn``) and files Semgrep could
not fully parse (``warn parse``); such files may be only partly scanned.

Needs network access to download the rulesets (``--metrics=off``: no usage data
is sent); when semgrep or the registry is unreachable the gate fails closed with
exit code 3 unless ``--allow-offline`` is given.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RULESETS = ('p/python', 'p/typescript', 'p/secrets')
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


def run_semgrep(files):
    with tempfile.TemporaryDirectory(prefix='webvue-semgrep-') as tmp:
        output = Path(tmp) / 'out.json'
        cmd = ['semgrep', 'scan', '--metrics=off', '--disable-version-check', '--quiet', '--json', '--output', str(output)]
        for ruleset in RULESETS:
            cmd += ['--config', ruleset]
        result = subprocess.run(cmd + files, cwd=REPO, capture_output=True, text=True, check=False)
        if not output.exists():
            return None, (result.stderr or result.stdout).strip()[-400:]
        return json.loads(output.read_text(encoding='utf-8')), ''


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--base', default='main')
    parser.add_argument('--allow-offline', action='store_true')
    args = parser.parse_args(argv)
    files = select_files(changed_paths(args.base))
    if not files:
        sys.stdout.write('semgrep_gate: no changed source files to scan\n')
        return 0
    try:
        data, error = run_semgrep(files)
    except FileNotFoundError:
        data, error = None, 'semgrep is not installed'
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
