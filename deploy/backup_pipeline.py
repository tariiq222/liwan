# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The scheduled, encrypted, offsite backup pipeline: capture, retention, truth.

One fact lives here: what an hourly or daily backup is, where its bytes go, how long
they stay, and whether the last one is inside the owner's recovery budget. The owner
decided (2026-11-06): RPO one hour, RTO four hours, hourly backups kept seven days,
daily backups kept thirty, encrypted before leaving the server, stored in an
S3-compatible bucket in Riyadh, restores performed by support on request.
:class:`RetentionPolicy` carries those numbers, so changing a decision is changing
one default.

Proven here, offline, against :class:`s3_client.FilesystemStore` and injected
process runners:

* the passphrase reaches ``openssl`` only as ``-pass file:<path>`` and never in an
  argument list; the file must be an absolute path with mode 0600 or 0400, must hold
  at least :data:`MINIMUM_PASSPHRASE_BYTES`, and an existing output is never
  overwritten;
* one artifact archive is byte-for-byte reproducible from the same staged capture,
  so a manifest's SHA-256 is a fact about the data and not about the clock;
* ``capture`` uploads exactly three objects — artifact, ``checksums.sha256``,
  manifest — and uploads the manifest last, so a failed capture leaves no success
  manifest behind;
* ``prune`` never deletes the newest hourly or the newest daily backup, however old
  it is, and stays inside the policy's windows otherwise;
* ``restore_verified`` never hard-codes ``True``: a drill record must exist, must say
  the restore passed, and must be inside both the RTO and the RPO window of the
  caller's ``now``.

Not proven here: any real bucket (no socket is opened; :mod:`deploy.s3_client` owns
that boundary), quiescence of the copied database, and recovery beyond a full dump.
There is no WAL archiving, so the one-hour RPO rests on hourly captures, never on
point-in-time recovery. Integrity is a SHA-256 comparison, not an authenticated
cipher tag: ``openssl enc -aes-256-cbc`` is not an AEAD mode, and the manifest digest
travels in the same bucket as the ciphertext, so a reader who can rewrite both is not
detected. What this pipeline does prove is that a wrong key, a truncated upload or a
substituted artifact makes the restore drill refuse.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tarfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

try:  # imported as deploy.<module> (repository tests, PYTHONPATH=.)
    from deploy import backup, s3_client
except ImportError:  # executed as a script from deploy/ (PYTHONPATH=deploy)
    import backup
    import s3_client

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence
    from typing import Protocol

    class ObjectStore(Protocol):
        """The five operations ``s3_client``'s two stores share, and nothing more."""

        def put(self, key: str, data: bytes) -> None: ...

        def get(self, key: str) -> bytes: ...

        def head(self, key: str) -> int: ...

        def list(self, prefix: str) -> list[str]: ...

        def delete(self, key: str) -> None: ...

# Owner decisions, 2026-11-06. Change them in RetentionPolicy, not at a call site.
RPO_SECONDS = 3600
RTO_SECONDS = 4 * 3600
HOURLY_KEEP_DAYS = 7
DAILY_KEEP_DAYS = 30

KIND_HOURLY = 'hourly'
KIND_DAILY = 'daily'
BACKUP_KINDS = (KIND_HOURLY, KIND_DAILY)
CIPHER = 'aes-256-cbc-pbkdf2'
# deploy/backup.py owns this word for its capture contract: it copies a running
# database and never claims quiescence, so the pipeline carries it unchanged.
CONSISTENCY_UNVERIFIED = 'UNVERIFIED'

STAMP_FORMAT = '%Y-%m-%dT%H%M%SZ'
ARTIFACT_NAME = 'artifact.tar'
ARTIFACT_CIPHERTEXT_NAME = 'artifact.tar.enc'
MANIFEST_NAME = 'manifest.json'
CHECKSUMS_NAME = 'checksums.sha256'
CAPTURE_DIR_NAME = 'capture'
CHECKSUM_LINE_SEPARATOR = '  '

