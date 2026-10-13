# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Contract documents must not point at files that no longer exist.

Checks the path-like `backtick` references and relative markdown links of the
instruction documents listed in DOCS. Placeholders, globs, routes, URLs and
commands are ignored; only tokens that look like repository files are checked.
A trailing `:<line>` or `:<line>-<line>` is ignored. A code span broken across
two lines is not checked. A bare file name such as `common.py` is only looked up
relative to the document; the addon shorthand needs a slash (`nasq_hr/x.py`).
"""
from __future__ import annotations

import posixpath
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ('CLAUDE.md', 'AGENTS.md', 'docs/agents/odoo-rules.md', 'docs/agents/web-rules.md', 'docs/agents/repository-layout.md', 'docs/agents/integration-rules.md', 'docs/parallel-work.md', 'REVIEW.md')
FILE_SUFFIXES = ('.py', '.ts', '.vue', '.md', '.json', '.yml', '.yaml', '.sh', '.mjs', '.js')
CODE_RE = re.compile(r'`([^`\n]+)`')
LINK_RE = re.compile(r'\]\(([^)\s#]+)(?:#[^)]*)?\)')
SKIP_CHARS = set('<>*{}$|=,:;()[] ')
# Per-machine files that are intentionally absent from a checkout.
ALLOWED_MISSING = frozenset({
    '.claude/settings.local.json',
    '.claude/odoo.json',
    'deploy/branding.json',
    'platform_vN.json',
})
# File names the instruction documents mention without a directory because the
# directory differs per application or addon; a bare name is not resolved by suffix.
BARE_NAMES = frozenset({
    '__init__.py', 'common.json', 'hr.json', 'tasks.json', 'projects.json', 'settings.json',
    'platform_v3.json', 'nuxt.config.ts',
})
# Directories whose slashed, suffix-less tokens are repository paths.
TOP_DIRS = ('apps/', 'odoo-addons/', 'packages/', 'docs/', 'tools/', 'deploy/', 'e2e/', '.claude/')


def _candidate(token: str) -> str | None:
    token = re.sub(r':\d+(-\d+)?$', '', token.strip())
    if not token or token.startswith(('/', '~')) or any(c in SKIP_CHARS for c in token) or '://' in token:
        return None
    token = token.rstrip('/')
    if token.endswith(FILE_SUFFIXES) or token.startswith(TOP_DIRS):
        return token
    return None


def _known_paths(root: Path) -> set[str]:
    out = subprocess.run(
        ['git', 'ls-files', '-co', '--exclude-standard'],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout.split('\n')
    known: set[str] = set()
    for path in filter(None, out):
        known.add(path)
        parts = path.split('/')
        for i in range(1, len(parts)):
            known.add('/'.join(parts[:i]))
    return known


def _exists(token: str, base: str, known: set[str]) -> bool:
    if token in known or posixpath.normpath(posixpath.join(base, token)) in known:
        return True
    # Shorthand relative to an addon or package, e.g. `nasq_hr/tests/x.py`.
    return '/' in token and any(path.endswith('/' + token) for path in known)


def find_missing(doc: str, text: str, known: set[str]) -> list[tuple[int, str]]:
    base = Path(doc).parent.as_posix()
    missing: list[tuple[int, str]] = []
    for number, line in enumerate(text.splitlines(), 1):
        refs = [(m, False) for m in CODE_RE.findall(line)] + [(m, True) for m in LINK_RE.findall(line)]
        for raw, is_link in refs:
            token = raw.rstrip('/') if is_link and not raw.startswith(('http://', 'https://', 'mailto:', '/')) else None
            if not is_link:
                token = _candidate(raw)
            if not token or token in ALLOWED_MISSING or token in BARE_NAMES:
                continue
            if not _exists(token, base, known):
                missing.append((number, token))
    return missing


def main() -> int:
    known = _known_paths(ROOT)
    failures = []
    for doc in DOCS:
        path = ROOT / doc
        if not path.exists():
            continue
        for number, token in find_missing(doc, path.read_text(encoding='utf-8'), known):
            failures.append(f'{doc}:{number}: missing file reference {token}')
    for failure in failures:
        sys.stderr.write(failure + '\n')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
