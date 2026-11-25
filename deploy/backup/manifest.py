# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The artifact contract: its identity, its two halves, and the one stamp format.

:class:`BackupManifest` is the outer, HMAC-authenticated manifest a store holds beside
the ciphertext. It authenticates the tenant, the capture kind, the capture time, both
halves' digests and both lengths with a key derived from the passphrase, so a ciphertext
moved to another tenant's prefix, another kind, another timestamp or another capture is
refused before it is decrypted.

One backup is both halves: the database dump and the tenant's bucket. A manifest that names
one and not the other, or names a half with a zeroed digest, is refused — there is no second
shape to fall back to. An empty bucket is not a missing half: it is captured as the empty
index under the same ``FORMAT`` (the control plane's database-only source is the documented
case), so absence of objects never has its own format.

``consistency`` is ``UNVERIFIED`` by contract: this package copies a running database
and never claims quiescence it did not prove, so a manifest can never be read back with
a stronger word than the capture wrote.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from deploy.backup.errors import BackupError, require

if TYPE_CHECKING:
    from pathlib import Path

    from collections.abc import Mapping

KIND_HOURLY = 'hourly'
KIND_DAILY = 'daily'
# The operator's one-off copy. It is a complete encrypted artifact like the other two,
# but it is outside the retention windows and is never what a drill restores.
KIND_CANDIDATE = 'candidate'
BACKUP_KINDS = (KIND_HOURLY, KIND_DAILY)
CAPTURE_KINDS = (*BACKUP_KINDS, KIND_CANDIDATE)

CIPHER = 'aes-256-cbc-pbkdf2'
# The one format of one backup: a database dump beside the tenant bucket. Any other value
# in a manifest is not a backup this package wrote, and is refused rather than upgraded.
FORMAT = 'odoo-pg-bucket-v1'
CONSISTENCY_UNVERIFIED = 'UNVERIFIED'
ZEROED_DIGEST = '0' * 64
STAMP_FORMAT = '%Y-%m-%dT%H%M%SZ'
TENANT_RE = re.compile(r'^[a-z0-9][a-z0-9_-]{0,62}$')
SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
MANIFEST_KEY_DOMAIN = b'liwan-offsite-backup-manifest-v1\x00'
MANIFEST_KEY_ITERATIONS = 600_000
MANIFEST_TAG_FIELD = 'authentication_tag'
# The four fields that name both halves: a manifest without one of them is not one backup.
HALF_FIELDS = ('database_sha256', 'contents_sha256', 'contents_object_count', 'contents_object_bytes')
# A field the format has a default for may be absent from the JSON; the tag is computed
# over the payload with the defaults, so an absent field and its default are one manifest.
MANIFEST_DEFAULTS = {'cipher': CIPHER, 'consistency': CONSISTENCY_UNVERIFIED}


def require_tenant(tenant: str) -> str:
    require(bool(TENANT_RE.match(tenant)), f'tenant must match {TENANT_RE.pattern}: {tenant!r}')
    return tenant


def require_kind(kind: str) -> str:
    require(kind in CAPTURE_KINDS, f'kind must be one of {", ".join(CAPTURE_KINDS)}: {kind!r}')
    return kind


def require_backup_kind(kind: str) -> str:
    """The two kinds retention and the drill work on; a candidate is never one of them."""
    require(kind in BACKUP_KINDS, f'kind must be one of {", ".join(BACKUP_KINDS)}: {kind!r}')
    return kind


def is_non_negative_int(value: object) -> bool:
    """Whether ``value`` is a non-negative integer, rejecting booleans."""
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def require_non_negative_int(value: object, field_name: str) -> None:
    """Require a non-negative integer (not a bool) for ``field_name``."""
    require(is_non_negative_int(value), f'{field_name} must be a non-negative integer')


def is_valid_contents_totals(count: object, size: object) -> bool:
    """Non-negative integer counts where zero objects implies zero bytes; empty objects are allowed."""
    return is_non_negative_int(count) and is_non_negative_int(size) and (count > 0 or size == 0)


