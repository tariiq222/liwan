# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Read-only, dependency-free UI migration gate; not a security boundary."""
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
CHARTS = APP + 'components/charts/'
CATALOG = 'docs/design-system/components.md'
MANIFESTS = ('package.json', 'apps/web/package.json')
STORIES = 'apps/web/stories/'
STORYBOOK = 'apps/web/.storybook/'
STORY_ROOTS = (STORIES, STORYBOOK)
STORY_SUFFIXES = {'.vue', '.ts', '.mjs', '.mdx'}
COMPONENTS = APP + 'components/'
# Reused building blocks that must each have a story (spec §1). Add a path here when a
# component starts being reused across pages, together with its story.
STORYBOOK_COMPONENTS: tuple[str, ...] = tuple(COMPONENTS + path for path in (
    'shared/PageHeader.vue', 'shared/PageState.vue', 'shared/PageContainer.vue', 'shared/UnsavedChanges.vue',
    'shared/FormSection.vue', 'shared/RecordNumber.vue', 'settings/SettingsLayout.vue', 'shared/EmptyState.vue',
    'shared/FilterBar.vue', 'shared/DateField.vue', 'task/DescriptionEditor.vue', 'meetings/MeetingProjectFilter.vue',
    'meetings/MeetingPeopleFields.vue', 'shared/FileField.vue', 'project/ProjectFieldHelp.vue',
    'project/ProjectStatusBadge.vue', 'task/StateBadge.vue', 'task/DeadlineBadge.vue', 'access/AccessStateBadge.vue',
    'hr/AccessBadge.vue', 'task/PrioritySelect.vue', 'task/StateMenu.vue', 'task/TagPicker.vue',
    'project/ProjectMenu.vue', 'shell/SidebarCreateAction.vue', 'chat/ChatAttachment.vue', 'task/TaskCard.vue',
    'project/dashboard/DashboardChartPanel.vue', 'shared/DashboardChart.client.vue', 'charts/ChartContainer.vue',
    'project/workspace/ProjectWorkspaceTabs.vue', 'project/workspace/ProjectGovernanceTabs.vue',
    'shared/RichText.vue', 'shared/Pagination.vue', 'shared/MetricTile.vue', 'shared/InlineConfirm.vue',
    'shared/RowActions.vue', 'shared/PersonPicker.vue', 'shared/FilterChip.vue', 'shared/FilterChoice.vue',
    'shared/FilterField.vue',
))
STORY_CONTEXT = re.compile(r'''\bstoryContext\(\s*(['"])([^'"]+)\1''')
META_COMPONENT = re.compile(r'\bcomponent:\s*(\w+)')
DEFAULT_VUE_IMPORT = re.compile(r'''^\s*import\s+(\w+)\s+from\s+(['"])([^'"]+\.vue)\2''', re.M)
SCOPE = (*(root.rstrip('/') for root in SOURCE_ROOTS), *(root.rstrip('/') for root in STORY_ROOTS), *MANIFESTS, CATALOG)
THEME_OWNERS = {
    APP + 'assets/css/main.css',
    APP + 'assets/css/tokens.css',
    APP + 'assets/css/components.css',
    APP + 'assets/css/shell.css',
    APP + 'utils/brandTheme.ts',
    APP + 'app.config.ts',
}
RETIRED_CSS = {
    APP + 'assets/css/approved-shell.css',
    APP + 'assets/css/project-theme.css',
    APP + 'assets/css/nuxt-theme.css',
    APP + 'assets/css/nuxt-shell.css',
}
# Match actual import/export statements, side-effect imports, and dynamic
# imports. Anchoring static imports to the start of a line prevents words such
# as "from" inside route query strings from becoming fake specifiers.
IMPORTS = re.compile(r'''(?mx)
(?:^[ \t]*(?:import|export)\b(?:(?!;|^[ \t]*(?:import|export)\b)[\s\S])*?\bfrom[ \t\r\n]+|^[ \t]*(?:@import|import)\s*|\b(?:import|require)\s*\(\s*)
(['"])([^'"]+)\1''')
COMMENTS = re.compile(r'/\*[\s\S]*?\*/|<!--[\s\S]*?-->|^[ \t]*//[^\n]*', re.MULTILINE)
CHART_IDENTIFIERS = {'chartcontainer', 'chartstyle', 'chartlegendcontent', 'charttooltipcontent'}
MOCK_FIXTURE_PATH = re.compile(r'(?:^|/)(?:__mocks?__|mocks?|__fixtures?__|fixtures?)(?:/|$)', re.I)
RETIRED_PACKAGES = {'@lucide/vue'}
# Storybook renders the real components and is the mandatory component
# catalog agents build from; it is not a second UI library, so it cannot
# become the drift this guard catches.
REVIEWED_STORYBOOK_TOOLING = {
    'storybook', '@storybook/vue3-vite', '@storybook/addon-docs',
    'msw', 'msw-storybook-addon', '@vitejs/plugin-vue', 'vite',
}


