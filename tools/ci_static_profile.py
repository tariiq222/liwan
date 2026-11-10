"""Select the static checks a pull request needs.

A proven documentation-only diff runs only the light documentation checks. Any other diff runs the units its changed
paths can affect (see RULES); a path with no rule, an unreadable diff or any error selects every unit, as before.

    ci_static_profile.py --base <ref> --part policies|tests|types

prints `mode=docs|skip|run`, `units=<space-separated units>` and `playwright=true|false` for that part of the
`static` job (deploy/ci/static.sh); the workflow appends them to its step outputs.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

# The UI policy reads the design system, API artifacts have their own gate, and the deploy suites read the runbooks.
# docs/operations/ is read by deploy/test_odoo_sizing.py and deploy/test_shared_worker_deployment.py.
FULL_DOC_TREES = (b'docs/api/', b'docs/design-system/', b'docs/operations/')
# Root instruction documents: no build, test or tool reads them as input, and the light profile's
# tools/docs_policy.py checks the ones it lists as fully as the full profile does.
ROOT_DOCS = (b'AGENTS.md', b'CLAUDE.md', b'DESIGN.md', b'README.md', b'REVIEW.md')
MAX_DOC_BYTES = 1024 * 1024
BINARY_CONTROL = re.compile(rb'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

# Workspaces whose unit tests `npm test` runs (the `test:workspaces` script in package.json); a unit is the workspace path.
TESTED_WORKSPACES = ('packages/contracts', 'packages/ui', 'packages/commercial-ui', 'packages/commercial-contracts',
                     'apps/web', 'apps/vendor-admin')
# Units by part of the static job, and the ones that always run when the part runs at all. `gates` are the fast,
# diff-aware policy checks. `repo` is the repository-wide policy scripts of `npm test`. `tools` is always selected:
# its Python tests read the whole tree (tools/test_product_namespace.py scans every tracked file outside docs/,
# tools/test_arch_policy.py and tools/test_catalog_check.py check the real tree, tools/test_test_inventory.py lists
# every tracked file), so no path can be proven unread by them.
UNITS_BY_PART = {
    'policies': ('gates', 'deploy-suites'),
    'tests': ('repo', 'tools', *TESTED_WORKSPACES),
    'types': ('types',),
}
ALWAYS_UNITS = ('gates', 'repo', 'tools')
ALL_UNITS = tuple(unit for units in UNITS_BY_PART.values() for unit in units)
# The only unit whose tests drive Chromium (two apps/web tests); the others need no browser.
CHROMIUM_UNITS = ('apps/web',)
# The workspace whose vue-tsc check is the `types` unit.
TYPED_WORKSPACE = 'apps/web'

# What the deploy-suites unit reads outside deploy/ (checked with rg across the suites and the modules they import):
# deploy/test_*.py, deploy/staging, deploy/releases, deploy/shared, the control-plane resource-guard test, and the
# tools/shared_saas_lifecycle, continuous_updates_acceptance, documents_acceptance and shared_isolation_acceptance tests.
DEPLOY_TOOLS = ('tools/app_isolation.py', 'tools/arch_layers.json', 'tools/catalog_check.py', 'tools/ci_not_run.json',
                'tools/e2e_seed.py', 'tools/oca_addons.py', 'tools/odoo_shards.py', 'tools/upgrade_baseline.py',
                'tools/upgrade_log_guard.py', 'tools/liwan_cli/*', 'tools/shared_saas_lifecycle/*', 'tools/continuous_updates_acceptance/*',
                'tools/documents_acceptance/*', 'tools/shared_isolation_acceptance/*')
# apps/web files the node tests of deploy/ and tools/shared_isolation_acceptance read or import.
DEPLOY_WEB_READS = ('apps/web/server/*', 'apps/web/nuxt.config.ts', 'apps/web/tests/tenancy-mutation-check.mjs',
                    'apps/web/app/composables/useApi.ts', 'apps/web/app/composables/useBranding.ts',
                    'apps/web/app/components/hr/EmployeeCard.vue')

# A changed path selects the union of the units of every rule it matches (`*` also crosses `/`); a path no rule matches,
# and no workspace owns, selects every unit. A rule with no units says the path is known and read by nothing beyond
# the always-selected units. Workspace paths are not listed: they select the workspace, its dependents and `types`
# (see workspace_units).
RULES = (
    # CI machinery and the repository-wide inputs of every unit.
    *((pattern, ALL_UNITS) for pattern in (
        '.github/*', 'package.json', 'package-lock.json', '.npmrc', '.nvmrc', 'tsconfig*.json', 'vitest*', 'vite*',
        'deploy/ci/static.sh', 'tools/ci_static_profile.py', 'tools/test_slot.py')),
    # deploy-suites: all of deploy/, the Dockerfiles, the control-plane sources and what the suites read elsewhere.
    ('deploy/*', ('deploy-suites',)),
    ('apps/*/Dockerfile', ('deploy-suites',)),
    ('apps/control-plane/*', ('deploy-suites',)),
    ('packages/commercial-contracts/*', ('deploy-suites',)),
    ('docs/operations/*', ('deploy-suites',)),
    *((pattern, ('deploy-suites',)) for pattern in DEPLOY_TOOLS + DEPLOY_WEB_READS),
    ('odoo-addons/*/__manifest__.py', ('deploy-suites',)),
    *((f'odoo-addons/{path}', ('deploy-suites',)) for path in (
        'liwan_platform/commercial_config.py', 'liwan_ai/models/feature_registry.py',
        'liwan_inbox/adapters/tiktok.py', 'liwan_api/serializers/company.py')),
    # Workspace tests that read outside their workspace.
    ('deploy/shared/*.mjs', ('apps/web', 'types')),            # imported by apps/web server tests
    ('deploy/releases/dedicated_guard.mjs', ('apps/web', 'types')),
    ('deploy/Caddyfile', ('apps/web',)),
    ('deploy/catalog/*', ('packages/commercial-contracts',)),
    ('apps/control-plane/src/schema_025.sql', ('packages/commercial-contracts',)),
    ('odoo-addons/liwan_ai/models/feature_registry.py', ('packages/commercial-contracts',)),
    *((f'odoo-addons/{addon}/*.py', ('packages/contracts',)) for addon in ('liwan_core', 'liwan_api', 'liwan_access_hr')),
    ('odoo-addons/liwan_inbox/controllers/channels.py', ('apps/web',)),
    ('odoo-addons/liwan_ai/models/ai_usage.py', ('apps/web',)),
    ('apps/ai-service/src/liwan_ai_service/contracts.py', ('apps/web',)),
    ('apps/web/i18n/locales/*', ('packages/ui', 'packages/commercial-ui')),
    # Known paths nothing beyond the always-selected units reads.
    *((pattern, ()) for pattern in (
        '.gitignore', '.dockerignore', 'ruff.toml', '.claude/*', 'e2e/*', 'e2e.config.ts', 'scripts/*', 'docs/*',
        'tools/*', 'odoo-addons/*', 'apps/ai-service/*', 'AGENTS.md', 'CLAUDE.md', 'DESIGN.md', 'README.md', 'REVIEW.md')),
)


def git(*args: str) -> bytes:
    return subprocess.check_output(['git', *args], stderr=subprocess.PIPE)


def is_prose_path(path: bytes) -> bool:
    if path in ROOT_DOCS:
        return True
    return path.startswith(b'docs/') and path.endswith(b'.md') and not path.startswith(FULL_DOC_TREES)


def is_prose_blob(object_id: bytes) -> bool:
    oid = object_id.decode('ascii')
    if int(git('cat-file', '-s', oid)) > MAX_DOC_BYTES:
        return False
    content = git('cat-file', 'blob', oid)
    content.decode('utf-8')  # A decode failure makes the caller use the full profile.
    return BINARY_CONTROL.search(content) is None


def changed_entries(base: str) -> list[tuple[list[bytes], bytes]]:
    """(raw header fields, path) of every changed path between the merge base and HEAD; renames show as add + delete."""
    ancestor = git('merge-base', base, 'HEAD').decode('ascii').strip()
    diff = ('diff', '--no-renames', '--no-ext-diff', '--no-textconv',
            '--ignore-submodules=none', '--no-abbrev', '-z')
    raw = git(*diff, '--raw', ancestor, 'HEAD', '--').split(b'\0')[:-1]
    if not raw or len(raw) % 2:
        raise ValueError('empty or malformed diff')
    return [(header.split(), path) for header, path in zip(raw[::2], raw[1::2])]


def is_docs_only(entries: list[tuple[list[bytes], bytes]]) -> bool:
    objects = set()
    for (old_mode, new_mode, old_oid, new_oid, status), path in entries:
        if (not is_prose_path(path) or new_mode != b'100644'
                or (old_mode, status) not in ((b':000000', b'A'), (b':100644', b'M'))):
            return False
        objects.add(new_oid)
        if status == b'M':
            objects.add(old_oid)
    return all(is_prose_blob(oid) for oid in objects)


def workspace_graph(root: Path) -> dict[str, set[str]]:
    """Each workspace path with the workspace paths it depends on, from the `@liwan/*` entries of its package.json."""
    names, requires = {}, {}
    for pattern in json.loads((root / 'package.json').read_text(encoding='utf-8'))['workspaces']:
        for manifest in sorted(root.glob(f'{pattern}/package.json')):
            data = json.loads(manifest.read_text(encoding='utf-8'))
            path = manifest.parent.relative_to(root).as_posix()
            names[data['name']] = path
            requires[path] = {name for key in ('dependencies', 'devDependencies', 'peerDependencies')
                              for name in data.get(key, {}) if name.startswith('@liwan/')}
    return {path: {names[name] for name in wanted} for path, wanted in requires.items()}


def reachable(graph: dict[str, set[str]], start: str) -> set[str]:
    """`start` and everything it depends on, transitively."""
    found, pending = set(), [start]
    while pending:
        current = pending.pop()
        if current not in found:
            found.add(current)
            pending.extend(graph[current])
    return found


def workspace_units(path: str, graph: dict[str, set[str]]) -> set[str] | None:
    """The units a path inside a workspace selects: that workspace and every workspace depending on it, and `types`
    when the web app's type check includes it. None when the path is in no workspace."""
    owner = next((workspace for workspace in graph if path.startswith(workspace + '/')), None)
    if owner is None:
        return None
    units = {workspace for workspace in graph if owner in reachable(graph, workspace)} & set(TESTED_WORKSPACES)
    if owner in reachable(graph, TYPED_WORKSPACE):
        units.add('types')
    return units