def is_real_sha256(value: object) -> bool:
    """Whether ``value`` is a lowercase SHA-256 hex digest that is not all zeroes."""
    return isinstance(value, str) and bool(SHA256_RE.fullmatch(value)) and value != ZEROED_DIGEST


def require_sha256(value: object, field_name: str) -> None:
    require(isinstance(value, str) and bool(SHA256_RE.fullmatch(value)),
            f'{field_name} must be a lowercase SHA-256 hex digest')


def require_half_digest(value: object, field_name: str) -> None:
    """A half's digest must be a real SHA-256: a zeroed one names a half nobody copied."""
    require_sha256(value, field_name)
    require(is_real_sha256(value), f'{field_name} is a zeroed digest: one backup is both halves')


def as_utc(moment: datetime | None) -> datetime:
    """The caller's clock, or the real one, always timezone aware and in UTC."""
    current = moment if moment is not None else datetime.now(timezone.utc)
    require(current.utcoffset() is not None, 'the clock must be timezone aware')
    return current.astimezone(timezone.utc)


def parse_stamp(stamp: str) -> datetime:
    """Read the one timestamp format this package writes, or refuse it."""
    try:
        return datetime.strptime(stamp, STAMP_FORMAT).replace(tzinfo=timezone.utc)
    except ValueError as error:
        message = f'timestamp must look like {STAMP_FORMAT}: {stamp!r}'
        raise BackupError(message) from error


