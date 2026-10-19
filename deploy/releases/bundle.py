"""Independent Nitro bundles. Source provenance is supplied by the trusted operator."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from .assets import publish_assets
from .manifest import NAME


def _directory(value):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or path.resolve() != path:
        raise ValueError('bundle_path_rejected')
    return path


def _snapshot(root):
    files = {}
    def visit(directory, ancestors):
        resolved = directory.resolve()
        if resolved in ancestors or not resolved.is_relative_to(root):
            raise ValueError('bundle_link_rejected')
        for path in sorted(directory.iterdir()):
            target = path.resolve()
            if not target.is_relative_to(root): raise ValueError('bundle_link_rejected')
            if path.is_dir(): visit(path, ancestors | {resolved})
            elif path.is_file():
                files[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
            else: raise ValueError('bundle_entry_rejected')
    visit(root, set())
    return files


def prepare_bundle(source_output, releases_dir, release_id, source_digest):
    source, releases = _directory(source_output), _directory(releases_dir)
    if (not NAME.fullmatch(release_id) or not re.fullmatch(r'[a-f0-9]{64}', source_digest)
            or source == releases or source in releases.parents or releases in source.parents):
        raise ValueError('bundle_identity_rejected')
    before = _snapshot(source)
    if 'bundle.json' in before: raise ValueError('bundle_receipt_reserved')
    if 'server/index.mjs' not in before or not any(p.startswith('public/_nuxt/') and p.endswith('.js') for p in before):
        raise ValueError('bundle_incomplete')
    releases.mkdir(parents=True, exist_ok=True)
    with (releases / '.prepare.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        destination = releases / release_id
        if destination.exists(): raise ValueError('bundle_already_exists')
        stage = Path(tempfile.mkdtemp(prefix='.prepare-', dir=releases))
        try:
            shutil.copytree(source, stage, dirs_exist_ok=True, symlinks=False)
            copied = _snapshot(stage)
            if before != copied or before != _snapshot(source): raise ValueError('bundle_source_changed')
            # Existing append-only asset publication keeps prior release hashes available.
            assets = publish_assets(stage / 'public', releases / 'assets', release_id)
            receipt = {'schemaVersion': 1, 'releaseId': release_id, 'sourceDigest': source_digest,
                       'files': copied, 'assetsDigest': assets['sourceDigest']}
            (stage / 'bundle.json').write_text(json.dumps(receipt, sort_keys=True))
            for path in stage.rglob('*'):
                if path.is_file(): path.chmod(0o444 | (path.stat().st_mode & 0o111))
            os.rename(stage, destination)
            return receipt
        except BaseException:
            shutil.rmtree(stage)
            raise


def verify_bundle(bundle_dir, source_digest):
    root = _directory(bundle_dir)
    receipt = json.loads((root / 'bundle.json').read_text())
    if (set(receipt) != {'schemaVersion', 'releaseId', 'sourceDigest', 'files', 'assetsDigest'}
            or receipt['schemaVersion'] != 1 or receipt['releaseId'] != root.name
            or receipt['sourceDigest'] != source_digest):
        raise ValueError('bundle_identity_mismatch')
    files = _snapshot(root)
    files.pop('bundle.json', None)
    if files != receipt['files']: raise ValueError('bundle_content_mismatch')
    return receipt
