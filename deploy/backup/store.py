# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The object store a capture writes to: one protocol, two backends.

The store is the only boundary the backup package does not implement: :mod:`deploy.s3_client`
owns the bucket and its credentials. A filesystem store is what an operator and every
offline test use, and it behaves like the bucket: a key that exists is never overwritten,
and a download is checked against the size the manifest pinned.
"""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from deploy import s3_client

if TYPE_CHECKING:
    from collections.abc import Mapping


class ObjectStore(Protocol):
    """The file and metadata operations both stores share."""

    def put(self, key: str, data: bytes) -> None: ...

    def get(self, key: str) -> bytes: ...

    def put_file(self, key: str, source: Path) -> None: ...

    def get_file(self, key: str, target: Path, *, expected_size: int) -> None: ...

    def head(self, key: str) -> int: ...

    def list(self, prefix: str) -> list[str]: ...

    def delete(self, key: str) -> None: ...


def build_store(store_root: Path | None, environ: Mapping[str, str]) -> ObjectStore:
    """A filesystem store when asked for one, otherwise the S3 bucket from the environment."""
    if store_root is not None:
        return s3_client.FilesystemStore(store_root)
    return s3_client.S3Store(s3_client.Credentials.from_environment(environ))
