# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The bucket half of one backup: every object, indexed, copied out and written back.

A tenant's files live in an OCI bucket, not in a directory on the host, so the half a
capture copies is a listing plus the bytes behind it. :class:`BucketSource` is that
boundary and nothing more: the three operations a capture and a restore need, injected, so
the rule about what a complete copy is can be proven without a network or a credential.

The index is the digest of the copy: one ``<sha256>  <key>`` line per object, sorted by
key, which is the ``snapshot`` tree-digest convention applied to object keys. In the sorted
archive it travels after ``database.dump``, ``manifest.json`` and the ``objects`` directory
entry, and before every object under ``objects/``, so a streaming reader knows every object
it must find before it reads one byte of them.

A shortfall is a refusal, never a warning: a key the listing names but the bucket no longer
holds, a size that differs from the listing, a key named twice, or a key that could leave
the root raises :class:`deploy.backup.errors.BackupError`. :func:`populate` reads every
object back after writing it, because a write that returned is not proof the object arrived.

No credential lives in this module or in anything it returns: a source holds the key and
the bucket name, while only object keys, counts and digests come out of it.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from deploy import s3_client
from deploy.backup.artifact import (
    CONTENTS_MEMBER,
    OBJECTS_DIRECTORY,
    sha256_bytes,
    sha256_file,
)
from deploy.backup.errors import BackupError, require
from deploy.backup.manifest import SHA256_RE, is_non_negative_int, require_half_digest

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

INDEX_LINE_SEPARATOR = '  '
# A write opens its parent and its target without following a link: an object is a plain
# file at a key, and a link at either place would write outside the root.
NO_FOLLOW = getattr(os, 'O_NOFOLLOW', 0)
DIRECTORY_FLAGS = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | NO_FOLLOW


@dataclass(frozen=True)
class ObjectMeta:
    """One object of a bucket listing: its key and the size the source reported."""

    key: str
    size: int


class BucketSource(Protocol):
    """The object operations a capture and a restore need, and nothing else."""

    def list(self, prefix: str) -> list[ObjectMeta]: ...

    def get_file(self, key: str, target: Path) -> None: ...

    def put_file(self, key: str, source: Path) -> None: ...


@dataclass(frozen=True)
class BucketManifest:
    """What one copied bucket half is: its index, the index digest, the objects and their bytes.

    ``index`` is the exact ``objects.index`` content, built from the bytes on disk after the
    copy, so the digest describes what was copied rather than what the listing promised. It
    carries every object key, because a restore needs them; it carries no bucket name,
    credential or access key, and :meth:`payload` never grows one.
    """

    index: bytes
    index_sha256: str
    object_count: int
    object_bytes: int

    def payload(self) -> dict[str, object]:
        return {
            'contents_sha256': self.index_sha256,
            'contents_object_count': self.object_count,
            'contents_object_bytes': self.object_bytes,
        }


class DirectoryBucket:
    """A directory as a bucket: the same object keys, on the host.

    A tenant whose files still live in ``<data_dir>/filestore/<db>`` already has the
    bucket's key layout on disk, so the operator's one-off copy reads the same three
    operations without a network. A symlink or a special file is refused for the same
    reason the archive refuses one: a restore cannot reproduce it.
    """

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)

    def list(self, prefix: str) -> list[ObjectMeta]:
        return [meta for meta in list_tree(self._root) if meta.key.startswith(prefix)]

    def get_file(self, key: str, target: Path) -> None:
        shutil.copyfile(self._path(key), target)

    def put_file(self, key: str, source: Path) -> None:
        """Write a new object without following a symlink at the target or at any parent."""
        parts = object_key_parts(key)
        parent = _open_parent(self._root, parts)
        try:
            _write_new_object(parts[-1], parent, source, key)
        finally:
            os.close(parent)

    def _path(self, key: str) -> Path:
        return self._root.joinpath(*object_key_parts(key))


