# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hermetic RED-first script execution and strict policy readback contracts."""
import contextlib
import copy
import importlib.util
import io
import json
import sys
import types
import unittest
from unittest.mock import patch

if importlib.util.find_spec('liwan_cli.managed_verify') is None:
    verify = None
else:
    from liwan_cli import managed_verify as verify

DATABASE = 'liwan_scratch_managed_verify'
MARKER = 'LIWAN_MANAGED_POLICY:'
POLICY = {
    'schema_version': 1, 'channel': 'control_plane',
    'modules': ['liwan_core', 'liwan_platform', 'liwan_api', 'liwan_hr'],
    'features': {'users.limit': None, 'storage.limit_mb': 50, 'hr.enabled': True},
}


def snapshot():
    return {
        'database': DATABASE, 'commercial_mode': 'saas',
        'entitlement_source': 'control_plane', 'status': 'active',
        'valid_until': None, 'features': copy.deepcopy(POLICY['features']),
        'policy_revision': 1,
        # liwan_access_hr is the auto-installed bridge of liwan_api and liwan_hr.
        'modules': sorted([*POLICY['modules'], 'liwan_access_hr', 'liwan_notify', 'base', 'hr', 'project']),
    }


def output(value):
    return MARKER + json.dumps(value) + '\n'


class Cursor:
    def __init__(self, events, database):
        self.events, self.dbname = events, database

    def execute(self, query, params=None):
        self.events.append(('sql', query, params))

    def commit(self):
        self.events.append(('commit',))

    def rollback(self):
        self.events.append(('rollback',))


class Profile:
    def __init__(self, events):
        self.events = events
        self.count = 1
        self.singleton_key = 'tenant'
        self.commercial_mode = 'saas'
        self.entitlement_source = 'control_plane'
        self.status = 'active'
        self.valid_until = False
        self.commercial_valid_until = False
        self.features = {}
        self.policy_revision = 0
        self.context = {}
        self.ignore_write = False
        self.on_lock = None

    def __len__(self):
        return self.count

    def search(self, domain, limit=None):
        self.events.append(('profile.search', domain, limit))
        return self

    def _liwan_lock(self):
        self.events.append(('lock',))
        if self.on_lock:
            self.on_lock(self)
        return self

    def _liwan_require_policy_source(self, source):
        self.events.append(('require_source', source))
        if self.entitlement_source != source:
            message = 'private exception details'
            raise ValueError(message)

    def with_context(self, **context):
        self.context = context
        return self

    def write(self, values):
        assert self.context == {'liwan_platform.operator_policy': True}
        self.events.append(('write', copy.deepcopy(values)))
        if not self.ignore_write:
            for key, value in values.items():
                setattr(self, key, copy.deepcopy(value))
            self.policy_revision += 1

    def invalidate_recordset(self, *args, **kwargs):
        self.events.append(('invalidate',))


class Modules:
    def __init__(self, events):
        self.events = events
        self.names = [*POLICY['modules'], 'liwan_access_hr', 'liwan_notify', 'base', 'hr', 'project']

    def search(self, domain, limit=None):
        self.events.append(('modules.search', domain, limit))
        assert ('state', '=', 'installed') in domain
        return self

    def mapped(self, field):
        assert field == 'name'
        return list(self.names)


class Environment:
    def __init__(self, database=DATABASE):
        self.events = []
        self.cr = Cursor(self.events, database)
        self.profile = Profile(self.events)
        self.modules = Modules(self.events)
        self.su = True

    def __getitem__(self, name):
        return {'liwan.tenant.profile': self.profile, 'ir.module.module': self.modules}[name]

    def invalidate_all(self, *args, **kwargs):
        self.events.append(('invalidate_all',))