OPENSSL_BINARY = 'openssl'
PASSPHRASE_ENVIRONMENT_VARIABLE = 'LIWAN_BACKUP_PASSPHRASE_FILE'
ALLOWED_PASSPHRASE_MODES = (0o600, 0o400)
# The shortest passphrase this pipeline accepts. openssl itself would accept an
# empty passphrase; refusing it here is what keeps "encrypted" from meaning nothing.
MINIMUM_PASSPHRASE_BYTES = 16

TENANT_RE = re.compile(r'^[a-z0-9][a-z0-9_-]{0,62}$')
SHA256_RE = re.compile(r'^[0-9a-f]{64}$')

KEEP_NEWEST = 'newest-of-kind'
KEEP_INSIDE_WINDOW = 'inside-retention-window'
KEEP_UNRECOGNISED = 'unrecognised-object'
DELETE_BEYOND_WINDOW = 'beyond-retention-window'

EXIT_OK = 0
EXIT_REFUSED = 2
EXIT_NOT_VERIFIED = 3


class PipelineError(Exception):
    """The pipeline refused or failed; nothing that claims success was uploaded."""


@dataclass(frozen=True)
class RetentionPolicy:
    """The recovery budget and the two retention windows, in one place.

    ``rpo_seconds``/``rto_seconds`` are the owner's 1 h / 4 h; the keep windows are
    the owner's 7 days for hourly captures and 30 days for daily ones.
    """

    rpo_seconds: int = RPO_SECONDS
    rto_seconds: int = RTO_SECONDS
    hourly_keep_days: int = HOURLY_KEEP_DAYS
    daily_keep_days: int = DAILY_KEEP_DAYS

    def keep_days(self, kind: str) -> int:
        _require_kind(kind)
        return self.hourly_keep_days if kind == KIND_HOURLY else self.daily_keep_days

    def keep_window(self, kind: str) -> timedelta:
        return timedelta(days=self.keep_days(kind))


@dataclass(frozen=True)
class BackupManifest:
    """What one uploaded artifact is, provable from the bytes beside it.

    ``captured_at`` is set once, when the capture starts, and never rewritten: a
    retried capture is a new artifact with a new stamp, not an edit of this one.
    """

    tenant: str
    kind: str
    captured_at: datetime
    plaintext_sha256: str
    ciphertext_sha256: str
    plaintext_bytes: int
    ciphertext_bytes: int
    cipher: str = CIPHER
    consistency: str = CONSISTENCY_UNVERIFIED

    def __post_init__(self) -> None:
        _require_tenant(self.tenant)
        _require_kind(self.kind)
        _require(self.captured_at.utcoffset() is not None, 'captured_at must be timezone aware')
        _require(self.captured_at.utcoffset() == timedelta(0), 'captured_at must be UTC')
        # The stamp format has whole seconds, so the object is normalized to it: a
        # manifest must equal the one read back from its own JSON.
        object.__setattr__(
            self, 'captured_at', self.captured_at.replace(microsecond=0),
        )
        for field_name in ('plaintext_sha256', 'ciphertext_sha256'):
            _require_sha256(getattr(self, field_name), field_name)
        for field_name in ('plaintext_bytes', 'ciphertext_bytes'):
            _require(getattr(self, field_name) > 0, f'{field_name} must be positive')
        _require(self.cipher == CIPHER, f'cipher must be {CIPHER}')
        _require(
            self.consistency == CONSISTENCY_UNVERIFIED,
            'consistency is UNVERIFIED by contract: deploy/backup.py copies a running '
            'database and cannot claim quiescence',
        )

    def payload(self) -> dict[str, object]:
        return {
            'tenant': self.tenant,
            'kind': self.kind,
            'captured_at': self.captured_at.strftime(STAMP_FORMAT),
            'plaintext_sha256': self.plaintext_sha256,
            'ciphertext_sha256': self.ciphertext_sha256,
            'plaintext_bytes': self.plaintext_bytes,
            'ciphertext_bytes': self.ciphertext_bytes,
            'cipher': self.cipher,
            'consistency': self.consistency,
        }

    def to_json(self) -> str:
        return json.dumps(self.payload(), indent=2, sort_keys=True) + '\n'

    @classmethod
    def from_json(cls, text: str) -> BackupManifest:
        try:
            payload = json.loads(text)
            return cls(
                tenant=str(payload['tenant']),
                kind=str(payload['kind']),
                captured_at=parse_stamp(str(payload['captured_at'])),
                plaintext_sha256=str(payload['plaintext_sha256']),
                ciphertext_sha256=str(payload['ciphertext_sha256']),
                plaintext_bytes=int(payload['plaintext_bytes']),
                ciphertext_bytes=int(payload['ciphertext_bytes']),
                cipher=str(payload.get('cipher', '')),
                consistency=str(payload.get('consistency', '')),
            )
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            message = 'not a backup manifest: the JSON is unreadable or incomplete'
            raise PipelineError(message) from error


