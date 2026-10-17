# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Exercise the runner at its real Git and external-process boundaries."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import local_ci

SCRIPT = Path(__file__).with_name('local_ci.py')
STAGES = ('static', 'ai-service', 'control-plane', 'vendor-admin', 'odoo',
          'odoo-tasks-standalone', 'odoo-tasks-bridge', 'upgrade', 'restore-drill',
          'image', 'e2e-mock', 'rtl-stories')


class LocalCiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'candidate'
        self.repo.mkdir()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.report = self.root / 'report'
        self.git('init', '-q')
        self.git('config', 'user.name', 'CI test')
        self.git('config', 'user.email', 'ci@example.invalid')
        (self.repo / '.woodpecker.yml').write_text('steps:\n' + ''.join(
            f'  - name: {stage}\n    image: bash\n    commands: [true]\n' for stage in STAGES))
        upstream = self.root / 'odoo'
        upstream.mkdir()
        subprocess.run(['git', 'init', '-q', str(upstream)], check=True)
        subprocess.run(['git', '-C', str(upstream), '-c', 'user.name=CI test',
                        '-c', 'user.email=ci@example.invalid', 'commit', '--allow-empty', '-qm', 'pin'], check=True)
        self.pin = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
        (upstream / 'odoo-bin').touch()
        (upstream / '.venv/bin').mkdir(parents=True)
        (upstream / '.venv/bin/python3.12').symlink_to(sys.executable)
        (self.repo / 'deploy/odoo').mkdir(parents=True)
        (self.repo / 'deploy/odoo/ODOO_COMMIT').write_text(self.pin + '\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        self.commit = self.git('rev-parse', 'HEAD')
        self.calls = self.root / 'calls.jsonl'
        self.mode = self.root / 'mode'
        self.mode.write_text('success')
        self.env = {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
                    'WEBVUE_CI_ODOO_ROOT': str(upstream), 'SHOULD_NOT_REACH_CI_API_KEY': 'private'}
        self.executable('docker', '''import json,os,sys
with open(CALLS, 'a') as out: out.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[1] == 'port': print('127.0.0.1:55432')
if sys.argv[1:3] == ['network', 'ls']:
 calls=[json.loads(x) for x in Path(CALLS).read_text().splitlines()]
 print(next(x[2] for x in calls if x[:2]==['network','create']))
if sys.argv[1] == 'ps':
 if Path(MODE).read_text() == 'cleanup-failure': sys.exit(8)
 calls=[json.loads(x) for x in Path(CALLS).read_text().splitlines()]
 run=next(x for x in calls if x[0]=='run')
 print(run[run.index('--name')+1])
if sys.argv[1] == 'rm' and len(sys.argv[1:]) != 3: sys.exit(1)
if Path(MODE).read_text() == 'docker-failure' and sys.argv[1] == 'info': sys.exit(7)
if Path(MODE).read_text() == 'compose-failure' and sys.argv[1:3] == ['compose','version']: sys.exit(9)
''')
        self.executable('woodpecker-cli', '''import json,os,pathlib,sys
args=sys.argv[1:]
metadata=json.loads(pathlib.Path(args[args.index('--metadata-file')+1]).read_text())
assert metadata['repo']=={'owner':'tariiq222','name':'webvue','branch':'main'}
with open(CALLS, 'a') as out: out.write(json.dumps(['woodpecker', *args])+'\\n')
run=pathlib.Path(args[args.index('--env')+1].split('=',1)[1])
config=json.loads((run/'config.json').read_text())
assert 'SHOULD_NOT_REACH_CI_API_KEY' not in os.environ
names=['static','ai-service','control-plane','vendor-admin','odoo','odoo-tasks-standalone','odoo-tasks-bridge','upgrade','restore-drill','image','e2e-mock','rtl-stories']
for name in names:
 if Path(MODE).read_text() == 'missing-stage' and name == 'image': continue
 code=3 if Path(MODE).read_text() == 'failed-stage' and name == 'image' else 0
 (run/'stages'/f'{name}.json').write_text(json.dumps({'name':name,'exit_code':code,'run_id':'stale-run' if Path(MODE).read_text()=='stale-receipt' else config['run_id'],'commit':config['commit'],'result':'no_baseline' if name=='upgrade' else 'checked'}))
print('PIPELINE_OUTPUT')
if Path(MODE).read_text() == 'cli-failure': sys.exit(4)
''')
        for name in ('git', 'bash', 'python3'):
            (self.bin / name).symlink_to(shutil.which(name))
        self.executable('node', "print('v22.0.0')\n")
        (self.repo / '.nvmrc').write_text('22\n')
        self.git('add', '.nvmrc')
        self.git('commit', '-qm', 'runtime pin')
        self.commit = self.git('rev-parse', 'HEAD')
        for name in ('npm', 'ruff', 'semgrep', 'psql', 'pg_dump', 'pg_restore', 'createdb', 'dropdb', 'curl'):
            self.executable(name, "print('PostgreSQL 16.0')\n")

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True).strip()

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(f'#!{sys.executable}\nfrom pathlib import Path\nCALLS={str(self.calls)!r}\nMODE={str(self.mode)!r}\n' + body)
        path.chmod(0o755)

    def run_ci(self, **env):
        self.mode.write_text(env.pop('FAKE_MODE', 'success'))
        return subprocess.run([sys.executable, '-B', str(SCRIPT), '--base', self.commit,
                               '--commit', self.commit, '--report-dir', str(self.report)],
                              cwd=self.repo, env={**self.env, **env}, capture_output=True, text=True, check=False)

    def receipt(self):
        return json.loads((self.report / 'report.json').read_text())

    def test_full_success_requires_all_stages_and_binds_metadata(self):
        result = self.run_ci()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = self.receipt()
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(report['base'], self.commit)
        self.assertEqual(report['commit'], self.commit)
        self.assertEqual([x['name'] for x in report['stages']], list(STAGES))
        self.assertIn('PIPELINE_OUTPUT', (self.report / 'pipeline.log').read_text())
        calls = [json.loads(x) for x in self.calls.read_text().splitlines()]
        cli = next(x for x in calls if x[0] == 'woodpecker')
        for flag, value in (('--backend-engine', 'local'), ('--repo', 'tariiq222/webvue'),
                            ('--pipeline-event', 'manual'), ('--commit-branch', 'main'),
                            ('--commit-sha', self.commit), ('--prev-commit-sha', self.commit)):
            self.assertEqual(cli[cli.index(flag) + 1], value)
        self.assertIn('--local', cli)
        self.assertTrue(any(x[:2] == ['rm', '-fv'] and x[-1].startswith('webvue-ci-') for x in calls))
        self.assertTrue(any(x[:2] == ['network', 'rm'] for x in calls))

    def test_zero_cli_exit_cannot_hide_a_skipped_or_failed_stage(self):
        for mode in ('missing-stage', 'failed-stage', 'cli-failure', 'stale-receipt', 'cleanup-failure'):
            with self.subTest(mode=mode):
                shutil.rmtree(self.report, ignore_errors=True)
                result = self.run_ci(FAKE_MODE=mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.receipt()['status'], 'failed')

    def test_waits_for_published_postgres_before_provisioning_roles(self):
        self.executable('psql', '''import json,sys
args=sys.argv[1:]
if args == ['--version']: print('PostgreSQL 16.0'); sys.exit(0)
with open(CALLS, 'a') as out: out.write(json.dumps(['psql', *args])+'\\n')
marker=Path(CALLS).with_name('tcp-attempts')
if args[args.index('-U')+1] == 'postgres':
 count=int(marker.read_text())+1 if marker.exists() else 1
 marker.write_text(str(count))
 sys.exit(2 if count == 1 else 0)
if not marker.exists() or int(marker.read_text()) < 2: sys.exit(2)
''')
        result = self.run_ci()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.receipt()['status'], 'passed')
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        probes = [i for i, call in enumerate(calls) if call[0] == 'psql'
                  and call[call.index('-U') + 1] == 'postgres']
        role = next(i for i, call in enumerate(calls) if call[0] == 'exec'
                    and call[-1].startswith('CREATE ROLE'))
        self.assertEqual(len(probes), 2)
        self.assertLess(probes[-1], role)

    def test_postgres_timeout_never_starts_pipeline_and_cleans_owned_resources(self):
        self.executable('psql', '''import json,sys
args=sys.argv[1:]
if args == ['--version']: print('PostgreSQL 16.0'); sys.exit(0)
with open(CALLS, 'a') as out: out.write(json.dumps(['psql', *args])+'\\n')
if args[args.index('-U')+1] == 'postgres': sys.exit(2)
''')
        previous = Path.cwd()
        try:
            os.chdir(self.repo)
            with patch.dict(os.environ, self.env), patch.object(local_ci.time, 'sleep'):
                result = local_ci.run(SimpleNamespace(base=self.commit, commit=self.commit,
                                                     report_dir=str(self.report)))
        finally:
            os.chdir(previous)
        self.assertEqual(result, 1)
        self.assertEqual(self.receipt()['status'], 'failed')
        self.assertEqual(self.receipt()['stages'], [])
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        probes = [call for call in calls if call[0] == 'psql'
                  and call[call.index('-U') + 1] == 'postgres']
        self.assertEqual(len(probes), 60)
        self.assertFalse(any(call[0] == 'woodpecker' for call in calls))
        self.assertFalse(any(call[0] == 'exec' and call[-1].startswith('CREATE ROLE')
                             for call in calls))
        self.assertTrue(any(call[:2] == ['rm', '-fv'] for call in calls))
        self.assertTrue(any(call[:2] == ['network', 'rm'] for call in calls))

    def test_node_version_mismatch_fails_before_resources(self):
        self.executable('node', "print('v24.0.0')\n")
        result = self.run_ci()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('.nvmrc', self.receipt()['error'])
        self.assertFalse(self.calls.exists())

    def test_controller_log_can_exist_but_dangling_output_symlinks_are_rejected(self):
        self.report.mkdir()
        (self.report / 'runner.log').write_text('controller-owned')
        target = self.root / 'do-not-create'
        (self.report / 'pipeline.log').symlink_to(target)
        result = self.run_ci()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(target.exists())

    def test_missing_tool_and_unavailable_docker_leave_failure_receipts(self):
        (self.bin / 'semgrep').unlink()
        result = self.run_ci(PATH=str(self.bin) + os.pathsep + '/usr/bin:/bin')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('semgrep', self.receipt()['error'])
        shutil.rmtree(self.report)
        self.executable('semgrep', 'pass\n')
        result = self.run_ci(FAKE_MODE='docker-failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.receipt()['status'], 'failed')

    def test_missing_compose_fails_before_any_resources_or_skipped_topology_tests(self):
        result = self.run_ci(FAKE_MODE='compose-failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.receipt()['status'], 'failed')
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        self.assertFalse(any(call[0] == 'run' for call in calls))

    def test_rejects_wrong_odoo_pin_before_starting_resources(self):
        (self.repo / 'deploy/odoo/ODOO_COMMIT').write_text('0' * 40)
        result = self.run_ci()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_existing_report_directory_is_never_overwritten(self):
        self.report.mkdir()
        original = self.report / 'report.json'
        original.write_text('preserve')
        result = self.run_ci()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(original.read_text(), 'preserve')

    def test_removed_stage_is_not_a_smaller_successful_gate(self):
        path = self.repo / '.woodpecker.yml'
        path.write_text('steps:\n  - name: static\n    commands: [true]\n')
        result = self.run_ci()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.calls.exists())


if __name__ == '__main__':
    unittest.main()
