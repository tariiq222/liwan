# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Installation closure of a selected Nasq module set, read from real manifests.

Odoo installs a module's dependencies and any ``auto_install`` module whose
dependencies are all installed. The managed-tenant tooling therefore compares
what is installed with this closure, not with the raw selection. Odoo addons
(project, hr, mail ...) are not resolvable here: an ``auto_install`` Nasq
module joins only when each of its Odoo dependencies is ``base`` or a direct
dependency of some module already in the closure.
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
    """``(nasq dependencies, other dependencies, auto_install)`` of ``module``."""
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
            owned = [dep for dep in depends if _owned(dep)]
            other = [dep for dep in depends if not _owned(dep)]
            return owned, other, bool(auto)
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
    # Odoo addons the closure requires directly; Odoo installs them with it.
    required = {'base'}
    for _owned_deps, other_deps, _auto in manifests.values():
        required.update(other_deps)
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
                owned_deps, other_deps, auto = _read_manifest(paths, name)
            except ClosureError:
                continue
            if (
                auto and (owned_deps or other_deps)
                and all(dep in closure for dep in owned_deps)
                and all(dep in required for dep in other_deps)
            ):
                closure.add(name)
                required.update(other_deps)
                changed = True
    return closure
