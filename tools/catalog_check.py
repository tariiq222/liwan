# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Catalog validation for the nasq solution catalog (distribution-models spec §7.3).

Two independent stages, both offline:

1. **Schema validation** — a small JSON-Schema (2020-12 subset) interpreter runs the
   committed schema files against the committed catalog. The schema files stay the
   machine-readable contract; this module refuses any keyword it does not implement,
   so a schema can never silently claim a rule that is not enforced.
2. **Semantic validation** — the catalog is cross-checked against the source of truth
   in the repository itself: Odoo manifests and the feature registry declared in
   `odoo-addons/*/models/`.

Nothing here connects to the network, starts Odoo or Docker, reads a database, or
writes tenant policy. It is a repository check, not a provisioning step.
"""
# ruff: noqa: T201 -- command-line verification evidence
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

try:  # run as a script (tools/ on the path) or imported as tools.catalog_check
    from nasq_cli.module_closure import ClosureError, install_closure
except ModuleNotFoundError:
    from tools.nasq_cli.module_closure import ClosureError, install_closure

ROOT_DEFAULT = Path(__file__).resolve().parents[1]

CATALOG_DIR = 'deploy/catalog'
ADDONS_DIR = 'odoo-addons'
# Every addon owned by this repository is prefixed, so an unresolvable prefixed
# dependency is a typo or a missing module rather than an Odoo core addon.
ADDON_PREFIX = 'nasq_'

# The schema URL is an editor hint. Nothing in this repository fetches it, and the
# Customer-Hosted rule (§2.1: no runtime external dependency) is unaffected.
SUPPORTED_KEYWORDS = frozenset({
    '$schema', '$id', 'title', 'description', '$defs', '$ref',
    'type', 'const', 'enum', 'pattern', 'minLength', 'minimum',
    'required', 'properties', 'additionalProperties',
    'items', 'minItems', 'uniqueItems',
})

# Test-only addons must never be sold in a catalog tier. Each entry is verified
# against its own manifest, so this list cannot silently rot (see check_test_only).
TEST_ONLY_MODULES = frozenset({'nasq_registry_probe'})
TEST_ONLY_MARKER = 'never installed in production'

# A schema-3 solution installs its whole release in every tenant (spec 3.6).
RELEASE_SCHEMA = 3
# Files that still spell the release module list out (they run where the repository
# tools are not available). Each list must equal the newest schema-3 release.
RELEASE_COPIES = (
    '.woodpecker.yml',
    'deploy/provision.sh',
    'deploy/woodpecker/image.yml',
    'tools/shared_acceptance_live/up.sh',
    'deploy/check_isolated.py',
)
_COMMA_LIST = re.compile(r'/?[a-z][a-z0-9_]*(?:,/?[a-z][a-z0-9_]*)+')
_ADDON_TUPLE = re.compile(r'NASQ_ADDONS = \(([^)]*)\)')

JSON_TYPES = {
    'object': dict,
    'array': list,
    'string': str,
    'integer': int,
    'boolean': bool,
    'null': type(None),
}


class SchemaError(ValueError):
    """A schema uses a keyword this interpreter does not implement."""


# --------------------------------------------------------------------------- schema


def _assert_supported(schema, path='#'):
    if not isinstance(schema, dict):
        raise SchemaError(f'{path}: a schema node must be an object')
    for keyword in schema:
        if keyword not in SUPPORTED_KEYWORDS:
            raise SchemaError(f'{path}: unsupported schema keyword {keyword!r}')
    expected = schema.get('type')
    if expected is not None and expected not in JSON_TYPES:
        # Fail as a schema error instead of a KeyError while validating a document.
        raise SchemaError(f'{path}: unsupported schema type {expected!r}')
    for name, subschema in (schema.get('properties') or {}).items():
        _assert_supported(subschema, f'{path}/properties/{name}')
    for name, subschema in (schema.get('$defs') or {}).items():
        _assert_supported(subschema, f'{path}/$defs/{name}')
    if isinstance(schema.get('additionalProperties'), dict):
        _assert_supported(schema['additionalProperties'], f'{path}/additionalProperties')
    if isinstance(schema.get('items'), dict):
        _assert_supported(schema['items'], f'{path}/items')


def _type_matches(expected, value):
    if expected == 'integer':
        return isinstance(value, int) and not isinstance(value, bool)
    python_type = JSON_TYPES[expected]
    if python_type is bool:
        return isinstance(value, bool)
    return isinstance(value, python_type)


def _resolve(root, schema):
    ref = schema['$ref']
    if not ref.startswith('#/'):
        raise SchemaError(f'unsupported $ref {ref!r}: only local #/ pointers are implemented')
    node = root
    for part in ref[2:].split('/'):
        if part not in node:
            raise SchemaError(f'unresolvable $ref {ref!r}')
        node = node[part]
    return node


def validate(root, schema, value, path, errors):
    """Append every schema violation of `value` at `path` to `errors`."""
    while '$ref' in schema:
        schema = _resolve(root, schema)
    if 'const' in schema and value != schema['const']:
        errors.append(f'{path}: expected {schema["const"]!r}')
        return
    if 'enum' in schema and value not in schema['enum']:
        errors.append(f'{path}: {value!r} is not one of {schema["enum"]!r}')
        return
    expected = schema.get('type')
    if expected is not None and not _type_matches(expected, value):
        errors.append(f'{path}: expected {expected}, got {type(value).__name__}')
        return
    if isinstance(value, str):
        if 'pattern' in schema and not re.fullmatch(schema['pattern'], value):
            errors.append(f'{path}: {value!r} does not match {schema["pattern"]}')
        if 'minLength' in schema and len(value) < schema['minLength']:
            errors.append(f'{path}: {value!r} is shorter than {schema["minLength"]}')
    if isinstance(value, int) and not isinstance(value, bool):
        if 'minimum' in schema and value < schema['minimum']:
            errors.append(f'{path}: {value} is below the minimum {schema["minimum"]}')
    if isinstance(value, list):
        if 'minItems' in schema and len(value) < schema['minItems']:
            errors.append(f'{path}: needs at least {schema["minItems"]} item(s)')
        if schema.get('uniqueItems'):
            seen = [json.dumps(item, sort_keys=True) for item in value]
            if len(seen) != len(set(seen)):
                errors.append(f'{path}: entries must be unique')
        if isinstance(schema.get('items'), dict):
            for index, item in enumerate(value):
                validate(root, schema['items'], item, f'{path}[{index}]', errors)
    if isinstance(value, dict):
        for name in schema.get('required', ()):
            if name not in value:
                errors.append(f'{path}: missing required property {name!r}')
        properties = schema.get('properties') or {}
        for name, item in value.items():
            if name in properties:
                validate(root, properties[name], item, f'{path}.{name}', errors)
                continue
            extra = schema.get('additionalProperties', True)
            if extra is False:
                errors.append(f'{path}: unexpected property {name!r}')
            elif isinstance(extra, dict):
                validate(root, extra, item, f'{path}.{name}', errors)


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise SchemaError(f'{path}: invalid JSON: {exc}') from exc


# ------------------------------------------------------------------------- registry


def _literal(node):
    try:
        return ast.literal_eval(node)
    except (ValueError, SyntaxError):
        return None


def read_registry(root):
    """Feature and module keys as declared in source.

    Parsing beats importing: this must run with no Odoo environment and must fail
    loudly if a declaration is not a literal.
    """
    features, modules = {}, set()
    for path in sorted((Path(root) / ADDONS_DIR).glob('*/models/**/*.py')):
        try:
            tree = ast.parse(path.read_text(encoding='utf-8'))
        except SyntaxError as exc:
            raise SchemaError(f'{path}: cannot parse: {exc}') from exc
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            if node.name not in {'_nasq_feature_definitions', '_nasq_module_definitions'}:
                continue
            for entry in ast.walk(node):
                if not isinstance(entry, ast.Dict):
                    continue
                data = {}
                for key_node, value_node in zip(entry.keys, entry.values):
                    name = _literal(key_node)
                    if isinstance(name, str):
                        data[name] = _literal(value_node)
                if node.name == '_nasq_feature_definitions':
                    if not isinstance(data.get('key'), str):
                        raise SchemaError(f'{path}: feature definition without a literal key')
                    if data['key'] in features:
                        raise SchemaError(f'{path}: duplicate feature key {data["key"]!r}')
                    features[data['key']] = data
                elif isinstance(data.get('id'), str):
                    modules.add(data['id'])
    return features, modules


def read_manifests(root):
    manifests = {}
    for path in sorted((Path(root) / ADDONS_DIR).glob('*/__manifest__.py')):
        data = _literal(ast.parse(path.read_text(encoding='utf-8')).body[0].value)
        if not isinstance(data, dict):
            raise SchemaError(f'{path}: manifest is not a literal dict')
        manifests[path.parent.name] = {
            'depends': [d for d in data.get('depends', []) if isinstance(d, str)],
            'summary': data.get('summary') or '',
        }
    return manifests


def find_cycles(edges):
    """Return a sorted list of modules that take part in a dependency cycle."""
    colour, cycles = {}, set()

    def visit(node, stack):
        colour[node] = 1
        stack.append(node)
        for neighbour in edges.get(node, ()):
            if colour.get(neighbour) == 1:
                cycles.update(stack[stack.index(neighbour):])
            elif colour.get(neighbour) is None:
                visit(neighbour, stack)
        stack.pop()
        colour[node] = 2

    for node in sorted(edges):
        if colour.get(node) is None:
            visit(node, [])
    return sorted(cycles)


# --------------------------------------------------------------------------- checks


def _feature_parts(entry, errors, where):
    """Split a catalog feature entry into (type, key)."""
    if not isinstance(entry, str) or ':' not in entry:
        errors.append(f'{where}: feature {entry!r} must look like boolean:<key> or limit:<key>')
        return None, None
    kind, _, key = entry.partition(':')
    if kind == 'limit' and ':' in key:
        key, _, ceiling = key.partition(':')
        if not re.fullmatch(r'0|[1-9][0-9]{0,8}|1000000000', ceiling):
            errors.append(f'{where}: feature {entry!r} ceiling must be an integer between 0 and 1000000000')
            return None, None
    elif kind == 'boolean' and ':' in key:
        errors.append(f'{where}: feature {entry!r} must look like boolean:<key> or limit:<key>[:<int>]')
        return None, None
    return kind, key


def _check_features(entries, where, installed, subject, registry, limit_keys, errors):
    """Validate catalog feature entries against the registry.

    Shared by tiers and addons so an addon cannot smuggle an undeclared or
    wrong-typed feature past the check. Returns the declared limit keys.
    """
    declared_limits = set()
    for entry in entries:
        kind, key = _feature_parts(entry, errors, where)
        if key is None:
            continue
        definition = registry.get(key)
        if definition is None:
            errors.append(f'{where}: feature {key!r} is not declared in the registry')
            continue
        if kind != definition.get('type'):
            errors.append(
                f'{where}: feature {key!r} is {definition.get("type")!r} '
                f'in the registry, not {kind!r}',
            )
            continue
        if kind == 'limit':
            if key not in limit_keys:
                errors.append(f'{where}: {key!r} is not a known limit key')
            declared_limits.add(key)
        owner = definition.get('module')
        if owner and owner != 'nasq_platform' and owner not in installed:
            errors.append(
                f'{where}: feature {key!r} belongs to {owner!r}, '
                f'which {subject} does not install',
            )
    return declared_limits


def _nasq_owned(name, manifests, registry_modules):
    """True when a dependency must resolve inside odoo-addons.

    Odoo core addons (project, hr, mail, auth_totp …) are checked out separately in
    CI and are not resolvable here, so they stay external by design. A module is
    nasq-owned when it ships from odoo-addons, is declared in the module registry,
    or carries the repository's nasq_ prefix.
    """
    return name in manifests or name in registry_modules or name.startswith(ADDON_PREFIX)


def release_modules(root, data):
    """Sorted install closure of a solution's base and tier modules."""
    selected = list(data.get('base_modules') or [])
    for tier in data.get('tiers') or []:
        selected += list(tier.get('modules') or [])
    return sorted(install_closure([Path(root) / ADDONS_DIR], selected))


