# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pure RED-first managed-create policy tests: no Odoo, DB, Docker or network."""
import copy
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

# Missing implementation is the intended first RED, not an import/setup accident.
if importlib.util.find_spec('liwan_cli.managed_policy') is None:
    managed_policy = None
else:
    from liwan_cli import managed_policy

CATALOG_PATH = Path(__file__).resolve().parents[1] / 'deploy/catalog/solutions/platform.json'
POLICY_MAX_BYTES = 16384


class ManagedPolicyCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(managed_policy, 'managed_policy implementation is missing')
        self.catalog_raw = CATALOG_PATH.read_bytes()
        self.catalog = json.loads(self.catalog_raw)
        self.digest = 'sha256:' + hashlib.sha256(self.catalog_raw).hexdigest()
        self.policy = self.policy_for('projects')

    def policy_for(self, tier_id):
        tier = next(item for item in self.catalog['tiers'] if item['id'] == tier_id)
        features = {'users.limit': None, 'storage.limit_mb': None}
        for descriptor in tier['features']:
            kind, key = descriptor.split(':')
            features[key] = True if kind == 'boolean' else None
        return {'schema_version': 1, 'channel': 'control_plane',
                'modules': self.catalog['base_modules'] + tier['modules'],
                'features': features}

    def parse(self, policy=None, *, raw=None, **kwargs):
        if raw is None:
            raw = json.dumps(self.policy if policy is None else policy).encode('utf-8')
        return managed_policy.parse_create_policy(
            raw, catalog_path=kwargs.get('catalog_path', CATALOG_PATH),
            catalog_sha256=kwargs.get('catalog_sha256', self.digest),
            commercial_mode=kwargs.get('commercial_mode', 'saas'))

    def refuse(self, code, policy=None, **kwargs):
        with self.assertRaises(managed_policy.PolicyError) as caught:
            self.parse(policy, **kwargs)
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(str(caught.exception), code)
        self.assertIsInstance(caught.exception, ValueError)
        return caught.exception

    def catalog_refuse(self, value, code='catalog_invalid'):
        raw = json.dumps(value).encode('utf-8')
        with patch.object(Path, 'read_bytes', return_value=raw):
            self.refuse(code, catalog_sha256='sha256:' + hashlib.sha256(raw).hexdigest())

    def test_all_current_catalog_tiers_round_trip(self):
        self.assertEqual({tier['id'] for tier in self.catalog['tiers']},
                         {'core', 'projects', 'people', 'messaging'})
        for tier in self.catalog['tiers']:
            with self.subTest(tier=tier['id']):
                policy = self.policy_for(tier['id'])
                self.assertEqual(self.parse(policy), policy)

    def test_base_only_core_does_not_add_pillars(self):
        result = self.parse(self.policy_for('core'))
        self.assertEqual(result['modules'], ['liwan_core', 'liwan_platform', 'liwan_api'])
        self.assertEqual(result['features'], {'users.limit': None, 'storage.limit_mb': None})

    def test_repeated_calls_are_independent_and_catalog_is_read_only(self):
        original = copy.deepcopy(self.policy)
        first = self.parse()
        first['modules'].append('not_a_module')
        first['features']['pmo.enabled'] = False
        self.assertEqual(self.parse(), original)
        self.assertEqual(self.policy, original)
        self.assertEqual(CATALOG_PATH.read_bytes(), self.catalog_raw)

    def test_whitespace_and_feature_key_order_do_not_change_policy(self):
        raw = json.dumps(self.policy, sort_keys=True, indent=2).encode()
        self.assertEqual(self.parse(raw=raw), self.policy)

    def test_policy_bytes_limit_inclusive(self):
        raw = json.dumps(self.policy).encode()
        self.assertEqual(self.parse(raw=raw + b' ' * (POLICY_MAX_BYTES - len(raw))), self.policy)
        self.refuse('policy_too_large', raw=raw + b' ' * (POLICY_MAX_BYTES + 1 - len(raw)))

    def test_raw_requires_bytes(self):
        for raw in ('{}', bytearray(b'{}'), memoryview(b'{}'), None, 1, True):
            with self.subTest(raw_type=type(raw).__name__):
                with self.assertRaises(managed_policy.PolicyError) as caught:
                    managed_policy.parse_create_policy(raw, catalog_path=CATALOG_PATH,
                                                       catalog_sha256=self.digest,
                                                       commercial_mode='saas')
                self.assertEqual(caught.exception.code, 'policy_invalid')

    def test_invalid_json_and_encoding(self):
        for raw in (b'', b'{', b'{} trailing', b'\xff', b'\xef\xbb\xbf{}',
                    '{}'.encode('utf-16'), b'{"secret":"sensitive-value",}'):
            with self.subTest(raw=raw):
                self.refuse('policy_invalid', raw=raw)

    def test_non_object_json(self):
        for raw in (b'null', b'[]', b'1', b'true', b'"text"'):
            with self.subTest(raw=raw):
                self.refuse('policy_invalid', raw=raw)

    def test_nonstandard_json_numbers(self):
        for value in ('NaN', 'Infinity', '-Infinity'):
            with self.subTest(value=value):
                self.refuse('policy_invalid', raw=json.dumps(self.policy).replace('true', value, 1).encode())

    def test_deep_json_is_safe_failure(self):
        self.refuse('policy_invalid', raw=b'[' * 1500 + b'0' + b']' * 1500)

    def test_duplicate_top_level_keys(self):
        raw = json.dumps(self.policy).encode()
        self.refuse('policy_duplicate_key', raw=b'{"schema_version":1,' + raw[1:])

    def test_duplicate_nested_feature_keys(self):
        raw = json.dumps(self.policy).replace('"pmo.enabled": true',
                                             '"pmo.enabled": false, "pmo.enabled": true').encode()
        self.refuse('policy_duplicate_key', raw=raw)

    def test_duplicate_escaped_key(self):
        raw = json.dumps(self.policy).replace('"pmo.enabled": true',
                                             '"pmo.enabled": true, "pmo\\u002eenabled": true').encode()
        self.refuse('policy_duplicate_key', raw=raw)

    def test_exact_policy_keys(self):
        for key in self.policy:
            with self.subTest(missing=key):
                value = copy.deepcopy(self.policy)
                del value[key]
                self.refuse('policy_invalid', value)
        self.refuse('policy_invalid', {**self.policy, 'password': 'sensitive-value'})

    def test_schema_version_is_integer_one_not_bool(self):
        for version in (True, False, 1.0, 0, 2, '1', None, [], {}):
            with self.subTest(version=version):
                self.refuse('policy_invalid', {**self.policy, 'schema_version': version})

    def test_only_saas_mode_is_supported(self):
        for mode in ('non_saas', '', 'SaaS', None, True, 1, [], {}):
            with self.subTest(mode=mode):
                self.refuse('commercial_mode_unsupported', commercial_mode=mode)

    def test_channel_must_match_saas(self):
        for channel in ('local_policy', '', 'CONTROL_PLANE', None, True, 1, [], {}):
            with self.subTest(channel=channel):
                self.refuse('policy_channel_mismatch', {**self.policy, 'channel': channel})

    def test_even_consistent_non_saas_pair_is_rejected(self):
        self.refuse('commercial_mode_unsupported', {**self.policy, 'channel': 'local_policy'},
                    commercial_mode='non_saas')

    def test_modules_require_list_of_strings(self):
        for modules in (None, True, 1, {}, 'liwan_pmo', [1], [True], [[]], [{}]):
            with self.subTest(modules=modules):
                self.refuse('policy_invalid', {**self.policy, 'modules': modules})

    def test_exact_ordered_base_plus_single_tier_modules(self):
        base = self.catalog['base_modules']
        for modules in ([], ['liwan_pmo'], self.policy['modules'][::-1],
                        base + ['liwan_hr'], base + ['liwan_pmo', 'liwan_hr', 'liwan_chat'],
                        base + ['liwan_pmo', 'liwan_pmo'], base + ['unknown'],
                        base + ['liwan_pmo', 'hr_timesheet']):
            with self.subTest(modules=modules):
                self.refuse('policy_composition_mismatch', {**self.policy, 'modules': modules})

    def test_features_must_be_object(self):
        for features in (None, True, 1, [], 'features'):
            with self.subTest(features=features):
                self.refuse('policy_invalid', {**self.policy, 'features': features})

    def test_feature_values_require_exact_bool_or_null(self):
        for key in ('pmo.enabled', 'users.limit', 'projects.max_projects'):
            for value in (0, 1, 1.0, -1, 'true', 'null', [], {}):
                with self.subTest(key=key, value=value):
                    features = {**self.policy['features'], key: value}
                    self.refuse('policy_invalid', {**self.policy, 'features': features})

    def test_feature_defaults_cannot_be_changed(self):
        for key, value in (('pmo.enabled', False), ('pmo.enabled', None),
                           ('users.limit', True), ('users.limit', False)):
            with self.subTest(key=key, value=value):
                features = {**self.policy['features'], key: value}
                self.refuse('policy_composition_mismatch', {**self.policy, 'features': features})

    def test_feature_keys_exactly_match_tier_and_worker_defaults(self):
        for key in self.policy['features']:
            with self.subTest(missing=key):
                features = dict(self.policy['features'])
                del features[key]
                self.refuse('policy_composition_mismatch', {**self.policy, 'features': features})
        for key in ('hr.enabled', 'unknown.feature', 'sensitive-value'):
            with self.subTest(extra=key):
                features = {**self.policy['features'], key: True}
                self.refuse('policy_composition_mismatch', {**self.policy, 'features': features})

    def test_sha256_reference_requires_exact_lowercase_format(self):
        for ref in (None, True, 1, [], {}, self.digest[7:], 'SHA256:' + 'a' * 64,
                    'sha256:' + 'A' * 64, 'sha256:' + 'g' * 64, 'sha256:abc', self.digest + '\n'):
            with self.subTest(reference=ref):
                self.refuse('catalog_reference_invalid', catalog_sha256=ref)

    def test_mismatched_catalog_digest(self):
        self.refuse('catalog_digest_mismatch', catalog_sha256='sha256:' + '0' * 64)

    def test_digest_binds_exact_bytes_not_reserialized_json(self):
        with patch.object(Path, 'read_bytes', return_value=self.catalog_raw + b'\n'):
            self.refuse('catalog_digest_mismatch')

    def test_missing_or_unreadable_catalog_has_safe_code(self):
        for error in (FileNotFoundError('sensitive-path'), PermissionError('sensitive-path'),
                      IsADirectoryError('sensitive-path')):
            with self.subTest(error=type(error).__name__), patch.object(Path, 'read_bytes', side_effect=error):
                caught = self.refuse('catalog_unavailable')
                self.assertTrue(caught.__suppress_context__)

    def test_catalog_path_requires_path_instance(self):
        for path in (str(CATALOG_PATH), None, True, 1, {}):
            with self.subTest(path_type=type(path).__name__):
                self.refuse('catalog_unavailable', catalog_path=path)

    def test_catalog_path_with_embedded_null_has_safe_code(self):
        self.refuse('catalog_unavailable', catalog_path=Path('sensitive-value\x00'))

    def test_catalog_invalid_json_or_encoding(self):
        for raw in (b'{', b'\xff', b'NaN', b'[' * 1500 + b']' * 1500):
            with self.subTest(raw_prefix=raw[:10]), patch.object(Path, 'read_bytes', return_value=raw):
                self.refuse('catalog_invalid', catalog_sha256='sha256:' + hashlib.sha256(raw).hexdigest())

    def test_catalog_duplicate_json_keys(self):
        raw = b'{"schema_version":1,' + self.catalog_raw.lstrip()[1:]
        with patch.object(Path, 'read_bytes', return_value=raw):
            self.refuse('catalog_invalid', catalog_sha256='sha256:' + hashlib.sha256(raw).hexdigest())

    def test_catalog_required_structure_and_schema_types(self):
        for value in (None, [], True, {}, {**self.catalog, 'schema_version': True},
                      {**self.catalog, 'schema_version': 2}):
            with self.subTest(value=value):
                self.catalog_refuse(value)
        for key in ('schema_version', 'base_modules', 'tiers'):
            value = copy.deepcopy(self.catalog)
            del value[key]
            self.catalog_refuse(value)

    def test_catalog_invalid_base_modules(self):
        for base in ([], None, 'liwan_core', [1], ['liwan_core', 'liwan_core'], ['bad;module']):
            with self.subTest(base=base):
                self.catalog_refuse({**self.catalog, 'base_modules': base})

    def test_catalog_invalid_tiers(self):
        for tiers in ([], None, {}, [None], [True], [{}]):
            with self.subTest(tiers=tiers):
                self.catalog_refuse({**self.catalog, 'tiers': tiers})
        self.catalog_refuse({**self.catalog, 'tiers': self.catalog['tiers'] * 2})

    def test_catalog_invalid_tier_members(self):
        for key, value in (('id', True), ('id', 'bad-id'), ('modules', None),
                           ('modules', [True]), ('modules', ['liwan_core']),
                           ('modules', ['liwan_pmo', 'liwan_pmo']), ('features', None),
                           ('features', [True]), ('features', ['boolean:']),
                           ('features', ['unknown:pmo.enabled']),
                           ('features', ['boolean:pmo.enabled:extra']),
                           ('features', ['boolean:pmo.enabled', 'limit:pmo.enabled']),
                           ('features', ['boolean:pmo.enabled', 'boolean:pmo.enabled'])):
            with self.subTest(key=key, value=value):
                catalog = copy.deepcopy(self.catalog)
                catalog['tiers'][1][key] = value
                self.catalog_refuse(catalog)

    def test_unselected_malformed_tier_also_rejected(self):
        catalog = copy.deepcopy(self.catalog)
        catalog['tiers'][-1]['features'] = ['not-a-descriptor']
        self.catalog_refuse(catalog)

    def test_catalog_cannot_change_default_limits_to_booleans(self):
        catalog = copy.deepcopy(self.catalog)
        catalog['tiers'][0]['features'] = ['boolean:users.limit']
        self.catalog_refuse(catalog)

    def test_catalog_drives_composition_without_fixed_pillars(self):
        catalog = copy.deepcopy(self.catalog)
        catalog['base_modules'].append('liwan_extra_base')
        policy = copy.deepcopy(self.policy)
        policy['modules'].insert(3, 'liwan_extra_base')
        raw = json.dumps(catalog).encode()
        with patch.object(Path, 'read_bytes', return_value=raw):
            self.assertEqual(self.parse(policy, catalog_sha256='sha256:' + hashlib.sha256(raw).hexdigest()), policy)

    def test_failure_messages_do_not_echo_inputs(self):
        caught = self.refuse('policy_invalid', raw=b'{"secret":"sensitive-value",}')
        self.assertNotIn('sensitive-value', str(caught))
        self.assertTrue(caught.__suppress_context__)
        caught = self.refuse('catalog_reference_invalid', catalog_sha256='sensitive-value')
        self.assertNotIn('sensitive-value', repr(caught))




