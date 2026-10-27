# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Execute the CI stage scripts against controlled process boundaries."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def commands(name):
    """The stage script, as bash source."""
    return (ROOT / 'deploy/ci' / (name + '.sh')).read_text()


class TestPipelineExecution(unittest.TestCase):
    """A wrong PG port, a clone, missing verdict, or generic Docker name fails these."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.calls = self.root / 'calls.jsonl'
        self.odoo = self.root / 'odoo'
        self.odoo.mkdir()
        (self.odoo / 'odoo-bin').touch()
        (self.root / 'deploy/ci').mkdir(parents=True)
        for script in (ROOT / 'deploy/ci').glob('*.sh'):
            shutil.copy(script, self.root / 'deploy/ci' / script.name)
        shutil.copytree(ROOT / 'deploy/ci/lib', self.root / 'deploy/ci/lib')
        shutil.copy(ROOT / 'deploy/ci/odoo_route_probe.py', self.root / 'deploy/ci/odoo_route_probe.py')
        (self.root / 'deploy/odoo').mkdir()
        (self.root / 'deploy/odoo/ODOO_COMMIT').write_text('a' * 40)
        self.fake('odoo-python', '''
log = next((a.split('=',1)[1] for a in args if a.startswith('--logfile=')), None)
if log: Path(log).write_text('odoo.tests.result: 0 failed, 0 error(s) of 12 tests when loading database\\n')
if 'shell' in args: print('ROUTE_PROBE_OK')
''')
        self.fake('python3', '''
if args[0] == '-': os.execv(sys.executable, [sys.executable, *args])
if 'tools/catalog_check.py' in args: print('webvue_tasks')
if 'tools/oca_addons.py' in args: print('/oca/repo')
if 'tools/app_isolation.py' in args and 'install' in args:
 print({'webvue_tasks_pmo': 'webvue_pmo,webvue_tasks'}.get(args[-1], args[-1]))
if 'tools/app_isolation.py' in args and 'tags' in args: print('/' + args[-1])
if 'tools/app_isolation.py' in args and 'foundation' in args: print('webvue_api')
if 'tools/app_isolation.py' in args and 'rank' in args: print(4)
if 'deploy/classification.py' in args:
 output=Path(args[args.index('--output')+1]); output.parent.mkdir(parents=True, exist_ok=True); output.write_text('{}')
''')
        self.fake('git', "sys.exit(17)  # Read-only validated upstream must not be cloned by stages.\n")
        self.fake('dropdb', '')
        self.fake('docker', '''
joined = ' '.join(args)
if args[:1] == ['inspect']: print('true')
if args[:1] == ['exec'] and joined.endswith('id -u'): print(10001)
if args[:1] == ['exec'] and 'unknown.invalid' in joined: print(403)
if args[:2] == ['image', 'inspect']: print('sha256:' + args[-1])
''')
        self.fake('psql', '''
if 'webvue_tasks_pmo' in ' '.join(args) and "SELECT state" in ' '.join(args): print('installed')
elif "SELECT state" in ' '.join(args): print('installed')
''')
        config = {'PGHOST': '127.0.0.1', 'PGPORT': '55432', 'PGUSER': 'odoo', 'PGPASSWORD': 'scratch',
                  'ODOO_ROOT': str(self.odoo), 'ODOO_PYTHON': str(self.bin / 'odoo-python'),
                  'GITHUB_RUN_ID': '123', 'GITHUB_SHA': 'b' * 40,
                  'ODOO_PORT': '52101', 'ISOLATION_PORT': '52102',
                  'DOCKER_CONFIG': str(self.root / 'docker')}
        self.environment = {**os.environ, **config, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH']}
        # The runner's own job summary file must not capture a stage's output; tests that want it set it.
        self.environment.pop('GITHUB_STEP_SUMMARY', None)

    def fake(self, name, body):
        file = self.bin / name
        file.write_text(f'#!{sys.executable}\nimport os,sys,json\nfrom pathlib import Path\n'
                        f'args=sys.argv[1:]\nwith open({str(self.calls)!r}, "a") as out: '
                        f'out.write(json.dumps([{name!r}, *args])+"\\n")\n' + body)
        file.chmod(0o755)

    def execute(self, stage, *args):
        return subprocess.run(['bash', str(self.root / 'deploy/ci' / (stage + '.sh')), *args], cwd=self.root,
                              env=self.environment, capture_output=True, text=True, check=False)

    def test_odoo_steps_execute_against_the_isolated_connection_and_pinned_source(self):
        for name, args, wanted_modules, wanted_port in (('odoo', (), 'webvue_tasks', '52101'),
                                                        ('odoo-app-standalone', ('webvue_tasks',), 'webvue_tasks', '52102'),
                                                        ('odoo-bridge', ('webvue_tasks_pmo',), 'webvue_pmo,webvue_tasks', '52102')):
            with self.subTest(stage=name):
                self.calls.write_text('')
                process = self.execute(name, *args)
                self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
                calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
                odoo = next(x for x in calls if x[0] == 'odoo-python' and 'shell' not in x)
                self.assertIn('--db_port=55432', odoo)
                self.assertIn('--db_host=127.0.0.1', odoo)
                self.assertIn('--http-port=' + wanted_port, odoo)
                self.assertEqual(odoo[odoo.index('-i') + 1], wanted_modules)
                # Committed Odoo concurrency fixtures require this safe prefix.
                self.assertTrue(odoo[odoo.index('-d') + 1].startswith('webvue_scratch_'))
                self.assertEqual(odoo[1], str(self.odoo / 'odoo-bin'))
                probes = [x for x in calls if x[0] == 'odoo-python' and 'shell' in x]
                self.assertEqual(len(probes), {'odoo': 0, 'odoo-app-standalone': 1, 'odoo-bridge': 3}[name])
                for drop in (x for x in calls if x[0] == 'dropdb'):
                    self.assertEqual(drop[drop.index('-p') + 1], '55432')

    def test_missing_odoo_test_verdict_is_a_failed_stage(self):
        self.fake('odoo-python', "log=next(a.split('=',1)[1] for a in args if a.startswith('--logfile=')); Path(log).touch()\n")
        process = self.execute('odoo')
        self.assertNotEqual(process.returncode, 0)

    def test_odoo_nonzero_exit_fails_even_with_a_green_verdict_line(self):
        self.fake('odoo-python', """
