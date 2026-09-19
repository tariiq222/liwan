# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Reject fatal and definitive schema failures in an Odoo upgrade log."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


ERROR_LEVEL_RE = re.compile(r'\b(?:ERROR|CRITICAL)\b')
FINAL_SCHEMA_WARNING_RE = re.compile(
    r'\bWARNING\b.*(?:contains null values|Missing not-null constraint on)',
)


def find_problems(text: str) -> list[tuple[int, str]]:
    """Return ``(line number, line)`` entries that reject an upgrade."""
    problems = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if ERROR_LEVEL_RE.search(line) or FINAL_SCHEMA_WARNING_RE.search(line):
            problems.append((line_number, line))
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('log_path', type=Path, help='path to the Odoo upgrade log')
    args = parser.parse_args(argv)

    try:
        text = args.log_path.read_text(encoding='utf-8')
    except (OSError, UnicodeError) as error:
        print(f'upgrade log unreadable: {args.log_path}: {error}', file=sys.stderr)
        return 1

    problems = find_problems(text)
    for line_number, line in problems:
        print(f'upgrade log rejected: {args.log_path}:{line_number}: {line}', file=sys.stderr)
    if problems:
        print(f'upgrade log guard failed: {len(problems)} offending line(s)', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