V2_PATH = CATALOG_PATH.with_name('platform_v2.json')


class ManagedPolicyV2Case(unittest.TestCase):
    def setUp(self):
        self.raw = V2_PATH.read_bytes()
        self.catalog = json.loads(self.raw)
        self.digest = 'sha256:' + hashlib.sha256(self.raw).hexdigest()

    def policy_for(self, tier_id):
        core = self.catalog['tiers'][0]
        tier = next(item for item in self.catalog['tiers'] if item['id'] == tier_id)
        descriptors = core['features'] + ([] if tier is core else tier['features'])
        features = {}
        for descriptor in descriptors:
            parts = descriptor.split(':')
            features[parts[1]] = (True if parts[0] == 'boolean'
                                  else int(parts[2]) if len(parts) == 3 else None)
        return {'schema_version': 1, 'channel': 'control_plane',
                'modules': self.catalog['base_modules'] + tier['modules'], 'features': features}

    def parse(self, policy, catalog_raw=None):
        raw = self.raw if catalog_raw is None else catalog_raw
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        with patch.object(Path, 'read_bytes', return_value=raw):
            return managed_policy.parse_create_policy(
                json.dumps(policy).encode(), catalog_path=V2_PATH,
                catalog_sha256=digest, commercial_mode='saas')

    def test_v2_complete_policy_round_trips_with_zero_branch_ceiling(self):
        for tier in self.catalog['tiers']:
            policy = self.policy_for(tier['id'])
            self.assertEqual(policy['features']['branches.extra_limit'], 0)
            self.assertIs(type(policy['features']['branches.extra_limit']), int)
            self.assertEqual(self.parse(policy), policy)

    def test_v2_refuses_missing_wrong_or_boolean_branch_ceiling(self):
        for mutate in (lambda f: f.pop('branches.extra_limit'),
                       lambda f: f.update({'branches.extra_limit': None}),
                       lambda f: f.update({'branches.extra_limit': 3}),
                       lambda f: f.update({'branches.extra_limit': False})):
            policy = self.policy_for('core')
            mutate(policy['features'])
            with self.assertRaises(managed_policy.PolicyError) as caught:
                self.parse(policy)
            self.assertEqual(caught.exception.code, 'policy_composition_mismatch')

    def test_legacy_bytes_still_parse_to_two_limit_policy(self):
        raw = CATALOG_PATH.read_bytes()
        catalog = json.loads(raw)
        policy = {'schema_version': 1, 'channel': 'control_plane', 'modules': catalog['base_modules'],
                  'features': {'users.limit': None, 'storage.limit_mb': None}}
        with patch.object(Path, 'read_bytes', return_value=raw):
            self.assertEqual(managed_policy.parse_create_policy(
                json.dumps(policy).encode(), catalog_path=CATALOG_PATH,
                catalog_sha256='sha256:' + hashlib.sha256(raw).hexdigest(),
                commercial_mode='saas'), policy)

    def test_malformed_descriptors_are_catalog_invalid(self):
        for descriptor in ('limit:branches.extra_limit:0:1', 'limit:branches.extra_limit:-1',
                           'limit:branches.extra_limit:x', 'boolean:pmo.enabled:1'):
            catalog = json.loads(self.raw)
            catalog['tiers'][0]['features'].append(descriptor)
            with self.assertRaises(managed_policy.PolicyError) as caught:
                self.parse(self.policy_for('core'), json.dumps(catalog).encode())
            self.assertEqual(caught.exception.code, 'catalog_invalid', descriptor)

    def test_legacy_schema_rejects_numeric_ceiling_descriptor(self):
        catalog = json.loads(CATALOG_PATH.read_bytes())
        catalog['tiers'][0]['features'].append('limit:branches.extra_limit:0')
        raw = json.dumps(catalog).encode()
        policy = {'schema_version': 1, 'channel': 'control_plane', 'modules': catalog['base_modules'],
                  'features': {'users.limit': None, 'storage.limit_mb': None, 'branches.extra_limit': 0}}
        with patch.object(Path, 'read_bytes', return_value=raw):
            with self.assertRaises(managed_policy.PolicyError) as caught:
                managed_policy.parse_create_policy(
                    json.dumps(policy).encode(), catalog_path=CATALOG_PATH,
                    catalog_sha256='sha256:' + hashlib.sha256(raw).hexdigest(), commercial_mode='saas')
        self.assertEqual(caught.exception.code, 'catalog_invalid')

    def test_catalog_features_cover_platform_registry_required_limits(self):
        import re
        registry = (Path(__file__).resolve().parents[1]
                    / 'odoo-addons/liwan_platform/models/feature_registry.py').read_text()
        required = set(re.findall(r"'key': '([a-z_.]+)',\s*'type': 'limit',\s*'owner': 'liwan_platform'", registry))
        self.assertEqual(required, {'users.limit', 'storage.limit_mb', 'branches.extra_limit'})
        for tier in self.catalog['tiers']:
            self.assertLessEqual(required, set(self.policy_for(tier['id'])['features']))