@dataclass(frozen=True)
class CaptureSource:
    """The database and filestore one capture copies, in backup.py's own terms."""

    db_name: str
    filestore: Path
    pg_dump: Path
    pg_host: str | None = None
    pg_port: str | None = None
    pg_user: str | None = None


@dataclass(frozen=True)
class ArtifactRef:
    """One artifact already in the store, addressed by the tenant prefix layout."""

    tenant: str
    kind: str
    captured_at: datetime
    artifact_key: str
    manifest_key: str

    @property
    def prefix(self) -> str:
        return self.artifact_key.rsplit('/', 1)[0] + '/'


@dataclass(frozen=True)
class PruneAction:
    """One object the prune kept or deleted, and the rule that decided it."""

    key: str
    reason: str


@dataclass(frozen=True)
class PruneReport:
    """What one prune did, key by key, so an operator can audit a deletion."""

    tenant: str
    kept: tuple[PruneAction, ...]
    deleted: tuple[PruneAction, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            'tenant': self.tenant,
            'kept': [{'key': action.key, 'reason': action.reason} for action in self.kept],
            'deleted': [{'key': action.key, 'reason': action.reason} for action in self.deleted],
        }


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise PipelineError(message)


def _require_tenant(tenant: str) -> str:
    _require(bool(TENANT_RE.match(tenant)), f'tenant must match {TENANT_RE.pattern}: {tenant!r}')
    return tenant


def _require_kind(kind: str) -> str:
    _require(kind in BACKUP_KINDS, f'kind must be one of {", ".join(BACKUP_KINDS)}: {kind!r}')
    return kind


def _require_sha256(value: str, field_name: str) -> None:
    _require(bool(SHA256_RE.match(value)), f'{field_name} must be a lowercase SHA-256 hex digest')


def as_utc(moment: datetime | None) -> datetime:
    """The caller's clock, or the real one, always timezone aware and in UTC."""
    current = moment if moment is not None else datetime.now(timezone.utc)
    _require(current.utcoffset() is not None, 'the clock must be timezone aware')
    return current.astimezone(timezone.utc)


def parse_stamp(stamp: str) -> datetime:
    """Read the one timestamp format this pipeline writes, or refuse it."""
    try:
        return datetime.strptime(stamp, STAMP_FORMAT).replace(tzinfo=timezone.utc)
    except ValueError as error:
        message = f'timestamp must look like {STAMP_FORMAT}: {stamp!r}'
        raise PipelineError(message) from error


def sha256_file(path: Path) -> str:
    """The digest of a file's bytes, streamed so a large dump is never held in memory."""
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _absolute_file(path: Path, what: str) -> Path:
    _require(path.is_absolute(), f'{what} must be an absolute path')
    _require(path.is_file(), f'{what} must be an existing file')
    return path


def _fresh_path(path: Path, what: str) -> Path:
    """A path this run may create; an existing one is refused, never overwritten."""
    _require(path.is_absolute(), f'{what} must be an absolute path')
    _require(not path.exists(), f'{what} already exists; refusing to overwrite: {path}')
    return path


