# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Scaffold a new nasq application.

    python3 -B tools/new_app.py <app> --name-ar <ar> --name-en <en> [--route SLUG] [--root DIR] [--dry-run]

Creates the application's own folders from tools/new_app_templates, makes the three
registration edits (tools/arch_layers.json, the platform_v3 catalog tier,
packages/contracts/src/index.ts) and runs catalog_check.py --sync-release-copies.
Nothing is written when any target already exists or any check fails.
"""
import argparse
import importlib.util
import json
import re
import shutil
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
TEMPLATES = TOOLS / 'new_app_templates'
DEFAULT_ROOT = TOOLS.parent

APP_ID = re.compile(r'^[a-z][a-z0-9]*(_[a-z0-9]+)*$')
MAX_APP_ID = 21
FORBIDDEN_PREFIXES = ('nasq_', 'customer')
# Names end up inside Python, XML, JSON and vue-i18n messages: no quotes, escapes, markup,
# interpolation (`{}`, `$`) or message syntax (`|`, `@`, `%`).
SAFE_NAME = re.compile(r"^[^'\"\\<>&{}|@%$\r\n]+$")
HEADER = '# Part of Odoo. See LICENSE file for full copyright and licensing details.'
# Single-key shortcuts that components handle themselves (GlobalSearch Ctrl/Cmd+K, list
# navigation j/k, zero for reset, and +/- are outside the shortcut charset), so a nav item
# must not take them.
HARD_WIRED_SHORTCUTS = frozenset({'j', 'k', '0'})
# Application ids an application may never take: git areas, foundation and shared-service
# names and contracts namespaces. The pages and contracts folders add every name already taken.
RESERVED_IDS = frozenset({
    'core', 'platform', 'api', 'web', 'cp', 'deploy', 'tools', 'docs', 'ci',
    'notify', 'directory', 'common', 'access',
})
# Web routes owned by the shell. An id in this set is accepted only together with a different --route.
SHELL_ROUTES = frozenset({
    'settings', 'vendor', 'subscription', 'invite', 'account', 'admin', 'login', 'logout', 'home',
    'management', 'people', 'projects', 'tasks', 'search', 'notifications', 'me', 'new', 'index',
})
ROUTE_SLUG = re.compile(r'^[a-z][a-z0-9]*(-[a-z0-9]+)*$')
ARCH_LAYERS = 'tools/arch_layers.json'
PLATFORM_SOLUTION = 'deploy/catalog/solutions/platform_v3.json'
CONTRACTS_INDEX = 'packages/contracts/src/index.ts'
APPLICATION_RANK = 4


CATALOG_WARNING = (
    f'WARNING {PLATFORM_SOLUTION} was edited in place, which changes its sha256. This is allowed only while '
    'that catalog is unpublished; after the first publish a new application needs a new platform_vN.json, '
    'decided before the first server deploy.'
)


class ScaffoldError(Exception):
    pass


def pascal(app):
    return ''.join(part.capitalize() for part in app.split('_'))


def camel(slug):
    head, *rest = slug.split('-')
    return head + ''.join(part.capitalize() for part in rest)


def render(text, tokens):
    for key, value in tokens.items():
        text = text.replace('{{' + key + '}}', value)
    return text


def web_slots(root):
    """The next free rail order (highest + 10) and the first unused single-character nav shortcut."""
    web = Path(root) / 'apps/web/app'
    manifests = sorted((web / 'modules').glob('*/manifest.ts'))
    manifest_text = '\n'.join(path.read_text(encoding='utf-8') for path in manifests)
    shell = web / 'composables/nav/shellModules.ts'
    text = manifest_text + '\n' + (shell.read_text(encoding='utf-8') if shell.is_file() else '')
    orders = [int(match) for match in re.findall(r'\border\s*:\s*(\d+)', manifest_text)]
    if not manifests or not orders:
        msg = 'no rail order found in apps/web/app/modules/*/manifest.ts; cannot place the new rail entry'
        raise ScaffoldError(msg)
    found = re.findall(r"""\bshortcut\s*:\s*(['"`])([^'"`]*)\1""", text)
    if not found:
        msg = 'no nav shortcut found in the manifests; cannot choose a free one'
        raise ScaffoldError(msg)
    used = {value for _, value in found} | HARD_WIRED_SHORTCUTS
    free = [char for char in 'abcdefghijklmnopqrstuvwxyz0123456789' if char not in used]
    if not free:
        msg = 'no free single-character nav shortcut is left'
        raise ScaffoldError(msg)
    return max(orders) + 10, free[0]


def planned_files(root, tokens):
    """Map each output path (relative to root) to its rendered text."""
    files = {}
    for template in sorted(TEMPLATES.rglob('*.tmpl')):
        relative = template.relative_to(TEMPLATES).as_posix()
        target = relative.removesuffix('.tmpl').replace('__app__', tokens['app']).replace('__route__', tokens['route'])
        target = target.replace('__locale__', tokens['locale'])
        target = render(target, tokens)
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
    route = tokens['route']
    layers.setdefault('web_apps', {})[app] = {'components': [route], 'pages': [route]}

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


def _stems(folder):
    """Route and namespace stems used in a folder (``-`` and ``_`` are alike)."""
    if not folder.is_dir():
        return set()
    return {path.name.removesuffix('.vue').removesuffix('.ts').replace('-', '_') for path in folder.iterdir()}


def taken_pages(root):
    return _stems(Path(root) / 'apps/web/app/pages')


def taken_contracts(root):
    return _stems(Path(root) / 'packages/contracts/src')


def validate(root, app, name_ar, name_en, route=None):
    if not APP_ID.fullmatch(app) or not 2 <= len(app) <= MAX_APP_ID:
        msg = f'application id {app!r} must match {APP_ID.pattern} and be at most {MAX_APP_ID} characters'
        raise ScaffoldError(msg)
    if app.startswith(FORBIDDEN_PREFIXES):
        msg = f'application id {app!r} may not start with {" or ".join(FORBIDDEN_PREFIXES)}'
        raise ScaffoldError(msg)
    if app in RESERVED_IDS or app in taken_contracts(root):
        msg = f'{app!r} is reserved (git area, foundation, shared service or contracts namespace)'
        raise ScaffoldError(msg)
    if route is None:
        if app in SHELL_ROUTES or app in taken_pages(root):
            msg = f'{app!r} is a page route already taken; pass --route <slug> to give the application another route'
            raise ScaffoldError(msg)
    else:
        if not ROUTE_SLUG.fullmatch(route):
            msg = f'route {route!r} must match {ROUTE_SLUG.pattern}'
            raise ScaffoldError(msg)
        if route in SHELL_ROUTES or route in RESERVED_IDS or route.replace('-', '_') in taken_pages(root) | _stems(Path(root) / 'apps/web/app/components'):
            msg = f'route {route!r} is reserved or already used by a page or component folder'
            raise ScaffoldError(msg)
    for label, value in (('--name-ar', name_ar), ('--name-en', name_en)):
        if not value.strip() or not SAFE_NAME.fullmatch(value):
            msg = f"{label} must be non-empty and contain none of ' \" \\ < > & {{ }} | @ % $ or a newline"
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
    hits = _arch_policy_module().new_app_r2_hits(Path(root), layers, app)
    if hits:
        shown = ', '.join(f'{path} ({n})' for path, n in list(hits.items())[:3])
        msg = (f'{app!r} collides with a name foundation or shared-service code already uses '
               f'(R2 would fail in {len(hits)} file(s): {shown}); choose another id')
        raise ScaffoldError(msg)


def _arch_policy_module():
    spec = importlib.util.spec_from_file_location('nasq_arch_policy', TOOLS / 'arch_policy.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _catalog_module():
    spec = importlib.util.spec_from_file_location('nasq_catalog_check', TOOLS / 'catalog_check.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _write_all(root, files, edits, catalog, created):
    """Write new files and edits, then sync and re-check the catalog. Raises on any problem."""
    for relative, text in files.items():
        path = root / relative
        missing = [parent for parent in reversed(path.parents) if not parent.exists() and root in parent.parents]
        created.extend(missing)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        created.append(path)
    for relative, text in edits.items():
        (root / relative).write_text(text, encoding='utf-8')
    synced = catalog.sync_release_copies(root)
    errors = catalog.check_catalog(root)
    if errors:
        msg = 'catalog check failed after scaffolding: ' + '; '.join(errors[:5])
        raise ScaffoldError(msg)
    return synced


def scaffold(root, app, name_ar, name_en, dry_run=False, route=None):
    root = Path(root).resolve()
    validate(root, app, name_ar, name_en, route)
    order, shortcut = web_slots(root)
    tokens = {
        'app': app, 'route': app if route is None else route,
        'locale': app if route is None else route, 'ns': app if route is None else camel(route), 'App': pascal(app), 'name_ar': name_ar.strip(), 'name_en': name_en.strip(),
        'order': str(order), 'shortcut': shortcut,
    }
    files = planned_files(root, tokens)
    edits = registration_edits(root, tokens)
    clashes = sorted(relative for relative in files if (root / relative).exists())
    if clashes:
        msg = 'refusing to overwrite existing files: ' + ', '.join(clashes)
        raise ScaffoldError(msg)
    if dry_run:
        return sorted(files), sorted(edits), []
    catalog = _catalog_module()
    # Everything that may be rewritten, kept in memory so a failure restores it exactly.
    originals = {}
    for relative in (*edits, *catalog.RELEASE_COPIES):
        path = root / relative
        if path.is_file():
            originals[path] = path.read_bytes()
    created = []
    try:
        synced = _write_all(root, files, edits, catalog, created)
    except BaseException as error:
        for path in reversed(created):
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            elif path.exists():
                path.unlink()
        for path, data in originals.items():
            path.write_bytes(data)
        if isinstance(error, ScaffoldError) or not isinstance(error, Exception):
            raise
        msg = f'{type(error).__name__}: {error}; all changes were rolled back'
        raise ScaffoldError(msg) from error
    return sorted(files), sorted(edits), synced


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('app', help='application id, e.g. sales (addon nasq_sales)')
    parser.add_argument('--name-ar', required=True, help='Arabic display name')
    parser.add_argument('--name-en', required=True, help='English display name')
    parser.add_argument('--route', default=None, help='web route slug (kebab-case); defaults to the application id')
    parser.add_argument('--root', default=str(DEFAULT_ROOT), help='repository root (default: this repository)')
    parser.add_argument('--dry-run', action='store_true', help='print the planned files and edits, write nothing')
    args = parser.parse_args(argv)
    try:
        created, edited, synced = scaffold(args.root, args.app, args.name_ar, args.name_en, args.dry_run, args.route)
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
    if not args.dry_run:
        print(CATALOG_WARNING)
    return 0


if __name__ == '__main__':
    sys.exit(main())