if __name__ == '__main__':
    unittest.main()


PARITY_PATH = Path(__file__).resolve().parents[1] / 'deploy/catalog/fixtures/descriptor_parity.json'


class DescriptorParityFixtureCase(unittest.TestCase):
    """The same fixture is loaded by the TypeScript parser tests."""

    def setUp(self):
        self.fixture = json.loads(PARITY_PATH.read_text('utf-8'))

    def test_grammar_constant_equals_fixture(self):
        self.assertEqual(managed_policy.DESCRIPTOR_GRAMMAR_V2, self.fixture['grammar_v2'])

    def test_every_case_agrees_with_the_expected_verdict(self):
        names = set()
        for case in self.fixture['cases']:
            self.assertNotIn(case['name'], names)
            names.add(case['name'])
            if 'python' not in case.get('runtimes', ['python', 'ts']):
                continue
            with self.subTest(case=case['name']):
                if case['expect'] == 'accept':
                    managed_policy._catalog_compositions(copy.deepcopy(case['catalog']))
                else:
                    with self.assertRaises(managed_policy.PolicyError) as caught:
                        managed_policy._catalog_compositions(copy.deepcopy(case['catalog']))
                    self.assertEqual(caught.exception.code, case['error'])

    def test_platform_v2_initial_branch_ceiling_is_integer_zero(self):
        core = json.loads(V2_PATH.read_bytes())['tiers'][0]
        self.assertIn('limit:branches.extra_limit:0', core['features'])


RELEASE_PATH = Path(__file__).resolve().parents[1] / 'deploy/catalog/fixtures/release_features.json'


class ReleaseFeaturesFixtureCase(unittest.TestCase):
    """The same fixture is loaded by release-features.test.ts."""

    def test_every_case_derives_the_same_modules_and_features(self):
        for case in json.loads(RELEASE_PATH.read_text('utf-8'))['cases']:
            with self.subTest(case=case['name']):
                catalog = copy.deepcopy(case['catalog'])
                ids = [tier['id'] for tier in catalog['tiers']]
                modules, features = managed_policy._catalog_compositions(catalog)[ids.index(case['tier'])]
                self.assertEqual(modules, case['modules'])
                self.assertTrue(managed_policy._same_features(features, case['features']), features)

    def test_release_modules_lists_base_first(self):
        catalog = json.loads(RELEASE_PATH.read_text('utf-8'))['cases'][0]['catalog']
        self.assertEqual(managed_policy.release_modules(catalog),
                         ['liwan_core', 'liwan_platform', 'liwan_api', 'liwan_pmo', 'liwan_meetings', 'liwan_hr'])
