# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Remove the stale `manual` rows from the register files listed on argv.
#
# A `manual` row is a dated claim that someone exercised the scenario by hand. A claim
# from before the current work is not coverage: the code moved 998 commits since
# 2026-10-28, so the row asserts something nobody can reproduce. Rows dated on or after
# --since are kept — they are this round's evidence.
#
# A row is KEPT when its status is planned, automated, fail, gap, decision or dropped
# (live work: open defects, open questions, missing features, passing tests), and when
# it is a `manual` row dated on or after --since. Headings, prose and headers stay.
#
#     python3 -B tools/e2e_drop_stale.py --since 2026-11-05 e2e/scenarios/*.md
#     python3 -B tools/e2e_drop_stale.py --check --since 2026-11-05 e2e/scenarios/*.md
import argparse
import re
import sys
from pathlib import Path

CELL = re.compile(r'(?<!\\)\|')
ROW = re.compile(r'^\| [A-Z]+-\d+ \|')
DATE = re.compile(r'(\d{4}-\d{2}-\d{2})')
KEEP = {'planned', 'automated', 'fail', 'gap', 'decision', 'dropped'}
DEFAULT_SINCE = '2026-11-05'


def cells(line):
    parts = [part.strip() for part in CELL.split(line.rstrip('\n'))]
    if parts and parts[0] == '':
        parts = parts[1:]
    if parts and parts[-1] == '':
        parts = parts[:-1]
    return parts


def status_of(line):
    """The status word of a well-formed row, or None when the row is not a scenario."""
    row = cells(line)
    return row[5] if len(row) == 7 and row[5] else None


def stale(lines, since):
    """The indexes of rows to drop: a `manual` row older than SINCE."""
    gone = []
    for index, line in enumerate(lines):
        if not ROW.match(line):
            continue
        status = status_of(line)
        if not status or status.split()[0] != 'manual':
            continue
        dated = DATE.search(status)
        if not dated or dated.group(1) < since:
            gone.append(index)
    return gone


def drop(path, since, check):
    lines = Path(path).read_text(encoding='utf-8').split('\n')
    gone = stale(lines, since)
    if not gone:
        return 0, len(lines)
    if check:
        return len(gone), len(lines)
    kept = [line for index, line in enumerate(lines) if index not in set(gone)]
    Path(path).write_text('\n'.join(kept), encoding='utf-8')
    return len(gone), len(kept)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Remove stale manual rows from the e2e register.')
    parser.add_argument('paths', nargs='+')
    parser.add_argument('--since', default=DEFAULT_SINCE, help=f'keep manual rows dated on or after this day (default {DEFAULT_SINCE})')
    parser.add_argument('--check', action='store_true', help='report the counts without writing')
    args = parser.parse_args(argv)
    total = 0
    for path in args.paths:
        removed, left = drop(path, args.since, args.check)
        total += removed
        verb = 'would drop' if args.check else 'dropped'
        print(f'{Path(path).name:16} {verb} {removed:4} rows, {left:4} lines left')
    print(f'{total} stale manual rows {"to drop" if args.check else "dropped"} (kept manual rows since {args.since})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
