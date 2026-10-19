"""Backup failure must keep exactly the affected tenant closed."""
from pathlib import Path
import tempfile
import unittest
from .state import ReleaseState, ReleaseConflict
from . import backup_operation


class BackupOperationTests(unittest.TestCase):
    def test_success_resumes_only_after_capture_and_replay_does_not_capture_again(self):
        self.exercise(False)

    def test_failure_keeps_target_maintenance_and_other_tenant_open(self):
        self.exercise(True)

    def exercise(self, fail):
        with tempfile.TemporaryDirectory() as temp:
            state=ReleaseState(Path(temp).resolve()/'state')
            binding={'tenantId':'tenant_a','database':'webvue_scratch_a','filestore':'webvue_scratch_a','registryRevision':1}
            route={'schemaVersion':1,'tenantId':'tenant_a','identityRevision':1,'routeRevision':1,'releaseId':'r1','poolId':'blue','fence':1,'state':'serving'}
            state.register(binding,route)
            other={**binding,'tenantId':'tenant_b','database':'webvue_scratch_b','filestore':'webvue_scratch_b'}
            state.register(other,{**route,'tenantId':'tenant_b'})
            events=[]
            class Runtime:
                def prepare_backup(self,b,r):events.append('prepare')
                def acknowledge(self,b,r,maintenance=False):return {'ready':True}
                def quiesce(self,b,r):
                    assert (state.routes/'tenant_a.maintenance').exists()
                    return {**b,'fence':1,'gateClosed':True,'admittedWriters':0,'activeTransactions':0,'oldConnections':0}
                def capture_into(self,b,p,out):
                    events.append('capture')
                    if fail:raise RuntimeError('capture failed')
                    return {'fence':1,'digest':'a'*64,'path':str(out)}
                def resume_backup(self,b,r):events.append('resume')
            finalize=lambda result:events.append('finalize')
            call=lambda:backup_operation.backup_current(state,Runtime(),binding,'backup_one',Path(temp).resolve()/'artifact',finalize)
            if fail:
                with self.assertRaises(RuntimeError):call()
                self.assertTrue((state.routes/'tenant_a.maintenance').exists())
                with self.assertRaises(ReleaseConflict):call()
                self.assertNotIn('resume',events)
            else:
                self.assertEqual(call()['stage'],'verified')
                self.assertFalse((state.routes/'tenant_a.maintenance').exists())
                self.assertEqual(call()['stage'],'verified')
                self.assertEqual(events,['prepare','capture','finalize','resume'])
            self.assertFalse((state.routes/'tenant_b.maintenance').exists())
            self.assertEqual(state.route('tenant_b')['poolId'],'blue')
