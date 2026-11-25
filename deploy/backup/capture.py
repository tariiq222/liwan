# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The scheduled backup pipeline: capture, retention, purge, freshness and truth.

One fact lives here: what an hourly or daily backup is, where its bytes go, how long they
stay, and whether the last one is inside the owner's recovery budget. The owner decided
(2026-11-06): RPO one hour, RTO four hours, hourly backups kept seven days, daily backups
kept thirty, encrypted before leaving the server, stored in an S3-compatible bucket in
Riyadh, restores performed by support on request. :class:`RetentionPolicy` carries those
numbers, so changing a decision is changing one default.

Proven here, offline, against :class:`s3_client.FilesystemStore` and injected process
runners: ``capture`` uploads exactly three objects with the manifest last, so a failed
capture leaves no success manifest behind; ``prune`` never deletes the newest hourly or
the newest daily backup, however old it is; and ``status`` reports a verified restore only
for a fresh drill record that met both objectives.

The control plane's own PostgreSQL database is one more source of this pipeline, under the
reserved source name :data:`CONTROL_PLANE_SOURCE`: a database-only capture (``pg_dump -Fc``,
no bucket) with the same encryption, key layout, retention, manifest and drill rules as
a tenant.
"""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from deploy import s3_client
from deploy.backup import artifact, snapshot
from deploy.backup.errors import PurgeIncompleteError, require
from deploy.backup.manifest import (
    KIND_HOURLY,
    BackupManifest,
    as_utc,
    require_backup_kind,
    require_kind,
    require_tenant,
)
from deploy.backup.recover import latest_artifact

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

    from deploy.backup.store import ObjectStore

# Owner decisions, 2026-11-06. Change them in RetentionPolicy, not at a call site.
RPO_SECONDS = 3600
RTO_SECONDS = 4 * 3600
HOURLY_KEEP_DAYS = 7
DAILY_KEEP_DAYS = 30

# The source name of the control plane's own database. Keys are `<source>/<kind>/...`, so
# this is also the prefix a tenant can never write: a tenant of this name is refused.
CONTROL_PLANE_SOURCE = 'control-plane'

# The id format of a tenant in the published registry (apps/web/server/utils/tenantHostResolver.ts,
# `tenantPattern`). A purge is stricter than a capture: it must never accept a name the
# registry could not have issued.
REGISTRY_TENANT_RE = re.compile(r'^[a-z][a-z0-9_-]{0,62}$')
# A capture may still be uploading when a tenant is retired. This is the wait between the two
# purge passes; the control-plane runner passes its own value, this one serves the tool.
DEFAULT_PURGE_SETTLE_SECONDS = 300.0
MAXIMUM_PURGE_SETTLE_SECONDS = 24 * 3600.0
MAXIMUM_PURGE_ROUNDS = 10_000

KEEP_NEWEST = 'newest-of-kind'
KEEP_INSIDE_WINDOW = 'inside-retention-window'
KEEP_UNRECOGNISED = 'unrecognised-object'
DELETE_BEYOND_WINDOW = 'beyond-retention-window'


@dataclass(frozen=True)
class RetentionPolicy:
    """The recovery budget and the two retention windows, in one place.

    ``rpo_seconds``/``rto_seconds`` are the owner's 1 h / 4 h; the keep windows are the
    owner's 7 days for hourly captures and 30 days for daily ones.
    """

    rpo_seconds: int = RPO_SECONDS
    rto_seconds: int = RTO_SECONDS
    hourly_keep_days: int = HOURLY_KEEP_DAYS
    daily_keep_days: int = DAILY_KEEP_DAYS

    def keep_days(self, kind: str) -> int:
        require_backup_kind(kind)
        return self.hourly_keep_days if kind == KIND_HOURLY else self.daily_keep_days

    def keep_window(self, kind: str) -> timedelta:
        return timedelta(days=self.keep_days(kind))


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


@dataclass(frozen=True)
class PurgeReport:
    """What a tenant purge did: counts only, never a key."""

    tenant: str
    first_pass_deleted: int
    second_pass_deleted: int
    delete_errors: int
    remaining: int

    def as_dict(self) -> dict[str, object]:
        return {
            'tenant': self.tenant,
            'first_pass_deleted': self.first_pass_deleted,
            'second_pass_deleted': self.second_pass_deleted,
            'delete_errors': self.delete_errors,
            'remaining': self.remaining,
        }


def capture(
    *,
    store: ObjectStore,
    tenant: str,
    source: snapshot.CaptureSource,
    kind: str,
    work_root: Path,
    passphrase_file: Path,
    now: datetime | None = None,
    runner: Callable[..., object] = subprocess.run,
) -> BackupManifest:
    """Capture, encrypt and upload one artifact; the manifest is uploaded last.

    Everything is staged under ``work_root`` in a private directory and the store only ever
    receives fully encrypted bytes. A failure at any step raises and leaves no manifest
    behind, so the presence of a manifest in the bucket means the whole artifact arrived.
    """
    require_tenant(tenant)
    require_kind(kind)
    # P6 condition: this check rejects `bucket=None` for a tenant, but an empty BucketSource
    # listing still produces `contents_object_count=0` (same shape as database-only). P6 must
    # compare the `store_fname` keys the database references against the index and refuse a
    # shortfall, so a tenant capture can never pass as database-only.
    require(
        (source.bucket is None) == (tenant == CONTROL_PLANE_SOURCE),
        f'{CONTROL_PLANE_SOURCE!r} is the one database-only source, and only it is database-only',
    )
    captured_at = as_utc(now)
    require(work_root.is_absolute(), 'the work root must be an absolute path')
    artifact.require_passphrase_file(passphrase_file)
    prefix = artifact.artifact_prefix(tenant, kind, captured_at)
    require(not store.list(prefix), 'the backup store already holds objects for this capture stamp')
    work_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='capture-', dir=work_root) as private:
        staging = Path(private) / 'snapshot'
        plain_tar = Path(private) / artifact.ARTIFACT_NAME
        snapshot_payload = snapshot.snapshot(source, staging, runner=runner)
        plaintext_sha256 = artifact.archive_snapshot(staging, plain_tar)

        ciphertext = Path(private) / artifact.ARTIFACT_CIPHERTEXT_NAME
        ciphertext_sha256 = artifact.encrypt_file(
            plain_tar, ciphertext, passphrase_file=passphrase_file, runner=runner,
        )
        manifest = BackupManifest(
            tenant=tenant,
            kind=kind,
            captured_at=captured_at,
            plaintext_sha256=plaintext_sha256,
            ciphertext_sha256=ciphertext_sha256,
            plaintext_bytes=plain_tar.stat().st_size,
            ciphertext_bytes=ciphertext.stat().st_size,
            database_sha256=snapshot_payload['database_sha256'],
            contents_sha256=snapshot_payload['contents_sha256'],
            contents_object_count=snapshot_payload['contents_object_count'],
            contents_object_bytes=snapshot_payload['contents_object_bytes'],
        )
        manifest_bytes = manifest.to_json(passphrase_file).encode('utf-8')
        listing = artifact.checksums(
            (manifest.ciphertext_sha256, artifact.sha256_bytes(manifest_bytes)),
            (artifact.ARTIFACT_CIPHERTEXT_NAME, artifact.MANIFEST_NAME),
        )

        # The manifest is the success marker: upload it only once the artifact and the
        # checksum listing are durable.
        store.put_file(prefix + artifact.ARTIFACT_CIPHERTEXT_NAME, ciphertext)
        store.put(prefix + artifact.CHECKSUMS_NAME, listing.encode('utf-8'))
        store.put(prefix + artifact.MANIFEST_NAME, manifest_bytes)
    return manifest


def prune(
    store: ObjectStore,
    tenant: str,
    now: datetime | None = None,
    policy: RetentionPolicy | None = None,
) -> PruneReport:
    """Delete artifacts beyond the window, but never the newest of a kind.

    The newest hourly and the newest daily survive whatever their age: a pipeline that
    emptied a bucket because every capture predated its window would make the RPO
    permanently unrecoverable, so the last copy of each kind always stays. Every object of
    a kept artifact is kept with it, so a prune never leaves an artifact without its
    manifest or its checksum listing. A ``candidate`` artifact is outside both windows and
    is kept as an unrecognised object: only the tenant purge deletes it.
    """
    require_tenant(tenant)
    current = as_utc(now)
    active = policy or RetentionPolicy()
    reasons: dict[str, str] = {}
    for kind, artifacts in artifact.footprints(store, tenant).items():
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


def purge_tenant(
    store: ObjectStore,
    tenant_id: str,
    settle_seconds: float,
    *,
    sleep: Callable[[float], object] = time.sleep,
) -> PurgeReport:
    """Delete every object under ``<tenant id>/``, wait, delete again, then require an empty prefix.

    The second pass exists because a capture that was running when the tenant was retired
    may upload after the first pass. Retention (:func:`prune`) always keeps the newest of
    each kind, so deleting a tenant's backups is a separate operation with a separate
    command. Fails with :class:`PurgeIncompleteError` unless a final listing is empty.
    Versioned or replicated buckets keep earlier versions this function cannot see.
    """
    _require_purgeable_tenant(tenant_id)
    require(isinstance(settle_seconds, (int, float)) and not isinstance(settle_seconds, bool)
            and 0 <= settle_seconds <= MAXIMUM_PURGE_SETTLE_SECONDS,
            f'settle seconds must be between 0 and {MAXIMUM_PURGE_SETTLE_SECONDS:.0f}')
    prefix = f'{tenant_id}/'
    first, first_errors = _purge_pass(store, prefix)
    sleep(settle_seconds)
    second, second_errors = _purge_pass(store, prefix)
    remaining = store.list(prefix)
    require(all(key.startswith(prefix) for key in remaining), 'the store listed a key outside the tenant prefix')
    report = PurgeReport(tenant_id, first, second, first_errors + second_errors, len(remaining))
    if remaining:
        raise PurgeIncompleteError(report)
    return report


def newest_age(
    store: ObjectStore,
    source: str,
    now: datetime | None = None,
    policy: RetentionPolicy | None = None,
) -> dict[str, object]:
    """How old the newest complete artifact of one source is, and whether that is stale.

    A source with no complete artifact is stale with a ``None`` age: nothing was ever
    proven restorable from it. This is the number the ``backup_stale`` alert needs.
    """
    current = as_utc(now)
    ref = latest_artifact(store, source)
    age = None if ref is None else (current - ref.captured_at).total_seconds()
    limit = (policy or RetentionPolicy()).rpo_seconds
    return {
        'source': source,
        'newest_captured_at': None if ref is None else ref.captured_at.isoformat(),
        'newest_kind': None if ref is None else ref.kind,
        'age_seconds': age,
        'rpo_seconds': limit,
        'stale': age is None or not 0 <= age <= limit,
    }


def status(*, record: Path, now: datetime | None = None) -> dict[str, object]:
    """The recovery picture an operator reads, all of it from the drill record.

    ``last_backup_age_seconds`` is the age of the data the drill proved restorable — the
    artifact's capture time, not the moment the drill finished — because that is what the
    RPO is about. Every field is ``None`` or ``False`` before the first drill: a repository
    that never ran one reports no proof instead of a guess.
    """
    current = as_utc(now)
    active = RetentionPolicy()
    drill_record = load_drill_record(record)
    captured_at = _record_timestamp(drill_record, 'artifact_captured_at') if drill_record else None
    finished_at = _record_timestamp(drill_record, 'finished_at') if drill_record else None
    started_at = _record_timestamp(drill_record, 'started_at') if drill_record else None
    elapsed_seconds = _elapsed_seconds(drill_record) if drill_record else None
    rpo_ok, rto_ok = recovery_objectives(captured_at, started_at, elapsed_seconds, active)
    if drill_record:
        rpo_ok = rpo_ok and drill_record.get('rpo_ok') is not False
        rto_ok = rto_ok and drill_record.get('rto_ok') is not False
    freshness = None if finished_at is None else (current - finished_at).total_seconds()
    verified = (
        drill_record is not None and drill_record.get('restore_verified') is True
        and rpo_ok and rto_ok and freshness is not None
        and 0 <= freshness <= active.rpo_seconds
    )
    age_seconds = None if captured_at is None else (current - captured_at).total_seconds()
    return {
        'record_exists': drill_record is not None,
        'rpo_ok': rpo_ok,
        'rto_ok': rto_ok,
        'restore_verified': verified,
        'last_backup_age_seconds': age_seconds,
        'artifact_captured_at': None if captured_at is None else captured_at.isoformat(),
        'finished_at': None if finished_at is None else finished_at.isoformat(),
    }


def recovery_objectives(
    captured_at: datetime | None,
    started_at: datetime | None,
    elapsed_seconds: float | None,
    policy: RetentionPolicy,
) -> tuple[bool, bool]:
    """Measure data lost at the drill start and time spent restoring independently."""
    age = None if captured_at is None or started_at is None else (started_at - captured_at).total_seconds()
    return (
        age is not None and 0 <= age <= policy.rpo_seconds,
        elapsed_seconds is not None and 0 <= elapsed_seconds <= policy.rto_seconds,
    )


def load_drill_record(record_path: Path) -> dict[str, object] | None:
    """The drill record, or ``None`` when it is absent or unreadable.

    An unreadable record is not an error to shout about and certainly not a pass: a record
    nobody can parse proves nothing, so it reads as "no verified restore".
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


