# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""How an artifact is named, laid out, archived and encrypted.

One artifact is one restorable unit: ``database.dump`` and ``filestore/`` inside one
reproducible PAX archive, encrypted with ``aes-256-cbc-pbkdf2`` and written under
``<tenant>/<kind>/<UTC stamp>/``.

The secret reaches ``openssl`` only as ``-pass file:<path>``, never as an argument or an
environment variable, so it cannot be read from a process listing or a shell history.
The passphrase file must be an absolute path with mode 0600 or 0400, must hold one line
within the OpenSSL size limit, and an existing output file is never overwritten.
"""
from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from deploy.backup.dump import run_checked
from deploy.backup.errors import BackupError, require
from deploy.backup.manifest import (
    BACKUP_KINDS,
    CAPTURE_KINDS,
    STAMP_FORMAT,
    as_utc,
    parse_stamp,
    require_kind,
    require_tenant,
)

if TYPE_CHECKING:
    from datetime import datetime

    from collections.abc import Callable, Mapping, Sequence

    from deploy.backup.store import ObjectStore

ARTIFACT_NAME = 'artifact.tar'
ARTIFACT_CIPHERTEXT_NAME = 'artifact.tar.enc'
MANIFEST_NAME = 'manifest.json'
CHECKSUMS_NAME = 'checksums.sha256'
CHECKSUM_LINE_SEPARATOR = '  '
OPENSSL_BINARY = 'openssl'
PASSPHRASE_ENVIRONMENT_VARIABLE = 'LIWAN_BACKUP_PASSPHRASE_FILE'
ALLOWED_PASSPHRASE_MODES = (0o600, 0o400)
# The shortest passphrase this package accepts. openssl itself would accept an empty
# passphrase; refusing it here is what keeps "encrypted" from meaning nothing.
MINIMUM_PASSPHRASE_BYTES = 16
MAXIMUM_PASSPHRASE_BYTES = 1022
HASH_BLOCK_BYTES = 1024 * 1024


@dataclass(frozen=True)
class ArtifactRef:
    """One complete artifact already in the store, addressed by the key layout."""

    tenant: str
    kind: str
    captured_at: datetime
    artifact_key: str
    manifest_key: str

    @property
    def prefix(self) -> str:
        return self.artifact_key.rsplit('/', 1)[0] + '/'


def sha256_file(path: Path) -> str:
    """The digest of a file's bytes, streamed so a large dump is never held in memory."""
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        while block := handle.read(HASH_BLOCK_BYTES):
            digest.update(block)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    """The digest of bytes already in memory, for a manifest or an uploaded listing."""
    return hashlib.sha256(data).hexdigest()


def artifact_prefix(tenant: str, kind: str, captured_at: datetime) -> str:
    """``<tenant>/<kind>/<UTC stamp>/``: the one place the key layout is written."""
    require_tenant(tenant)
    require_kind(kind)
    return f'{tenant}/{kind}/{as_utc(captured_at).strftime(STAMP_FORMAT)}/'


def kind_of(tenant: str, key: str) -> tuple[str, datetime] | None:
    """Split ``<tenant>/<kind>/<stamp>/<name>`` into its kind and capture time.

    Every capture kind is recognised, so an operator's ``candidate`` copy is found when it
    is asked for; which kinds an operation acts on is the caller's ``kinds``, not this split.
    """
    parts = key.split('/')
    if len(parts) != 4 or parts[0] != tenant or parts[1] not in CAPTURE_KINDS:
        return None
    try:
        return parts[1], parse_stamp(parts[2])
    except BackupError:
        return None


def footprints(store: ObjectStore, tenant: str, *, kinds: Sequence[str] = BACKUP_KINDS) -> dict[str, list[ArtifactRef]]:
    """Every complete artifact of the requested kinds, newest first inside each kind.

    The manifest is uploaded last, so only an artifact whose manifest exists counts:
    ciphertext whose manifest upload failed is a partial capture. It is neither a restore
    candidate nor a copy that justifies pruning an older complete one.

    The default is the two retention kinds, so retention and the drill never see an
    operator's ``candidate`` copy; asking for that kind is how a fetch gets it back.
    """
    require_tenant(tenant)
    for kind in kinds:
        require_kind(kind)
    keys = set(store.list(f'{tenant}/'))
    found: dict[str, dict[str, ArtifactRef]] = {kind: {} for kind in kinds}
    for key in keys:
        split = kind_of(tenant, key)
        if split is None or not key.endswith('/' + ARTIFACT_CIPHERTEXT_NAME):
            continue
        kind, captured_at = split
        if kind not in found:
            continue
        prefix = key.rsplit('/', 1)[0] + '/'
        if prefix + MANIFEST_NAME not in keys:
            continue
        found[kind][prefix] = ArtifactRef(
            tenant=tenant,
            kind=kind,
            captured_at=captured_at,
            artifact_key=key,
            manifest_key=prefix + MANIFEST_NAME,
        )
    return {
        kind: sorted(refs.values(), key=lambda ref: ref.captured_at, reverse=True)
        for kind, refs in found.items()
    }


