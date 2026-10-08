# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import io
import json
from types import SimpleNamespace
import tempfile
import unittest
import unittest.mock
from pathlib import Path
from tools.shared_saas_lifecycle import odoo_effect

class PhysicalBoundaryTests(unittest.TestCase):
    def test_database_and_modules_fail_closed(self):
        self.assertEqual(odoo_effect.validate_database('nasq_scratch_' + 'a' * 32), 'nasq_scratch_' + 'a' * 32)
        for value in ['odoo19', 'postgres', 'nasq_scratch_prod', 'nasq_scratch_a;drop']:
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.validate_database(value)
        for value in [['nasq_core', 'sale'], ['nasq_core', 'nasq_not_shipped'], ['nasq_core', 'nasq_registry_probe'], [{'a': 1}], [], ['nasq_core', 'nasq_core'], 'nasq_core']:
            with self.subTest(value=value), self.assertRaises(odoo_effect.EffectError):
                odoo_effect.validate_modules(value)
        release = ['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_meetings', 'nasq_hr', 'nasq_chat']
        self.assertEqual(odoo_effect.validate_modules(release), release)
        self.assertFalse(hasattr(odoo_effect, 'ALLOWED_MODULES'))

    def test_permanent_reservation_refuses_reclaim_or_symlink(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            odoo_effect.reserve(root / 'db.json', {'attempt': 'first'})
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.reserve(root / 'db.json', {'attempt': 'second'})
            (root / 'link.json').symlink_to(root / 'db.json')
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.reserve(root / 'link.json', {'attempt': 'third'})

    def test_existing_database_or_filestore_is_never_adopted(self):
        for database_exists, filestore_exists in [(True, False), (False, True), (True, True)]:
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.require_new_target(database_exists, filestore_exists)
        odoo_effect.require_new_target(False, False)

    def test_observation_never_returns_present_from_marker_only(self):
        self.assertEqual(odoo_effect.verified_observation({}, False), {'state': 'partial'})

class PackageAdministratorScriptTests(unittest.TestCase):
    """Execute the generated control flow with a minimal Odoo protocol double.

    This verifies package/legacy branching and fail-closed readback, not ORM or
    actual quota semantics; the parent owns fresh isolated Odoo acceptance.
    """
    def run_script(self, *, package=True, snapshot=False, support=True, count=None):
        writes = []
        roles = {'existing_customer_role'}
        company = SimpleNamespace(id=1, name='Company')
        company.write = lambda values: (writes.append(('company', values)), setattr(company, 'name', values['name']))

        class Admin:
            id = 2
            active = True
            share = False
            company_id = company
            login = 'customer@example.test' if snapshot else 'admin'
            name = 'Customer administrator' if snapshot else 'Administrator'
            support_member = support
            def _nasq_access_write(self, values, capability):
                writes.append(('user', values, capability))
                for key, value in values.items():
                    if key == 'group_ids':
                        if value != [(3, 99, 0)]:
                            raise AssertionError('must unlink only vendor support')
                        self.support_member = False
                    else:
                        setattr(self, key, value)
            def _nasq_sync_capability_groups(self):
                writes.append(('sync', set(roles)))
            def has_group(self, xmlid):
                assert xmlid == 'nasq_core.group_vendor_support'
                return self.support_member
            def _crypt_context(self):
                return SimpleNamespace(verify=lambda value, hashed: value == 'known-secret' and hashed == 'hash')

        admin = Admin()
        if snapshot:
            roles.update({'system_admin', 'pmo_manager', 'hr_manager'})

        class Records(list):
            policy_revision = 1
            root_company_id = company
            def mapped(self, path):
                assert path == 'role_id.key'
                return sorted(roles)

        class Assignments:
            def search(self, domain):
                key = next((value for field, op, value in domain if field == 'role_id'), None)
                return Records([key] if key in roles or key is None else [])
            def create(self, values):
                roles.add(values['role_id'])
                writes.append(('role', values['role_id']))

        class Cursor:
            dbname = 'nasq_scratch_' + 'a' * 32
            def rollback(self):
                pass
            def commit(self):
                writes.append(('commit',))
            def execute(self, sql, params=None):
                assert sql == 'SET TRANSACTION READ ONLY' or sql == 'SELECT password FROM res_users WHERE id=%s'
            def fetchone(self):
                return ('hash',)

        class Environment:
            su = True
            uid = 1
            cr = Cursor()
            def __getitem__(self, model):
                if model == 'nasq.tenant.profile':
                    return SimpleNamespace(search=lambda *args, **kwargs: Records([1]))
                if model == 'nasq.access.assignment':
                    return Assignments()
                if model == 'nasq.entitlement.service':
                    return SimpleNamespace(
                        _nasq_excluded_user_ids=lambda: (1, 2) if admin.support_member else (1,),
                        _nasq_count_users=lambda: count if count is not None else (0 if admin.support_member else 1),
                        _nasq_entitled_admin_roles=lambda: ['system_admin', 'pmo_manager', 'hr_manager'],
                    )
                if model == 'nasq.access.role':
                    return SimpleNamespace(search=lambda domain, limit=None: SimpleNamespace(id=domain[0][2]))
                raise AssertionError(model)
            def ref(self, xmlid):
                if xmlid == 'base.user_admin':
                    return admin
                if xmlid == 'nasq_core.group_vendor_support':
                    return SimpleNamespace(id=99)
                raise AssertionError(xmlid)
            def invalidate_all(self, **kwargs):
                pass
            def flush_all(self):
                writes.append(('flush',))

        runner = object.__new__(odoo_effect.Runner)
        runner.database = Cursor.dbname
        runner.request = {'admin': {'name': 'Customer administrator', 'login': 'customer@example.test'},
                          'companyName': 'Company', 'job': {'policy': {'modules': ['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_hr']}}}
        if package:
            runner.request['job']['packageAuthority'] = {'schemaVersion': 2}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(compile(runner.admin_script('known-secret', snapshot=snapshot), '<generated-admin>', 'exec'), {'env': Environment()})
        result = json.loads(output.getvalue().strip().removeprefix('NASQ_SHARED_ADMIN:'))
        return result, writes, admin, roles

    def test_admin_script_reads_roles_from_the_entitlement_not_modules(self):
        script = object.__new__(odoo_effect.Runner)
        script.database = 'nasq_scratch_' + 'a' * 32
        script.request = {'admin': {'name': 'A', 'login': 'a@example.test'}, 'companyName': 'C',
                          'job': {'policy': {'modules': ['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_hr']}}}
        text = script.admin_script('known-secret', snapshot=False)
        self.assertIn('_nasq_entitled_admin_roles()', text)
        self.assertNotIn("'nasq_pmo' in values['modules']", text)
        self.assertNotIn('"modules"', text.split('\n', 2)[1])

    def test_package_apply_removes_only_support_and_preserves_customer_roles(self):
        result, writes, admin, roles = self.run_script()
        self.assertEqual(result, {'verified': True, 'uid': 2})
        self.assertFalse(admin.support_member)
        self.assertEqual(roles, {'existing_customer_role', 'system_admin', 'pmo_manager', 'hr_manager'})
        self.assertIn(('user', {'group_ids': [(3, 99, 0)]}, 'access.users.assign_roles'), writes)
        self.assertTrue(any(entry[0] == 'sync' for entry in writes))

    def test_package_snapshot_refuses_support_or_missing_count_without_writes(self):
        for support, count in [(True, 1), (False, 0)]:
            with self.subTest(support=support, count=count):
                result, writes, _admin, _roles = self.run_script(snapshot=True, support=support, count=count)
                self.assertEqual(result, {'verified': False})
                self.assertEqual(writes, [])

    def test_package_snapshot_accepts_counted_customer_without_writes(self):
        result, writes, _admin, _roles = self.run_script(snapshot=True, support=False, count=1)
        self.assertEqual(result, {'verified': True, 'uid': 2})
        self.assertEqual(writes, [])

    def test_legacy_apply_and_snapshot_keep_original_support_behavior(self):
        for snapshot in (False, True):
            result, writes, admin, _roles = self.run_script(package=False, snapshot=snapshot, count=0)
            self.assertEqual(result, {'verified': True, 'uid': 2})
            self.assertTrue(admin.support_member)
            self.assertFalse(any(entry[0] == 'sync' or (entry[0] == 'user' and 'group_ids' in entry[1]) for entry in writes))

class DiagnosticsAndCatalogTests(unittest.TestCase):
    SYNTHETIC_DIAGNOSTIC = (
        'password=synthetic-password; script=synthetic-script; '
        'stdout=synthetic-stdout; stderr=synthetic-stderr; '
        'Traceback: synthetic-traceback; path=/synthetic/private'
    )

    def assert_preflight_failure(self, error, expected_stdout):
        """Exercise real main/observe/preflight, with no runtime or file access."""
        config = {'schemaVersion': 1, 'projectName': 'nasq-shared-diagnostic',
                  'composeFile': '/synthetic/compose.yml', 'envFile': '/synthetic/runtime.env',
                  'stateDir': '/synthetic/state', 'domainSuffix': 'example.test'}
        database = 'nasq_scratch_' + 'a' * 32
        digest = 'b' * 64
        request = {'action': 'observe', 'config': config,
                   'job': {'operation': 'provision',
                           'binding': {'database': database, 'filestore': database},
                           'policy': {'schema_version': 1, 'channel': 'control_plane',
                                      'modules': ['nasq_core', 'nasq_platform', 'nasq_api'],
                                      'features': {'users.limit': None, 'storage.limit_mb': None,
                                                   'branches.extra_limit': 0}},
                           'catalog': {'sourceSha256': digest}}}
        base = ['docker', 'compose', '--project-name', config['projectName'],
                '--env-file', config['envFile'], '--file', config['composeFile']]
        container = 'c' * 64
        commands = [base + ['config', '--format', 'json'], base + ['ps', '-q', 'db'],
                    ['docker', 'inspect', container]]
        replies = [json.dumps({'name': config['projectName'], 'services': {'db': {}, 'odoo': {}}}),
                   container + '\n',
                   json.dumps([{'Config': {'Labels': {
                       'com.docker.compose.project': config['projectName'],
                       'com.docker.compose.service': 'db'}}}])]
        events = []

        def command(_runner, args, *, stdin='', timeout=90):
            index = len(events)
            events.append(('command', args))
            self.assertLess(index, len(commands), 'unexpected post-refusal command')
            self.assertEqual(args, commands[index])
            self.assertEqual((stdin, timeout), ('', 90))
            return replies[index]

        def source(sha):
            events.append(('catalog', sha))
            raise error

        def path_validation(path):
            self.assertIn(path, [config[key] for key in ('composeFile', 'envFile', 'stateDir')])
            return Path(path)

        def path_exists(path):
            self.assertEqual(path, Path(config['stateDir']) / 'runtime-gate')
            return False

        out, err = io.StringIO(), io.StringIO()
        with contextlib.ExitStack() as stack:
            stack.enter_context(contextlib.redirect_stdout(out))
            stack.enter_context(contextlib.redirect_stderr(err))
            stack.enter_context(unittest.mock.patch.object(odoo_effect.sys, 'stdin', io.StringIO(json.dumps(request) + '\n')))
            stack.enter_context(unittest.mock.patch.object(odoo_effect.signal, 'signal'))
            paths = stack.enter_context(unittest.mock.patch.object(odoo_effect, 'no_symlink', side_effect=path_validation))
            exists = stack.enter_context(unittest.mock.patch.object(Path, 'exists', autospec=True, side_effect=path_exists))
            stack.enter_context(unittest.mock.patch.object(odoo_effect.Runner, 'command', autospec=True, side_effect=command))
            resolver = stack.enter_context(unittest.mock.patch.object(odoo_effect, 'resolve_catalog_path', side_effect=source))
            # main catches AssertionError too: verify every guard's call count
            # outside the error boundary, not just its fail-fast side effect.
            guards = []
            for target, names in (
                (odoo_effect.subprocess, ('Popen', 'run')),
                (Path, ('read_text', 'read_bytes')),
                (odoo_effect.Runner, ('exists', 'filestore_exists', 'shell', 'apply_owned', 'apply',
                                      'assert_no_effect_containers')),
                (odoo_effect.RuntimeGate, ('acquire', 'complete')),
                (odoo_effect, ('parse_create_policy', 'parse_package_create_policy', 'reserve', 'permit')),
            ):
                for name in names:
                    guard = stack.enter_context(unittest.mock.patch.object(
                        target, name, side_effect=AssertionError('unexpected downstream/physical access: ' + name)))
                    guards.append(guard)
            result = odoo_effect.main()

        self.assertEqual(events, [('command', args) for args in commands] + [('catalog', digest)])
        resolver.assert_called_once_with(digest)
        self.assertEqual(paths.call_args_list, [unittest.mock.call(config[key])
                                              for key in ('composeFile', 'envFile', 'stateDir')])
        exists.assert_called_once_with(Path(config['stateDir']) / 'runtime-gate')
        for guard in guards:
            guard.assert_not_called()
        self.assertEqual(result, 1)
        self.assertEqual(out.getvalue(), expected_stdout)
        self.assertEqual(err.getvalue(), '')

    def catalog_error(self, code):
        error = odoo_effect.CatalogSourceError(code)
        # Keep the existing typed code while making exception text sensitive.
        error.args = (self.SYNTHETIC_DIAGNOSTIC,)
        return error

    def test_main_reports_missing_pinned_catalog_through_real_preflight(self):
        self.assert_preflight_failure(self.catalog_error('catalog_source_unavailable'),
                                      '{"error_code":"catalog_source_unavailable"}\n')

    def test_main_reports_ambiguous_pinned_catalog_through_real_preflight(self):
        self.assert_preflight_failure(self.catalog_error('catalog_source_ambiguous'),
                                      '{"error_code":"catalog_source_ambiguous"}\n')

    def test_main_keeps_untyped_unknown_and_near_match_errors_opaque(self):
        errors = [odoo_effect.EffectError(self.SYNTHETIC_DIAGNOSTIC),
                  RuntimeError(self.SYNTHETIC_DIAGNOSTIC),
                  self.catalog_error('unknown_catalog_code')]
        for code in ('catalog_source_unavailable', 'catalog_source_ambiguous'):
            for near_match in ('prefix_' + code, code + '_suffix', ' ' + code, code + ' '):
                errors.append(self.catalog_error(near_match))
        for code in sorted(odoo_effect.REPORTABLE_CODES):
            errors.extend((ValueError(code), odoo_effect.EffectError(code),
                           RuntimeError(self.SYNTHETIC_DIAGNOSTIC + '; ' + code)))
        for index, error in enumerate(errors):
            with self.subTest(index=index, error_type=type(error).__name__, code=getattr(error, 'code', None)):
                self.assert_preflight_failure(error, '{"error_code":"shared_effect_unverified"}\n')

    def test_classify_error_allowlists_non_secret_codes_only(self):
        from tools.nasq_cli.managed_verify import VerificationError
        from tools.shared_saas_lifecycle.catalog_source import CatalogSourceError
        for code in ('policy_script_failed', 'target_mismatch', 'policy_already_initialized',
                     'features_mismatch', 'modules_mismatch', 'snapshot_invalid'):
            self.assertEqual(odoo_effect.classify_error(VerificationError(code)), code)
        self.assertEqual(odoo_effect.classify_error(CatalogSourceError('catalog_source_ambiguous')),
                         'catalog_source_ambiguous')
        # Managed-policy refusal codes are stable safe identifiers and propagate.
        from tools.nasq_cli.managed_policy import POLICY_ERROR_CODES, PolicyError
        for code in POLICY_ERROR_CODES:
            self.assertEqual(odoo_effect.classify_error(PolicyError(code)), code)
        self.assertEqual(odoo_effect.classify_error(PolicyError('not_an_allowlisted_code')),
                         'shared_effect_unverified')
        for error in (Exception('secret stderr text'), odoo_effect.EffectError('runtime_path_invalid'),
                      ValueError('target_mismatch')):
            self.assertEqual(odoo_effect.classify_error(error), 'shared_effect_unverified')

    def test_main_emits_only_the_classified_code_never_exception_text(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), unittest.mock.patch(
                'sys.stdin', io.StringIO('{not json secret-token')):
            self.assertEqual(odoo_effect.main(), 1)
        self.assertEqual(json.loads(out.getvalue()), {'error_code': 'shared_effect_unverified'})
        self.assertNotIn('secret-token', out.getvalue())

    def test_policy_payload_is_checked_against_sha_pinned_catalog_bytes(self):
        import hashlib
        from tools.nasq_cli.managed_policy import PolicyError, parse_create_policy
        from tools.shared_saas_lifecycle.catalog_source import resolve_catalog_path
        root = Path(__file__).resolve().parents[2]
        raw = (root / 'deploy/catalog/solutions/platform_v2.json').read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        catalog = json.loads(raw)
        policy = {'schema_version': 1, 'channel': 'control_plane', 'modules': catalog['base_modules'],
                  'features': {'users.limit': None, 'storage.limit_mb': None, 'branches.extra_limit': 0}}
        path = resolve_catalog_path(digest, root)
        self.assertEqual(path.name, 'platform_v2.json')
        parse_create_policy(json.dumps(policy).encode(), catalog_path=path,
                            catalog_sha256='sha256:' + digest, commercial_mode='saas')
        # The legacy two-limit payload is no longer a complete v2 policy.
        del policy['features']['branches.extra_limit']
        with self.assertRaises(PolicyError):
            parse_create_policy(json.dumps(policy).encode(), catalog_path=path,
                                catalog_sha256='sha256:' + digest, commercial_mode='saas')

class RuntimeWriterCodeTests(unittest.TestCase):
    PROJECT = 'nasq-shared-test'

    def test_codes_cross_the_boundary_by_name(self):
        for code in ('runtime_writer_present', 'runtime_writer_after_effect'):
            self.assertEqual(odoo_effect.classify_error(odoo_effect.EffectError(code)), code)
        self.assertEqual(odoo_effect.classify_error(odoo_effect.EffectError('anything_else')), 'shared_effect_unverified')

    def test_writer_found_after_effects_uses_the_after_effect_code_and_keeps_the_gate(self):
        with tempfile.TemporaryDirectory() as raw:
            runner = object.__new__(odoo_effect.Runner)
            runner.root = Path(raw).resolve()
            runner.config = {'projectName': self.PROJECT}
            runner.request = {'attemptId': 'one', 'fence': 1, 'payloadDigest': 'a' * 64}
            seen = []
            def command(args, **_):
                seen.append(1)
                return '' if len(seen) == 1 else self.PROJECT + '-effect-12345678-install'
            runner.command = command
            runner.apply = lambda: None
            with unittest.mock.patch.object(odoo_effect, 'permit', lambda stage: None), self.assertRaises(odoo_effect.EffectError) as caught:
                runner.apply_owned()
            self.assertEqual(str(caught.exception), 'runtime_writer_after_effect')
            self.assertTrue((runner.root / 'runtime-gate').exists())


class RuntimeWriterCheckOrderTests(unittest.TestCase):
    """The writer check runs before the gate exists, so a busy project never wedges the lane."""
    PROJECT = 'nasq-shared-test'

    def runner(self, root, containers, calls):
        runner = object.__new__(odoo_effect.Runner)
        runner.root = Path(root).resolve()
        runner.config = {'projectName': self.PROJECT}
        runner.request = {'attemptId': 'one', 'fence': 1, 'payloadDigest': 'a' * 64}
        runner.command = lambda args, **_: '\n'.join(containers)
        runner.apply = lambda: calls.append('effect')
        return runner

    def test_writer_found_before_acquire_leaves_no_gate_and_runs_no_effect(self):
        for name in (self.PROJECT + '-effect-12345678-observe-abcd1234', self.PROJECT + '-effect-12345678-install'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as raw:
                calls = []
                runner = self.runner(raw, [name], calls)
                stages = []
                with unittest.mock.patch.object(odoo_effect, 'permit', stages.append), self.assertRaises(odoo_effect.EffectError) as caught:
                    runner.apply_owned()
                self.assertEqual(str(caught.exception), 'runtime_writer_present')
                self.assertEqual(calls, [])
                self.assertEqual(stages, ['runtime'])
                self.assertFalse((runner.root / 'runtime-gate').exists())
                # A retry after the container ended acquires normally.
                runner.command = lambda args, **_: ''
                with unittest.mock.patch.object(odoo_effect, 'permit', lambda stage: None):
                    runner.apply_owned()
                self.assertEqual(calls, ['effect'])
                self.assertFalse((runner.root / 'runtime-gate').exists())

    def test_release_check_ignores_a_lingering_observation_but_not_a_writer(self):
        observe = self.PROJECT + '-effect-ffffffff-observe-abcd1234'
        for containers, ok in (([observe], True), ([observe, self.PROJECT + '-effect-ffffffff-apply'], False)):
            with self.subTest(containers=containers), tempfile.TemporaryDirectory() as raw:
                calls = []
                runner = self.runner(raw, [], calls)
                # Containers appear only once the effect has run.
                runner.apply = lambda: (calls.append('effect'), setattr(runner, 'command', lambda args, **_: '\n'.join(containers)))
                with unittest.mock.patch.object(odoo_effect, 'permit', lambda stage: None):
                    if ok:
                        runner.apply_owned()
                        self.assertFalse((runner.root / 'runtime-gate').exists())
                    else:
                        with self.assertRaises(odoo_effect.EffectError):
                            runner.apply_owned()
                        self.assertTrue((runner.root / 'runtime-gate').exists())


if __name__ == '__main__':
    unittest.main()
