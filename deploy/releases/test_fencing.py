"""Real filesystem admission/lease interlock, with no running services."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from . import fencing


def route(tenant='tenant_a', **changes):
    value = {'schemaVersion': 1, 'tenantId': tenant, 'identityRevision': 4, 'routeRevision': 2, 'poolId': 'blue',
             'releaseId': 'r1', 'fence': 8, 'state': 'serving'}
    value.update(changes)
    return value


class FencingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.binding = {'tenantId': 'tenant_a', 'registryRevision': 4, 'database': 'tenant_a'}
        (self.root / 'tenant_a.json').write_text(json.dumps(route()))
        self.env = patch.dict(os.environ, {'WEBVUE_RELEASE_ROUTES_DIR': str(self.root)})
        self.env.start(); self.addCleanup(self.env.stop)

    def test_lease_lives_through_real_subprocess_and_records_release_fence(self):
        marker = self.root / 'operation'
        with fencing.tenant_operation(self.binding, 'observe'):
            records = list((self.root / 'leases' / 'tenant_a').glob('*.json'))
            self.assertEqual(len(records), 1)
            saved = json.loads(records[0].read_text())
            self.assertEqual(saved['fence'], 8)
            self.assertEqual(saved['routeRevision'], 2)
            subprocess.run([sys.executable, '-c', 'from pathlib import Path; Path(' + repr(str(marker)) + ').write_text("ran")'], check=True)
            self.assertEqual(marker.read_text(), 'ran')
        self.assertFalse(list((self.root / 'leases' / 'tenant_a').glob('*.json')))

    def test_maintenance_and_missing_malformed_stale_routes_refuse_effect(self):
        for value in (None, {}, route(identityRevision=5), route(state='maintenance')):
            path = self.root / 'tenant_a.json'
            if value is None: path.unlink(missing_ok=True)
            else: path.write_text(json.dumps(value))
            with self.subTest(value=value), self.assertRaises(fencing.ReleaseOperationError):
                with fencing.tenant_operation(self.binding, 'observe'):
                    self.fail('business effect admitted')
        (self.root / 'tenant_a.json').write_text(json.dumps(route()))
        (self.root / 'tenant_a.maintenance').write_text('{}')
        with self.assertRaises(fencing.ReleaseOperationError):
            with fencing.tenant_operation(self.binding, 'observe'): self.fail('admitted')

    def test_barrier_created_after_lease_before_route_check_prevents_effect(self):
        created, resume = threading.Event(), threading.Event()
        result = []
        original = fencing._write_lease
        def paused(*args, **kwargs):
            value = original(*args, **kwargs)
            if kwargs.get('exclusive'):
                created.set(); self.assertTrue(resume.wait(5))
            return value
        def operate():
            try:
                with fencing.tenant_operation(self.binding, 'observe'): result.append('effect')
            except fencing.ReleaseOperationError: result.append('blocked')
        with patch.object(fencing, '_write_lease', paused):
            worker = threading.Thread(target=operate); worker.start()
            self.assertTrue(created.wait(5))
            self.assertEqual(len(list((self.root / 'leases' / 'tenant_a').glob('*.json'))), 1)
            (self.root / 'tenant_a.maintenance').write_text('{}')
            resume.set(); worker.join(5)
        self.assertEqual(result, ['blocked'])

    def test_existing_lease_is_not_reclaimed_and_does_not_block_other_tenant(self):
        with fencing.tenant_operation(self.binding, 'observe'):
            (self.root / 'tenant_b.json').write_text(json.dumps(route('tenant_b')))
            with fencing.tenant_operation({'tenantId': 'tenant_b', 'registryRevision': 4}, 'observe'):
                self.assertEqual(len(list((self.root / 'leases' / 'tenant_a').glob('*.json'))), 1)
        stale = self.root / 'leases' / 'tenant_a' / 'stale.json'
        stale.write_text('{}')
        with fencing.tenant_operation({'tenantId': 'tenant_b', 'registryRevision': 4}, 'observe'): pass
        self.assertTrue(stale.exists())

    def test_unrouted_provision_is_exclusive_and_obeys_barrier(self):
        (self.root / 'tenant_a.json').unlink()
        with fencing.tenant_operation(self.binding, 'provision', allow_unrouted=True):
            with self.assertRaises(fencing.ReleaseOperationError):
                with fencing.tenant_operation(self.binding, 'provision', allow_unrouted=True): self.fail('duplicate provision')
        (self.root / 'tenant_a.maintenance').write_text('{}')
        with self.assertRaises(fencing.ReleaseOperationError):
            with fencing.tenant_operation(self.binding, 'provision', allow_unrouted=True): self.fail('barrier bypass')

    def test_barrier_after_provision_lock_cleans_only_its_own_lock(self):
        (self.root / 'tenant_a.json').unlink()
        original = fencing._barrier
        checks = []
        def barrier(root, tenant):
            checks.append(True)
            if len(checks) == 2: (root / 'tenant_a.maintenance').write_text('{}')
            return original(root, tenant)
        with patch.object(fencing, '_barrier', barrier), self.assertRaises(fencing.ReleaseOperationError):
            with fencing.tenant_operation(self.binding, 'provision', allow_unrouted=True): self.fail('admitted')
        self.assertFalse((self.root / 'leases' / 'tenant_a' / 'provision.lock').exists())

    def test_forged_names_symlink_and_empty_config_fail_closed(self):
        with self.assertRaises(fencing.ReleaseOperationError):
            with fencing.tenant_operation({**self.binding, 'tenantId': '../escape'}, 'observe'): pass
        (self.root / 'tenant_a.json').unlink()
        (self.root / 'tenant_a.json').symlink_to(self.root / 'elsewhere')
        with self.assertRaises(fencing.ReleaseOperationError):
            with fencing.tenant_operation(self.binding, 'observe'): pass
        with patch.dict(os.environ, {'WEBVUE_RELEASE_ROUTES_DIR': ''}), self.assertRaises(fencing.ReleaseOperationError):
            with fencing.tenant_operation(self.binding, 'observe'): pass

    def test_unconfigured_legacy_path_needs_no_release_binding(self):
        with patch.dict(os.environ):
            del os.environ['WEBVUE_RELEASE_ROUTES_DIR']
            with fencing.tenant_operation({}, 'observe') as lease: self.assertIsNone(lease)


if __name__ == '__main__': unittest.main()
