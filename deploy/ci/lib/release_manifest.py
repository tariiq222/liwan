# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The release document ``deploy/ci/publish.sh`` signs for one commit.

Prints one JSON document, the predicate of the signed attestation::

    {"schemaVersion": 1, "commit": "<40 hex>", "release": <deploy/releases/manifest.py document>,
     "images": {"<reference>": "ghcr.io/<account>/<reference>@sha256:<digest>", ...}}

``release`` is validated by ``deploy.releases.manifest`` before anything is printed. The release
manifest format has fields a reviewer normally fills in, which CI cannot judge, so this document
is conservative: mode ``infrastructure_maintenance``, every LiwanOS module listed for upgrade, and
compatibility evidence that names this workflow run, not a human review. ``images`` carries every
published image, including the ones the release manifest format has no field for (proxy, AI egress,
mail relay).

Run from the repository root with ``PYTHONPATH=.``::

    python3 -B deploy/ci/lib/release_manifest.py --commit <sha> --run-id <id> --images images.json
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

from deploy.releases.manifest import validate_manifest

ROOT = Path(__file__).resolve().parents[3]
SCHEMA_VERSION = 1
# image reference -> key in the release manifest's `images` map (the format has no other keys).
MANIFEST_IMAGES = {'liwan-odoo': 'odoo', 'liwan-web': 'web', 'liwan-guard': 'guard', 'liwan-ai-service': 'ai'}
AFFECTED_SERVICES = ['odoo', 'web', 'guard', 'ai']
AI_STATE_VERSION = '1'
# The CI manifest carries no human review: it is valid only as the conservative maintenance-mode document
# (mode `infrastructure_maintenance`, `oldWritesCompatible: False`), never as evidence that a release is online-safe.
REVIEWER = 'unreviewed-ci'
IMAGE = re.compile(r'^ghcr\.io/[a-z0-9-]+/(liwan-[a-z0-9-]+)@sha256:[a-f0-9]{64}$')


def module_versions(addons_dir: Path) -> dict[str, str]:
    """The series-qualified version of every LiwanOS addon, read from its ``__manifest__.py``."""
    versions = {}
    for manifest in sorted(addons_dir.glob('*/__manifest__.py')):
        version = str(ast.literal_eval(manifest.read_text(encoding='utf-8')).get('version', '1.0'))
        versions[manifest.parent.name] = version if version.startswith('19.0.') else f'19.0.{version}'
    return versions


def release_document(commit: str, run_id: str, images: dict[str, str], odoo_commit: str,
                     versions: dict[str, str]) -> dict:
    """The predicate for one commit, with its release manifest validated."""
    for reference, image in images.items():
        match = IMAGE.match(image)
        if match is None or match.group(1) != reference:
            raise ValueError(f'{reference}: {image!r} is not ghcr.io/<account>/{reference}@sha256:<digest>')
    release = {
        'releaseId': f'r{commit[:12]}',
        'liwanCommit': commit,
        'odooCommit': odoo_commit,
        'images': {key: images[reference] for reference, key in MANIFEST_IMAGES.items()},
        'assetsId': f'assets-{commit[:12]}',
        'moduleVersions': versions,
        'upgradeModules': sorted(versions),
        'installModules': [],
        'mode': 'infrastructure_maintenance',
        'affectedServices': AFFECTED_SERVICES,
        'aiStateVersion': AI_STATE_VERSION,
        'compatibilityEvidence': {'reviewer': REVIEWER, 'reference': f'run-{run_id}'},
        'rollbackPolicy': {'oldWritesCompatible': False},
    }
    validate_manifest(release)
    return {'schemaVersion': SCHEMA_VERSION, 'commit': commit, 'release': release, 'images': images}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or '').split('\n', 1)[0])
    parser.add_argument('--commit', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--images', required=True, help='JSON file: reference -> registry image@digest')
    args = parser.parse_args(argv)
    images = json.loads(Path(args.images).read_text(encoding='utf-8'))
    document = release_document(
        args.commit, args.run_id, images,
        (ROOT / 'deploy/odoo/ODOO_COMMIT').read_text(encoding='utf-8').strip(),
        module_versions(ROOT / 'odoo-addons'),
    )
    sys.stdout.write(json.dumps(document, indent=2, sort_keys=True) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
