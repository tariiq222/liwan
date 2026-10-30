"""Durable AI-only maintenance uses actual token-authenticated loopback HTTP observations."""
from contextlib import contextmanager
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from .manifest import manifest_digest, validate_manifest
from .state import ReleaseConflict, ReleaseState, atomic_json

TOKEN = 't' * 30
STATE_ID = 'state_' + 'a' * 32


def manifest(**changes):
    value = {'releaseId': 'r2', 'liwanCommit': '1' * 40, 'odooCommit': '2' * 40,
             'images': {'odoo': 'liwan/odoo@sha256:' + 'a' * 64, 'web': 'liwan/web@sha256:' + 'b' * 64},
             'assetsId': 'assets-1', 'moduleVersions': {}, 'upgradeModules': [], 'installModules': [],
             'mode': 'service_maintenance', 'affectedServices': ['ai'], 'aiStateVersion': '1',
             'compatibilityEvidence': {'reviewer': 'owner', 'reference': 'review-42'},
             'rollbackPolicy': {'oldWritesCompatible': False}}
    value.update(changes)
    return validate_manifest(value)


@contextmanager
def ai_server(**changes):
    observation = {'state_version': '1', 'accepting': True, 'drained': False, 'active_runs': 0, 'running': 0,
                   'claimed_writes': 0, 'pending_reads': 0, 'local_requests': 0, 'settling': 0,
                   'connections': {'pool_size': 1, 'pool_available': 1}, 'activity_scope': 'shared_state', 'state_id': STATE_ID, 'generation_id': None, **changes}
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def handle_call(self):
            calls.append((self.command, self.path, self.headers.get('x-liwan-service-token')))
            if self.headers.get('x-liwan-service-token') != TOKEN:
                self.send_error(401); return
            if self.path == '/internal/release/drain' and self.command == 'POST':
                observation['accepting'] = False
                observation['drained'] = all(observation.get(key) == 0 for key in ('active_runs', 'local_requests', 'settling'))
            elif self.path != '/internal/release/readiness' or self.command != 'GET':
                self.send_error(404); return
            payload = json.dumps(observation).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
        do_GET = do_POST = handle_call
        def log_message(self, *_args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        yield {'url': f'http://127.0.0.1:{server.server_port}', 'observation': observation, 'calls': calls}
    finally:
        server.shutdown(); server.server_close(); thread.join()


class AiMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve(); self.state = ReleaseState(self.root)
        for tenant, pool in (('a', 'blue'), ('b', 'blue')):
            self.state.register({'tenantId': tenant, 'database': 'liwan_scratch_' + tenant, 'filestore': 'liwan_scratch_' + tenant, 'registryRevision': 1},
                                {'schemaVersion': 1, 'tenantId': tenant, 'identityRevision': 1, 'routeRevision': 1,
                                 'releaseId': 'r1', 'poolId': pool, 'fence': 1, 'state': 'serving', 'aiStateVersion': '1'})
        self.token = self.root / 'ai-token'; self.token.write_text(TOKEN); self.token.chmod(0o600)
        self.marker = self.state.routes / 'ai.maintenance'
        self.m = manifest(); self.request = {'requestId': 'ai-window', 'manifestDigest': manifest_digest(self.m),
                                           'approvedMode': 'service_maintenance', 'tenantIds': ['a', 'b'], 'expectedRoutes': {'a': 1, 'b': 1}}
        self.migrations = []

    def setup_config(self, old, new):
        for fixture, generation in ((old, 'old'), (new, 'new')):
            if fixture['observation']['generation_id'] is None:
                fixture['observation']['generation_id'] = generation
        self.pools = {'schemaVersion': 1, 'pools': {'blue': {'poolId': 'blue', 'releaseId': 'r1', 'odooUrl': 'http://odoo.test',
                      'webUrl': 'http://web.test', 'wsUrl': 'http://ws.test', 'aiUrl': old['url'], 'aiStateVersion': '1'}}}
        atomic_json(self.state.routes / 'pools.json', self.pools)
        return {'sharedStateId': STATE_ID, 'tenantIds': ['a', 'b'], 'tokenFile': str(self.token), 'timeoutSeconds': 2,
                'oldServices': [{'id': 'old', 'url': old['url'], 'sharedStateId': STATE_ID, 'aiStateVersion': '1'}],
                'newServices': [{'id': 'new', 'url': new['url'], 'sharedStateId': STATE_ID, 'aiStateVersion': '1'}],
                'poolTargets': {'blue': 'new'}}

    def migration(self, failure=False, request_id='ai-window'):
        from .ai_maintenance import ReviewedAiMigration
        def action(context):
            self.assertTrue(self.marker.exists())
            self.assertEqual(context['sharedStateId'], STATE_ID)
            self.assertTrue(all(row['stage'] == 'migrating_ai' for row in self.state.receipt(request_id)['tenants']))
            self.migrations.append(context)
            if failure: raise RuntimeError('sensitive adapter failure text')
            return {'migrated': True, 'sharedStateId': STATE_ID, 'fromVersion': '1', 'toVersion': '1', 'digest': 'd' * 64}
        return ReviewedAiMigration(STATE_ID, '1', '1', 'owner-review', 'c' * 64, action)

    def coordinator(self, config, migration=None):
        from .ai_maintenance import AiMaintenanceCoordinator
        return AiMaintenanceCoordinator(self.state, config, migration)

    def test_actual_state_and_generation_identity_must_match_before_any_migration(self):
        for index, mismatch in enumerate(({'state_id': 'state_' + 'b' * 32}, {'generation_id': 'other-generation'},
                                           {'state_id': None}, {'generation_id': None})):
            with self.subTest(mismatch=mismatch), ai_server() as old, ai_server() as new:
                config = self.setup_config(old, new)
                new['observation'].update(mismatch)
                request = {**self.request, 'requestId': 'identity-window-' + str(index)}
                with self.assertRaises(ReleaseConflict):
                    self.coordinator(config, self.migration(request_id=request['requestId'])).apply(request, self.m)
                self.assertFalse(self.migrations)
                self.assertFalse(self.marker.exists())
                self.assertFalse(any(call[0] == 'POST' for call in old['calls']))

    def test_success_preserves_general_routes_publishes_only_ai_and_atomically_finishes_all_tenants(self):
        with ai_server() as old, ai_server() as new:
            config = self.setup_config(old, new); before = [self.state.route(t) for t in ('a', 'b')]
            engine = self.coordinator(config, self.migration()); receipt = engine.apply(self.request, self.m)
            self.assertEqual(receipt['stage'], 'verified'); self.assertEqual(len(self.migrations), 1)
            self.assertTrue(all(t['stage'] == 'verified' for t in receipt['tenants']))
            self.assertEqual([self.state.route(t) for t in ('a', 'b')], before)
            pools = json.loads((self.state.routes / 'pools.json').read_text())
            expected = copy.deepcopy(self.pools); expected['pools']['blue']['aiUrl'] = new['url']
            self.assertEqual(pools, expected); self.assertFalse(self.marker.exists())
            self.assertFalse(old['observation']['accepting']); self.assertTrue(new['observation']['accepting'])
            count = len(old['calls']) + len(new['calls'])
            self.assertEqual(engine.apply(self.request, self.m), receipt)
            self.assertEqual(len(old['calls']) + len(new['calls']), count)
            self.assertTrue(all(call[2] == TOKEN for call in old['calls'] + new['calls']))

    def test_missing_migration_blocks_before_barrier_or_http(self):
        with ai_server() as old, ai_server() as new:
            config = self.setup_config(old, new)
            with self.assertRaisesRegex(ReleaseConflict, 'ai_migration_adapter_unavailable'):
                self.coordinator(config).apply(self.request, self.m)
            self.assertFalse(self.marker.exists()); self.assertFalse(old['calls'] + new['calls'])

    def test_active_claim_retains_barrier_and_returns_draining_without_migration_or_kill(self):
        with ai_server(active_runs=1, claimed_writes=1) as old, ai_server() as new:
            config = self.setup_config(old, new); engine = self.coordinator(config, self.migration())
            receipt = engine.apply(self.request, self.m)
            self.assertEqual(receipt['stage'], 'draining_ai'); self.assertTrue(self.marker.exists()); self.assertFalse(self.migrations)
            self.assertEqual(json.loads((self.state.routes / 'pools.json').read_text()), self.pools)
            old['observation'].update(active_runs=0, claimed_writes=0)
            with self.assertRaisesRegex(ReleaseConflict, 'ai_maintenance_requires_reconciliation'):
                engine.apply(self.request, self.m)
            self.assertFalse(self.migrations)

    def test_migration_failure_keeps_barrier_and_retry_never_replays_effect(self):
        with ai_server() as old, ai_server() as new:
            engine = self.coordinator(self.setup_config(old, new), self.migration(failure=True))
            with self.assertRaisesRegex(ReleaseConflict, '^ai_maintenance_failed$'): engine.apply(self.request, self.m)
            self.assertTrue(self.marker.exists()); self.assertEqual(len(self.migrations), 1)
            receipt = self.state.receipt('ai-window'); self.assertEqual(receipt['stage'], 'needs_intervention')
            self.assertNotIn('sensitive', json.dumps(receipt))
            with self.assertRaisesRegex(ReleaseConflict, 'requires_reconciliation'): engine.apply(self.request, self.m)
            self.assertEqual(len(self.migrations), 1)

    def test_unknown_scope_missing_tenant_missing_target_and_future_version_fail_closed(self):
        with ai_server() as old, ai_server() as new:
            config = self.setup_config(old, new)
            for overrides in ({'sharedStateId': ''}, {'tenantIds': ['a']}, {'poolTargets': {}}, {'newServices': []}):
                with self.subTest(patch=overrides), self.assertRaises((ValueError, ReleaseConflict)):
                    self.coordinator({**config, **overrides}, self.migration()).apply(self.request, self.m)
                self.assertFalse(self.marker.exists())
            future = manifest(aiStateVersion='future')
            request = {**self.request, 'manifestDigest': manifest_digest(future)}
            with self.assertRaises((ValueError, ReleaseConflict)):
                self.coordinator(config, self.migration()).apply(request, future)
            self.assertFalse(self.marker.exists()); self.assertFalse(old['calls'] + new['calls'])

    def test_approval_scope_and_non_ai_manifest_cannot_enter_maintenance(self):
        with ai_server() as old, ai_server() as new:
            engine = self.coordinator(self.setup_config(old, new), self.migration())
            for overrides in ({'approvedMode': 'online'}, {'manifestDigest': '0' * 64}, {'tenantIds': ['a']}):
                with self.assertRaises((ValueError, ReleaseConflict)): engine.apply({**self.request, **overrides}, self.m)
            wrong = manifest(affectedServices=['ai', 'odoo'])
            with self.assertRaises((ValueError, ReleaseConflict)):
                engine.apply({**self.request, 'manifestDigest': manifest_digest(wrong)}, wrong)
            self.assertFalse(self.marker.exists()); self.assertFalse(old['calls'] + new['calls'])

    def test_unready_new_service_blocks_before_barrier_and_migration(self):
        with ai_server() as old, ai_server(state_version='future') as new:
            engine = self.coordinator(self.setup_config(old, new), self.migration())
            with self.assertRaises(ReleaseConflict): engine.apply(self.request, self.m)
            self.assertFalse(self.migrations); self.assertFalse(self.marker.exists())
            self.assertEqual(json.loads((self.state.routes / 'pools.json').read_text()), self.pools)

    def test_unobserved_state_and_inconsistent_counts_refuse_migration(self):
        for index, overrides in enumerate(({'activity_scope': 'memory_only'}, {'active_runs': 0, 'claimed_writes': 1}, {'settling': True})):
            with self.subTest(patch=overrides), ai_server(**overrides) as old, ai_server() as new:
                config = self.setup_config(old, new)
                request = {**self.request, 'requestId': 'window-malformed-' + str(index)}
                with self.assertRaises(ReleaseConflict): self.coordinator(config, self.migration()).apply(request, self.m)
                self.assertFalse(self.migrations)
                if self.marker.exists(): self.marker.unlink()

    def test_pool_publication_crash_keeps_barrier_and_no_migration_replay(self):
        with ai_server() as old, ai_server() as new:
            engine = self.coordinator(self.setup_config(old, new), self.migration())
            def crash(path, value):
                atomic_json(path, value)
                if Path(path).name == 'pools.json':
                    raise SystemExit('simulated crash')
            with patch('deploy.releases.ai_maintenance.atomic_json', crash), self.assertRaises(SystemExit):
                engine.apply(self.request, self.m)
            self.assertTrue(self.marker.exists()); self.assertEqual(len(self.migrations), 1)
            self.assertEqual(json.loads((self.state.routes / 'pools.json').read_text())['pools']['blue']['aiUrl'], new['url'])
            self.assertNotEqual(self.state.receipt('ai-window')['stage'], 'verified')
            with self.assertRaisesRegex(ReleaseConflict, 'requires_reconciliation'): engine.apply(self.request, self.m)
            self.assertEqual(len(self.migrations), 1)

    def test_first_published_tenant_cannot_mark_shared_operation_verified(self):
        with ai_server() as old, ai_server() as new:
            engine = self.coordinator(self.setup_config(old, new), self.migration())
            original = self.state.stage
            def crash(request_id, tenant_id, phase, fence, **kwargs):
                if tenant_id == 'b' and phase == 'published_ai':
                    raise SystemExit('simulated crash')
                original(request_id, tenant_id, phase, fence, **kwargs)
            with patch.object(self.state, 'stage', crash), self.assertRaises(SystemExit):
                engine.apply(self.request, self.m)
            receipt = self.state.receipt('ai-window')
            self.assertNotEqual(receipt['stage'], 'verified')
            self.assertFalse(any(row['stage'] == 'verified' for row in receipt['tenants']))
            self.assertTrue(self.marker.exists())

    def test_every_old_process_must_drain_and_idle_pool_evidence_is_required(self):
        with ai_server() as old, ai_server(active_runs=1, running=1, generation_id='old_busy') as old_busy, ai_server() as new:
            config = self.setup_config(old, new)
            config['oldServices'].append({'id': 'old_busy', 'url': old_busy['url'], 'sharedStateId': STATE_ID, 'aiStateVersion': '1'})
            receipt = self.coordinator(config, self.migration()).apply(self.request, self.m)
            self.assertEqual(receipt['stage'], 'draining_ai'); self.assertTrue(old_busy['calls']); self.assertFalse(self.migrations)

    def test_busy_pool_connections_cannot_be_migrated_even_when_run_counts_are_zero(self):
        with ai_server(connections={'pool_size': 2, 'pool_available': 1}) as old, ai_server() as new:
            receipt = self.coordinator(self.setup_config(old, new), self.migration()).apply(self.request, self.m)
            self.assertEqual(receipt['stage'], 'draining_ai'); self.assertFalse(self.migrations)

    def test_unknown_source_pool_and_missing_draining_pool_target_block_before_barrier(self):
        with ai_server() as old, ai_server() as new:
            config = self.setup_config(old, new)
            changed = copy.deepcopy(self.pools); changed['pools']['blue']['aiUrl'] = 'http://unknown.test'
            atomic_json(self.state.routes / 'pools.json', changed)
            with self.assertRaises(ReleaseConflict): self.coordinator(config, self.migration()).apply(self.request, self.m)
            self.assertFalse(self.marker.exists())
            atomic_json(self.state.routes / 'pools.json', self.pools)
            route = self.state.route('a')
            self.state.publish({**route, 'routeRevision': 2, 'fence': 2, 'draining': [{'releaseId': 'r0', 'poolId': 'prior', 'routeRevision': 1, 'fence': 1}]}, expected_revision=1)
            request = {**self.request, 'expectedRoutes': {'a': 2, 'b': 1}}
            with self.assertRaises(ReleaseConflict): self.coordinator(config, self.migration()).apply(request, self.m)
            self.assertFalse(self.marker.exists())


if __name__ == '__main__': unittest.main()
