"""Choose the CI stages a change can affect; a path without a rule runs all twelve.

    python3 -B tools/ci_scope.py --base <ref> [--commit <ref>] [--stages]
    python3 -B tools/ci_scope.py --full [--stages]

Prints the stages selected for the files changed between the two refs and the rule behind each
changed path. With ``--stages`` it prints only the selected stage names as a JSON array, which
the ``scope`` job of ``.github/workflows/ci.yml`` feeds to the stage jobs. ``--full`` selects every
stage without reading a diff. This module is the only place the path-to-stage map lives.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from fnmatch import fnmatchcase
from pathlib import Path

STAGES = ('static', 'ai-service', 'control-plane', 'vendor-admin', 'odoo',
          'odoo-app-standalone', 'odoo-bridge', 'upgrade',
          'restore-drill', 'image', 'e2e-mock', 'rtl-stories')
# Tools no non-static step runs and no application code executes (checked with rg across
# `.github/`, deploy/, apps/, packages/ and odoo-addons/). Everything else under tools/,
# including tools/webvue_cli/ and tools/shared_saas_lifecycle/ (run by the control-plane tests),
# is unmapped on purpose, so a new tool runs all twelve stages until it is listed here.
STATIC_ONLY_TOOLS = (
    'tools/test_*', 'tools/api_surface.py', 'tools/arch_baseline.json', 'tools/arch_documented_sudo.json',
    'tools/arch_policy.py', 'tools/check_fast.py', 'tools/contracts_jsonschema.mjs',
    'tools/docs_policy.py', 'tools/e2e_isolated.mjs', 'tools/git_policy.py', 'tools/hooks.py',
    'tools/jev_review.mjs', 'tools/migration_guard.py', 'tools/new_app.py',
    'tools/new_app_templates/*', 'tools/no_external_refs.py', 'tools/odoo_test.py',
    'tools/secret_guard.py', 'tools/semgrep_gate.py', 'tools/ts_loader.mjs',
    'tools/ui_catalog.mjs', 'tools/ui_inventory.py', 'tools/ui_layer_baseline.mjs',
    'tools/ui_policy.py', 'tools/ui_templates.mjs', 'tools/worktree_claims.py', 'tools/wt.py',
)
ISOLATION_STAGES = ('odoo-app-standalone', 'odoo-bridge')
SHARED_PACKAGE_STAGES = ('control-plane', 'vendor-admin', 'e2e-mock', 'rtl-stories')
UNMAPPED = '(no rule: all stages)'

# First match wins, so the paths that need every stage come first. `*` also crosses `/`, hence
# `dir/*` covers a whole tree. `static` is added to every selection and is not repeated here.
RULES = (
    # CI machinery: the workflow, its composite action, and the repository-wide inputs of every stage.
    ('.github/*', STAGES),
    ('tools/ci_scope.py', STAGES),
    ('tools/odoo_shards.py', ('odoo',)),     # splits the odoo stage into its matrix shards
    ('tools/app_isolation.py', ISOLATION_STAGES),  # their matrices and isolation check
    ('tools/arch_layers.json', ISOLATION_STAGES),  # its ranks name the applications and bridges of those matrices
    ('tools/catalog_check.py', STAGES),      # odoo, upgrade, restore-drill and image read --release-modules
    ('tools/upgrade_baseline.py', STAGES),   # the upgrade step
    ('tools/upgrade_log_guard.py', STAGES),  # the upgrade step
    ('deploy/*', STAGES),                    # deploy/ci/*.sh, ci-test.sh, classification.py, the image Dockerfile
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


def changed_paths(repo: Path, base: str, commit: str, env: dict | None = None) -> list[str]:
    """Files changed from base to commit; a rename counts as a delete plus an add."""
    try:
        listing = subprocess.check_output(
            ['git', '-C', str(repo), 'diff', '--name-only', '--no-renames', '-z', base, commit],
            env=env, text=True, stderr=subprocess.PIPE)
    except (OSError, subprocess.CalledProcessError) as error:
        raise ScopeError(f'cannot list the files changed from {base} to {commit}: {error}') from error
    return sorted(filter(None, listing.split('\0')))


def merge_base(repo: Path, base: str, commit: str) -> str:
    try:
        return subprocess.check_output(['git', '-C', str(repo), 'merge-base', base, commit],
                                       text=True, stderr=subprocess.PIPE).strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise ScopeError(f'cannot find the merge base of {base} and {commit}: {error}') from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--base')
    parser.add_argument('--commit', default='HEAD')
    parser.add_argument('--full', action='store_true', help='select every stage without reading a diff')
    parser.add_argument('--stages', action='store_true', help='print only the selected stage names as a JSON array')
    args = parser.parse_args(argv)
    if not args.full and not args.base:
        parser.error('--base is required unless --full is given')
    paths = []
    if not args.full:
        try:
            # The merge brings in what commit changed since it left base, so preview from their merge base.
            paths = changed_paths(Path.cwd(), merge_base(Path.cwd(), args.base, args.commit), args.commit)
        except ScopeError as error:
            print(f'ci_scope: {error}', file=sys.stderr)
            return 1
    selected = STAGES if args.full else stages_for(paths)
    if args.stages:
        print(json.dumps(selected))
        return 0
    for path in paths:
        pattern, stages = matching_rule(path)
        print(f"{path}  <-  {pattern}  ->  {', '.join(('static', *stages)) if stages != STAGES else 'all'}")
    print(f'{len(selected)} of {len(STAGES)} stages: {", ".join(selected)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
