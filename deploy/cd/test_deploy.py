"""Tests for deploy/cd/deploy.py with a fake command runner: no docker, git or cosign is called."""
from __future__ import annotations

import base64
import fcntl
import io
import json
import os
import re
import tempfile
import unittest
from pathlib import Path

from deploy.cd import deploy

OLD = 'a' * 40
NEW = 'b' * 40
SECRET = 'db-password-never-logged'
BACKUP_SECRET = 'backup-token-never-logged'
TYPE_STAGING = f'{deploy.ATTESTATION_BASE}/staging/v1'
TYPE_PRODUCTION = f'{deploy.ATTESTATION_BASE}/production/v1'
DIGEST = 'sha256:' + 'c' * 64


def document(commit):
    return {'schemaVersion': 1, 'commit': commit,
            'release': {'liwanCommit': commit, 'odooCommit': 'd' * 40, 'upgradeModules': ['liwan_core', 'liwan_api']},
            'images': {'liwan-odoo': f'ghcr.io/tariiq222/liwan-odoo@{DIGEST}',
                       'liwan-guard': f'ghcr.io/tariiq222/liwan-guard@{DIGEST}'}}


def attestation(predicate, kind=TYPE_STAGING):
    statement = {'predicateType': kind, 'predicate': predicate}
    return json.dumps({'payload': base64.b64encode(json.dumps(statement).encode()).decode()}) + '\n'


def write_smoke(checkout):
    smoke = checkout / 'deploy/odoo/upgrade_smoke.py'
    smoke.parent.mkdir(parents=True, exist_ok=True)
    smoke.write_text("print('UPGRADE_SMOKE_OK')\n")


class FakePostgres:
    """The set of existing databases; each statement fails like PostgreSQL would, and ON_ERROR_STOP stops the script."""

    def __init__(self):
        self.databases = {'postgres', 'tenant_one', 'liwan_control'}

    def run(self, script, case):
        output = []
        for statement in filter(None, (part.strip() for part in script.split(';\n'))):
            error = self.apply(statement, case, output)
            if error:
                return 1, '\n'.join(output + [f'ERROR: {error}'])
        return 0, '\n'.join(output) + ('\n' if output else '')

    def require(self, name, present):
        if present and name not in self.databases:
            return f'database "{name}" does not exist'
        if not present and name in self.databases:
            return f'database "{name}" already exists'
        return None

    def apply(self, statement, case, output):
        names = re.findall(r'"([^"]+)"', statement)
        if statement.startswith('CREATE DATABASE'):
            if case.stop_at_create:
                raise KeyboardInterrupt  # the process is killed here
            if case.fail_create:
                return 'source database "tenant_one" is being accessed by other users'
            error = self.require(names[1], True) or self.require(names[0], False)
            if not error:
                self.databases.add(names[0])
            return error
        if statement.startswith('DROP DATABASE IF EXISTS'):
            self.databases.discard(names[0])
            return None
        if statement.startswith('DROP DATABASE'):
            error = self.require(names[0], True)
            if not error:
                self.databases.discard(names[0])
            return error
        if 'RENAME TO' in statement:
            error = self.require(names[0], True) or self.require(names[1], False)
            if not error:
                self.databases.discard(names[0])
                self.databases.add(names[1])
            return error
        if statement.startswith('ALTER DATABASE'):
            return self.require(names[0], True)
        if 'count(*)' in statement:
            name = re.search(r"datname = '([^']+)'", statement).group(1)
            output.append('1' if name in self.databases else '0')
        elif 'pg_get_userbyid' in statement:
            output.append('odoo|{odoo=CTc/odoo}')
        return None


