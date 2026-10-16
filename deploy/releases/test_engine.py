# Part of Odoo. See LICENSE file for full copyright and licensing details.
from pathlib import Path
import tempfile
import unittest

from .state import ReleaseState, ReleaseConflict
from .engine import ReleaseEngine
from .manifest import manifest_digest
from .test_manifest import release


class Runtime:
    def __init__(self, failure=None):
        self.failure = failure
        self.migrations = 0
        self.drained = True
    def prepare(self, binding, manifest, pool):
        return {'ready': True}
    def acknowledge(self, binding, route, maintenance=False):
        return {'ready': True, 'routeRevision': route['routeRevision'], 'maintenance': maintenance}
    def quiesce(self, binding, route):
        return {**binding, 'fence': route['fence'], 'gateClosed': True, 'admittedWriters': 0, 'activeTransactions': 0, 'oldConnections': 0}
    def capture(self, binding, proof):
        return {'digest': 'a' * 64, 'binding': binding, 'fence': proof['fence']}
    def migrate(self, binding, manifest, proof):
        self.migrations += 1
        if self.failure == 'migrate':
            raise RuntimeError('synthetic_migration_failure')
        return {'digest': 'b' * 64, 'fence': proof['fence']}
    def verify(self, binding, manifest, pool):
        return {'ready': self.failure != 'verify'}
    def activate_jobs(self,binding,current):
        return {'ready':True}
    def block_generation(self,binding,old):
        pass
    def retire(self, binding, old, new):
        return {'drained': self.drained}


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve(); self.state = ReleaseState(self.root)
        self.binding = {'tenantId': 'tenant_a', 'database': 'webvue_scratch_update_a', 'filestore': 'webvue_scratch_update_a', 'registryRevision': 1}
        self.old = {'schemaVersion': 1, 'tenantId': 'tenant_a', 'identityRevision': 1, 'routeRevision': 1, 'releaseId': 'r1', 'poolId': 'blue', 'fence': 1, 'state': 'serving'}
        self.state.register(self.binding, self.old)
    def request(self, manifest):
        return {'requestId': 'request_a', 'manifestDigest': manifest_digest(manifest), 'tenantIds': ['tenant_a'], 'expectedRoutes': {'tenant_a': 1}, 'approvedMode': manifest['mode'], 'targetPool': 'green'}
    def test_online_updates_route_and_never_runs_migration_or_maintenance(self):
        m = release(releaseId='r2'); runtime = Runtime(); engine = ReleaseEngine(self.state, runtime)
        request = self.request(m)
        result = engine.apply(request, m)
        self.assertEqual(result['stage'], 'verified')
        self.assertEqual(self.state.route('tenant_a')['poolId'], 'green')
        self.assertEqual(runtime.migrations, 0)
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())
        self.assertEqual(engine.apply(request,m)['stage'], 'verified')
    def test_migration_failure_keeps_target_closed_without_affecting_another_tenant(self):
        m = release(releaseId='r2', mode='tenant_maintenance', upgradeModules=['webvue_api'],moduleVersions={'webvue_api':'19.0.1.0.0'})
        runtime = Runtime('migrate'); engine = ReleaseEngine(self.state, runtime)
        with self.assertRaises(RuntimeError):
            engine.apply(self.request(m), m)
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())
        self.assertFalse((self.state.routes/'tenant_b.maintenance').exists())
        self.assertEqual(self.state.receipt('request_a')['stage'], 'needs_intervention')
        with self.assertRaises(ReleaseConflict):
            engine.apply(self.request(m),m)
        self.assertEqual(runtime.migrations, 1)
    def test_insufficient_drain_never_stops_old_pool_or_claims_verified(self):
        m=release(releaseId='r2'); runtime=Runtime();runtime.drained=False
        result=ReleaseEngine(self.state,runtime).apply(self.request(m),m)
        self.assertEqual(result['stage'],'draining_old')
        self.assertEqual(self.state.route('tenant_a')['draining'][0]['poolId'],'blue')
    def test_maintenance_retry_observes_retirement_again_instead_of_marking_verified(self):
        m=release(releaseId='r2',mode='tenant_maintenance',upgradeModules=['webvue_api'],moduleVersions={'webvue_api':'19.0.1.0.0'})
        runtime=Runtime();runtime.drained=False;engine=ReleaseEngine(self.state,runtime);request=self.request(m)
        self.assertEqual(engine.apply(request,m)['stage'],'draining_old')
        self.assertEqual(engine.apply(request,m)['stage'],'draining_old')
        runtime.drained=True
        self.assertEqual(engine.apply(request,m)['stage'],'verified')
        self.assertEqual(runtime.migrations,1)

    def test_unapproved_mode_or_stale_route_is_refused_before_changes(self):
        m=release(releaseId='r2');request=self.request(m);request['approvedMode']='tenant_maintenance'
        with self.assertRaises(ReleaseConflict):
            ReleaseEngine(self.state,Runtime()).apply(request,m)
        self.assertEqual(self.state.route('tenant_a')['routeRevision'],1)
    def test_maintenance_validates_before_resuming_and_switches_only_target(self):
        m=release(releaseId='r2',mode='tenant_maintenance',upgradeModules=['webvue_api'],moduleVersions={'webvue_api':'19.0.1.0.0'})
        runtime=Runtime();result=ReleaseEngine(self.state,runtime).apply(self.request(m),m)
        self.assertEqual(result['stage'],'verified')
        self.assertEqual(runtime.migrations,1)
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())


if __name__ == '__main__': unittest.main()