def _solution_order(path):
    """Order solution files by the numeric suffix of platform_vN, so v10 follows v3."""
    match = re.search(r'_v(\d+)$', path.stem)
    return (int(match.group(1)) if match else -1, path.name)


def current_release(root, catalog_dir=CATALOG_DIR):
    """(file name, release modules) of the newest schema-3 solution, or None."""
    solutions = (Path(root) / catalog_dir / 'solutions').glob('*.json')
    current = sorted((path for path in solutions if load_json(path).get('schema_version') == RELEASE_SCHEMA),
                     key=_solution_order)
    if not current:
        return None
    return current[-1].name, release_modules(root, load_json(current[-1]))


def _check_release(root, where, data, registry, errors):
    """Every feature of a release module (and of the platform) sits in exactly one tier."""
    try:
        release = set(release_modules(root, data))
    except ClosureError as exc:
        errors.append(f'{where}: release module {exc} has no readable manifest')
        return
    tiers_by_key = {}
    for tier in data.get('tiers') or []:
        tier_features = tier.get('features') or []
        if (tier.get('modules') or []) and not tier_features:
            errors.append(f'{where}: tier {tier.get("id")!r} lists modules but declares no feature')
        for entry in tier_features:
            if isinstance(entry, str) and entry.count(':') >= 1:
                tiers_by_key.setdefault(entry.split(':')[1], []).append(str(tier.get('id')))
    for key, tier_ids in sorted(tiers_by_key.items()):
        if len(tier_ids) > 1:
            errors.append(f'{where}: feature {key!r} is declared by more than one tier ({", ".join(tier_ids)})')
        owner = (registry.get(key) or {}).get('module')
        if owner and owner != 'nasq_platform' and owner not in release:
            errors.append(f'{where}: feature {key!r} belongs to module {owner!r}, which is not in the release')
    for key, definition in sorted(registry.items()):
        module = definition.get('module')
        if module in TEST_ONLY_MODULES:
            continue
        if (module == 'nasq_platform' or module in release) and key not in tiers_by_key:
            errors.append(f'{where}: feature {key!r} of release module {module!r} is in no tier')