def require_passphrase_file(passphrase_file: Path) -> Path:
    """An absolute, owner-only, non-trivial passphrase file, or a refusal.

    The length is measured on the passphrase itself with the trailing newline
    removed, because that is what ``openssl -pass file:`` uses: measuring the file
    size would let a short passphrase pass on the strength of its newline.
    """
    _require(passphrase_file.is_absolute(), 'the passphrase file must be an absolute path')
    _require(passphrase_file.is_file(), 'the passphrase file must be an existing file')
    mode = stat.S_IMODE(passphrase_file.stat().st_mode)
    _require(
        mode in ALLOWED_PASSPHRASE_MODES,
        f'the passphrase file must have mode 0600 or 0400, not {mode:04o}',
    )
    passphrase = passphrase_file.read_bytes().strip()
    _require(passphrase != b'', 'the passphrase must not be empty')
    _require(
        len(passphrase) >= MINIMUM_PASSPHRASE_BYTES,
        f'the passphrase must hold at least {MINIMUM_PASSPHRASE_BYTES} bytes',
    )
    return passphrase_file


def _run(runner: Callable[..., object], argv: list[str], what: str) -> object:
    completed = runner(argv, shell=False, check=False, capture_output=True, text=True)
    returncode = getattr(completed, 'returncode', None)
    if returncode != 0:
        message = f'{what} failed with exit code {returncode}'
        raise PipelineError(message)
    return completed


