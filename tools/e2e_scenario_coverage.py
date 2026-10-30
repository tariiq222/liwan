# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Report which customer surfaces the end-user scenario register does not cover.

The register is e2e/scenarios/*.md. A scenario row names what it exercises in
backticked tokens:

    `page /hr/leave/[id]`                 a page of apps/web (file route, params as [id])
    `vendor /customers/new`               a page of apps/vendor-admin
    `POST /api/v1/hr/leaves/<id>/approve` an Odoo route (params as <id>)
    `cap hr.leave.approve`                a capability, allowed or refused

The surfaces are read from the code: apps/web/app/pages, apps/vendor-admin/app/pages,
every @http.route in odoo-addons/liwan_*/controllers and every capability key in
odoo-addons/*/data. `--check` exits 1 when a surface has no scenario or a token
names a surface that does not exist.

    python3 -B tools/e2e_scenario_coverage.py [--check] [--app hr]
"""
import argparse
import ast
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENARIOS = ROOT / 'e2e' / 'scenarios'
WEB_PAGES = ROOT / 'apps' / 'web' / 'app' / 'pages'
VENDOR_PAGES = ROOT / 'apps' / 'vendor-admin' / 'app' / 'pages'
ADDONS = ROOT / 'odoo-addons'
TOKEN = re.compile(r'`((?:page|vendor|cap) [^`]+|(?:GET|HEAD|POST|PUT|PATCH|DELETE) /[^`]+)`')
PERMISSION_RECORD = re.compile(r'<record [^>]*model="liwan\.access\.permission"[^>]*>(.*?)</record>', re.S)
CAPABILITY_KEY = re.compile(r'<field name="key">([a-z_]+(?:\.[a-z_]+)+)</field>')
METHODS = ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE')


def _generic_params(path):
    """`/pay/[kind]/[id]` -> `/pay/[id]/[id]`: a page parameter's name does not identify the page."""
    return re.sub(r'\[\[[^\]]+\]\]', '[[id]]', re.sub(r'(?<!\[)\[[^\[\]]+\](?!\])', '[id]', path))


def page_route(relative):
    """`hr/leave/[leaveId].vue` -> `/hr/leave/[id]`; index files map to their folder."""
    parts = [part for part in Path(relative).with_suffix('').parts if not part.startswith('(')]
    if parts and parts[-1] == 'index':
        parts = parts[:-1]
    return _generic_params('/' + '/'.join(parts))


def pages(folder, kind):
    return {f'{kind} {page_route(path.relative_to(folder))}' for path in folder.rglob('*.vue')}


def odoo_route(path, method):
    return f"{method} {re.sub(r'<[^>]+>', '<id>', path)}"


def _value(node, constants):
    """A literal, a module-level string constant, or an f-string or `+` join built from them; None otherwise."""
    if isinstance(node, ast.Name):
        return constants.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _value(node.left, constants), _value(node.right, constants)
        return left + right if isinstance(left, str) and isinstance(right, str) else None
    if isinstance(node, ast.JoinedStr):
        parts = [
            part.value if isinstance(part, ast.Constant) else _value(part.value, constants)
            for part in node.values
        ]
        return None if None in parts else ''.join(parts)
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_value(item, constants) for item in node.elts]
    try:
        return ast.literal_eval(node)
    except ValueError:
        return None


def routes_in_source(source):
    """Every (method, path) declared by an @http.route decorator in SOURCE."""
    tree = ast.parse(source)
    constants = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            value = _value(node.value, constants)
            if isinstance(value, str):
                constants[node.targets[0].id] = value
    found = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not (isinstance(decorator, ast.Call) and getattr(decorator.func, 'attr', None) == 'route'):
                continue
            if not decorator.args:
                # A bare @http.route() re-decorates an inherited route; it declares no new path.
                continue
            paths = _value(decorator.args[0], constants)
            paths = [paths] if isinstance(paths, str) else (paths or [])
            if not paths or not all(isinstance(path, str) for path in paths):
                msg = f'cannot read the route path of {node.name} (line {node.lineno})'
                raise ValueError(msg)
            keywords = {keyword.arg: _value(keyword.value, constants) for keyword in decorator.keywords}
            methods = keywords.get('methods') or METHODS
            found |= {odoo_route(path, method.upper()) for path in paths for method in methods}
    return found


def addon_routes():
    by_addon = defaultdict(set)
    for path in sorted(ADDONS.glob('liwan_*/controllers/**/*.py')):
        by_addon[path.relative_to(ADDONS).parts[0]] |= routes_in_source(path.read_text(encoding='utf-8'))
    return by_addon


def capabilities():
    keys = set()
    for path in ADDONS.glob('*/data/*.xml'):
        for record in PERMISSION_RECORD.findall(path.read_text(encoding='utf-8')):
            keys |= set(CAPABILITY_KEY.findall(record))
    return {f'cap {key}' for key in keys}


def surfaces():
    """Every surface grouped by the area the report prints it under."""
    groups = defaultdict(set)
    for token in pages(WEB_PAGES, 'page'):
        groups['web ' + (token.split('/')[1] or 'home')].add(token)
    for token in pages(VENDOR_PAGES, 'vendor'):
        groups['vendor-admin'].add(token)
    for addon, routes in addon_routes().items():
        groups[addon] |= routes
    for token in capabilities():
        groups['capabilities ' + token.split()[1].split('.')[0]].add(token)
    return groups


def referenced_tokens(folder=SCENARIOS):
    # README.md explains the token syntax with examples; only the register files count.
    files = [path for path in folder.glob('*.md') if path.name != 'README.md']
    matches = {match for path in files for match in TOKEN.findall(path.read_text(encoding='utf-8'))}
    return {_generic_params(match) if match.startswith(('page ', 'vendor ')) else match for match in matches}


def report(groups, referenced, only=None):
    known = set().union(*groups.values())
    missing = {
        group: sorted(tokens - referenced) for group, tokens in sorted(groups.items())
        if only is None or only in group
    }
    unknown = sorted(referenced - known)
    return missing, unknown


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--check', action='store_true', help='exit 1 on any gap or unknown token')
    parser.add_argument('--app', help='only report groups whose name contains this text')
    args = parser.parse_args(argv)
    groups = surfaces()
    missing, unknown = report(groups, referenced_tokens(), args.app)
    total = covered = 0
    for group, tokens in missing.items():
        size = len(groups[group])
        total += size
        covered += size - len(tokens)
        print(f'{group}: {size - len(tokens)}/{size} covered')
        for token in tokens:
            print(f'  missing `{token}`')
    for token in unknown:
        print(f'unknown `{token}` (no such surface)')
    print(f'total: {covered}/{total} surfaces covered, {len(unknown)} unknown tokens')
    return 1 if args.check and (covered < total or unknown) else 0


if __name__ == '__main__':
    sys.exit(main())
