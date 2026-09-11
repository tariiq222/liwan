# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Read-only, dependency-free UI migration ratchet; not a security boundary."""
from __future__ import annotations

import io
import json
import posixpath
import re
import subprocess
import sys
import tarfile
from collections import Counter
from pathlib import Path

BASELINE = 'fce4561330200947e4db88b508285fecf9bb05a5'
APP = 'apps/web/app/'
PREVIEW = 'apps/web/design-preview/app/'
SOURCE_ROOTS = (APP, PREVIEW)
LEGACY = APP + 'components/ui/'
CATALOG = 'docs/design-system/components.md'
MANIFESTS = ('package.json', 'apps/web/package.json')
SCOPE = (*(root.rstrip('/') for root in SOURCE_ROOTS), *MANIFESTS, CATALOG)
THEME_OWNERS = {
    APP + 'assets/css/main.css',
    APP + 'assets/css/approved-shell.css',
    APP + 'assets/css/project-theme.css',
    APP + 'assets/css/nuxt-theme.css',
    APP + 'assets/css/nuxt-shell.css',
    APP + 'utils/brandTheme.ts',
    APP + 'app.config.ts',
    PREVIEW + 'assets/theme.css',
    PREVIEW + 'app.config.ts',
}
IMPORTS = re.compile(r'''(?:\b(?:from|import)\s*|\b(?:import|require)\s*\(\s*)(['"])([^'"]+)\1''')
COMMENTS = re.compile(r'/\*[\s\S]*?\*/|<!--[\s\S]*?-->|^[ \t]*//[^\n]*', re.MULTILINE)


def source_file(path: str) -> bool:
    return (path.startswith(SOURCE_ROOTS) and Path(path).suffix in {'.vue', '.ts', '.js', '.mjs', '.css', '.scss'}
            and '/__tests__/' not in path and not re.search(r'\.(test|spec)\.', path))


def dependencies(snapshot: dict[str, str]) -> set[str]:
    names = set()
    for path in MANIFESTS:
        data = json.loads(snapshot.get(path, '{}'))
        for field in ('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'):
            names.update(data.get(field, {}))
    return names


def normalize(name: str) -> str:
    return name.replace('-', '').lower()


def legacy_names(snapshot: dict[str, str]) -> set[str]:
    names = set()
    for path, source in snapshot.items():
        if not path.startswith(LEGACY):
            continue
        if path.endswith('.vue'):
            names.add(Path(path).stem)
        if path.endswith('/index.ts'):
            names.update(re.findall(r'\bdefault\s+as\s+(\w+)', source))
    return {normalize(prefix + name) for name in names for prefix in ('', 'Ui', 'Lazy', 'LazyUi')}


def package_name(specifier: str) -> str:
    parts = specifier.split('/')
    return '/'.join(parts[:2]) if specifier.startswith('@') else parts[0]


def findings(path: str, source: str, names: set[str], allowed: set[str], has_ui: bool) -> Counter:
    # ponytail: text patterns cover normal imports/templates, not arbitrary TS/Vue
    # expressions. Use compiler ASTs if dynamic aliases become a recurring gap.
    source = COMMENTS.sub('', source)
    result: Counter = Counter()
    # Template attribute values such as date-from must not be parsed as imports.
    scriptless = re.sub(r'<script\b[^>]*>[\s\S]*?</script\s*>', '', source, flags=re.I) if path.endswith('.vue') else ''
    import_source = re.sub(r'<template\b[^>]*>[\s\S]*</template\s*>', '', source, flags=re.I) if path.endswith('.vue') else source
    for match in IMPORTS.finditer(import_source):
        specifier = match.group(2)
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), specifier))
        if ('components/ui/' in specifier or specifier.endswith('components/ui')
                or resolved.startswith(LEGACY) or resolved == LEGACY.rstrip('/')
                or package_name(specifier) in {'vue-sonner', 'reka-ui', 'shadcn-nuxt'}):
            result['legacy import: ' + specifier] += 1
        elif not specifier.startswith(('.', '#', '~/', '@/', '/', 'node:')):
            package = package_name(specifier)
            if package not in allowed:
                result['unreviewed import: ' + package] += 1
            if package == '@nuxt/ui' and not has_ui:
                result['Nuxt UI is not declared in apps/web/package.json'] += 1

    # Nuxt auto-imported legacy components and explicit #components aliases.
    tags = re.findall(r'<([A-Z][\w-]*|[a-z][\w]*-[\w-]+)\b', scriptless if path.endswith('.vue') else source)
    for group in re.findall(r'''(?:import|export)\s*\{([^}]+)\}\s*from\s*['"]#components['"]''', source):
        tags.extend(re.findall(r'\b\w+\b', group))
    tags.extend(re.findall(r'''resolveComponent\(\s*['"]([\w-]+)['"]''', source))
    tags.extend(re.findall(r''':is\s*=\s*["']\s*["']([\w-]+)["']\s*["']''', source))
    for name in tags:
        if normalize(name) in names:
            result['legacy component: ' + normalize(name)] += 1
        if re.match(r'^(?:Lazy)?U[A-Z]|^(?:lazy-)?u-', name) and not has_ui:
            result['Nuxt UI is not declared in apps/web/package.json'] += 1

    if path not in THEME_OWNERS:
        for pattern, label in (
            (r':root\b|@font-face\b', 'local root/font theme'),
            (r'(?:[:\[]\s*)#[\da-fA-F]{3,8}\b', 'literal hex color'),
            (r'\b(?:bg|text|border|ring|fill|stroke|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b', 'palette color outside theme'),
        ):
            for match in re.finditer(pattern, source):
                result[label + ': ' + match.group()] += 1
    return result


