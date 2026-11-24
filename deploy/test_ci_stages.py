# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Execute the CI stage scripts against controlled process boundaries."""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def load_release_manifest():
    """deploy/ci/lib/release_manifest.py, the writer and the one reader of the release document."""
    spec = importlib.util.spec_from_file_location('release_manifest', ROOT / 'deploy/ci/lib/release_manifest.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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
        shutil.copy(ROOT / 'deploy/image_pins.py', self.root / 'deploy/image_pins.py')
        shutil.copy(ROOT / 'deploy/production-images.json', self.root / 'deploy/production-images.json')
        (self.root / 'deploy/odoo').mkdir()
        (self.root / 'deploy/shared').mkdir()
        (self.root / 'deploy/stack').mkdir()
        # A placeholder with no default and one with a default, so the proxy environment is built from the local file.
        (self.root / 'deploy/stack/Caddyfile').write_text('{$DOMAIN} {\n\tbind {$LIWAN_TRUSTED_PROXIES:192.0.2.1/32}\n}\n')
        (self.root / 'deploy/environments').mkdir()
        shutil.copy(ROOT / 'deploy/environments/local.env.example', self.root / 'deploy/environments/local.env.example')
        (self.root / 'deploy/odoo/ODOO_COMMIT').write_text('a' * 40)
        self.fake('odoo-python', '''
log = next((a.split('=',1)[1] for a in args if a.startswith('--logfile=')), None)
if log: Path(log).write_text('odoo.tests.result: 0 failed, 0 error(s) of 12 tests when loading database\\n')
if 'shell' in args: print('ROUTE_PROBE_OK')
''')
        self.fake('python3', '''
if args[0] == '-': os.execv(sys.executable, [sys.executable, *args])
if 'tools/catalog_check.py' in args: print('liwan_tasks')
if 'tools/oca_addons.py' in args: print('/oca/repo')
if 'tools/app_isolation.py' in args and 'install' in args:
 print({'liwan_tasks_pmo': 'liwan_pmo,liwan_tasks', 'liwan_api_account': 'account,liwan_api',
        'liwan_products_account': 'account,liwan_products'}.get(args[-1], args[-1]))
if 'tools/app_isolation.py' in args and 'tags' in args: print('/' + args[-1])
if 'tools/app_isolation.py' in args and 'foundation' in args: print('liwan_api')
if 'tools/app_isolation.py' in args and 'rank' in args:
 if args[-1] == 'account': sys.exit(1)  # The stock side of liwan_api_account has no LiwanOS rank.
 print({'liwan_api': 2, 'liwan_products': 3}.get(args[-1], 4))
if 'tools/contract_fixtures.py' in args and '--addons' in args: print('liwan_tasks,liwan_pmo')
if 'deploy/image_pins.py' in args: os.execv(sys.executable, [sys.executable, *args])
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
if args[:1] == ['exec'] and 'wget' in joined: print('wget: server returned error: HTTP/1.1 502 Bad Gateway')  # the proxy answers; its upstreams are absent
if args[:2] == ['image', 'inspect']: print('not published' if 'RepoDigests' in joined else 'sha256:' + args[-1])
root = Path(os.environ['DOCKER_CONFIG']).parent
state = root / 'trivy-state'
if args[:1] == ['save']: Path(args[args.index('-o') + 1]).write_text(args[-1])
if args[:1] == ['create'] and any(a.startswith('aquasec/trivy:') for a in args): state.write_text(json.dumps(args))
if args[:1] == ['cp'] and args[2].startswith('liwan-ci-123-trivy:'): (root / 'trivy-tag').write_text(Path(args[1]).read_text())
if args[:1] == ['start'] and args[-1] == 'liwan-ci-123-trivy':
    # TRIVY_FAKE maps an image tag to {"exit": code, "report": trivy json, "sbom_exit": code}; an unlisted image is clean.
    tag = (root / 'trivy-tag').read_text()
    created = json.loads(state.read_text())
    with open(root / 'calls.jsonl', 'a') as out: out.write(json.dumps(['trivy-run', tag, *created]) + '\\n')
    plan = json.loads(os.environ.get('TRIVY_FAKE', '{}')).get(tag, {})
    if 'cyclonedx' in created:
        print(json.dumps({'bomFormat': 'CycloneDX', 'component': tag}))
        sys.exit(plan.get('sbom_exit', 0))
    print(json.dumps(plan.get('report', {'Results': []})))
    sys.exit(plan.get('exit', 0))
''')
        self.fake('psql', '''
if 'liwan_tasks_pmo' in ' '.join(args) and "SELECT state" in ' '.join(args): print('installed')
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
        if name == 'odoo-python':
            # `-m unittest` is a unit run of the stage, not an Odoo run: the launcher test (deploy/security) records the checkout it is given; all pass.
            body = ("if 'unittest' in args:\n if 'deploy/security' in args: Path(%r).write_text(os.environ.get('LIWAN_ODOO_ROOT', ''))\n sys.exit(0)\n"
                    % str(self.root / 'launcher-root')) + body
        file.write_text(f'#!{sys.executable}\nimport os,sys,json\nfrom pathlib import Path\n'
                        f'args=sys.argv[1:]\nwith open({str(self.calls)!r}, "a") as out: '
                        f'out.write(json.dumps([{name!r}, *args])+"\\n")\n' + body)
        file.chmod(0o755)

    def execute(self, stage, *args):
        return subprocess.run(['bash', str(self.root / 'deploy/ci' / (stage + '.sh')), *args], cwd=self.root,
                              env=self.environment, capture_output=True, text=True, check=False)

    def test_odoo_steps_execute_against_the_isolated_connection_and_pinned_source(self):
        for name, args, wanted_modules, wanted_port in (('odoo', (), 'liwan_tasks', '52101'),
                                                        ('odoo-app-standalone', ('liwan_tasks',), 'liwan_tasks', '52102'),
                                                        ('odoo-bridge', ('liwan_tasks_pmo',), 'liwan_pmo,liwan_tasks', '52102')):
            with self.subTest(stage=name):
                self.calls.write_text('')
                process = self.execute(name, *args)
                self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
                calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
                odoo = next(x for x in calls if x[0] == 'odoo-python' and 'shell' not in x and 'unittest' not in x)
                self.assertIn('--db_port=55432', odoo)
                self.assertIn('--db_host=127.0.0.1', odoo)
                self.assertIn('--http-port=' + wanted_port, odoo)
                self.assertEqual(odoo[odoo.index('-i') + 1], wanted_modules)
                # Committed Odoo concurrency fixtures require this safe prefix.
                self.assertTrue(odoo[odoo.index('-d') + 1].startswith('liwan_scratch_'))
                self.assertEqual(odoo[1], str(self.odoo / 'odoo-bin'))
                probes = [x for x in calls if x[0] == 'odoo-python' and 'shell' in x]
                self.assertEqual(len(probes), {'odoo': 0, 'odoo-app-standalone': 1, 'odoo-bridge': 3}[name])
                for drop in (x for x in calls if x[0] == 'dropdb'):
                    self.assertEqual(drop[drop.index('-p') + 1], '55432')

    def test_a_bridge_with_one_stock_side_installs_and_checks_it_without_a_probe_of_its_own(self):
        self.calls.write_text('')
        process = self.execute('odoo-bridge', 'liwan_api_account')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        odoo = next(x for x in calls if x[0] == 'odoo-python' and 'shell' not in x and 'unittest' not in x)
        self.assertEqual(odoo[odoo.index('-i') + 1], 'account,liwan_api')
        # `rank` fails for the stock side, so it is installed and then left alone: there is no feature to switch
        # off. liwan_api is the foundation (rank 2) and owns no entitlement either, so the run keeps one probe.
        self.assertIn('account is a stock Odoo module: no rank and no LiwanOS entitlement', process.stdout)
        self.assertIn('liwan_api is not a rank-4 application and owns no entitlement of its own', process.stdout)
        self.assertEqual(len([x for x in calls if x[0] == 'odoo-python' and 'shell' in x]), 1)

    def test_a_bridge_of_a_shared_service_and_a_stock_side_need_not_answer(self):
        self.calls.write_text('')
        process = self.execute('odoo-bridge', 'liwan_products_account')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        # liwan_products gates its routes on keys the applications register, and no application is installed here:
        # the one probe only requires that the service and the bridge do not fail.
        self.assertIn('liwan_products_account: no application side', process.stdout)
        self.assertNotIn('with both sides on', process.stdout)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        self.assertEqual(len([x for x in calls if x[0] == 'odoo-python' and 'shell' in x]), 1)

    def test_missing_odoo_test_verdict_is_a_failed_stage(self):
        self.fake('odoo-python', "log=next(a.split('=',1)[1] for a in args if a.startswith('--logfile=')); Path(log).touch()\n")
        process = self.execute('odoo')
        self.assertNotEqual(process.returncode, 0)

    def test_contract_fixtures_run_the_fixture_addons_alone_then_compare_what_they_recorded(self):
        self.fake('odoo-python', """
log = next(a.split('=',1)[1] for a in args if a.startswith('--logfile='))
Path(log).write_text('odoo.tests.result: 0 failed, 0 error(s) of 12 tests when loading database\\n')
Path(os.environ['LIWAN_CONTRACT_FIXTURES'], 'recorded.json').write_text('{}')
""")
        process = self.execute('contract-fixtures')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        odoo = next(x for x in calls if x[0] == 'odoo-python')
        self.assertEqual(odoo[odoo.index('-i') + 1], 'liwan_tasks')
        self.assertEqual(odoo[odoo.index('--test-tags') + 1], '/liwan_tasks,/liwan_pmo')
        compare = next(x for x in calls if x[0] == 'python3' and '--compare' in x)
        self.assertTrue(compare[compare.index('--compare') + 1].endswith('/fixtures'))
        self.assertTrue(odoo[odoo.index('-d') + 1].startswith('liwan_scratch_'))

    def test_contract_fixtures_fail_without_a_green_odoo_verdict_and_never_compare(self):
        for log in ('', "Path(log).write_text('odoo.tests.result: 0 failed, 0 error(s) of 0 tests when loading database\\n')\n"):
            with self.subTest(log=log):
                self.fake('odoo-python', "log=next(a.split('=',1)[1] for a in args if a.startswith('--logfile=')); Path(log).touch()\n" + log)
                self.calls.write_text('')
                process = self.execute('contract-fixtures')
                self.assertNotEqual(process.returncode, 0)
                self.assertNotIn('--compare', self.calls.read_text())

    def test_contract_fixtures_fail_when_the_comparison_fails(self):
        self.fake('python3', "if '--compare' in args: sys.exit(1)\nif 'tools/contract_fixtures.py' in args: print('liwan_tasks')\n"
                  "if 'tools/catalog_check.py' in args: print('liwan_tasks')\nif 'tools/oca_addons.py' in args: print('/oca/repo')\n"
                  "if 'deploy/classification.py' in args:\n output=Path(args[args.index('--output')+1]); output.write_text('{}')\n")
        self.assertNotEqual(self.execute('contract-fixtures').returncode, 0)
        self.assertIn('--compare', self.calls.read_text())

    def test_odoo_nonzero_exit_fails_even_with_a_green_verdict_line(self):
        self.fake('odoo-python', """
log = next(a.split('=',1)[1] for a in args if a.startswith('--logfile='))
Path(log).write_text('odoo.tests.result: 0 failed, 0 error(s) of 12 tests when loading database\\n')
sys.exit(3)
""")
        process = self.execute('odoo')
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('odoo exited 3', process.stderr)

    def test_upgrade_without_baseline_fails_before_any_odoo_run(self):
        process = self.execute('upgrade')
        self.assertNotEqual(process.returncode, 0, process.stdout + process.stderr)
        self.assertIn('no LiwanOS-namespace release baseline: the upgrade gate cannot run', process.stderr)
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
if 'tools/catalog_check.py' in args: print('liwan_tasks')
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
        self.fake('pip-audit', '')
        (self.root / 'apps/ai-service/pip-audit-ignore.txt').write_text('# no exceptions\n')
        self.fake('python3', "if args[0] == '-': os.execv(sys.executable, [sys.executable, *args])\nif '-m' in args: sys.exit(42)  # Host Python may be older than the service requires.\n")
        self.fake('odoo-python', '''
if args[:2] == ['-m','venv']:
 directory=Path(args[2])/'bin'; directory.mkdir(parents=True)
 for name in ('pip','ruff','pytest','pip-audit'): (directory/name).symlink_to(Path(sys.argv[0]).parent/name)
''')
        process = self.execute('ai-service')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        self.assertEqual((self.root / 'apps/ai-service/observed-url').read_text(),
                         'postgresql://odoo:scratch@127.0.0.1:55432/liwan_ai_ci_123')

    def prepare_ai_audit(self, ignore_text):
        (self.root / 'apps/ai-service').mkdir(parents=True)
        (self.root / 'apps/ai-service/pip-audit-ignore.txt').write_text(ignore_text)
        self.fake('pip-audit', '')
        self.fake('pip', '')
        self.fake('odoo-python', '''
if args[:2] == ['-m','venv']:
 directory=Path(args[2])/'bin'; directory.mkdir(parents=True)
 for name in ('pip','pip-audit'): (directory/name).symlink_to(Path(sys.argv[0]).parent/name)
''')
        self.environment['AUDIT_PYTHON'] = str(self.bin / 'odoo-python')

    def test_the_ai_audit_installs_pip_audit_from_the_hash_lock_and_audits_the_pinned_set(self):
        self.prepare_ai_audit('# no exceptions\n')
        process = subprocess.run(['bash', str(self.root / 'deploy/ci/lib/ai-service-audit.sh')], cwd=self.root,
                                 env=self.environment, capture_output=True, text=True, check=False)
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        install = next(x for x in calls if x[0] == 'pip')
        self.assertIn('--require-hashes', install)
        self.assertIn('requirements-audit.txt', install)
        audit = next(x for x in calls if x[0] == 'pip-audit')
        self.assertEqual(audit[1:], ['--require-hashes', '--disable-pip', '--progress-spinner', 'off', '-r', 'requirements-dev.txt'])

    def test_the_ai_audit_tolerates_only_an_advisory_listed_with_a_reason(self):
        self.prepare_ai_audit('# note\nPYSEC-2099-1 accepted until the 2026-12 upgrade, reviewed 2026-11-10\n')
        process = subprocess.run(['bash', str(self.root / 'deploy/ci/lib/ai-service-audit.sh')], cwd=self.root,
                                 env=self.environment, capture_output=True, text=True, check=False)
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        audit = next(json.loads(line) for line in self.calls.read_text().splitlines() if json.loads(line)[0] == 'pip-audit')
        self.assertEqual(audit[audit.index('--ignore-vuln') + 1], 'PYSEC-2099-1')

    def test_the_ai_audit_rejects_an_ignored_advisory_without_a_reason(self):
        self.prepare_ai_audit('PYSEC-2099-1\n')
        process = subprocess.run(['bash', str(self.root / 'deploy/ci/lib/ai-service-audit.sh')], cwd=self.root,
                                 env=self.environment, capture_output=True, text=True, check=False)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("'PYSEC-2099-1' has no reason", process.stderr)
        self.assertNotIn('pip-audit', [json.loads(line)[0] for line in self.calls.read_text().splitlines()])

    def test_the_odoo_stage_runs_the_launcher_test_once_with_its_odoo_checkout(self):
        for shard, expected in ((None, True), ('1/3', True), ('2/3', False), ('3/3', False)):
            with self.subTest(shard=shard):
                marker = self.root / 'launcher-root'
                if marker.exists():
                    marker.unlink()
                self.calls.write_text('')
                process = self.execute('odoo', *(('--shard', shard) if shard else ()))
                self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
                unit_runs = [json.loads(line) for line in self.calls.read_text().splitlines()
                             if json.loads(line)[0] == 'odoo-python' and 'unittest' in json.loads(line)]
                # The stage's other unittest run is the real-Odoo cases of the shared database selection; the launcher test
                # is the discover run of deploy/security and must still run exactly once.
                launcher = [run for run in unit_runs if 'deploy/security' in run]
                database_selection = [run for run in unit_runs if 'deploy/shared/test_dbselect.py' in run]
                self.assertEqual(len(database_selection), 1 if expected else 0)
                self.assertEqual(len(unit_runs), len(launcher) + len(database_selection))
                self.assertEqual(len(launcher), 1 if expected else 0)
                if expected:
                    self.assertEqual(launcher[0][launcher[0].index('-s') + 1], 'deploy/security')
                    self.assertEqual(launcher[0][launcher[0].index('-p') + 1], 'test_odoo_secure.py')
                    self.assertEqual(marker.read_text(), str(self.odoo))

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
if 'tools/catalog_check.py' in args: print('liwan_tasks')
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
        self.assertEqual(build[build.index('-t') + 1], 'liwan-odoo:ci-123')
        self.assertIn('LIWAN_REVISION=' + 'b' * 12, build)
        runs = [x for x in calls if x[:2] == ['docker', 'run']]
        install = next(x for x in runs if x[x.index('--name') + 1] == 'liwan-ci-123-image')
        check = next(x for x in runs if x[x.index('--name') + 1] == 'liwan-ci-123-check')
        self.assertEqual(install[install.index('--network') + 1], 'host')
        self.assertIn('--entrypoint', check)
        self.assertNotIn('-v', install)  # no job path is bind-mounted: the daemon may be on another host
        self.assertIn('liwan-odoo-files:ci-123', install)
        self.assertIn(['docker', 'rmi', '-f', 'liwan-odoo:ci-123'], calls)

    def test_image_gate_builds_smokes_cleans_and_records_every_production_image(self):
        process = self.execute('image')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        builds = {x[x.index('-t') + 1]: x for x in calls if x[:2] == ['docker', 'build'] and x[x.index('-f') + 1] != '-'}
        contexts = {'web': '.', 'control-plane': '.', 'vendor-admin': '.', 'ai-service': 'apps/ai-service', 'proxy': '.', 'guard': '.',
                    'ai-egress': 'deploy/ai-egress', 'odoo-mail': 'deploy/odoo-mail'}
        dockerfiles = {'web': 'apps/web/Dockerfile', 'control-plane': 'deploy/control-plane/Dockerfile', 'vendor-admin': 'apps/vendor-admin/Dockerfile',
                       'ai-service': 'apps/ai-service/Dockerfile', 'proxy': 'deploy/proxy/Dockerfile',
                       'guard': 'deploy/shared/Dockerfile', 'ai-egress': 'deploy/ai-egress/Dockerfile',
                       'odoo-mail': 'deploy/odoo-mail/Dockerfile'}
        self.assertEqual(set(builds), {'liwan-odoo:ci-123', *('liwan-%s:ci-123' % n for n in contexts)})
        for name, context in contexts.items():
            with self.subTest(image=name):
                tag = 'liwan-%s:ci-123' % name
                build = builds[tag]
                self.assertEqual(build[build.index('-f') + 1], dockerfiles[name])
                self.assertEqual(build[-1], context)
                self.assertIn(['docker', 'rmi', '-f', tag], calls)
                self.assertIn(['docker', 'image', 'inspect', '--format', '{{.Id}}', tag], calls)
                self.assertIn('| %s | sha256:%s | not published | %s.cdx.json |' % (tag, tag, tag.split(':')[0]), process.stdout)
                if name not in ('proxy', 'ai-egress', 'odoo-mail', 'control-plane'):  # checked without a long-running container
                    started = next(x for x in calls if x[:3] == ['docker', 'run', '-d']
                                   and x[x.index('--name') + 1] == 'liwan-ci-123-' + name)
                    # Containers that need config files run the image derived with them (a build, never a bind mount).
                    self.assertIn(tag.replace(':ci-', '-files:ci-') if name in ('web', 'guard', 'ai-service') else tag, started)
                    self.assertNotIn('-v', started)
                    self.assertIn(['docker', 'exec', 'liwan-ci-123-' + name, 'id', '-u'], calls)
                    self.assertIn(['docker', 'rm', '-fv', 'liwan-ci-123-' + name], calls)
        self.assertIn('| liwan-odoo:ci-123 | sha256:liwan-odoo:ci-123 | not published | liwan-odoo.cdx.json |', process.stdout)
        proxy = [x for x in calls if x[:2] == ['docker', 'run'] and 'liwan-proxy:ci-123' in x]
        validated = [x for x in calls if x[:2] == ['docker', 'run'] and 'liwan-proxy-files:ci-123' in x and 'validate' in x]
        self.assertEqual(len(validated), 1)
        self.assertIn('--env-file', validated[0])
        self.assertTrue(any('http.handlers.rate_limit' in ' '.join(x) for x in proxy))
        guard = next(x for x in calls if x[:3] == ['docker', 'run', '-d'] and 'liwan-ci-123-guard' in x)
        self.assertIn('LIWAN_TENANCY_MODE=shared', guard)
        # The published web image is the shared build, built and started in shared mode (its server refuses a mismatch).
        web = next(x for x in calls if x[:3] == ['docker', 'run', '-d'] and 'liwan-ci-123-web' in x)
        self.assertIn('LIWAN_TENANCY_MODE=shared', web)
        self.assertIn('LIWAN_TENANCY_MODE=shared', builds['liwan-web:ci-123'])

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
        self.assertIn('| liwan-guard:ci-123 |', summary.read_text())
        self.assertNotIn('| Image |', process.stdout)

    def trivy_report(self, severity, count=1):
        return {'Results': [{'Vulnerabilities': [
            {'VulnerabilityID': 'CVE-2099-%d' % n, 'PkgName': 'libfake', 'InstalledVersion': '1.0',
             'FixedVersion': '1.1', 'Severity': severity} for n in range(count)]}]}

    def all_trivy_runs(self):
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        return [x for x in calls if x[0] == 'trivy-run']

    def trivy_runs(self):
        return [x for x in self.all_trivy_runs() if 'cyclonedx' not in x]

    def sbom_runs(self):
        return [x for x in self.all_trivy_runs() if 'cyclonedx' in x]

    def test_image_gate_writes_a_cyclonedx_sbom_for_every_image(self):
        sbom_dir = self.root / 'sbom'
        self.environment['LIWAN_SBOM_DIR'] = str(sbom_dir)
        process = self.execute('image')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        names = ('liwan-odoo', 'liwan-control-plane', 'liwan-vendor-admin', 'liwan-web', 'liwan-proxy', 'liwan-guard', 'liwan-ai-service',
                 'liwan-ai-egress', 'liwan-odoo-mail')
        self.assertEqual([x[1] for x in self.sbom_runs()], ['%s:ci-123' % name for name in names])
        for name in names:
            document = json.loads((sbom_dir / (name + '.cdx.json')).read_text())
            self.assertEqual(document, {'bomFormat': 'CycloneDX', 'component': name + ':ci-123'})
        for run in self.sbom_runs():
            self.assertEqual(run[run.index('--format') + 1], 'cyclonedx')
            self.assertRegex(next(a for a in run if a.startswith('aquasec/trivy:')), r'^aquasec/trivy:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$')

    def test_image_gate_fails_when_an_sbom_cannot_be_produced(self):
        self.environment['TRIVY_FAKE'] = json.dumps({'liwan-guard:ci-123': {'sbom_exit': 1}})
        process = self.execute('image')
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('liwan-guard:ci-123 sbom failed', process.stderr)
        self.assertEqual(len(self.trivy_runs()), 9)

    def test_image_gate_scans_every_image_with_the_pinned_scanner_and_reports_counts(self):
        self.environment['TRIVY_FAKE'] = json.dumps({'liwan-web:ci-123': {'report': self.trivy_report('HIGH', 2)}})
        summary = self.root / 'summary.md'
        self.environment['GITHUB_STEP_SUMMARY'] = str(summary)
        process = self.execute('image')
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        runs = self.trivy_runs()
        tags = ['liwan-%s:ci-123' % n for n in ('odoo', 'control-plane', 'vendor-admin', 'web', 'proxy', 'guard', 'ai-service', 'ai-egress', 'odoo-mail')]
        self.assertEqual([x[1] for x in runs], tags)
        for run in runs:
            with self.subTest(image=run[1]):
                self.assertEqual(run[run.index('--name') + 1], 'liwan-ci-123-trivy')
                scanner = next(a for a in run if a.startswith('aquasec/trivy:'))
                self.assertRegex(scanner, r'^aquasec/trivy:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$')
                self.assertNotIn('/var/run/docker.sock:/var/run/docker.sock', run)
                self.assertEqual(run[run.index('--input') + 1], '/tmp/image.tar')
                self.assertEqual(run[run.index('--severity') + 1], 'HIGH,CRITICAL')
                self.assertIn('--ignore-unfixed', run)
                self.assertEqual(run[run.index('--exit-code') + 1], '0')
        self.assertIn(['docker', 'volume', 'rm', '-f', 'liwan-ci-123-trivy-cache'], [
            json.loads(line) for line in self.calls.read_text().splitlines()])
        text = summary.read_text()
        self.assertIn('| liwan-web:ci-123 | 0 | 2 |', text)
        self.assertIn('| liwan-guard:ci-123 | 0 | 0 |', text)
        self.assertIn('liwan-web:ci-123: HIGH CVE-2099-0 libfake 1.0 -> fixed in 1.1', process.stderr)

    def test_image_gate_fails_on_a_critical_finding_after_scanning_every_image(self):
        self.environment['TRIVY_FAKE'] = json.dumps({'liwan-web:ci-123': {'report': self.trivy_report('CRITICAL')}})
        process = self.execute('image')
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('liwan-web:ci-123 has 1 CRITICAL vulnerabilities with a fix available', process.stderr)
        self.assertIn('| liwan-web:ci-123 | 1 | 0 |', process.stdout)
        self.assertEqual(len(self.trivy_runs()), 9)

    def test_image_gate_fails_with_a_message_when_the_scanner_errors(self):
        self.environment['TRIVY_FAKE'] = json.dumps({'liwan-proxy:ci-123': {'exit': 1, 'report': {}}})
        process = self.execute('image')
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('liwan-proxy:ci-123 scan failed: trivy exited with an error', process.stderr)
        self.assertIn('| liwan-proxy:ci-123 | scan error | scan error |', process.stdout)
        self.assertEqual(len(self.trivy_runs()), 9)

    def test_image_gate_fails_when_the_scanner_report_is_unreadable(self):
        self.fake('docker', """
joined = ' '.join(args)
if args[:1] == ['inspect']: print('true')
if args[:1] == ['exec'] and joined.endswith('id -u'): print(10001)
if args[:1] == ['exec'] and 'unknown.invalid' in joined: print(403)
if args[:1] == ['exec'] and 'wget' in joined: print('HTTP/1.1 502 Bad Gateway')
if args[:2] == ['image', 'inspect']: print('sha256:' + args[-1])
if args[:1] == ['start'] and args[-1] == 'liwan-ci-123-trivy': print('not json')
""")
        process = self.execute('image')
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('scan failed: unreadable trivy report', process.stderr)


class TestE2EOdooStage(unittest.TestCase):
    """The real-Odoo stage's own wiring: the browser's host decides which socket carries the session."""

    def test_the_websocket_uses_the_host_the_specs_browse(self):
        script = commands('e2e-odoo')
        # An Odoo socket reaches the session cookie only on the host that set it; the specs browse localhost.
        self.assertIn('E2E_BASE_URL="http://localhost:$WEB_PORT"', script)
        self.assertIn('export NUXT_PUBLIC_WS_URL="ws://localhost:$ODOO_PORT/websocket"', script)
        self.assertNotIn('NUXT_PUBLIC_WS_URL="ws://127.0.0.1', script)

    def test_the_timeouts_cover_a_production_build_and_a_server_push(self):
        # The stage waits on the Nuxt build, then on two servers; a short bound would fail a slow runner.
        self.assertIn('timeout-minutes: 60', (ROOT / '.github/workflows/ci.yml').read_text())


class TestE2EMockStage(unittest.TestCase):
    def run_script(self, *args):
        return subprocess.run(['bash', str(ROOT / 'deploy/ci/e2e-mock.sh'), *args], cwd=ROOT, env={**os.environ, 'MOCK_PORT': ''},
                              capture_output=True, text=True, check=False)

    def test_a_malformed_shard_is_refused_before_anything_runs(self):
        for args in (('--shard', '0/3'), ('--shard', '4/3'), ('--shard', '2'), ('--shard', 'a/b'), ('--shard', '02/3'),
                     ('--shard', '1/3/3'), ('--other',)):
            with self.subTest(args=args):
                process = self.run_script(*args)
                self.assertEqual(process.returncode, 2, process.stderr)
                self.assertNotIn('MOCK_PORT', process.stderr)

    def test_a_shard_flag_without_a_value_fails_loudly(self):
        for args in (('--shard',), ('--shard', '')):
            with self.subTest(args=args):
                process = self.run_script(*args)
                self.assertNotEqual(process.returncode, 0)
                self.assertIn('usage: e2e-mock.sh --shard k/N', process.stderr)

    def test_a_valid_shard_passes_the_validation(self):
        process = self.run_script('--shard', '2/3')
        self.assertIn('MOCK_PORT', process.stderr)

    def test_the_main_specs_are_sharded_and_the_long_list_runs_in_the_last_shard_only(self):
        script = commands('e2e-mock')
        self.assertIn('npx playwright test ${SHARD:+--shard="$SHARD"} "${SPECS[@]}"', script)
        guard = 'if [ -n "$SHARD" ] && [ "${SHARD%/*}" != "${SHARD#*/}" ]; then'
        self.assertEqual(script.count(guard), 1)
        self.assertLess(script.index(guard), script.index('ci-mock-long-list-specs.txt'))
        self.assertGreater(script.index(guard), script.index('"${SPECS[@]}"'))
        self.assertLess(script.index('exit 0', script.index(guard)), script.index('ci-mock-long-list-specs.txt'))

    def test_the_tenant_isolation_checks_run_once_in_the_first_shard(self):
        script = commands('e2e-mock')
        self.assertIn('if [ -n "$SHARD" ] && [ "${SHARD%/*}" != 1 ]; then FIRST_SHARD=false; fi', script)
        # Once before a non-last shard exits, once after the long list of the unsharded (or one-shard) run.
        self.assertEqual(script.count('if [ "$FIRST_SHARD" = true ]; then tenancy_isolation; fi'), 2)
        self.assertIn('deploy/ci/lib/tenancy-isolation.sh', script)


class TestRtlStoriesStage(unittest.TestCase):
    def run_script(self, *args):
        return subprocess.run(['bash', str(ROOT / 'deploy/ci/rtl-stories.sh'), *args], cwd=ROOT,
                              capture_output=True, text=True, check=False)

    def test_a_malformed_shard_is_refused_before_anything_runs(self):
        for args in (('--shard', '0/4'), ('--shard', '5/4'), ('--shard', '2'), ('--shard', 'a/b'), ('--shard', '02/4'),
                     ('--shard', '1/4/4'), ('--other',)):
            with self.subTest(args=args):
                process = self.run_script(*args)
                self.assertEqual(process.returncode, 2, process.stderr)
                self.assertNotIn('npm', process.stderr)

    def test_a_shard_flag_without_a_value_fails_loudly(self):
        for args in (('--shard',), ('--shard', '')):
            with self.subTest(args=args):
                process = self.run_script(*args)
                self.assertNotEqual(process.returncode, 0)
                self.assertIn('usage: rtl-stories.sh --shard k/N', process.stderr)

    def test_the_shard_reaches_playwright_through_the_test_script(self):
        self.assertIn('npm run test:rtl ${SHARD:+-- --shard="$SHARD"}', commands('rtl-stories'))


class TestVendorAdminStage(unittest.TestCase):
    def test_vendor_admin_stage_prepares_lints_tests_and_builds(self):
        script = commands('vendor-admin')
        order = [script.index(command) for command in ('npx nuxt prepare', 'npm run lint', 'npm run test', 'npm run build')]
        self.assertEqual(order, sorted(order))
        self.assertIn('cd apps/vendor-admin', script)

    def test_every_script_is_executable_bash_and_run_by_the_workflow(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        scripts = sorted(path for path in (ROOT / 'deploy/ci').glob('*.sh') if path.name != 'publish.sh')
        self.assertEqual(len(scripts), 15)  # the thirteen stages, main-alert and the full-dispatch contract-fixtures job
        for script in scripts:
            with self.subTest(script=script.name):
                self.assertTrue(os.access(script, os.X_OK))
                self.assertTrue(script.read_text().startswith('#!/usr/bin/env bash\n'))
                self.assertIn('\nset -euo pipefail\n', script.read_text())
                self.assertIn('deploy/ci/' + script.name, workflow)


class TestPublishWorkflow(unittest.TestCase):
    """The publish workflow writes to the private registry with the workflow token: its trust boundary is fixed here."""
    path = ROOT / '.github/workflows/publish.yml'
    workflow = path.read_text()
    script = commands('publish')
    document = yaml.safe_load(workflow)
    jobs = document['jobs']
    pushing = ('build-arm64', 'release')

    def step(self, job, name):
        return next(step for step in self.jobs[job]['steps'] if step.get('name') == name)

    def function(self, name):
        return re.search(rf'(?ms)^{name}\(\) \{{\n(.*?)^\}}$', self.script).group(1)

    def run_script(self, *args, **env):
        base = {'PATH': os.environ['PATH'], 'GITHUB_SHA': 'c' * 40, 'GITHUB_RUN_ID': '1', 'GITHUB_REPOSITORY': 'tariiq222/liwan',
                'GITHUB_SERVER_URL': 'https://github.com'}
        return subprocess.run(['bash', str(ROOT / 'deploy/ci/publish.sh'), *args], capture_output=True, text=True,
                              check=False, cwd=ROOT, env={**base, **env})

    def test_no_other_delivery_system_is_left_in_the_publish_path(self):
        old_forge, old_host = 'forge' + 'jo', 'git.liwanos' + '.com'
        self.assertFalse((ROOT / ('.' + old_forge)).exists())
        self.assertFalse((ROOT / 'deploy/ci/publish-zone').exists())
        for path in ('.github/workflows/publish.yml', 'deploy/ci/publish.sh', 'deploy/ci/lib/release_manifest.py',
                     'deploy/production-images.json', 'deploy/image_pins.py', 'deploy/test_ci_stages.py',
                     'deploy/test_image_pins.py'):
            text = (ROOT / path).read_text().lower()
            with self.subTest(path=path):
                self.assertNotIn(old_forge, text)
                self.assertNotIn(old_host, text)

    def test_it_runs_only_for_release_tags(self):
        self.assertEqual(self.document[True], {'push': {'tags': ['release/**']}})
        for forbidden in ('pull_request', 'pull_request_target', 'workflow_run', 'workflow_dispatch', 'issue_comment',
                          'schedule'):
            self.assertNotIn(forbidden, self.workflow)
        self.assertEqual(self.jobs['plan']['if'], "github.repository == 'tariiq222/liwan'")
        for name, job in self.jobs.items():
            self.assertTrue(name == 'plan' or 'plan' in job['needs'], name)  # every job waits for the guarded one

    def test_runners_are_github_hosted_and_only_the_two_known_labels_exist(self):
        self.assertNotIn('self-hosted', self.workflow)
        self.assertEqual({job['runs-on'] for job in self.jobs.values()}, {'ubuntu-24.04', 'ubuntu-24.04-arm'})
        self.assertEqual([name for name, job in self.jobs.items() if job['runs-on'] == 'ubuntu-24.04-arm'], ['build-arm64'])

    def test_the_token_can_write_packages_only_in_the_jobs_that_push(self):
        self.assertEqual(self.document['permissions'], {'contents': 'read'})
        for name, job in self.jobs.items():
            with self.subTest(job=name):
                granted = job.get('permissions', self.document['permissions']).get('packages')
                self.assertEqual(granted == 'write', name in self.pushing)

    def test_the_only_build_job_is_the_arm64_one_and_no_amd64_is_built_or_required(self):
        self.assertEqual([name for name, job in self.jobs.items() if 'build' in name], ['build-arm64'])
        self.assertNotIn('amd64', self.workflow)
        self.assertNotIn('PUBLISH_PLATFORM', self.workflow)  # the platform is the script's own constant
        self.assertEqual(self.jobs['build-arm64']['runs-on'], 'ubuntu-24.04-arm')
        self.assertEqual(self.jobs['build-arm64']['if'], "needs.plan.outputs.state == 'build'")

    def test_the_release_job_runs_only_after_a_successful_arm64_build(self):
        release = self.jobs['release']
        self.assertEqual(release['needs'], ['plan', 'build-arm64'])
        self.assertIn("needs.plan.outputs.state == 'build'", release['if'])
        self.assertIn("needs.build-arm64.result == 'success'", release['if'])
        self.assertNotIn('skipped', release['if'])  # a skipped build can never let the document be written
        self.assertIn('-t "$anchor:$GITHUB_SHA"', self.function('merge'))  # the document is replaced under the same tag

    def test_only_a_release_tag_calls_a_hook_and_it_is_the_staging_one(self):
        staging = self.jobs['notify-staging']
        self.assertNotIn('refs/heads', staging['if'])
        self.assertEqual(sorted(set(re.findall(r'secrets\.(\w+)', str(staging)))),
                         ['LIWAN_STAGING_HOOK_TOKEN', 'LIWAN_STAGING_HOOK_URL'])
        self.assertEqual(staging['needs'], ['plan', 'release'])
        run = staging['steps'][0]['run']
        self.assertIn('curl -fsS -X POST -H "Authorization: Bearer $HOOK_TOKEN" "$HOOK_URL"', run)
        self.assertNotIn('--data', run)
        self.assertNotIn('-d ', run)
        self.assertIn('exit 1', run)
        self.assertNotIn('echo "$HOOK', run)

    def test_no_job_or_step_refers_to_a_development_hook_and_every_need_exists(self):
        self.assertFalse([name for name in self.jobs if 'development' in name])
        self.assertNotRegex(self.workflow, r'(?i)development')
        for name, job in self.jobs.items():
            needs = job.get('needs', [])
            for need in [needs] if isinstance(needs, str) else needs:
                with self.subTest(job=name, need=need):
                    self.assertIn(need, self.jobs)

    def test_no_production_secret_hook_or_target_exists(self):
        for text in (self.workflow, self.script):
            self.assertNotIn('PRODUCTION', text)
            self.assertNotRegex(text, r'(?i)production.{0,20}hook|hook.{0,20}production')
        self.assertEqual(sorted(set(re.findall(r'secrets\.(\w+)', self.workflow))),
                         ['GITHUB_TOKEN', 'LIWAN_STAGING_HOOK_TOKEN', 'LIWAN_STAGING_HOOK_URL'])

    def test_a_secret_is_mapped_through_env_never_expanded_in_a_script_or_a_url(self):
        for name, job in self.jobs.items():
            for step in job['steps']:
                with self.subTest(job=name, step=step.get('name')):
                    self.assertNotIn('secrets.', step.get('run', ''))
        self.assertNotRegex(self.workflow, r'https://[^\s/]*\$\{\{|://[^/\s]*:[^/\s]*@')
        login = self.function('login')
        self.assertIn('--password-stdin', login)
        self.assertNotIn('--password ', self.script + self.workflow)

    def test_every_action_is_a_first_party_one_pinned_by_commit(self):
        uses = re.findall(r'(?m)^\s*(?:-\s*)?uses:\s*(\S+)', self.workflow)
        self.assertTrue(uses)
        for action in uses:
            self.assertRegex(action, r'^actions/[a-z-]+@[0-9a-f]{40}$')

    def test_runs_queue_per_commit_and_nothing_is_superseded(self):
        self.assertEqual(self.document['concurrency'], {'group': 'publish-${{ github.sha }}', 'cancel-in-progress': False})
        for gone in ('superseded', 'is_main', 'remote_head', 'ls-remote'):
            self.assertNotIn(gone, self.script)

    def test_a_tag_is_refused_unless_its_commit_is_in_main_and_it_is_a_release_tag(self):
        check = self.function('check')
        self.assertIn('require_in_main', check)
        self.assertIn('git merge-base --is-ancestor "$GITHUB_SHA" origin/main', self.function('require_in_main'))
        self.assertEqual(self.jobs['plan']['steps'][0]['with']['fetch-depth'], 0)
        for ref in ('refs/heads/main', 'refs/heads/feature', 'refs/tags/v1', 'refs/tags/release/19.0.1', 'refs/tags/release/19.0.1.2.x'):
            with self.subTest(ref=ref):
                process = self.run_script('check', GITHUB_REF=ref)
                self.assertEqual(process.returncode, 1)
                self.assertIn('release/19.0.X.Y.Z tags only', process.stderr)

    def test_every_command_that_touches_images_refuses_a_branch_ref(self):
        for command in ('check', 'build', 'push', 'merge'):
            with self.subTest(command=command):
                process = self.run_script(command, GITHUB_REF='refs/heads/main')
                self.assertEqual(process.returncode, 1)
                self.assertIn('release/19.0.X.Y.Z tags only', process.stderr)

    def test_the_hook_waits_for_a_finished_release_or_an_already_complete_one(self):
        condition = self.jobs['notify-staging']['if']
        self.assertIn("needs.plan.outputs.state == 'published'", condition)
        self.assertIn("needs.release.result == 'success'", condition)
        for name in ('build-arm64', 'release'):
            self.assertIn("needs.plan.outputs.state == 'build'", self.jobs[name]['if'])
        self.assertIn('state published', self.function('check'))

    def test_nothing_reaches_the_registry_before_the_scan(self):
        build = self.function('build')
        self.assertIn('--load -t "$(arch_tag "$image")"', build)
        self.assertIn('LIWAN_IMAGE_PREBUILT=1 deploy/ci/image.sh', build)
        for forbidden in ('docker build ', 'push', 'imagetools create'):
            self.assertNotIn(forbidden, build)
        push = self.function('push')
        self.assertIn('docker push --quiet "$tag"', push)
        self.assertNotIn('image.sh', push)
        steps = [step.get('name') for step in self.jobs['build-arm64']['steps']]
        self.assertLess(steps.index('Build and scan the images'), steps.index('Push the images'))

    def test_the_pushed_tag_is_checked_against_the_pushed_digest_not_trusted(self):
        push = self.function('push')
        self.assertIn('digest="$(manifest_digest "$tag")"', push)
        self.assertIn('holds $digest, not the image this run pushed', push)
        self.assertIn('--platforms "$work/platforms.json"', self.function('merge'))

    def test_the_release_document_is_a_scratch_image_with_exactly_one_file(self):
        merge = self.function('merge')
        self.assertIn("printf 'FROM scratch\\nCOPY release.json /release.json\\n'", merge)
        self.assertIn('anchor="$(registry)/liwan-release"', merge)
        self.assertIn('--platform "$PLATFORM" --provenance=false --push -t "$anchor:$GITHUB_SHA"', merge)
        self.assertEqual(re.findall(r'(?m)^PLATFORM="([^"]+)"$', self.script), ['linux/arm64'])

    def test_builds_are_native_never_emulated(self):
        for forbidden in ('qemu', 'binfmt'):
            self.assertNotIn(forbidden, self.workflow.lower())
            self.assertNotIn(forbidden, self.script.lower())
        self.assertIn('--platform "$PLATFORM"', self.function('build'))
        self.assertRegex(self.script, r'BUILDKIT_IMAGE="moby/buildkit:v0\.18\.2@sha256:[0-9a-f]{64}"')

    def test_the_script_is_bash_and_prints_its_plan_without_touching_docker(self):
        self.assertTrue(os.access(ROOT / 'deploy/ci/publish.sh', os.X_OK))
        self.assertTrue(self.script.startswith('#!/usr/bin/env bash\n'))
        self.assertIn('\nset -euo pipefail\n', self.script)
        plan = subprocess.run(['bash', str(ROOT / 'deploy/ci/publish.sh'), 'plan'], capture_output=True, text=True,
                              check=True, cwd=ROOT)
        self.assertIn('registry: ghcr.io/tariiq222', plan.stdout)
        self.assertIn('image: ghcr.io/tariiq222/liwan-odoo (docker build -f deploy/odoo/Dockerfile .', plan.stdout)
        # The control plane and the vendor console run in the production stack, so they are published too.
        self.assertIn('image: ghcr.io/tariiq222/liwan-control-plane (docker build -f deploy/control-plane/Dockerfile .', plan.stdout)
        self.assertIn('image: ghcr.io/tariiq222/liwan-vendor-admin (docker build -f apps/vendor-admin/Dockerfile .', plan.stdout)
        for argv in (['nope'], ['promote']):
            usage = subprocess.run(['bash', str(ROOT / 'deploy/ci/publish.sh'), *argv], capture_output=True, text=True,
                                   check=False, cwd=ROOT)
            self.assertEqual(usage.returncode, 2)


class TestPublishScriptExecution(unittest.TestCase):
    """Runs publish.sh check, push and merge against a stub docker and curl and a local git repository standing in for GitHub."""
    tag = 'refs/tags/release/19.0.1.0.0'
    docker_stub = r"""#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
case "$1 $2 $3" in
  "buildx imagetools inspect")
    ref="$4"
    if [[ "$ref" == *liwan-release:* ]]; then
      case "${STUB_ANCHOR:-missing}" in
        missing) echo "ERROR: $ref: not found" >&2; exit 1 ;;
        unknown) echo "ERROR: $ref: manifest unknown" >&2; exit 1 ;;
        denied) echo "ERROR: denied: permission_denied" >&2; exit 1 ;;
        *) echo '{}'; exit 0 ;;
      esac
    fi
    echo "{\"digest\":\"sha256:$(printf '%s' "$ref" | shasum -a 256 | cut -d' ' -f1)\"}"; exit 0 ;;
  "create "*)
    # A local store: an image already in it is not refreshed by a buildx --push, only by a forced pull.
    registry="$STUB_DOCDIR"
    [ -f "$STUB_OUT/release.json" ] && registry="${STUB_AFTER_WRITE_DOCDIR:-$STUB_OUT}"
    if [[ " $* " == *" --pull always "* ]] || [ ! -f "$STUB_LOCAL/release.json" ]; then cp "$registry/release.json" "$STUB_LOCAL/release.json"; fi
    echo cid-1; exit 0 ;;
  "cp "*) tar -cf - -C "$STUB_LOCAL" release.json; exit 0 ;;
  "buildx build"*)
    for arg in "$@"; do [ "${prev:-}" = --metadata-file ] && echo '{"containerimage.digest":"sha256:'$(printf '0%.0s' $(seq 64))'"}' > "$arg"; prev="$arg"; last="$arg"; done
    cp "$last/release.json" "$STUB_OUT/release.json"; exit 0 ;;
esac
exit 0
"""
    curl_stub = r"""#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
for arg in "$@"; do url="$arg"; done
name="${url##*/}"
mode="${STUB_VISIBILITY:-private}"
[ "$name" = "${STUB_ONLY_PACKAGE:-$name}" ] || mode=private
case "$mode" in
  private|public|internal) echo "{\"visibility\":\"$mode\"}" ;;
  empty) echo '{}' ;;
  *) exit 22 ;;
esac
"""

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.root, cls.bin, cls.out, cls.log = root, root / 'bin', root / 'out', root / 'log'
        cls.bin.mkdir()
        cls.out.mkdir()
        for name, body in (('docker', cls.docker_stub), ('curl', cls.curl_stub)):
            (cls.bin / name).write_text(body)
            (cls.bin / name).chmod(0o755)
        server = root / 'gh/o/r.git'
        env = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t'}
        subprocess.run(['git', 'init', '--bare', '--quiet', str(server)], check=True)
        git = lambda *args, **kw: subprocess.run(['git', '-C', str(server), *args], check=True, capture_output=True, text=True, env=env, **kw).stdout.strip()  # noqa: E731
        tree = git('hash-object', '-t', 'tree', '-w', '--stdin', input='')
        cls.main_sha = git('commit-tree', tree, '-m', 'main')
        cls.other_sha = git('commit-tree', tree, '-m', 'not in main')
        git('update-ref', 'refs/heads/main', cls.main_sha)
        git('update-ref', 'refs/remotes/origin/main', cls.main_sha)
        cls.server = server
        cls.builds = [line.split('\t') for line in subprocess.run(
            [sys.executable, '-B', 'deploy/image_pins.py', '--print-builds'], capture_output=True, text=True, check=True,
            cwd=ROOT).stdout.splitlines() if not line.startswith('-')]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def document(self, name, platforms):
        """/release.json of the main commit covering `platforms`, written to a folder named `name`."""
        folder = self.root / name
        folder.mkdir(exist_ok=True)
        images, covered = {}, {}
        for number, (image, reference, *_) in enumerate(self.builds):
            amd, arm = ('sha256:' + format(number + 1, 'x') * 64, 'sha256:' + format(number + 1, 'x')[::-1] * 32 + 'b' * 32)
            covered[reference] = {platform: amd if platform.endswith('amd64') else arm for platform in platforms}
            images[reference] = f'{image}@{next(iter(covered[reference].values()))}'
        (folder / 'i.json').write_text(json.dumps(images))
        (folder / 'p.json').write_text(json.dumps(covered))
        process = subprocess.run([sys.executable, '-B', 'deploy/ci/lib/release_manifest.py', '--commit', self.main_sha,
                                  '--run-id', '1', '--images', str(folder / 'i.json'), '--platforms', str(folder / 'p.json')],
                                 capture_output=True, text=True, check=True, cwd=ROOT, env={**os.environ, 'PYTHONPATH': str(ROOT)})
        (folder / 'release.json').write_text(process.stdout)
        return folder, covered

    def run_publish(self, command, ref, anchor='missing', docs=None, sha=None, **env):
        for path in (self.out, ):
            for old in path.glob('*'):
                old.unlink()
        self.log.write_text('')
        (self.root / 'github_output').write_text('')
        shutil.rmtree(self.root / 'local', ignore_errors=True)
        (self.root / 'local').mkdir()
        completed = subprocess.run(
            ['bash', str(ROOT / 'deploy/ci/publish.sh'), command], capture_output=True, text=True, check=False, cwd=ROOT,
            env={'PATH': f'{self.bin}:{os.environ["PATH"]}', 'HOME': str(self.root), 'GIT_DIR': str(self.server),
                 'GITHUB_REF': ref, 'GITHUB_SHA': sha or self.main_sha, 'GITHUB_OUTPUT': str(self.root / 'github_output'),
                 'GITHUB_TOKEN': 'token-value', 'GITHUB_ACTOR': 'actor', 'GITHUB_REPOSITORY': 'o/r',
                 'GITHUB_SERVER_URL': f'file://{self.root}/gh', 'GITHUB_RUN_ID': '7', 'STUB_LOG': str(self.log),
                 'STUB_ANCHOR': anchor, 'STUB_LOCAL': str(self.root / 'local'), 'STUB_DOCDIR': str(docs or self.root), 'STUB_OUT': str(self.out), **env})
        self.assertNotIn('token-value', completed.stdout + completed.stderr + self.log.read_text())
        return completed

    def outputs(self):
        return dict(line.split('=', 1) for line in (self.root / 'github_output').read_text().splitlines())

    def calls(self):
        return self.log.read_text().splitlines()

    def written_document(self):
        return json.loads((self.out / 'release.json').read_text()) if (self.out / 'release.json').exists() else None

    def accepted(self, document, required=('linux/arm64',)):
        return load_release_manifest().parse_release_document(json.dumps(document), self.main_sha, required)

    def test_the_release_document_is_read_for_the_arm64_platform_it_was_built_for(self):
        folder, _ = self.document('arm64-carrier', ['linux/arm64'])
        self.run_publish('check', self.tag, anchor='present', docs=folder)
        creates = [call for call in self.calls() if call.startswith('docker create ')]
        self.assertTrue(creates)
        for call in creates:
            self.assertIn('--platform linux/arm64', call)

    def test_a_tag_without_a_document_is_built(self):
        self.assertEqual(self.run_publish('check', self.tag).returncode, 0)
        self.assertEqual(self.outputs(), {'state': 'build'})

    def test_a_branch_ref_is_refused_before_anything_is_read(self):
        process = self.run_publish('check', 'refs/heads/main')
        self.assertEqual(process.returncode, 1)
        self.assertIn('release/19.0.X.Y.Z tags only', process.stderr)
        self.assertEqual(self.outputs(), {})
        self.assertFalse(self.calls())

    def test_a_registry_answer_that_is_neither_found_nor_not_found_is_a_hard_failure(self):
        process = self.run_publish('check', self.tag, anchor='denied')
        self.assertEqual(process.returncode, 1)
        self.assertIn('cannot tell whether', process.stderr)
        self.assertEqual(self.outputs(), {})
        self.run_publish('check', self.tag, anchor='unknown')
        self.assertEqual(self.outputs()['state'], 'build')

    def test_a_tag_whose_document_covers_arm64_rebuilds_nothing(self):
        for name, platforms in (('arm-only', ['linux/arm64']), ('both', ['linux/amd64', 'linux/arm64'])):
            folder, _ = self.document(name, platforms)
            with self.subTest(document=name):
                self.run_publish('check', self.tag, anchor='present', docs=folder)
                self.assertEqual(self.outputs(), {'state': 'published'})
                self.run_publish('merge', self.tag, anchor='present', docs=folder)
                self.assertFalse([call for call in self.calls() if call.startswith(('docker buildx build', 'docker buildx imagetools create'))])
                self.assertIsNone(self.written_document())

    def test_a_tag_whose_document_lacks_arm64_is_built(self):
        folder, _ = self.document('amd64-only', ['linux/amd64'])
        self.run_publish('check', self.tag, anchor='present', docs=folder)
        self.assertEqual(self.outputs(), {'state': 'build'})

    def test_a_tag_whose_commit_is_not_in_main_is_refused(self):
        process = self.run_publish('check', self.tag, sha=self.other_sha)
        self.assertEqual(process.returncode, 1)
        self.assertIn('not in main', process.stderr)
        self.assertEqual(self.outputs(), {})

    def test_merge_reads_only_arm64_tags_and_writes_a_document_listing_exactly_arm64(self):
        process = self.run_publish('merge', self.tag)
        self.assertEqual(process.returncode, 0, process.stderr)
        tags = [call.split()[4] for call in self.calls() if call.startswith('docker buildx imagetools inspect') and 'liwan-release' not in call]
        self.assertEqual(len(tags), len(self.builds))
        self.assertTrue(all(tag.endswith(f'{self.main_sha}-arm64') for tag in tags), tags)
        written = self.written_document()
        for platforms in written['platforms'].values():
            self.assertEqual(sorted(platforms), ['linux/arm64'])
        carrier = [call for call in self.calls() if call.startswith('docker buildx build') and f'liwan-release:{self.main_sha}' in call]
        self.assertEqual(len(carrier), 1)
        self.assertIn('--platform linux/arm64 ', carrier[0])
        self.assertNotIn('amd64', ' '.join(self.calls()))

    def test_the_document_merge_writes_is_accepted_by_the_release_reader_for_arm64(self):
        self.assertEqual(self.run_publish('merge', self.tag).returncode, 0)
        document = self.written_document()
        self.assertEqual(self.accepted(document)['commit'], self.main_sha)

    def test_a_document_that_also_lists_amd64_is_still_accepted(self):
        folder, _ = self.document('both', ['linux/amd64', 'linux/arm64'])
        document = json.loads((folder / 'release.json').read_text())
        self.assertEqual(self.accepted(document)['commit'], self.main_sha)
        self.assertEqual(self.accepted(document, ('linux/amd64', 'linux/arm64'))['commit'], self.main_sha)

    def test_merge_replaces_an_amd64_only_document_of_the_commit_with_an_arm64_one(self):
        folder, _ = self.document('amd64-only', ['linux/amd64'])
        process = self.run_publish('merge', self.tag, anchor='present', docs=folder)
        self.assertEqual(process.returncode, 0, process.stderr)
        for platforms in self.written_document()['platforms'].values():
            self.assertEqual(sorted(platforms), ['linux/arm64'])

    def test_merge_refuses_a_registry_answer_it_cannot_read(self):
        process = self.run_publish('merge', self.tag, anchor='denied')
        self.assertEqual(process.returncode, 1)
        self.assertIsNone(self.written_document())

    def test_a_tag_form_other_than_the_release_command_accepts_is_refused(self):
        for tag in ('release/19.0.01.0.0', 'release/19.0.1.00.0', 'release/19.0.1.0.00', 'release/19.0.1.0', 'release/19.0.1.0.0.0',
                    'release/19.0.1.0.0x', 'release/19.0.1.0.١', 'release/18.0.1.0.0', 'release/19.0.-1.0.0'):
            with self.subTest(tag=tag):
                process = self.run_publish('check', f'refs/tags/{tag}')
                self.assertEqual(process.returncode, 1)
                self.assertIn('release/19.0.X.Y.Z tags only', process.stderr)
        for tag in ('release/19.0.0.0.0', 'release/19.0.10.20.30'):
            with self.subTest(tag=tag):
                self.assertEqual(self.run_publish('check', f'refs/tags/{tag}').returncode, 0)

    def test_push_does_nothing_when_the_document_already_covers_arm64(self):
        for name, platforms in (('arm-only', ['linux/arm64']), ('both', ['linux/amd64', 'linux/arm64'])):
            folder, _ = self.document(name, platforms)
            with self.subTest(document=name):
                process = self.run_publish('push', self.tag, anchor='present', docs=folder)
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertIn('already covers', process.stdout)
                self.assertFalse([call for call in self.calls() if call.startswith(('docker push', 'docker image inspect'))])

    def test_push_goes_on_when_the_document_lacks_arm64_or_does_not_exist(self):
        amd64_only, _ = self.document('amd64-only', ['linux/amd64'])
        for anchor, folder in (('present', amd64_only), ('missing', None)):
            with self.subTest(anchor=anchor):
                self.run_publish('push', self.tag, anchor=anchor, docs=folder)
                self.assertTrue([call for call in self.calls() if call.startswith('docker push')])

    def test_a_document_another_run_replaced_during_the_write_fails_loudly(self):
        older, _ = self.document('amd64-only', ['linux/amd64'])
        process = self.run_publish('merge', self.tag, STUB_AFTER_WRITE_DOCDIR=str(older))
        self.assertEqual(process.returncode, 1)
        self.assertIn('another run replaced the document', process.stderr)
        self.assertEqual(self.run_publish('merge', self.tag).returncode, 0)

    def test_every_package_is_checked_before_anything_is_pushed_and_only_private_passes(self):
        self.assertEqual(self.run_publish('check', self.tag).returncode, 0)
        asked = [call.split()[-1].rsplit('/', 1)[1] for call in self.calls() if call.startswith('curl')]
        self.assertEqual(sorted(asked), sorted({build[1] for build in self.builds} | {'liwan-release'}))
        self.assertTrue(all(call.split()[-1].startswith('https://api.github.com/users/tariiq222/packages/container/')
                            for call in self.calls() if call.startswith('curl')))
        for mode in ('public', 'internal', 'missing', 'forbidden', 'empty'):  # 404 and 403 and a network error exit non-zero
            for command in ('check', 'merge', 'push'):
                with self.subTest(mode=mode, command=command):
                    process = self.run_publish(command, self.tag, STUB_VISIBILITY=mode, STUB_ONLY_PACKAGE='liwan-release'
                                               if mode == 'empty' else 'liwan-odoo')
                    self.assertEqual(process.returncode, 1)
                    self.assertIn('is not confirmed private', process.stderr)
                    self.assertIn('create it as a private package', process.stderr)
                    self.assertFalse([call for call in self.calls()
                                      if call.startswith(('docker push', 'docker buildx build', 'docker buildx imagetools create'))])
        process = self.run_publish('check', self.tag, STUB_VISIBILITY='public', STUB_ONLY_PACKAGE='liwan-release')
        self.assertIn('package liwan-release of tariiq222', process.stderr)


class TestReleaseDocument(unittest.TestCase):
    """The document the workflow publishes must be a release manifest the release operator accepts."""
    commit = 'c' * 40
    registry = 'ghcr.io/tariiq222'

    @classmethod
    def setUpClass(cls):
        cls.module = load_release_manifest()

    def images(self):
        return {reference: f'{self.registry}/{reference}@sha256:{"a" * 64}'
                for reference in ('liwan-odoo', 'liwan-web', 'liwan-guard', 'liwan-ai-service', 'liwan-caddy')}

    def platforms(self, *names):
        return {reference: {name: 'sha256:' + ('a' if name.endswith('amd64') else 'b') * 64 for name in names or ('linux/amd64',)}
                for reference in self.images()}

    def document(self, images=None, platforms=None):
        return self.module.release_document(self.commit, '42', images or self.images(), platforms or self.platforms(),
                                            'a' * 40, {'liwan_core': '19.0.1.0.0', 'liwan_crm': '19.0.1.2.0'})

    def test_it_carries_the_commit_and_every_image_by_digest(self):
        document = self.document()
        self.assertEqual(document['release']['liwanCommit'], self.commit)
        self.assertEqual(document['commit'], self.commit)
        self.assertEqual(document['images'], self.images())
        self.assertEqual(document['platforms'], self.platforms())
        self.assertEqual(sorted(document['release']['images']), ['ai', 'guard', 'odoo', 'web'])
        self.assertEqual(document['release']['upgradeModules'], ['liwan_core', 'liwan_crm'])

    def test_it_is_conservative_and_names_the_run_not_a_human_review(self):
        release = self.document()['release']
        self.assertEqual(release['mode'], 'infrastructure_maintenance')
        self.assertEqual(release['compatibilityEvidence'], {'reviewer': 'unreviewed-ci', 'reference': 'run-42'})

    def test_an_image_without_a_digest_or_from_another_registry_is_refused(self):
        for image in (f'{self.registry}/liwan-odoo:latest', 'docker.io/acme/liwan-odoo@sha256:' + 'd' * 64,
                      'ghcr.io/other/liwan-odoo@sha256:' + 'd' * 64, f'{self.registry}/liwan-web@sha256:' + 'd' * 64):
            images = self.images()
            images['liwan-odoo'] = image
            with self.subTest(image=image), self.assertRaises(ValueError):
                self.document(images)

    def test_a_platform_map_that_does_not_match_the_images_is_refused(self):
        extra_arch = self.platforms()
        extra_arch['liwan-odoo']['linux/s390x'] = 'sha256:' + 'e' * 64
        uneven = self.platforms()
        uneven['liwan-odoo']['linux/arm64'] = 'sha256:' + 'b' * 64
        empty = self.platforms()
        empty['liwan-odoo'] = {}
        bad_digest = self.platforms()
        bad_digest['liwan-odoo']['linux/amd64'] = 'sha256:short'
        missing_image = self.platforms()
        del missing_image['liwan-web']
        for name, platforms in (('extra arch', extra_arch), ('uneven arches', uneven), ('empty', empty),
                                ('bad digest', bad_digest), ('missing image', missing_image)):
            with self.subTest(name), self.assertRaises(ValueError):
                self.document(platforms=platforms)

    def test_the_release_manifest_images_must_agree_with_the_documents_images(self):
        for key, image in (('odoo', f'{self.registry}/liwan-odoo@sha256:{"c" * 64}'),
                           ('odoo', 'docker.io/acme/liwan-odoo@sha256:' + 'a' * 64),
                           ('odoo', f'{self.registry}/liwan-web@sha256:{"a" * 64}'),
                           ('web', f'{self.registry}/liwan-odoo@sha256:{"a" * 64}')):
            document = self.document()
            document['release'] = {**document['release'], 'images': {**document['release']['images'], key: image}}
            with self.subTest(key=key, image=image), self.assertRaises(ValueError):
                self.module.validate_document(document, self.commit)

    def test_an_existing_document_is_read_back_as_its_platform_map(self):
        text = self.text(platforms=self.platforms('linux/amd64', 'linux/arm64'))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'release.json'
            path.write_text(text)
            process = subprocess.run([sys.executable, '-B', str(ROOT / 'deploy/ci/lib/release_manifest.py'), '--read',
                                      str(path), '--commit', self.commit], capture_output=True, text=True, check=False,
                                     cwd=ROOT, env={**os.environ, 'PYTHONPATH': str(ROOT)})
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual(json.loads(process.stdout), self.platforms('linux/amd64', 'linux/arm64'))
            other = subprocess.run([sys.executable, '-B', str(ROOT / 'deploy/ci/lib/release_manifest.py'), '--read',
                                    str(path), '--commit', 'e' * 40], capture_output=True, text=True, check=False,
                                   cwd=ROOT, env={**os.environ, 'PYTHONPATH': str(ROOT)})
            self.assertNotEqual(other.returncode, 0)

    def test_a_trailing_newline_does_not_pass_as_a_commit_or_a_digest(self):
        with self.assertRaises(ValueError):
            self.module.release_document(self.commit + '\n', '1', self.images(), self.platforms(), 'a' * 40, {'liwan_core': '19.0.1.0.0'})
        platforms = self.platforms()
        platforms['liwan-odoo']['linux/amd64'] = 'sha256:' + 'a' * 64 + '\n'
        with self.assertRaises(ValueError):
            self.document(platforms=platforms)
        with self.assertRaises(ValueError):
            self.module.parse_release_document(self.text(commit=self.commit + '\n'))

    def test_an_image_digest_that_is_none_of_its_platform_digests_is_refused(self):
        images = self.images()
        images['liwan-odoo'] = f'{self.registry}/liwan-odoo@sha256:{"c" * 64}'
        with self.assertRaisesRegex(ValueError, 'does not end with the digest of any of its platform images'):
            self.document(images=images)
        images = {reference: f'{self.registry}/{reference}@sha256:{"a" * 64}' for reference in self.images()}
        self.assertEqual(self.document(images=images)['images'], images)

    def test_the_real_addons_produce_a_valid_document(self):
        versions = self.module.module_versions(ROOT / 'odoo-addons')
        self.assertIn('liwan_core', versions)
        document = self.module.release_document(self.commit, '1', self.images(), self.platforms(), 'a' * 40, versions)
        self.assertEqual(sorted(document['release']['moduleVersions']), sorted(versions))


    # The one reader of /release.json, used by the release command.
    def text(self, **changes):
        document = {**self.document(), **changes}
        return json.dumps(document)

    def test_a_published_document_round_trips_for_its_commit_and_architecture(self):
        parsed = self.module.parse_release_document(self.text(), self.commit, ('linux/amd64',))
        self.assertEqual(parsed, self.document())

    def test_it_refuses_text_that_is_not_json_or_not_this_commit(self):
        with self.assertRaisesRegex(ValueError, 'not valid JSON'):
            self.module.parse_release_document('{')
        with self.assertRaisesRegex(ValueError, 'is for commit'):
            self.module.parse_release_document(self.text(), 'e' * 40)
        with self.assertRaisesRegex(ValueError, 'schemaVersion'):
            self.module.parse_release_document(self.text(schemaVersion=2))

    def test_a_document_without_the_hosts_architecture_names_the_missing_one(self):
        with self.assertRaisesRegex(ValueError, r'no linux/arm64 image \(it covers linux/amd64\)'):
            self.module.parse_release_document(self.text(), self.commit, ('linux/arm64',))
        both = self.text(platforms=self.platforms('linux/amd64', 'linux/arm64'))
        self.module.parse_release_document(both, self.commit, ('linux/amd64', 'linux/arm64'))

    def test_a_release_manifest_for_another_commit_is_refused(self):
        document = self.document()
        document['release'] = {**document['release'], 'liwanCommit': 'f' * 40}
        with self.assertRaisesRegex(ValueError, 'another commit'):
            self.module.parse_release_document(json.dumps(document), self.commit)


if __name__ == '__main__':
    unittest.main()