def openssl_argv(
    source: Path,
    destination: Path,
    passphrase_file: Path,
    *,
    decrypt: bool,
) -> list[str]:
    """The exact openssl invocation: the secret is a file path, never an argument.

    ``-pass file:<path>`` is the only form used. ``-pass pass:``/``env:``/``fd:``
    would put the secret somewhere it can be read from a process listing or a
    shell history, so this function cannot produce them.
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
    _run(runner, openssl_argv(plaintext, ciphertext, passphrase_file, decrypt=False), 'openssl encryption')
    if not ciphertext.is_file():
        message = 'openssl reported success but wrote no ciphertext'
        raise PipelineError(message)
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
    _run(runner, openssl_argv(ciphertext, plaintext, passphrase_file, decrypt=True), 'openssl decryption')
    if not plaintext.is_file():
        message = 'openssl reported success but wrote no plaintext'
        raise PipelineError(message)
    return sha256_file(plaintext)


def archive_filestore(source_dir: Path, target_tar: Path) -> str:
    """Write one reproducible archive of a captured tree and return its digest.

    The staged tree holds ``database.dump`` and ``filestore/``, so one artifact is
    one restorable unit: a restore needs both or neither. Every name is sorted and
    every header field is fixed (mode, uid, gid, uname, gname, mtime), so the same
    input produces the same bytes and the manifest digest is a fact about the data.
    A second archive of the same tree is byte-identical; the test proves it.

    The standard library writes the archive on purpose: the ``tar`` on the operator's
    machine is bsdtar, which rejects ``--sort=name`` and ``--mtime``, so a shell-out
    could not promise the fixed metadata this function promises.

    The format is PAX, not USTAR: USTAR's octal size field overflows at 8 GiB and
    its name fields at 256 bytes, and a tenant's dump or filestore can pass either.
    PAX writes a header record only for a member that needs one, so an ordinary
    tree is still byte-for-byte reproducible, and ``tarfile`` reads every format.
    """
    _require(source_dir.is_absolute(), 'the archive source must be an absolute path')
    _require(source_dir.is_dir(), 'the archive source must be an existing directory')
    _fresh_path(target_tar, 'archive')
    members = _archive_members(source_dir)
    _require(bool(members), 'the archive source holds nothing to capture')
    with tarfile.open(target_tar, 'w', format=tarfile.PAX_FORMAT) as archive:
        for relative, path, is_directory in members:
            _add_member(archive, relative, path, is_directory)
    return sha256_file(target_tar)


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
            _require(
                is_directory or (path.is_file() and not path.is_symlink()),
                f'the archive source holds a symlink or a special file that a restore '
                f'cannot reproduce: {relative}',
            )
            members.append((relative, path, is_directory))
    members.sort(key=lambda member: member[0])
    return members


def artifact_prefix(tenant: str, kind: str, captured_at: datetime) -> str:
    """``<tenant>/<kind>/<UTC stamp>/``: the one place the key layout is written."""
    _require_tenant(tenant)
    _require_kind(kind)
    return f'{tenant}/{kind}/{as_utc(captured_at).strftime(STAMP_FORMAT)}/'


def capture_dir(work_root: Path, stamp: str) -> Path:
    """A directory no earlier run used; backup.py refuses an existing output dir."""
    return work_root / CAPTURE_DIR_NAME / stamp


def _capture_argv(capture: Path, source: CaptureSource, backup_script: Path) -> list[str]:
    argv = [
        sys.executable,
        str(backup_script),
        '--opt-in',
        backup.OPT_IN_TOKEN,
        '--acknowledge-unverified',
        backup.UNVERIFIED_TOKEN,
        '--db-name',
        source.db_name,
        '--filestore',
        str(source.filestore),
        '--output-dir',
        str(capture),
        '--pg-dump',
        str(source.pg_dump),
    ]
    for flag, value in (('--pg-host', source.pg_host), ('--pg-port', source.pg_port),
                        ('--pg-user', source.pg_user)):
        if value:
            argv.extend([flag, str(value)])
    return argv


def _checksums(digests: tuple[str, ...], object_names: tuple[str, ...]) -> str:
    """``sha256sum -c`` compatible: two spaces between digest and object name."""
    return ''.join(
        f'{digest}{CHECKSUM_LINE_SEPARATOR}{name}\n'
        for digest, name in zip(digests, object_names)
    )


def capture(
    *,
    store: ObjectStore,
    tenant: str,
    source: CaptureSource,
    kind: str,
    work_root: Path,
    passphrase_file: Path,
    now: datetime | None = None,
    runner: Callable[..., object] = subprocess.run,
    backup_script: Path | None = None,
) -> BackupManifest:
    """Capture, encrypt and upload one artifact; the manifest is uploaded last.

    ``deploy/backup.py`` produces ``database.dump`` and ``filestore/`` and keeps its
    own ``consistency=UNVERIFIED`` contract; this function never upgrades that word.
    Everything is staged under ``work_root`` and the store only ever receives fully
    encrypted bytes. A failure at any step raises and leaves no manifest behind, so
    the presence of a manifest in the bucket means the whole artifact arrived.
    """
    _require_tenant(tenant)
    _require_kind(kind)
    captured_at = as_utc(now)
    _require(work_root.is_absolute(), 'the work root must be an absolute path')
    work_root.mkdir(parents=True, exist_ok=True)
    stamp = captured_at.strftime(STAMP_FORMAT)
    staging = capture_dir(work_root, stamp)
    _require(not staging.exists(), f'the work root already holds a capture for {stamp}')
    # Only the parent: deploy/backup.py creates its output directory itself and
    # refuses one that already exists.
    staging.parent.mkdir(parents=True, exist_ok=True)
    plain_tar = staging / ARTIFACT_NAME
    script = backup_script or Path(__file__).with_name('backup.py')

    _run(runner, _capture_argv(staging, source, script), 'deploy/backup.py')
    staged_dump = staging / 'database.dump'
    _require(staged_dump.is_file(), 'deploy/backup.py produced no database.dump')
    archive_filestore(staging, plain_tar)

    ciphertext = staging / ARTIFACT_CIPHERTEXT_NAME
    ciphertext_sha256 = encrypt_file(plain_tar, ciphertext, passphrase_file=passphrase_file, runner=runner)
    manifest = BackupManifest(
        tenant=tenant,
        kind=kind,
        captured_at=captured_at,
        plaintext_sha256=sha256_file(plain_tar),
        ciphertext_sha256=ciphertext_sha256,
        plaintext_bytes=plain_tar.stat().st_size,
        ciphertext_bytes=ciphertext.stat().st_size,
    )
    manifest_bytes = manifest.to_json().encode('utf-8')
    manifest_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
    checksums = _checksums(
        (manifest.ciphertext_sha256, manifest_sha256),
        (ARTIFACT_CIPHERTEXT_NAME, MANIFEST_NAME),
    )

    prefix = artifact_prefix(tenant, kind, captured_at)
    # The manifest is the success marker: uploaded last, after the artifact and its
    # checksum listing are durable, so a half capture never looks complete.
    store.put(prefix + ARTIFACT_CIPHERTEXT_NAME, ciphertext.read_bytes())
    store.put(prefix + CHECKSUMS_NAME, checksums.encode('utf-8'))
    store.put(prefix + MANIFEST_NAME, manifest_bytes)
    return manifest


def _kind_of(tenant: str, key: str) -> tuple[str, datetime] | None:
    """Split ``<tenant>/<kind>/<stamp>/<name>`` into its kind and capture time."""
    parts = key.split('/')
    if len(parts) != 4 or parts[0] != tenant or parts[1] not in BACKUP_KINDS:
        return None
    try:
        return parts[1], parse_stamp(parts[2])
    except PipelineError:
        return None


def _footprints(store: ObjectStore, tenant: str) -> dict[str, list[ArtifactRef]]:
    """Every complete artifact of the tenant, newest first inside each kind.

    The manifest is uploaded last, so only an artifact whose manifest exists counts:
    ciphertext whose manifest upload failed is a partial capture. It is neither a
    restore candidate nor a copy that justifies pruning an older complete one.
    """
    keys = set(store.list(f'{tenant}/'))
    found: dict[str, dict[str, ArtifactRef]] = {kind: {} for kind in BACKUP_KINDS}
    for key in keys:
        split = _kind_of(tenant, key)
        if split is None or not key.endswith('/' + ARTIFACT_CIPHERTEXT_NAME):
            continue
        kind, captured_at = split
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


def prune(
    store: ObjectStore,
    tenant: str,
    now: datetime | None = None,
    policy: RetentionPolicy | None = None,
) -> PruneReport:
    """Delete artifacts beyond the window, but never the newest of a kind.

    The newest hourly and the newest daily survive whatever their age: a pipeline
    that emptied a bucket because every capture predated its window would make the
    RPO permanently unrecoverable, so the last copy of each kind always stays. Every
    object of a kept artifact is kept with it, so a prune never leaves an artifact
    without its manifest or its checksum listing.
    """
    _require_tenant(tenant)
    current = as_utc(now)
    active = policy or RetentionPolicy()
    reasons: dict[str, str] = {}
    for kind, artifacts in _footprints(store, tenant).items():
        for index, ref in enumerate(artifacts):
            inside = current - ref.captured_at <= active.keep_window(kind)
            reason = (
                KEEP_NEWEST if index == 0
                else KEEP_INSIDE_WINDOW if inside
                else DELETE_BEYOND_WINDOW
            )
            for key in store.list(ref.prefix):
                reasons[key] = reason

    kept: list[PruneAction] = []
    deleted: list[PruneAction] = []
    for key in store.list(f'{tenant}/'):
        reason = reasons.get(key, KEEP_UNRECOGNISED)
        if reason != DELETE_BEYOND_WINDOW:
            kept.append(PruneAction(key=key, reason=reason))
            continue
        store.delete(key)
        deleted.append(PruneAction(key=key, reason=reason))
    return PruneReport(tenant=tenant, kept=tuple(kept), deleted=tuple(deleted))


def latest_artifact(store: ObjectStore, tenant: str) -> ArtifactRef | None:
    """The newest artifact of either kind, or ``None`` when the tenant has none.

    The drill restores what a real incident would restore: the most recent complete
    capture, hourly or daily, whichever is younger.
    """
    _require_tenant(tenant)
    candidates = [
        ref
        for artifacts in _footprints(store, tenant).values()
        for ref in artifacts
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda ref: ref.captured_at)


def load_drill_record(record_path: Path) -> dict[str, object] | None:
    """The drill record, or ``None`` when it is absent or unreadable.

    An unreadable record is not an error to shout about and certainly not a pass:
    a record nobody can parse proves nothing, so it reads as "no verified restore".
    """
    if not record_path.is_file():
        return None
    try:
        payload = json.loads(record_path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _record_timestamp(record: Mapping[str, object], field: str) -> datetime | None:
    """One of the record's timestamps, only when it is a real, aware timestamp."""
    raw = record.get(field)
    if not isinstance(raw, str):
        return None
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return moment.astimezone(timezone.utc) if moment.utcoffset() is not None else None


