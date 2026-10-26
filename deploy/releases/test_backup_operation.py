"""Backup failure must keep exactly the affected tenant closed."""
import json
from pathlib import Path
import tempfile
import unittest
from .state import ReleaseState, ReleaseConflict
from . import backup_operation


class BackupOperationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.state = ReleaseState(self.root / 'state')
        self.binding = {'tenantId':'tenant_a','database':'webvue_scratch_a','filestore':'webvue_scratch_a','registryRevision':1}
        self.route = {'schemaVersion':1,'tenantId':'tenant_a','identityRevision':1,'routeRevision':1,'releaseId':'r1','poolId':'blue','fence':1,'state':'serving'}
        self.state.register(self.binding, self.route)
        other = {**self.binding,'tenantId':'tenant_b','database':'webvue_scratch_b','filestore':'webvue_scratch_b'}
        self.state.register(other, {**self.route,'tenantId':'tenant_b'})
        self.previous = {'version':1,'tenantId':'tenant_a','database':'webvue_scratch_a','filestore':'webvue_scratch_a',
            'registryRevision':1,'releaseId':'r1','poolId':'blue','routeRevision':1,'fence':1,
            'image':'webvue/odoo@sha256:'+'a'*64,'roles':['role_blue','role_green'],
            'grants':{'role_blue':True,'role_green':False},'cron':{'blue-cron':False}}
        self.events = []
        self.failure = None

    def runtime(self, *, capture_fail=False, reconcile_fail=False, fail_closed_fail=False):
        events, previous, state = self.events, self.previous, self.state
        class Runtime:
            def prepare_backup(self,b,r):
                events.append('prepare'); return previous
            def acknowledge(self,b,r,maintenance=False): return {'ready':True}
            def quiesce(self,b,r):
                assert (state.routes/'tenant_a.maintenance').exists()
                assert Path(backup_operation.intent_path(state,'tenant_a','backup_one')).is_file()
                events.append('quiesce')
                return {**b,'fence':1,'gateClosed':True,'admittedWriters':0,'activeTransactions':0,
                        'oldConnections':0,'writerConnections':0,'deniedWriters':['role_blue','role_green']}
            def capture_into(self,b,p,out):
                events.append('capture')
                if capture_fail: raise RuntimeError('capture failed')
                return {'fence':1,'digest':'a'*64,'path':str(out)}
            def resume_backup(self,b,r,observed):
                events.append('resume'); assert observed == previous
            def fail_closed_backup(self,b,r):
                events.append('fail_closed')
                if fail_closed_fail: raise RuntimeError('fence unavailable')
            def reconcile_backup(self,b,r,observed):
                events.append('reconcile'); assert observed == previous
                if reconcile_fail: raise ReleaseConflict('backup_fence_lost')
        return Runtime()

    def call(self, runtime):
        return backup_operation.backup_current(self.state, runtime, self.binding, 'backup_one',
            self.root/'artifact', lambda result: self.events.append('finalize'))

    def test_success_resumes_the_persisted_previous_state_only_after_capture(self):
        result = self.call(self.runtime())
        self.assertEqual(result['stage'], 'verified')
        self.assertEqual(self.events, ['prepare','quiesce','capture','finalize','resume'])
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())
        intent = json.loads(backup_operation.intent_path(self.state,'tenant_a','backup_one').read_text())
        self.assertEqual(intent, self.previous)
        self.assertEqual(self.call(self.runtime())['stage'], 'verified')
        self.assertEqual(self.events, ['prepare','quiesce','capture','finalize','resume'])

    def test_capture_failure_denies_writers_and_keeps_only_the_target_closed(self):
        with self.assertRaises(RuntimeError): self.call(self.runtime(capture_fail=True))
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())
        self.assertEqual(self.state.receipt('backup_one')['errorCode'], 'backup_unverified')
        self.assertEqual(self.state.receipt('backup_one')['stage'], 'needs_intervention')
        self.assertIn('fail_closed', self.events)
        self.assertNotIn('resume', self.events)
        self.assertFalse((self.state.routes/'tenant_b.maintenance').exists())
        self.assertEqual(self.state.route('tenant_b')['poolId'], 'blue')

    def test_fail_closed_failure_is_reported_without_claiming_recovery(self):
        with self.assertRaises(RuntimeError): self.call(self.runtime(capture_fail=True, fail_closed_fail=True))
        receipt = self.state.receipt('backup_one')
        self.assertEqual(receipt['errorCode'], 'backup_fail_closed_unverified')
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())

    def test_retry_reconciles_the_previous_state_without_capturing_again(self):
        with self.assertRaises(RuntimeError): self.call(self.runtime(capture_fail=True))
        self.events.clear()
        result = self.call(self.runtime())
        self.assertEqual(result['stage'], 'reconciled')
        self.assertEqual(self.events, ['reconcile'])
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())
        self.assertEqual(self.call(self.runtime())['stage'], 'reconciled')
        self.assertEqual(self.events, ['reconcile'])

    def test_reconciliation_failure_stays_closed_and_needs_the_operator(self):
        with self.assertRaises(RuntimeError): self.call(self.runtime(capture_fail=True))
        with self.assertRaises(ReleaseConflict): self.call(self.runtime(reconcile_fail=True))
        receipt = self.state.receipt('backup_one')
        self.assertEqual(receipt['stage'], 'needs_intervention')
        self.assertEqual(receipt['errorCode'], 'backup_reconciliation_failed')
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())
        self.assertEqual(self.events.count('capture'), 1)

    def test_conflicting_durable_intent_refuses_before_any_effect(self):
        path = backup_operation.intent_path(self.state,'tenant_a','backup_one')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({**self.previous,'fence':9}))
        with self.assertRaises(ReleaseConflict): self.call(self.runtime())
        self.assertEqual(self.events, ['prepare'])  # inspection only, no effect
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())

    def test_missing_intent_after_an_interruption_never_reopens_unknown_state(self):
        with self.assertRaises(RuntimeError): self.call(self.runtime(capture_fail=True))
        backup_operation.intent_path(self.state,'tenant_a','backup_one').unlink()
        with self.assertRaises(ReleaseConflict): self.call(self.runtime())
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())


if __name__ == '__main__': unittest.main()