class FakeRunner:
    """Answers each command from a small table and records every argv it was given."""

    def __init__(self, case):
        self.case = case
        self.calls = []

    def __call__(self, argv, *, stdin=None, env=None, check=True):
        self.calls.append(argv)
        code, output = self.answer(argv, stdin or '')
        if check and code != 0:
            raise deploy.CommandFailed(argv, code)
        return code, output

    def answer(self, argv, stdin):
        case = self.case
        joined = ' '.join(argv)
        if argv[0] == 'git':
            if 'rev-parse' in argv:
                return 0, case.head + '\n'
            if 'for-each-ref' in argv:
                return 0, '\n'.join(case.tags)
            if 'merge-base' in argv:
                return (0 if case.ancestor else 1), ''
            if 'archive' in argv:
                Path(argv[argv.index('-o') + 1]).write_bytes(b'')
            return 0, ''
        if argv[0] == 'tar':
            write_smoke(Path(argv[argv.index('-C') + 1]))
            return 0, ''
        if argv[:3] == ['docker', 'manifest', 'inspect']:
            return (0 if case.published else 1), ''
        if argv[0] == 'cosign':
            return (0, case.cosign_output) if case.signature_ok else (1, 'no matching signatures')
        if argv[0] == 'node':
            return 0, json.dumps([case.tenant_entry or {'tenantId': 't1', 'database': 'tenant_one', 'enabled': True,
                                                        'filestore': str(case.filestore)}])
        if 'psql' in argv:
            case.sql.append(stdin)
            return case.postgres.run(stdin, case)
        if 'up' in argv and '--wait' in argv and case.fail_health and argv[-1] == 'guard':
            case.fail_health = False  # only the new release's guard fails; the previous one starts healthy
            return 1, 'guard unhealthy'
        if 'shell' in argv:
            return 0, 'UPGRADE_SMOKE_OK\n'
        if 'deploy/alerts.py' in joined:
            case.alerts.append(argv)
        return 0, ''


class DeployTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.paths = deploy.Paths(config_root=root / 'etc', state_root=root / 'state',
                                  releases=root / 'releases', current=root / 'current',
                                  maintenance=root / 'maintenance/active')
        self.state = self.paths.state_root / 'staging'
        self.filestore = root / 'data/filestore/tenant_one'
        self.filestore.mkdir(parents=True)
        shared_env = root / 'shared.env'
        shared_env.write_text(f'LIWAN_TENANT_REGISTRY_DIR={root}/registry\nDB_PASSWORD={SECRET}\n')
        self.write_config('main', shared_env, root)
        self.paths.releases.mkdir()
        (self.paths.releases / OLD).mkdir()
        self.paths.current.symlink_to(self.paths.releases / OLD)
        self.head, self.tags, self.ancestor, self.published = NEW, [], True, True
        self.signature_ok, self.fail_health = True, False
        self.cosign_output = attestation(document(NEW))
        self.alerts = []
        self.tenant_entry = None
        self.registry_file = root / 'registry/registry.json'
        self.registry_file.parent.mkdir()
        self.registry_file.write_text('{}')
        self.sql = []
        self.stop_at_create = False
        self.fail_create = False
        self.postgres = FakePostgres()
        self.runner = FakeRunner(self)
        self.log_stream = io.StringIO()
        self.serve(OLD)

    def tearDown(self):
        self.tmp.cleanup()

    def write_config(self, channel, shared_env, root, environment='staging'):
        self.paths.config_root.mkdir(exist_ok=True)
        config = self.paths.config_root / f'{environment}.env'
        config.write_text(
            f'LIWAN_DEPLOY_CHANNEL={channel}\nLIWAN_DEPLOY_REPOSITORY=tariiq222/liwan\n'
            f'LIWAN_DEPLOY_MIRROR={root}/mirror.git\nLIWAN_DEPLOY_PROJECT=liwan\nLIWAN_SHARED_ENV_FILE={shared_env}\n'
            'LIWAN_DEPLOY_PG_DUMP=/usr/bin/pg_dump\nLIWAN_DEPLOY_PG_HOST=127.0.0.1\nLIWAN_DEPLOY_PG_PORT=5432\n'
            'LIWAN_DEPLOY_CONTROL_PG_HOST=127.0.0.1\nLIWAN_DEPLOY_CONTROL_PG_PORT=5433\n'
            f'LIWAN_DEPLOY_DATA_ROOT={root}/data\n'
            f'LIWAN_BACKUP_S3_SECRET={BACKUP_SECRET}\n')
        config.chmod(0o600)

    def serve(self, commit, version=None):
        self.state.mkdir(parents=True, exist_ok=True)
        deploy.write_json(self.state / 'served.json', {'commit': commit, 'ref': 'refs/heads/main', 'version': version,
                                                       'odooCommit': 'e' * 40})
        deploy.write_atomic(self.state / 'release.env', deploy.release_env_text(commit, 'e' * 40))

    def main(self, *argv):
        return deploy.main(list(argv) or ['run', '--environment', 'staging'], paths=self.paths, runner=self.runner,
                           log=lambda message: self.log_stream.write(message + '\n'))

    def served(self):
        return json.loads((self.state / 'served.json').read_text())['commit']

    def commands(self, word):
        return [call for call in self.runner.calls if word in call]

    def alert_events(self):
        return [call[3] for call in self.alerts]

    def test_new_release_is_applied(self):
        self.assertEqual(self.main(), deploy.EXIT_OK)
        self.assertEqual(self.served(), NEW)
        self.assertEqual(os.readlink(self.paths.current), str(self.paths.releases / NEW))
        self.assertIn(f'LIWAN_IMAGE_TAG={NEW}', (self.state / 'release.env').read_text())
        self.assertFalse((self.state / 'run.json').exists())
        self.assertIn(['docker', 'tag', f'ghcr.io/tariiq222/liwan-odoo@{DIGEST}', f'liwan-odoo:{NEW}'],
                      self.runner.calls)
        upgrade = next(call for call in self.runner.calls if '-u' in call)
        self.assertIn('/usr/local/bin/liwan-odoo', upgrade)
        self.assertEqual(upgrade[upgrade.index('-u') + 1], 'liwan_core,liwan_api')
        self.assertEqual(upgrade[upgrade.index('-i') + 1], 'liwan_core,liwan_api')
        self.assertTrue(self.commands('control-migrate'))
        self.assertEqual(len(self.commands('capture')), 2)

    def test_no_change_stops_nothing(self):
        self.head = OLD
        self.assertEqual(self.main(), deploy.EXIT_OK)
        self.assertFalse(self.commands('stop'))
        self.assertFalse(self.commands('cosign'))

    def test_bad_signature_is_refused(self):
        self.signature_ok = False
        self.assertEqual(self.main(), deploy.EXIT_REFUSED)
        self.assertEqual(self.served(), OLD)
        self.assertFalse(self.commands('stop'))

    def test_document_for_another_commit_is_refused(self):
        self.cosign_output = attestation(document(OLD))
        self.assertEqual(self.main(), deploy.EXIT_REFUSED)
        self.assertFalse(self.commands('stop'))

    def test_wrong_attestation_type_is_refused(self):
        self.cosign_output = attestation(document(NEW), TYPE_PRODUCTION)
        self.assertEqual(self.main(), deploy.EXIT_REFUSED)

    def test_unpublished_document_waits(self):
        self.published = False
        self.assertEqual(self.main(), deploy.EXIT_OK)
        self.assertFalse(self.commands('cosign'))

    def test_failed_health_check_rolls_back_and_halts(self):
        self.fail_health = True
        self.assertEqual(self.main(), deploy.EXIT_FAILED)
        self.assertEqual(self.served(), OLD)
        self.assertEqual(os.readlink(self.paths.current), str(self.paths.releases / OLD))
        self.assertIn(f'LIWAN_IMAGE_TAG={OLD}', (self.state / 'release.env').read_text())
        halted = json.loads((self.state / 'halted.json').read_text())
        self.assertEqual((halted['event'], halted['reason'], halted['phase']),
                         ('deploy_failed', 'health_check_failed', 'opening'))
        self.assertEqual(self.alert_events(), ['deploy_failed'])
        self.assertTrue(any('RENAME TO' in ' '.join(call) or 'exec' in call for call in self.runner.calls))
        self.assertFalse((self.state / 'run.json').exists())

    def test_halt_blocks_runs_until_cleared(self):
        deploy.write_json(self.state / 'halted.json', {'reason': 'health_check_failed'})
        self.assertEqual(self.main(), deploy.EXIT_HALTED)
        self.assertEqual(self.runner.calls, [])
        self.assertEqual(self.main('clear', '--environment', 'staging'), deploy.EXIT_OK)
        self.assertEqual(self.main(), deploy.EXIT_OK)
        self.assertEqual(self.served(), NEW)

    def interrupted(self, phase):
        run = {'commit': NEW, 'ref': 'refs/heads/main', 'version': None, 'attestation': 'staging',
               'document': document(NEW), 'previous': {'commit': OLD, 'odooCommit': 'e' * 40, 'version': None},
               'previousReleaseEnv': deploy.release_env_text(OLD, 'e' * 40), 'phase': phase,
               'tenants': [{'tenantId': 't1', 'database': 'tenant_one', 'filestore': str(self.filestore)}],
               'snapshots': {'tenant_one': True, 'liwan_control': True},
               'access': {'tenant_one': {'owner': 'odoo', 'acl': '{odoo=CTc/odoo}'},
                          'liwan_control': {'owner': 'odoo', 'acl': '{odoo=CTc/odoo}'}}}
        write_smoke(self.paths.releases / NEW)
        self.postgres.databases |= {deploy.snapshot_name('tenant_one'), deploy.snapshot_name('liwan_control')}
        deploy.write_json(self.state / 'run.json', run)

    def test_interrupted_before_upgrading_resumes_forward(self):
        for phase in deploy.FORWARD_PHASES:
            with self.subTest(phase=phase):
                self.serve(OLD)
                self.interrupted(phase)
                self.assertEqual(self.main(), deploy.EXIT_OK)
                self.assertEqual(self.served(), NEW)
                self.assertFalse((self.state / 'halted.json').exists())

    def test_interrupted_during_upgrade_or_start_rolls_back(self):
        for phase in ('upgrading', 'starting'):
            with self.subTest(phase=phase):
                self.serve(OLD)
                (self.state / 'halted.json').unlink(missing_ok=True)
                self.alerts.clear()
                self.interrupted(phase)
                self.assertEqual(self.main(), deploy.EXIT_FAILED)
                self.assertEqual(self.served(), OLD)
                halted = json.loads((self.state / 'halted.json').read_text())
                self.assertEqual((halted['phase'], halted['reason']), (phase, 'interrupted'))
                self.assertEqual(self.alert_events(), ['deploy_failed'])
                self.assertFalse(self.commands('-u'))

    def test_older_document_is_refused(self):
        self.ancestor = False
        self.assertEqual(self.main(), deploy.EXIT_REFUSED)
        self.assertFalse(self.commands('cosign'))
        self.assertEqual(self.served(), OLD)

    def test_production_refuses_a_lower_or_equal_version(self):
        root = Path(self.tmp.name)
        self.write_config('release', root / 'shared.env', root)
        self.serve(OLD, version=[1, 0, 6])
        self.tags = ['release/19.0.1.0.5', 'release/19.0.1.0.6', 'not-a-release']
        self.assertEqual(self.main(), deploy.EXIT_REFUSED)
        self.assertFalse(self.commands('cosign'))

    def test_production_applies_the_highest_tag(self):
        root = Path(self.tmp.name)
        self.write_config('release', root / 'shared.env', root)
        self.serve(OLD, version=[1, 0, 6])
        self.tags = ['release/19.0.1.0.10', 'release/19.0.1.0.7']
        self.cosign_output = attestation(document(NEW), TYPE_PRODUCTION)
        self.assertEqual(self.main(), deploy.EXIT_OK)
        cosign = self.commands('cosign')[0]
        self.assertIn('https://github.com/tariiq222/liwan/.github/workflows/publish.yml@refs/tags/release/19.0.1.0.10',
                      cosign)
        self.assertEqual(json.loads((self.state / 'served.json').read_text())['version'], [1, 0, 10])

    def test_missing_environment_is_refused(self):
        with self.assertRaises(SystemExit) as raised:
            deploy.main(['run'], paths=self.paths, runner=self.runner, log=lambda _: None)
        self.assertNotEqual(raised.exception.code, 0)
        self.assertEqual(self.main('run', '--environment', 'unknown'), deploy.EXIT_REFUSED)
        self.assertEqual(self.runner.calls, [])

    def test_config_readable_by_others_is_refused(self):
        (self.paths.config_root / 'staging.env').chmod(0o644)
        self.assertEqual(self.main(), deploy.EXIT_REFUSED)
        self.assertEqual(self.runner.calls, [])

    def test_lock_prevents_a_second_run(self):
        with open(self.state / 'lock', 'a+') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.main(), deploy.EXIT_OK)
        self.assertEqual(self.runner.calls, [])
        self.assertIn('lock', self.log_stream.getvalue())

    def test_no_secret_in_commands_or_logs(self):
        self.fail_health = True
        self.main()
        logged = '\n'.join(' '.join(call) for call in self.runner.calls) + self.log_stream.getvalue()
        for secret in (SECRET, BACKUP_SECRET):
            self.assertNotIn(secret, logged)

    def test_snapshot_closes_connections_before_copy(self):
        self.assertEqual(self.main(), deploy.EXIT_OK)
        snapshot = next(sql for sql in self.sql if 'CREATE DATABASE' in sql and 'tenant_one' in sql)
        order = ['ALLOW_CONNECTIONS false', 'pg_terminate_backend', 'WITH (FORCE)', 'CREATE DATABASE',
                 'ALLOW_CONNECTIONS true']
        positions = [snapshot.index(step) for step in order]
        self.assertEqual(positions, sorted(positions))
        cleanup = [sql for sql in self.sql if sql.startswith('DROP DATABASE IF EXISTS')]
        self.assertTrue(cleanup and all('WITH (FORCE)' in sql for sql in cleanup))

    def test_swap_back_closes_connections_and_forces_drop(self):
        self.fail_health = True
        self.main()
        swap = next(sql for sql in self.sql if 'RENAME TO' in sql)
        order = ['ALLOW_CONNECTIONS false', 'pg_terminate_backend', 'WITH (FORCE)', 'RENAME TO']
        positions = [swap.index(step) for step in order]
        self.assertEqual(positions, sorted(positions))

    def test_kill_before_create_never_swaps_a_stale_snapshot(self):
        self.stop_at_create = True
        with self.assertRaises(KeyboardInterrupt):
            self.main()
        run = json.loads((self.state / 'run.json').read_text())
        self.assertEqual(run['phase'], 'snapshotted')
        self.assertIn('tenant_one', run['access'])
        self.assertFalse(run.get('snapshots', {}).get('tenant_one'))
        run['phase'] = 'upgrading'  # force the rollback path with the database unsnapshotted
        deploy.write_json(self.state / 'run.json', run)
        self.stop_at_create = False
        self.sql.clear()
        self.assertEqual(self.main(), deploy.EXIT_FAILED)
        self.assertFalse([sql for sql in self.sql if 'RENAME TO' in sql])

    def test_filestore_swap_resumes_from_each_step(self):
        live = self.filestore
        pre, failed = live.with_name(live.name + '.pre'), live.with_name(live.name + '.failed')
        states = {'before': (True, True, False), 'live_moved': (False, True, True), 'pre_moved': (True, False, True)}
        for name, (has_live, has_pre, has_failed) in states.items():
            with self.subTest(state=name):
                for path in (live, pre, failed):
                    if path.exists():
                        deploy.shutil.rmtree(path)
                for path, present, marker in ((live, has_live, 'new'), (pre, has_pre, 'old'), (failed, has_failed, 'new')):
                    if present:
                        path.mkdir()
                        (path / 'f').write_text('old' if name == 'pre_moved' and path == live else marker)
                deploy.restore_filestore(live)
                self.assertEqual((live / 'f').read_text(), 'old')
                self.assertFalse(pre.exists() or failed.exists())

    def test_foreign_image_owner_is_refused(self):
        forged = document(NEW)
        forged['images']['liwan-odoo'] = f'ghcr.io/someone-else/liwan-odoo@{DIGEST}'
        self.cosign_output = attestation(forged)
        self.assertEqual(self.main(), deploy.EXIT_REFUSED)
        self.assertFalse(self.commands('pull'))

    def test_maintenance_marker_set_during_run_and_removed_after_open(self):
        seen = []
        original = self.runner.answer

        def watch(argv, stdin):
            if 'control-migrate' in argv:
                seen.append(self.paths.maintenance.exists())
            return original(argv, stdin)
        self.runner.answer = watch
        self.assertEqual(self.main(), deploy.EXIT_OK)
        self.assertEqual(seen, [True])
        self.assertFalse(self.paths.maintenance.exists())
        self.assertEqual(oct(self.paths.maintenance.parent.stat().st_mode & 0o777), '0o755')

    def test_maintenance_marker_rederived_on_resume_and_kept_when_rollback_fails(self):
        self.interrupted('starting')
        self.fail_health = True
        original = self.runner.answer

        def broken(argv, stdin):
            if 'up' in argv:
                return 1, 'still unhealthy'
            return original(argv, stdin)
        self.runner.answer = broken
        self.assertEqual(self.main(), deploy.EXIT_ROLLBACK_FAILED)
        self.assertTrue(self.paths.maintenance.exists())
        self.assertEqual(oct(self.paths.maintenance.stat().st_mode & 0o777), '0o644')
        self.assertEqual(self.alert_events(), ['deploy_rollback_failed'])

    def test_maintenance_marker_removed_after_rollback_restart(self):
        self.fail_health = True
        self.assertEqual(self.main(), deploy.EXIT_FAILED)
        self.assertFalse(self.paths.maintenance.exists())

    def test_first_deploy_applies_without_snapshots(self):
        (self.state / 'served.json').unlink()
        (self.state / 'release.env').unlink()
        self.registry_file.unlink()
        self.assertEqual(self.main(), deploy.EXIT_OK)
        self.assertEqual(self.served(), NEW)
        self.assertFalse(self.commands('stop') or self.commands('capture') or self.sql)

    def test_first_deploy_failure_stops_and_halts(self):
        (self.state / 'served.json').unlink()
        (self.state / 'release.env').unlink()
        self.registry_file.unlink()
        self.fail_health = True
        self.assertEqual(self.main(), deploy.EXIT_FAILED)
        self.assertEqual(self.alert_events(), ['deploy_failed'])
        self.assertTrue(self.commands('stop'))
        self.assertTrue(self.paths.maintenance.exists())
        self.assertFalse((self.state / 'run.json').exists())

    def test_first_deploy_with_existing_tenants_is_refused(self):
        (self.state / 'served.json').unlink()
        (self.state / 'release.env').unlink()
        self.assertEqual(self.main(), deploy.EXIT_FAILED)
        self.assertEqual(json.loads((self.state / 'halted.json').read_text())['reason'], 'bootstrap_with_tenants')
        self.assertFalse(self.commands('stop'))

    def test_invalid_registry_entries_are_refused(self):
        root = Path(self.tmp.name)
        bad = [{'tenantId': 't1', 'database': 'Bad-Name;', 'filestore': str(self.filestore)},
               {'tenantId': 't1', 'database': 'tenant_one', 'filestore': str(root / 'data/../etc')},
               {'tenantId': 't1', 'database': 'tenant_one', 'filestore': str(root / 'elsewhere')}]
        for entry in bad:
            with self.subTest(entry=entry):
                (self.state / 'halted.json').unlink(missing_ok=True)
                self.runner.calls.clear()
                self.tenant_entry = entry
                self.assertEqual(self.main(), deploy.EXIT_FAILED)
                halted = json.loads((self.state / 'halted.json').read_text())
                self.assertEqual(halted['reason'], 'invalid_tenant_registry')
                self.assertFalse(self.commands('stop') or self.commands('capture'))

    def reopened(self):
        return any(sql == "ALTER DATABASE \"tenant_one\" ALLOW_CONNECTIONS true;\n" for sql in self.sql)

    def test_failed_snapshot_reopens_connections_on_rollback(self):
        self.fail_create = True
        self.assertEqual(self.main(), deploy.EXIT_FAILED)
        self.assertTrue(self.reopened())
        self.assertFalse([sql for sql in self.sql if 'RENAME TO' in sql])

    def test_kill_after_closing_connections_reopens_them_on_rollback(self):
        self.stop_at_create = True
        with self.assertRaises(KeyboardInterrupt):
            self.main()
        run = json.loads((self.state / 'run.json').read_text())
        run['phase'] = 'upgrading'
        deploy.write_json(self.state / 'run.json', run)
        self.stop_at_create = False
        self.sql.clear()
        self.assertEqual(self.main(), deploy.EXIT_FAILED)
        self.assertTrue(self.reopened())

    def test_kill_between_drop_and_rename_resumes_rollback(self):
        self.interrupted('rolling_back')
        self.postgres.databases.discard('tenant_one')  # killed after DROP DATABASE, before the RENAME
        self.assertEqual(self.main(), deploy.EXIT_FAILED)
        self.assertEqual(json.loads((self.state / 'halted.json').read_text())['event'], 'deploy_failed')
        self.assertFalse(self.reopened())
        self.assertTrue([sql for sql in self.sql if 'RENAME TO "tenant_one"' in sql])
        self.assertEqual(self.served(), OLD)


if __name__ == '__main__':
    unittest.main()
