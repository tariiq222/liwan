"""Choose the CI stages a change can affect; a path without a rule runs all thirteen.

    python3 -B tools/ci_scope.py --base <ref> [--commit <ref>] [--pull-request] [--stages | --modules]
    python3 -B tools/ci_scope.py --full [--stages]

Prints the stages selected for the files changed between the two refs and the rule behind each
changed path. With ``--stages`` it prints only the selected stage names as a JSON array, which
the ``scope`` job of ``.github/workflows/ci.yml`` feeds to the stage jobs. ``--full`` selects every
stage without reading a diff. This module is the only place the path-to-stage map lives.

``--pull-request`` narrows the selection for a pull request: the ``DEFERRED_STAGES`` are left to the
push to ``main``, the nightly run and a full dispatch, except that ``image`` still runs when the change
touches a file that decides how an image builds (``feeds_image_build``), ``upgrade`` still runs when it
adds or edits a file under an addon ``migrations/`` directory (``feeds_upgrade``), and the Odoo stages reach only the release modules
the change affects (the changed addons plus every addon depending on them, ``None`` meaning all of them
when a changed path outside ``odoo-addons/`` feeds an Odoo stage). ``--modules`` prints that affected list
as comma-separated names (empty means every release module).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from fnmatch import fnmatchcase
from pathlib import Path

import app_isolation
import odoo_shards

STAGES = ('static', 'ai-service', 'control-plane', 'vendor-admin', 'odoo',
          'odoo-app-standalone', 'odoo-bridge', 'upgrade',
          'restore-drill', 'image', 'e2e-mock', 'e2e-odoo', 'rtl-stories')
# Tools no non-static step runs and no application code executes (checked with rg across
# `.github/`, deploy/, apps/, packages/ and odoo-addons/). Everything else under tools/,
# including tools/liwan_cli/ and tools/shared_saas_lifecycle/ (run by the control-plane tests),
# is unmapped on purpose, so a new tool runs all thirteen stages until it is listed here.
STATIC_ONLY_TOOLS = (
    'tools/test_*', 'tools/api_surface.py', 'tools/arch_baseline.json', 'tools/arch_documented_sudo.json',
    'tools/arch_policy.py', 'tools/check_fast.py', 'tools/ci_not_run.json', 'tools/contracts_jsonschema.mjs',
    'tools/docs_policy.py', 'tools/e2e_isolated.mjs', 'tools/e2e_scenario_coverage.py', 'tools/git_policy.py', 'tools/hooks.py',
    'tools/jev_review.mjs', 'tools/migration_guard.py', 'tools/new_app.py',
    'tools/new_app_templates/*', 'tools/no_external_refs.py', 'tools/odoo_test.py',
    'tools/secret_guard.py', 'tools/semgrep_gate.py', 'tools/semgrep_rules.lock.json', 'tools/sudo_gate.py', 'tools/ts_loader.mjs',
    'tools/ui_catalog.mjs', 'tools/ui_inventory.py', 'tools/ui_layer_baseline.mjs',
    'tools/ui_policy.py', 'tools/ui_templates.mjs', 'tools/worktree_claims.py', 'tools/wt.py',
)
ISOLATION_STAGES = ('odoo-app-standalone', 'odoo-bridge')
ODOO_STAGES = ('odoo', *ISOLATION_STAGES)
# Slow, and about the merged result rather than one change: a pull request leaves them to the push to main.
DEFERRED_STAGES = ('upgrade', 'restore-drill', 'image')
# A pull request still builds and scans the images when it changes what decides how they build: a Dockerfile, a
# Compose file, `.dockerignore`, the image stage script, or a package lock the Dockerfiles install from.
IMAGE_BUILD_INPUTS = ('deploy/ci/image.sh', 'deploy/odoo/requirements-python312-linux.txt',
                      'apps/ai-service/requirements.txt', 'apps/ai-service/requirements-build.txt')
# `upgrade` installs the previous release and upgrades it with `-u` over every release module, so it is the only stage
# that executes a migration script. A manifest version bump must ship `migrations/<version>/` (tools/migration_guard.py),
# so the migrations path also covers a bump. The control-plane `schema_*.sql` files are not part of it; the `control-plane`
# stage runs on every change under `apps/control-plane/` and applies them to a fresh scratch database.
UPGRADE_INPUTS = ('odoo-addons/*/migrations/*',)
# The web and vendor-admin images build from these packages, so `image` is selected with them.
SHARED_PACKAGE_STAGES = ('control-plane', 'vendor-admin', 'image', 'e2e-mock', 'e2e-odoo', 'rtl-stories')
UNMAPPED = '(no rule: all stages)'

# First match wins, so the paths that need every stage come first. `*` also crosses `/`, hence
# `dir/*` covers a whole tree. `static` is added to every selection and is not repeated here.
RULES = (
    # CI machinery: the workflow, its composite action, and the repository-wide inputs of every stage.
    ('.github/*', STAGES),
    ('tools/ci_scope.py', STAGES),
    ('tools/e2e_seed.py', ('e2e-odoo',)),
    ('tools/odoo_shards.py', ('odoo',)),     # splits the odoo stage into its matrix shards
    ('tools/app_isolation.py', ISOLATION_STAGES),  # their matrices and isolation check
    ('tools/arch_layers.json', ISOLATION_STAGES),  # its ranks name the applications and bridges of those matrices
    ('tools/catalog_check.py', STAGES),      # odoo, upgrade, restore-drill and image read --release-modules
    ('tools/upgrade_baseline.py', STAGES),   # the upgrade step
    ('tools/upgrade_log_guard.py', STAGES),  # the upgrade step
    ('deploy/ci/static.sh', ()),             # only the static job runs it (and the light profile below)
    ('deploy/ci/lib/docs-static.sh', ()),
    ('deploy/alerts.py', ()),                # the alert sender: read by deploy/test_alerts.py and OPERATIONS.md, no image, stage or app
    ('deploy/test_*.py', ()),                # top-level deploy tests, run only by `unittest deploy/test_*.py` in the static job
    ('deploy/*', STAGES),                    # deploy/ci/*.sh, ci-test.sh, classification.py, the image Dockerfile
    ('odoo-addons/*', STAGES),               # the Odoo steps, the image and the static ruff run
    ('packages/contracts/*', STAGES),
    ('package.json', STAGES),
    ('package-lock.json', STAGES),
    ('.npmrc', STAGES),
    ('.nvmrc', STAGES),
    ('.dockerignore', STAGES),               # shapes the image build context
    ('apps/web/*.md', ('e2e-odoo',)),      # every web change selects real-Odoo acceptance
    # Only the static stage reads these.
    ('*.md', ()),
    ('docs/*', ()),
    *((path, ()) for path in STATIC_ONLY_TOOLS),
    ('e2e/*', ()),
    ('e2e.config.ts', ()),
    ('.gitignore', ()),                      # no step reads it; tools/test_gitignore.py is static
    ('.claude/*', ()),                       # agent setup for local and cloud sessions; no CI step reads it
    ('ruff.toml', ('ai-service',)),          # the ai-service step lints with the nearest ruff config
    # The Nitro server is built into the image and the mock build, and the control-plane tests import it; the
    # Storybook build behind rtl-stories imports no `server/` file.
    ('apps/web/server/*', ('control-plane', 'image', 'e2e-mock', 'e2e-odoo')),
    ('apps/web/*', ('control-plane', 'image', 'e2e-mock', 'e2e-odoo', 'rtl-stories')),  # control-plane tests import apps/web server code
    # Other applications and the shared packages they build from.
    ('apps/vendor-admin/*', ('vendor-admin', 'image')),
    ('apps/control-plane/*', ('control-plane',)),
    ('apps/ai-service/*', ('ai-service', 'image')),
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


def affected_modules(paths: list[str], release: list[str], addons: Path = app_isolation.ADDONS) -> list[str] | None:
    """The release modules the change can affect; None when it can affect all of them.

    A path feeding an Odoo stage from outside `odoo-addons/<addon>/` (CI machinery, deploy scripts,
    contracts, an unmapped file) may affect every module.
    """
    changed = set()
    for path in paths:
        if not set(matching_rule(path)[1]) & set(ODOO_STAGES):
            continue
        parts = path.split('/')
        if parts[0] != 'odoo-addons' or len(parts) < 3:
            return None
        changed.add(parts[1])
    return app_isolation.affected(changed, release, addons)


def feeds_image_build(path: str) -> bool:
    """True for a file whose change can break an image build, whatever folder it sits in."""
    name = path.rsplit('/', 1)[-1]
    return (name == 'Dockerfile' or name.startswith('Dockerfile.') or name == '.dockerignore'
            or (name.startswith(('docker-compose', 'compose')) and name.endswith(('.yml', '.yaml')))
            or any(fnmatchcase(path, pattern) for pattern in IMAGE_BUILD_INPUTS))


def feeds_upgrade(path: str) -> bool:
    """True for a file the `upgrade` stage runs: anything under an addon's `migrations/` directory."""
    return any(fnmatchcase(path, pattern) for pattern in UPGRADE_INPUTS)


