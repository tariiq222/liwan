# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Execute CI command blocks against controlled process boundaries."""
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def commands(name):
    """Read command scalars from this pipeline without requiring host PyYAML."""
    text = (ROOT / '.woodpecker.yml').read_text()
    block = re.split(r'^  - name: ' + re.escape(name) + r'\s*$', text, flags=re.M)[1]
    block = re.split(r'^  - name: ', block, flags=re.M)[0]
    lines = block.split('    commands:\n', 1)[1].splitlines()
    script = []
    multiline = False
    for line in lines:
        if line.startswith('      - '):
            command = line[8:]
            multiline = command == '|'
            if not multiline:
                script.append(command)
        elif multiline and line.startswith('        '):
            script.append(line[8:])
    return '\n'.join(script).replace('$$', '$')


class TestPipelineExecution(unittest.TestCase):
    """A wrong PG port, a clone, missing verdict, or generic Docker name fails these."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.run_dir = self.root / 'run'
        (self.run_dir / 'stages').mkdir(parents=True)
        self.calls = self.root / 'calls.jsonl'
        self.odoo = self.root / 'odoo'
        self.odoo.mkdir()
        (self.odoo / 'odoo-bin').touch()
        (self.root / 'deploy/woodpecker').mkdir(parents=True)
        shutil.copy(ROOT / 'deploy/woodpecker/stage.sh', self.root / 'deploy/woodpecker/stage.sh')
        (self.root / 'deploy/odoo').mkdir()
        (self.root / 'deploy/odoo/ODOO_COMMIT').write_text('a' * 40)
        self.fake('odoo-python', '''
log = next((a.split('=',1)[1] for a in args if a.startswith('--logfile=')), None)
if log: Path(log).write_text('odoo.tests.result: 0 failed, 0 error(s) of 12 tests when loading database\\n')
''')
        self.fake('python3', '''
if args[0] == '-': os.execv(sys.executable, [sys.executable, *args])
if 'tools/catalog_check.py' in args: print('webvue_tasks')
if 'deploy/classification.py' in args:
 output=Path(args[args.index('--output')+1]); output.parent.mkdir(parents=True, exist_ok=True); output.write_text('{}')
''')
        self.fake('git', "sys.exit(17)  # Read-only validated upstream must not be cloned by stages.\n")
        self.fake('dropdb', '')
        self.fake('docker', '')
        self.fake('psql', '''
if 'webvue_tasks_pmo' in ' '.join(args) and "SELECT state" in ' '.join(args): print('installed')
elif "SELECT state" in ' '.join(args): print('installed')
''')
        config = {'PGHOST': '127.0.0.1', 'PGPORT': '55432', 'PGUSER': 'odoo', 'PGPASSWORD': 'scratch',
                  'ODOO_ROOT': str(self.odoo), 'ODOO_PYTHON': str(self.bin / 'odoo-python'),
                  'WEBVUE_CI_RUN_ID': 'isolated123', 'WEBVUE_CI_COMMIT': 'b' * 40,
                  'ODOO_PORT': '52101', 'TASKS_PORT': '52102', 'BRIDGE_PORT': '52103',
                  'WEBVUE_CI_NETWORK': 'webvue-ci-isolated123-net',
                  'WEBVUE_CI_PG_CONTAINER': 'webvue-ci-isolated123-pg',
                  'WEBVUE_CI_IMAGE': 'webvue-odoo:isolated123',
                  'WEBVUE_CI_IMAGE_CONTAINER': 'webvue-ci-isolated123-image',
                  'WEBVUE_CI_CHECK_CONTAINER': 'webvue-ci-isolated123-check',
                  'DOCKER_CONFIG': str(self.root / 'docker')}
        (self.run_dir / 'environment.sh').write_text(''.join(
            'export ' + k + '=' + shlex.quote(v) + '\n' for k, v in config.items()))

    def fake(self, name, body):
        file = self.bin / name
        file.write_text(f'#!{sys.executable}\nimport os,sys,json\nfrom pathlib import Path\n'
                        f'args=sys.argv[1:]\nwith open({str(self.calls)!r}, "a") as out: '
                        f'out.write(json.dumps([{name!r}, *args])+"\\n")\n' + body)
        file.chmod(0o755)

    def execute(self, stage):
        # Preserve our fake command directory when the production stage adds host PATH entries.
        script = commands(stage).replace('/opt/homebrew/bin:/usr/local/bin:', '')
        script = script.replace('/Users/tariq/code/odoo', str(self.root / 'forbidden-upstream'))
        script = script.replace('/tmp/odoo.conf', str(self.root / 'forbidden-global-odoo.conf'))
        script = script.replace('/tmp/image-classification.json', str(self.root / 'forbidden-global-classification.json'))
        return subprocess.run(['bash', '-c', script], cwd=self.root,
                                 env={**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
                                      'WEBVUE_CI_RUN_DIR': str(self.run_dir), 'CI_PIPELINE_NUMBER': '123',
                                      'CI_COMMIT_SHA': 'b' * 40}, capture_output=True, text=True, check=False)

    def test_odoo_steps_execute_against_the_isolated_connection_and_pinned_source(self):
        for name, wanted_modules, wanted_port in (('odoo', 'webvue_tasks', '52101'),
                                                  ('odoo-tasks-standalone', 'webvue_tasks', '52102'),
                                                  ('odoo-tasks-bridge', 'webvue_tasks,webvue_pmo,webvue_tasks_pmo', '52103')):
            with self.subTest(stage=name):
                self.calls.write_text('')
                process = self.execute(name)
                self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
                calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
                odoo = next(x for x in calls if x[0] == 'odoo-python')
                self.assertIn('--db_port=55432', odoo)
                self.assertIn('--db_host=127.0.0.1', odoo)
                self.assertIn('--http-port=' + wanted_port, odoo)
                self.assertEqual(odoo[odoo.index('-i') + 1], wanted_modules)
                self.assertEqual(odoo[1], str(self.odoo / 'odoo-bin'))
                for drop in (x for x in calls if x[0] == 'dropdb'):
                    self.assertEqual(drop[drop.index('-p') + 1], '55432')
                receipt = json.loads((self.run_dir / 'stages' / (name + '.json')).read_text())
                self.assertEqual(receipt['exit_code'], 0)

    def test_missing_odoo_test_verdict_is_a_failed_stage(self):
        self.fake('odoo-python', "log=next(a.split('=',1)[1] for a in args if a.startswith('--logfile=')); Path(log).touch()\n")
        process = self.execute('odoo')
        self.assertNotEqual(process.returncode, 0)
        self.assertNotEqual(json.loads((self.run_dir / 'stages/odoo.json').read_text())['exit_code'], 0)

    def test_upgrade_without_baseline_is_an_explicit_completed_result(self):
        process = self.execute('upgrade')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        receipt = json.loads((self.run_dir / 'stages/upgrade.json').read_text())
        self.assertEqual(receipt['result'], 'no_baseline')
        self.assertEqual(receipt['exit_code'], 0)

    def test_upgrade_uses_previous_odoo_pin_without_mutating_upstream_or_worktrees(self):
        git = shutil.which('git')

        def git_at(directory, *args):
            return subprocess.check_output([git, '-C', str(directory), *args], text=True).strip()

        git_at(self.odoo, 'init', '-q')
        git_at(self.odoo, 'add', 'odoo-bin')
        git_at(self.odoo, '-c', 'user.name=CI test', '-c', 'user.email=ci@example.invalid',
               'commit', '-qm', 'old upstream')
        previous_pin = git_at(self.odoo, 'rev-parse', 'HEAD')
        pin = self.root / 'deploy/odoo/ODOO_COMMIT'
        pin.write_text(previous_pin)
        (self.root / 'deploy/odoo/upgrade_smoke.py').touch()
        git_at(self.root, 'init', '-q')
        git_at(self.root, 'add', 'deploy/odoo')
        git_at(self.root, '-c', 'user.name=CI test', '-c', 'user.email=ci@example.invalid',
               'commit', '-qm', 'baseline product')
        git_at(self.root, 'tag', 'release/test')
        pin.write_text('a' * 40)
        (self.bin / 'git').unlink()
        (self.bin / 'git').symlink_to(git)
        self.fake('odoo-python', "if 'shell' in args: print('UPGRADE_SMOKE_OK')\n")
        self.fake('python3', '''
if args[0] == '-': os.execv(sys.executable, [sys.executable, *args])
if 'tools/catalog_check.py' in args: print('webvue_tasks')
if 'tools/upgrade_baseline.py' in args: print('release/test')
if 'deploy/classification.py' in args: Path(args[args.index('--output')+1]).write_text('{}')
''')
        worktrees = git_at(self.root, 'worktree', 'list', '--porcelain')
        process = self.execute('upgrade')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        odoo = [x for x in calls if x[0] == 'odoo-python']
        self.assertEqual(len(odoo), 3)
        self.assertTrue(odoo[0][1].endswith('/old-odoo/odoo-bin'))
        self.assertEqual([x[1] for x in odoo[1:]], [str(self.odoo / 'odoo-bin')] * 2)
        self.assertEqual(git_at(self.odoo, 'rev-parse', 'HEAD'), previous_pin)
        self.assertEqual(git_at(self.odoo, 'status', '--porcelain'), '')
        self.assertEqual(git_at(self.root, 'worktree', 'list', '--porcelain'), worktrees)

    def test_ai_tests_receive_the_isolated_database_url_and_leave_a_receipt(self):
        (self.root / 'apps/ai-service').mkdir(parents=True)
        self.fake('createdb', '')
        self.fake('pip', '')
        self.fake('ruff', '')
        self.fake('pytest', "Path('observed-url').write_text(os.environ['AI_TEST_DATABASE_URL'])\n")
        self.fake('python3', "if args[0] == '-': os.execv(sys.executable, [sys.executable, *args])\nif '-m' in args: sys.exit(42)  # Host Python may be older than the service requires.\n")
        self.fake('odoo-python', '''
if args[:2] == ['-m','venv']:
 directory=Path(args[2])/'bin'; directory.mkdir(parents=True)
 for name in ('pip','ruff','pytest'): (directory/name).symlink_to(Path(sys.argv[0]).parent/name)
''')
        process = self.execute('ai-service')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        self.assertEqual((self.root / 'apps/ai-service/observed-url').read_text(),
                         'postgresql://odoo:scratch@127.0.0.1:55432/webvue_ai_ci_123')
        receipt = json.loads((self.run_dir / 'stages/ai-service.json').read_text())
        self.assertEqual(receipt['exit_code'], 0)

    def test_restore_drill_uses_the_isolated_port_in_backup_restore_and_odoo(self):
        self.fake('curl', '')
        self.fake('pg_dump', '')
        self.fake('odoo-python', '''
if '--stop-after-init' not in args:
 import time
 time.sleep(10)
''')
        self.fake('psql', "print('aa/attachment')\n")
        self.fake('python3', '''
if args[0] in ('-', '-c'): os.execv(sys.executable, [sys.executable, *args])
if 'tools/catalog_check.py' in args: print('webvue_tasks')
if 'deploy/classification.py' in args: Path(args[args.index('--output')+1]).write_text('{}')
if 'deploy/backup.py' in args:
 backup=Path(args[args.index('--output-dir')+1]); (backup/'filestore/aa').mkdir(parents=True)
 (backup/'filestore/aa/attachment').write_text('data'); (backup/'manifest.json').write_text('{}')
if 'deploy/restore_verify.py' in args:
 backup=Path(args[args.index('--backup-dir')+1])
 if not (backup/'filestore/aa/attachment').exists():
  (backup/'restore-verification.json').write_text(json.dumps({'restore_verified':False,'checks':{'missing_attachment_files':['aa/attachment']}}))
  sys.exit(1)
''')
        process = self.execute('restore-drill')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        for command in (x for x in calls if x[0] == 'odoo-python'):
            self.assertIn('--db_port=55432', command)
        scripts = [x for x in calls if x[0] == 'python3'
                   and any(script in x for script in ('deploy/backup.py', 'deploy/restore_verify.py'))]
        self.assertEqual(len(scripts), 3)
        for command in scripts:
            self.assertEqual(command[command.index('--pg-port') + 1], '55432')
        receipt = json.loads((self.run_dir / 'stages/restore-drill.json').read_text())
        self.assertEqual(receipt['exit_code'], 0)

    def test_image_gate_builds_and_checks_with_owned_names_and_scratch_files(self):
        process = self.execute('image')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        build = next(x for x in calls if x[:2] == ['docker', 'build'])
        self.assertEqual(build[build.index('-t') + 1], 'webvue-odoo:isolated123')
        runs = [x for x in calls if x[:2] == ['docker', 'run']]
        self.assertEqual(len(runs), 2)
        self.assertEqual([x[x.index('--name') + 1] for x in runs],
                         ['webvue-ci-isolated123-image', 'webvue-ci-isolated123-check'])
        for run in runs:
            for value in (x for x in run if ':/etc/odoo/' in x or ':/run/webvue/' in x):
                self.assertTrue(value.startswith(str(self.run_dir)), value)


class TestWoodpeckerVendorAdminStep(unittest.TestCase):
    def test_vendor_admin_step_prepares_lints_tests_and_builds(self):
        text = (ROOT / '.woodpecker.yml').read_text().split('\nsteps:\n', 1)[1]
        blocks = {block.split('\n', 1)[0].strip(): block for block in re.split(r'^  - name: ', text, flags=re.M)[1:]}
        script = blocks['vendor-admin']
        order = [script.index(command) for command in ('npx nuxt prepare', 'npm run lint', 'npm run test', 'npm run build')]
        self.assertEqual(order, sorted(order))
        self.assertIn('cd apps/vendor-admin', script)


if __name__ == '__main__':
    unittest.main()
