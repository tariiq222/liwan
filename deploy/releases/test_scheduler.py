# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Synthetic booking/engine contracts; no Odoo connection or runtime process."""
import hashlib
import json
import unittest
from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from .scheduler import (
    Booking,
    BookingConflict,
    BookingRef,
    MaintenanceScheduler,
    ReleaseEngineAdapter,
    ReleaseNotice,
    ReleaseTarget,
    request_id,
)

UTC = timezone.utc


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def booking(tenant='tenant_a', ident=1, *, at=None, status='scheduled', revision=1):
    at = at or datetime(2030, 1, 1, 12, tzinfo=UTC)
    return Booking(BookingRef(tenant, ident), revision, status, at, 60,
                   ReleaseNotice('release_2', at + timedelta(days=1), 120, 'tenant', 'supported'))


class Gateway:
    def __init__(self, *records):
        self.records = {item.ref: item for item in records}
        self.claims = []
        self.transitions = []
        self.on_claim = None

    def due(self, now):
        return [item.ref for item in self.records.values() if item.status == 'running' or (item.status == 'scheduled' and item.scheduled_at <= now)]

    def snapshot(self, ref):
        return self.records.get(ref)

    def claim(self, ref, revision, now):
        if self.on_claim:
            self.on_claim(ref)
        item = self.records[ref]
        if item.revision != revision or item.status != 'scheduled':
            msg = 'booking_changed'
            raise BookingConflict(msg)
        self.claims.append((ref, revision))
        item = replace(item, status='running', revision=revision + 1)
        self.records[ref] = item
        return item

    def transition(self, ref, revision, status):
        item = self.records[ref]
        if item.revision != revision or item.status != 'running':
            msg = 'booking_changed'
            raise BookingConflict(msg)
        self.transitions.append((ref, revision, status))
        self.records[ref] = replace(item, revision=revision + 1, status=status)
        return self.records[ref]


class State:
    def __init__(self):
        self.receipts = {}
        self.route_revision = 4

    def locked(self, name):
        return nullcontext()

    def route(self, tenant):
        return {'tenantId': tenant, 'routeRevision': self.route_revision}

    def receipt(self, ident):
        if ident not in self.receipts:
            msg = 'release_request_missing'
            raise RuntimeError(msg)
        return self.receipts[ident]


