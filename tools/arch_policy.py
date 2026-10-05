# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Architecture rules R1-R10 with a shrinking baseline.

Spec: docs/superpowers/specs/2026-10-05-nasq-reference-architecture-and-git-workflow-design.md
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYERS_FILE = Path(__file__).resolve().parent / 'arch_layers.json'
BASELINE_FILE = Path(__file__).resolve().parent / 'arch_baseline.json'

# Rank bands: 0-2 foundation (core, platform, api), 3 shared service, 4 app, 5 bridge, 6 customer overlay.
BRIDGE_RANK = 5
APP_RANK = 4
FOUNDATION_MAX_RANK = 2

APP_TOKEN = re.compile(r'\b(?:project|hr|pmo|meetings|chat|cyan_meeting_minutes)\.[a-z_]')
ADDON_IMPORT = re.compile(r'odoo\.addons\.((?:nasq|customer)_\w+)')
CONTROL_PLANE_IMPORT = re.compile(r"""(?:from|import|require\()\s*\(?['"][^'"\n]*control-plane""")
COMMERCIAL_IMPORT = re.compile(r"""(?:from|import)\s*\(?['"]@nasq/commercial-contracts""")
CUSTOMER_KIND = re.compile(r'\b(?:government|is_gov|gov_)', re.IGNORECASE)
SQL_TABLE = re.compile(r'\b(?:FROM|JOIN|UPDATE|INSERT INTO|DELETE FROM)\s+([a-z][a-z0-9_]*)')
ODOO_INHERIT = re.compile(r'''_inherit\s*=\s*['"](?!nasq\.)''')
ACCESS_OVERRIDE = re.compile(r'^\s+def (?:_search|check_access|_check_access)\(', re.MULTILINE)
ENABLED_FEATURE = re.compile(r'''['"]key['"]\s*:\s*['"][a-z_]+\.enabled['"]''')

Violations = dict[str, dict[str, int]]


def is_test_path(path: Path) -> bool:
    parts = set(path.parts)
    return bool(parts & {'tests', '__tests__', 'e2e'}) or '.test.' in path.name or '.spec.' in path.name


def count(pattern: re.Pattern[str], text: str) -> int:
    return len(pattern.findall(text))


def manifest_depends(text: str) -> list[str]:
    return list(ast.literal_eval(text).get('depends', []))


def unregistered_addons(addons: list[str], ranks: dict[str, int], exempt: list[str]) -> list[str]:
    return sorted(a for a in addons if a not in ranks and a not in exempt)


def core_depends_violations(depends: list[str]) -> dict[str, int]:
    """R1: nasq_core depends on base only."""
    return {f'nasq_core depends on {dep}': 1 for dep in depends if dep != 'base'}


def layer_violations(addon: str, targets: list[str], ranks: dict[str, int], kind: str) -> dict[str, int]:
    """R3/R4: a layered addon may only reach a strictly lower rank."""
    found: dict[str, int] = {}
    for target in targets:
        if target == addon or target not in ranks:
            continue
        if ranks[target] >= ranks[addon]:
            key = f'{addon} {kind} {target}'
            found[key] = found.get(key, 0) + 1
    return found


def _decorator_name(node: ast.expr) -> str:
    target = node.func if isinstance(node, ast.Call) else node
    return target.attr if isinstance(target, ast.Attribute) else getattr(target, 'id', '')


def sudo_calls(text: str) -> int:
    """R7: real .sudo() calls; comments and strings are not counted."""
    return sum(
        1 for node in ast.walk(ast.parse(text))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'sudo'
    )


def routes_without_feature(text: str) -> list[str]:
    """R10: controller functions with a route decorator and no requires_feature."""
    missing = []
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.FunctionDef):
            names = [_decorator_name(d) for d in node.decorator_list]
            if 'route' in names and 'requires_feature' not in names:
                missing.append(node.name)
    return missing


def sql_on_odoo_tables(text: str) -> int:
    """R9: SQL keywords followed by a table that is not a nasq_ table."""
    return sum(1 for table in SQL_TABLE.findall(text) if not table.startswith('nasq_'))


def odoo_access_overrides(text: str) -> int:
    """R9: _search/check_access overrides in a file that extends an Odoo model."""
    return count(ACCESS_OVERRIDE, text) if ODOO_INHERIT.search(text) else 0


def pascal(name: str) -> str:
    return ''.join(part.capitalize() for part in name.split('-'))


def foreign_component_uses(text: str, own_app: str, web_apps: dict) -> int:
    """R3 (web): tags or imports of another app's components."""
    total = 0
    for app, dirs in web_apps.items():
        if app == own_app:
            continue
        for directory in dirs['components']:
            total += len(re.findall(rf'<{pascal(directory)}[A-Z]', text))
            total += len(re.findall(rf'components/{re.escape(directory)}/', text))
    return total


def increases(current: Violations, baseline: Violations) -> list[str]:
    problems = []
    for rule in sorted(current):
        base = baseline.get(rule, {})
        for key, have in sorted(current[rule].items()):
            if have > base.get(key, 0):
                problems.append(f'{rule}: {key}: {have} found, baseline allows {base.get(key, 0)}')
    return problems


def stale(current: Violations, baseline: Violations) -> list[str]:
    problems = []
    for rule in sorted(baseline):
        now = current.get(rule, {})
        for key, allowed in sorted(baseline[rule].items()):
            if now.get(key, 0) < allowed:
                problems.append(
                    f'{rule}: {key}: {now.get(key, 0)} found, baseline says {allowed}; '
                    'lower the baseline with --write-baseline',
                )
    return problems


