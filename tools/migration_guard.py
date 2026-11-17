# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A manifest version bump must ship migrations/<version>/ (docs/migrations.md)."""
from __future__ import annotations

import argparse
import ast
import subprocess
import sys
from pathlib import Path

ADDONS_ROOT = Path('odoo-addons')
ACCEPTED_PREFIXES = ('pre-', 'post-', 'end-')


def _key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split('.'))


def check_addon(addon: str, old: str | None, new: str, entries: set[str]) -> str | None:
    if old is None or old == new:
        return None
    if _key(new) < _key(old):
        return f'{addon}: version went backwards {old} -> {new}'
    ok = any(e == 'README.md' or (e.startswith(ACCEPTED_PREFIXES) and e.endswith('.py')) for e in entries)
    if ok:
        return None
    return f'{addon}: version {old} -> {new} but migrations/{new}/ is missing or empty'


def check_added_dirs(addon: str, old: str | None, added: set[str]) -> list[str]:
    """A migrations/<version>/ directory added at or below the base version never runs on a database already there."""
    if old is None:
        return []
    return [
        f'{addon}: migrations/{version}/ is new but the base is already at {old}, so it never runs; bump above {old}'
        for version in sorted(added) if _key(version) <= _key(old)
    ]


def _added_dirs(base: str, addon: str) -> set[str]:
    listed = subprocess.run(
        ['git', 'diff', '--name-only', '--diff-filter=A', base, '--', f'{ADDONS_ROOT.as_posix()}/{addon}/migrations'],
        capture_output=True, text=True, check=False, shell=False,
    )
    return {Path(line).parts[3] for line in listed.stdout.splitlines() if len(Path(line).parts) > 4}


def _version(text: str) -> str:
    return ast.literal_eval(text)['version']


def _old_version(base: str, manifest: Path) -> str | None:
    shown = subprocess.run(
        ['git', 'show', f'{base}:{manifest.as_posix()}'],
        capture_output=True, text=True, check=False, shell=False,
    )
    return _version(shown.stdout) if shown.returncode == 0 else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='git ref to compare against, e.g. origin/main')
    args = parser.parse_args(argv)
    problems = []
    for manifest in sorted(ADDONS_ROOT.glob('liwan_*/__manifest__.py')):
        addon = manifest.parent.name
        new = _version(manifest.read_text(encoding='utf-8'))
        directory = manifest.parent / 'migrations' / new
        entries = {p.name for p in directory.iterdir()} if directory.is_dir() else set()
        old = _old_version(args.base, manifest)
        problem = check_addon(addon, old, new, entries)
        if problem:
            problems.append(problem)
        problems.extend(check_added_dirs(addon, old, _added_dirs(args.base, addon)))
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