def units_for(path: str, graph: dict[str, set[str]]) -> set[str]:
    """The units for one changed path; every unit when nothing owns the path."""
    matched = [units for pattern, units in RULES if fnmatch.fnmatchcase(path, pattern)]
    owned = workspace_units(path, graph)
    if owned is not None:
        matched.append(owned)
    if not matched:
        return set(ALL_UNITS)
    return set().union(*matched)


def selected_units(paths: list[str], graph: dict[str, set[str]]) -> set[str]:
    return set(ALWAYS_UNITS).union(*(units_for(path, graph) for path in paths))


def selection(base: str, part: str, root: Path = Path('.')) -> tuple[str, list[str]]:
    """(`docs`, `skip` or `run`, the part's units) for a pull request against `base`. Any error selects every unit."""
    try:
        entries = changed_entries(base)
        if is_docs_only(entries):
            return ('docs', []) if part == 'policies' else ('skip', [])
        graph = workspace_graph(root)
        chosen = selected_units([path.decode('utf-8') for _, path in entries], graph)
    except Exception as error:  # Fail closed: whatever went wrong, run everything the part runs on a push to main.
        print(f'Cannot select the static checks ({error}); running all of them.', file=sys.stderr)
        chosen = set(ALL_UNITS)
    units = [unit for unit in UNITS_BY_PART[part] if unit in chosen]
    return ('run', units) if units else ('skip', [])


def render(mode: str, units: list[str]) -> str:
    playwright = 'true' if any(unit in CHROMIUM_UNITS for unit in units) else 'false'
    return f'mode={mode}\nunits={" ".join(units)}\nplaywright={playwright}'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--base', required=True)
    parser.add_argument('--part', required=True, choices=sorted(UNITS_BY_PART))
    args = parser.parse_args()
    print(render(*selection(args.base, args.part)))