def checksums(digests: Sequence[str], object_names: Sequence[str]) -> str:
    """``sha256sum -c`` compatible: two spaces between digests and object names."""
    return ''.join(
        f'{digest}{CHECKSUM_LINE_SEPARATOR}{name}\n'
        for digest, name in zip(digests, object_names)
    )


def archive_snapshot(source_dir: Path, target_tar: Path) -> str:
    """Write one reproducible archive of a snapshot tree and return its digest.

    The tree holds ``database.dump`` and ``filestore/``, so one artifact is one restorable
    unit: a restore needs both or neither. Every name is sorted and every header field is
    fixed (mode, uid, gid, uname, gname, mtime), so the same input produces the same bytes
    and the manifest digest is a fact about the data.

    The standard library writes the archive on purpose: the ``tar`` on an operator's
    machine is bsdtar, which rejects ``--sort=name`` and ``--mtime``, so a shell-out could
    not promise the fixed metadata this function promises.

    The format is PAX, not USTAR: USTAR's octal size field overflows at 8 GiB and its name
    fields at 256 bytes, and a tenant's dump or filestore can pass either. PAX writes a
    header record only for a member that needs one, so an ordinary tree is still
    byte-for-byte reproducible, and ``tarfile`` reads every format.
    """
    require(source_dir.is_absolute(), 'the archive source must be an absolute path')
    require(source_dir.is_dir(), 'the archive source must be an existing directory')
    _fresh_path(target_tar, 'archive')
    members = _archive_members(source_dir)
    require(bool(members), 'the archive source holds nothing to capture')
    with tarfile.open(target_tar, 'w', format=tarfile.PAX_FORMAT) as archive:
        for relative, path, is_directory in members:
            _add_member(archive, relative, path, is_directory)
    return sha256_file(target_tar)


def extract_archive(archive: Path, destination: Path) -> None:
    """Extract an artifact inside ``destination`` and nowhere else."""
    destination.mkdir(mode=0o700)
    root = destination.resolve()
    with tarfile.open(archive, 'r') as bundle:
        for member in bundle.getmembers():
            target = (root / member.name).resolve()
            require(
                target == root or root in target.parents,
                f'the artifact holds a member outside the restore directory: {member.name}',
            )
            # `data` is the only filter that matches this check and also refuses links,
            # devices and absolute names on its own, so a member cannot be written outside
            # the root even if the check above changed. Naming it explicitly also silences
            # Python 3.12's pending-default warning, which would otherwise reach the
            # command line's stderr.
            require(not (member.issym() or member.islnk() or member.isdev()),
                    f'the artifact holds a link or device member: {member.name}')
        _extract_all(bundle, destination)


def _extract_all(bundle: tarfile.TarFile, destination: Path) -> None:
    """Extract with the ``data`` filter where it exists (3.12+), else the checked members.

    Every member was proven to sit inside the destination above, so the 3.9 path is safe;
    the ``data`` filter additionally refuses links, devices and absolute names on its own,
    and naming it silences 3.12's pending-default warning.
    """
    if hasattr(tarfile, 'data_filter'):
        bundle.extractall(destination, filter='data')
    else:
        bundle.extractall(destination)


def openssl_argv(
    source: Path,
    destination: Path,
    passphrase_file: Path,
    *,
    decrypt: bool,
) -> list[str]:
    """The exact openssl invocation: the secret is a file path, never an argument.

    ``-pass file:<path>`` is the only form used. ``-pass pass:``/``env:``/``fd:`` would put
    the secret somewhere it can be read from a process listing or a shell history, so this
    function cannot produce them.
    """
    return [
        OPENSSL_BINARY,
        'enc',
        *(['-d'] if decrypt else []),
        '-aes-256-cbc',
        '-pbkdf2',
        '-salt',
        '-in',
        str(source),
        '-out',
        str(destination),
        '-pass',
        f'file:{passphrase_file}',
    ]


def encrypt_file(
    plaintext: Path,
    ciphertext: Path,
    *,
    passphrase_file: Path,
    runner: Callable[..., object] = subprocess.run,
) -> str:
    """Encrypt one file and return the ciphertext digest; never overwrite an output."""
    _absolute_file(plaintext, 'plaintext')
    _fresh_path(ciphertext, 'ciphertext')
    require_passphrase_file(passphrase_file)
    run_checked(runner, openssl_argv(plaintext, ciphertext, passphrase_file, decrypt=False), 'openssl encryption')
    require(ciphertext.is_file(), 'openssl reported success but wrote no ciphertext')
    return sha256_file(ciphertext)


