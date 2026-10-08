# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Scaffold a new nasq application.

    python3 -B tools/new_app.py <app> --name-ar <ar> --name-en <en> [--root DIR] [--dry-run]

Creates the application's own folders from tools/new_app_templates, makes the three
registration edits (tools/arch_layers.json, the platform_v3 catalog tier,
packages/contracts/src/index.ts) and runs catalog_check.py --sync-release-copies.
Nothing is written when any target already exists or any check fails.
"""
import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
TEMPLATES = TOOLS / 'new_app_templates'
DEFAULT_ROOT = TOOLS.parent

APP_ID = re.compile(r'^[a-z][a-z0-9_]{1,20}$')
SAFE_NAME = re.compile(r"^[^'\"\\<>&{}\r\n]+$")
HEADER = '# Part of Odoo. See LICENSE file for full copyright and licensing details.'
# Names an application may not take: git areas, foundation and shared-service
# names, and web routes owned by the shell.
RESERVED = frozenset({
    'core', 'platform', 'api', 'web', 'cp', 'deploy', 'tools', 'docs', 'ci',
    'notify', 'directory', 'common', 'access', 'settings', 'vendor', 'subscription',
    'invite', 'account', 'admin', 'login', 'logout', 'home', 'management', 'people',
    'projects', 'tasks', 'search', 'notifications', 'me', 'new',
})
ARCH_LAYERS = 'tools/arch_layers.json'
PLATFORM_SOLUTION = 'deploy/catalog/solutions/platform_v3.json'
CONTRACTS_INDEX = 'packages/contracts/src/index.ts'
APPLICATION_RANK = 4


class ScaffoldError(Exception):
    pass


def pascal(app):
    return ''.join(part.capitalize() for part in app.split('_'))


def render(text, tokens):
    for key, value in tokens.items():
        text = text.replace('{{' + key + '}}', value)
    return text


def planned_files(root, tokens):
    """Map each output path (relative to root) to its rendered text."""
    files = {}
    for template in sorted(TEMPLATES.rglob('*.tmpl')):
        relative = template.relative_to(TEMPLATES).as_posix()
        target = render(relative.removesuffix('.tmpl').replace('__app__', tokens['app']), tokens)
        text = render(template.read_text(encoding='utf-8'), tokens)
        if target.endswith('.py') and not text.startswith(HEADER + '\n'):
            msg = f'template {relative} does not start with the Odoo header'
            raise ScaffoldError(msg)
        if target.endswith('.json'):
            json.loads(text)
        files[target] = text
    return files


def _dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False) + '\n'


def _load_exact(root, relative):
    """Load a JSON file only when re-serialising it reproduces it byte for byte."""
    path = Path(root) / relative
    if not path.is_file():
        msg = f'{relative} is missing'
        raise ScaffoldError(msg)
    text = path.read_text(encoding='utf-8')
    data = json.loads(text)
    if _dump(data) != text:
        msg = f'{relative} is not in the canonical JSON layout; refusing to rewrite it'
        raise ScaffoldError(msg)
    return data


def registration_edits(root, tokens):
    """Map each registration file to its new text (the three allowed edits)."""
    app, name_en = tokens['app'], tokens['name_en']
    addon = f'nasq_{app}'

    layers = _load_exact(root, ARCH_LAYERS)
    ranks = layers.get('ranks', {})
    if addon in ranks or app in layers.get('web_apps', {}):
        msg = f'{app} is already registered in {ARCH_LAYERS}'
        raise ScaffoldError(msg)
    rebuilt, placed = {}, False
    last_app = max((i for i, rank in enumerate(ranks.values()) if rank == APPLICATION_RANK), default=-1)
    for index, (key, rank) in enumerate(ranks.items()):
        rebuilt[key] = rank
        if index == last_app:
            rebuilt[addon] = APPLICATION_RANK
            placed = True
    if not placed:
        rebuilt[addon] = APPLICATION_RANK
    layers['ranks'] = rebuilt
    layers.setdefault('web_apps', {})[app] = {'components': [app], 'pages': [app]}

    solution = _load_exact(root, PLATFORM_SOLUTION)
    tiers = solution.get('tiers')
    if not isinstance(tiers, list) or any(tier.get('id') == app for tier in tiers):
        msg = f'{PLATFORM_SOLUTION} has no tiers list or already has a tier {app!r}'
        raise ScaffoldError(msg)
    tiers.append({
        'id': app,
        'name': name_en,
        'description': f'The {name_en} application.',
        'modules': [addon],
        'features': [f'boolean:{app}.enabled'],
    })

    index_path = Path(root) / CONTRACTS_INDEX
    if not index_path.is_file():
        msg = f'{CONTRACTS_INDEX} is missing'
        raise ScaffoldError(msg)
    index_text = index_path.read_text(encoding='utf-8')
    line = f"export * from './{app}'"
    if line in index_text.splitlines():
        msg = f'{CONTRACTS_INDEX} already exports {app}'
        raise ScaffoldError(msg)
    if index_text and not index_text.endswith('\n'):
        index_text += '\n'

    return {
        ARCH_LAYERS: _dump(layers),
        PLATFORM_SOLUTION: _dump(solution),
        CONTRACTS_INDEX: index_text + line + '\n',
    }


def validate(root, app, name_ar, name_en):
    if not APP_ID.fullmatch(app):
        msg = f'application id {app!r} must match {APP_ID.pattern}'
        raise ScaffoldError(msg)
    if app in RESERVED:
        msg = f'{app!r} is reserved (git area, foundation, shared service or shell route)'
        raise ScaffoldError(msg)
    for label, value in (('--name-ar', name_ar), ('--name-en', name_en)):
        if not value.strip() or not SAFE_NAME.fullmatch(value):
            msg = f"{label} must be non-empty and contain none of ' \" \\ < > & {{ }} or a newline"
            raise ScaffoldError(msg)
    layers = _load_exact(root, ARCH_LAYERS)
    existing = {name.removeprefix('nasq_') for name in layers.get('ranks', {})}
    existing |= set(layers.get('web_apps', {}))
    addons = Path(root) / 'odoo-addons'
    if addons.is_dir():
        existing |= {path.name.removeprefix('nasq_') for path in addons.iterdir() if path.is_dir()}
    if app in existing:
        msg = f'{app!r} is already an addon, application or area'
        raise ScaffoldError(msg)


def sync_release_copies(root):
    spec = importlib.util.spec_from_file_location('nasq_catalog_check', TOOLS / 'catalog_check.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.sync_release_copies(root)


def scaffold(root, app, name_ar, name_en, dry_run=False):
    root = Path(root).resolve()
    validate(root, app, name_ar, name_en)
    tokens = {'app': app, 'App': pascal(app), 'name_ar': name_ar.strip(), 'name_en': name_en.strip()}
    files = planned_files(root, tokens)
    edits = registration_edits(root, tokens)
    clashes = sorted(relative for relative in files if (root / relative).exists())
    if clashes:
        msg = 'refusing to overwrite existing files: ' + ', '.join(clashes)
        raise ScaffoldError(msg)
    if dry_run:
        return sorted(files), sorted(edits), []
    for relative, text in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
    for relative, text in edits.items():
        (root / relative).write_text(text, encoding='utf-8')
    return sorted(files), sorted(edits), sync_release_copies(root)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('app', help='application id, e.g. sales (addon nasq_sales)')
    parser.add_argument('--name-ar', required=True, help='Arabic display name')
    parser.add_argument('--name-en', required=True, help='English display name')
    parser.add_argument('--root', default=str(DEFAULT_ROOT), help='repository root (default: this repository)')
    parser.add_argument('--dry-run', action='store_true', help='print the planned files and edits, write nothing')
    args = parser.parse_args(argv)
    try:
        created, edited, synced = scaffold(args.root, args.app, args.name_ar, args.name_en, args.dry_run)
    except ScaffoldError as error:
        print(f'NEW_APP_REFUSED {error}', file=sys.stderr)
        return 1
    verb = 'WOULD CREATE' if args.dry_run else 'CREATED'
    for relative in created:
        print(f'{verb} {relative}')
    for relative in edited:
        print(f"{'WOULD EDIT' if args.dry_run else 'EDITED'} {relative}")
    for relative in synced:
        print(f'SYNCED {relative}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
