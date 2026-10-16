"""Readiness verifies observations, never a TCP liveness assertion."""
import unittest
from .readiness import probe_pool
from .compose import render_pool
from .test_compose import operator
from .test_manifest import release


def binding():
    return {'tenantId': 'tenant_a', 'database': 'tenant_a', 'filestore': 'webvue_filestore',
            'identityRevision': 7, 'host': 'tenant-a.webvue.test'}


def observation():
    return {'poolId': 'green', 'releaseId': 'r20261016', 'images': release()['images'],
            'assetsId': 'assets-1', 'aiStateVersion': '1', 'database': 'tenant_a',
            'tenantId': 'tenant_a', 'identityRevision': 7, 'moduleVersions': {},
            'moduleStatesReady': True, 'databaseReady': True, 'readOnly': True,
            'sessionStore': 'webvue_sessions', 'sessionReadable': True,
            'filestore': 'webvue_filestore', 'filestoreReadable': True}


class ReadinessTests(unittest.TestCase):
    def test_candidate_is_not_ready_on_tcp_only(self):
        result = probe_pool(render_pool(release(), operator()), binding(), probe=lambda pool, tenant: {'tcp': True})
        self.assertFalse(result['ready'])
        self.assertIn('identity', result['checks'])

    def test_readiness_requires_exact_identity_images_database_and_session(self):
        pool = render_pool(release(), operator())
        self.assertTrue(probe_pool(pool, binding(), probe=lambda p, b: observation())['ready'])
        for field, invalid in [('database', 'other'), ('identityRevision', 8), ('releaseId', 'old'),
                               ('images', {'odoo': 'old:latest'}), ('sessionReadable', False),
                               ('moduleStatesReady', False), ('readOnly', False), ('assetsId', 'missing')]:
            observed = observation(); observed[field] = invalid
            with self.subTest(field=field):
                self.assertFalse(probe_pool(pool, binding(), probe=lambda p, b: observed)['ready'])

    def test_no_adapter_and_exception_fail_closed_without_secrets(self):
        pool = render_pool(release(), operator())
        self.assertFalse(probe_pool(pool, binding())['ready'])
        def failed(pool, tenant):
            raise RuntimeError('private-password')
        result = probe_pool(pool, binding(), probe=failed)
        self.assertFalse(result['ready'])
        self.assertNotIn('private-password', str(result))

    def test_ai_state_mismatch_is_not_ready(self):
        pool = render_pool(release(), operator())
        observed = observation(); observed['aiStateVersion'] = 'wrong'
        self.assertFalse(probe_pool(pool, binding(), probe=lambda p, b: observed)['ready'])


if __name__ == '__main__':
    unittest.main()
