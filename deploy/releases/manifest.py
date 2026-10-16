"""Immutable release inputs and conservative, source-backed classification.

A positive static decision is conditional on reviewer evidence. This module does
not establish semantic compatibility or authorize a deployment.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import re

NAME = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$')
MODULE = re.compile(r'^[a-z][a-z0-9_]*$')
IMAGE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$')
MODES = {'online', 'tenant_maintenance', 'service_maintenance', 'infrastructure_maintenance'}
SERVICES = {'odoo', 'web', 'guard', 'ai', 'database', 'edge', 'storage', 'host'}
FIELDS = {'releaseId', 'webvueCommit', 'odooCommit', 'images', 'assetsId', 'moduleVersions',
          'upgradeModules', 'installModules', 'mode', 'affectedServices', 'aiStateVersion',
          'compatibilityEvidence', 'rollbackPolicy'}


class FrozenDict(dict):
    """JSON-serializable immutable mapping, including its nested values."""
    def _reject(self, *args, **kwargs):
        raise TypeError('immutable_release')
    __setitem__ = __delitem__ = clear = pop = popitem = setdefault = update = __ior__ = _reject

    def __deepcopy__(self, memo):
        return self


def _freeze(value):
    if isinstance(value, dict):
        return FrozenDict({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _valid_name(value, pattern=NAME):
    return isinstance(value, str) and bool(pattern.fullmatch(value))


def validate_manifest(value):
    """Reject malformed or ambiguous identity; never include inputs in errors."""
    try:
        if not isinstance(value, dict) or set(value) != FIELDS:
            raise ValueError()
        for key in ('releaseId', 'assetsId', 'aiStateVersion'):
            if not _valid_name(value[key]):
                raise ValueError()
        for key in ('webvueCommit', 'odooCommit'):
            if not isinstance(value[key], str) or not re.fullmatch('[a-f0-9]{40}', value[key]):
                raise ValueError()
        images = value['images']
        if not isinstance(images, dict) or not {'odoo', 'web'} <= images.keys() or set(images) - {'odoo', 'web', 'guard', 'ai'}:
            raise ValueError()
        if any(not isinstance(image, str) or not IMAGE.fullmatch(image) for image in images.values()):
            raise ValueError()
        versions = value['moduleVersions']
        if not isinstance(versions, dict) or any(not _valid_name(key, MODULE) or not isinstance(version, str)
                or not re.fullmatch(r'19\.0(?:\.\d+){1,3}', version) for key, version in versions.items()):
            raise ValueError()
        for key in ('upgradeModules', 'installModules', 'affectedServices'):
            items = value[key]
            if not isinstance(items, (list, tuple)) or len(set(items)) != len(items):
                raise ValueError()
            if any(not _valid_name(item, MODULE) for item in items):
                raise ValueError()
        if (set(value['upgradeModules']) | set(value['installModules'])) - versions.keys():
            raise ValueError()
        if not value['affectedServices'] or set(value['affectedServices']) - SERVICES:
            raise ValueError()
        if value['mode'] not in MODES:
            raise ValueError()
        evidence, rollback = value['compatibilityEvidence'], value['rollbackPolicy']
        if not isinstance(evidence, dict) or not isinstance(rollback, dict):
            raise ValueError()
        if not _valid_name(evidence.get('reviewer')) or not _valid_name(evidence.get('reference')):
            raise ValueError()
        if 'reviewedPaths' in evidence:
            if not isinstance(evidence['reviewedPaths'], (list, tuple)) or any(
                    not isinstance(path, str) or Path(path).is_absolute() or '..' in Path(path).parts
                    or '\\' in path for path in evidence['reviewedPaths']):
                raise ValueError()
        if value['mode'] == 'online':
            if value['upgradeModules'] or value['installModules'] or rollback.get('oldWritesCompatible') is not True:
                raise ValueError()
            if any(evidence.get(key) is not True for key in (
                    'apiCompatible', 'sessionCompatible', 'concurrentWritesCompatible', 'jobsCompatible')):
                raise ValueError()
            if 'ai' in images and evidence.get('aiCompatible') is not True:
                raise ValueError()
        # JSON-only values: reject hidden executable/unserializable input.
        json.dumps(value, allow_nan=False)
    except (ValueError, TypeError, KeyError):
        raise ValueError('release_manifest_rejected') from None
    return _freeze(value)


def load_manifest(path):
    """Load a regular manifest, rejecting symlinks, duplicate keys and excess size."""
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError()
            result[key] = value
        return result
    try:
        path = Path(path)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1048576:
            raise ValueError()
        value = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_pairs)
        return validate_manifest(value)
    except (OSError, UnicodeError, ValueError, TypeError):
        raise ValueError('release_manifest_rejected') from None


def manifest_digest(manifest):
    """Canonical identity used by local rollout state."""
    validated = validate_manifest(manifest)
    return hashlib.sha256(json.dumps(validated, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _snapshot(root):
    root = Path(root)
    if not root.is_dir() or root.is_symlink():
        raise ValueError('source_root_rejected')
    files = {}
    ignored = {'.git', 'node_modules', '.nuxt', '.worktrees', '.superpowers', '__pycache__'}
    for directory, folders, names in os.walk(root, followlinks=False):
        folders[:] = sorted(folder for folder in folders if folder not in ignored)
        names = [name for name in names if name not in ignored]
        for name in [*folders, *names]:
            path = Path(directory) / name
            if path.is_symlink():
                raise ValueError('source_symlink_rejected')
        for name in sorted(names):
            path = Path(directory) / name
            if path.is_file():
                files[path.relative_to(root).as_posix()] = path.read_bytes()
    return files


def _source_version(value):
    """Apply the fixed Odoo 19 series rules to a source manifest version.

    Odoo modules/module.py adapt_version prefixes two/three-part versions;
    check_version then requires the current series. Its manifest default is 1.0.
    """
    version = str(value)
    parts = version.split('.')
    if not 2 <= len(parts) <= 5:
        raise ValueError('addon_version_rejected')
    try:
        tuple(int(part) for part in parts)
    except ValueError:
        raise ValueError('addon_version_rejected') from None
    if len(parts) <= 3 and not version.startswith('19.0'):
        version = '19.0.' + version
    if not version.startswith('19.0.'):
        raise ValueError('addon_version_rejected')
    return version


def _addons(files):
    addons, owners = {}, {}
    for path, content in files.items():
        if not path.endswith('/__manifest__.py'):
            continue
        prefix = path.rsplit('/', 1)[0]
        module = prefix.rsplit('/', 1)[-1]
        if not _valid_name(module, MODULE) or module in addons:
            raise ValueError('addon_manifest_rejected')
        try:
            tree = ast.parse(content.decode('utf-8'))
            if len(tree.body) != 1 or not isinstance(tree.body[0], ast.Expr):
                raise ValueError()
            value = ast.literal_eval(tree.body[0].value)
            dependencies = value.get('depends', [])
            if not isinstance(value, dict) or not isinstance(dependencies, list) or any(not _valid_name(dep, MODULE) for dep in dependencies):
                raise ValueError()
        except (SyntaxError, UnicodeError, ValueError, TypeError, AttributeError):
            raise ValueError('addon_manifest_rejected') from None
        value['version'] = _source_version(value.get('version', '1.0'))
        addons[module] = value
        owners[module] = prefix + '/'
    return addons, owners


def _python_schema_change(before, after):
    """Detect structural hazards, without claiming to prove other Python safe."""
    try:
        def signatures(source):
            tree = ast.parse(source.decode('utf-8'))
            values = []
            for node in ast.walk(tree):
                if isinstance(node, (ast.Assign, ast.AnnAssign)):
                    text = ast.dump(node, include_attributes=False)
                    if any(token in text for token in ('fields', '_name', '_inherit', '_sql_constraints', 'Constraint', 'Index', '_table')):
                        values.append(text)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in {'execute', 'executemany'}:
                    values.append(ast.dump(node, include_attributes=False))
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and any(
                        token in node.name for token in ('init', 'hook', 'migrate', 'register', 'access', 'rule', 'security')):
                    values.append(ast.dump(node, include_attributes=False))
            return sorted(values)
        return signatures(before) != signatures(after)
    except (SyntaxError, UnicodeError):
        return True


def classify_release(base_root, target_root, manifest, *, installed_modules=None):
    """Return deterministic fail-closed impact decision over two local trees.

    Roots include WebVue ``odoo-addons`` and, when touched, pinned stock Odoo
    ``addons``/``odoo/addons``. Missing stock dependency manifests block rather
    than consulting a different checkout or fetching remote code.

    ``installed_modules`` is a trusted ORM observation of the installed names,
    never the set of available source addons. When omitted, moduleVersions keys
    declare that inventory. Extra inventory versions are permitted; the complete
    affected closure must have matching target versions. Explicit install/upgrade
    targets participate in reverse expansion even when not yet installed.
    """
    manifest = validate_manifest(manifest)
    if installed_modules is None:
        installed = set(manifest['moduleVersions'])
    elif isinstance(installed_modules, (set, frozenset, list, tuple)) and all(
            _valid_name(module, MODULE) for module in installed_modules):
        installed = set(installed_modules)
    else:
        raise ValueError('installed_modules_rejected')
    reasons = set()
    try:
        base, target = _snapshot(base_root), _snapshot(target_root)
        old_addons, old_owners = _addons(base)
        addons, owners = _addons(target)
    except (OSError, ValueError):
        return {'eligible': False, 'mode': manifest['mode'], 'reasons': ['source_inspection_failed'], 'affected_modules': []}
    changed = sorted(path for path in base.keys() | target.keys() if base.get(path) != target.get(path))
    seeds = set(manifest['upgradeModules']) | set(manifest['installModules'])
    reviewed = set(manifest['compatibilityEvidence'].get('reviewedPaths', ()))
    needs_upgrade = set()
    for path in changed:
        module = next((name for name, prefix in {**old_owners, **owners}.items() if path.startswith(prefix)), None)
        if module:
            seeds.add(module)
            relative = path[len(owners.get(module, old_owners.get(module))):]
            structural = (relative == '__manifest__.py' or relative.endswith(('.xml', '.csv', '.po', '.pot'))
                          or relative.split('/')[0] in {'security', 'data', 'migrations', 'static'})
            if relative.endswith('.py') and _python_schema_change(base.get(path, b''), target.get(path, b'')):
                structural = True
            if structural:
                needs_upgrade.add(module)
                if manifest['mode'] == 'online':
                    reasons.add('module_change_requires_maintenance')
            elif relative.endswith('.py'):
                if path not in reviewed:
                    reasons.add('semantic_review_required')
            elif not relative.endswith(('.md', '.rst', '.txt')):
                reasons.add('unknown_change')
        elif path.startswith(('apps/web/', 'packages/ui/')) and Path(path).suffix in {'.css', '.scss', '.vue', '.ts', '.js', '.json'}:
            if Path(path).suffix != '.css' and path not in reviewed:
                reasons.add('semantic_review_required')
        elif path.startswith('docs/') or path.endswith('.md'):
            continue
        else:
            reasons.add('unknown_change')
    affected = set(seeds)
    # Available but uninstalled addons cannot expand the reverse dependency graph.
    reverse_scope = installed | set(manifest['upgradeModules']) | set(manifest['installModules'])
    while True:
        closure = set(affected)
        for module in affected:
            if module not in addons:
                reasons.add('unresolved_dependency')
                continue
            closure.update(addons[module].get('depends', []))
        for module in reverse_scope:
            if module in addons and set(addons[module].get('depends', [])) & affected:
                closure.add(module)
        if closure == affected:
            break
        affected = closure
    if needs_upgrade - (set(manifest['upgradeModules']) | set(manifest['installModules'])) and manifest['mode'] != 'online':
        reasons.add('undeclared_module_operation')
    for module in affected:
        if module not in addons:
            reasons.add('unresolved_dependency')
        elif manifest['moduleVersions'].get(module) != addons[module].get('version'):
            reasons.add('module_version_mismatch')
    if manifest['odooCommit'] != manifest['compatibilityEvidence'].get('baseOdooCommit', manifest['odooCommit']):
        if manifest['compatibilityEvidence'].get('odooEngineCompatible') is not True:
            reasons.add('odoo_engine_review_required')
    return {'eligible': not reasons, 'mode': manifest['mode'], 'reasons': sorted(reasons), 'affected_modules': sorted(affected)}
