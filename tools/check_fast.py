# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fast pre-commit checks, scoped to what changed against the base branch.

``npm test`` stays the binding full gate. This runs the cheap policy checks
always and the heavier ones (ruff, tools unit tests, contracts/web tests and the
web type check) only when their layer changed, all in parallel.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PY = 'python3'


def plan(changed, base):
    """``[(name, argv)]`` of the checks that apply to the changed paths."""
    def touched(*prefixes):
        return any(path.startswith(prefixes) for path in changed)

    steps = [
        ('secret_guard', [PY, '-B', 'tools/secret_guard.py']),
        ('no_external_refs', [PY, '-B', 'tools/no_external_refs.py']),
        ('docs_policy', [PY, '-B', 'tools/docs_policy.py']),
        ('ui_policy', [PY, '-B', 'tools/ui_policy.py']),
        ('arch_policy', [PY, '-B', 'tools/arch_policy.py', '--base', base]),
        ('git_policy', [PY, '-B', 'tools/git_policy.py', '--base', base]),
    ]
    if touched('odoo-addons/'):
        steps.append(('ruff', ['ruff', 'check', 'odoo-addons']))
    if touched('tools/'):
        steps.append(('tools_unittest', [PY, '-B', '-m', 'unittest', 'discover', '-s', 'tools', '-p', 'test_*.py']))
    if touched('packages/contracts/'):
        steps.append(('contracts_test', ['npm', '-w', 'packages/contracts', 'run', 'test']))
    if touched('apps/web/', 'packages/contracts/'):
        steps.append(('web_test_changed', ['npm', '-w', 'apps/web', 'run', 'test', '--', '--changed', base]))
        steps.append(('web_typecheck', ['npm', '-w', 'apps/web', 'run', 'lint']))
    return steps


def changed_paths(base):
    def lines(*args):
        out = subprocess.run(['git', *args], cwd=REPO, capture_output=True, text=True, check=True)
        return out.stdout.splitlines()

    merge_base = lines('merge-base', base, 'HEAD')[0]
    return lines('diff', '--name-only', merge_base) + lines('ls-files', '-o', '--exclude-standard')


def run_step(step):
    name, argv = step
    start = time.time()
    result = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, check=False)
    return name, result.returncode, time.time() - start, result.stdout + result.stderr


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--base', default='main')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    steps = plan(changed_paths(args.base), args.base)
    if args.dry_run:
        for name, cmd in steps:
            sys.stdout.write('%s: %s\n' % (name, ' '.join(cmd)))
        return 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=len(steps)) as pool:
        results = list(pool.map(run_step, steps))
    failed = 0
    for name, code, seconds, output in results:
        sys.stdout.write('%-18s %s %5.1fs\n' % (name, 'ok  ' if code == 0 else 'FAIL', seconds))
        if code:
            failed += 1
            sys.stdout.write('\n'.join(output.splitlines()[-30:]) + '\n')
    sys.stdout.write('total %.1fs, %d failed\n' % (time.time() - started, failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