def require_object_key(key: str) -> str:
    """A relative, index-safe object path, sharing :func:`deploy.s3_client.relative_key_parts`.

    A control character is refused without echoing it: the index is one line per object, so
    a key carrying a newline would close that line and forge another, and a tab or a NUL
    would make a key no longer name the bytes it holds.
    """
    object_key_parts(key)
    return key


def object_key_parts(key: str) -> tuple[str, ...]:
    """The path components of a validated object key."""
    require(isinstance(key, str) and bool(key), 'object key must be a relative object path')
    require(
        not _has_control_character(key),
        'object key must not carry a control character (newline, carriage return, tab or other)',
    )
    try:
        parts = s3_client.relative_key_parts(key)
    except s3_client.StorageError:
        raise BackupError('object key must be a relative object path') from None
    require(
        INDEX_LINE_SEPARATOR not in key,
        'object key must not contain the two spaces the index uses as its separator',
    )
    return parts


def _has_control_character(key: str) -> bool:
    return any(character < ' ' or character == '\x7f' for character in key)


def _open_parent(root: Path, parts: Sequence[str]) -> int:
    """Open the object's parent directory, refusing a symlink anywhere on the way."""
    try:
        descriptor = os.open(root, DIRECTORY_FLAGS)
    except OSError:
        raise BackupError('the object root is not a directory this run may write') from None
    try:
        for part in parts[:-1]:
            try:
                os.mkdir(part, mode=0o700, dir_fd=descriptor)
            except FileExistsError:
                pass
            except OSError:
                raise BackupError('a parent directory of the object key cannot be created') from None
            try:
                child = os.open(part, DIRECTORY_FLAGS, dir_fd=descriptor)
            except OSError:
                raise BackupError(
                    'a parent of the object key is a symlink or not a directory',
                ) from None
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _write_new_object(name: str, parent: int, source: Path, key: str) -> None:
    """Create one new object, refusing an existing name and a link at that name."""
    try:
        descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NO_FOLLOW, 0o600,
                             dir_fd=parent)
    except OSError:
        raise BackupError(
            f'object already written or not a plain new file (symlink or directory): {key}',
        ) from None
    try:
        with os.fdopen(descriptor, 'wb') as target, source.open('rb') as incoming:
            shutil.copyfileobj(incoming, target)
    except BaseException:
        try:
            os.unlink(name, dir_fd=parent)
        except OSError:
            pass
        raise


def require_objects(objects: Sequence[ObjectMeta]) -> list[ObjectMeta]:
    """The listing as a key-sorted list, or a refusal for a duplicate, colliding or malformed entry."""
    seen: set[str] = set()
    ordered: list[ObjectMeta] = []
    for meta in objects:
        require(isinstance(meta, ObjectMeta), 'a bucket listing yields ObjectMeta only')
        require_object_key(meta.key)
        require(
            is_non_negative_int(meta.size),
            f'object size must be a non-negative integer: {meta.key}',
        )
        require(meta.key not in seen, f'bucket listing names the same object twice: {meta.key}')
        seen.add(meta.key)
        ordered.append(meta)
    ordered.sort(key=lambda meta: meta.key)
    for meta in ordered:
        parts = meta.key.split('/')
        for depth in range(1, len(parts)):
            ancestor = '/'.join(parts[:depth])
            require(
                ancestor not in seen,
                f'bucket listing has both an object and a path under it: {ancestor} and {meta.key}',
            )
    return ordered


def index_bytes(objects: Sequence[ObjectMeta], digests: Mapping[str, str]) -> bytes:
    """``<object sha256>  <key>`` per object, sorted by key: the tree-digest convention."""
    lines: list[bytes] = []
    for meta in require_objects(objects):
        digest = digests.get(meta.key)
        require(
            isinstance(digest, str) and bool(SHA256_RE.fullmatch(digest)),
            f'the index needs a lowercase SHA-256 digest for every object: {meta.key}',
        )
        lines.append(digest.encode('ascii') + INDEX_LINE_SEPARATOR.encode('ascii')
                     + os.fsencode(meta.key) + b'\n')
    return b''.join(lines)


