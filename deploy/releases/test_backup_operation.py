"""Backup failure must keep exactly the affected tenant closed."""
import json
from pathlib import Path
import tempfile
import unittest
from .state import ReleaseState, ReleaseConflict
from . import backup_operation
from .backup import Deadline


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
        self.previous = {'version':2,'tenantId':'tenant_a','database':'webvue_scratch_a','filestore':'webvue_scratch_a',
            'registryRevision':1,'releaseId':'r1','poolId':'blue','routeRevision':1,'fence':1,
            'image':'webvue/odoo@sha256:'+'a'*64,'roles':['role_blue','role_green'],
            'grants':{'role_blue':True,'role_green':False},'cron':{'blue-cron':{'containerId':'1'*64,'running':False}}}
        self.events = []
        self.failure = None

    def runtime(self, *, capture_fail=False, reconcile_fail=False, fail_closed_fail=False, resume_ack_fail=False):
        events, previous, state = self.events, self.previous, self.state
        budget = Deadline(60)
        marker = state.routes/'tenant_a.maintenance'
        class Runtime:
            def prepare_backup(self,b,r):
                events.append('prepare'); return previous
            def acknowledge(self,b,r,maintenance=False):
                if resume_ack_fail and maintenance is False:
                    events.append('fail'); return {'ready': False}
                return {'ready': True}
            def backup_deadline(self):
                return budget
            def fence_backup(self,b,r,observed):
                # Barrier order: the durable marker exists whenever the writer fence runs.
                events.append(('fence_backup', marker.is_file()))
                assert observed == previous
                assert Path(backup_operation.intent_path(state,'tenant_a','backup_one')).is_file()
                if fail_closed_fail and 'fail' in events: raise RuntimeError('fence unavailable')
                return {**b,'fence':1,'gateClosed':True,'admittedWriters':0,'activeTransactions':0,
                        'oldConnections':0,'writerConnections':0,'deniedWriters':['role_blue','role_green']}
            def capture_backup(self,b,p,out,deadline):
                events.append('capture'); assert deadline is budget
                if capture_fail: events.append('fail'); raise RuntimeError('capture failed')
                return {'fence':1,'digest':'a'*64,'path':str(out)}
            def validate_capture(self,result,deadline):
                events.append('validate'); assert deadline is budget
            def resume_backup(self,b,r,observed,deadline):
                events.append('resume'); assert observed == previous and deadline is budget
            def reconcile_backup(self,b,r,observed):
                events.append('reconcile'); assert observed == previous
                if reconcile_fail: events.append('fail'); raise ReleaseConflict('backup_fence_lost')
        return Runtime()

    def call(self, runtime, request_id='backup_one'):
        return backup_operation.backup_current(self.state, runtime, self.binding, request_id,
            self.root/request_id, lambda result: self.events.append('finalize'))

    def test_success_resumes_the_persisted_previous_state_only_after_capture(self):
        result = self.call(self.runtime())
        self.assertEqual(result['stage'], 'verified')
        self.assertEqual(self.events, ['prepare',('fence_backup',True),'capture','validate','finalize','resume'])
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())
        intent = json.loads(backup_operation.intent_path(self.state,'tenant_a','backup_one').read_text())
        self.assertEqual(intent, self.previous)
        self.assertEqual(self.call(self.runtime())['stage'], 'verified')
        self.assertEqual(self.events, ['prepare',('fence_backup',True),'capture','validate','finalize','resume'])

    def test_capture_failure_denies_writers_and_keeps_only_the_target_closed(self):
        with self.assertRaises(RuntimeError): self.call(self.runtime(capture_fail=True))
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())
        self.assertEqual(self.state.receipt('backup_one')['errorCode'], 'backup_unverified')
        self.assertEqual(self.state.receipt('backup_one')['stage'], 'needs_intervention')
        self.assertEqual(self.events[-1], ('fence_backup', True))
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

    def crash_in(self, stage):
        """State left by a SIGKILL: durable intent + stage + barrier, no except handler ran."""
        payload = {'operation':'backup','binding':self.binding,'output':str(self.root/'backup_one')}
        self.state.request('backup_one', payload)
        backup_operation.write_intent(self.state, 'tenant_a', 'backup_one', self.previous)
        self.state.stage('backup_one', 'tenant_a', stage, 1)
        self.state.maintenance('tenant_a', 1)

    def test_retry_after_a_sigkill_in_prepared_reconciles_the_previous_state(self):
        self.crash_in('prepared')
        result = self.call(self.runtime())
        self.assertEqual(result['stage'], 'reconciled')
        self.assertEqual(self.events, ['reconcile'])
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())

    def test_retry_after_a_sigkill_in_backed_up_reconciles_without_capturing(self):
        self.crash_in('backed_up')
        result = self.call(self.runtime())
        self.assertEqual(result['stage'], 'reconciled')
        self.assertEqual(self.events, ['reconcile'])
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())

    def test_reconcile_failure_reapplies_fail_closed(self):
        self.crash_in('backed_up')
        with self.assertRaises(ReleaseConflict): self.call(self.runtime(reconcile_fail=True))
        self.assertEqual(self.events, ['reconcile', 'fail', ('fence_backup', True)])
        receipt = self.state.receipt('backup_one')
        self.assertEqual((receipt['stage'], receipt['errorCode']), ('needs_intervention', 'backup_reconciliation_failed'))
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())

    def test_reconcile_failure_with_failed_fence_reports_it_and_stays_closed(self):
        self.crash_in('prepared')
        with self.assertRaises(ReleaseConflict): self.call(self.runtime(reconcile_fail=True, fail_closed_fail=True))
        self.assertEqual(self.state.receipt('backup_one')['errorCode'], 'backup_fail_closed_unverified')
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())

    def test_final_ack_failure_recreates_the_barrier_before_fencing(self):
        # state.resume already removed the marker; the fence must never run without it.
        with self.assertRaises(ReleaseConflict): self.call(self.runtime(resume_ack_fail=True))
        self.assertEqual(self.events, ['prepare',('fence_backup',True),'capture','validate','finalize','resume','fail',('fence_backup',True)])
        receipt = self.state.receipt('backup_one')
        self.assertEqual((receipt['stage'], receipt['errorCode']), ('needs_intervention', 'backup_unverified'))
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())

    def test_final_ack_failure_with_failing_fence_keeps_the_marker(self):
        with self.assertRaises(ReleaseConflict): self.call(self.runtime(resume_ack_fail=True, fail_closed_fail=True))
        self.assertEqual(self.state.receipt('backup_one')['errorCode'], 'backup_fail_closed_unverified')
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())

    def test_conflicting_durable_intent_refuses_before_any_effect(self):
        path = backup_operation.intent_path(self.state,'tenant_a','backup_one')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({**self.previous,'fence':9}))
        with self.assertRaises(ReleaseConflict): self.call(self.runtime())
        self.assertEqual(self.events, ['prepare'])  # inspection only, no effect
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())

    def assert_new_request_refused_and_original_recoverable(self, error):
        intents = sorted(path.name for path in backup_operation.intent_path(self.state,'tenant_a','x').parent.iterdir())
        before = (self.state.receipt('backup_one'), intents, (self.state.routes/'tenant_a.maintenance').read_text())
        self.events.clear()
        with self.assertRaisesRegex(ReleaseConflict, '^backup_operation_pending$'): self.call(self.runtime(), 'backup_two')
        self.assertEqual(self.events, [])  # no snapshot, no fence, no capture, no resume
        with self.assertRaisesRegex(ReleaseConflict, '^release_request_missing$'): self.state.receipt('backup_two')
        self.assertFalse((self.root/'backup_two').exists())
        intents = sorted(path.name for path in backup_operation.intent_path(self.state,'tenant_a','x').parent.iterdir())
        self.assertEqual((self.state.receipt('backup_one'), intents, (self.state.routes/'tenant_a.maintenance').read_text()), before)
        self.assertEqual(before[0]['errorCode'], error)
        # Only the owning request id recovers, from its own intent.
        self.assertEqual(self.call(self.runtime())['stage'], 'reconciled')
        self.assertEqual(self.events, ['reconcile'])
        self.assertFalse((self.state.routes/'tenant_a.maintenance').exists())

    def test_new_request_is_refused_after_a_capture_failure(self):
        with self.assertRaises(RuntimeError): self.call(self.runtime(capture_fail=True))
        self.assert_new_request_refused_and_original_recoverable('backup_unverified')

    def test_new_request_is_refused_after_a_partial_resume_failure(self):
        with self.assertRaises(ReleaseConflict): self.call(self.runtime(resume_ack_fail=True))
        self.assert_new_request_refused_and_original_recoverable('backup_unverified')

    def test_new_request_is_refused_while_an_interrupted_backup_holds_no_marker(self):
        # A crash between the intent and the marker leaves an unresolved intent only.
        self.crash_in('prepared'); (self.state.routes/'tenant_a.maintenance').unlink()
        self.events.clear()
        with self.assertRaisesRegex(ReleaseConflict, '^backup_operation_pending$'): self.call(self.runtime(), 'backup_two')
        self.assertEqual(self.events, [])

    def test_new_request_is_refused_under_a_foreign_maintenance_marker(self):
        self.state.maintenance('tenant_a', 1)  # e.g. a release that still owns the tenant
        with self.assertRaisesRegex(ReleaseConflict, '^backup_operation_pending$'): self.call(self.runtime(), 'backup_two')
        self.assertEqual(self.events, [])

    def test_a_resolved_backup_does_not_block_the_next_request(self):
        self.assertEqual(self.call(self.runtime())['stage'], 'verified')
        self.assertEqual(self.call(self.runtime(), 'backup_two')['stage'], 'verified')
        with self.assertRaises(RuntimeError): self.call(self.runtime(capture_fail=True), 'backup_three')
        self.assertEqual(self.call(self.runtime(), 'backup_three')['stage'], 'reconciled')
        self.assertEqual(self.call(self.runtime(), 'backup_four')['stage'], 'verified')

    def test_missing_intent_after_an_interruption_never_reopens_unknown_state(self):
        with self.assertRaises(RuntimeError): self.call(self.runtime(capture_fail=True))
        backup_operation.intent_path(self.state,'tenant_a','backup_one').unlink()
        with self.assertRaises(ReleaseConflict): self.call(self.runtime())
        self.assertTrue((self.state.routes/'tenant_a.maintenance').exists())


if __name__ == '__main__': unittest.main()