def compare(current: Violations, baseline: Violations) -> list[str]:
    return increases(current, baseline) + stale(current, baseline)


def _read(path: Path) -> str:
    return path.read_text(encoding='utf-8', errors='replace')


def _rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _put(found: dict[str, int], key: str, value: int) -> None:
    if value:
        found[key] = value


def _addon_files(addon_dir: Path, suffixes: tuple[str, ...]) -> list[Path]:
    return sorted(
        p for p in addon_dir.rglob('*')
        if p.is_file() and p.suffix in suffixes and not is_test_path(p)
        and '__pycache__' not in p.parts and 'i18n' not in p.parts
    )


def collect(root: Path, layers: dict) -> tuple[Violations, list[str]]:
    ranks, exempt, web_apps = layers['ranks'], layers['exempt'], layers['web_apps']
    commercial = layers['commercial']
    addons_root = root / 'odoo-addons'
    addons = sorted(p.parent.name for p in addons_root.glob('*/__manifest__.py'))
    hard = [f'unregistered addon {a}: add it to tools/arch_layers.json' for a in unregistered_addons(addons, ranks, exempt)]
    hard += [f'arch_layers.json lists missing addon {a}' for a in sorted(ranks) if a not in addons]
    v: Violations = {rule: {} for rule in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10')}

    for addon in addons:
        if addon not in ranks:
            continue
        addon_dir = addons_root / addon
        manifest = ast.literal_eval(_read(addon_dir / '__manifest__.py'))
        depends = list(manifest.get('depends', []))
        if addon == 'nasq_core':
            v['R1'].update(core_depends_violations(depends))
        v['R4'].update(layer_violations(addon, depends, ranks, 'depends on'))
        if ranks[addon] == BRIDGE_RANK and not manifest.get('auto_install'):
            hard.append(f'bridge addon {addon} must set auto_install')
        if ranks[addon] == APP_RANK:
            registry = addon_dir / 'models' / 'feature_registry.py'
            text = _read(registry) if registry.is_file() else ''
            if not (ENABLED_FEATURE.search(text) and f"'owner': '{addon}'" in text):
                v['R10'][f'{addon} registers no <app>.enabled feature it owns'] = 1
        for path in _addon_files(addon_dir, ('.py', '.xml', '.csv')):
            text, rel = _read(path), _rel(path, root)
            if ranks[addon] <= FOUNDATION_MAX_RANK and path.name != '__manifest__.py':
                _put(v['R2'], rel, count(APP_TOKEN, text))
            if path.suffix != '.py':
                continue
            for key, n in layer_violations(addon, ADDON_IMPORT.findall(text), ranks, 'imports').items():
                v['R3'][key] = v['R3'].get(key, 0) + n
            _put(v['R6'], rel, count(CUSTOMER_KIND, text))
            _put(v['R7'], rel, sudo_calls(text))
            if ranks[addon] == APP_RANK and 'controllers' in path.parts:
                for name in routes_without_feature(text):
                    v['R10'][f'{rel}:{name} has no requires_feature'] = 1
            if 'migrations' not in path.parts:
                _put(v['R9'], f'sql {rel}', sql_on_odoo_tables(text))
                _put(v['R9'], f'override {rel}', odoo_access_overrides(text))

    web = root / 'apps' / 'web'
    for base in (web / 'app', web / 'server'):
        for path in sorted(base.rglob('*')):
            if not path.is_file() or path.suffix not in ('.ts', '.vue') or is_test_path(path):
                continue
            text, rel = _read(path), _rel(path, root)
            _put(v['R5'], f'control-plane import {rel}', count(CONTROL_PLANE_IMPORT, text))
            if not rel.startswith(tuple(commercial['allowed'])):
                _put(v['R5'], f'commercial import {rel}', count(COMMERCIAL_IMPORT, text))
            _put(v['R6'], rel, count(CUSTOMER_KIND, text))
    for directory, middleware in commercial['pages'].items():
        folder = web / 'app' / 'pages' / directory
        for path in sorted(folder.rglob('*.vue')) if folder.is_dir() else []:
            if not is_test_path(path) and middleware not in _read(path):
                v['R8'][f'{_rel(path, root)} lacks {middleware} middleware'] = 1
    for app, dirs in web_apps.items():
        folders = [web / 'app' / 'components' / d for d in dirs['components']]
        folders += [web / 'app' / 'pages' / d for d in dirs['pages']]
        for folder in folders:
            if not folder.is_dir():
                continue
            for path in sorted(folder.rglob('*')):
                if path.is_file() and path.suffix in ('.ts', '.vue') and not is_test_path(path):
                    _put(v['R3'], f'web {_rel(path, root)}', foreign_component_uses(_read(path), app, web_apps))
    return v, hard


def main(
    argv: list[str] | None = None,
    root: Path = ROOT,
    layers_file: Path = LAYERS_FILE,
    baseline_file: Path = BASELINE_FILE,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-baseline', action='store_true', help='record the current violations; refuses any increase')
    args = parser.parse_args(argv)
    current, hard = collect(root, json.loads(_read(layers_file)))
    exists = baseline_file.is_file()
    baseline = json.loads(_read(baseline_file)) if exists else {}
    if args.write_baseline:
        # The first write records today's debt; every later write may only shrink it.
        problems = hard + (increases(current, baseline) if exists else [])
        if not problems:
            baseline_file.write_text(
                json.dumps(current, indent=2, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8',
            )
            print(f'wrote {baseline_file.name}')
    else:
        problems = hard + compare(current, baseline)
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
