# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The release document ``deploy/ci/publish.sh`` publishes for one commit, and the reader of it.

The document is one JSON file, ``/release.json``, the only file of the scratch image
``ghcr.io/tariiq222/liwan-release:<commit>``::

    {"schemaVersion": 1, "commit": "<40 hex>", "release": <deploy/release/manifest.py document>,
     "images": {"<reference>": "ghcr.io/tariiq222/<reference>@sha256:<digest>", ...},
     "platforms": {"<reference>": {"linux/arm64": "sha256:<digest>", ...}, ...}}

``release`` is validated by ``deploy.release.manifest`` before anything is printed. The release
manifest format has fields a reviewer normally fills in, which CI cannot judge, so this document
is conservative: mode ``infrastructure_maintenance``, every LiwanOS module listed for upgrade, and
compatibility evidence that names this workflow run, not a human review. ``images`` carries every
published image, including the ones the release manifest format has no field for (proxy, AI egress,
mail relay). ``platforms`` carries, for the same references, the digest of the image of each
architecture the document covers (``linux/arm64`` for every document the publish workflow writes); every
reference covers the same architectures, and a host pulls the image of its own architecture. The document has no signature: its trust is the registry write
credential and the GitHub ``release/*`` tag commit (on ``main``) it names (plan decision D17).

``parse_release_document`` is the one reader: the release command calls it on the text of
``/release.json`` and names the architectures it needs, so a document that lacks one is refused with
a message that says which.

Run from the repository root with ``PYTHONPATH=.``::

    python3 -B deploy/ci/lib/release_manifest.py --commit <sha> --run-id <id> --images images.json --platforms platforms.json

``--read <file> --commit <sha>`` instead validates an existing ``/release.json`` for that commit and prints its
``platforms`` map, which is how a rerun of a release tag finds out what the document already covers.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

from deploy.release.manifest import validate_manifest

ROOT = Path(__file__).resolve().parents[3]
SCHEMA_VERSION = 1
# image reference -> key in the release manifest's `images` map (the format has no other keys).
MANIFEST_IMAGES = {'liwan-odoo': 'odoo', 'liwan-web': 'web', 'liwan-guard': 'guard', 'liwan-ai-service': 'ai'}
AFFECTED_SERVICES = ['odoo', 'web', 'guard', 'ai']
AI_STATE_VERSION = '1'
# The CI manifest carries no human review: it is valid only as the conservative maintenance-mode document
# (mode `infrastructure_maintenance`, `oldWritesCompatible: False`), never as evidence that a release is online-safe.
REVIEWER = 'unreviewed-ci'
# The accepted vocabulary when READING: documents published before the arm64-only workflow also list linux/amd64.
PLATFORMS = ('linux/amd64', 'linux/arm64')
REGISTRY = 'ghcr.io/tariiq222'
COMMIT = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'sha256:[a-f0-9]{64}')
IMAGE = re.compile(re.escape(REGISTRY) + r'/(liwan-[a-z0-9-]+)@sha256:[a-f0-9]{64}')


def module_versions(addons_dir: Path) -> dict[str, str]:
    """The series-qualified version of every LiwanOS addon, read from its ``__manifest__.py``."""
    versions = {}
    for manifest in sorted(addons_dir.glob('*/__manifest__.py')):
        version = str(ast.literal_eval(manifest.read_text(encoding='utf-8')).get('version', '1.0'))
        versions[manifest.parent.name] = version if version.startswith('19.0.') else f'19.0.{version}'
    return versions


