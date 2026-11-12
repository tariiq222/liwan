#!/usr/bin/env python3
"""Fail when a vitest JSON report holds a skipped, pending or todo test, or no tests at all.

Usage: vitest_skip_gate.py <report.json>...
A suite that skips itself because its precondition is missing (a database, mailpit) must fail the CI stage that
owns it, not pass quietly. Every report must exist, parse and contain at least one test.
"""
import json
import sys
from pathlib import Path

NOT_RUN = {'skipped', 'pending', 'todo', 'disabled'}


def problems(report: Path) -> list[str]:
    try:
        data = json.loads(report.read_text(encoding='utf-8'))
        files = data['testResults']
    except (OSError, ValueError, KeyError, TypeError) as error:
        return [f'{report}: unreadable vitest report ({error})']
    tests = [(file.get('name', '?'), test) for file in files for test in file.get('assertionResults', [])]
    if not tests:
        return [f'{report}: the report holds no tests']
    return [f"{name} > {test.get('fullName', test.get('title', '?'))} ({test.get('status')})"
            for name, test in tests if test.get('status') in NOT_RUN]


def main(argv: list[str]) -> int:
    if not argv:
        print('usage: vitest_skip_gate.py <report.json>...', file=sys.stderr)
        return 2
    found = [line for report in argv for line in problems(Path(report))]
    for line in found:
        print(f'not run: {line}', file=sys.stderr)
    return 1 if found else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
