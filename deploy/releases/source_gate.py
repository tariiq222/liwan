"""Bind source classification to the exact local addon trees before admission closes."""
import hashlib
import json

from .manifest import _snapshot, classify_release
from .migrate import MARKER, _local, source_tree_digest
from .backup import _run
from .state import ReleaseConflict


def snapshot_digest(root):
    value = _snapshot(root)
    digest = hashlib.sha256()
    for name, content in sorted(value.items()):
        key = name.encode()
        digest.update(len(key).to_bytes(8, 'big')); digest.update(key)
        digest.update(len(content).to_bytes(8, 'big')); digest.update(content)
    return digest.hexdigest()


def installed_modules(binding, manifest, config):
    launcher, options = _local(binding, manifest, config)
    script = "env.cr.rollback()\nenv.cr.execute('SET TRANSACTION READ ONLY')\nimport json\nprint(" + repr(MARKER) + "+json.dumps(env['ir.module.module'].search([('state','=','installed')]).mapped('name')))\nenv.cr.rollback()\n"
    output = _run([*launcher, 'shell', *options, '--shell-interface=python'], config, input=script, read_only=True)
    rows = [json.loads(line[len(MARKER):]) for line in output.splitlines() if line.startswith(MARKER)]
    if len(rows) != 1 or not isinstance(rows[0], list) or not rows[0]:
        raise ReleaseConflict('installed_inventory_unverified')
    return rows[0]


def verify_sources(binding, manifest, gate, serving_manifest, serving_config, target_config):
    """A narrow Odoo bundle is accepted only for an Odoo-only release.

    Full product releases require a complete exported source tree. Neither scope
    suppresses unknown paths, and stock dependency manifests must be present.
    """
    if not isinstance(gate, dict) or gate.get('scope') not in {'product', 'odoo'}:
        raise ReleaseConflict('release_classification_required')
    if gate['scope'] == 'odoo' and set(manifest['affectedServices']) != {'odoo'}:
        raise ReleaseConflict('release_classification_scope_mismatch')
    evidence = manifest['compatibilityEvidence']
    for key, root_key in [('baseSourceDigest', 'baseRoot'), ('targetSourceDigest', 'targetRoot')]:
        if evidence.get(key) != snapshot_digest(gate[root_key]):
            raise ReleaseConflict('release_source_snapshot_changed')
    for root_key, config in [('baseRoot', serving_config), ('targetRoot', target_config)]:
        if source_tree_digest(gate[root_key]) != source_tree_digest(config['webvueRoot']):
            raise ReleaseConflict('release_addon_source_mismatch')
    names = installed_modules(binding, serving_manifest, serving_config)
    decision = classify_release(gate['baseRoot'], gate['targetRoot'], manifest, installed_modules=names)
    if not decision['eligible']:
        raise ReleaseConflict('release_classification_refused')
    return {'ready': True, **decision}
