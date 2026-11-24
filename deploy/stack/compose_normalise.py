# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Make a rendered compose document comparable across checkouts and across the stack's file moves."""
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


def normalise(document: dict, root: Path) -> dict:
    """The document with the checkout root replaced by ``<ROOT>``, moved files mapped and the project name dropped."""
    text = json.dumps({key: value for key, value in document.items() if key != 'name'}, sort_keys=True)
    text = text.replace(json.dumps(str(root))[1:-1], ROOT_TOKEN)
    for old, new in PATH_MAP.items():
        text = text.replace(f'{ROOT_TOKEN}/{old}', f'{ROOT_TOKEN}/{new}')
    return json.loads(text)
