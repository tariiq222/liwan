"""Opt-in real PostgreSQL: a candidate transaction invalidates quiescence."""
import os
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit
from .runtime import LocalRuntime
from .state import ReleaseState, ReleaseConflict


@unittest.skipUnless(os.environ.get('WEBVUE_BACKUP_TEST_DSN'),'isolated PostgreSQL opt-in required')
class BackupLiveTests(unittest.TestCase):
    def test_another_role_transaction_prevents_capture_recheck(self):
        import psycopg2
        dsn=os.environ['WEBVUE_BACKUP_TEST_DSN'];url=urlsplit(dsn)
        if url.hostname not in ('localhost','127.0.0.1') or not url.path.startswith('/webvue_scratch_backup_'):
            raise ValueError('scratch_required')
        with tempfile.TemporaryDirectory() as temp:
            state=ReleaseState(Path(temp).resolve()/'state')
            binding={'tenantId':'tenant_a','database':url.path[1:],'filestore':url.path[1:],'registryRevision':1}
            route={'schemaVersion':1,'tenantId':'tenant_a','identityRevision':1,'routeRevision':1,'releaseId':'r1','poolId':'blue','fence':1,'state':'serving'}
            state.register(binding,route);state.maintenance('tenant_a',1)
            config={'mode':'local','postgres':{'host':'127.0.0.1'},'tenants':{'tenant_a':{**binding,'roles':{'blue':'runtime_blue'}}}}
            runtime=LocalRuntime(state,config,connector=lambda _:psycopg2.connect(dsn))
            runtime.proofs['tenant_a']={**binding,'gateClosed':True,'admittedWriters':0,'activeTransactions':0,'oldConnections':0,'fence':1}
            connection=psycopg2.connect(dsn)
            try:
                with connection.cursor() as cursor:cursor.execute('SELECT 1')
                with self.assertRaises(ReleaseConflict):runtime._recheck(binding)
                connection.rollback()
                self.assertTrue(runtime._recheck(binding)['gateClosed'])
            finally:connection.close()