def totals(objects: Sequence[ObjectMeta]) -> tuple[int, int]:
    """The object count and the sum of their sizes."""
    ordered = require_objects(objects)
    return len(ordered), sum(meta.size for meta in ordered)


def list_tree(root: Path) -> list[ObjectMeta]:
    """Every object under a directory that holds them by key, key-sorted.

    A symlink is refused: an object a restore cannot reproduce is not one this package
    copies, and a link can point at bytes outside the tree.
    """
    require(root.is_dir(), f'the object tree must be an existing directory: {root}')
    objects: list[ObjectMeta] = []
    for directory, subdirectories, names in os.walk(root, onerror=_unreadable_directory):
        for name in (*subdirectories, *names):
            path = Path(directory, name)
            relative = path.relative_to(root).as_posix()
            require(not path.is_symlink(), f'the object tree holds a symlink: {relative}')
            require(
                path.is_dir() or path.is_file(),
                f'the object tree holds a special file: {relative}',
            )
        for name in names:
            path = Path(directory, name)
            objects.append(ObjectMeta(key=path.relative_to(root).as_posix(), size=path.stat().st_size))
    return require_objects(objects)


def tree_manifest(root: Path) -> BucketManifest:
    """The manifest of a directory holding objects by key, computed from its bytes."""
    objects = list_tree(root)
    digests = {meta.key: sha256_file(root.joinpath(*meta.key.split('/'))) for meta in objects}
    index = index_bytes(objects, digests)
    count, total = totals(objects)
    return BucketManifest(
        index=index,
        index_sha256=sha256_bytes(index),
        object_count=count,
        object_bytes=total,
    )


def copy_out(source: BucketSource | None, destination: Path) -> BucketManifest:
    """Read every object of the bucket into ``destination`` and write its index.

    ``source=None`` is the control plane's database-only source: it has no bucket, so its
    contents half is the empty index, written the same way so every artifact has one shape.

    ``destination`` must be an existing directory this run owns. Every object the listing
    names is read, its size checked against the listing, and the index built from the bytes
    that landed: an object that shrank, moved or disappeared between listing and read is a
    refusal, and no index is written for a copy that is short.
    """
    require(destination.is_absolute(), 'the object directory must be an absolute path')
    require(destination.is_dir(), 'the object directory must be an existing directory')
    require(
        not (destination / CONTENTS_MEMBER).exists()
        and not (destination / OBJECTS_DIRECTORY).exists(),
        'the object directory already holds a copy; refusing to overwrite',
    )
    listing = [] if source is None else require_objects(_list(source, ''))
    objects_root = destination / OBJECTS_DIRECTORY
    objects_root.mkdir(mode=0o700)
    for meta in listing:
        target = objects_root.joinpath(*meta.key.split('/'))
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        _get(source, meta.key, target)
        require(
            target.is_file() and not target.is_symlink(),
            f'the bucket returned no regular file for {meta.key}',
        )
        require(
            target.stat().st_size == meta.size,
            f'bucket object size differs from the listing: {meta.key}',
        )
    copied = tree_manifest(objects_root)
    require(
        (copied.object_count, copied.object_bytes) == totals(listing),
        'the copied objects are not the ones the bucket listed',
    )
    (destination / CONTENTS_MEMBER).write_bytes(copied.index)
    return copied


def compare(index: bytes, root: Path) -> list[str]:
    """Every object the index pins that ``root`` lacks or holds different, and every extra one.

    ``root`` is the objects directory a fetch or a restore wrote. An object the index does
    not name is listed too: the count and the digest of the tree are then no longer what the
    manifest pinned, so a restore of it is not the copy the operator was promised.
    """
    short, extra = _differences(index, root)
    return sorted(short + extra)


def _differences(index: bytes, root: Path) -> tuple[list[str], list[str]]:
    """The keys the index names that ``root`` lacks or holds different, and the extra keys."""
    expected = parse_index(index)
    found = {
        meta.key: sha256_file(root.joinpath(*meta.key.split('/')))
        for meta in list_tree(root)
    }
    short = sorted(key for key, digest in expected.items() if found.get(key) != digest)
    extra = sorted(key for key in found if key not in expected)
    return short, extra