def pull_request_stages(paths: list[str], affected: list[str] | None) -> tuple[str, ...]:
    """Keep nondeferred stages and run the Odoo test stages only when they have work.

    Addon files feed the Odoo stages and the real-Odoo browser suite before merge.
    The other stages selected by the broad addon rule run on main.
    """
    addon_files = [path for path in paths if path.startswith('odoo-addons/') and path.count('/') >= 2]
    selected = set(stages_for([path for path in paths if path not in addon_files]))
    if addon_files:
        selected.update((*ODOO_STAGES, 'e2e-odoo'))
    selected.difference_update(DEFERRED_STAGES)
    if any(feeds_image_build(path) for path in paths):
        selected.add('image')
    if any(feeds_upgrade(path) for path in paths):
        selected.add('upgrade')
    if affected is not None:
        runs = {'odoo': affected,
                'odoo-app-standalone': app_isolation.matrix('apps', only=affected),
                'odoo-bridge': app_isolation.matrix('bridges', only=affected)}
        selected -= {stage for stage, work in runs.items() if not work}
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
    parser.add_argument('--pull-request', action='store_true',
                        help='select for a pull request: defer the slow stages, narrow the Odoo stages to the affected modules')
    output = parser.add_mutually_exclusive_group()
    output.add_argument('--stages', action='store_true', help='print only the selected stage names as a JSON array')
    output.add_argument('--modules', action='store_true',
                        help='print the affected release modules, comma-separated (empty: all); needs --pull-request')
    args = parser.parse_args(argv)
    if not args.full and not args.base:
        parser.error('--base is required unless --full is given')
    if args.full and args.pull_request:
        parser.error('--full and --pull-request exclude each other')
    if args.modules and not args.pull_request:
        parser.error('--modules needs --pull-request')
    paths = []
    if not args.full:
        try:
            # The merge brings in what commit changed since it left base, so preview from their merge base.
            paths = changed_paths(Path.cwd(), merge_base(Path.cwd(), args.base, args.commit), args.commit)
        except ScopeError as error:
            print(f'ci_scope: {error}', file=sys.stderr)
            return 1
    affected = None
    selected = STAGES if args.full else stages_for(paths)
    if args.pull_request:
        try:
            affected = affected_modules(paths, odoo_shards.tested_modules())
            selected = pull_request_stages(paths, affected)
        except (odoo_shards.ShardError, app_isolation.IsolationError) as error:
            print(f'ci_scope: {error}', file=sys.stderr)
            return 1
    if args.modules:
        print(','.join(affected or ()))
        return 0
    if args.stages:
        print(json.dumps(selected))
        return 0
    for path in paths:
        pattern, stages = matching_rule(path)
        print(f"{path}  <-  {pattern}  ->  {', '.join(('static', *stages)) if stages != STAGES else 'all'}")
    if args.pull_request:
        print(f"affected modules: {'all' if affected is None else ', '.join(affected) or 'none'}")
    print(f'{len(selected)} of {len(STAGES)} stages: {", ".join(selected)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
