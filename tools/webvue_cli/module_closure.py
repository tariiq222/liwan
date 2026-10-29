# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Installation closure of a selected WebVue module set, read from real manifests.

Odoo installs a module's dependencies and any ``auto_install`` module whose
dependencies are all installed; a module whose ``auto_install`` is a list of some
of its dependencies is installed as soon as those are, with the rest of its
dependencies. The managed-tenant tooling therefore compares what is installed
with this closure, not with the raw selection. Odoo addons (project, hr, mail ...)
are not resolvable here: an ``auto_install`` WebVue module joins only when each of
its Odoo trigger dependencies is ``base`` or a direct dependency of some module
already in the closure.
"""
from __future__ import annotations

import ast
from pathlib import Path

REPO_ADDONS = Path(__file__).resolve().parents[2] / 'odoo-addons'
_OWNED_PREFIXES = ('webvue_', 'customer_')


class ClosureError(Exception):
    """A selected or required WebVue module has no readable manifest."""


def _owned(name):
    return name.startswith(_OWNED_PREFIXES)


def _read_manifest(addons_paths, module):
    """``(webvue dependencies, other dependencies, auto_install)`` of ``module``.

    ``auto_install`` is None (never) or the set of dependencies that trigger it: ``True`` means all of
    them and an iterable names some of them, as Odoo reads a manifest (``odoo/modules/module.py``).
    An empty set means always.
    """
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
            if isinstance(auto, (list, tuple, set, frozenset)):
                triggers = set(auto)
                if not triggers <= set(depends):
                    raise ClosureError(module)
            else:
                triggers = set(depends) if auto else None
            owned = [dep for dep in depends if _owned(dep)]
            other = [dep for dep in depends if not _owned(dep)]
            return owned, other, triggers
    raise ClosureError(module)


def install_closure(addons_paths, selected):
    """Return the set of WebVue modules Odoo installs for ``selected``."""
    paths = [addons_paths] if isinstance(addons_paths, (str, Path)) else list(addons_paths)
    manifests = {}
    # Odoo addons the closure requires directly; Odoo installs them with it.
    required = {'base'}

    def resolve(names):
        pending = list(names)
        while pending:
            name = pending.pop()
            if name in manifests:
                continue
            manifests[name] = _read_manifest(paths, name)
            pending.extend(manifests[name][0])
            required.update(manifests[name][1])

    resolve(selected)
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
            if name in manifests:
                continue
            try:
                _owned_deps, _other_deps, auto = _read_manifest(paths, name)
            except ClosureError:
                continue
            if auto is not None and all(dep in manifests if _owned(dep) else dep in required for dep in auto):
                resolve([name])
                changed = True
    return set(manifests)


def install_order(addons_paths, selected):
    """WebVue modules of ``selected`` in dependency order: each module follows its
    WebVue dependencies, visited in selection then manifest order."""
    paths = [addons_paths] if isinstance(addons_paths, (str, Path)) else list(addons_paths)
    ordered = []

    def visit(name, stack):
        if name in ordered or name in stack:
            return
        for dependency in _read_manifest(paths, name)[0]:
            visit(dependency, (*stack, name))
        ordered.append(name)

    for name in selected:
        visit(name, ())
    return ordered
