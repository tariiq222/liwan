"""Dedicated binding preserves local authority and existing session semantics."""
import unittest
from .dedicated import validate_binding, select_dedicated_route
from .test_readiness import binding


class DedicatedTests(unittest.TestCase):
    def local_binding(self):
        return {**binding(), 'commercialMode': 'non_saas'}

    def test_non_saas_binding_is_local_without_vendor_dependency(self):
        self.assertEqual(validate_binding(self.local_binding())['commercialMode'], 'non_saas')
        result = select_dedicated_route(self.local_binding(), 'tenant-a.webvue.test',
                                       {'poolId': 'green', 'releaseId': 'r1', 'state': 'serving'})
        self.assertTrue(result['allowed'])
        self.assertEqual(result['cookieMode'], 'odoo')
        self.assertEqual(result['database'], 'tenant_a')

    def test_rejects_other_host_and_request_controlled_binding(self):
        with self.assertRaises(ValueError):
            select_dedicated_route(self.local_binding(), 'attacker.test', {'poolId': 'green', 'releaseId': 'r1', 'state': 'serving'})
        for patch in ({'host': 'https://user:secret@example.com'}, {'database': 'a,b'},
                      {'filestore': '../../other'}, {'vendorUrl': 'https://vendor.test'}):
            value = self.local_binding(); value.update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_binding(value)

    def test_maintenance_blocks_auth_content_and_business_paths(self):
        for path in ('/web/login', '/api/v1/tasks/1/attachments/1/download', '/api/v1/me', '/websocket'):
            result = select_dedicated_route(self.local_binding(), 'tenant-a.webvue.test',
                                           {'poolId': 'green', 'releaseId': 'r1', 'state': 'maintenance'}, path=path)
            self.assertFalse(result['allowed'])
            self.assertEqual(result['status'], 503)


if __name__ == '__main__':
    unittest.main()
