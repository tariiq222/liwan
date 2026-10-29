"""Which modules an application or bridge isolation run installs, and which it must not.

    python3 -B tools/app_isolation.py matrix apps|bridges [--modules a,b]   # JSON array of job groups, for the ci workflow matrix
    python3 -B tools/app_isolation.py install <module>        # the -i list of that run (a bridge: its two sides)
    python3 -B tools/app_isolation.py tags <module>           # the --test-tags of that run
    python3 -B tools/app_isolation.py foundation              # the foundation top module (webvue_api)
    python3 -B tools/app_isolation.py rank <module>           # its rank in tools/arch_layers.json
    python3 -B tools/app_isolation.py check <module> --installed a,b,c

The applications are the rank-4 addons and the bridges the rank-5 addons of ``tools/arch_layers.json``,
so a newly registered application or bridge joins the ``odoo-app-standalone`` / ``odoo-bridge`` stages
without editing the workflow. The application matrix starts with the foundation itself: its top module
(the highest of ranks 0-2, ``webvue_api``) installed with no shared service or application, running the
tests of every foundation module. An application run installs the application alone (Odoo brings its
declared foundation, shared-service and engine dependencies); a bridge run installs the bridge's two
sides and expects the bridge to auto-install. ``check`` fails when the installed set holds an
application or bridge that the run did not ask for (for the foundation run: also a shared service), or
misses the target itself.

``matrix`` packs the runs into ``GROUP_COUNT`` jobs per stage (space-separated modules, split by test
weight like ``tools/odoo_shards.py``): each job pays its runner, Postgres and Odoo setup once, and the CI
account runs a limited number of jobs at a time, so one job per module mostly waited in the queue.

On a pull request ``--modules`` narrows ``matrix`` to the applications and bridges among the affected
modules (``affected()``, from ``tools/ci_scope.py``); fewer modules give fewer groups, never an empty one.
A bridge is affected when either side is, because it depends on both.
"""
from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

import odoo_shards

REPO = Path(__file__).resolve().parents[1]
LAYERS = REPO / 'tools' / 'arch_layers.json'
ADDONS = REPO / 'odoo-addons'
FOUNDATION_RANKS = (0, 1, 2)
SERVICE_RANK = 3
APP_RANK = 4
BRIDGE_RANK = 5
GROUP_COUNT = {'apps': 3, 'bridges': 2}


class IsolationError(Exception):
    """An unknown module, a malformed bridge, or an installed set that breaks isolation."""


def ranks(layers: Path = LAYERS) -> dict[str, int]:
    return json.loads(layers.read_text(encoding='utf-8'))['ranks']


def modules_of_rank(rank: int, layers: Path = LAYERS) -> list[str]:
    return sorted(module for module, value in ranks(layers).items() if value == rank)


def foundation(layers: Path = LAYERS) -> list[str]:
    """The foundation modules, lowest rank first; the last one is the top that pulls in the others."""
    known = ranks(layers)
    return sorted((module for module, value in known.items() if value in FOUNDATION_RANKS), key=lambda m: (known[m], m))


def standalone_matrix(layers: Path = LAYERS) -> list[str]:
    return [foundation(layers)[-1], *modules_of_rank(APP_RANK, layers)]


def matrix(kind: str, layers: Path = LAYERS, addons: Path = ADDONS, only: list[str] | None = None) -> list[str]:
    """The job groups of a stage; ``only`` keeps just those modules (None keeps all)."""
    modules = standalone_matrix(layers) if kind == 'apps' else modules_of_rank(BRIDGE_RANK, layers)
    if only is not None:
        modules = [module for module in modules if module in only]
    groups = odoo_shards.split({module: odoo_shards.weight(module, addons) for module in modules}, GROUP_COUNT[kind])
    return [' '.join(group) for group in groups if group]


def depends(module: str, addons: Path = ADDONS) -> list[str]:
    manifest = addons / module / '__manifest__.py'
    if not manifest.is_file():
        raise IsolationError(f'{module} has no manifest at {manifest}')
    return list(ast.literal_eval(manifest.read_text(encoding='utf-8')).get('depends', []))


def affected(changed: set[str], modules: list[str], addons: Path = ADDONS) -> list[str]:
    """The modules among ``modules`` that are changed or depend on a changed one, directly or transitively."""
    graph = {module: set(depends(module, addons)) for module in modules}
    reached = set(changed)
    grown = True
    while grown:
        grown = False
        for module, needs in graph.items():
            if module not in reached and needs & reached:
                reached.add(module)
                grown = True
    return sorted(reached & set(modules))


