"""The release document's identity contract: formats, immutability and rejection of ambiguity."""
import unittest

from deploy.release.manifest import validate_manifest


def release(**changes):
    value = {
        'releaseId': 'r20261016', 'liwanCommit': '1' * 40, 'odooCommit': '2' * 40,
        'images': {'odoo': 'liwan/odoo@sha256:' + 'a' * 64, 'web': 'liwan/web@sha256:' + 'b' * 64},
        'assetsId': 'assets-1', 'moduleVersions': {}, 'upgradeModules': [], 'installModules': [],
        'mode': 'online', 'affectedServices': ['web'], 'aiStateVersion': '1',
        'compatibilityEvidence': {'reviewer': 'owner', 'reference': 'review-42',
            'apiCompatible': True, 'sessionCompatible': True, 'concurrentWritesCompatible': True,
            'jobsCompatible': True, 'aiCompatible': True},
        'rollbackPolicy': {'oldWritesCompatible': True},
    }
    value.update(changes)
    return value


class ManifestValidationTests(unittest.TestCase):
    def test_online_rejects_module_operations(self):
        for operation in ('upgradeModules', 'installModules'):
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                validate_manifest(release(**{operation: ['liwan_core']}))

    def test_rejects_mutable_images_and_missing_evidence(self):
        for patch in ({'images': {'odoo': 'odoo:latest', 'web': 'web:latest'}},
                      {'compatibilityEvidence': {}}, {'releaseId': '../secret'}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_manifest(release(**patch))

    def test_rejects_unknown_fields(self):
        with self.assertRaises(ValueError):
            validate_manifest(release(password='secret'))

    def test_manifest_versions_cover_every_declared_module(self):
        with self.assertRaises(ValueError):
            validate_manifest(release(mode='tenant_maintenance', upgradeModules=['liwan_a']))


if __name__ == '__main__':
    unittest.main()
