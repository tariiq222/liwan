# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Getting one artifact back: the newest complete one, and its verified plaintext.

A fetch authenticates the keyed manifest *before* the ciphertext is downloaded, compares
both digests before anything is trusted, and extracts the archive inside the destination
only. The result is the artifact's own tree — ``database.dump``, ``objects.index``,
``objects/`` and the snapshot manifest that pins them — with no ciphertext or extra plaintext
left beside it.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from deploy.backup import artifact
from deploy.backup.errors import BackupError, require
from deploy.backup.manifest import HALF_FIELDS, BackupManifest

if TYPE_CHECKING:
    from collections.abc import Callable

    from deploy.backup.store import ObjectStore


@dataclass(frozen=True)
class FetchedArtifact:
    """One artifact fetched, authenticated, decrypted and extracted."""

    ref: artifact.ArtifactRef
    manifest: BackupManifest
    manifest_sha256: str
    artifact_dir: Path


def latest_artifact(store: ObjectStore, tenant: str) -> artifact.ArtifactRef | None:
    """The newest complete artifact of either retention kind, or ``None``.

    The drill restores what a real incident would restore: the most recent complete capture,
    hourly or daily, whichever is younger. A ``candidate`` copy belongs to the operator who
    took it, not to the scheduled recovery stream, so it is never this artifact.
    """
    candidates = [
        ref
        for artifacts in artifact.footprints(store, tenant).values()
        for ref in artifacts
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda ref: ref.captured_at)


def newest_of_kind(store: ObjectStore, tenant: str, kind: str) -> artifact.ArtifactRef | None:
    """The newest complete artifact of one capture kind, for an operator fetching a candidate."""
    refs = artifact.footprints(store, tenant, kinds=(kind,)).get(kind, [])
    return refs[0] if refs else None


def fetch_artifact(
    store: ObjectStore,
    ref: artifact.ArtifactRef,
    destination: Path,
    *,
    passphrase_file: Path,
    runner: Callable[..., object] = subprocess.run,
) -> FetchedArtifact:
    """Fetch, verify, decrypt and extract one artifact into the new ``destination``.

    The manifest is authenticated first, its identity must match the key it was read from,
    and the ciphertext and plaintext digests must equal the ones it pinned. ``destination``
    must not exist: the call creates it and puts the artifact's tree in it.
    """
    require(destination.is_absolute(), 'the fetch destination must be an absolute path')
    require(not destination.exists(), f'the fetch destination already exists: {destination}')
    artifact.require_passphrase_file(passphrase_file)
    manifest_bytes = store.get(ref.manifest_key)
    manifest = BackupManifest.from_json(manifest_bytes, passphrase_file)
    require((manifest.tenant, manifest.kind, manifest.captured_at) == (ref.tenant, ref.kind, ref.captured_at),
            f'manifest identity does not match the artifact key: {ref.artifact_key}')
    destination.mkdir(mode=0o700)
    with tempfile.TemporaryDirectory(prefix='fetch-', dir=destination) as private:
        ciphertext = Path(private) / artifact.ARTIFACT_CIPHERTEXT_NAME
        store.get_file(ref.artifact_key, ciphertext, expected_size=manifest.ciphertext_bytes)
        require(artifact.sha256_file(ciphertext) == manifest.ciphertext_sha256,
                f'artifact {ref.artifact_key} does not match its manifest: ciphertext digest differs')
        archive = Path(private) / artifact.ARTIFACT_NAME
        plaintext_sha256 = artifact.decrypt_file(
            ciphertext, archive, passphrase_file=passphrase_file, runner=runner,
        )
        require(
            plaintext_sha256 == manifest.plaintext_sha256 and archive.stat().st_size == manifest.plaintext_bytes,
            f'artifact {ref.artifact_key} decrypted to bytes its manifest did not pin',
        )
        extracted = Path(private) / 'artifact'
        artifact.extract_archive(archive, extracted)
        _require_inner_manifest(extracted, manifest, ref.artifact_key)
        # The tree is moved out of the private directory in one step, so nothing plaintext
        # but the artifact itself survives the call.
        for member in sorted(extracted.iterdir()):
            member.rename(destination / member.name)
    return FetchedArtifact(
        ref=ref,
        manifest=manifest,
        manifest_sha256=artifact.sha256_bytes(manifest_bytes),
        artifact_dir=destination,
    )


def _require_inner_manifest(extracted: Path, outer: BackupManifest, artifact_key: str) -> None:
    """The snapshot manifest inside the archive must pin the same halves as the outer one."""
    inner_path = extracted / artifact.MANIFEST_NAME
    require(inner_path.is_file(), f'artifact {artifact_key} holds no snapshot manifest')
    try:
        inner = json.loads(inner_path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        raise BackupError(f'artifact {artifact_key} holds an unreadable snapshot manifest') from error
    require(isinstance(inner, dict), f'artifact {artifact_key} holds a malformed snapshot manifest')
    mismatched = [
        field_name for field_name in HALF_FIELDS
        if type(inner.get(field_name)) is not type(getattr(outer, field_name))
        or inner.get(field_name) != getattr(outer, field_name)
    ]
    require(
        not mismatched,
        f'artifact {artifact_key} inner manifest disagrees with the outer manifest on: '
        f'{", ".join(mismatched)}',
    )