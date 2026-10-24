# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fail when a secret-bearing path is tracked or a literal secret is committed."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ALLOWED_SUFFIXES = ('.example', '.sample', '.template')
FORBIDDEN_PATH_RE = re.compile(
    r'(^|/)\.env(\.[^/]+)?$|^deploy/data/|\.(pem|key|p12|pfx|p8|jks|keystore)$',
)
SECRET_LINE_RE = re.compile(
    r'(?i)\b(\w*(password|passwd|secret|token|api_key)\w*)\s*[=:]\s*["\']?([^\s"\'#]+)',
)
# The GitHub Actions OIDC permission (`id-token: write`) is a scope, not a token value.
OIDC_PERMISSION_RE = re.compile(r'\s*id-token:\s*(read|write|none)\s*')
# `odoo` is the throwaway password of the ephemeral CI postgres service.
# `-` is the empty-default marker in shell `${VAR:-}` expansions.
PLACEHOLDERS = frozenset({'-', 'change-me', 'changeme', 'x', 'validation-only', 'none', 'false', 'true', 'odoo'})
SCANNED_SUFFIXES = ('.conf', '.yml', '.yaml', '.env.example', '.sh', '.json')
# A credential that silently falls back to a literal (`NAME = X || 'value'`) uses that
# literal on any host the script reaches, so the literal is judged by itself. Kept apart
# from SECRET_LINE_RE, which reads assignments and cannot see past the expression.
# Each quote style matches its own delimiter: a double-quoted value may contain an
# apostrophe, and a value never runs past the string that closes it.
CREDENTIAL_FALLBACK_RE = re.compile(
    r'(?i)[\w$.]*(?:password|passwd|secret|token|api_key)[\w$]*'
    r'''\s*(?:\|\||\?\?)\s*(?:"(?P<double>[^"\n]*)"|'(?P<single>[^'\n]*)')''',
)
SCAN_ROOTS = ('deploy/', '.github/')
JS_SUFFIXES = ('.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.vue')


def find_forbidden_paths(tracked: list[str]) -> list[str]:
    return sorted(
        path for path in tracked
        if FORBIDDEN_PATH_RE.search(path) and not path.endswith(ALLOWED_SUFFIXES)
    )


def is_placeholder(value: str) -> bool:
    return value.startswith(('${', '$', '<', 'REPLACE_WITH_')) or value.lower() in PLACEHOLDERS


def find_credential_fallbacks(text: str) -> list[int]:
    """Line numbers where a credential falls back to a real literal.

    An empty fallback (`?? ''`) is the no-default idiom: it keeps the check on the
    value, so only a non-empty, non-placeholder literal counts as a secret.
    """
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = CREDENTIAL_FALLBACK_RE.search(line)
        value = ''
        if match:
            raw = match.group('double') if match.group('double') is not None else match.group('single')
            value = raw.strip()
        if value and not is_placeholder(value):
            hits.append(number)
    return hits


def find_secret_lines(path: str, text: str) -> list[tuple[str, int]]:
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = SECRET_LINE_RE.search(line)
        if not match or OIDC_PERMISSION_RE.fullmatch(line):
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
    problems += [
        f'credential fallback literal: {path}:{n}'
        for path in tracked
        if path.startswith(SCAN_ROOTS) and path.endswith(JS_SUFFIXES)
        for n in find_credential_fallbacks(Path(path).read_text(encoding='utf-8', errors='replace'))
    ]
    for path in tracked:
        if path.startswith(SCAN_ROOTS) and path.endswith(SCANNED_SUFFIXES):
            text = Path(path).read_text(encoding='utf-8', errors='replace')
            problems += [f'literal secret: {p}:{n}' for p, n in find_secret_lines(path, text)]
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