def _elapsed_seconds(record: Mapping[str, object]) -> float | None:
    """The drill's measured duration, or ``None`` when the record has no number."""
    raw = record.get('elapsed_seconds')
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return float(raw)


def _require_purgeable_tenant(tenant_id: str) -> str:
    """The registry id of a retired tenant, or a refusal; nothing else may name a prefix to empty."""
    require(isinstance(tenant_id, str) and bool(tenant_id), 'a purge needs a tenant id')
    require('/' not in tenant_id, 'a tenant id never contains a slash')
    require(bool(REGISTRY_TENANT_RE.fullmatch(tenant_id)),
            f'tenant id must match the registry format {REGISTRY_TENANT_RE.pattern}')
    require(tenant_id != CONTROL_PLANE_SOURCE,
            f'{CONTROL_PLANE_SOURCE!r} is the control plane backup source, never a tenant')
    return tenant_id


def _purge_pass(store: ObjectStore, prefix: str) -> tuple[int, int]:
    """Delete everything listed under the prefix until a listing is empty or stops shrinking.

    A store may answer a listing with one page; repeating until the listing is empty covers a
    prefix larger than a page. A delete that fails (a store that raises for a key another
    process removed first) is counted, not trusted: the caller's final listing decides
    whether the prefix is empty.
    """
    deleted = errors = 0
    previous: list[str] | None = None
    for _round in range(MAXIMUM_PURGE_ROUNDS):
        keys = store.list(prefix)
        require(all(key.startswith(prefix) for key in keys), 'the store listed a key outside the tenant prefix')
        if not keys or keys == previous:
            # Empty, or the same keys again after a delete pass: the store is not deleting,
            # so stop and let the final listing report what is left.
            return deleted, errors
        previous = keys
        for key in keys:
            try:
                store.delete(key)
            except s3_client.StorageError:
                errors += 1
            else:
                deleted += 1
    return deleted, errors
