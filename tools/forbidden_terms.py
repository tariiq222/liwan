# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fail when a forbidden word appears in tracked files or paths outside an exceptions file.

    python3 -B tools/forbidden_terms.py --terms <terms.txt> [--exceptions <exceptions.txt>] [--allow-string <text> ...] [--root <dir>]

``--terms`` lists one word per line (``#`` starts a comment); matching is case-insensitive. ``--exceptions``
lists one path glob per line, optionally followed by `` # reason``; a file that matches a glob is not scanned,
and neither is its path. ``--allow-string`` (repeatable) removes that literal text from every line and path
before matching, so a protected string such as a repository slug stays legal while any other hit in the same
file is still reported. Only ``git ls-files`` is read and binary files are skipped. Exit 0 when clean, 1 when
a word is found (each hit is printed as ``path:line: word``), 2 for bad input.
"""
from __future__ import annotations

import argparse
import fnmatch
import posixpath
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXIT_FOUND = 1
EXIT_BAD_INPUT = 2
BINARY_SNIFF_BYTES = 8000


class TermsError(Exception):
    """An input problem that stops the run with an explicit message."""


def tracked_paths(root: Path) -> list[str]:
    result = subprocess.run(['git', 'ls-files', '-z'], cwd=root, capture_output=True, text=True, check=True)
    return [path for path in result.stdout.split('\0') if path]


def read_text(path: Path) -> str | None:
    """Return the file text, or None for a binary (NUL byte or not UTF-8) file."""
    raw = path.read_bytes()
    if b'\0' in raw[:BINARY_SNIFF_BYTES]:
        return None
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return None


ALLOWED_MARK = '\0'


def read_list(path: Path) -> list[str]:
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError as exc:
        raise TermsError(f'cannot read {path}: {exc}') from exc
    return [item for item in (line.split(' # ')[0].strip() for line in lines) if item and not item.startswith('#')]


def is_exempt(rel: str, globs: list[str]) -> bool:
    name = posixpath.basename(rel)
    return any(fnmatch.fnmatchcase(rel, g) or fnmatch.fnmatchcase(name, g) for g in globs)


def strip_allowed(text: str, allowed: list[str]) -> str:
    """Blank the allowed literals with a non-word marker, so removing one cannot join its neighbours into a hit."""
    for literal in allowed:
        text = text.replace(literal, ALLOWED_MARK)
    return text


def find_hits(root: Path, terms: list[str], globs: list[str], allowed: list[str]) -> list[str]:
    pattern = re.compile('|'.join(re.escape(t) for t in terms), re.IGNORECASE)
    hits: list[str] = []
    for rel in tracked_paths(root):
        if is_exempt(rel, globs):
            continue
        for match in pattern.finditer(strip_allowed(rel, allowed)):
            hits.append(f'{rel}: path contains {match.group(0)!r}')
        file = root / rel
        if file.is_symlink() or not file.is_file():
            continue
        text = read_text(file)
        if text is None:
            continue
        for number, line in enumerate(text.splitlines(), 1):
            match = pattern.search(strip_allowed(line, allowed))
            if match:
                hits.append(f'{rel}:{number}: {match.group(0)}')
    return hits


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--terms', required=True, type=Path, help='file with one forbidden word per line')
    parser.add_argument('--exceptions', type=Path, help='file with one allowed path glob per line')
    parser.add_argument('--allow-string', action='append', default=[], metavar='TEXT',
                        help='literal text to ignore before matching; repeatable')
    parser.add_argument('--root', type=Path, default=ROOT, help='git work tree to scan (default: this repository)')
    args = parser.parse_args(argv)
    try:
        terms = read_list(args.terms)
        if not terms:
            raise TermsError(f'{args.terms} lists no word')
        hits = find_hits(args.root, terms, read_list(args.exceptions) if args.exceptions else [],
                         [s for s in args.allow_string if s])
    except TermsError as exc:
        print(f'forbidden_terms: {exc}', file=sys.stderr)
        return EXIT_BAD_INPUT
    for hit in hits:
        print(hit)
    print(f'forbidden_terms: {len(hits)} hit(s)')
    return EXIT_FOUND if hits else 0


if __name__ == '__main__':
    sys.exit(main())