def restore_verified(
    record_path: Path,
    now: datetime | None = None,
    policy: RetentionPolicy | None = None,
) -> bool:
    """``True`` only for a fresh, passing drill record; never a constant.

    Three things must hold, and each has a test that fails when it is removed: the
    record exists and says ``restore_verified`` is true, it finished inside the RTO
    window, and it finished inside the RPO window of the caller's ``now``. Freshness
    is what turns last month's good news into today's unproven claim.
    """
    current = as_utc(now)
    active = policy or RetentionPolicy()
    record = load_drill_record(record_path)
    if record is None or record.get('restore_verified') is not True:
        return False
    finished_at = _record_timestamp(record, 'finished_at')
    if finished_at is None:
        return False
    age_seconds = (current - finished_at).total_seconds()
    inside_rto = age_seconds <= active.rto_seconds
    inside_rpo = age_seconds <= active.rpo_seconds
    return age_seconds >= 0 and inside_rto and inside_rpo


def _elapsed_seconds(record: Mapping[str, object]) -> float | None:
    """The drill's measured duration, or ``None`` when the record has no number."""
    raw = record.get('elapsed_seconds')
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return float(raw)


def status(
    record_path: Path,
    now: datetime | None = None,
    policy: RetentionPolicy | None = None,
) -> dict[str, object]:
    """The recovery picture an operator reads, all of it from the drill record.

    ``last_backup_age_seconds`` is the age of the data the drill proved restorable —
    the artifact's capture time, not the moment the drill finished — because that is
    what the RPO is about. Every field is ``None`` or ``False`` before the first
    drill: a repository that never ran one reports no proof instead of a guess.
    """
    current = as_utc(now)
    active = policy or RetentionPolicy()
    record = load_drill_record(record_path)
    captured_at = _record_timestamp(record, 'artifact_captured_at') if record else None
    finished_at = _record_timestamp(record, 'finished_at') if record else None
    elapsed_seconds = _elapsed_seconds(record) if record else None
    age_seconds = None if captured_at is None else (current - captured_at).total_seconds()
    return {
        'record_exists': record is not None,
        'rpo_ok': age_seconds is not None and 0 <= age_seconds <= active.rpo_seconds,
        'rto_ok': elapsed_seconds is not None and elapsed_seconds <= active.rto_seconds,
        'restore_verified': restore_verified(record_path, current, active),
        'last_backup_age_seconds': age_seconds,
        'artifact_captured_at': None if captured_at is None else captured_at.isoformat(),
        'finished_at': None if finished_at is None else finished_at.isoformat(),
    }


