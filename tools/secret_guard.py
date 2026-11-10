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
# Fixture values that announce themselves. They are only accepted when the file is a
# test, so a real default cannot hide behind a test-sounding word.
SELF_DESCRIBED_FIXTURE_RE = re.compile(r'(?i)^(?:synthetic|test-only|not-secret|fixture|dummy|example|release-proxy)[\w-]*')
TEST_PATH_RE = re.compile(r'(^|/)(?:tests?|__tests__|e2e)(/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|(^|/)test_[^/]+$')
SCANNED_SUFFIXES = ('.conf', '.yml', '.yaml', '.env.example', '.sh', '.json', '.toml')
# A credential that silently falls back to a literal (`NAME = X || 'value'`) uses that
# literal on any host the script reaches, so the literal is judged by itself. Kept apart
# from SECRET_LINE_RE, which reads assignments and cannot see past the expression.
# Each quote style matches its own delimiter: a double-quoted value may contain an
# apostrophe, and a value never runs past the string that closes it.
CREDENTIAL_FALLBACK_RE = re.compile(
    r'(?i)[\w$.]*(?:password|passwd|secret|token|api_key)[\w$]*'
    r'''\s*(?:=|\|\|=|\?\?=|\|\||\?\?)\s*\(?\s*'''
    r'''(?:"(?P<double>[^"\n]*)"|'(?P<single>[^'\n]*)'|`(?P<template>[^`$\n]*)`)''',
)
# `SCAN_ROOTS` get the strict rules above: every literal assignment of a credential counts. The rest of the tree
# (`WIDE_ROOTS`) is large and full of test fixtures, so there only high-signal rules apply: a credential that falls
# back to a literal (`x || 'v'`, `x ?? 'v'`, `x or 'v'`, a literal default of an environment read), a provider token or a private key.
SCAN_ROOTS = ('deploy/', '.github/')
WIDE_ROOTS = ('apps/', 'packages/', 'odoo-addons/', 'tools/', 'e2e/')
JS_SUFFIXES = ('.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.vue')
SOURCE_SUFFIXES = JS_SUFFIXES + ('.py',)
CREDENTIAL_WORD_RE = re.compile(r'(?i)password|passwd|secret|token|api_key')
_CREDENTIAL_NAME = r'(?i)[\w$.]*(?:password|passwd|secret|token|api_key)[\w$]*'
_LITERAL = r'''(?:"(?P<double>[^"\n]*)"|'(?P<single>[^'\n]*)'|`(?P<template>[^`$\n]*)`)'''
FALLBACK_ONLY_RE = re.compile(
    _CREDENTIAL_NAME + r'''['"]?\)?\s*(?:\|\|=|\?\?=|\|\||\?\?)\s*\(?\s*''' + _LITERAL,
)
# Python `value or 'literal'`; a literal that is compared (`or 'x' in token`) is a test, not a default.
OR_FALLBACK_RE = re.compile(
    _CREDENTIAL_NAME + r'''['"]?\)?\s+or\s+\(?\s*''' + _LITERAL + r'(?=\s*(?:$|[,)\]};#]))',
)
ENV_DEFAULT_RE = re.compile(
    r'''(?i)(?:environ\.get|getenv|environ\.setdefault)\(\s*['"]\w*(?:password|passwd|secret|token|api_key)\w*['"]\s*,\s*''' + _LITERAL,
)
# Provider token shapes and private key blocks are secrets in any file. A match that announces itself as a fixture
# (`sk-vendor-secret-...`, `AKIA...EXAMPLE`) is accepted in a test file only.
PROVIDER_TOKEN_RE = re.compile(
    r'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b'
    r'|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bsk-(?:live-|proj-|ant-)?[A-Za-z0-9_-]{24,}|\bxox[abprs]-[A-Za-z0-9-]{10,}'
    r'|\bAIza[0-9A-Za-z_-]{35}\b|\bglpat-[A-Za-z0-9_-]{20}\b',
)
SELF_DESCRIBED_TOKEN_RE = re.compile(r'(?i)example|secret|fake|dummy|fixture|placeholder|sample|test')
# Files in WIDE_ROOTS whose literal credentials are throwaway by construction. Exact paths only, each with its reason;
# tools/test_secret_guard.py pins the set, and an entry that matches no tracked file fails as stale.
LITERAL_EXCEPTIONS = {
    'apps/control-plane/src/commercial/payment-simulator.ts': 'the payment simulator refuses to construct in production',
    'tools/shared_acceptance_live/probe.mjs': 'throwaway credentials of the disposable local shared-acceptance stack',
    'tools/shared_acceptance_live/down.sh': 'dummy values that only satisfy the compose overlay of a teardown, never printed',
    'tools/test_secret_guard.py': "fixtures of the guard's own tests",
    'tools/test_jev_review.mjs': 'fixture secrets of the review tool tests',
}
# A fallback of an E2E_* variable is the login default of a test-only account seeded into the disposable e2e scratch database
# (tools/e2e_seed.py); this skips the line, not the file, so any other credential in those specs is still judged.
E2E_ACCOUNT_RE = re.compile(r'E2E_[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET)')