@dataclass(frozen=True)
class BackupManifest:
    """What one uploaded artifact is, provable from the bytes beside it.

    ``captured_at`` is set once, when the capture starts, and never rewritten: a retried
    capture is a new artifact with a new stamp, not an edit of this one. ``plaintext_*``
    describes the archive; ``database_sha256`` is the dump inside it and ``contents_*`` is
    the bucket half, so each half can be judged without decrypting anything else.
    """

    tenant: str
    kind: str
    captured_at: datetime
    plaintext_sha256: str
    ciphertext_sha256: str
    plaintext_bytes: int
    ciphertext_bytes: int
    database_sha256: str
    contents_sha256: str
    contents_object_count: int
    contents_object_bytes: int
    cipher: str = CIPHER
    consistency: str = CONSISTENCY_UNVERIFIED

    def __post_init__(self) -> None:
        require_tenant(self.tenant)
        require_kind(self.kind)
        require(self.captured_at.utcoffset() is not None, 'captured_at must be timezone aware')
        require(self.captured_at.utcoffset() == timedelta(0), 'captured_at must be UTC')
        # The stamp format has whole seconds, so the object is normalized to it: a
        # manifest must equal the one read back from its own JSON.
        object.__setattr__(self, 'captured_at', self.captured_at.replace(microsecond=0))
        for field_name in ('plaintext_sha256', 'ciphertext_sha256'):
            require_sha256(getattr(self, field_name), field_name)
        for field_name in ('plaintext_bytes', 'ciphertext_bytes'):
            require(getattr(self, field_name) > 0, f'{field_name} must be positive')
        require_half_digest(self.database_sha256, 'database_sha256')
        require_half_digest(self.contents_sha256, 'contents_sha256')
        for field_name in ('contents_object_count', 'contents_object_bytes'):
            require_non_negative_int(getattr(self, field_name), field_name)
        require(
            is_valid_contents_totals(self.contents_object_count, self.contents_object_bytes),
            'an empty contents half must report zero object bytes',
        )
        require(self.cipher == CIPHER, f'cipher must be {CIPHER}')
        require(
            self.consistency == CONSISTENCY_UNVERIFIED,
            'consistency is UNVERIFIED by contract: this package copies a running '
            'database and cannot claim quiescence',
        )

    def payload(self) -> dict[str, object]:
        return {
            'format': FORMAT,
            'tenant': self.tenant,
            'kind': self.kind,
            'captured_at': self.captured_at.strftime(STAMP_FORMAT),
            'plaintext_sha256': self.plaintext_sha256,
            'ciphertext_sha256': self.ciphertext_sha256,
            'plaintext_bytes': self.plaintext_bytes,
            'ciphertext_bytes': self.ciphertext_bytes,
            'database_sha256': self.database_sha256,
            'contents_sha256': self.contents_sha256,
            'contents_object_count': self.contents_object_count,
            'contents_object_bytes': self.contents_object_bytes,
            'cipher': self.cipher,
            'consistency': self.consistency,
        }

    def to_json(self, passphrase_file: Path) -> str:
        payload = self.payload()
        payload[MANIFEST_TAG_FIELD] = self.authentication_tag(passphrase_file)
        return json.dumps(payload, indent=2, sort_keys=True) + '\n'

    @classmethod
    def from_json(cls, text: str | bytes, passphrase_file: Path) -> BackupManifest:
        try:
            if isinstance(text, bytes):
                text = text.decode('utf-8')
            payload = json.loads(text, object_pairs_hook=_unique_manifest_object)
            require(isinstance(payload, dict), 'a backup manifest must be a JSON object')
            tag = payload.pop(MANIFEST_TAG_FIELD, None)
            require(
                isinstance(tag, str) and bool(SHA256_RE.fullmatch(tag)),
                'manifest authentication tag is missing or malformed',
            )
            require(payload.get('format') == FORMAT, f'a backup manifest must be {FORMAT}')
            for field_name, default in MANIFEST_DEFAULTS.items():
                payload.setdefault(field_name, default)
            for field_name in HALF_FIELDS:
                require(field_name in payload, f'the manifest names no {field_name}: one backup is both halves')
            manifest = cls(
                tenant=payload['tenant'],
                kind=payload['kind'],
                captured_at=parse_stamp(payload['captured_at']),
                plaintext_sha256=payload['plaintext_sha256'],
                ciphertext_sha256=payload['ciphertext_sha256'],
                plaintext_bytes=payload['plaintext_bytes'],
                ciphertext_bytes=payload['ciphertext_bytes'],
                database_sha256=payload['database_sha256'],
                contents_sha256=payload['contents_sha256'],
                contents_object_count=payload['contents_object_count'],
                contents_object_bytes=payload['contents_object_bytes'],
                cipher=payload['cipher'],
                consistency=payload['consistency'],
            )
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            message = 'not a backup manifest: the JSON is unreadable or incomplete'
            raise BackupError(message) from error
        require(_manifest_canonical(payload) == _manifest_canonical(manifest.payload()),
                'backup manifest fields are not canonical')
        require(hmac.compare_digest(manifest.authentication_tag(passphrase_file), tag),
                'manifest authentication failed')
        return manifest

    def authentication_tag(self, passphrase_file: Path) -> str:
        # Ciphertext already incorporates OpenSSL's random salt. Its digest gives
        # each manifest a distinct KDF salt, separate from the encryption key.
        salt = MANIFEST_KEY_DOMAIN + bytes.fromhex(self.ciphertext_sha256)
        key = hashlib.pbkdf2_hmac('sha256', _passphrase_bytes(passphrase_file), salt, MANIFEST_KEY_ITERATIONS)
        return hmac.new(key, _manifest_canonical(self.payload()), hashlib.sha256).hexdigest()


def _passphrase_bytes(passphrase_file: Path) -> bytes:
    """The exact passphrase bytes OpenSSL uses; the reader lives with the encryption."""
    from deploy.backup.artifact import read_passphrase  # local: artifact imports this module

    return read_passphrase(passphrase_file)


def _manifest_canonical(payload: Mapping[str, object]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(',', ':')).encode('utf-8')


def _unique_manifest_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    payload = dict(pairs)
    require(len(payload) == len(pairs), 'backup manifest has duplicate fields')
    return payload