def build_store(store_root: Path | None, environ: Mapping[str, str]) -> ObjectStore:
    """A filesystem store when asked for one, otherwise the S3 bucket from the env."""
    if store_root is not None:
        return s3_client.FilesystemStore(store_root)
    return s3_client.S3Store(s3_client.Credentials.from_environment(environ))


def passphrase_from_environment(environ: Mapping[str, str]) -> Path:
    """The passphrase file the environment names, refused unless it is usable."""
    raw = environ.get(PASSPHRASE_ENVIRONMENT_VARIABLE, '').strip()
    _require(bool(raw), f'{PASSPHRASE_ENVIRONMENT_VARIABLE} must name the passphrase file')
    return require_passphrase_file(Path(raw))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='backup_pipeline.py',
        description=(
            'Scheduled encrypted backup pipeline: capture into an S3-compatible bucket, '
            'enforce the retention policy, and report the recovery status. '
            'RPO 1 h, RTO 4 h, hourly kept 7 days, daily kept 30 days.'
        ),
    )
    commands = parser.add_subparsers(dest='command', required=True)

    take = commands.add_parser('capture', help='capture, encrypt and upload one artifact')
    take.add_argument('--tenant', required=True)
    take.add_argument('--kind', required=True, choices=BACKUP_KINDS)
    take.add_argument('--work-root', required=True, type=Path)
    take.add_argument('--db-name', required=True)
    take.add_argument('--filestore', required=True, type=Path)
    take.add_argument('--pg-dump', required=True, type=Path)
    take.add_argument('--pg-host')
    take.add_argument('--pg-port')
    take.add_argument('--pg-user')
    take.add_argument('--now', help='override the capture time, ISO 8601 (tests only)')

    retention = commands.add_parser('prune', help='delete artifacts beyond the retention windows')
    retention.add_argument('--tenant', required=True)
    retention.add_argument('--now', help='override the current time, ISO 8601 (tests only)')

    report = commands.add_parser('status', help='report RPO, RTO and the verified restore')
    report.add_argument('--record', required=True, type=Path)
    report.add_argument('--now', help='override the current time, ISO 8601 (tests only)')

    for subparser in (take, retention):
        subparser.add_argument('--store-root', type=Path, help='a filesystem store instead of a bucket')
    return parser


