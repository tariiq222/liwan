# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Make a rendered compose document comparable across checkouts, across the stack's file moves and across compose builds."""
from __future__ import annotations

import json
from pathlib import Path

ROOT_TOKEN = '<ROOT>'
# Files that moved with the one stack definition: the old rendered path becomes the new one.
PATH_MAP = {'deploy/shared/Caddyfile': 'deploy/stack/Caddyfile'}


def flatten(node, path: str = '') -> dict[str, object]:
    """Map every leaf of a rendered compose document to its dotted path."""
    if isinstance(node, dict):
        return {leaf: value for key, child in node.items() for leaf, value in flatten(child, f'{path}.{key}' if path else key).items()}
    if isinstance(node, list):
        return {leaf: value for index, child in enumerate(node) for leaf, value in flatten(child, f'{path}[{index}]').items()}
    return {path: node}


def drop_version_defaults(document: dict) -> dict:
    """Remove the leaves the compose build itself decides to print or omit, and a ``bind`` object left empty.

    Compose prints ``bind.create_host_path`` by its own version rather than by the document: up to compose-go v2.7
    (Compose 2.38, the CI runner) it is a plain bool tagged ``omitempty``, so that version prints the default ``true``
    of every short-syntax bind and drops an explicit ``false``; from compose-go v2.14 (Compose 5) it is an ``OptOut``
    tagged ``omitzero``, so the default is dropped and an explicit ``false`` is printed. Neither build prints both, so
    the leaf is not compared here. ``compose.yml`` states ``create_host_path: false`` on the mounts that must fail
    instead of creating a host path, and ``test_render.RenderedStack`` asserts it on the rendered file for every build.
    """
    for service in (document.get('services') or {}).values():
        for mount in service.get('volumes') or []:
            if isinstance(mount, dict) and isinstance(mount.get('bind'), dict):
                mount['bind'].pop('create_host_path', None)
                if not mount['bind']:
                    del mount['bind']
    return document


def normalise(document: dict, root: Path) -> dict:
    """The document with the checkout root replaced by ``<ROOT>``, moved files mapped, the project name dropped and the
    leaves the compose build decides (``drop_version_defaults``) removed."""
    text = json.dumps({key: value for key, value in document.items() if key != 'name'}, sort_keys=True)
    text = text.replace(json.dumps(str(root))[1:-1], ROOT_TOKEN)
    for old, new in PATH_MAP.items():
        text = text.replace(f'{ROOT_TOKEN}/{old}', f'{ROOT_TOKEN}/{new}')
    return drop_version_defaults(json.loads(text))