def source_file(path: str) -> bool:
    return (path.startswith(SOURCE_ROOTS) and Path(path).suffix in {'.vue', '.ts', '.js', '.mjs', '.css', '.scss'}
            and '/__tests__/' not in path and not re.search(r'\.(test|spec)\.', path))


def story_file(path: str) -> bool:
    return (path.startswith(STORY_ROOTS) and Path(path).suffix in STORY_SUFFIXES
            and '/__tests__/' not in path and not re.search(r'\.(test|spec)\.', path))


def resolve_specifier(path: str, specifier: str) -> str | None:
    if specifier.startswith(('@/', '~/')):
        return APP + specifier[2:]
    if specifier.startswith('.'):
        return posixpath.normpath(posixpath.join(posixpath.dirname(path), specifier))
    return None


def component_names(component: str) -> set[str]:
    relative = component[len(COMPONENTS):]
    stem = relative.rsplit('/', 1)[-1].removesuffix('.vue').removesuffix('.client')
    prefix = ''.join(part[:1].upper() + part[1:] for part in relative.split('/')[:-1])
    return {stem, prefix + stem}


def mentions(text: str, names: set[str]) -> bool:
    return any(re.search(rf'(?<![\w-]){re.escape(name)}(?![\w-])', text) for name in names)


def story_component(path: str, source: str) -> str | None:
    meta = META_COMPONENT.search(source)
    if not meta:
        return None
    for match in DEFAULT_VUE_IMPORT.finditer(source):
        if match.group(1) == meta.group(1):
            return resolve_specifier(path, match.group(3))
    return None


def dependencies(snapshot: dict[str, str]) -> set[str]:
    names = set()
    for path in MANIFESTS:
        data = json.loads(snapshot.get(path, '{}'))
        for field in ('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'):
            names.update(data.get(field, {}))
    return names


def dependency_versions(snapshot: dict[str, str]) -> dict[str, str]:
    versions = {}
    for path in MANIFESTS:
        data = json.loads(snapshot.get(path, '{}'))
        for field in ('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'):
            versions.update(data.get(field, {}))
    return versions


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
    chart_adapter = path.startswith(CHARTS)
    # Template attribute values such as date-from must not be parsed as imports.
    scriptless = re.sub(r'<script\b[^>]*>[\s\S]*?</script\s*>', '', source, flags=re.I) if path.endswith('.vue') else ''
    import_source = re.sub(r'<template\b[^>]*>[\s\S]*</template\s*>', '', source, flags=re.I) if path.endswith('.vue') else source
    if path.endswith('.vue'):
        # Inline SFC blocks may put an import immediately after the opening
        # tag. Replace block tags with boundaries so static imports retain the
        # same line-oriented guard used for ordinary TypeScript files.
        import_source = re.sub(r'</?(?:script|style)\b[^>]*>', '\n', import_source, flags=re.I)
    for match in IMPORTS.finditer(import_source):
        specifier = match.group(2)
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), specifier))
        if package_name(specifier) in RETIRED_PACKAGES:
            result['retired runtime import: ' + specifier] += 1
        elif MOCK_FIXTURE_PATH.search(specifier):
            result['runtime mock/fixture import: ' + specifier] += 1
        elif ('components/ui/' in specifier or specifier.endswith('components/ui')
                or resolved.startswith(LEGACY) or resolved == LEGACY.rstrip('/')
                or package_name(specifier) in {'vue-sonner', 'shadcn-nuxt'}
                or (package_name(specifier) == 'reka-ui' and not chart_adapter)):
            result['legacy import: ' + specifier] += 1
        elif resolved in RETIRED_CSS:
            result['retired stylesheet import: ' + specifier] += 1
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
        normalized_name = normalize(name)
        # Chart adapters are specialist rendering files, and the shared
        # dashboard is their explicit consumer. Their imported Chart* names
        # are not legacy UI controls even though the historical snapshot used
        # the same identifiers under components/ui/chart.
        if normalized_name in names and not (
            normalized_name in CHART_IDENTIFIERS
            and (chart_adapter or path == APP + 'components/shared/DashboardChart.client.vue')
        ):
            result['legacy component: ' + normalized_name] += 1
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


