# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Dependency-free gate: a workspace imports only packages its own package.json declares.

A package that resolves only because npm hoisted a transitive copy breaks the day that copy
moves. Read-only. Prints `file:line: <package> ...` per problem and exits 1 on any.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
APPS = ('apps/web', 'apps/vendor-admin', 'apps/control-plane')
SOURCE_SUFFIXES = {'.ts', '.mts', '.mjs', '.js', '.vue'}
SKIPPED_DIRS = {'node_modules', '.nuxt', '.output', '.nitro', '.data', 'dist', 'storybook-static', 'coverage', '.cache', '.git'}
DEPENDENCY_SECTIONS = ('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')
# Specifier prefixes that are never packages: Nuxt/Vite aliases (`~`, `~~`, `@`, `@@`, `#...`), virtual modules, URLs.
NON_PACKAGE_PREFIXES = ('.', '/', '~', '@/', '@@/', '#', 'virtual:', 'node:', 'http:', 'https:', 'data:')
# Node built-ins that are importable without the `node:` prefix.
NODE_BUILTINS = frozenset(
    'assert async_hooks buffer child_process cluster crypto dgram dns events fs http http2 https module net os path '
    'perf_hooks process querystring readline stream string_decoder timers tls tty url util v8 vm worker_threads zlib'.split())
# Short on purpose; every entry says why the package needs no declaration. Never add one to make the check pass.
EXEMPT: dict[str, str] = {}
SPECIFIER = re.compile(
    r"""(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([@\w][\w@./:?=-]*)\1""")


def package_name(specifier: str) -> str | None:
    """`@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`, None for a non-package specifier."""
    if specifier.startswith(NON_PACKAGE_PREFIXES) or specifier in NODE_BUILTINS:
        return None
    parts = specifier.split('/')
    name = '/'.join(parts[:2]) if specifier.startswith('@') else parts[0]
    name = name.split('?')[0]
    return None if name in NODE_BUILTINS or name in EXEMPT else name


def workspaces() -> list[Path]:
    packages = sorted(p.parent for p in (REPO / 'packages').glob('*/package.json'))
    return [REPO / app for app in APPS if (REPO / app / 'package.json').is_file()] + packages


def declared(workspace: Path) -> set[str]:
    manifest = json.loads((workspace / 'package.json').read_text(encoding='utf-8'))
    names = {manifest['name']}
    for section in DEPENDENCY_SECTIONS:
        names.update(manifest.get(section, {}))
    return names


def source_files(workspace: Path):
    for path in sorted(workspace.rglob('*')):
        if path.suffix in SOURCE_SUFFIXES and path.is_file() and not SKIPPED_DIRS & set(path.relative_to(workspace).parts):
            yield path


def imports_of(text: str):
    """(line number, package name) for every static import, re-export, dynamic import and require."""
    for number, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith(('*', '//', '/*')):
            continue
        for match in SPECIFIER.finditer(line):
            name = package_name(match.group(2))
            if name:
                yield number, name


def problems() -> list[str]:
    found = []
    for workspace in workspaces():
        known = declared(workspace)
        for path in source_files(workspace):
            for number, name in imports_of(path.read_text(encoding='utf-8', errors='replace')):
                if name not in known:
                    found.append(f'{path.relative_to(REPO)}:{number}: {name} is not declared in {workspace.relative_to(REPO)}/package.json')
    return found


def main() -> int:
    found = problems()
    for line in found:
        print(line)
    if not found:
        print('undeclared_imports: ok')
    return 1 if found else 0


if __name__ == '__main__':
    sys.exit(main())
