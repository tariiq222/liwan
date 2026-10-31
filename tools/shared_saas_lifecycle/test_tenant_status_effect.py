# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Isolated regression checks; never invokes Docker or a tenant database."""
import contextlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tools.shared_saas_lifecycle import tenant_status_effect as effect
from tools.shared_saas_lifecycle.odoo_effect import EffectError, MAX_OUTPUT

DATABASE = 'liwan_scratch_' + 'a' * 32


def request(status='suspended'):
    return {'action': 'set_tenant_status', 'tenant': {'database': DATABASE, 'host': 'tenant.test'}, 'status': status, 'config': {
        'schemaVersion': 1, 'projectName': 'liwan-shared-test', 'composeFile': '/private/tmp/compose.yml',
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


class TenantStatusEffectTest(unittest.TestCase):
    def test_validation_precedes_runner(self):
        for mutate, code in [(lambda r: r.update(status='deleted'), 'script_failed'), (lambda r: r.update(status=None), 'script_failed'),
                              (lambda r: r.update(action='other'), 'script_failed'), (lambda r: r['tenant'].update(database='odoo19'), 'database_invalid'),
                              (lambda r: r['tenant'].update(host='bad host'), 'script_failed')]:
            with self.subTest(code=code):
                payload = request()
                mutate(payload)
                runner = FakeRunner('')
                with self.assertRaisesRegex(EffectError, '^' + code + '$'):
                    effect.execute(payload, runner)
                self.assertEqual(runner.calls, [])

    def test_success_sends_only_database_and_status(self):
        for status in effect.STATUSES:
            runner = FakeRunner(output({'status': status}))
            self.assertEqual(effect.execute(request(status), runner), {'status': status})
            self.assertEqual(json.loads(runner.calls[0][1]), {'database': DATABASE, 'status': status})
            self.assertNotIn(status, runner.calls[0][0].replace("('active', 'suspended')", ''))

    def test_refusals_and_malformed_output(self):
        for code in ('profile_invalid', 'database_invalid'):
            with self.assertRaisesRegex(EffectError, '^' + code + '$'):
                effect.execute(request(), FakeRunner(output({'error_code': code})))
        invalid = ['', output({'status': 'suspended'}) * 2, 'x' * (MAX_OUTPUT + 1), output({'status': 'active'}),
                   output({'status': 'suspended', 'extra': 1}), output({'error_code': 'unexpected_private_detail'})]
        for index, response in enumerate(invalid):
            with self.subTest(index=index):
                with self.assertRaisesRegex(EffectError, '^script_failed$'):
                    effect.execute(request(), FakeRunner(response))

    def test_main_never_echoes_private_exception(self):
        out = io.StringIO()
        with patch.object(effect, 'execute', side_effect=RuntimeError('private-detail')):
            self.assertEqual(effect.main(io.StringIO(json.dumps(request())), out), 1)
        self.assertEqual(json.loads(out.getvalue()), {'error_code': 'script_failed'})

    def test_compose_runs_the_static_bootstrap_with_values_on_stdin_only(self):
        with patch.object(effect.ComposeRunner, 'command', return_value=output({'status': 'suspended'})) as command:
            self.assertEqual(effect.execute(request(), effect.ComposeRunner(request())), {'status': 'suspended'})
        args = command.call_args.args[0]
        self.assertIn('/opt/venv/bin/python', args)
        self.assertIn('--log-level=critical', args)
        self.assertEqual(json.loads(command.call_args.kwargs['stdin']), {'database': DATABASE, 'status': 'suspended'})

    def run_script(self, case, status):
        events = []
        written = []

        class Profile:
            commercial_mode, entitlement_source = 'saas', 'control_plane'
            env = None

            def __init__(self, current):
                self.status = current

            def __len__(self):
                return 1

            def _liwan_lock(self):
                return self

            def with_context(self, **_context):
                return self

            def write(self, vals):
                written.append(vals)

        profile = Profile('active' if status == 'suspended' else 'suspended')
        if case == 'already':
            profile.status = status
        if case == 'non_saas':
            profile.commercial_mode = 'non_saas'

        class Model:
            def search(self, _domain, limit):
                return {'none': [], 'two': [profile, profile]}.get(case, profile)

        class Env:
            uid, su = 1, case != 'not_su'
            cr = SimpleNamespace(dbname='other' if case == 'wrong_database' else DATABASE, commit=lambda: events.append('commit'), rollback=lambda: events.append('rollback'))
            registry = SimpleNamespace(signal_changes=lambda: events.append('signal'))

            def __getitem__(self, name):
                return Model() if name == 'liwan.tenant.profile' else SimpleNamespace(_liwan_assert_operator=lambda: True)

            def flush_all(self):
                events.append('flush')

        env = Env()
        profile.env = env
        captured = io.StringIO()
        module = SimpleNamespace(OPERATOR_CONTEXT='liwan_platform.operator_policy')
        with patch.dict('sys.modules', {'odoo.addons.liwan_platform.models.entitlement_service': module}), contextlib.redirect_stdout(captured):
            exec(effect.build_script(), {'env': env, 'values': {'database': DATABASE, 'status': status}})
        return captured.getvalue(), events, written

    def test_generated_script_writes_only_the_status_and_signals_the_change(self):
        for status in effect.STATUSES:
            with self.subTest(status=status):
                out, events, written = self.run_script('change', status)
                self.assertEqual(effect.parse_output(out, status), {'status': status})
                self.assertEqual(written, [{'status': status}])
                self.assertEqual(events, ['flush', 'commit', 'signal'])

    def test_generated_script_is_idempotent_when_the_status_already_matches(self):
        out, events, written = self.run_script('already', 'suspended')
        self.assertEqual(effect.parse_output(out, 'suspended'), {'status': 'suspended'})
        self.assertEqual((events, written), ([], []))

    def test_generated_script_refuses_without_writing(self):
        for case, code in [('wrong_database', 'script_failed'), ('not_su', 'script_failed'), ('non_saas', 'profile_invalid'),
                           ('none', 'profile_invalid'), ('two', 'profile_invalid')]:
            with self.subTest(case=case):
                out, events, written = self.run_script(case, 'suspended')
                with self.assertRaisesRegex(EffectError, '^' + code + '$'):
                    effect.parse_output(out, 'suspended')
                self.assertEqual(written, [])
                self.assertNotIn('signal', events)

    def test_script_is_syntax_valid(self):
        script = effect.build_script()
        compile(script, '<status-effect>', 'exec')
        compile(effect.build_bootstrap(script), '<status-bootstrap>', 'exec')
        self.assertIn('OPERATOR_CONTEXT', script)
        self.assertIn("operator.write({'status': values['status']})", script)


if __name__ == '__main__':
    unittest.main()
