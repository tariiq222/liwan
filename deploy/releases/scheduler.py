# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Trusted booking admission into the existing release engine.

The gateway lists *all* running bookings plus due scheduled bookings across the
operator's tenants. Its claim and transition operations are committed Odoo CAS
transactions, using _webvue_transition under the trusted local operator context.
No customer session, Odoo import, second rollout engine or scheduling DB exists
here. One shared ReleaseState scheduler lock serializes admission processes.

A running booking's revision is exactly its approved scheduled revision + 1.
That invariant supplies a stable request id after a crash. Running work is
reconciled from durable receipts only: this scheduler never replays migration
or interrupts it because a customer window ended. Draining remains running;
missing/intermediate receipts hold capacity for operator review.
"""
from __future__ import annotations

import hashlib
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from importlib import import_module
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping


class BookingConflict(RuntimeError):
    """The trusted ORM CAS lost to another booking operation."""


@dataclass(frozen=True)
class BookingRef:
    tenant_id: str
    booking_id: int


@dataclass(frozen=True)
class ReleaseNotice:
    release_id: str
    deadline_at: datetime
    estimated_seconds: int
    scope: str
    status: str


@dataclass(frozen=True)
class Booking:
    ref: BookingRef
    revision: int
    status: str
    scheduled_at: datetime
    duration_minutes: int
    notice: ReleaseNotice


@dataclass(frozen=True)
class ReleaseTarget:
    manifest: Mapping
    manifest_digest: str
    target_pool: str
    approved_mode: str


@dataclass(frozen=True)
class PlannedRollout:
    request: dict
    manifest: Mapping


class BookingGateway(Protocol):
    """All datetimes are UTC (aware, or Odoo's naive UTC representation).

    due MUST include every running booking regardless of its scheduled time.
    claim MUST freshly check scheduled status, revision, time, deadline and
    supported tenant notice atomically before _webvue_transition('running', rev).
    Known CAS/status races become BookingConflict; service failures propagate.
    transition MUST invoke _webvue_transition(status, rev) and commit atomically.
    Neither operation may return before its Odoo transaction has committed.
    """

    def due(self, now: datetime) -> list[BookingRef]: ...
    def snapshot(self, ref: BookingRef) -> Booking | None: ...
    def claim(self, ref: BookingRef, revision: int, now: datetime) -> Booking: ...
    def transition(self, ref: BookingRef, revision: int, status: str) -> Booking: ...


def request_id(ref: BookingRef, scheduled_revision: int) -> str:
    if (not isinstance(ref.tenant_id, str) or not ref.tenant_id
            or type(ref.booking_id) is not int or not 1 <= ref.booking_id <= 2147483647
            or type(scheduled_revision) is not int or not 1 <= scheduled_revision <= 2147483647):
        msg = 'booking_identity_invalid'
        raise ValueError(msg)
    # Database-local Odoo ids collide across tenants; the tenant digest binds
    # the request to one tenant while remaining inside ReleaseState's 63 chars.
    tenant = hashlib.sha256(ref.tenant_id.encode()).hexdigest()[:16]
    return f'booking_{ref.booking_id}_r{scheduled_revision}_{tenant}'


def _utc(value: datetime) -> datetime:
    if not isinstance(value, datetime):
        msg = 'booking_datetime_invalid'
        raise TypeError(msg)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class ReleaseEngineAdapter:
    """Delegates plan/apply/receipt to the SAME injected ReleaseEngine instance.

    targets is trusted immutable operator configuration, keyed by the exact
    notice release id. Digests use the engine's canonical manifest validator.
    An injected digest function exists solely for isolated contract tests.
    """

    def __init__(self, engine, targets: Mapping[str, ReleaseTarget], *, manifest_digest=None):
        if manifest_digest is None:
            manifest_digest = import_module(__package__ + '.manifest').manifest_digest
        self.engine = engine
        self.targets = {
            key: ReleaseTarget(deepcopy(value.manifest), value.manifest_digest, value.target_pool, value.approved_mode)
            for key, value in targets.items()
        }
        self.manifest_digest = manifest_digest

    def locked(self):
        return self.engine.state.locked('maintenance_scheduler')

    def plan(self, booking: Booking) -> PlannedRollout:
        target = self.targets.get(booking.notice.release_id)
        if (target is None or target.manifest.get('releaseId') != booking.notice.release_id
                or target.manifest.get('mode') != target.approved_mode
                or self.manifest_digest(target.manifest) != target.manifest_digest):
            msg = 'booking_release_manifest_mismatch'
            raise ValueError(msg)
        route = self.engine.state.route(booking.ref.tenant_id)
        request = {
            'requestId': request_id(booking.ref, booking.revision),
            'manifestDigest': target.manifest_digest,
            'tenantIds': [booking.ref.tenant_id],
            'expectedRoutes': {booking.ref.tenant_id: route['routeRevision']},
            'targetPool': target.target_pool,
            'approvedMode': target.approved_mode,
        }
        manifest = deepcopy(target.manifest)
        self.engine.plan(request, manifest)
        return PlannedRollout(request, manifest)

    def apply(self, plan: PlannedRollout):
        return self.engine.apply(plan.request, plan.manifest)

    def receipt(self, ident: str):
        try:
            return self.engine.state.receipt(ident)
        except RuntimeError as error:
            if str(error) == 'release_request_missing':
                return None
            raise


class MaintenanceScheduler:
    def __init__(self, gateway: BookingGateway, engine: ReleaseEngineAdapter, *, capacity=1,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        if type(capacity) is not int or capacity < 1:
            msg = 'scheduler_capacity_invalid'
            raise ValueError(msg)
        self.gateway, self.engine = gateway, engine
        self.capacity, self.clock = capacity, clock

    def _result(self, item, outcome, reason=None, ident=None, **details):
        return {'tenantId': item.ref.tenant_id, 'bookingId': item.ref.booking_id,
                'requestId': ident, 'outcome': outcome, **({'reason': reason} if reason else {}), **details}

    def _eligible(self, item, now):
        if item.status != 'scheduled':
            return 'booking_changed'
        if item.notice.scope != 'tenant' or item.notice.status != 'supported':
            return 'release_not_bookable'
        if (type(item.duration_minutes) is not int or not 1 <= item.duration_minutes <= 1440
                or type(item.notice.estimated_seconds) is not int or item.notice.estimated_seconds <= 0):
            return 'window_invalid'
        end = _utc(item.scheduled_at) + timedelta(minutes=item.duration_minutes)
        if end > _utc(item.notice.deadline_at):
            return 'deadline_exceeded'
        if _utc(item.scheduled_at) > now:
            return 'not_due'
        if now + timedelta(seconds=item.notice.estimated_seconds) > end:
            return 'window_insufficient'
        return None

    def _active_count(self):
        refs = dict.fromkeys(self.gateway.due(_utc(self.clock())))
        return sum(1 for ref in refs if (item := self.gateway.snapshot(ref)) and item.status == 'running')

    def _reconcile(self, item, ident, *, error_type=None):
        receipt = self.engine.receipt(ident)
        extra = {'errorType': error_type} if error_type else {}
        if receipt is None:
            return self._result(item, 'needs_intervention', 'receipt_missing', ident, **extra)
        operations = receipt.get('tenants', [])
        stage = receipt.get('stage')
        if (receipt.get('requestId') != ident or len(operations) != 1
                or operations[0].get('tenant_id') != item.ref.tenant_id
                or operations[0].get('stage') != stage):
            return self._result(item, 'needs_intervention', 'receipt_ambiguous', ident, **extra)
        if stage == 'draining_old':
            return self._result(item, 'running', ident=ident, stage=stage, **extra)
        if stage not in {'verified', 'needs_intervention'}:
            return self._result(item, 'needs_intervention', 'receipt_incomplete', ident, stage=stage, **extra)
        status = 'complete' if stage == 'verified' else 'failed'
        try:
            self.gateway.transition(item.ref, item.revision, status)
        except BookingConflict:
            return self._result(item, 'skipped', 'booking_changed', ident, **extra)
        return self._result(item, status, ident=ident, stage=stage, **extra)

    def run_once(self):
        """One bounded pass; no sleeps, background jobs or automatic API retries."""
        with self.engine.locked():
            snapshots = [self.gateway.snapshot(ref) for ref in dict.fromkeys(self.gateway.due(_utc(self.clock())))]
            snapshots = [item for item in snapshots if item is not None]
            results = []
            # Reconcile running receipts first so verified work releases capacity.
            for candidate in sorted(snapshots, key=lambda item: item.status != 'running'):
                item = self.gateway.snapshot(candidate.ref)
                if item is None:
                    continue
                if item.status == 'running':
                    ident = request_id(item.ref, item.revision - 1)
                    results.append(self._reconcile(item, ident))
                    continue
                reason = self._eligible(item, _utc(self.clock()))
                if reason:
                    results.append(self._result(item, 'skipped', reason))
                    continue
                if self._active_count() >= self.capacity:
                    results.append(self._result(item, 'skipped', 'capacity_full'))
                    continue
                try:
                    plan = self.engine.plan(item)
                except (RuntimeError, ValueError, OSError) as error:
                    results.append(self._result(item, 'skipped', 'preflight_failed', errorType=type(error).__name__))
                    continue
                fresh = self.gateway.snapshot(item.ref)
                if fresh != item:
                    results.append(self._result(item, 'skipped', 'booking_changed'))
                    continue
                now = _utc(self.clock())
                reason = self._eligible(fresh, now)
                if reason or self._active_count() >= self.capacity:
                    results.append(self._result(item, 'skipped', reason or 'capacity_full'))
                    continue
                try:
                    claimed = self.gateway.claim(item.ref, item.revision, now)
                except BookingConflict:
                    results.append(self._result(item, 'skipped', 'booking_changed'))
                    continue
                ident = plan.request['requestId']
                if (claimed.ref != item.ref or claimed.status != 'running'
                        or claimed.revision != item.revision + 1
                        or claimed.notice != item.notice or claimed.scheduled_at != item.scheduled_at
                        or claimed.duration_minutes != item.duration_minutes):
                    results.append(self._result(item, 'needs_intervention', 'claim_ambiguous', ident))
                    continue
                error_type = None
                try:
                    self.engine.apply(plan)
                except (RuntimeError, ValueError, OSError) as error:
                    # A durable failed/intermediate receipt decides the next state;
                    # an exception alone never authorizes a retry or forced rollback.
                    error_type = type(error).__name__
                results.append(self._reconcile(claimed, ident, error_type=error_type))
            return results
