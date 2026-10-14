# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-version catalog source resolution by sha256 of the file bytes.

A published catalog row pins the digest of the exact bytes it was imported from.
Resolution therefore matches that digest against a registry of known source
files; no version label or file-name convention is trusted. Zero matches and
byte-identical duplicates are both refused.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOLUTIONS_DIR = ('deploy', 'catalog', 'solutions')
KNOWN_SOURCES = ('platform.json', 'platform_v2.json', 'platform_v3.json', 'platform_v4.json')
LEGACY_SOURCE = KNOWN_SOURCES[0]
_DIGEST = re.compile(r'(?:sha256:)?([0-9a-f]{64})')


class CatalogSourceError(ValueError):
    """Stable, non-secret code: ``catalog_source_unavailable`` or ``catalog_source_ambiguous``."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def known_paths(root: Path | None = None) -> list[Path]:
    base = Path(root or ROOT).joinpath(*SOLUTIONS_DIR)
    return [base / name for name in KNOWN_SOURCES]


def resolve_catalog_path(sha256: str, root: Path | None = None) -> Path:
    match = _DIGEST.fullmatch(sha256) if type(sha256) is str else None
    if match is None:
        raise CatalogSourceError('catalog_source_unavailable')
    wanted = match.group(1)
    found = []
    for path in known_paths(root):
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
        if digest == wanted:
            found.append(path)
    if len(found) > 1:
        raise CatalogSourceError('catalog_source_ambiguous')
    if not found:
        raise CatalogSourceError('catalog_source_unavailable')
    return found[0]


def resolve_catalog_bytes(sha256: str, root: Path | None = None) -> bytes:
    return resolve_catalog_path(sha256, root).read_bytes()
