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
        self.assertEqual(odoo_effect.validate_database('webvue_scratch_' + 'a' * 32), 'webvue_scratch_' + 'a' * 32)
        for value in ['odoo19', 'postgres', 'webvue_scratch_prod', 'webvue_scratch_a;drop']:
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.validate_database(value)
        for value in [['webvue_core', 'sale'], ['webvue_core', 'webvue_not_shipped'], ['webvue_core', 'webvue_registry_probe'], [{'a': 1}], [], ['webvue_core', 'webvue_core'], 'webvue_core']:
            with self.subTest(value=value), self.assertRaises(odoo_effect.EffectError):
                odoo_effect.validate_modules(value)
        release = ['webvue_core', 'webvue_platform', 'webvue_api', 'webvue_pmo', 'webvue_meetings', 'webvue_hr', 'webvue_chat']
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

    This verifies package and catalog provisioning and fail-closed readback, not ORM or
    actual quota semantics; the parent owns fresh isolated Odoo acceptance.
    """
    HOST = 't' + 'c' * 32 + '.example.test'

    def run_script(self, *, package=True, snapshot=False, support=True, count=None, limit=None, origin=None):
        writes = []
        # A snapshot reads what an earlier apply pinned; `origin` states another value on purpose.
        params = {'web.base.url': origin or 'https://' + self.HOST, 'web.base.url.freeze': 'True'} if snapshot else {}
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
            def _webvue_access_write(self, values, capability):
                writes.append(('user', values, capability))
                for key, value in values.items():
                    if key == 'group_ids':
                        if value != [(3, 99, 0)]:
                            raise AssertionError('must unlink only vendor support')
                        self.support_member = False
                    else:
                        setattr(self, key, value)
            def _webvue_sync_capability_groups(self):
                writes.append(('sync', set(roles)))
            def has_group(self, xmlid):
                assert xmlid == 'webvue_core.group_vendor_support'
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
            def with_context(self, **context):
                assert context == {'operator-context': True}
                return self
            def _webvue_set_public_origin(self, host):
                writes.append(('origin', host))
                params.update({'web.base.url': 'https://' + host, 'web.base.url.freeze': 'True'})

        class Assignments:
            def search(self, domain):
                key = next((value for field, op, value in domain if field == 'role_id'), None)
                return Records([key] if key in roles or key is None else [])
            def create(self, values):
                roles.add(values['role_id'])
                writes.append(('role', values['role_id']))

        class Cursor:
            dbname = 'webvue_scratch_' + 'a' * 32
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
            registry = SimpleNamespace(signal_changes=lambda: writes.append(('signal',)))
            def __getitem__(self, model):
                if model == 'webvue.tenant.profile':
                    return SimpleNamespace(search=lambda *args, **kwargs: Records([1]))
                if model == 'webvue.access.assignment':
                    return Assignments()
                if model == 'webvue.entitlement.service':
                    return SimpleNamespace(
                        _webvue_excluded_user_ids=lambda: (1, 2) if admin.support_member else (1,),
                        _webvue_count_users=lambda: count if count is not None else (0 if admin.support_member else 1),
                        _webvue_entitled_admin_roles=lambda: ['system_admin', 'pmo_manager', 'hr_manager'],
                        _webvue_limit_value=lambda key: limit if key == 'users.limit' else None,
                    )
                if model == 'webvue.access.role':
                    return SimpleNamespace(search=lambda domain, limit=None: SimpleNamespace(id=domain[0][2]))
                if model == 'ir.config_parameter':
                    return SimpleNamespace(get_param=params.get)
                raise AssertionError(model)
            def ref(self, xmlid):
                if xmlid == 'base.user_admin':
                    return admin
                if xmlid == 'webvue_core.group_vendor_support':
                    return SimpleNamespace(id=99)
                raise AssertionError(xmlid)
            def invalidate_all(self, **kwargs):
                pass
            def flush_all(self):
                writes.append(('flush',))

        runner = object.__new__(odoo_effect.Runner)
        runner.database = Cursor.dbname
        runner.request = {'admin': {'name': 'Customer administrator', 'login': 'customer@example.test'},
                          'companyName': 'Company', 'host': self.HOST,
                          'job': {'policy': {'modules': ['webvue_core', 'webvue_platform', 'webvue_api', 'webvue_pmo', 'webvue_hr']}}}
        if package:
            runner.request['job']['packageAuthority'] = {'schemaVersion': 2}
        output = io.StringIO()
        platform = SimpleNamespace(OPERATOR_CONTEXT='operator-context')
        with unittest.mock.patch.dict('sys.modules', {'odoo.addons.webvue_platform.models.entitlement_service': platform}), \
                contextlib.redirect_stdout(output):
            exec(compile(runner.admin_script('known-secret', snapshot=snapshot), '<generated-admin>', 'exec'), {'env': Environment()})
        result = json.loads(output.getvalue().strip().removeprefix('WEBVUE_SHARED_ADMIN:'))
        return result, writes, admin, roles

    def test_admin_script_reads_roles_from_the_entitlement_not_modules(self):
        script = object.__new__(odoo_effect.Runner)
        script.database = 'webvue_scratch_' + 'a' * 32
        script.request = {'admin': {'name': 'A', 'login': 'a@example.test'}, 'companyName': 'C', 'host': 'a.example.test',
                          'job': {'policy': {'modules': ['webvue_core', 'webvue_platform', 'webvue_api', 'webvue_pmo', 'webvue_hr']}}}
        text = script.admin_script('known-secret', snapshot=False)
        self.assertIn('_webvue_entitled_admin_roles()', text)
        self.assertNotIn("'webvue_pmo' in values['modules']", text)
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

    def test_apply_pins_the_routed_host_as_the_frozen_public_origin(self):
        result, writes, _admin, _roles = self.run_script()
        self.assertEqual(result, {'verified': True, 'uid': 2})
        self.assertIn(('origin', self.HOST), writes)
        self.assertLess(writes.index(('origin', self.HOST)), writes.index(('commit',)))
        # A running shared server rereads the pinned origin after the commit.
        self.assertLess(writes.index(('commit',)), writes.index(('signal',)))

    def test_snapshot_refuses_a_public_origin_that_is_not_the_routed_host(self):
        for origin in ('https://' + self.HOST + '.other.test', 'http://' + self.HOST, 'https://webvue_scratch_' + 'a' * 32):
            with self.subTest(origin=origin):
                result, writes, _admin, _roles = self.run_script(snapshot=True, support=False, count=1, origin=origin)
                self.assertEqual(result, {'verified': False})
                self.assertEqual(writes, [])

    def test_a_provision_request_needs_a_host_of_this_runtime(self):
        for host in (None, '', 'Tenant.example.test', 'tenant', 'tenant.example.test/x', 'https://tenant.example.test',
                     'tenant.other.test', 'example.test', 'tenant.example.test.evil'):
            with self.subTest(host=host), self.assertRaises(odoo_effect.EffectError):
                odoo_effect.validate_host(host, 'example.test')
        self.assertEqual(odoo_effect.validate_host(self.HOST, 'example.test'), self.HOST)

    def test_catalog_apply_treats_first_admin_as_counted_customer(self):
        # A commercial tenant provisioned from the catalog (no package authority)
        # gets the same customer administrator as a package tenant.
        result, writes, admin, roles = self.run_script(package=False)
        self.assertEqual(result, {'verified': True, 'uid': 2})
        self.assertFalse(admin.support_member)
        self.assertEqual(roles, {'existing_customer_role', 'system_admin', 'pmo_manager', 'hr_manager'})
        self.assertIn(('user', {'group_ids': [(3, 99, 0)]}, 'access.users.assign_roles'), writes)
        self.assertTrue(any(entry[0] == 'sync' for entry in writes))

    def test_catalog_snapshot_refuses_support_or_missing_count_without_writes(self):
        for support, count in [(True, 1), (False, 0)]:
            with self.subTest(support=support, count=count):
                result, writes, _admin, _roles = self.run_script(package=False, snapshot=True, support=support, count=count)
                self.assertEqual(result, {'verified': False})
                self.assertEqual(writes, [])
        result, writes, _admin, _roles = self.run_script(package=False, snapshot=True, support=False, count=1)
        self.assertEqual(result, {'verified': True, 'uid': 2})
        self.assertEqual(writes, [])

    def test_apply_refuses_a_tenant_born_over_its_users_limit(self):
        for package in (True, False):
            with self.subTest(package=package):
                result, writes, _admin, _roles = self.run_script(package=package, limit=0)
                self.assertEqual(result, {'verified': False})
                self.assertNotIn(('commit',), writes)
        result, _writes, _admin, _roles = self.run_script(package=False, limit=1)
        self.assertEqual(result, {'verified': True, 'uid': 2})

    def test_admin_script_has_no_package_branch(self):
        runner = object.__new__(odoo_effect.Runner)
        runner.database = 'webvue_scratch_' + 'a' * 32
        runner.request = {'admin': {'name': 'A', 'login': 'a@example.test'}, 'companyName': 'C', 'host': 'a.example.test', 'job': {'policy': {}}}
        text = runner.admin_script('known-secret', snapshot=False)
        self.assertNotIn('packageAdmin', text)

class DiagnosticsAndCatalogTests(unittest.TestCase):
    SYNTHETIC_DIAGNOSTIC = (
        'password=synthetic-password; script=synthetic-script; '
        'stdout=synthetic-stdout; stderr=synthetic-stderr; '
        'Traceback: synthetic-traceback; path=/synthetic/private'
    )

    def assert_preflight_failure(self, error, expected_stdout, users_limit=None):
        """Exercise real main/observe/preflight, with no runtime or file access."""
        config = {'schemaVersion': 1, 'projectName': 'webvue-shared-diagnostic',
                  'composeFile': '/synthetic/compose.yml', 'envFile': '/synthetic/runtime.env',
                  'stateDir': '/synthetic/state', 'domainSuffix': 'example.test'}
        database = 'webvue_scratch_' + 'a' * 32
        digest = 'b' * 64
        request = {'action': 'observe', 'config': config, 'host': 'tenant.example.test',
                   'job': {'operation': 'provision',
                           'binding': {'database': database, 'filestore': database},
                           'policy': {'schema_version': 1, 'channel': 'control_plane',
                                      'modules': ['webvue_core', 'webvue_platform', 'webvue_api'],
                                      'features': {'users.limit': users_limit, 'storage.limit_mb': None,
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

        catalog = [] if users_limit is not None else [('catalog', digest)]
        self.assertEqual(events, [('command', args) for args in commands] + catalog)
        if users_limit is None:
            resolver.assert_called_once_with(digest)
        else:
            resolver.assert_not_called()
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

    def test_preflight_refuses_a_users_limit_without_room_for_the_admin(self):
        # Refused before catalog resolution, reserve and install: no half-provisioned tenant.
        for limit in (0, -1, 1.5, True, '1'):
            with self.subTest(limit=limit):
                self.assert_preflight_failure(None, '{"error_code":"shared_effect_unverified"}\n', users_limit=limit)

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
        from tools.webvue_cli.managed_verify import VerificationError
        from tools.shared_saas_lifecycle.catalog_source import CatalogSourceError
        for code in ('policy_script_failed', 'target_mismatch', 'policy_already_initialized',
                     'features_mismatch', 'modules_mismatch', 'snapshot_invalid'):
            self.assertEqual(odoo_effect.classify_error(VerificationError(code)), code)
        self.assertEqual(odoo_effect.classify_error(CatalogSourceError('catalog_source_ambiguous')),
                         'catalog_source_ambiguous')
        # Managed-policy refusal codes are stable safe identifiers and propagate.
        from tools.webvue_cli.managed_policy import POLICY_ERROR_CODES, PolicyError
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
        from tools.webvue_cli.managed_policy import PolicyError, parse_create_policy
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
    PROJECT = 'webvue-shared-test'

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
    PROJECT = 'webvue-shared-test'

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



class ReleaseOperationBoundaryTests(unittest.TestCase):
    def test_provision_observation_barrier_precedes_all_runtime_calls(self):
        import os
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            (root / 'tenant_a.maintenance').write_text('{}')
            runner = object.__new__(odoo_effect.Runner)
            runner.request = {'job': {'operation': 'provision', 'binding': {'tenantId': 'tenant_a', 'registryRevision': 4, 'database': 'tenant_a'}}}
            calls = []
            runner.preflight = lambda: calls.append('runtime')
            runner.root = root
            with unittest.mock.patch.dict(os.environ, {'WEBVUE_RELEASE_ROUTES_DIR': str(root)}):
                with self.assertRaises(odoo_effect.EffectError): runner.observe()
            self.assertEqual(calls, [])



class VerifiedHelperRuntimeBoundaryTests(unittest.TestCase):
    def fixture(self, root):
        from deploy.releases.test_helper_runtime import helper_fixture
        config, metadata, pools, rendered = helper_fixture(root)
        binding = {'tenantId': 'tenant_a', 'database': 'db_a', 'registryRevision': 4}
        (root / 'tenant_a.json').write_text(json.dumps({'schemaVersion': 1, 'tenantId': 'tenant_a', 'identityRevision': 4, 'routeRevision': 2, 'fence': 8, 'poolId': 'blue', 'releaseId': 'release_blue', 'state': 'serving'}))
        return {'config': config, 'job': {'binding': binding}, 'fence': 999}, rendered

    def test_wrong_actual_image_refuses_effect_even_when_pool_environment_matches(self):
        import os
        import subprocess
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve(); request, rendered = self.fixture(root)
            rendered['services']['odoo']['image'] = 'webvue/odoo@sha256:' + 'b' * 64
            def docker_config(argv, **kwargs):
                self.assertEqual(len(list((root / 'leases' / 'tenant_a').glob('*.json'))), 1)
                return subprocess.CompletedProcess(argv, 0, json.dumps(rendered), '')
            with unittest.mock.patch.dict(os.environ, {'WEBVUE_RELEASE_ROUTES_DIR': str(root), 'WEBVUE_RELEASE_HELPER_POOL_ID': 'blue'}), unittest.mock.patch('deploy.releases.helper_runtime.subprocess.run', docker_config):
                with self.assertRaisesRegex(odoo_effect.EffectError, '^release_operation_blocked$'):
                    with odoo_effect.effect_operation(request, 'observe'): self.fail('wrong image effect admitted')
            self.assertFalse(list((root / 'leases' / 'tenant_a').glob('*.json')))

    def test_verified_view_and_pending_provision_keep_lease_until_effect_finishes(self):
        import os
        import subprocess
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve(); request, rendered = self.fixture(root)
            def docker_config(argv, **kwargs):
                self.assertEqual(len(list((root / 'leases' / 'tenant_a').glob('*.json'))), 1)
                return subprocess.CompletedProcess(argv, 0, json.dumps(rendered), '')
            with unittest.mock.patch.dict(os.environ, {'WEBVUE_RELEASE_ROUTES_DIR': str(root), 'WEBVUE_RELEASE_HELPER_POOL_ID': 'blue'}), unittest.mock.patch('deploy.releases.helper_runtime.subprocess.run', docker_config):
                with odoo_effect.effect_operation(request, 'observe') as lease:
                    self.assertEqual(lease['fence'], 8)
                (root / 'tenant_a.json').unlink()
                with odoo_effect.effect_operation(request, 'provision', allow_unrouted=True) as lease:
                    self.assertEqual(lease['poolId'], 'pending')
                    self.assertTrue((root / 'leases' / 'tenant_a' / 'provision.lock').exists())
            self.assertFalse(list((root / 'leases' / 'tenant_a').glob('*.json')))


if __name__ == '__main__':
    unittest.main()
