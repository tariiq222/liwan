# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Report which scenario registers in e2e/scenarios are ready for a release.

A register is ready when it has rows, none of them is `fail` or `planned`, and every
status is one the register defines. `gap` and `decision` rows are counted and shown: they
wait on a product or owner decision, not on a run. The tool only reads; outcomes are
recorded with tools/e2e_scenario_status.py.

    python3 -B tools/e2e_scenario_readiness.py                    every register
    python3 -B tools/e2e_scenario_readiness.py crm inbox --ids    two registers, with the blocking IDs
    python3 -B tools/e2e_scenario_readiness.py --check crm        exit 1 when a reported register is not ready
    python3 -B tools/e2e_scenario_readiness.py --manual-since 2026-11-01
                                                                  a `manual` pass before that date blocks too
"""
import argparse
import re
import sys
from collections import Counter
from datetime import date

from e2e_scenario_status import CELL, SCENARIOS, STATUSES

ROW = re.compile(r'\| ([A-Z]+-\d+) \|')
GUIDE = 'README'
UNKNOWN = 'unknown status'
STALE = 'stale manual'
BLOCKING = ('fail', 'planned', UNKNOWN, STALE)


def rows(text):
    """(scenario id, status cell) of every scenario row in a register."""
    return [(match.group(1), CELL.split(line)[-3].strip())
            for line in text.split('\n') if (match := ROW.match(line))]


def bucket(status, manual_since=None):
    """The counted state of one status cell."""
    word, _, detail = status.partition(' ')
    if word not in STATUSES:
        return UNKNOWN
    if word == 'manual' and manual_since and detail.strip() < manual_since:
        return STALE
    return word


def registers(folder, names):
    """The register files to report, by name without `.md`; every register when no name is given."""
    available = {path.stem: path for path in sorted(folder.glob('*.md')) if path.stem != GUIDE}
    missing = sorted(set(names) - set(available))
    if missing:
        msg = f'unknown registers: {", ".join(missing)}; available: {", ".join(available)}'
        raise SystemExit(msg)
    return {name: available[name] for name in (names or available)}


def assess(text, manual_since=None):
    """(count per state, blocking scenario ids per state) of one register."""
    counts, blocking = Counter(), {}
    for scenario, status in rows(text):
        state = bucket(status, manual_since)
        counts[state] += 1
        if state in BLOCKING:
            blocking.setdefault(state, []).append(scenario)
    return counts, blocking


def ready(counts):
    return bool(counts) and not any(counts[state] for state in BLOCKING)


def describe(name, counts, blocking, with_ids):
    """The report lines of one register."""
    total = sum(counts.values())
    if not total:
        return [f'{name}: not ready, no scenario rows']
    states = ', '.join(f'{count} {state}' for state, count in sorted(counts.items()))
    if ready(counts):
        return [f'{name}: ready ({total} rows: {states})']
    blocked = sum(counts[state] for state in BLOCKING)
    lines = [f'{name}: not ready, {blocked} of {total} rows ({states})']
    if with_ids:
        lines += [f'  {state}: {", ".join(ids)}' for state, ids in sorted(blocking.items())]
    return lines


def main(argv=None, folder=SCENARIOS):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('registers', nargs='*', help='register names without .md (default: every register)')
    parser.add_argument('--check', action='store_true', help='exit 1 when a reported register is not ready')
    parser.add_argument('--ids', action='store_true', help='list the blocking scenario IDs')
    parser.add_argument('--manual-since', type=date.fromisoformat, metavar='YYYY-MM-DD',
                        help='count a manual pass before this date as not ready')
    args = parser.parse_args(argv)
    manual_since = args.manual_since.isoformat() if args.manual_since else None
    not_ready = []
    selected = registers(folder, args.registers)
    for name, path in selected.items():
        counts, blocking = assess(path.read_text(encoding='utf-8'), manual_since)
        print('\n'.join(describe(name, counts, blocking, args.ids)))
        if not ready(counts):
            not_ready.append(name)
    print(f'total: {len(selected) - len(not_ready)}/{len(selected)} registers ready')
    return 1 if args.check and not_ready else 0


if __name__ == '__main__':
    sys.exit(main())