class Engine:
    def __init__(self):
        self.state = State()
        self.plans = []
        self.applies = []
        self.on_plan = None
        self.on_apply = None
        self.stage = 'verified'
        self.plan_error = False
        self.apply_error = False

    def plan(self, request, manifest):
        self.plans.append((request, manifest))
        if self.on_plan:
            self.on_plan(request)
        if self.plan_error:
            msg = 'preflight_failed'
            raise RuntimeError(msg)
        return {'requestId': request['requestId']}

    def apply(self, request, manifest):
        self.applies.append((request, manifest))
        if self.on_apply:
            self.on_apply(request)
        receipt = {'requestId': request['requestId'], 'stage': self.stage,
                   'tenants': [{'tenant_id': request['tenantIds'][0], 'stage': self.stage}]}
        self.state.receipts[request['requestId']] = receipt
        if self.apply_error:
            msg = 'migration_failed'
            raise RuntimeError(msg)
        return receipt


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2030, 1, 1, 12, tzinfo=UTC)
        self.engine = Engine()
        self.manifest = {'releaseId': 'release_2', 'mode': 'tenant_maintenance'}
        self.targets = {'release_2': ReleaseTarget(self.manifest, digest(self.manifest), 'green', 'tenant_maintenance')}
        self.adapter = ReleaseEngineAdapter(self.engine, self.targets, manifest_digest=digest)

    def scheduler(self, gateway, capacity=1):
        return MaintenanceScheduler(gateway, self.adapter, capacity=capacity, clock=lambda: self.now)

    def receipt(self, item, stage):
        ident = request_id(item.ref, item.revision - 1)
        self.engine.state.receipts[ident] = {'requestId': ident, 'stage': stage, 'tenants': [{'tenant_id': item.ref.tenant_id, 'stage': stage}]}

    def test_two_tenants_use_their_own_slots_and_request_identity(self):
        first = booking(at=self.now)
        second = booking('tenant_b', at=self.now + timedelta(hours=2))
        gateway = Gateway(first, second)
        self.scheduler(gateway).run_once()
        self.assertEqual(gateway.records[first.ref].status, 'complete')
        self.assertEqual(gateway.records[second.ref].status, 'scheduled')
        self.now += timedelta(hours=2)
        self.scheduler(gateway).run_once()
        self.assertEqual(gateway.records[second.ref].status, 'complete')
        self.assertNotEqual(self.engine.applies[0][0]['requestId'], self.engine.applies[1][0]['requestId'])
        self.assertEqual(self.engine.applies[0][0]['tenantIds'], ['tenant_a'])
        self.assertEqual(self.engine.applies[0][0]['expectedRoutes'], {'tenant_a': 4})
        self.assertEqual(self.engine.applies[0][0]['manifestDigest'], digest(self.manifest))
        self.assertEqual(self.engine.applies[0][0]['targetPool'], 'green')

    def test_cancellation_between_preflight_and_claim_wins(self):
        item = booking(at=self.now)
        gateway = Gateway(item)
        self.engine.on_plan = lambda _: gateway.records.update({item.ref: replace(item, status='cancelled', revision=2)})
        result = self.scheduler(gateway).run_once()
        self.assertEqual(result[0]['reason'], 'booking_changed')
        self.assertEqual(gateway.claims, [])
        self.assertEqual(self.engine.applies, [])

    def test_atomic_claim_rejects_last_moment_revision_race(self):
        item = booking(at=self.now)
        gateway = Gateway(item)
        gateway.on_claim = lambda ref: gateway.records.update({ref: replace(item, revision=2)})
        result = self.scheduler(gateway).run_once()
        self.assertEqual(result[0]['reason'], 'booking_changed')
        self.assertEqual(self.engine.applies, [])

    def test_capacity_is_checked_before_claim_and_draining_holds_it(self):
        a, b = booking(at=self.now), booking('tenant_b', at=self.now)
        gateway = Gateway(a, b)
        self.engine.stage = 'draining_old'
        result = self.scheduler(gateway).run_once()
        self.assertEqual(gateway.records[a.ref].status, 'running')
        self.assertEqual(gateway.records[b.ref].status, 'scheduled')
        self.assertEqual(result[1]['reason'], 'capacity_full')
        self.assertEqual(len(self.engine.plans), 1)
        running = gateway.records[a.ref]
        self.receipt(running, 'verified')
        self.engine.stage = 'verified'
        self.scheduler(gateway).run_once()
        self.assertEqual(gateway.records[b.ref].status, 'complete')

    def test_preflight_failure_does_not_claim_the_booking(self):
        gateway = Gateway(booking(at=self.now))
        self.engine.plan_error = True
        result = self.scheduler(gateway).run_once()
        self.assertEqual(result[0]['reason'], 'preflight_failed')
        self.assertEqual(gateway.claims, [])
        self.assertEqual(self.engine.applies, [])

    def test_expired_insufficient_and_shared_windows_are_not_claimed(self):
        original = booking(at=self.now)
        variants = [
            replace(original, scheduled_at=self.now - timedelta(hours=2)),
            replace(original, scheduled_at=self.now - timedelta(minutes=59)),
            replace(original, notice=replace(original.notice, deadline_at=self.now + timedelta(seconds=30))),
            replace(original, notice=replace(original.notice, scope='ai_service')),
            replace(original, notice=replace(original.notice, status='withdrawn')),
        ]
        for item in variants:
            with self.subTest(item=item):
                gateway = Gateway(item)
                self.scheduler(gateway).run_once()
                self.assertEqual(gateway.claims, [])

    def test_running_restart_uses_receipt_without_reapplying_migration(self):
        for stage, expected in [('verified', 'complete'), ('needs_intervention', 'failed'), ('draining_old', 'running')]:
            with self.subTest(stage=stage):
                item = booking(at=self.now, status='running', revision=8)
                gateway = Gateway(item)
                self.receipt(item, stage)
                self.scheduler(gateway).run_once()
                self.assertEqual(gateway.records[item.ref].status, expected)
                self.assertEqual(self.engine.applies, [])
                self.assertEqual(self.engine.plans, [])

    def test_running_without_final_receipt_holds_capacity_for_operator_review(self):
        for stage in [None, 'migrating', 'planned']:
            with self.subTest(stage=stage):
                item = booking(at=self.now, status='running', revision=2)
                gateway = Gateway(item, booking('tenant_b', at=self.now))
                self.engine.state.receipts.clear()
                if stage:
                    self.receipt(item, stage)
                result = self.scheduler(gateway).run_once()
                self.assertEqual(gateway.records[item.ref].status, 'running')
                self.assertEqual(result[0]['outcome'], 'needs_intervention')
                self.assertEqual(result[1]['reason'], 'capacity_full')
                self.assertEqual(self.engine.applies, [])

    def test_migration_failure_is_recorded_once_and_never_replayed(self):
        item = booking(at=self.now)
        gateway = Gateway(item)
        self.engine.stage, self.engine.apply_error = 'needs_intervention', True
        self.scheduler(gateway).run_once()
        self.assertEqual(gateway.records[item.ref].status, 'failed')
        self.scheduler(gateway).run_once()
        self.assertEqual(len(self.engine.applies), 1)

    def test_window_end_does_not_interrupt_an_already_claimed_operation(self):
        item = booking(at=self.now)
        gateway = Gateway(item)
        self.engine.on_apply = lambda _: setattr(self, 'now', self.now + timedelta(hours=3))
        result = self.scheduler(gateway).run_once()
        self.assertEqual(result[0]['outcome'], 'complete')
        self.assertEqual(gateway.records[item.ref].status, 'complete')

    def test_config_must_pin_the_exact_notice_manifest(self):
        item = booking(at=self.now)
        for target in [replace(self.targets['release_2'], manifest_digest='bad'), replace(self.targets['release_2'], manifest={'releaseId': 'other', 'mode': 'tenant_maintenance'})]:
            with self.subTest(target=target):
                gateway = Gateway(item)
                adapter = ReleaseEngineAdapter(self.engine, {'release_2': target}, manifest_digest=digest)
                result = MaintenanceScheduler(gateway, adapter, clock=lambda: self.now).run_once()
                self.assertEqual(result[0]['reason'], 'preflight_failed')
                self.assertEqual(gateway.claims, [])

    def test_preflight_time_is_rechecked_before_claim(self):
        item = booking(at=self.now)
        gateway = Gateway(item)
        self.engine.on_plan = lambda _: setattr(self, 'now', self.now + timedelta(minutes=59))
        result = self.scheduler(gateway).run_once()
        self.assertEqual(result[0]['reason'], 'window_insufficient')
        self.assertEqual(gateway.claims, [])

    def test_capacity_changed_during_preflight_is_rechecked_before_claim(self):
        a = booking(at=self.now)
        b = booking('tenant_b', at=self.now + timedelta(hours=1))
        gateway = Gateway(a, b)
        self.engine.on_plan = lambda _: gateway.records.update({b.ref: replace(b, status='running', revision=2)})
        result = self.scheduler(gateway).run_once()
        self.assertEqual(result[0]['reason'], 'capacity_full')
        self.assertEqual(gateway.claims, [])

    def test_ambiguous_receipt_never_completes_another_tenants_booking(self):
        item = booking(at=self.now, status='running', revision=2)
        gateway = Gateway(item)
        self.receipt(item, 'verified')
        self.engine.state.receipts[request_id(item.ref, 1)]['tenants'][0]['tenant_id'] = 'tenant_b'
        result = self.scheduler(gateway).run_once()
        self.assertEqual(result[0]['reason'], 'receipt_ambiguous')
        self.assertEqual(gateway.transitions, [])
        self.assertEqual(gateway.records[item.ref].status, 'running')

    def test_capacity_is_an_explicit_positive_integer(self):
        for value in [0, -1, True, 1.5]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.scheduler(Gateway(), capacity=value)


if __name__ == '__main__':
    unittest.main()
