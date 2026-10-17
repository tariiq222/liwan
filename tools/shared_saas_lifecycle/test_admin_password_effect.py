# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Isolated regression checks; never invokes Docker or a tenant database."""
import contextlib
import io
import json
import secrets
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tools.shared_saas_lifecycle import admin_password_effect as effect
from tools.shared_saas_lifecycle.odoo_effect import EffectError, MAX_OUTPUT

DATABASE = 'webvue_scratch_' + 'a' * 32
LOGIN = 'admin@example.test'
CHANGED_AT = '2026-10-02T12:00:00Z'


def request():
    return {'action': 'set_admin_password', 'tenant': {'database': DATABASE, 'host': 'tenant.test'},
            'login': LOGIN, 'password': secrets.token_urlsafe(24), 'config': {
                'schemaVersion': 1, 'projectName': 'webvue-shared-test', 'composeFile': '/private/tmp/compose.yml',
                'envFile': '/private/tmp/runtime.env', 'stateDir': '/private/tmp/state', 'domainSuffix': 'test'}}


def output(value):
    return effect.SENTINEL + json.dumps(value) + '\n'


class FakeRunner:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def run_script(self, script, *, stdin):
        self.calls.append((script, stdin))
        return self.response


class AdminPasswordEffectTest(unittest.TestCase):
    def test_validation_precedes_runner(self):
        for field, value, code in [('password', '', 'password_policy'), ('password', None, 'password_policy'),
                                    ('password', 'x' * 11, 'password_policy'), ('login', '', 'user_missing'),
                                    ('login', 'bad\nlogin', 'user_missing')]:
            with self.subTest(field=field, code=code):
                payload = request()
                payload[field] = value
                runner = FakeRunner('')
                with self.assertRaisesRegex(EffectError, '^' + code + '$'):
                    effect.execute(payload, runner)
                self.assertEqual(runner.calls, [])
        for database in ('odoo19', 'postgres', DATABASE + ';', 'webvue_scratch_test'):
            payload = request()
            payload['tenant']['database'] = database
            with self.assertRaisesRegex(EffectError, '^database_invalid$'):
                effect.execute(payload, FakeRunner(''))

    def test_success_parse_and_stdin_only(self):
        payload = request()
        result = {'login': LOGIN, 'user_id': 2, 'changed_at': CHANGED_AT}
        runner = FakeRunner(output(result))
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            self.assertEqual(effect.execute(payload, runner), result)
        script, stdin = runner.calls[0]
        self.assertFalse(payload['password'] in script)
        self.assertFalse(payload['password'] in captured.getvalue())
        self.assertTrue(json.loads(stdin)['password'] == payload['password'])
        self.assertIn("write({'password': secret})", script)
        self.assertNotIn("'group_ids'", script)

    def test_user_missing_and_inactive(self):
        for code in ('user_missing', 'user_inactive'):
            with self.assertRaisesRegex(EffectError, '^' + code + '$'):
                effect.execute(request(), FakeRunner(output({'error_code': code})))

    def test_malformed_and_oversized_success_refused(self):
        success = {'login': LOGIN, 'user_id': 2, 'changed_at': CHANGED_AT}
        invalid = ['', output(success) * 2, 'x' * (MAX_OUTPUT + 1),
                   output({**success, 'user_id': True}), output({**success, 'login': 'other'}),
                   output({**success, 'changed_at': 'bad'}), output({**success, 'password': 'redacted'}),
                   output({'error_code': 'unexpected_private_detail'})]
        for response in invalid:
            with self.subTest(index=invalid.index(response)):
                with self.assertRaisesRegex(EffectError, '^script_failed$'):
                    effect.execute(request(), FakeRunner(response))

    def test_compose_argv_and_environment_never_contain_password(self):
        payload = request()
        result = {'login': LOGIN, 'user_id': 2, 'changed_at': CHANGED_AT}
        with patch.object(effect.ComposeRunner, 'command', return_value=output(result)) as command:
            runner = effect.ComposeRunner(payload)
            self.assertEqual(effect.execute(payload, runner), result)
        args = command.call_args.args[0]
        self.assertFalse(any(payload['password'] in arg for arg in args))
        self.assertTrue(json.loads(command.call_args.kwargs['stdin'])['password'] == payload['password'])
        self.assertIn('/opt/venv/bin/python', args)
        self.assertIn('--log-level=critical', args)

    def test_main_never_echoes_private_exception(self):
        payload = request()
        out = io.StringIO()
        with patch.object(effect, 'execute', side_effect=RuntimeError(payload['password'])):
            self.assertEqual(effect.main(io.StringIO(json.dumps(payload)), out), 1)
        self.assertEqual(json.loads(out.getvalue()), {'error_code': 'script_failed'})
        self.assertFalse(payload['password'] in out.getvalue())

    def test_generated_script_executes_identity_checks_and_password_only_write(self):
        payload = request()
        for case, code in [('success', None), ('missing', 'user_missing'), ('inactive', 'user_inactive'),
                           ('external', 'user_missing'), ('wrong_company', 'user_missing'),
                           ('wrong_login', 'user_missing'), ('short', 'password_policy'),
                           ('wrong_database', 'script_failed')]:
            with self.subTest(case=case):
                root = object()
                class Admin:
                    id, login, active, share = 2, LOGIN, True, False
                    company_id, company_ids = root, [root]
                    written = None
                    def exists(self): return True
                    def has_group(self, _group): return not self.share
                    def with_context(self, **_context): return self
                    def write(self, vals): self.written = vals
                admin = Admin()
                if case == 'inactive': admin.active = False
                if case == 'external': admin.share = True
                if case == 'wrong_company': admin.company_id = object()
                if case == 'wrong_login': admin.login = 'other'
                profile = SimpleNamespace(root_company_id=root, commercial_mode='saas', entitlement_source='control_plane',
                                          _webvue_lock=lambda: profile)
                class ProfileModel:
                    def search(self, _domain, limit): return self
                    def __len__(self): return 1
                    def __getattr__(self, key): return getattr(profile, key)
                events = []
                class Env:
                    uid, su = 1, True
                    cr = SimpleNamespace(dbname=DATABASE, commit=lambda: events.append('commit'), rollback=lambda: events.append('rollback'))
                    registry = SimpleNamespace(signal_changes=lambda: events.append('signal'))
                    def ref(self, _xmlid, **_kwargs): return None if case == 'missing' else admin
                    def __getitem__(self, model):
                        return ProfileModel() if model == 'webvue.tenant.profile' else SimpleNamespace(_webvue_assert_operator=lambda: True)
                    def flush_all(self): pass
                env = Env()
                admin.env = env
                if case == 'wrong_database': env.cr.dbname = 'other'
                data = {'database': DATABASE, 'login': LOGIN, 'password': payload['password'] if case != 'short' else ''}
                captured = io.StringIO()
                module = SimpleNamespace(OPERATOR_CONTEXT='webvue_platform.operator_policy')
                with patch.dict('sys.modules', {'odoo.addons.webvue_platform.models.entitlement_service': module}), contextlib.redirect_stdout(captured):
                    exec(effect.build_script(), {'env': env, 'values': data})
                if code:
                    with self.assertRaisesRegex(EffectError, '^' + code + '$'):
                        effect.parse_output(captured.getvalue(), LOGIN)
                    self.assertIsNone(admin.written)
                    self.assertNotIn('signal', events)
                else:
                    # Other Odoo workers drop the cached session tokens only after the commit is signalled.
                    self.assertEqual(events, ['commit', 'signal'])
                    self.assertEqual(effect.parse_output(captured.getvalue(), LOGIN)['user_id'], 2)
                    self.assertEqual(set(admin.written), {'password'})
                    self.assertTrue(admin.written['password'] == payload['password'])
                self.assertFalse(payload['password'] in captured.getvalue())

    def test_script_is_syntax_valid_and_checks_admin_identity(self):
        script = effect.build_script()
        compile(script, '<password-effect>', 'exec')
        compile(effect.build_bootstrap(script), '<password-bootstrap>', 'exec')
        self.assertIn("env.ref('base.user_admin'", script)
        self.assertIn('admin.company_id != root', script)
        self.assertIn('not admin.active', script)
        self.assertIn("has_group('base.group_user')", script)
        self.assertIn('OPERATOR_CONTEXT', script)



class ReleasePasswordBoundaryTests(unittest.TestCase):
    def test_maintenance_blocks_password_process_before_stdin_secret(self):
        import os
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            (root / 'tenant_a.maintenance').write_text('{}')
            payload = request()
            payload['releaseBinding'] = {'tenantId': 'tenant_a', 'registryRevision': 4, 'database': DATABASE}
            runner = FakeRunner('')
            with patch.dict(os.environ, {'WEBVUE_RELEASE_ROUTES_DIR': str(root)}):
                with self.assertRaises(EffectError): effect.execute(payload, runner)
            self.assertEqual(runner.calls, [])


if __name__ == '__main__':
    unittest.main()
