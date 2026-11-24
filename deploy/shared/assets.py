"""Append-only release asset publication, with exact byte/tree receipts.

No image/source provenance is fabricated. The operator supplies a completed,
immutable public directory; hashed names follow Nuxt/Vite build conventions.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid

RELEASE_ID = re.compile(r'^[a-z][a-z0-9_-]{0,62}$')
HASH = re.compile(r'^(?:[A-Za-z0-9_-]{8}|[a-f0-9]{10,64})$')
COMPONENT = re.compile(r'^[A-Za-z0-9_.-]+$')
FONTS = {'.woff', '.woff2', '.ttf', '.otf'}


def _canonical(value):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or path.resolve() != path:
        raise ValueError('asset_path_rejected')
    return path


def _sync(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def _mkdir(path):
    _canonical(path)
    if path.exists():
        if not path.is_dir() or path.is_symlink(): raise ValueError('asset_path_rejected')
        return
    if not path.parent.exists(): _mkdir(path.parent)
    path.mkdir(mode=0o755)
    _sync(path.parent)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _asset_kind(relative):
    parts = relative.parts
    if not parts or any(part in {'.', '..'} or not COMPONENT.fullmatch(part) for part in parts):
        raise ValueError('asset_name_rejected')
    suffix = relative.suffix.lower()
    if parts[0] == 'fonts' and suffix in FONTS:
        return False
    if parts[0] not in {'_nuxt', '_i18n'}: return None
    if (parts[:3] == ('_nuxt', 'builds', 'meta') and len(parts) == 4
            and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json', parts[3])):
        return True  # Nuxt unique build identity; collisions remain forbidden.
    stem = relative.name.rsplit('.', 1)[0]
    filename_hashed = bool(HASH.fullmatch(stem.rsplit('.', 1)[-1]))
    ancestor_hashed = any(HASH.fullmatch(part) for part in parts[1:-1])
    if suffix in {'.js', '.mjs', '.css'} and filename_hashed:
        return True
    if suffix == '.json' and (filename_hashed or ancestor_hashed) and ('i18n' in '/'.join(parts).lower()):
        return True
    return None


def _snapshot(source):
    if not source.is_dir(): raise ValueError('asset_source_rejected')
    files = {}
    for directory, folders, names in os.walk(source, followlinks=False):
        folders.sort()
        for name in [*folders, *names]:
            path = Path(directory) / name
            if path.is_symlink(): raise ValueError('asset_source_rejected')
        for name in sorted(names):
            path = Path(directory) / name
            info = path.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_size > 64 * 1024 * 1024:
                raise ValueError('asset_source_rejected')
            relative = path.relative_to(source)
            _asset_kind(relative)  # Reject unsafe names even on unsupported files.
            files[relative.as_posix()] = path.read_bytes()
    return files


def _existing(path):
    _canonical(path)
    if not path.exists(): return None
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode): raise ValueError('asset_path_rejected')
        return source.read()


def _publish_file(path, data):
    """Link a fully fsynced temporary inode atomically, never overwrite a name."""
    _mkdir(path.parent)
    existing = _existing(path)
    if existing is not None:
        if existing != data: raise ValueError('asset_collision')
        return
    temporary = path.parent / ('.asset-' + uuid.uuid4().hex + '.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(data); output.flush(); os.fsync(output.fileno())
        try: os.link(temporary, path)
        except FileExistsError:
            if _existing(path) != data: raise ValueError('asset_collision') from None
        _sync(path.parent)
    finally:
        temporary.unlink()
        _sync(path.parent)


def publish_assets(sourcePublicDir, assetStoreDir, releaseId):
    """Publish retained JS/CSS/i18n/font bytes; preserve every earlier artifact.

    Complete per-release index is written last. Stable fonts may only repeat
    identical bytes and never receive immutable caching. Unsupported public files
    are listed, included in sourceDigest, and never silently copied/claimed.
    """
    try:
        if not isinstance(releaseId, str) or not RELEASE_ID.fullmatch(releaseId): raise ValueError()
        source, store = _canonical(sourcePublicDir), _canonical(assetStoreDir)
        if source == store or source in store.parents or store in source.parents: raise ValueError()
        files = _snapshot(source)
        assets, unsupported = {}, []
        digest = hashlib.sha256()
        for name, data in sorted(files.items()):
            encoded = name.encode()
            digest.update(len(encoded).to_bytes(8, 'big')); digest.update(encoded)
            digest.update(len(data).to_bytes(8, 'big')); digest.update(data)
            kind = _asset_kind(Path(name))
            if kind is None: unsupported.append('/' + name)
            else: assets['/' + name] = {'sha256': _sha(data), 'size': len(data), 'immutable': kind}
        receipt = {'schemaVersion': 1, 'releaseId': releaseId, 'sourceDigest': digest.hexdigest(),
                   'assets': assets, 'unsupported': unsupported}
        encoded = (json.dumps(receipt, sort_keys=True, separators=(',', ':')) + '\n').encode()
        index = store / 'releases' / (releaseId + '.json')
        previous = _existing(index)
        if previous is not None and previous != encoded: raise ValueError('asset_release_conflict')
        # Preflight all collisions before publishing any part of the candidate.
        for url in assets:
            existing = _existing(store / url.lstrip('/'))
            if existing is not None and existing != files[url.lstrip('/')]: raise ValueError('asset_collision')
        _mkdir(store)
        for url in assets: _publish_file(store / url.lstrip('/'), files[url.lstrip('/')])
        _publish_file(index, encoded)
        return receipt
    except (OSError, TypeError, ValueError):
        raise ValueError('asset_publication_rejected') from None