def story_errors(current: dict[str, str]) -> list[str]:
    errors = []
    covered = set()
    for path, source in sorted(current.items()):
        if source_file(path) and path.startswith(APP):
            for match in IMPORTS.finditer(COMMENTS.sub('', source)):
                target = resolve_specifier(path, match.group(2))
                if target and target.startswith(('apps/web/stories', 'apps/web/.storybook')):
                    errors.append(path + ': app code must not import Storybook files')
                    break
        if not story_file(path):
            continue
        if path.endswith('.vue'):
            errors.append(path + ': Storybook renders real components; no .vue files in stories')
            continue
        # Strip comments from story source before checking for imports and context
        story_source = COMMENTS.sub('', source)
        for match in IMPORTS.finditer(story_source):
            target = resolve_specifier(path, match.group(2))
            if target and target.endswith('.vue') and not target.startswith(COMPONENTS):
                errors.append(path + ': stories import components only from apps/web/app/components')
                break
        component = story_component(path, story_source)
        if not component or not component.startswith(COMPONENTS):
            continue
        covered.add(component)
        refs = [match.group(2) for match in STORY_CONTEXT.finditer(story_source)]
        if not refs:
            errors.append(path + ': story needs storyContext(<file:line> or unused)')
        for ref in refs:
            if ref == 'unused':
                continue
            file, _, line = ref.rpartition(':')
            if not line.isdigit() or file not in current or not mentions(current[file], component_names(component)):
                errors.append(f'{path}: storyContext {ref} does not point at a real usage of {component}')
    for component in STORYBOOK_COMPONENTS:
        if component not in current:
            errors.append(component + ': listed Storybook component does not exist')
        elif component not in covered:
            errors.append(component + ': component needs a story')
    return errors


def story_warnings(current: dict[str, str]) -> list[str]:
    warnings = []
    for path, source in sorted(current.items()):
        if not story_file(path) or path.endswith('.vue'):
            continue
        # Strip comments from story source before checking for context and component
        story_source = COMMENTS.sub('', source)
        component = story_component(path, story_source)
        if not component or not component.startswith(COMPONENTS):
            continue
        for match in STORY_CONTEXT.finditer(story_source):
            file, _, line = match.group(2).rpartition(':')
            if file not in current or not line.isdigit():
                continue
            lines = current[file].splitlines()
            number = int(line)
            if not 1 <= number <= len(lines) or not mentions(lines[number - 1], component_names(component)):
                warnings.append(f'{path}: update storyContext {match.group(2)}; that line no longer uses the component')
    return warnings


# Patterns the 2026-09-14 unification retired. Each has one shared replacement
# (DESIGN.md §6), so a new occurrence is drift, not a design choice.
RETIRED_PATTERNS = (
    (re.compile(r'(?<![\w-])(?:text-muted-foreground|bg-muted-foreground|border-border|text-destructive|ring-ring|divide-border|bg-card|text-foreground|bg-background)(?![\w-])'),
     'retired shadcn colour class; use Nuxt UI tokens (text-muted, border-default, text-error, bg-default)'),
    (re.compile(r'shadow-\[inset'), 'hand-built tab underline; use routeTabClass/sectionTabsUi from utils/sectionTabs.ts'),
    (re.compile(r'(?<![\w-])(?:size|text)-\[\d+(?:\.\d+)?px\]'), 'arbitrary size or font size; use the Tailwind scale'),
    (re.compile(r'(?<![\w-])prose(?:-(?:sm|base|lg))?(?![\w-])'), 'prose classes have no plugin; render stored HTML with SharedRichText'),
    (re.compile(r'\bv-html='), 'raw v-html; render stored HTML with SharedRichText'),
    (re.compile(r'text-sm font-medium leading-none'), 'hand-built field label; use UFormField'),
)
RETIRED_PATTERN_OWNERS = {APP + 'components/shared/RichText.vue'}


