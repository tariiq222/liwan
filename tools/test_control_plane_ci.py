# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Verify CI database routing without creating databases or running npm."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ControlPlaneCiTest(unittest.TestCase):
    def test_analytics_suite_uses_its_required_database_and_is_excluded_from_main(self):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            log = temporary / 'commands.jsonl'
            executable = temporary / 'record'
            executable.write_text(
                f'#!{sys.executable}\nimport json,os,sys\nfrom pathlib import Path\n'
                'from urllib.parse import urlparse\n'
                'with open(os.environ["CI_TEST_COMMAND_LOG"],"a") as log:\n'
                ' log.write(json.dumps({"tool":Path(sys.argv[0]).name,"args":sys.argv[1:],'
                '"database":urlparse(os.environ.get("CONTROL_TEST_DATABASE_URL","")).path})+"\\n")\n'
            )
            executable.chmod(0o755)
            # curl answers the Mailpit wait; python3 records the skip gate and the backup live test instead of running them.
            for name in ('npm', 'createdb', 'dropdb', 'curl', 'python3'):
                (temporary / name).symlink_to(executable)
            environment = {**os.environ, 'PATH': str(temporary) + os.pathsep + os.environ['PATH'],
                           'PGHOST': '127.0.0.1', 'PGUSER': 'ci_test', 'PGPASSWORD': 'validation-only',
                           'LIWAN_MAILPIT_SMTP_PORT': '1025', 'LIWAN_MAILPIT_API_PORT': '8025',
                           'CI_TEST_COMMAND_LOG': str(log)}
            result = subprocess.run(['bash', str(ROOT / 'deploy/control-plane/ci-test.sh')],
                                    cwd=ROOT, env=environment, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertIn('liwan_control_scratch_analytics',
                          [call['args'][-1] for call in calls if call['tool'] == 'createdb'])
            suites = [call for call in calls if call['tool'] == 'npm' and call['database']]
            main = next(call for call in suites if call['database'] == '/liwan_control_scratch_ci')
            self.assertIn('**/commercial-analytics.test.ts', main['args'])
            analytics = next(call for call in suites if call['database'] == '/liwan_control_scratch_analytics')
            self.assertIn('commercial-analytics', analytics['args'])
            python = [call['args'] for call in calls if call['tool'] == 'python3']
            gate = next(args for args in python if args[1:2] == ['deploy/control-plane/vitest_skip_gate.py'])
            self.assertEqual([Path(report).name for report in gate[2:]], [f'group{n}.json' for n in (1, 2, 3, 4)])
            self.assertIn(['-B', 'deploy/control-plane/unittest_no_skip.py', 'deploy.releases.test_backup_live'], python)
            self.assertIn('liwan_scratch_backup_ci', [call['args'][-1] for call in calls if call['tool'] == 'createdb'])

    def test_stage_refuses_to_start_without_mailpit(self):
        environment = {key: value for key, value in os.environ.items() if not key.startswith('LIWAN_MAILPIT_')}
        environment.update({'PGHOST': '127.0.0.1', 'PGUSER': 'ci_test', 'PGPASSWORD': 'validation-only'})
        result = subprocess.run(['bash', str(ROOT / 'deploy/control-plane/ci-test.sh')],
                                cwd=ROOT, env=environment, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Mailpit is required', result.stderr)
