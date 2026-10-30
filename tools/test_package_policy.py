"""Package policy authority tests; pure files only, no runtime or database."""
import copy
import hashlib
import json
import unittest
from pathlib import Path
from liwan_cli import managed_policy

CATALOG = Path(__file__).resolve().parents[1] / 'deploy/catalog/solutions/platform.json'

class PackagePolicyCase(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads(CATALOG.read_bytes())
        self.digest = hashlib.sha256(CATALOG.read_bytes()).hexdigest()
        tier = next(t for t in self.catalog['tiers'] if t['id'] == 'projects')
        self.policy = {'schema_version': 1, 'channel': 'control_plane', 'modules': self.catalog['base_modules'] + tier['modules'], 'features': {'users.limit': 3, 'storage.limit_mb': 2, 'pmo.enabled': True, 'meetings.enabled': True, 'projects.max_projects': 1}}
        self.authority = {'schemaVersion': 2, 'revisionId': '11111111-1111-4111-8111-111111111111', 'digest': 'a' * 64, 'catalog': {'version': 'v1', 'tier': 'projects', 'sourceSha256': self.digest}, 'policy': copy.deepcopy(self.policy)}

    def parse(self, policy=None, reference=None, trusted=None):
        self.assertTrue(hasattr(managed_policy, 'parse_package_create_policy'), 'versioned package verifier missing')
        return managed_policy.parse_package_create_policy(json.dumps(self.policy if policy is None else policy).encode(), catalog_path=CATALOG, catalog_sha256='sha256:' + self.digest, commercial_mode='saas', package_reference=self.authority if reference is None else reference, trusted_authority=self.authority if trusted is None else trusted)

    def test_accept_finite_zero_null(self):
        for value in (0, None, 3, 1000000000):
            self.policy['features']['users.limit'] = value
            self.authority['policy'] = copy.deepcopy(self.policy)
            self.assertEqual(self.parse(), self.policy)

    def test_reference_cannot_be_its_own_authority(self):
        for key, value in [('revisionId', '22222222-2222-4222-8222-222222222222'), ('digest', 'b' * 64), ('schemaVersion', 1)]:
            forged = copy.deepcopy(self.authority)
            forged[key] = value
            with self.assertRaises(managed_policy.PolicyError):
                self.parse(reference=forged)
        with self.assertRaises(managed_policy.PolicyError):
            self.parse(trusted={})

    def test_changed_policy_source_tier_modules_and_features_fail(self):
        for change in ('number', 'source', 'tier', 'module', 'feature'):
            trusted = copy.deepcopy(self.authority)
            if change == 'number':
                trusted['policy']['features']['users.limit'] = 9
            elif change == 'source':
                trusted['catalog']['sourceSha256'] = 'b' * 64
            elif change == 'tier':
                trusted['catalog']['tier'] = 'people'
            elif change == 'module':
                trusted['policy']['modules'].append('evil')
            else:
                trusted['policy']['features']['evil.enabled'] = True
            with self.assertRaises(managed_policy.PolicyError):
                self.parse(reference=trusted, trusted=trusted)

    def test_numeric_spoofing_refused_even_when_worker_authority_matches(self):
        for value in (True, -1, 1.5, 1000000001, 9007199254740992):
            policy = copy.deepcopy(self.policy)
            policy['features']['users.limit'] = value
            trusted = copy.deepcopy(self.authority)
            trusted['policy'] = policy
            with self.assertRaises(managed_policy.PolicyError):
                self.parse(policy=policy, reference=trusted, trusted=trusted)

    def test_legacy_remains_null_only(self):
        with self.assertRaises(managed_policy.PolicyError):
            managed_policy.parse_create_policy(json.dumps(self.policy).encode(), catalog_path=CATALOG, catalog_sha256='sha256:' + self.digest, commercial_mode='saas')