def check(current: dict[str, str], baseline: dict[str, str], head: dict[str, str]) -> list[str]:
    errors = []
    allowed = dependencies(baseline) | {'@nuxt/ui', '@iconify-json/lucide'}
    names = legacy_names(baseline)
    has_ui = '@nuxt/ui' in json.loads(current.get('apps/web/package.json', '{}')).get('dependencies', {})
    for package in sorted(dependencies(current) - allowed):
        errors.append('dependency needs review: ' + package)
    for path, source in sorted(current.items()):
        if not source_file(path):
            continue
        if path.startswith(LEGACY) and path not in baseline:
            errors.append(path + ': no new files in the legacy component tree')
        if path.startswith(tuple(root + 'components/' for root in SOURCE_ROOTS)) and path.endswith('.vue') and path not in baseline:
            if f'`{path}`' not in current.get(CATALOG, ''):
                errors.append(path + ': register exact path, recipe and primitives in the catalog')
        # A baseline allowance cannot be expanded or restored after a committed removal.
        before = findings(path, baseline.get(path, ''), names, allowed, has_ui)
        committed = findings(path, head.get(path, ''), names, allowed, has_ui)
        added = findings(path, source, names, allowed, has_ui) - (before & committed)
        errors.extend(f'{path}: {reason} (+{count})' for reason, count in sorted(added.items()))
    return errors


def git(root: Path, *args: str) -> bytes:
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True).stdout


def snapshot(root: Path, ref: str) -> dict[str, str]:
    # A newly added preview root does not exist in the historical tree yet.
    paths = git(root, 'ls-tree', '-z', '--name-only', ref, '--', *SCOPE).decode().split('\0')
    data = git(root, 'archive', '--format=tar', ref, '--', *(path for path in paths if path))
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        return {entry.name: archive.extractfile(entry).read().decode('utf-8')
                for entry in archive if entry.isfile()
                and (source_file(entry.name) or entry.name in (*MANIFESTS, CATALOG))}


def current_snapshot(root: Path) -> dict[str, str]:
    paths = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *SCOPE)
    current = {}
    for raw in paths.split(b'\0'):
        if not raw:
            continue
        path = raw.decode('utf-8')
        if not (source_file(path) or path in (*MANIFESTS, CATALOG)):
            continue
        target = root / path
        if target.is_symlink():
            raise ValueError('source symlink requires review: ' + path)
        if target.is_file():
            current[path] = target.read_text(encoding='utf-8')
    for required in (*MANIFESTS, CATALOG):
        if required not in current:
            raise ValueError('required policy input missing: ' + required)
    return current


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    try:
        baseline = snapshot(root, BASELINE)
        head = snapshot(root, 'HEAD')
        current = current_snapshot(root)
        errors = check(current, baseline, head)
    except (OSError, ValueError, subprocess.CalledProcessError, tarfile.TarError) as exc:
        sys.stderr.write(f'UI policy could not run (baseline/history and inputs required): {exc}\n')
        return 2
    if errors:
        sys.stdout.write('\n'.join(errors) + f'\nFAIL: {len(errors)} UI policy finding(s). No files changed.\n')
        return 1
    sys.stdout.write('PASS: no new static UI policy violations. Visual/behavior review still required.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