def execute_script(script, env, classification=None):
    config = types.ModuleType('odoo.addons.liwan_platform.commercial_config')
    entitlement = types.ModuleType('odoo.addons.liwan_platform.models.entitlement_service')
    entitlement.OPERATOR_CONTEXT = 'liwan_platform.operator_policy'

    def load_classification(database, valid_until=None):
        env.events.append(('classification', database, valid_until))
        if isinstance(classification, Exception):
            raise classification
        return classification or {
            'commercial_mode': 'saas', 'entitlement_source': 'control_plane',
            'clear_valid_until': False,
        }

    config.load_classification = load_classification
    stream = io.StringIO()
    with patch.dict(sys.modules, {config.__name__: config, entitlement.__name__: entitlement}):
        with contextlib.redirect_stdout(stream):
            exec(compile(script, '<managed-policy-script>', 'exec'), {'env': env})
    return stream.getvalue()


class VerifyCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(verify, 'managed_verify implementation is missing')
        self.policy = copy.deepcopy(POLICY)

    def reject(self, stdout, code=None):
        with self.assertRaises(verify.VerificationError) as caught:
            verify.parse_snapshot(stdout, self.policy, DATABASE)
        self.assertNotIn('private-secret', str(caught.exception))
        if code:
            self.assertEqual(caught.exception.code, code)

    def test_accepts_actual_snapshot_and_upstream_dependencies(self):
        self.assertEqual(verify.parse_snapshot('Odoo log\n' + output(snapshot()), self.policy, DATABASE), snapshot())

    def test_exactly_one_complete_sentinel_required(self):
        good = output(snapshot())
        for bad in ['', 'logs only', good + good, 'prefix ' + good, good + MARKER, MARKER + 'null',
                    MARKER + '[]', MARKER + '{bad}', good.rstrip() + ' trailing']:
            with self.subTest(bad=bad[:80]):
                self.reject(bad)

    def test_duplicate_json_keys_and_nonfinite_values_rejected(self):
        for text in [output(snapshot()).replace('"policy_revision": 1', '"policy_revision": 1, "policy_revision": 1'),
                     output(snapshot()).replace('"policy_revision": 1', '"policy_revision": NaN'),
                     output(snapshot()).replace('"hr.enabled": true', '"hr.enabled": true, "hr.enabled": true')]:
            self.reject(text)

    def test_output_bound_and_wrong_types_rejected(self):
        for bad in [None, b'bytes', 'x' * 65537, '\N{SNOWMAN}' * 22000, '\ud800']:
            self.reject(bad)

    def test_profile_and_revision_are_strict(self):
        changes = {
            'database': ['liwan_scratch_other', 'odoo19', None],
            'commercial_mode': ['non_saas', None], 'entitlement_source': ['local_policy'],
            'status': ['suspended', None], 'valid_until': ['2099-01-01', False, 0, ''],
            'policy_revision': [True, -1, 1.0, '1', None],
        }
        for field, values in changes.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    data = snapshot()
                    data[field] = value
                    self.reject(output(data))
        data = snapshot()
        data['policy_revision'] = 0
        self.assertEqual(verify.parse_snapshot(output(data), self.policy, DATABASE)['policy_revision'], 0)

    def test_fields_are_whitelisted(self):
        for field in snapshot():
            data = snapshot()
            del data[field]
            self.reject(output(data))
        data = snapshot()
        data['password'] = 'private-secret'
        self.reject(output(data))

    def test_feature_values_match_with_strict_types(self):
        for features in [None, [], {}, {**POLICY['features'], 'hr.enabled': 1},
                         {**POLICY['features'], 'storage.limit_mb': 50.0},
                         {**POLICY['features'], 'users.limit': False},
                         {**POLICY['features'], 'secret': 'private-secret'}]:
            data = snapshot()
            data['features'] = features
            self.reject(output(data))

    def test_module_composition_exact_for_liwan_not_upstream(self):
        for modules in [None, POLICY['modules'][:-1], [*snapshot()['modules'], 'liwan_pmo'],
                        [*snapshot()['modules'], 'liwan_chat'], [*snapshot()['modules'], 'liwan_extra'],
                        [*snapshot()['modules'], 'hr'], [*snapshot()['modules'], 1],
                        [*snapshot()['modules'], 'private-secret!']]:
            data = snapshot()
            data['modules'] = modules
            self.reject(output(data))

    def test_invalid_database_never_builds_executable_script(self):
        for database in ['odoo19', 'liwan_scratch_', 'liwan_scratch_X', 'liwan_scratch_a\n',
                         "liwan_scratch_x';raise Exception('injected')#", None, 'liwan_scratch_' + 'x' * 43]:
            for builder in [lambda: verify.build_policy_script(self.policy, database),
                            lambda: verify.build_snapshot_script(database)]:
                with self.assertRaises(verify.VerificationError):
                    builder()

    def test_invalid_policy_cannot_build_or_parse(self):
        policies = [None, {}, {**POLICY, 'channel': 'local_policy'},
                    {**POLICY, 'schema_version': True}, {**POLICY, 'password': 'private-secret'},
                    {**POLICY, 'modules': ['liwan_hr']},
                    {**POLICY, 'modules': [*POLICY['modules'], 'liwan_hr']},
                    {**POLICY, 'modules': [*POLICY['modules'], "x';raise Exception('injected')#"]},
                    {**POLICY, 'features': {'users.limit': 'private-secret'}},
                    {**POLICY, 'features': {'users.limit': -1}},
                    {**POLICY, 'features': {'x': 1000000001}},
                    {**POLICY, 'features': {'x': float('nan')}}]
        for policy in policies:
            with self.subTest(policy=policy):
                with self.assertRaises(verify.VerificationError):
                    verify.build_policy_script(policy, DATABASE)
                with self.assertRaises(verify.VerificationError):
                    verify.parse_snapshot(output(snapshot()), policy, DATABASE)

    def test_apply_locks_checks_source_and_commits_once_before_marker(self):
        env = Environment()
        script = verify.build_policy_script(self.policy, DATABASE)
        self.assertIn('json.loads(', script)
        actual = verify.parse_snapshot(execute_script(script, env), self.policy, DATABASE)
        self.assertEqual(actual, snapshot())
        names = [event[0] for event in env.events]
        self.assertEqual(names.count('commit'), 1)
        self.assertLess(names.index('lock'), names.index('require_source'))
        self.assertLess(names.index('require_source'), names.index('write'))
        self.assertLess(names.index('write'), names.index('commit'))
        self.assertFalse(any('res.users' in str(event) for event in env.events))

    def test_fresh_odoo_json_false_is_uninitialized_not_applied_evidence(self):
        env = Environment()
        env.profile.features = False
        actual = verify.parse_snapshot(execute_script(
            verify.build_policy_script(self.policy, DATABASE), env), self.policy, DATABASE)
        self.assertEqual(actual['features'], self.policy['features'])
        self.assertEqual(actual['policy_revision'], 1)
        env = Environment()
        env.profile.features = False
        self.reject(execute_script(verify.build_snapshot_script(DATABASE), env))

    def test_apply_does_not_echo_expected_when_write_ignored(self):
        env = Environment()
        env.profile.ignore_write = True
        self.reject(execute_script(verify.build_policy_script(self.policy, DATABASE), env))
        self.assertNotIn(('commit',), env.events)

    def test_apply_rejects_existing_or_changed_policy_after_lock(self):
        for revision, features in [(1, {}), (0, POLICY['features']), (True, {}), (-1, {}), (0, None)]:
            env = Environment()

            def changed(profile):
                profile.policy_revision, profile.features = revision, features
            env.profile.on_lock = changed
            self.reject(execute_script(verify.build_policy_script(self.policy, DATABASE), env))
            self.assertFalse(any(event[0] in {'write', 'commit'} for event in env.events))

    def test_scripts_reject_wrong_target_before_model_access(self):
        for script in [verify.build_policy_script(self.policy, DATABASE), verify.build_snapshot_script(DATABASE)]:
            env = Environment('liwan_scratch_other')
            self.reject(execute_script(script, env))
            self.assertFalse(any(event[0] in {'profile.search', 'modules.search', 'write', 'commit'} for event in env.events))

    def test_scripts_reject_non_singleton_classification_status_and_expiry(self):
        scripts = [verify.build_policy_script(self.policy, DATABASE), verify.build_snapshot_script(DATABASE)]
        for script in scripts:
            for field, value in [('count', 0), ('count', 2), ('commercial_mode', 'non_saas'),
                                 ('entitlement_source', 'local_policy'), ('status', 'suspended'),
                                 ('valid_until', '2099-01-01'), ('singleton_key', 'other')]:
                with self.subTest(field=field, script=script[:30]):
                    env = Environment()
                    setattr(env.profile, field, value)
                    self.reject(execute_script(script, env))
                    self.assertFalse(any(event[0] in {'write', 'commit'} for event in env.events))

    def test_scripts_sanitize_classification_errors(self):
        for script in [verify.build_policy_script(self.policy, DATABASE), verify.build_snapshot_script(DATABASE)]:
            for classification in [ValueError('private-secret'), {'commercial_mode': 'non_saas', 'entitlement_source': 'local_policy'}]:
                env = Environment()
                stdout = execute_script(script, env, classification)
                self.assertNotIn('private-secret', stdout)
                self.reject(stdout)
                self.assertNotIn(('commit',), env.events)

    def test_apply_checks_missing_and_unselected_modules_before_write(self):
        for modules in [POLICY['modules'][:-1], [*POLICY['modules'], 'liwan_pmo'],
                        [*POLICY['modules'], 'liwan_chat']]:
            env = Environment()
            env.modules.names = modules
            self.reject(execute_script(verify.build_policy_script(self.policy, DATABASE), env))
            self.assertFalse(any(event[0] in {'write', 'commit'} for event in env.events))

    def test_snapshot_reads_real_policy_without_mutating_or_committing(self):
        env = Environment()
        env.profile.features = copy.deepcopy(POLICY['features'])
        env.profile.policy_revision = 7
        result = verify.parse_snapshot(execute_script(verify.build_snapshot_script(DATABASE), env), self.policy, DATABASE)
        self.assertEqual(result['policy_revision'], 7)
        self.assertFalse(any(event[0] in {'write', 'commit', 'lock'} for event in env.events))
        self.assertTrue(any(event[0] == 'sql' and 'READ ONLY' in event[1] for event in env.events))
        self.assertEqual(env.events[-1], ('rollback',))
        env.profile.features['hr.enabled'] = False
        self.reject(execute_script(verify.build_snapshot_script(DATABASE), env))

    def test_snapshot_does_not_emit_invalid_or_secret_feature_values(self):
        env = Environment()
        env.profile.features = {'hr.enabled': 'private-secret'}
        stdout = execute_script(verify.build_snapshot_script(DATABASE), env)
        self.assertNotIn('private-secret', stdout)
        self.reject(stdout)

    def test_each_supported_composition_runs_without_extra_pillars(self):
        base = ['liwan_core', 'liwan_platform', 'liwan_api']
        for selected, extra_features in [([], {}), (['liwan_chat'], {'chat.enabled': True}),
                                         (['liwan_pmo'], {'pmo.enabled': True, 'meetings.enabled': True,
                                                         'projects.max_projects': None})]:
            policy = {**POLICY, 'modules': base + selected,
                      'features': {'users.limit': None, 'storage.limit_mb': None, **extra_features}}
            env = Environment()
            # Odoo also installs what the selection implies (pmo needs notify and directory).
            implied = ['liwan_notify', 'liwan_directory'] if 'liwan_pmo' in selected else []
            env.modules.names = base + selected + implied + ['hr', 'project']
            stdout = execute_script(verify.build_policy_script(policy, DATABASE), env)
            self.assertEqual(verify.parse_snapshot(stdout, policy, DATABASE)['features'], policy['features'])

    def test_installed_set_is_compared_with_the_install_closure(self):
        base = ['liwan_core', 'liwan_platform', 'liwan_api']
        policy = {**POLICY, 'modules': base + ['liwan_pmo'],
                  'features': {'users.limit': None, 'storage.limit_mb': None,
                               'pmo.enabled': True, 'meetings.enabled': True,
                               'projects.max_projects': None}}
        closure = base + ['liwan_notify', 'liwan_directory', 'liwan_pmo']

        def installed(extra):
            data = snapshot()
            data['features'] = copy.deepcopy(policy['features'])
            data['modules'] = sorted([*closure, *extra, 'base', 'project'])
            return output(data)

        self.assertEqual(verify.parse_snapshot(installed([]), policy, DATABASE)['modules'].count('liwan_notify'), 1)
        for extra in (['liwan_chat'], ['liwan_hr']):
            with self.assertRaises(verify.VerificationError) as caught:
                verify.parse_snapshot(installed(extra), policy, DATABASE)
            self.assertEqual(caught.exception.code, 'modules_mismatch')
        data = snapshot()
        data['features'] = copy.deepcopy(policy['features'])
        data['modules'] = sorted([*base, 'liwan_notify', 'liwan_pmo', 'base'])  # liwan_directory missing
        with self.assertRaises(verify.VerificationError) as caught:
            verify.parse_snapshot(output(data), policy, DATABASE)
        self.assertEqual(caught.exception.code, 'modules_mismatch')

    def test_apply_script_accepts_closure_and_refuses_extra_or_missing(self):
        base = ['liwan_core', 'liwan_platform', 'liwan_api']
        policy = {**POLICY, 'modules': base + ['liwan_pmo'],
                  'features': {'users.limit': None, 'storage.limit_mb': None,
                               'pmo.enabled': True, 'meetings.enabled': True,
                               'projects.max_projects': None}}
        closure = base + ['liwan_notify', 'liwan_directory', 'liwan_pmo']
        for names, ok in [(closure, True), (closure + ['liwan_chat'], False),
                          ([n for n in closure if n != 'liwan_notify'], False)]:
            env = Environment()
            env.modules.names = names + ['project']
            stdout = execute_script(verify.build_policy_script(policy, DATABASE), env)
            if ok:
                verify.parse_snapshot(stdout, policy, DATABASE)
                self.assertIn(('commit',), env.events)
            else:
                with self.assertRaises(verify.VerificationError):
                    verify.parse_snapshot(stdout, policy, DATABASE)
                self.assertNotIn(('commit',), env.events)

    def test_policy_and_module_bounds(self):
        policy = copy.deepcopy(POLICY)
        policy['features'] = {('f' + str(i)).ljust(64, 'x'): None for i in range(256)}
        with self.assertRaises(verify.VerificationError):
            verify.build_policy_script(policy, DATABASE)
        data = snapshot()
        data['modules'] += ['module_' + str(i) for i in range(1025)]
        self.reject(output(data))
        env = Environment()
        env.modules.names = data['modules']
        self.reject(execute_script(verify.build_policy_script(self.policy, DATABASE), env))
        self.assertNotIn(('commit',), env.events)

    def test_nested_or_invalid_error_payload_is_sanitized(self):
        for value in [[], {}, None, 1]:
            self.reject(output({'error_code': value}), 'snapshot_invalid')
        self.reject(MARKER + '[' * 2000 + '0' + ']' * 2000)
        self.assertEqual(verify.VerificationError('private-secret').code, 'snapshot_invalid')

    def test_commit_failure_is_not_success_and_does_not_echo_exception(self):
        env = Environment()
        with patch.object(env.cr, 'commit', side_effect=RuntimeError('private-secret')):
            stdout = execute_script(verify.build_policy_script(self.policy, DATABASE), env)
        self.assertNotIn('private-secret', stdout)
        self.reject(stdout, 'policy_script_failed')
        self.assertIn(('rollback',), env.events)

    def test_script_failure_marker_uses_safe_error_code(self):
        self.reject(output({'error_code': 'private-secret'}), 'snapshot_invalid')
        self.reject(output({'error_code': 'target_mismatch'}), 'target_mismatch')