log = next(a.split('=',1)[1] for a in args if a.startswith('--logfile='))
Path(log).write_text('odoo.tests.result: 0 failed, 0 error(s) of 12 tests when loading database\\n')
sys.exit(3)
""")
        process = self.execute('odoo')
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('odoo exited 3', process.stderr)

    def test_upgrade_without_baseline_is_an_explicit_completed_result(self):
        process = self.execute('upgrade')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        self.assertIn('no WebVue-namespace release baseline; fresh-install gate remains binding', process.stdout)
        self.assertFalse([x for x in self.calls.read_text().splitlines() if '"odoo-python"' in x])

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

    def test_image_gate_builds_and_checks_with_owned_names_and_scratch_files(self):
        process = self.execute('image')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        build = next(x for x in calls if x[:2] == ['docker', 'build'])
        self.assertEqual(build[build.index('-t') + 1], 'webvue-odoo:ci-123')
        self.assertIn('WEBVUE_REVISION=' + 'b' * 12, build)
        runs = [x for x in calls if x[:2] == ['docker', 'run']]
        install = next(x for x in runs if x[x.index('--name') + 1] == 'webvue-ci-123-image')
        check = next(x for x in runs if x[x.index('--name') + 1] == 'webvue-ci-123-check')
        self.assertEqual(install[install.index('--network') + 1], 'host')
        self.assertIn('--entrypoint', check)
        for value in (x for x in install if ':/etc/odoo/' in x or ':/run/webvue/' in x):
            self.assertFalse(value.startswith(str(self.root)), value)
        self.assertIn(['docker', 'rmi', '-f', 'webvue-odoo:ci-123'], calls)

    def test_image_gate_builds_smokes_cleans_and_records_every_production_image(self):
        process = self.execute('image')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        builds = {x[x.index('-t') + 1]: x for x in calls if x[:2] == ['docker', 'build']}
        contexts = {'web': '.', 'vendor-admin': '.', 'ai-service': 'apps/ai-service', 'proxy': '.', 'guard': '.'}
        dockerfiles = {'web': 'apps/web/Dockerfile', 'vendor-admin': 'apps/vendor-admin/Dockerfile',
                       'ai-service': 'apps/ai-service/Dockerfile', 'proxy': 'deploy/proxy/Dockerfile',
                       'guard': 'deploy/shared/Dockerfile'}
        self.assertEqual(set(builds), {'webvue-odoo:ci-123', *('webvue-%s:ci-123' % n for n in contexts)})
        for name, context in contexts.items():
            with self.subTest(image=name):
                tag = 'webvue-%s:ci-123' % name
                build = builds[tag]
                self.assertEqual(build[build.index('-f') + 1], dockerfiles[name])
                self.assertEqual(build[-1], context)
                self.assertIn(['docker', 'rmi', '-f', tag], calls)
                self.assertIn(['docker', 'image', 'inspect', '--format', '{{.Id}}', tag], calls)
                self.assertIn('| %s | sha256:%s |' % (tag, tag), process.stdout)
                if name != 'proxy':
                    started = next(x for x in calls if x[:3] == ['docker', 'run', '-d']
                                   and x[x.index('--name') + 1] == 'webvue-ci-123-' + name)
                    self.assertIn(tag, started)
                    self.assertIn(['docker', 'exec', 'webvue-ci-123-' + name, 'id', '-u'], calls)
                    self.assertIn(['docker', 'rm', '-fv', 'webvue-ci-123-' + name], calls)
        self.assertIn('| webvue-odoo:ci-123 | sha256:webvue-odoo:ci-123 |', process.stdout)
        proxy = [x for x in calls if x[:2] == ['docker', 'run'] and 'webvue-proxy:ci-123' in x]
        validated = [x for x in proxy if 'validate' in x]
        self.assertEqual(len(validated), 2)
        self.assertTrue(any('http.handlers.rate_limit' in ' '.join(x) for x in proxy))
        guard = next(x for x in calls if x[:3] == ['docker', 'run', '-d'] and 'webvue-ci-123-guard' in x)
        self.assertIn('WEBVUE_TENANCY_MODE=shared', guard)

    def test_image_gate_fails_when_an_image_runs_as_root(self):
        self.fake('docker', "if args[:1] == ['inspect']: print('true')\nif args[:1] == ['exec'] and ' '.join(args).endswith('id -u'): print(0)\n")
        process = self.execute('image')
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('runs as root', process.stderr)

    def test_image_gate_writes_the_digest_table_to_the_step_summary_when_set(self):
        summary = self.root / 'summary.md'
        self.environment['GITHUB_STEP_SUMMARY'] = str(summary)
        process = self.execute('image')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        self.assertIn('| webvue-guard:ci-123 |', summary.read_text())
        self.assertNotIn('| Image |', process.stdout)


class TestVendorAdminStage(unittest.TestCase):
    def test_vendor_admin_stage_prepares_lints_tests_and_builds(self):
        script = commands('vendor-admin')
        order = [script.index(command) for command in ('npx nuxt prepare', 'npm run lint', 'npm run test', 'npm run build')]
        self.assertEqual(order, sorted(order))
        self.assertIn('cd apps/vendor-admin', script)

    def test_every_script_is_executable_bash_and_run_by_the_workflow(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        scripts = sorted((ROOT / 'deploy/ci').glob('*.sh'))
        self.assertEqual(len(scripts), 12)
        for script in scripts:
            with self.subTest(script=script.name):
                self.assertTrue(os.access(script, os.X_OK))
                self.assertTrue(script.read_text().startswith('#!/usr/bin/env bash\n'))
                self.assertIn('\nset -euo pipefail\n', script.read_text())
                self.assertIn('deploy/ci/' + script.name, workflow)


if __name__ == '__main__':
    unittest.main()
