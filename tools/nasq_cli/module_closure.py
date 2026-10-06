# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Installation closure of a selected Nasq module set, read from real manifests.

Odoo installs a module's dependencies and any ``auto_install`` module whose
dependencies are all present. The managed-tenant tooling therefore compares
what is installed with this closure, not with the raw selection.
"""
from __future__ import annotations

import ast
from pathlib import Path

REPO_ADDONS = Path(__file__).resolve().parents[2] / 'odoo-addons'
_OWNED_PREFIXES = ('nasq_', 'customer_')


class ClosureError(Exception):
    """A selected or required Nasq module has no readable manifest."""


def _owned(name):
    return name.startswith(_OWNED_PREFIXES)


def _read_manifest(addons_paths, module):
    for directory in addons_paths:
        manifest = Path(directory) / module / '__manifest__.py'
        if manifest.is_file():
            try:
                value = ast.literal_eval(manifest.read_text(encoding='utf-8'))
                depends = value.get('depends', [])
                auto = value.get('auto_install', False)
            except (OSError, ValueError, SyntaxError, AttributeError):
                raise ClosureError(module) from None
            if not isinstance(depends, list) or any(type(dep) is not str for dep in depends):
                raise ClosureError(module)
            return [dep for dep in depends if _owned(dep)], bool(auto)
    raise ClosureError(module)


def install_closure(addons_paths, selected):
    """Return the set of Nasq modules Odoo installs for ``selected``."""
    paths = [addons_paths] if isinstance(addons_paths, (str, Path)) else list(addons_paths)
    manifests = {}
    pending = list(selected)
    while pending:
        name = pending.pop()
        if name in manifests:
            continue
        manifests[name] = _read_manifest(paths, name)
        pending.extend(manifests[name][0])
    closure = set(manifests)
    # Auto-install candidates: every owned module present in the addons paths.
    candidates = {}
    for directory in paths:
        root = Path(directory)
        if not root.is_dir():
            continue
        for entry in root.iterdir():
            if _owned(entry.name) and (entry / '__manifest__.py').is_file():
                candidates.setdefault(entry.name, None)
    changed = True
    while changed:
        changed = False
        for name in sorted(candidates):
            if name in closure:
                continue
            try:
                depends, auto = _read_manifest(paths, name)
            except ClosureError:
                continue
            if auto and depends and all(dep in closure for dep in depends):
                closure.add(name)
                changed = True
    return closure
