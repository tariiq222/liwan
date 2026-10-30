"""Split the release modules into balanced Odoo test shards for the CI ``odoo`` stage.

    python3 -B tools/odoo_shards.py matrix [--modules a,b]   # JSON array of shard numbers, for the workflow matrix
    python3 -B tools/odoo_shards.py tags 2/3 [--modules a,b] # --test-tags value of shard 2 of 3
    python3 -B tools/odoo_shards.py plan [N]          # every shard with its modules and test weight
    python3 -B tools/odoo_shards.py run [N]           # all N shards in parallel locally (deploy/ci/odoo.sh --shard k/N each)

``run`` needs the environment of ``deploy/ci/odoo.sh`` (ODOO_ROOT, ODOO_PYTHON, ODOO_PORT, PG*); shard k
uses ODOO_PORT + k - 1 and its own scratch database. Logs go to a temporary directory it prints.
Three local Odoo processes on one Postgres can be slow enough to hit the 12 s HTTP test timeout (finance
report tests); a red local run under load is not proof of a defect, so re-run the failing shard alone.

Every shard still installs the whole release module list; a shard only differs in the modules whose
tests it runs. Weights are the ``def test_`` counts under ``odoo-addons/<module>/tests``, so no
history file exists to go stale, times ``COST_FACTOR`` for a module whose tests are measurably slower
per test; modules are assigned heaviest first to the lightest shard.

On a pull request ``--modules`` restricts the run to the affected modules (``tools/ci_scope.py``): only
those are split, over as few shards as ``shard_count_for`` allows, so a small change does not queue three
full jobs. Push, schedule and full runs pass no ``--modules`` and keep ``SHARD_COUNT`` shards over everything.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SHARD_COUNT = 3
# Per-test cost above the average module, measured on CI: liwan_finance's tests build accounting data
# (journals, moves, reports), so its 653 tests took 837 s standalone against 279 s for liwan_hr's 626.
COST_FACTOR = {'liwan_finance': 3}
TEST_DEF = re.compile(r'^\s*def test_', re.MULTILINE)


class ShardError(Exception):
    """A malformed shard selector or an unreadable module list."""


def release_modules() -> list[str]:
    result = subprocess.run([sys.executable, '-B', 'tools/catalog_check.py', '--release-modules'],
                            cwd=REPO, capture_output=True, text=True, check=False)
    if result.returncode:
        raise ShardError('catalog_check --release-modules failed: ' + result.stderr.strip())
    return result.stdout.strip().split(',')


def weight(module: str, addons: Path = REPO / 'odoo-addons') -> int:
    """Test count of a module times its COST_FACTOR; a module without tests weighs 1 so it still lands in a shard."""
    tests = addons / module / 'tests'
    count = sum(len(TEST_DEF.findall(f.read_text(encoding='utf-8'))) for f in sorted(tests.glob('test_*.py')))
    return max(count, 1) * COST_FACTOR.get(module, 1)


def split(weights: dict[str, int], count: int) -> list[list[str]]:
    """Greedy longest-processing-time split; ties break by module name so the result is stable."""
    shards: list[list[str]] = [[] for _ in range(count)]
    totals = [0] * count
    for module in sorted(weights, key=lambda m: (-weights[m], m)):
        lightest = totals.index(min(totals))
        shards[lightest].append(module)
        totals[lightest] += weights[module]
    return [sorted(shard) for shard in shards]


def parse_modules(text: str) -> list[str]:
    modules = [module for module in text.split(',') if module]
    if not modules:
        raise ShardError('--modules needs at least one module name')
    return modules


def shard_count_for(affected_weight: int, total_weight: int) -> int:
    """Shards for an affected subset: 1 up to a third of the release's test weight, 2 up to two thirds, else all."""
    if 3 * affected_weight <= total_weight:
        return 1
    if 3 * affected_weight <= 2 * total_weight:
        return 2
    return SHARD_COUNT


def shard_numbers(modules: list[str] | None = None) -> list[int]:
    """The matrix of a run: every shard of SHARD_COUNT, or just enough for the affected modules."""
    if modules is None:
        return list(range(1, SHARD_COUNT + 1))
    total = sum(weight(module) for module in release_modules())
    count = shard_count_for(sum(weight(module) for module in modules), total)
    return list(range(1, min(count, len(modules)) + 1))


def parse_selector(selector: str) -> tuple[int, int]:
    match = re.fullmatch(r'([1-9][0-9]*)/([1-9][0-9]*)', selector)
    if not match or int(match[1]) > int(match[2]):
        raise ShardError('shard selector must look like k/N with 1 <= k <= N, got %r' % selector)
    return int(match[1]), int(match[2])


def require_count(count: int) -> int:
    if count < 1:
        raise ShardError('shard count must be at least 1, got %d' % count)
    return count


def plan(count: int, modules: list[str] | None = None) -> list[list[str]]:
    release = release_modules()
    unknown = sorted(set(modules or ()) - set(release))
    if unknown:
        raise ShardError('not release modules: ' + ', '.join(unknown))
    return split({module: weight(module) for module in (release if modules is None else modules)}, require_count(count))


def tags(selector: str, modules: list[str] | None = None) -> str:
    index, count = parse_selector(selector)
    shard = plan(count, modules)[index - 1]
    if not shard:
        raise ShardError('shard %s has no module to test' % selector)
    return ','.join('/' + module for module in shard)


def run_all(count: int) -> int:
    """Run every shard in parallel; returns 0 only when all of them passed."""
    require_count(count)
    if not os.environ.get('ODOO_PORT', '').isdigit():
        raise ShardError('ODOO_PORT must be set to the first HTTP port')
    port = int(os.environ['ODOO_PORT'])
    run_id = os.environ.get('GITHUB_RUN_ID') or 'local%d' % time.time()
    logs = tempfile.mkdtemp(prefix='odoo-shards-')
    started = time.monotonic()
    processes = []
    for number in range(1, count + 1):
        env = dict(os.environ, ODOO_PORT=str(port + number - 1), GITHUB_RUN_ID=run_id)
        log = open(os.path.join(logs, 'shard-%d.log' % number), 'w', encoding='utf-8')
        command = ['bash', 'deploy/ci/odoo.sh', '--shard', '%d/%d' % (number, count)]
        processes.append((number, log, subprocess.Popen(command, cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT)))
    failed = 0
    for number, log, process in processes:
        code = process.wait()
        log.close()
        failed += bool(code)
        print('shard %d/%d: %s' % (number, count, 'passed' if code == 0 else 'FAILED (rc=%d), log %s' % (code, log.name)))
    print('logs: %s; wall time %.0f s' % (logs, time.monotonic() - started))
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('matrix').add_argument('--modules')
    tagging = sub.add_parser('tags')
    tagging.add_argument('selector')
    tagging.add_argument('--modules')
    sub.add_parser('plan').add_argument('count', nargs='?', type=int, default=SHARD_COUNT)
    sub.add_parser('run').add_argument('count', nargs='?', type=int, default=SHARD_COUNT)
    args = parser.parse_args(argv)
    only = None
    try:
        if args.command in ('matrix', 'tags') and args.modules is not None:
            only = parse_modules(args.modules)
        if args.command == 'matrix':
            print(json.dumps(shard_numbers(only)))
        elif args.command == 'tags':
            print(tags(args.selector, only))
        elif args.command == 'run':
            return run_all(args.count)
        else:
            for number, shard in enumerate(plan(args.count), 1):
                print('%d/%d  %4d tests  %s' % (number, args.count, sum(weight(m) for m in shard), ','.join(shard)))
    except ShardError as error:
        print('odoo_shards: %s' % error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