def find_forbidden_paths(tracked: list[str]) -> list[str]:
    return sorted(
        path for path in tracked
        if FORBIDDEN_PATH_RE.search(path) and not path.endswith(ALLOWED_SUFFIXES)
    )


def is_placeholder(value: str) -> bool:
    return value.startswith(('${', '$', '<', 'REPLACE_WITH_')) or value.lower() in PLACEHOLDERS


def find_credential_fallbacks(
    text: str, path: str = '', patterns: tuple = (CREDENTIAL_FALLBACK_RE,), wrap_endings: tuple = ('||', '??', '=', '?', ':'),
) -> list[int]:
    """Line numbers where a credential falls back to a real literal.

    An empty fallback (`?? ''`) is the no-default idiom: it keeps the check on the
    value, so only a non-empty, non-placeholder literal counts as a secret.
    """
    lines = text.splitlines()
    hits = []
    for number, line in enumerate(lines, start=1):
        if not CREDENTIAL_WORD_RE.search(line):
            continue
        logical = line
        if logical.rstrip().endswith(wrap_endings) and number < len(lines):
            logical = f'{logical.rstrip()} {lines[number].strip()}'
        # Every match is judged: an empty or placeholder credential earlier on the line
        # must not hide a real literal later on it.
        found = False
        for pattern in patterns:
            start = 0
            while not found:
                match = pattern.search(logical, start)
                if not match:
                    break
                raw = next((group for group in match.groups() if group is not None), '')
                value = raw.strip()
                start = match.start() + 1
                if not value or is_placeholder(value):
                    continue
                if TEST_PATH_RE.search(path) and SELF_DESCRIBED_FIXTURE_RE.match(value):
                    continue
                found = True
        if found:
            hits.append(number)
    return hits


def find_wide_fallbacks(text: str, path: str = '') -> list[int]:
    """The high-signal subset of find_credential_fallbacks, for the roots outside SCAN_ROOTS."""
    hits = find_credential_fallbacks(text, path, (FALLBACK_ONLY_RE, OR_FALLBACK_RE, ENV_DEFAULT_RE), ('||', '??', ' or'))
    lines = text.splitlines()
    return [number for number in hits if not E2E_ACCOUNT_RE.search(lines[number - 1])]


def find_provider_tokens(text: str, path: str = '') -> list[int]:
    """Line numbers holding a provider token shape or a private key block."""
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = PROVIDER_TOKEN_RE.search(line)
        if match and not (TEST_PATH_RE.search(path) and SELF_DESCRIBED_TOKEN_RE.search(match.group(0))):
            hits.append(number)
    return hits


def literal_exception(path: str) -> str | None:
    return path if path in LITERAL_EXCEPTIONS else None


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


def scan_tree(tracked: list[str]) -> list[str]:
    """Every problem in the tracked tree; `tracked` is the `git ls-files` listing."""
    problems = [f'tracked secret path: {p}' for p in find_forbidden_paths(tracked)]
    used = set()
    for path in tracked:
        strict = path.startswith(SCAN_ROOTS)
        wide = path.startswith(WIDE_ROOTS) or '/' not in path  # repo-root files (config, scripts) are scanned like a wide root
        if not (strict or wide) or not path.endswith(SCANNED_SUFFIXES + SOURCE_SUFFIXES):
            continue
        text = Path(path).read_text(encoding='utf-8', errors='replace')
        problems += [f'provider token or private key: {path}:{n}' for n in find_provider_tokens(text, path)]
        exception = None if strict else literal_exception(path)
        if exception:
            used.add(exception)
            continue
        if path.endswith(SCANNED_SUFFIXES):
            problems += [f'literal secret: {p}:{n}' for p, n in find_secret_lines(path, text)]
        if path.endswith(JS_SUFFIXES) and strict:
            problems += [f'credential fallback literal: {path}:{n}' for n in find_credential_fallbacks(text, path)]
        elif path.endswith(SOURCE_SUFFIXES):
            problems += [f'credential fallback literal: {path}:{n}' for n in find_wide_fallbacks(text, path)]
    problems += [f'stale literal exception (matches no scanned file): {p}' for p in LITERAL_EXCEPTIONS if p not in used]
    return problems


def main() -> int:
    tracked = subprocess.run(
        ['git', 'ls-files'], capture_output=True, text=True, check=True, shell=False,
    ).stdout.splitlines()
    problems = scan_tree(tracked)
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