def parse_index(index: bytes) -> dict[str, str]:
    """The object digests an index names, or a refusal for a malformed, repeated or forged line.

    Every line is exactly ``<64 lowercase hex>  <key>`` with a control-free key, the shape
    the writer produces. A reader that accepted anything looser would let a key carrying a
    newline pass as two ordinary objects.
    """
    if not index:
        return {}
    malformed = f'{CONTENTS_MEMBER} is malformed: one <sha256>  <key> line per object'
    require(index.endswith(b'\n'), malformed)
    separator = INDEX_LINE_SEPARATOR.encode('ascii')
    digests: dict[str, str] = {}
    for line in index.split(b'\n')[:-1]:
        fields = line.split(separator)
        require(
            len(fields) == 2
            and bool(fields[0])
            and bool(fields[1])
            and bool(SHA256_RE.fullmatch(fields[0].decode('ascii', 'replace'))),
            malformed,
        )
        digest, decoded = fields[0].decode('ascii'), os.fsdecode(fields[1])
        require_object_key(decoded)
        require(decoded not in digests, f'{CONTENTS_MEMBER} names the same object twice: {decoded}')
        digests[decoded] = digest
    return digests


def populate(source_root: Path, target: BucketSource, expected_sha256: str) -> None:
    """Write an extracted artifact's objects into the bucket, then read each one back.

    The local half is checked first: ``objects.index`` must match ``expected_sha256`` from
    the pinned manifest before a single write, an artifact that is short of the objects its
    own index names is refused, and an object the index does not name is refused as its own
    defect. A read-back that differs from the bytes written is a failure, because a
    successful write is not proof the object arrived.
    """
    require(source_root.is_absolute() and source_root.is_dir(),
            'populate needs the absolute path of an extracted artifact')
    require_half_digest(expected_sha256, 'expected_sha256')
    index_path = source_root / CONTENTS_MEMBER
    objects_root = source_root / OBJECTS_DIRECTORY
    require(index_path.is_file() and not index_path.is_symlink(), f'the artifact holds no {CONTENTS_MEMBER}')
    require(objects_root.is_dir(), f'the artifact holds no {OBJECTS_DIRECTORY} directory')
    index = index_path.read_bytes()
    require(
        sha256_bytes(index) == expected_sha256,
        f'{CONTENTS_MEMBER} digest does not match the pinned manifest digest',
    )
    short, extra = _differences(index, objects_root)
    require(
        not short,
        f'the artifact is short of the objects its index names: {", ".join(short)}',
    )
    require(
        not extra,
        f'the artifact holds objects its index does not name: {", ".join(extra)}',
    )
    digests = parse_index(index)
    with tempfile.TemporaryDirectory(prefix='bucket-readback-') as scratch:
        readback = Path(scratch) / 'object'
        for key in sorted(digests):
            _put(target, key, objects_root.joinpath(*key.split('/')))
            _get(target, key, readback)
            require(
                readback.is_file() and sha256_file(readback) == digests[key],
                f'the object read back from the bucket is not the one written: {key}',
            )
            readback.unlink()


def _list(source: BucketSource, prefix: str) -> list[ObjectMeta]:
    try:
        return source.list(prefix)
    except s3_client.StorageError as error:
        raise BackupError(f'the bucket listing failed: {error}') from None


def _get(source: BucketSource, key: str, target: Path) -> None:
    try:
        source.get_file(key, target)
    except s3_client.StorageError as error:
        raise BackupError(f'the bucket did not return {key}: {error}') from None


def _put(target: BucketSource, key: str, source: Path) -> None:
    try:
        target.put_file(key, source)
    except s3_client.StorageError as error:
        raise BackupError(f'the bucket refused {key}: {error}') from None


def _unreadable_directory(error: OSError) -> None:
    raise BackupError(f'the object tree cannot be read: {error.filename}: {error.strerror}')
