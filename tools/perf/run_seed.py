# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Seed a scratch database for the perf baseline by piping ``seed_finance.py`` into ``odoo-bin shell``.

    python3 -B tools/perf/run_seed.py [--database liwan_scratch_x] [--scale 1.0]

The database must exist with the release modules installed; the seed refuses to run otherwise.
"""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

from odoo_launch import (
    LOGIN,
    PASSWORD,
    default_database,
    odoo_command,
    odoo_environment,
    odoo_test,
    require_scratch,
)

PSQL = ['psql', '-h', os.environ.get('PGHOST', '127.0.0.1'), '-p', os.environ.get('PGPORT', '5432')]


def missing_modules(database):
    """Release modules that are not installed in ``database`` (all of them when it cannot be read)."""
    expected = set(odoo_test.release_modules())
    result = subprocess.run(
        [*PSQL, '-d', database, '-Atc', "SELECT name FROM ir_module_module WHERE state = 'installed'"],
        check=False, capture_output=True, text=True,
    )
    if result.returncode:
        raise SystemExit('cannot read %s: %s' % (database, result.stderr.strip()))
    return sorted(expected - set(result.stdout.split()))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--database', default=None, help='scratch database (default: NUXT_ODOO_DB of .env.worktree)')
    parser.add_argument('--scale', type=float, default=1.0, help='fraction of the full volume (default 1.0)')
    args = parser.parse_args()
    if args.scale <= 0:
        parser.error('--scale must be positive')
    database = require_scratch(args.database) if args.database else default_database()
    missing = missing_modules(database)
    if missing:
        raise SystemExit('release modules not installed in %s: %s' % (database, ', '.join(missing)))
    command = odoo_command('shell', database, ['--no-http', '--log-level=warn'])
    environment = dict(odoo_environment(database), PERF_SCALE=str(args.scale), PERF_LOGIN=LOGIN, PERF_PASSWORD=PASSWORD)
    begin = time.monotonic()
    with (Path(__file__).parent / 'seed_finance.py').open(encoding='utf-8') as source:
        subprocess.run(command, stdin=source, env=environment, check=True)  # nosemgrep: dangerous-subprocess-use-tainted-env-args -- operator-run local tool, arguments come from its own CLI flags
    sys.stdout.write('seed wall time %.1fs at scale %s\n' % (time.monotonic() - begin, args.scale))
    subprocess.run([*PSQL, '-d', database, '-c', 'VACUUM ANALYZE'], check=True)  # nosemgrep: dangerous-subprocess-use-tainted-env-args -- operator-run local tool, arguments come from its own CLI flags


if __name__ == '__main__':
    main()