def sides(bridge: str, layers: Path = LAYERS, addons: Path = ADDONS) -> list[str]:
    """The WebVue modules a bridge links; a bridge links exactly two."""
    known = ranks(layers)
    if known.get(bridge) != BRIDGE_RANK:
        raise IsolationError(f'{bridge} is not a rank-{BRIDGE_RANK} bridge in {layers.name}')
    linked = sorted(module for module in depends(bridge, addons) if module in known)
    if len(linked) != 2:
        raise IsolationError(f'{bridge} must depend on exactly two WebVue modules, found {linked}')
    return linked


def install_list(module: str, layers: Path = LAYERS, addons: Path = ADDONS) -> list[str]:
    rank = ranks(layers).get(module)
    if rank == APP_RANK or module == foundation(layers)[-1]:
        return [module]
    if rank == BRIDGE_RANK:
        return sides(module, layers, addons)
    raise IsolationError(f'{module} is neither the foundation top, a rank-{APP_RANK} application nor a rank-{BRIDGE_RANK} bridge')


def test_tags(module: str, layers: Path = LAYERS, addons: Path = ADDONS) -> str:
    """A bridge run tests the bridge, an application run the application, the foundation run all of it."""
    install_list(module, layers, addons)
    tested = foundation(layers) if module == foundation(layers)[-1] else [module]
    return ','.join('/' + name for name in tested)


def unexpected(module: str, installed: set[str], layers: Path = LAYERS, addons: Path = ADDONS) -> list[str]:
    """Applications and bridges installed beyond what the run of ``module`` asked for."""
    asked = set(install_list(module, layers, addons))
    allowed = asked | {module}
    # A bridge whose sides are all part of the run auto-installs legitimately. The foundation is part of
    # every run, so a bridge between the foundation and the application under test (webvue_access_hr for
    # webvue_hr) belongs to that application's standalone install.
    present = asked | set(foundation(layers))
    for bridge in modules_of_rank(BRIDGE_RANK, layers):
        if set(sides(bridge, layers, addons)) <= present:
            allowed.add(bridge)
    watched = set(modules_of_rank(APP_RANK, layers)) | set(modules_of_rank(BRIDGE_RANK, layers))
    if module == foundation(layers)[-1]:
        # The foundation stands without any shared service as well.
        watched |= set(modules_of_rank(SERVICE_RANK, layers))
    return sorted((installed & watched) - allowed)


def check(module: str, installed: set[str], layers: Path = LAYERS, addons: Path = ADDONS) -> None:
    missing = sorted(({module} | set(install_list(module, layers, addons))) - installed)
    if missing:
        raise IsolationError(f'{module} run did not install {", ".join(missing)}')
    extra = unexpected(module, installed, layers, addons)
    if extra:
        raise IsolationError(f'{module} run also installed {", ".join(extra)}: it is not isolated')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    matrix_parser = sub.add_parser('matrix')
    matrix_parser.add_argument('kind', choices=('apps', 'bridges'))
    matrix_parser.add_argument('--modules', help='comma-separated affected modules; only these are packed')
    sub.add_parser('install').add_argument('module')
    sub.add_parser('tags').add_argument('module')
    sub.add_parser('foundation')
    sub.add_parser('rank').add_argument('module')
    checking = sub.add_parser('check')
    checking.add_argument('module')
    checking.add_argument('--installed', required=True, help='comma-separated installed module names')
    args = parser.parse_args(argv)
    try:
        if args.command == 'matrix':
            print(json.dumps(matrix(args.kind, only=None if args.modules is None else odoo_shards.parse_modules(args.modules))))
        elif args.command == 'install':
            print(','.join(install_list(args.module)))
        elif args.command == 'tags':
            print(test_tags(args.module))
        elif args.command == 'foundation':
            print(foundation()[-1])
        elif args.command == 'rank':
            if args.module not in ranks():
                raise IsolationError(f'{args.module} has no rank in {LAYERS.name}')
            print(ranks()[args.module])
        else:
            check(args.module, set(filter(None, args.installed.split(','))))
            print(f'{args.module}: isolated')
    except (IsolationError, odoo_shards.ShardError) as error:
        print(f'app_isolation: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