def validate_document(document: object, commit: str | None = None, required: tuple[str, ...] = ()) -> dict:
    """The document itself, or a ValueError that names the first thing wrong with it.

    ``commit`` is the commit the caller is deploying; ``required`` the platforms the host needs
    (for example ``('linux/arm64',)``): a document that lacks one is refused.
    """
    if not isinstance(document, dict) or document.get('schemaVersion') != SCHEMA_VERSION:
        raise ValueError(f'the release document is not a schemaVersion {SCHEMA_VERSION} object')
    named = document.get('commit')
    if not isinstance(named, str) or not COMMIT.fullmatch(named) or (commit is not None and named != commit):
        raise ValueError(f'the release document is for commit {named!r}, not {commit or "a 40-hex commit"}')
    release, images, platforms = document.get('release'), document.get('images'), document.get('platforms')
    if not isinstance(images, dict) or not images or not isinstance(platforms, dict) or not isinstance(release, dict):
        raise ValueError('the release document needs release, images and platforms')
    for reference, image in images.items():
        match = IMAGE.fullmatch(image) if isinstance(image, str) else None
        if match is None or match.group(1) != reference:
            raise ValueError(f'{reference}: {image!r} is not {REGISTRY}/{reference}@sha256:<digest>')
    if set(platforms) != set(images):
        raise ValueError(f'platforms must cover exactly the images: {sorted(set(platforms) ^ set(images))}')
    covered = None
    for reference, digests in platforms.items():
        if (not isinstance(digests, dict) or not digests or not set(digests) <= set(PLATFORMS)
                or not all(isinstance(digest, str) and DIGEST.fullmatch(digest) for digest in digests.values())):
            raise ValueError(f'{reference}: platforms are a non-empty subset of {", ".join(PLATFORMS)} with sha256 digests')
        covered = set(digests) if covered is None else covered
        if set(digests) != covered:
            raise ValueError(f'{reference}: covers {sorted(digests)} while the other images cover {sorted(covered)}')
    for reference, image in images.items():
        digests = set(platforms[reference].values())
        if not any(image.endswith('@' + digest) for digest in digests):
            raise ValueError(f'{reference}: {image} does not end with the digest of any of its platform images')
    for wanted in required:
        if wanted not in (covered or ()):
            raise ValueError(f'the release document has no {wanted} image (it covers {", ".join(sorted(covered or ())) or "nothing"})')
    for key, image in (release.get('images') or {}).items() if isinstance(release.get('images'), dict) else ():
        match = IMAGE.fullmatch(image) if isinstance(image, str) else None
        if match is None or MANIFEST_IMAGES.get(match.group(1)) != key or images.get(match.group(1)) != image:
            raise ValueError(f'release.images.{key}: {image!r} is not the {REGISTRY} image the document lists for it')
    if release.get('liwanCommit') != named:
        raise ValueError('the release manifest in the document is for another commit')
    validate_manifest(release)
    return document


def parse_release_document(text: str, commit: str | None = None, required: tuple[str, ...] = ()) -> dict:
    """Parse the text of ``/release.json`` and validate it (see ``validate_document``); ValueError on any fault."""
    try:
        document = json.loads(text)
    except ValueError as error:
        raise ValueError(f'the release document is not valid JSON: {error}') from None
    return validate_document(document, commit, required)


def release_document(commit: str, run_id: str, images: dict[str, str], platforms: dict[str, dict[str, str]],
                     odoo_commit: str, versions: dict[str, str]) -> dict:
    """The document for one commit, with its release manifest validated."""
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
    return validate_document(
        {'schemaVersion': SCHEMA_VERSION, 'commit': commit, 'release': release, 'images': images, 'platforms': platforms})


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or '').split('\n', 1)[0])
    parser.add_argument('--commit', required=True)
    parser.add_argument('--read', help='an existing /release.json: print its platforms map instead of writing a document')
    parser.add_argument('--run-id')
    parser.add_argument('--images', help='JSON file: reference -> registry image@digest')
    parser.add_argument('--platforms',
                        help='JSON file: reference -> {platform: digest}, the same platforms for every reference')
    args = parser.parse_args(argv)
    if args.read:
        document = parse_release_document(Path(args.read).read_text(encoding='utf-8'), args.commit)
        sys.stdout.write(json.dumps(document['platforms']) + '\n')
        return 0
    if not (args.run_id and args.images and args.platforms):
        parser.error('--run-id, --images and --platforms are required unless --read is given')
    images = json.loads(Path(args.images).read_text(encoding='utf-8'))
    platforms = json.loads(Path(args.platforms).read_text(encoding='utf-8'))
    document = release_document(
        args.commit, args.run_id, images, platforms,
        (ROOT / 'deploy/odoo/ODOO_COMMIT').read_text(encoding='utf-8').strip(),
        module_versions(ROOT / 'odoo-addons'),
    )
    sys.stdout.write(json.dumps(document, indent=2, sort_keys=True) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
