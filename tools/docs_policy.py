# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Contract documents must not point at files that no longer exist.

Checks the path-like `backtick` references and relative markdown links of the
instruction documents listed in DOCS. Placeholders, globs, routes, URLs and
commands are ignored; only tokens that look like repository files are checked.
A trailing `:<line>` or `:<line>-<line>` is ignored. A code span broken across
two lines is not checked. A bare file name such as `common.py` is only looked up
relative to the document; the addon shorthand needs a slash (`liwan_hr/x.py`).
"""
from __future__ import annotations

import argparse
import posixpath
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
DOCS = ('CLAUDE.md', 'AGENTS.md', 'docs/agents/odoo-rules.md', 'docs/agents/web-rules.md', 'docs/agents/repository-layout.md', 'docs/agents/integration-rules.md', 'docs/parallel-work.md', 'REVIEW.md',
        'docs/WORKSPACE.md', 'docs/testing.md', 'README.md', 'docs/agents/issue-tracker.md')
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
    # Written by a test run and git-ignored.
    '.superpowers/real-odoo/fixtures.json',
    '.e2e/report.json',
})
# File names the instruction documents mention without a directory because the
# directory differs per application or addon; a bare name is not resolved by suffix.
BARE_NAMES = frozenset({
    '__init__.py', 'common.json', 'hr.json', 'tasks.json', 'projects.json', 'settings.json',
    'nuxt.config.ts',
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
        ['git', 'ls-files', '-z', '-co', '--exclude-standard'],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout.split('\0')
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
    # Shorthand relative to an addon or package, e.g. `liwan_hr/tests/x.py`.
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


def _missing_relative_links(doc: str, text: str, known: set[str]):
    parent = Path(doc).parent.as_posix()
    for number, line in enumerate(text.splitlines(), 1):
        for raw in LINK_RE.findall(line):
            if raw.startswith('/') or re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', raw):
                continue
            target = unquote(raw).rstrip('/')
            if posixpath.normpath(posixpath.join(parent, target)) not in known:
                yield number, target


def changed_link_failures(root: Path, base: str, known: set[str]):
    def git(*args: str) -> str:
        return subprocess.check_output(['git', *args], cwd=root, text=True, encoding='utf-8')

    ancestor = git('merge-base', base, 'HEAD').strip()
    changed = git('diff', '--name-status', '--diff-filter=AM', '--no-renames',
                  '-z', ancestor, 'HEAD', '--', 'docs/').split('\0')
    for status, doc in zip(changed[::2], changed[1::2]):
        if not doc.endswith('.md') or doc in DOCS:
            continue
        previous = git('show', f'{ancestor}:{doc}') if status == 'M' else ''
        existing = Counter(target for _, target in _missing_relative_links(doc, previous, known))
        for number, target in _missing_relative_links(doc, (root / doc).read_text(encoding='utf-8'), known):
            if existing[target]:
                existing[target] -= 1
            else:
                yield f'{doc}:{number}: missing file reference {target}'


def main(argv=None, *, root: Path = ROOT) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--changed-markdown', metavar='BASE',
                        help='also check new relative links in edited Markdown under docs/')
    args = parser.parse_args(argv)
    known = _known_paths(root)
    failures = []
    for doc in DOCS:
        path = root / doc
        if not path.exists():
            continue
        for number, token in find_missing(doc, path.read_text(encoding='utf-8'), known):
            failures.append(f'{doc}:{number}: missing file reference {token}')
    if args.changed_markdown:
        failures.extend(changed_link_failures(root, args.changed_markdown, known))
    for failure in failures:
        sys.stderr.write(failure + '\n')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