def retired_pattern_errors(current: dict[str, str]) -> list[str]:
    errors = []
    for path, source in sorted(current.items()):
        if not path.startswith(APP) or '/__tests__/' in path or path in RETIRED_PATTERN_OWNERS:
            continue
        if not path.endswith(('.vue', '.ts')):
            continue
        text = COMMENTS.sub('', source)
        for pattern, reason in RETIRED_PATTERNS:
            count = len(pattern.findall(text))
            if count:
                errors.append(f'{path}: {reason} (+{count})')
    return errors


def check(current: dict[str, str], baseline: dict[str, str], head: dict[str, str]) -> list[str]:
    errors = []
    # @nuxt/schema ships inside nuxt itself and is where Nuxt's own docs put
    # RouterConfig, which app/router.options.ts is typed against. It carries no
    # components, so it cannot become the second UI library this guard exists
    # to catch.
    allowed_source = dependencies(baseline) | {
        '@nuxt/ui', '@iconify-json/lucide', '@internationalized/date', '@nuxt/schema',
    }
    # The tooling manifest review accepts Storybook's own dev-time packages;
    # app runtime source importing them is still a finding (via allowed_source
    # below), since Storybook is a viewer, not a second UI library.
    allowed_manifest = allowed_source | REVIEWED_STORYBOOK_TOOLING
    names = legacy_names(baseline)
    has_ui = '@nuxt/ui' in json.loads(current.get('apps/web/package.json', '{}')).get('dependencies', {})
    baseline_versions = dependency_versions(baseline)
    current_versions = dependency_versions(current)
    for package in sorted(dependencies(current) - allowed_manifest):
        errors.append('dependency needs review: ' + package)
    for package in sorted(dependencies(current) & RETIRED_PACKAGES):
        errors.append('retired dependency: ' + package)
    for package in sorted(set(current_versions) & set(baseline_versions)):
        if current_versions[package] != baseline_versions[package]:
            errors.append('dependency version needs review: ' + package)
    for path, source in sorted(current.items()):
        if not source_file(path):
            continue
        if path.startswith(PREVIEW):
            errors.append(path + ': retired design-preview source tree')
        if path.startswith(LEGACY):
            errors.append(path + ': retired legacy component tree')
        if path in RETIRED_CSS:
            errors.append(path + ': retired stylesheet')
        if path.startswith(APP + 'components/') and path.endswith('.vue') and path not in baseline:
            if f'`{path}`' not in current.get(CATALOG, ''):
                errors.append(path + ': register exact path, recipe and primitives in the catalog')
        errors.extend(f'{path}: {reason} (+{count})' for reason, count in sorted(findings(path, source, names, allowed_source, has_ui).items()))
    errors.extend(story_errors(current))
    errors.extend(retired_pattern_errors(current))
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
                and (source_file(entry.name) or story_file(entry.name) or entry.name in (*MANIFESTS, CATALOG))}


def current_snapshot(root: Path) -> dict[str, str]:
    paths = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *SCOPE)
    current = {}
    for raw in paths.split(b'\0'):
        if not raw:
            continue
        path = raw.decode('utf-8')
        if not (source_file(path) or story_file(path) or path in (*MANIFESTS, CATALOG)):
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
        warnings = story_warnings(current)
    except (OSError, ValueError, subprocess.CalledProcessError, tarfile.TarError) as exc:
        sys.stderr.write(f'UI policy could not run (baseline/history and inputs required): {exc}\n')
        return 2
    for warning in warnings:
        sys.stdout.write('WARN: ' + warning + '\n')
    if errors:
        sys.stdout.write('\n'.join(errors) + f'\nFAIL: {len(errors)} UI policy finding(s). No files changed.\n')
        return 1
    sys.stdout.write('PASS: no new static UI policy violations. Visual/behavior review still required.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