def decrypt_file(
    ciphertext: Path,
    plaintext: Path,
    *,
    passphrase_file: Path,
    runner: Callable[..., object] = subprocess.run,
) -> str:
    """Decrypt one file and return the plaintext digest; never overwrite an output."""
    _absolute_file(ciphertext, 'ciphertext')
    _fresh_path(plaintext, 'plaintext')
    require_passphrase_file(passphrase_file)
    run_checked(runner, openssl_argv(ciphertext, plaintext, passphrase_file, decrypt=True), 'openssl decryption')
    require(plaintext.is_file(), 'openssl reported success but wrote no plaintext')
    return sha256_file(plaintext)


def require_passphrase_file(passphrase_file: Path) -> Path:
    """An absolute, owner-only, non-trivial passphrase file, or a refusal."""
    read_passphrase(passphrase_file)
    return passphrase_file


def passphrase_from_environment(environ: Mapping[str, str]) -> Path:
    """The passphrase file the environment names, refused unless it is usable."""
    raw = environ.get(PASSPHRASE_ENVIRONMENT_VARIABLE, '').strip()
    require(bool(raw), f'{PASSPHRASE_ENVIRONMENT_VARIABLE} must name the passphrase file')
    return require_passphrase_file(Path(raw))


def read_passphrase(passphrase_file: Path) -> bytes:
    """Read the exact line OpenSSL receives, excluding its trailing newline.

    The length is measured on the passphrase itself with the trailing newline removed,
    because that is what ``openssl -pass file:`` uses: measuring the file size would let a
    short passphrase pass on the strength of its newline.
    """
    require(passphrase_file.is_absolute(), 'the passphrase file must be an absolute path')
    require(passphrase_file.is_file(), 'the passphrase file must be an existing file')
    mode = stat.S_IMODE(passphrase_file.stat().st_mode)
    require(
        mode in ALLOWED_PASSPHRASE_MODES,
        f'the passphrase file must have mode 0600 or 0400, not {mode:04o}',
    )
    with passphrase_file.open('rb') as handle:
        raw = handle.read(MAXIMUM_PASSPHRASE_BYTES + 2)
    passphrase = raw[:-1] if raw.endswith(b'\n') else raw
    require(
        len(passphrase) <= MAXIMUM_PASSPHRASE_BYTES
        and not any(marker in passphrase for marker in (b'\n', b'\r', b'\x00')),
        'the passphrase file must contain exactly one line within the OpenSSL size limit',
    )
    require(
        len(passphrase.strip()) >= MINIMUM_PASSPHRASE_BYTES,
        f'the passphrase must hold at least {MINIMUM_PASSPHRASE_BYTES} bytes',
    )
    return passphrase


def _fresh_path(path: Path, what: str) -> Path:
    """A path this run may create; an existing one is refused, never overwritten."""
    require(path.is_absolute(), f'{what} must be an absolute path')
    require(not path.exists(), f'{what} already exists; refusing to overwrite: {path}')
    return path


def _absolute_file(path: Path, what: str) -> Path:
    require(path.is_absolute(), f'{what} must be an absolute path')
    require(path.is_file(), f'{what} must be an existing file')
    return path


def _add_member(archive: tarfile.TarFile, relative: str, path: Path, is_directory: bool) -> None:
    """Add one member with every variable header field pinned to a constant."""
    info = tarfile.TarInfo(name=relative + '/' if is_directory else relative)
    info.type = tarfile.DIRTYPE if is_directory else tarfile.REGTYPE
    info.mode = 0o755 if is_directory else 0o644
    info.uid = 0
    info.gid = 0
    info.uname = ''
    info.gname = ''
    info.mtime = 0
    if is_directory:
        archive.addfile(info)
        return
    info.size = path.stat().st_size
    with path.open('rb') as handle:
        archive.addfile(info, handle)


def _archive_members(source_dir: Path) -> list[tuple[str, Path, bool]]:
    """Every directory and regular file under the source, in sorted path order."""
    members: list[tuple[str, Path, bool]] = []
    for root, directories, files in os.walk(source_dir):
        directories.sort()
        files.sort()
        for name in directories + files:
            path = Path(root, name)
            relative = path.relative_to(source_dir).as_posix()
            is_directory = path.is_dir() and not path.is_symlink()
            require(
                is_directory or (path.is_file() and not path.is_symlink()),
                f'the archive source holds a symlink or a special file that a restore '
                f'cannot reproduce: {relative}',
            )
            members.append((relative, path, is_directory))
    members.sort(key=lambda member: member[0])
    return members
