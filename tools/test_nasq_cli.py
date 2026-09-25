# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Contract tests for the nasq-cli surface (CP0 §11).

These prove the parser, local validation, exit codes and output shape. They prove
nothing about operations: no adapter exists in CP2-T3, and every mutating command
must report that instead of pretending to have run.
"""
import ast
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from nasq_cli import cli

POLICY = {
    'schema_version': 1,
    'database': 'demo',
    'commercial_mode': 'non_saas',
    'entitlement_source': 'local_policy',
    'expected_valid_until': None,
    'valid_until_action': 'preserve',
}


class CliCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.policy = Path(self.tmp.name) / 'policy.json'
        self.policy.write_text(json.dumps(POLICY))

    def invoke(self, argv, adapter=None):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cli.main(argv, adapter=adapter)
        payload = json.loads(out.getvalue()) if out.getvalue().strip() else None
        return code, payload, err.getvalue()

    def ok_shape(self, argv):
        """Every CP0 §11 command shape must parse and reach its own command."""
        code, payload, _ = self.invoke(argv)
        self.assertEqual(payload['error']['code'], 'operation_not_wired', payload)
        self.assertEqual(code, cli.EXIT_FAILED_OPERATION)
        return payload

    # ------------------------------------------------------- CP0 command shapes

    def test_every_documented_command_shape_parses(self):
        policy = str(self.policy)
        shapes = {
            'tenant.inspect': ['tenant', 'inspect', '--target', 'install_demo', '--json'],
            'tenant.preflight': ['tenant', 'preflight', '--target', 'install_demo',
                                 '--policy-file', policy, '--json'],
            'tenant.entitle': ['tenant', 'entitle', '--target', 'install_demo',
                               '--policy-file', policy, '--expected-revision', '3',
                               '--request-id', 'req_1', '--json'],
            'health': ['health', '--target', 'install_demo', '--json'],
            'backup': ['backup', '--target', 'install_demo', '--request-id', 'req_1', '--json'],
            'upgrade': ['upgrade', '--target', 'install_demo', '--release', policy,
                        '--request-id', 'req_1', '--json'],
            'restore': ['restore', '--target', 'install_demo', '--backup-id', 'bkp_1',
                        '--approval-id', 'apr_1', '--request-id', 'req_1', '--json'],
        }
        for name, argv in shapes.items():
            with self.subTest(command=name):
                if name == 'tenant.preflight':
                    code, payload, _ = self.invoke(argv)
                    self.assertEqual(code, cli.EXIT_OK)
                    self.assertEqual(payload['operation'], name)
                else:
                    self.assertEqual(self.ok_shape(argv)['operation'], name)

    def test_preflight_validates_local_input_without_claiming_readiness(self):
        code, payload, err = self.invoke([
            'tenant', 'preflight', '--target', 'install_demo',
            '--policy-file', str(self.policy), '--json',
        ])
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(payload['status'], 'validated_input')
        self.assertEqual(payload['stage'], 'input_validation')
        self.assertIs(payload['execution_ready'], False)
        self.assertIs(payload['changed'], False)
        self.assertNotIn('error', payload)
        self.assertEqual(err, '')

    def test_preflight_writes_nothing_and_does_not_modify_its_input(self):
        before = self.policy.read_bytes()
        listing = sorted(str(p.name) for p in Path(self.tmp.name).iterdir())
        self.invoke(['tenant', 'preflight', '--target', 'install_demo',
                     '--policy-file', str(self.policy), '--json'])
        self.assertEqual(self.policy.read_bytes(), before)
        self.assertEqual(sorted(str(p.name) for p in Path(self.tmp.name).iterdir()), listing)

    # ------------------------------------------------------------ exit contract

    def test_exit_code_map_matches_the_contract(self):
        self.assertEqual(cli.EXIT_CODES, {
            'ok': 0, 'invalid_input': 2, 'forbidden': 3,
            'conflict': 4, 'operation_failed': 5, 'needs_intervention': 6,
        })

    def test_non_ok_adapter_receipts_use_documented_exit_codes_without_leaking_payload(self):
        cases = (
            ('conflict', 'request_conflict', cli.EXIT_CONFLICT),
            ('needs_intervention', 'needs_intervention', cli.EXIT_NEEDS_INTERVENTION),
            ('error', 'adapter_failure', cli.EXIT_FAILED_OPERATION),
        )
        for status, error_code, expected in cases:
            with self.subTest(status=status):
                secret_detail = 'private adapter detail must stay in JSON only'

                def adapter(_fields):
                    return expected, {
                        'status': status,
                        'error': {'code': error_code, 'message': secret_detail},
                    }

                code, payload, err = self.invoke(['status', '--target', 'install_demo',
                                                  '--request-id', 'req_1', '--json'],
                                                 adapter=adapter)
                self.assertEqual(code, expected)
                self.assertEqual(payload['status'], status)
                self.assertEqual(err.strip(), f'nasq-cli: {error_code}')
                self.assertNotIn(secret_detail, err)
                self.assertNotIn('Traceback', err)

    def test_error_receipt_preserves_adapter_invalid_and_authorization_exit_codes(self):
        for original_code in (cli.EXIT_INVALID_INPUT, cli.EXIT_AUTHORIZATION):
            with self.subTest(exit_code=original_code):
                def adapter(_fields):
                    return original_code, {'status': 'error', 'error': {'code': 'safe_error'}}

                code, payload, err = self.invoke(['status', '--target', 'install_demo',
                                                  '--request-id', 'req_1', '--json'],
                                                 adapter=adapter)
                self.assertEqual(payload['status'], 'error')
                self.assertEqual(code, original_code)
                self.assertEqual(err.strip(), 'nasq-cli: safe_error')

    def test_conflict_receipt_without_error_uses_status_name_without_traceback(self):
        code, payload, err = self.invoke(
            ['status', '--target', 'install_demo', '--request-id', 'req_1', '--json'],
            adapter=lambda _fields: (cli.EXIT_OK, {'status': 'conflict'}),
        )
        self.assertEqual(payload['status'], 'conflict')
        self.assertEqual(code, cli.EXIT_CONFLICT)
        self.assertEqual(err.strip(), 'nasq-cli: conflict')
        self.assertNotIn('Traceback', err)

    def test_unwired_operation_exits_5_and_says_so(self):
        code, payload, err = self.invoke(['backup', '--target', 'install_demo',
                                          '--request-id', 'req_1', '--json'])
        self.assertEqual(code, cli.EXIT_FAILED_OPERATION)
        self.assertEqual(payload['status'], 'not_wired')
        self.assertEqual(payload['error']['code'], 'operation_not_wired')
        self.assertIs(payload['changed'], False)
        self.assertIs(payload['adapter_required'], True)
        self.assertIn('CP2-T4', payload['error']['message'])
        self.assertEqual(err.strip(), f'nasq-cli: {payload["error"]["code"]}')

    def test_adapter_seam_is_used_when_supplied(self):
        calls = []

        def adapter(fields):
            calls.append(fields)
            return cli.EXIT_OK, {'schema_version': 1, 'operation': fields['operation'],
                                 'status': 'ok', 'changed': False, 'stage': 'test'}

        code, payload, _ = self.invoke(['health', '--target', 'install_demo', '--json'],
                                       adapter=adapter)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(calls[0]['target'], 'install_demo')

    def test_unknown_command_and_flag_are_invalid_input(self):
        for argv in (['nope'], ['health', '--target', 'install_demo', '--nope'],
                     ['health'], ['tenant'], ['tenant', 'nope', '--target', 'x']):
            with self.subTest(argv=argv):
                code, payload, _ = self.invoke(argv)
                self.assertEqual(code, cli.EXIT_INVALID_INPUT)
                self.assertEqual(payload['error']['code'], 'invalid_input')
                self.assertIs(payload['changed'], False)

    def test_help_exits_zero_without_a_json_document(self):
        for argv in (['--help'], ['health', '--help']):
            with self.subTest(argv=argv):
                out, err = io.StringIO(), io.StringIO()
                with redirect_stdout(out), redirect_stderr(err):
                    code = cli.main(argv)
                self.assertEqual(code, 0)
                self.assertIn('nasq-cli', out.getvalue())

    # ----------------------------------------------------------------- targets

    def test_target_rejects_urls_connection_strings_and_the_dev_database(self):
        for target in ('https://example.test', 'user@host/db', 'odoo19', '', 'a b',
                       'postgres:5432', 'install?x=1', 'sub/dir'):
            with self.subTest(target=target):
                code, payload, _ = self.invoke(['health', '--target', target, '--json'])
                self.assertEqual(code, cli.EXIT_INVALID_INPUT)
                self.assertEqual(payload['error']['code'], 'invalid_input')

    def test_target_never_defaults(self):
        code, payload, _ = self.invoke(['health', '--json'])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        self.assertIn('--target', payload['error']['message'])

    def test_valid_target_is_echoed_unchanged(self):
        payload = self.ok_shape(['health', '--target', 'install_demo.01', '--json'])
        self.assertEqual(payload['target'], 'install_demo.01')

    # ------------------------------------------------------------- policy file

    def test_policy_file_must_be_absolute_existing_and_bounded(self):
        cases = {
            'relative': 'policy.json',
            'missing': str(Path(self.tmp.name) / 'gone.json'),
            'directory': self.tmp.name,
        }
        for name, value in cases.items():
            with self.subTest(case=name):
                code, payload, _ = self.invoke([
                    'tenant', 'preflight', '--target', 'install_demo',
                    '--policy-file', value, '--json',
                ])
                self.assertEqual(code, cli.EXIT_INVALID_INPUT)
                self.assertEqual(payload['error']['code'], 'invalid_input')
        big = Path(self.tmp.name) / 'big.json'
        big.write_bytes(b'x' * (cli.POLICY_MAX_BYTES + 1))
        code, _, _ = self.invoke(['tenant', 'preflight', '--target', 'install_demo',
                                  '--policy-file', str(big), '--json'])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        at_limit = Path(self.tmp.name) / 'limit.json'
        at_limit.write_bytes(b'x' * cli.POLICY_MAX_BYTES)
        code, payload, _ = self.invoke(['tenant', 'preflight', '--target', 'install_demo',
                                        '--policy-file', str(at_limit), '--json'])
        self.assertEqual(code, cli.EXIT_OK, payload)

    def test_policy_file_is_validated_before_the_target(self):
        code, _, _ = self.invoke([
            'tenant', 'preflight', '--target', 'odoo19', '--policy-file', 'rel.json', '--json',
        ])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)

    def test_policy_bytes_file_is_status_only_and_bounded(self):
        valid = ['status', '--target', 'install_demo', '--request-id', 'req_1',
                 '--policy-bytes-file', str(self.policy), '--json']
        captured = []
        code, payload, _ = self.invoke(valid, adapter=lambda fields: (
            captured.append(fields) or (cli.EXIT_OK, {'status': 'ok'})))
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(captured[0]['policy_bytes_file'], str(self.policy))
        for value in ('relative.json', str(Path(self.tmp.name) / 'missing.json'), self.tmp.name):
            with self.subTest(value=value):
                code, payload, _ = self.invoke([
                    'status', '--target', 'install_demo', '--request-id', 'req_1',
                    '--policy-bytes-file', value, '--json',
                ])
                self.assertEqual(code, cli.EXIT_INVALID_INPUT)
                self.assertEqual(payload['error']['code'], 'invalid_input')
        oversized = Path(self.tmp.name) / 'oversized-policy.json'
        oversized.write_bytes(b'x' * (cli.POLICY_MAX_BYTES + 1))
        code, payload, _ = self.invoke([
            'status', '--target', 'install_demo', '--request-id', 'req_1',
            '--policy-bytes-file', str(oversized), '--json',
        ])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        # Other command parsers remain unchanged and reject the status-only flag.
        code, payload, _ = self.invoke([
            'health', '--target', 'install_demo', '--policy-bytes-file', str(self.policy), '--json',
        ])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)

    # --------------------------------------------------------- required flags

    def test_required_flags_per_command(self):
        policy = str(self.policy)
        missing = {
            'inspect': (['tenant', 'inspect', '--json'], '--target'),
            'entitle-policy': (
                ['tenant', 'entitle', '--target', 't', '--expected-revision', '1',
                 '--request-id', 'req_1', '--json'], '--policy-file'),
            'entitle-revision': (
                ['tenant', 'entitle', '--target', 't', '--policy-file', policy,
                 '--request-id', 'req_1', '--json'], '--expected-revision'),
            'entitle-request': (
                ['tenant', 'entitle', '--target', 't', '--policy-file', policy,
                 '--expected-revision', '1', '--json'], '--request-id'),
            'backup-request': (['backup', '--target', 't', '--json'], '--request-id'),
            'upgrade-release': (
                ['upgrade', '--target', 't', '--request-id', 'req_1', '--json'], '--release'),
            'restore-backup': (
                ['restore', '--target', 't', '--approval-id', 'apr_1',
                 '--request-id', 'req_1', '--json'], '--backup-id'),
            'restore-approval': (
                ['restore', '--target', 't', '--backup-id', 'bkp_1',
                 '--request-id', 'req_1', '--json'], '--approval-id'),
            'restore-request': (
                ['restore', '--target', 't', '--backup-id', 'bkp_1',
                 '--approval-id', 'apr_1', '--json'], '--request-id'),
        }
        for name, (argv, flag) in missing.items():
            with self.subTest(case=name):
                code, payload, _ = self.invoke(argv)
                self.assertEqual(code, cli.EXIT_INVALID_INPUT)
                self.assertIn(flag, payload['error']['message'])

    def test_preflight_does_not_require_a_request_id(self):
        code, payload, _ = self.invoke(['tenant', 'preflight', '--target', 't',
                                        '--policy-file', str(self.policy), '--json'])
        self.assertEqual(code, cli.EXIT_OK, payload)

    def test_create_requires_private_policy_and_request_identity(self):
        code, payload, _ = self.invoke(['tenant', 'create', '--target', 'scratch_demo',
                                        '--request-id', 'req_1', '--json'])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        self.assertIn('--policy-file', payload['error']['message'])
        code, payload, _ = self.invoke(['tenant', 'create', '--target', 'scratch_demo',
                                        '--policy-file', str(self.policy), '--json'])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        self.assertIn('--request-id', payload['error']['message'])

    def test_expected_revision_must_be_a_non_negative_integer(self):
        for value in ('-1', 'x', '1.5'):
            with self.subTest(value=value):
                code, payload, _ = self.invoke([
                    'tenant', 'entitle', '--target', 't', '--policy-file', str(self.policy),
                    '--expected-revision', value, '--request-id', 'req_1', '--json',
                ])
                self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        payload = self.ok_shape([
            'tenant', 'entitle', '--target', 't', '--policy-file', str(self.policy),
            '--expected-revision', '0', '--request-id', 'req_1', '--json',
        ])
        self.assertEqual(payload['expected_revision'], 0)

    def test_release_bundle_must_be_a_local_path(self):
        code, _, _ = self.invoke(['upgrade', '--target', 't', '--release', 'https://x/y',
                                  '--request-id', 'req_1', '--json'])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)

    # ---------------------------------------------------------- output contract

    def test_stdout_is_exactly_one_json_document(self):
        code, payload, err = self.invoke(['health', '--target', 'install_demo', '--json'])
        self.assertIsInstance(payload, dict)
        self.assertEqual(payload['schema_version'], cli.SCHEMA_VERSION)
        for key in ('operation', 'target', 'status', 'stage', 'changed'):
            self.assertIn(key, payload)
        self.assertEqual(code, cli.EXIT_FAILED_OPERATION)
        self.assertNotIn('Traceback', err)

    def test_no_secret_or_credential_flag_is_accepted(self):
        """A mistyped credential must not be echoed back through the contract."""
        for flag in ('--password', '--token', '--api-key', '--dsn'):
            with self.subTest(flag=flag):
                code, payload, err = self.invoke(['health', '--target', 't', flag, 's3cret',
                                                  '--json'])
                self.assertEqual(code, cli.EXIT_INVALID_INPUT)
                self.assertNotIn('s3cret', json.dumps(payload))
                self.assertNotIn('s3cret', err)
                self.assertIn('unrecognized arguments', payload['error']['message'])

    def test_option_like_unknown_value_is_not_echoed(self):
        secret = '--private-secret-value'
        code, payload, err = self.invoke([
            'health', '--target', 'install_demo', '--password', secret, '--json',
        ])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        self.assertNotIn(secret, json.dumps(payload) + err)

    def test_invalid_integer_and_missing_private_path_never_echo_raw_input(self):
        secret = 'secret-connection-token'
        code, payload, err = self.invoke([
            'tenant', 'entitle', '--target', 'install_demo',
            '--policy-file', str(self.policy), '--expected-revision', secret,
            '--request-id', 'req_1', '--json',
        ])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        self.assertNotIn(secret, json.dumps(payload) + err)
        missing = str(Path(self.tmp.name) / f'{secret}.json')
        code, payload, err = self.invoke([
            'tenant', 'preflight', '--target', 'install_demo',
            '--policy-file', missing, '--json',
        ])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        self.assertNotIn(secret, json.dumps(payload) + err)

    def test_invalid_target_value_is_not_echoed(self):
        code, payload, _ = self.invoke(['health', '--target', 'S3cretValue', '--json'])
        self.assertEqual(code, cli.EXIT_INVALID_INPUT)
        self.assertNotIn('S3cretValue', json.dumps(payload))

    # ------------------------------------------------------------- boundaries

    def test_cli_imports_no_network_odoo_or_subprocess(self):
        imported = set()
        for name in ('cli.py', '__init__.py', '__main__.py'):
            source = (Path(cli.__file__).parent / name).read_text(encoding='utf-8')
            for node in ast.walk(ast.parse(source)):
                if isinstance(node, ast.Import):
                    imported.update(alias.name.split('.')[0] for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imported.add(node.module.lstrip('.').split('.')[0])
        forbidden = imported & {'socket', 'urllib', 'http', 'requests', 'subprocess', 'odoo'}
        self.assertEqual(forbidden, set(), f'nasq_cli imports {sorted(forbidden)}')

    def test_validators_are_pure_and_reject_bad_input(self):
        for target in ('Good', 'UPPER', '-lead', 'x' * 65):
            with self.subTest(target=target):
                with self.assertRaises(cli.CliError):
                    cli.validate_target(target)
        self.assertEqual(cli.validate_target('install_demo'), 'install_demo')
        with self.assertRaises(cli.CliError):
            cli.validate_identifier('bad id', '--request-id')

    def test_default_entry_stays_unwired_in_cp2_t4(self):
        """CP2-T4 ships the adapter module; the bare contract entry stays executor-free."""
        code, payload, _ = self.invoke(['backup', '--target', 't', '--request-id', 'req_1',
                                        '--json'])
        self.assertEqual(code, cli.EXIT_FAILED_OPERATION)
        self.assertEqual(payload['error']['code'], 'operation_not_wired')
        self.assertIs(payload['changed'], False)
        self.assertTrue((Path(cli.__file__).parent / 'adapters.py').exists())


if __name__ == '__main__':
    unittest.main()
