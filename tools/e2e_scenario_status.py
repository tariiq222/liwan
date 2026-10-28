# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Record the outcome of end-user scenarios in the register e2e/scenarios/*.md.

Each line on stdin is ``ID<TAB>STATUS<TAB>NOTE``. STATUS replaces the row's
Status cell; NOTE is put in front of the row's existing notes (which are kept).
Pipes inside a note are escaped so the table stays valid.

    printf 'HR-12\\tmanual 2026-10-28\\tstaff1 withdrew the request in the UI\\n' \\
        | python3 -B tools/e2e_scenario_status.py
"""
import re
import sys
from pathlib import Path

SCENARIOS = Path(__file__).resolve().parent.parent / 'e2e' / 'scenarios'
STATUSES = ('planned', 'manual', 'automated', 'fail', 'gap', 'decision', 'dropped')
CELL = re.compile(r'(?<!\\)\|')


def update_row(line, status, note):
    """LINE with its Status cell set to STATUS and NOTE before its existing notes."""
    cells = CELL.split(line)
    cells[-3] = f' {status} '
    note = note.replace('|', '\\|').strip()
    old = cells[-2].strip()
    if not note or note in old:
        notes = old
    else:
        notes = f'{note}; {old}' if old else note
    cells[-2] = f' {notes} '
    return '|'.join(cells)


def apply(updates, folder=SCENARIOS):
    """Write each (id, status, note); return the file names touched. Unknown ids raise."""
    pending = dict((sid, (status, note)) for sid, status, note in updates)
    touched = []
    for path in sorted(folder.glob('*.md')):
        lines = path.read_text(encoding='utf-8').split('\n')
        changed = False
        for index, line in enumerate(lines):
            match = re.match(r'\| ([A-Z]+-\d+) \|', line)
            if match and match.group(1) in pending:
                lines[index] = update_row(line, *pending.pop(match.group(1)))
                changed = True
        if changed:
            path.write_text('\n'.join(lines), encoding='utf-8')
            touched.append(path.name)
    if pending:
        msg = f'unknown scenario ids: {", ".join(sorted(pending))}'
        raise SystemExit(msg)
    return touched


def parse(text):
    updates = []
    for number, raw in enumerate(text.splitlines(), 1):
        if not raw.strip():
            continue
        parts = raw.split('\t')
        if len(parts) != 3 or parts[1].split()[0] not in STATUSES:
            msg = f'line {number}: expected ID<TAB>STATUS<TAB>NOTE with STATUS one of {STATUSES}'
            raise SystemExit(msg)
        updates.append(tuple(part.strip() for part in parts))
    return updates


if __name__ == '__main__':
    print('updated:', ', '.join(apply(parse(sys.stdin.read()))) or 'nothing')