def _check_release_copies(root, base_modules, modules, errors):
    """Literal copies of the release list must equal it (names outside the release that
    are not Nasq addons, such as the theme, are ignored)."""
    expected = set(modules)
    anchor = base_modules[0] if base_modules else None
    for relative in RELEASE_COPIES:
        path = Path(root) / relative
        if not path.is_file() or anchor is None:
            continue
        text = path.read_text(encoding='utf-8')
        found = []
        for match in _COMMA_LIST.finditer(text):
            names = [name.lstrip('/') for name in match.group(0).split(',')]
            if anchor in names:
                found.append(names)
        for match in _ADDON_TUPLE.finditer(text):
            found.append(re.findall(r"'([a-z0-9_]+)'", match.group(1)))
        for names in found:
            listed = {name for name in names if name in expected or name.startswith(ADDON_PREFIX)}
            if listed != expected:
                errors.append(
                    f'{relative}: module list {sorted(listed)} differs from the release modules {sorted(expected)}',
                )


def check_catalog(root, catalog_dir=CATALOG_DIR):
    """Return every catalog error; an empty list means the catalog is valid."""
    root = Path(root)
    base = root / catalog_dir
    errors = []
    schema_dir = base / 'schema'
    schema_files = {
        'solution': schema_dir / 'solution.schema.json',
        'industry': schema_dir / 'industry.schema.json',
    }
    schemas = {}
    for name, path in schema_files.items():
        if not path.is_file():
            errors.append(f'schema {name}: missing file {path.relative_to(root)}')
            continue
        schemas[name] = load_json(path)
        if schemas[name].get('$schema') is None:
            errors.append(f'schema {name}: missing $schema declaration')
        _assert_supported(schemas[name])

    manifests = read_manifests(root)
    registry, registry_modules = read_registry(root)
    limit_keys = {k for k, v in registry.items() if v.get('type') == 'limit'}

    def known_module(module, where):
        if module not in manifests:
            errors.append(f'{where}: module {module!r} has no {ADDONS_DIR}/{module}/__manifest__.py')
            return False
        return True

    industry_ids = set()
    for path in sorted((base / 'industries').glob('*.json')):
        if 'industry' not in schemas:
            continue
        data = load_json(path)
        validate(schemas['industry'], schemas['industry'], data, f'industries/{path.name}', errors)
        declared = data.get('id')
        if declared != path.stem:
            errors.append(f'industries/{path.name}: id {declared!r} must match the file name')
        industry_ids.add(path.stem)

    solutions = sorted((base / 'solutions').glob('*.json'))
    if not solutions:
        errors.append('solutions/: no solution file found')
    for path in solutions:
        where = f'solutions/{path.name}'
        data = load_json(path)
        if 'solution' not in schemas:
            continue
        validate(schemas['solution'], schemas['solution'], data, where, errors)
        if data.get('id') != path.stem:
            errors.append(f'{where}: id {data.get("id")!r} must match the file name')
        if data.get('schema_version') == RELEASE_SCHEMA:
            _check_release(root, where, data, registry, errors)

        industry = data.get('industry')
        if industry is not None and industry not in industry_ids:
            errors.append(f'{where}: industry {industry!r} has no industries/{industry}.json')

        base_modules = list(data.get('base_modules') or [])
        for module in base_modules:
            known_module(module, f'{where}.base_modules')

        addons = data.get('addons') or []
        addon_ids, addon_modules_by_id, module_owner = [], {}, {}
        for addon in addons:
            addon_id = addon.get('id')
            addon_where = f'{where}.addons[{addon_id}]'
            if addon_id in addon_ids:
                errors.append(f'{where}.addons: duplicate addon id {addon_id!r}')
            addon_ids.append(addon_id)
            modules = list(addon.get('modules') or [])
            for module in modules:
                known_module(module, f'{addon_where}.modules')
                if module in module_owner:
                    errors.append(
                        f'{where}.addons: {module!r} is declared by both '
                        f'{module_owner[module]!r} and {addon_id!r}',
                    )
                else:
                    module_owner[module] = addon_id
            addon_modules_by_id[addon_id] = set(modules)
            overlap_base = sorted(set(modules) & set(base_modules))
            if overlap_base:
                errors.append(
                    f'{addon_where}: {overlap_base!r} is both a base module '
                    'and an optional module',
                )
            _check_features(
                addon.get('features') or [], addon_where,
                set(base_modules) | set(modules), 'this addon',
                registry, limit_keys, errors,
            )

        tiers = data.get('tiers') or []
        tier_ids = []
        for tier in tiers:
            tier_id = tier.get('id')
            tier_where = f'{where}.tiers[{tier_id}]'
            if tier_id in tier_ids:
                errors.append(f'{where}.tiers: duplicate tier id {tier_id!r}')
            tier_ids.append(tier_id)
            tier_modules = list(tier.get('modules') or [])
            for module in tier_modules:
                known_module(module, f'{tier_where}.modules')
            referenced_addons = list(tier.get('addons') or [])
            for addon_id in referenced_addons:
                if addon_id not in addon_ids:
                    errors.append(f'{tier_where}.addons: {addon_id!r} is not a declared addon')
            # Only the addons this tier references count as installed for it: a tier
            # must not borrow the owner module of a feature from a sibling addon.
            installed = set(base_modules) | set(tier_modules)
            for addon_id in referenced_addons:
                installed |= addon_modules_by_id.get(addon_id, set())
            overlap = sorted(set(tier_modules) & set(base_modules))
            if overlap:
                errors.append(
                    f'{tier_where}: {overlap!r} is both a base module and an optional module',
                )
            for module in installed:
                if module in TEST_ONLY_MODULES:
                    errors.append(f'{tier_where}: {module!r} is test-only and cannot be sold')

            declared_limits = _check_features(
                tier.get('features') or [], tier_where, installed, 'this tier',
                registry, limit_keys, errors,
            )
            for key in (tier.get('limits') or {}):
                if key not in registry:
                    errors.append(f'{tier_where}.limits: limit {key!r} is not declared in the registry')
                elif registry[key].get('type') != 'limit':
                    errors.append(f'{tier_where}.limits: {key!r} is not a limit feature')
                if key not in declared_limits:
                    errors.append(
                        f'{tier_where}.limits: {key!r} sets a ceiling for a feature '
                        'the tier does not declare',
                    )

    # Dependency graph of every catalog module, resolved inside odoo-addons only.
    catalog_modules = set()
    for path in solutions:
        data = load_json(path)
        catalog_modules.update(data.get('base_modules') or [])
        for addon in data.get('addons') or []:
            catalog_modules.update(addon.get('modules') or [])
        for tier in data.get('tiers') or []:
            catalog_modules.update(tier.get('modules') or [])
    edges = {}
    for module in sorted(catalog_modules):
        if module not in manifests:
            continue
        for dependency in manifests[module]['depends']:
            if dependency not in manifests and _nasq_owned(
                dependency, manifests, registry_modules,
            ):
                # A nasq-owned dependency with no manifest is a typo or a missing
                # module, not an Odoo core addon.
                errors.append(
                    f'{module}: nasq dependency {dependency!r} is missing from {ADDONS_DIR}',
                )
        edges[module] = [
            dependency for dependency in manifests[module]['depends']
            if dependency in manifests
        ]
    for module in find_cycles(edges):
        errors.append(f'{module}: part of a dependency cycle in {ADDONS_DIR}')

    try:
        current = current_release(root, catalog_dir)
    except ClosureError as exc:
        current = None
        errors.append(f'release module {exc} has no readable manifest')
    if current is not None:
        newest = load_json(base / 'solutions' / current[0])
        _check_release_copies(root, list(newest.get('base_modules') or []), current[1], errors)

    for module in sorted(TEST_ONLY_MODULES):
        summary = manifests.get(module, {}).get('summary', '')
        if TEST_ONLY_MARKER not in summary:
            errors.append(
                f'{module}: listed as test-only but its manifest summary no longer says '
                f'{TEST_ONLY_MARKER!r}',
            )
    return errors


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    root = ROOT_DEFAULT
    release_only = argv[:1] == ['--release-modules']
    if release_only:
        argv = argv[1:]
    if argv:
        if argv[0] != '--root' or len(argv) != 2:
            print('usage: catalog_check.py [--release-modules] [--root REPOSITORY]', file=sys.stderr)
            return 2
        root = Path(argv[1]).resolve()
    if release_only:
        try:
            current = current_release(root)
        except ClosureError as exc:
            print(f'CATALOG_INVALID release module {exc} has no readable manifest', file=sys.stderr)
            return 1
        if current is None:
            print('CATALOG_INVALID no schema 3 solution defines the release', file=sys.stderr)
            return 1
        print(','.join(current[1]))
        return 0
    try:
        errors = check_catalog(root)
    except SchemaError as exc:
        print(f'CATALOG_INVALID {exc}')
        return 1
    for error in errors:
        print(f'CATALOG_INVALID {error}')
    if errors:
        return 1
    solutions = len(list((Path(root) / CATALOG_DIR / 'solutions').glob('*.json')))
    print(f'CATALOG_OK solutions={solutions}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
