# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Contract tests for the CP2-T4 deploy adapter.

The runner is injected. Nothing here calls psql, odoo-bin, or the network,
and no case names the development database odoo19 as a connection target.
"""
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from webvue_cli import adapters, cli

US = '\x1f'
PLANTED_SECRET = 's3cret-db'
DB = 'webvue_scratch_demo'
TARGET = 'install_demo'


def _profile_row(mode='non_saas', source='local_policy', valid_until='',
                 policy_revision='3', quota_revision='1', status='active'):
    return US.join((mode, source, valid_until, policy_revision, quota_revision, status))


class _Runner:
    """Records every argv and answers psql / shell from scripted results."""

    def __init__(self, *, profile=None, stuck='0', shell=None, psql_code=0, psql_err=''):
        self.calls = []
        self.profile = profile
        self.stuck = stuck
        self.shell = shell if shell is not None else (0, '', '')
        self.psql_code = psql_code
        self.psql_err = psql_err

    def __call__(self, command, env=None, stdin_text=None):
        self.calls.append({
            'command': list(command),
            'env': None if env is None else dict(env),
            'stdin_text': stdin_text,
        })
        if not isinstance(command, list):
            return 1, '', 'runner contract: command must be an argv list'
        if 'shell' in command:
            return self.shell
        if self.psql_code != 0:
            return self.psql_code, '', self.psql_err
        sql = command[-1] if command else ''
        if 'ir_module_module' in sql:
            return 0, f'{self.stuck}\n', ''
        if self.profile is None:
            return 0, '', ''
        return 0, f'{self.profile}\n', ''


class AdapterCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.previous_inventory = os.environ.get(adapters.INVENTORY_ENV)
        self.previous_password = os.environ.get('PGPASSWORD')
        os.environ['PGPASSWORD'] = PLANTED_SECRET
        self.addCleanup(self._restore_env)
        self.inventory_path = self.root / 'inventory.json'
        self.policy_path = self.root / 'policy.json'
        self.odoo_bin = self.root / 'odoo-bin'
        self.odoo_conf = self.root / 'odoo.conf'
        self.odoo_bin.write_text('# not executed\n')
        self.odoo_conf.write_text('[options]\n')
        self.write_inventory()
        self.write_policy()

    def _restore_env(self):
        if self.previous_inventory is None:
            os.environ.pop(adapters.INVENTORY_ENV, None)
        else:
            os.environ[adapters.INVENTORY_ENV] = self.previous_inventory
        if self.previous_password is None:
            os.environ.pop('PGPASSWORD', None)
        else:
            os.environ['PGPASSWORD'] = self.previous_password

    def write_inventory(self, targets=None, raw=None, *, set_env=True):
        if raw is None:
            document = {'version': 1, 'targets': targets if targets is not None else {
                TARGET: {
                    'database': DB,
                    'kind': 'scratch',
                    'odoo_bin': str(self.odoo_bin),
                    'odoo_conf': str(self.odoo_conf),
                },
            }}
            raw = json.dumps(document)
        self.inventory_path.write_text(raw)
        if set_env:
            os.environ[adapters.INVENTORY_ENV] = str(self.inventory_path)

    def write_policy(self, **overrides):
        document = {
            'schema_version': 1,
            'database': DB,
            'commercial_mode': 'non_saas',
            'entitlement_source': 'local_policy',
            'expected_valid_until': None,
            'valid_until_action': 'preserve',
        }
        document.update(overrides)
        self.policy_path.write_text(json.dumps(document))
        return document

    def fields(self, operation, **overrides):
        built = {'operation': operation, 'target': TARGET}
        if operation in ('tenant.preflight', 'tenant.entitle'):
            built['policy_file'] = str(self.policy_path)
        if operation == 'tenant.entitle':
            built['expected_revision'] = 3
            built['request_id'] = 'req_1'
        built.update(overrides)
        return built

    def run_adapter(self, operation, runner, **overrides):
        return adapters.deploy_adapter(self.fields(operation, **overrides), runner=runner)

    def assert_secret_absent(self, payload):
        encoded = json.dumps(payload)
        self.assertNotIn(PLANTED_SECRET, encoded)
        self.assertNotIn('PGPASSWORD', encoded)

    def assert_no_shell(self, runner):
        for call in runner.calls:
            self.assertNotIn('shell', call['command'])
            self.assertIsInstance(call['command'], list)

    def assert_psql_read(self, call):
        command = call['command']
        self.assertIsInstance(command, list)
        self.assertIn('psql', command[0])
        self.assertIn('-d', command)
        self.assertEqual(command[command.index('-d') + 1], DB)
        sql = command[-1]
        self.assertNotIn(TARGET, sql)
        self.assertNotIn(PLANTED_SECRET, sql)
        self.assertIsNone(call['stdin_text'])

    # --------------------------------------------------------------- inventory

    def test_bad_inventory_and_unknown_target_are_invalid_input(self):
        relative = self.root / 'relative.json'
        relative.write_text('{}')
        oversize = self.root / 'oversize.json'
        oversize.write_bytes(b'{' + b'x' * (adapters.INVENTORY_MAX_BYTES + 1))
        invalid = self.root / 'invalid.json'
        invalid.write_text('{not json')
        cases = {
            'missing': str(self.root / 'gone.json'),
            'relative': os.path.relpath(relative, Path.cwd()),
            'oversize': str(oversize),
            'invalid_json': str(invalid),
        }
        for name, filename in cases.items():
            with self.subTest(case=name):
                os.environ[adapters.INVENTORY_ENV] = filename
                runner = _Runner()
                code, payload = self.run_adapter('tenant.inspect', runner)
                self.assertEqual(code, 2)
                self.assertEqual(payload['error']['code'], 'invalid_input')
                self.assertIs(payload['changed'], False)
                self.assertEqual(runner.calls, [])
                self.assert_secret_absent(payload)
                self.assertNotIn(PLANTED_SECRET, payload['error']['message'])
        with self.subTest(case='unknown_target'):
            self.write_inventory()
            runner = _Runner()
            code, payload = self.run_adapter('tenant.inspect', runner, target='other_demo')
            self.assertEqual(code, 2)
            self.assertEqual(payload['error']['code'], 'invalid_input')
            self.assertIs(payload['changed'], False)
            self.assertEqual(runner.calls, [])
            self.assert_secret_absent(payload)

    def test_forbidden_database_names_never_call_the_runner(self):
        for database in ('odoo19', 'production', 'prod', 'postgres', 'odoo19live', 'webvue_scratch;drop'):
            with self.subTest(database=database):
                self.write_inventory(targets={TARGET: {'database': database, 'kind': 'scratch'}})
                runner = _Runner(profile=_profile_row())
                code, payload = self.run_adapter('tenant.inspect', runner)
                self.assertEqual(code, 3, payload)
                self.assertEqual(payload['error']['code'], 'target_forbidden')
                self.assertIs(payload['changed'], False)
                self.assertEqual(runner.calls, [])
                self.assertNotIn(PLANTED_SECRET, payload['error']['message'])
                self.assert_secret_absent(payload)

    # ------------------------------------------------------------------ inspect

    def test_inspect_reads_one_profile_row(self):
        runner = _Runner(profile=_profile_row())
        code, payload = self.run_adapter('tenant.inspect', runner)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['stage'], 'snapshot')
        self.assertIs(payload['changed'], False)
        self.assertEqual(payload['profile']['policy_revision'], 3)
        self.assertIsNone(payload['profile']['valid_until'])
        self.assertEqual(len(runner.calls), 1)
        self.assert_psql_read(runner.calls[0])
        self.assert_secret_absent(payload)

    def test_inspect_missing_row_and_failed_psql(self):
        with self.subTest(case='no_rows'):
            runner = _Runner(profile=None)
            code, payload = self.run_adapter('tenant.inspect', runner)
            self.assertEqual(code, 6, payload)
            self.assertEqual(payload['error']['code'], 'profile_missing')
            self.assertIs(payload['changed'], False)
            self.assert_psql_read(runner.calls[0])
            self.assert_secret_absent(payload)

    def test_child_stderr_is_redacted_from_all_operator_streams(self):
        runner = _Runner(psql_code=2, psql_err='password=' + PLANTED_SECRET)
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            code, payload = self.run_adapter('tenant.inspect', runner)
        self.assertEqual(code, 5)
        self.assertNotIn(PLANTED_SECRET, stderr.getvalue() + json.dumps(payload))

    def test_legacy_entitle_requires_journaled_operator_entry(self):
        runner = _Runner(profile=_profile_row())
        code, payload = self.run_adapter('tenant.entitle', runner)
        self.assertEqual(code, 5, payload)
        self.assertEqual(payload['error']['code'], 'operator_entry_required')
        self.assertEqual(runner.calls, [])
        with self.subTest(case='nonzero'):
            runner = _Runner(psql_code=2, psql_err='connection refused')
            code, payload = self.run_adapter('tenant.inspect', runner)
            self.assertEqual(code, 5, payload)
            self.assertEqual(payload['error']['code'], 'operation_failed')
            self.assertIs(payload['changed'], False)
            self.assert_psql_read(runner.calls[0])
            self.assertNotIn(TARGET, runner.calls[0]['command'][-1])
            self.assert_secret_absent(payload)

    # --------------------------------------------------------------- preflight

    def test_preflight_valid_input_is_not_execution_ready(self):
        runner = _Runner(profile=_profile_row())
        code, payload = self.run_adapter('tenant.preflight', runner)
        self.assertEqual(code, 0, payload)
        self.assertIs(payload['execution_ready'], False)
        self.assertEqual(payload['conflicts'], [])
        self.assertIs(payload['changed'], False)
        self.assertEqual(payload['status'], 'validated_input')
        self.assertEqual(len(runner.calls), 1)
        self.assert_psql_read(runner.calls[0])
        self.assert_no_shell(runner)
        self.assert_secret_absent(payload)

    def test_preflight_database_mismatch_is_a_classification_conflict(self):
        self.write_policy(database='webvue_other_demo')
        runner = _Runner(profile=_profile_row())
        code, payload = self.run_adapter('tenant.preflight', runner)
        self.assertEqual(code, 4, payload)
        self.assertEqual(payload['error']['code'], 'classification_conflict')
        self.assertIs(payload['execution_ready'], False)
        self.assertIs(payload['changed'], False)
        self.assertEqual(len(runner.calls), 1)
        self.assert_psql_read(runner.calls[0])
        self.assert_no_shell(runner)
        self.assertNotIn(PLANTED_SECRET, payload['error']['message'])
        self.assert_secret_absent(payload)

    # The legacy adapter intentionally has no mutating entry. The journaled
    # operator path is tested in test_webvue_cli_operator.py.

    # ------------------------------------------------------------------- health

    def test_health_stuck_modules(self):
        with self.subTest(stuck=0):
            runner = _Runner(profile=_profile_row(), stuck='0')
            code, payload = self.run_adapter('health', runner)
            self.assertEqual(code, 0, payload)
            self.assertEqual(payload['status'], 'ok')
            self.assertIs(payload['changed'], False)
            self.assertEqual(len(runner.calls), 2)
            self.assert_secret_absent(payload)
        with self.subTest(stuck=2):
            runner = _Runner(profile=_profile_row(), stuck='2')
            code, payload = self.run_adapter('health', runner)
            self.assertEqual(code, 6, payload)
            self.assertEqual(payload['error']['code'], 'needs_intervention')
            self.assertIs(payload['changed'], False)

    # ------------------------------------------------------------- not wired

    def test_backup_restore_upgrade_stay_unwired(self):
        for operation in ('backup', 'restore', 'upgrade'):
            with self.subTest(operation=operation):
                runner = _Runner(profile=_profile_row())
                code, payload = adapters.deploy_adapter(
                    {'operation': operation, 'target': TARGET, 'request_id': 'req_1'},
                    runner=runner,
                )
                self.assertEqual(code, 5, payload)
                self.assertEqual(payload['error']['code'], 'operation_not_wired')
                self.assertIs(payload['changed'], False)
                self.assertEqual(runner.calls, [])
                self.assert_secret_absent(payload)

    # ------------------------------------------------------------ cli seam

    def test_cli_main_uses_an_injected_adapter(self):
        """cli.main accepts an adapter, not a runner; the adapter closes over one."""
        runner = _Runner(profile=_profile_row())

        def adapter(fields):
            return adapters.deploy_adapter(fields, runner=runner)

        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cli.main(
                ['tenant', 'inspect', '--target', TARGET, '--json'], adapter=adapter,
            )
        payload = json.loads(out.getvalue())
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['profile']['policy_revision'], 3)
        self.assertEqual(err.getvalue(), '')
        self.assertEqual(len(runner.calls), 1)
        self.assertNotIn(PLANTED_SECRET, out.getvalue())
        self.assert_secret_absent(payload)

    def test_cli_default_entry_stays_unwired(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cli.main(['health', '--target', TARGET, '--json'])
        payload = json.loads(out.getvalue())
        self.assertEqual(code, cli.EXIT_FAILED_OPERATION)
        self.assertEqual(payload['error']['code'], 'operation_not_wired')
        self.assertNotIn(PLANTED_SECRET, out.getvalue() + err.getvalue())


if __name__ == '__main__':
    unittest.main()
