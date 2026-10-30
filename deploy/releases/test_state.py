# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from pathlib import Path
import tempfile
import unittest

from deploy.releases.state import ReleaseState, ReleaseConflict


class ReleaseStateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.state = ReleaseState(self.root)
        self.binding = {'tenantId': 'tenant_a', 'database': 'liwan_scratch_release_a', 'filestore': 'liwan_scratch_release_a', 'registryRevision': 1}
        self.route = {'schemaVersion': 1, 'tenantId': 'tenant_a', 'identityRevision': 1, 'routeRevision': 1, 'releaseId': 'r1', 'poolId': 'blue', 'fence': 1, 'state': 'serving'}
        self.state.register(self.binding, self.route)

    def test_cas_refuses_stale_route_and_keeps_other_tenant_independent(self):
        target = {**self.route, 'routeRevision': 2, 'releaseId': 'r2', 'poolId': 'green', 'fence': 2}
        self.state.publish(target, expected_revision=1)
        with self.assertRaises(ReleaseConflict):
            self.state.publish({**target, 'routeRevision': 3}, expected_revision=1)
        self.assertEqual(self.state.route('tenant_a')['poolId'], 'green')
        self.assertFalse((self.root / 'routes' / 'tenant_a.maintenance').exists())

    def test_maintenance_is_durable_and_cannot_be_cleared_by_wrong_fence(self):
        self.state.maintenance('tenant_a', 1)
        reopened = ReleaseState(self.root)
        self.assertTrue((self.root / 'routes' / 'tenant_a.maintenance').exists())
        with self.assertRaises(ReleaseConflict):
            reopened.resume('tenant_a', 2)
        reopened.resume('tenant_a', 1)
        self.assertFalse((self.root / 'routes' / 'tenant_a.maintenance').exists())

    def test_crash_after_atomic_publication_reconciles_without_old_fallback(self):
        target = {**self.route, 'routeRevision': 2, 'releaseId': 'r2', 'poolId': 'green', 'fence': 2}
        def crash(stage):
            if stage == 'published':
                raise RuntimeError('power_loss')
        with self.assertRaises(RuntimeError):
            self.state.publish(target, expected_revision=1, checkpoint=crash)
        reopened = ReleaseState(self.root)
        reopened.reconcile('tenant_a')
        self.assertEqual(reopened.route('tenant_a')['routeRevision'], 2)
        self.assertEqual(json.loads((self.root / 'routes/tenant_a.json').read_text())['poolId'], 'green')

    def test_draining_authorization_survives_coordinator_restart(self):
        prior = {key: self.route[key] for key in ('releaseId', 'poolId', 'routeRevision', 'fence')}
        next_route = {**self.route, 'routeRevision': 2, 'releaseId': 'r2', 'poolId': 'green', 'fence': 2, 'draining': [prior]}
        self.state.publish(next_route, expected_revision=1)
        self.assertEqual(ReleaseState(self.root).route('tenant_a')['draining'], [prior])

    def test_untrusted_names_and_rebinding_are_refused(self):
        with self.assertRaises(ValueError):
            self.state.maintenance('../tenant_a', 1)
        with self.assertRaises(ReleaseConflict):
            self.state.register({**self.binding, 'database': 'other'}, self.route)

    def test_payload_reuse_does_not_repeat_or_change_request(self):
        self.state.request('request_a', {'releaseId': 'r2'})
        self.state.request('request_a', {'releaseId': 'r2'})
        with self.assertRaises(ReleaseConflict):
            self.state.request('request_a', {'releaseId': 'r3'})


if __name__ == '__main__':
    unittest.main()
