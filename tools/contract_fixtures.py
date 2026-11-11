"""Refresh or check the contract fixtures in packages/contracts/fixtures.

``LiwanApiCase`` records real JSON responses of the routes listed in
``packages/contracts/fixtures/manifest.json`` while the Odoo tests of their addons
run (opt-in through ``LIWAN_CONTRACT_FIXTURES``). The vitest suite in
``packages/contracts`` parses every committed fixture with its zod schema.

    python3 -B tools/contract_fixtures.py            # regenerate the committed fixtures
    python3 -B tools/contract_fixtures.py --check    # fail when their structure differs from a fresh run
    python3 -B tools/contract_fixtures.py --compare DIR  # the same comparison against a run someone else recorded into DIR

Drift is judged on structure (key paths, JSON types, nullness), not bytes, so dates, numbers
and ids cannot make the check flaky. Writing refuses when the Odoo run fails.

This runs the Odoo tests of the fixture addons on a scratch database (slow), so it is
not part of ``npm test``. The nightly CI run (``deploy/ci/contract-fixtures.sh``) records the
fixtures itself, from the same addons (``--addons``), and then calls ``--compare``.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / 'packages' / 'contracts' / 'fixtures'
ENV_VAR = 'LIWAN_CONTRACT_FIXTURES'


def manifest_entries():
    return json.loads((FIXTURES / 'manifest.json').read_text())['fixtures']


def fixture_addons():
    return sorted({entry['addon'] for entry in manifest_entries()})


def record(directory, base):
    addons = fixture_addons()
    command = [sys.executable, '-B', str(REPO / 'tools' / 'odoo_test.py'),
               '--addons', ','.join(addons), '--no-dependents', '--base', base]
    return subprocess.run(command, env=dict(os.environ, **{ENV_VAR: str(directory)}), cwd=REPO, check=False).returncode


def fixture_files(directory):
    return sorted(path.relative_to(directory).as_posix() for path in directory.rglob('*.json') if path.name != 'manifest.json')


def signature(value):
    """Structure of a JSON value: key paths, JSON types and nullness, with list elements merged by shape.

    ``--check`` compares signatures, not bytes, so dates, document numbers and ids that change
    between runs cannot make it flaky while an added, removed or retyped key still does.
    """
    if isinstance(value, dict):
        return {key: signature(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        shapes = []
        for item in value:
            shape = signature(item)
            if shape not in shapes:
                shapes.append(shape)
        return sorted(shapes, key=json.dumps)
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    return 'number' if isinstance(value, (int, float)) else 'string'


def same_structure(left, right):
    return signature(json.loads(left.read_text())) == signature(json.loads(right.read_text()))


def differences(fresh):
    expected = {entry['name'] + '.json' for entry in manifest_entries()}
    produced = set(fixture_files(fresh))
    problems = [] if expected else ['the manifest lists no fixture, so nothing was compared']
    problems += [f'{name}: the Odoo tests did not record this route' for name in sorted(expected - produced)]
    problems += [f'{name}: no manifest entry' for name in sorted(produced - expected)]
    problems += [f'{name}: structure differs from the committed fixture' for name in sorted(expected & produced)
                 if not (FIXTURES / name).exists() or not same_structure(fresh / name, FIXTURES / name)]
    return problems


def install(fresh):
    """Make the committed fixtures match the manifest: write changed ones, delete unlisted files."""
    names = {entry['name'] + '.json' for entry in manifest_entries()}
    for name in fixture_files(FIXTURES):
        if name not in names:
            (FIXTURES / name).unlink()
    for name in sorted(names):
        target = FIXTURES / name
        if not target.exists() or not same_structure(fresh / name, target):
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(fresh / name, target)
    return len(names)


def report(problems, context):
    for problem in problems:
        sys.stderr.write('contract_fixtures: %s (%s)\n' % (problem, context))
    return 1 if problems else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--check', action='store_true', help='fail when the regenerated fixture structure differs from the committed one')
    parser.add_argument('--compare', type=Path, metavar='DIR',
                        help='compare the structure of the fixtures already recorded in DIR with the committed ones; runs no tests')
    parser.add_argument('--addons', action='store_true', help='print the addons whose tests record the fixtures, comma-separated, and exit')
    parser.add_argument('--base', default='main', help='base ref passed to odoo_test.py (default: main)')
    args = parser.parse_args(argv)
    if args.addons:
        sys.stdout.write(','.join(fixture_addons()) + '\n')
        return 0
    if args.compare:
        return report(differences(args.compare), 'recorded run')
    with tempfile.TemporaryDirectory(prefix='liwan-contract-fixtures-') as tmp:
        fresh = Path(tmp)
        code = record(fresh, args.base)
        problems = differences(fresh)
        if args.check:
            # The Odoo suites are gated elsewhere; the rc is shown so a failing run is not mistaken for drift.
            return report(problems, 'odoo tests rc=%d' % code)
        if code or any('did not record' in problem for problem in problems):
            sys.stderr.write('contract_fixtures: refusing to write: odoo tests rc=%d, %s\n' % (code, '; '.join(problems) or 'all routes recorded'))
            return 1
        sys.stdout.write('contract_fixtures: %d fixtures match the manifest\n' % install(fresh))
        return 0


if __name__ == '__main__':
    sys.exit(main())
