"""Choose the Woodpecker stages a change can affect; a path without a rule runs all twelve.

    python3 -B tools/ci_scope.py --base <ref> [--commit <ref>]

Prints the stages selected for the files changed between the two refs and the rule behind each
changed path. This module is the only place the path-to-stage map lives: ``local_ci.py`` runs the
selection and ``merge_main.py`` re-derives it to verify the receipt.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from fnmatch import fnmatchcase
from pathlib import Path

STAGES = ('static', 'ai-service', 'control-plane', 'vendor-admin', 'odoo',
          'odoo-tasks-standalone', 'odoo-tasks-bridge', 'upgrade',
          'restore-drill', 'image', 'e2e-mock', 'rtl-stories')
# Tools no non-static step runs and no application code executes (checked with rg across
# `.woodpecker.yml`, deploy/, apps/, packages/ and odoo-addons/). Everything else under tools/,
# including tools/webvue_cli/ and tools/shared_saas_lifecycle/ (run by the control-plane tests),
# is unmapped on purpose, so a new tool runs all twelve stages until it is listed here.
STATIC_ONLY_TOOLS = (
    'tools/test_*', 'tools/api_surface.py', 'tools/arch_baseline.json', 'tools/arch_layers.json',
    'tools/arch_policy.py', 'tools/check_fast.py', 'tools/contracts_jsonschema.mjs',
    'tools/docs_policy.py', 'tools/e2e_isolated.mjs', 'tools/git_policy.py', 'tools/hooks.py',
    'tools/jev_review.mjs', 'tools/merge_main.py', 'tools/migration_guard.py', 'tools/new_app.py',
    'tools/new_app_templates/*', 'tools/no_external_refs.py', 'tools/odoo_test.py',
    'tools/secret_guard.py', 'tools/semgrep_gate.py', 'tools/ship.py', 'tools/ts_loader.mjs',
    'tools/ui_catalog.mjs', 'tools/ui_inventory.py', 'tools/ui_layer_baseline.mjs',
    'tools/ui_policy.py', 'tools/ui_templates.mjs', 'tools/wt.py',
)
SHARED_PACKAGE_STAGES = ('control-plane', 'vendor-admin', 'e2e-mock', 'rtl-stories')
UNMAPPED = '(no rule: all stages)'

# First match wins, so the paths that need every stage come first. `*` also crosses `/`, hence
# `dir/*` covers a whole tree. `static` is added to every selection and is not repeated here.
RULES = (
    # CI machinery: the pipeline itself, its scripts, and the repository-wide inputs of every step.
    ('.woodpecker.yml', STAGES),
    ('tools/local_ci.py', STAGES),
    ('tools/ci_scope.py', STAGES),
    ('tools/catalog_check.py', STAGES),      # odoo, upgrade, restore-drill and image read --release-modules
    ('tools/upgrade_baseline.py', STAGES),   # the upgrade step
    ('tools/upgrade_log_guard.py', STAGES),  # the upgrade step
    ('deploy/*', STAGES),                    # stage.sh, ci-test.sh, classification.py, the image Dockerfile
    ('odoo-addons/*', STAGES),               # the Odoo steps, the image and the static ruff run
    ('packages/contracts/*', STAGES),
    ('package.json', STAGES),
    ('package-lock.json', STAGES),
    ('.npmrc', STAGES),
    ('.nvmrc', STAGES),
    ('.dockerignore', STAGES),               # shapes the image build context
    # Only the static stage reads these.
    ('*.md', ()),
    ('docs/*', ()),
    *((path, ()) for path in STATIC_ONLY_TOOLS),
    ('e2e/*', ()),
    ('e2e.config.ts', ()),
    ('ruff.toml', ('ai-service',)),          # the ai-service step lints with the nearest ruff config
    # Applications and the shared packages they build from.
    ('apps/web/*', ('control-plane', 'e2e-mock', 'rtl-stories')),  # control-plane tests import apps/web server code
    ('apps/vendor-admin/*', ('vendor-admin',)),
    ('apps/control-plane/*', ('control-plane',)),
    ('apps/ai-service/*', ('ai-service',)),
    ('packages/ui/*', SHARED_PACKAGE_STAGES),
    ('packages/commercial-ui/*', SHARED_PACKAGE_STAGES),
    ('packages/commercial-contracts/*', SHARED_PACKAGE_STAGES),
)


class ScopeError(RuntimeError):
    """The changed files could not be read."""


def matching_rule(path: str) -> tuple[str, tuple[str, ...]]:
    for pattern, stages in RULES:
        if fnmatchcase(path, pattern):
            return pattern, stages
    return UNMAPPED, STAGES


def stages_for(paths: list[str]) -> tuple[str, ...]:
    """The stages for a change, in pipeline order; `static` always runs."""
    selected = {'static'}.union(*(matching_rule(path)[1] for path in paths))
    return tuple(stage for stage in STAGES if stage in selected)


def scope(paths: list[str], full: bool) -> dict:
    """The receipt's `scope` entry: every stage when `full`, else the change's selection."""
    stages = STAGES if full else stages_for(paths)
    return {'mode': 'full' if full else 'selected', 'stages': list(stages),
            'skipped': [stage for stage in STAGES if stage not in stages]}


def changed_paths(repo: Path, base: str, commit: str, env: dict | None = None) -> list[str]:
    """Files changed from base to commit; a rename counts as a delete plus an add."""
    try:
        listing = subprocess.check_output(
            ['git', '-C', str(repo), 'diff', '--name-only', '--no-renames', '-z', base, commit],
            env=env, text=True, stderr=subprocess.PIPE)
    except (OSError, subprocess.CalledProcessError) as error:
        raise ScopeError(f'cannot list the files changed from {base} to {commit}: {error}') from error
    return sorted(filter(None, listing.split('\0')))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--base', required=True)
    parser.add_argument('--commit', default='HEAD')
    args = parser.parse_args(argv)
    try:
        paths = changed_paths(Path.cwd(), args.base, args.commit)
    except ScopeError as error:
        print(f'ci_scope: {error}', file=sys.stderr)
        return 1
    for path in paths:
        pattern, stages = matching_rule(path)
        print(f"{path}  <-  {pattern}  ->  {', '.join(('static', *stages)) if stages != STAGES else 'all'}")
    selected = stages_for(paths)
    print(f'{len(selected)} of {len(STAGES)} stages: {", ".join(selected)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