def _parse_now(raw: str | None) -> datetime | None:
    """The optional clock override; a bad value is a refusal, not a silent default."""
    if raw is None:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError as error:
        message = f'--now must be ISO 8601: {raw!r}'
        raise PipelineError(message) from error


def _write_json(payload: Mapping[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + '\n')


def _run_capture(args: argparse.Namespace, runner: Callable[..., object]) -> int:
    manifest = capture(
        store=build_store(args.store_root, os.environ),
        tenant=args.tenant,
        source=CaptureSource(
            db_name=args.db_name,
            filestore=args.filestore,
            pg_dump=args.pg_dump,
            pg_host=args.pg_host,
            pg_port=args.pg_port,
            pg_user=args.pg_user,
        ),
        kind=args.kind,
        work_root=args.work_root,
        passphrase_file=passphrase_from_environment(os.environ),
        now=_parse_now(args.now),
        runner=runner,
    )
    _write_json({**manifest.payload(), 'status': 'captured'})
    return EXIT_OK


def _run_prune(args: argparse.Namespace, _runner: Callable[..., object]) -> int:
    report = prune(
        build_store(args.store_root, os.environ),
        args.tenant,
        now=_parse_now(args.now),
    )
    _write_json(report.as_dict())
    return EXIT_OK


def _run_status(args: argparse.Namespace, _runner: Callable[..., object]) -> int:
    report = status(args.record, _parse_now(args.now))
    _write_json(report)
    return EXIT_OK if report['restore_verified'] else EXIT_NOT_VERIFIED


def main(
    argv: Sequence[str] | None = None,
    runner: Callable[..., object] = subprocess.run,
) -> int:
    """Run one subcommand; ``runner`` is the process seam the tests replace."""
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    handlers = {'capture': _run_capture, 'prune': _run_prune, 'status': _run_status}
    try:
        return handlers[args.command](args, runner)
    except (PipelineError, s3_client.StorageError) as error:
        # s3_client's message carries no credential; this line never adds one.
        sys.stderr.write(f'backup_pipeline: {error}\n')
        return EXIT_REFUSED


if __name__ == '__main__':
    raise SystemExit(main())