class V2RevisionZeroTests(unittest.TestCase):
    def test_revision_zero_accepts_complete_v2_policy_and_rejects_legacy_subset(self):
        policy = {'schema_version': 1, 'channel': 'control_plane',
                  'modules': ['liwan_core', 'liwan_platform', 'liwan_api'],
                  'features': {'users.limit': None, 'storage.limit_mb': None, 'branches.extra_limit': 0}}
        data = {'database': DATABASE, 'commercial_mode': 'saas', 'entitlement_source': 'control_plane',
                'status': 'active', 'valid_until': None, 'features': dict(policy['features']),
                'policy_revision': 0, 'modules': sorted([*policy['modules'], 'base', 'project'])}
        self.assertEqual(verify.parse_snapshot(output(data), policy, DATABASE), data)
        data['features'].pop('branches.extra_limit')
        with self.assertRaises(verify.VerificationError) as caught:
            verify.parse_snapshot(output(data), policy, DATABASE)
        self.assertEqual(caught.exception.code, 'features_mismatch')



class LegacyBranchCompatibilityTests(unittest.TestCase):
    def test_host_readback_keeps_legacy_policy_bytes_and_observed_null(self):
        policy = copy.deepcopy(POLICY)
        before = json.dumps(policy, sort_keys=True)
        data = snapshot()
        data['features']['branches.extra_limit'] = None
        actual = verify.parse_snapshot(output(data), policy, DATABASE)
        self.assertEqual(actual, data)
        self.assertIn('branches.extra_limit', actual['features'])
        self.assertEqual(json.dumps(policy, sort_keys=True), before)

    def test_host_branch_comparison_is_directional_and_type_exact(self):
        absent = object()
        for expected, actual, accepted in [
            (absent, absent, True), (absent, None, True), (absent, 0, False),
            (absent, 1, False), (absent, False, False), (0, 0, True),
            (0, absent, False), (0, None, False), (0, False, False),
            (0, 0.0, False), (None, absent, False), (None, None, True),
        ]:
            with self.subTest(expected=expected, actual=actual):
                policy, data = copy.deepcopy(POLICY), snapshot()
                if expected is not absent:
                    policy['features']['branches.extra_limit'] = expected
                if actual is not absent:
                    data['features']['branches.extra_limit'] = actual
                if accepted:
                    self.assertEqual(verify.parse_snapshot(output(data), policy, DATABASE), data)
                else:
                    with self.assertRaises(verify.VerificationError):
                        verify.parse_snapshot(output(data), policy, DATABASE)
        data = snapshot()
        data['features'].update({'branches.extra_limit': None, 'other.limit': None})
        with self.assertRaises(verify.VerificationError):
            verify.parse_snapshot(output(data), POLICY, DATABASE)

    def test_generated_apply_uses_same_directional_readback(self):
        for actual, accepted in [(None, True), (0, False), (1, False), (False, False)]:
            with self.subTest(actual=actual):
                env = Environment()
                write = env.profile.write
                def migrated_write(values):
                    write(values)
                    env.profile.features = {**env.profile.features, 'branches.extra_limit': actual}
                env.profile.write = migrated_write
                policy = copy.deepcopy(POLICY)
                before = json.dumps(policy, sort_keys=True)
                result = execute_script(verify.build_policy_script(policy, DATABASE), env)
                self.assertEqual(json.dumps(policy, sort_keys=True), before)
                if accepted:
                    self.assertIsNone(verify.parse_snapshot(result, policy, DATABASE)['features']['branches.extra_limit'])
                    self.assertIn(('commit',), env.events)
                else:
                    with self.assertRaises(verify.VerificationError):
                        verify.parse_snapshot(result, policy, DATABASE)
                    self.assertNotIn(('commit',), env.events)


if __name__ == '__main__':
    unittest.main()
