# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fail when a secret-bearing path is tracked or a literal secret is committed."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ALLOWED_SUFFIXES = ('.example', '.sample', '.template')
FORBIDDEN_PATH_RE = re.compile(
    r'(^|/)\.env(\.[^/]+)?$|^deploy/data/|\.(pem|key|p12|pfx)$',
)
SECRET_LINE_RE = re.compile(
    r'(?i)\b(\w*(password|passwd|secret|token|api_key)\w*)\s*[=:]\s*["\']?([^\s"\'#]+)',
)
# `odoo` is the throwaway password of the ephemeral CI postgres service.
# `-` is the empty-default marker in shell `${VAR:-}` expansions.
PLACEHOLDERS = frozenset({'-', 'change-me', 'changeme', 'x', 'validation-only', 'none', 'false', 'true', 'odoo'})
SCANNED_SUFFIXES = ('.conf', '.yml', '.yaml', '.env.example', '.sh', '.json')
SCAN_ROOTS = ('deploy/', '.github/')


def find_forbidden_paths(tracked: list[str]) -> list[str]:
    return sorted(
        path for path in tracked
        if FORBIDDEN_PATH_RE.search(path) and not path.endswith(ALLOWED_SUFFIXES)
    )


def find_secret_lines(path: str, text: str) -> list[tuple[str, int]]:
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = SECRET_LINE_RE.search(line)
        if not match:
            continue
        value = match.group(3).rstrip(',;}')
        if value.startswith(('${', '$', '<', 'REPLACE_WITH_')) or value.lower() in PLACEHOLDERS:
            continue
        # A `*_FILE:` key pointing at a mounted Docker/Compose secret path is
        # the correct no-literal-secret idiom: the value is a file PATH, not a
        # secret. Only trust this escape hatch for that exact shape.
        if match.group(1).upper().endswith('_FILE') and value.startswith('/run/secrets/'):
            continue
        hits.append((path, number))
    return hits


def main() -> int:
    tracked = subprocess.run(
        ['git', 'ls-files'], capture_output=True, text=True, check=True, shell=False,
    ).stdout.splitlines()
    problems = [f'tracked secret path: {p}' for p in find_forbidden_paths(tracked)]
    for path in tracked:
        if path.startswith(SCAN_ROOTS) and path.endswith(SCANNED_SUFFIXES):
            text = Path(path).read_text(encoding='utf-8', errors='replace')
            problems += [f'literal secret: {p}:{n}' for p, n in find_secret_lines(path, text)]
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
