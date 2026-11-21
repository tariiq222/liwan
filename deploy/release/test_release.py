"""Tests for deploy/release/release.py with a fake command runner: no docker, git, psql or network is used."""
from __future__ import annotations

import contextlib
import fcntl
import io
import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from deploy.release import databases, release
from deploy.release.common import CommandFailed, Runner, make_log, read_env_file, sensitive_values

OLD = 'a' * 40
NEW = 'b' * 40
ANCIENT = '9' * 40
SECRET = 'db-password-never-logged'
BACKUP_SECRET = 'backup-token-never-logged'
TOKEN = 'forgejo-token-never-logged'
USER = 'release-reader'
REGISTRY = 'git.liwanos.com/liwanos'
AMD64 = 'sha256:' + 'a' * 64
ARM64 = 'sha256:' + 'b' * 64
REFERENCES = ('liwan-guard', 'liwan-odoo', 'liwan-web')
BUILDS = ''.join(f'{REGISTRY}/{name}\t{name}\t{name[6:]}\tDockerfile\t.\t\n' for name in REFERENCES) \
    + '-\tliwan-vendor-admin\tvendor-admin\tDockerfile\t.\t\n'
RELEASE_MANIFEST_IMAGE = {'odoo': 'liwan-odoo', 'web': 'liwan-web', 'guard': 'liwan-guard'}


def document(commit, platforms=('linux/amd64', 'linux/arm64')):
    images = {reference: f'{REGISTRY}/{reference}@{AMD64}' for reference in REFERENCES}
    return {'schemaVersion': 1, 'commit': commit,
            'release': {'releaseId': f'r{commit[:12]}', 'liwanCommit': commit, 'odooCommit': 'd' * 40,
                        'images': {key: images[reference] for key, reference in RELEASE_MANIFEST_IMAGE.items()},
                        'assetsId': f'assets-{commit[:12]}', 'moduleVersions': {'liwan_core': '19.0.1.0', 'liwan_api': '19.0.1.0'},
                        'upgradeModules': ['liwan_core', 'liwan_api'], 'installModules': [],
                        'mode': 'infrastructure_maintenance', 'affectedServices': ['odoo'], 'aiStateVersion': '1',
                        'compatibilityEvidence': {'reviewer': 'unreviewed-ci', 'reference': 'run-1'},
                        'rollbackPolicy': {'oldWritesCompatible': False}},
            'images': images,
            'platforms': {reference: {name: {'linux/amd64': AMD64, 'linux/arm64': ARM64}[name] for name in platforms}
                          for reference in REFERENCES}}


def write_smoke(checkout):
    smoke = checkout / 'deploy/odoo/upgrade_smoke.py'
    smoke.parent.mkdir(parents=True, exist_ok=True)
    smoke.write_text("print('UPGRADE_SMOKE_OK')\n")


class FakePostgres:
    """The set of existing databases; each statement fails like PostgreSQL would, and ON_ERROR_STOP stops the script."""

    SIZES = {'tenant_one': 5000, 'tenant_two': 7000, 'liwan_control': 1000}

    def __init__(self):
        self.databases = {'postgres', 'tenant_one', 'tenant_two', 'liwan_control'}
        isolated = lambda: {'': {('TEMPORARY', False)}, 'liwan_ai': {('CONNECT', False)},  # noqa: E731
                            'odoo': {('CREATE', False), ('TEMPORARY', False), ('CONNECT', False)}}
        self.acls = {'postgres': None, 'liwan_control': None, 'tenant_one': isolated(), 'tenant_two': isolated()}

    def materialized(self, name):
        if self.acls.get(name) is None:
            self.acls[name] = {'': {('TEMPORARY', False), ('CONNECT', False)},
                               'odoo': {('CREATE', False), ('TEMPORARY', False), ('CONNECT', False)}}
        return self.acls[name]

    def acl_rows(self, name):
        acl = self.materialized(name) if name in self.databases else {}
        return sorted(f"{grantee}|{privilege}|{'t' if grantable else 'f'}"
                      for grantee, grants in acl.items() for privilege, grantable in grants)

    def change_acl(self, statement, names):
        acl = self.materialized(names[0])
        grantee = '' if statement.split(' WITH ')[0].endswith('PUBLIC') else names[-1]
        held = acl.setdefault(grantee, set())
        if statement.startswith('REVOKE ALL'):
            held.clear()
        elif statement.startswith('REVOKE'):
            held.discard(('CONNECT', False))
        else:
            for word in statement.split(' ON ')[0].split()[1:]:
                held.add((word.strip(','), 'WITH GRANT OPTION' in statement))
        if not held:
            del acl[grantee]

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
                self.acls[names[0]] = None
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
                self.acls[names[1]] = self.acls.pop(names[0], None)
            return error
        if statement.startswith(('GRANT', 'REVOKE')):
            return self.require(names[0], True) or self.change_acl(statement, names)
        if statement.startswith('ALTER DATABASE'):
            return self.require(names[0], True)
        if 'pg_database_size' in statement:
            if 'IN (' in statement:
                for name in re.findall(r"'([^']+)'", statement):
                    output.append(f'{name}|{self.SIZES[name]}')
            else:
                output.append(str(self.SIZES['liwan_control']))
        elif 'count(*)' in statement:
            name = re.search(r"datname = '([^']+)'", statement).group(1)
            output.append('1' if name in self.databases else '0')
        elif 'aclexplode' in statement:
            output.extend(self.acl_rows(re.search(r"datname = '([^']+)'", statement).group(1)))
        elif 'pg_get_userbyid' in statement:
            output.append('odoo')
        return None


class FakeRunner:
    """Answers each command from a small table and records every argv, stdin and environment it was given."""

    def __init__(self, case):
        self.case = case
        self.calls = []
        self.stdins = []
        self.envs = []

    def __call__(self, argv, *, stdin=None, env=None, check=True):
        self.calls.append(argv)
        self.stdins.append(stdin)
        self.envs.append(env)
        code, output = self.answer(argv, stdin or '')
        if check and code != 0:
            raise CommandFailed(argv, code)
        return code, output

    def answer(self, argv, stdin):
        case = self.case
        joined = ' '.join(argv)
        if argv[0] == 'git':
            return self.git(argv)
        if argv[0] == 'docker' and argv[1] in ('login', 'pull', 'create', 'cp', 'rm', 'rmi', 'image'):
            return self.docker(argv)
        if argv[0] == 'tar':
            write_smoke(Path(argv[argv.index('-C') + 1]))
            return 0, ''
        if argv[0] == 'cp':  # cp -al <filestore> <filestore>.pre
            shutil.copytree(argv[2], argv[3])
            return 0, ''
        if 'deploy/image_pins.py' in joined:
            return 0, case.builds
        if argv[:2] == ['systemctl', 'is-active']:
            return (0 if case.worker_ready else 3), ''
        if argv[:2] == ['systemctl', 'start']:
            case.worker_started_after_served.append((case.state / 'served.json').exists()
                                                    and case.served_commit() == case.expected_worker_commit)
        if argv[0] == 'node':
            return 0, json.dumps([{'tenantId': f't{index}', 'database': name, 'enabled': True, 'filestore': name}
                                  for index, name in enumerate(case.tenant_names, 1)]
                                 if case.tenant_entry is None else [case.tenant_entry])
        if 'psql' in argv:
            case.sql.append(stdin)
            return case.postgres.run(stdin, case)
        if 'up' in argv and '--wait' in argv and case.fail_health and argv[-1] == 'guard':
            case.fail_health = False  # only the new release's guard fails; the previous one starts healthy
            return 1, 'guard unhealthy'
        if '-u' in argv:
            database = argv[argv.index('-d') + 1]
            if database == case.fail_upgrade_of:
                return 1, 'odoo: upgrade failed'
            (case.filestore(database) / 'f').write_text('new')
            return 0, ''
        if 'shell' in argv:
            return 0, 'UPGRADE_SMOKE_OK\n'
        if 'deploy/alerts.py' in joined:
            case.alerts.append(argv)
        return 0, ''

    def git(self, argv):
        case = self.case
        if 'ls-remote' in argv:
            if argv[-1] == 'refs/heads/main':
                return 0, f'{case.head}\trefs/heads/main\n'
            return 0, ''.join(f'{commit}\trefs/tags/{tag}\n' for tag, commit in case.tags.items())
        if 'merge-base' in argv:
            return (0 if (case.on_main if argv[-1] == 'refs/heads/main' else case.ancestor) else 1), ''
        if 'cat-file' in argv:
            return (0 if case.fetched else 1), ''
        if 'archive' in argv:
            Path(argv[argv.index('-o') + 1]).write_bytes(b'')
        return 0, ''

    def docker(self, argv):
        case = self.case
        if argv[1] == 'pull' and 'liwan-release' in argv[-1] and not case.published:
            return 1, 'manifest unknown'
        if argv[1] == 'create':
            return 0, 'container-1\n'
        if argv[1] == 'cp':
            Path(argv[3]).write_text(json.dumps(case.document))
        return 0, ''


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.root = root
        self.machine = 'x86_64'
        self.free = 10 ** 12
        patcher = mock.patch.object(release, 'free_bytes', lambda path: self.free)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.environ = {'PATH': '/usr/bin', 'LIWAN_FORGEJO_READ_USER': USER, 'LIWAN_FORGEJO_READ_TOKEN': TOKEN}
        self.paths = release.Paths(config_root=root / 'etc', state_root=root / 'state', releases=root / 'releases',
                                   current=root / 'current', maintenance=root / 'maintenance/active')
        self.state = self.paths.state_root / 'development'
        self.tenant_names = ['tenant_one']
        for name in ('tenant_one', 'tenant_two'):
            (root / 'data/filestore' / name).mkdir(parents=True)
            (root / 'data/filestore' / name / 'f').write_text('old')
        shared_env = root / 'shared.env'
        shared_env.write_text(f'LIWAN_TENANT_REGISTRY_DIR={root}/registry\nDB_PASSWORD={SECRET}\n')
        for environment in ('development', 'staging', 'production'):
            self.write_config(shared_env, environment)
        self.paths.releases.mkdir()
        (self.paths.releases / OLD).mkdir()
        self.paths.current.symlink_to(self.paths.releases / OLD)
        self.head, self.tags, self.ancestor, self.published, self.fetched = NEW, {}, True, True, True
        self.on_main = True
        self.fail_health, self.fail_upgrade_of = False, None
        self.document = document(NEW)
        self.alerts, self.sql = [], []
        self.builds = BUILDS
        self.worker_ready = True
        self.worker_started_after_served = []
        self.expected_worker_commit = NEW
        self.tenant_entry = None
        self.registry_file = root / 'registry/registry.json'
        self.registry_file.parent.mkdir()
        self.registry_file.write_text('{}')
        self.stop_at_create = False
        self.fail_create = False
        self.postgres = FakePostgres()
        self.runner = FakeRunner(self)
        self.log_stream = io.StringIO()
        self.serve(OLD)

    def write_config(self, shared_env, environment):
        self.paths.config_root.mkdir(exist_ok=True)
        config = self.paths.config_root / f'{environment}.env'
        config.write_text(
            'LIWAN_RELEASE_PROJECT=liwan\n'
            f'LIWAN_SHARED_ENV_FILE={shared_env}\n'
            'LIWAN_RELEASE_PG_DUMP=/usr/bin/pg_dump\nLIWAN_RELEASE_PG_HOST=127.0.0.1\nLIWAN_RELEASE_PG_PORT=5432\n'
            'LIWAN_RELEASE_CONTROL_PG_HOST=127.0.0.1\nLIWAN_RELEASE_CONTROL_PG_PORT=5433\n'
            f'LIWAN_RELEASE_ODOO_DATA_DIR={self.root}/data\nLIWAN_RELEASE_DISK_PATH={self.root}\n'
            f'LIWAN_BACKUP_S3_SECRET={BACKUP_SECRET}\n')
        config.chmod(0o600)

    def filestore(self, database):
        return self.root / 'data/filestore' / database

    def serve(self, commit, version=None):
        self.state.mkdir(parents=True, exist_ok=True)
        release.write_json(self.state / 'served.json', {'commit': commit, 'ref': 'refs/heads/main', 'version': version,
                                                        'odooCommit': 'e' * 40})
        release.write_atomic(self.state / 'release.env', release.release_env_text(commit, 'e' * 40))

    def main(self, *argv, environ=None):
        log = make_log([USER, TOKEN], self.log_stream)
        return release.main(list(argv) or ['run', '--environment', 'development'], paths=self.paths, runner=self.runner,
                            log=log, environ=self.environ if environ is None else environ, machine=self.machine)

    def served(self):
        return json.loads((self.state / 'served.json').read_text())['commit']

    served_commit = served

    def result(self):
        return re.findall(r'RESULT: (.*)', self.log_stream.getvalue())[-1]

    def commands(self, word):
        return [call for call in self.runner.calls if word in call]

    def compose_stops(self):
        return [call for call in self.runner.calls if 'compose' in call and 'stop' in call]

    def alert_events(self):
        return [call[3] for call in self.alerts]

    def renames(self):
        return [sql for sql in self.sql if 'RENAME TO' in sql]

    def product_pulls(self):
        return [call[-1] for call in self.runner.calls if call[:2] == ['docker', 'pull'] and 'liwan-release' not in call[-1]]

    # --- a clean run -----------------------------------------------------------------------------------
    def test_new_release_is_applied(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.result(), f'committed {NEW}')
        self.assertEqual(self.served(), NEW)
        self.assertEqual(os.readlink(self.paths.current), str(self.paths.releases / NEW))
        self.assertIn(f'LIWAN_IMAGE_TAG={NEW}', (self.state / 'release.env').read_text())
        self.assertFalse((self.state / 'run.json').exists())
        self.assertIn(['docker', 'tag', f'{REGISTRY}/liwan-odoo@{AMD64}', f'liwan-odoo:{NEW}'], self.runner.calls)
        upgrade = next(call for call in self.runner.calls if '-u' in call)
        self.assertIn('/usr/local/bin/liwan-odoo', upgrade)
        self.assertEqual(upgrade[upgrade.index('-u') + 1], 'liwan_core,liwan_api')
        self.assertTrue(self.commands('control-migrate'))
        self.assertEqual(len(self.commands('capture')), 2)

    def test_candidate_comes_from_forgejo_and_the_document_from_its_registry(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        listing = next(call for call in self.runner.calls if 'ls-remote' in call)
        self.assertEqual(listing[-2:], ['https://git.liwanos.com/liwanos/liwan.git', 'refs/heads/main'])
        docker = [call for call in self.runner.calls if call[0] == 'docker'][:6]
        self.assertEqual(docker[0], ['docker', 'login', 'git.liwanos.com', '--username', USER, '--password-stdin'])
        self.assertEqual(docker[1], ['docker', 'pull', '--quiet', f'{REGISTRY}/liwan-release:{NEW}'])
        self.assertEqual(docker[2], ['docker', 'create', f'{REGISTRY}/liwan-release:{NEW}', '/release.json'])
        self.assertEqual(docker[3][:2], ['docker', 'cp'])
        self.assertEqual(docker[4], ['docker', 'rm', 'container-1'])

    def test_no_change_stops_nothing(self):
        self.head = OLD
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.result(), f'nothing to do: serving {OLD}')
        self.assertFalse(self.compose_stops())
        self.assertFalse(self.commands('fetch'))

    def test_unpublished_document_is_refused_before_anything_stops(self):
        self.published = False
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused document_not_published')
        self.assertFalse(self.compose_stops())

    def test_document_for_another_commit_is_refused(self):
        self.document = document(OLD)
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused document_invalid')
        self.assertFalse(self.compose_stops() or self.product_pulls())

    def test_document_with_a_foreign_registry_is_refused(self):
        self.document['images']['liwan-odoo'] = f'ghcr.io/someone/liwan-odoo@{AMD64}'
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused document_invalid')
        self.assertFalse(self.product_pulls())

    # --- refusals before anything runs -------------------------------------------------------------------
    def test_missing_credential_is_refused_before_any_command(self):
        for names in (('LIWAN_FORGEJO_READ_TOKEN',), ('LIWAN_FORGEJO_READ_USER',),
                      ('LIWAN_FORGEJO_READ_USER', 'LIWAN_FORGEJO_READ_TOKEN')):
            with self.subTest(missing=names):
                self.log_stream.truncate(0)
                environ = {key: value for key, value in self.environ.items() if key not in names}
                self.assertEqual(self.main(environ=environ), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused missing_credential')
                self.assertIn('LIWAN_FORGEJO_READ_TOKEN in the job secrets', self.log_stream.getvalue())
        self.assertEqual(self.runner.calls, [])

    def test_unknown_environment_and_loose_config_are_refused(self):
        self.assertEqual(self.main('run', '--environment', 'unknown'), release.EXIT_REFUSED)
        (self.paths.config_root / 'development.env').chmod(0o644)
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused config_not_private')
        self.assertEqual(self.runner.calls, [])
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            self.main('run')

    def test_unknown_architecture_is_refused_before_any_command(self):
        self.machine = 'riscv64'
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused unsupported_architecture')
        self.assertEqual(self.runner.calls, [])

    def test_older_candidate_is_refused(self):
        self.ancestor = False
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused older_candidate')
        self.assertFalse(self.commands('pull') or self.compose_stops())
        self.assertEqual(self.served(), OLD)

    def test_candidate_missing_after_fetch_is_not_applied(self):
        self.fetched = False
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.result(), 'nothing to do candidate_not_fetched')
        self.assertFalse(self.compose_stops())

    # --- architectures -------------------------------------------------------------------------------------
    def test_host_pulls_the_digest_of_its_own_architecture(self):
        for machine, digest in (('x86_64', AMD64), ('aarch64', ARM64), ('arm64', ARM64)):
            with self.subTest(machine=machine):
                self.machine = machine
                self.runner.calls.clear()
                self.assertEqual(self.main(), release.EXIT_OK)
                self.assertEqual(self.product_pulls(), [f'{REGISTRY}/{name}@{digest}' for name in REFERENCES])
                self.serve(OLD)

    def test_missing_architecture_is_refused_before_anything_stops(self):
        self.machine = 'aarch64'
        del self.document['platforms']['liwan-guard']['linux/arm64']
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused document_invalid')
        self.assertIn('linux/arm64', self.log_stream.getvalue())
        self.assertFalse(self.product_pulls() or self.compose_stops() or self.commands('systemctl'))
        self.assertFalse((self.state / 'run.json').exists())

    def test_document_without_platforms_is_refused(self):
        del self.document['platforms']
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertFalse(self.product_pulls() or self.compose_stops())

    def test_development_accepts_an_amd64_only_document_on_an_amd64_host(self):
        self.document = document(NEW, platforms=('linux/amd64',))
        self.assertEqual(self.main(), release.EXIT_OK)

    def test_production_refuses_a_document_without_arm64_even_on_an_amd64_host(self):
        self.use_production(OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.7': NEW}
        self.document = document(NEW, platforms=('linux/amd64',))
        self.assertEqual(self.main('run', '--environment', 'production'), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused document_invalid')
        self.assertIn('has no linux/arm64 image', self.log_stream.getvalue())
        self.assertFalse(self.compose_stops())

    def use_environment(self, environment, commit, version):
        self.state = self.paths.state_root / environment
        self.serve(commit, version=version)

    def use_production(self, commit, version):
        self.use_environment('production', commit, version)

    # --- production candidate -------------------------------------------------------------------------------
    def test_production_applies_the_highest_tag_and_resolves_annotated_tags(self):
        self.use_production(OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.10': NEW, 'release/19.0.1.0.7': 'c' * 40, 'not-a-release': 'd' * 40}
        self.assertEqual(self.main('run', '--environment', 'production'), release.EXIT_OK)
        listing = next(call for call in self.runner.calls if 'ls-remote' in call)
        self.assertEqual(listing[-1], 'refs/tags/release/*')
        self.assertEqual(json.loads((self.state / 'served.json').read_text())['version'], [1, 0, 10])

    def test_production_refuses_a_lower_or_equal_version(self):
        self.use_production(OLD, [1, 0, 6])
        for tags in ({'release/19.0.1.0.5': NEW}, {'release/19.0.1.0.6': NEW}):
            with self.subTest(tags=tags):
                self.tags = tags
                self.assertEqual(self.main('run', '--environment', 'production'), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused older_candidate')
        self.assertFalse(self.compose_stops())

    def test_production_without_a_tag_has_nothing_to_do(self):
        self.use_production(OLD, [1, 0, 6])
        self.assertEqual(self.main('run', '--environment', 'production'), release.EXIT_OK)
        self.assertEqual(self.result(), 'nothing to do: no release tag exists')

    # --- staging candidate (the same release channel as production) -----------------------------------------
    def test_development_follows_main_and_never_reads_tags(self):
        self.tags = {'release/19.0.1.0.7': 'c' * 40}
        self.assertEqual(self.main('run', '--environment', 'development'), release.EXIT_OK)
        self.assertEqual(self.served(), NEW)
        listing = next(call for call in self.runner.calls if 'ls-remote' in call)
        self.assertEqual(listing[-1], 'refs/heads/main')

    def test_staging_applies_the_highest_release_tag_not_the_main_head(self):
        self.use_environment('staging', OLD, [1, 0, 6])
        self.head = 'c' * 40
        self.tags = {'release/19.0.1.0.10': NEW, 'release/19.0.1.0.7': 'c' * 40}
        self.assertEqual(self.main('run', '--environment', 'staging'), release.EXIT_OK)
        listing = next(call for call in self.runner.calls if 'ls-remote' in call)
        self.assertEqual(listing[-1], 'refs/tags/release/*')
        self.assertEqual(self.served(), NEW)
        self.assertEqual(json.loads((self.state / 'served.json').read_text())['version'], [1, 0, 10])

    def test_staging_refuses_a_document_without_arm64_even_on_an_amd64_host(self):
        self.use_environment('staging', OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.7': NEW}
        self.document = document(NEW, platforms=('linux/amd64',))
        self.assertEqual(self.main('run', '--environment', 'staging'), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused document_invalid')
        self.assertIn('has no linux/arm64 image', self.log_stream.getvalue())
        self.assertFalse(self.compose_stops())

    def test_staging_refuses_a_tag_that_is_not_on_main(self):
        self.use_environment('staging', OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.7': NEW}
        self.on_main = False
        self.assertEqual(self.main('run', '--environment', 'staging'), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused not_on_main')
        self.assertFalse(self.compose_stops() or self.product_pulls())

    def test_staging_refuses_a_lower_or_equal_version(self):
        self.use_environment('staging', OLD, [1, 0, 6])
        for tags in ({'release/19.0.1.0.5': NEW}, {'release/19.0.1.0.6': NEW}):
            with self.subTest(tags=tags):
                self.tags = tags
                self.assertEqual(self.main('run', '--environment', 'staging'), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused older_candidate')
        self.assertFalse(self.compose_stops())

    # --- failures and rollback -------------------------------------------------------------------------------
    def test_failed_health_check_rolls_back(self):
        self.fail_health = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back health_check_failed')
        self.assertEqual(self.served(), OLD)
        self.assertEqual(os.readlink(self.paths.current), str(self.paths.releases / OLD))
        self.assertIn(f'LIWAN_IMAGE_TAG={OLD}', (self.state / 'release.env').read_text())
        self.assertEqual(self.alert_events(), ['deploy_failed'])
        self.assertTrue(self.renames())
        self.assertFalse((self.state / 'run.json').exists() or (self.state / 'halted.json').exists())
        self.assertFalse(self.paths.maintenance.exists())

    def test_failed_upgrade_of_the_second_tenant_rolls_back_code_and_data_of_both(self):
        self.tenant_names = ['tenant_one', 'tenant_two']
        self.fail_upgrade_of = 'tenant_two'
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back upgrade_failed')
        self.assertEqual(os.readlink(self.paths.current), str(self.paths.releases / OLD))
        self.assertEqual(self.served(), OLD)
        upgraded = [call[call.index('-d') + 1] for call in self.commands('-u')]
        self.assertEqual(upgraded, ['tenant_one', 'tenant_two'])  # the first tenant was upgraded before the failure
        swapped = {name for name in ('tenant_one', 'tenant_two', 'liwan_control')
                   if any(f'RENAME TO "{name}"' in sql for sql in self.sql)}
        self.assertEqual(swapped, {'tenant_one', 'tenant_two', 'liwan_control'})
        for name in ('tenant_one', 'tenant_two'):  # the first tenant's filestore was changed, then restored
            self.assertEqual((self.filestore(name) / 'f').read_text(), 'old')
            self.assertFalse(self.filestore(name).with_name(name + '.pre').exists())
        self.assertEqual(self.postgres.acls['tenant_one'],
                         {'': {('TEMPORARY', False)}, 'liwan_ai': {('CONNECT', False)},
                          'odoo': {('CREATE', False), ('TEMPORARY', False), ('CONNECT', False)}})
        self.assertFalse(self.commands('control-migrate'))
        self.assertEqual(self.alert_events(), ['deploy_failed'])
        self.assertFalse(self.paths.maintenance.exists())

    def test_rollback_that_fails_halts_and_keeps_maintenance(self):
        self.interrupted('starting')
        original = self.runner.answer
        self.runner.answer = lambda argv, stdin: (1, 'unhealthy') if 'up' in argv else original(argv, stdin)
        self.assertEqual(self.main(), release.EXIT_ROLLBACK_FAILED)
        self.assertEqual(self.result(), 'halted rollback_command_failed')
        self.assertTrue(self.paths.maintenance.exists())
        self.assertEqual(self.alert_events(), ['deploy_rollback_failed'])
        self.assertEqual(self.main(), release.EXIT_HALTED)
        self.assertEqual(self.result(), 'halted rollback_command_failed')

    def test_rollback_command_clears_the_halt_and_finishes_the_rollback(self):
        self.test_rollback_that_fails_halts_and_keeps_maintenance()
        self.runner.answer = FakeRunner.answer.__get__(self.runner)
        self.assertEqual(self.main('rollback', '--environment', 'development'), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back interrupted')
        self.assertFalse((self.state / 'halted.json').exists() or self.paths.maintenance.exists())
        self.assertEqual(self.served(), OLD)

    def test_rollback_command_without_an_unfinished_run_only_clears_the_halt(self):
        release.write_json(self.state / 'halted.json', {'reason': 'x'})
        self.assertEqual(self.main('rollback', '--environment', 'development'), release.EXIT_OK)
        self.assertFalse((self.state / 'halted.json').exists())
        self.assertEqual(self.runner.calls, [])

    def test_rollback_command_refuses_a_committed_run(self):
        self.interrupted('cleanup')
        self.assertEqual(self.main('rollback', '--environment', 'development'), release.EXIT_REFUSED)
        self.assertEqual(self.runner.calls, [])

    def test_rollback_command_cancels_a_run_that_never_recorded_its_inventory(self):
        for phase in ('verified', 'quiescing', 'captured'):
            for with_inventory in (False, True):
                with self.subTest(phase=phase, inventory=with_inventory):
                    self.serve(OLD)
                    self.interrupted(phase)
                    run = json.loads((self.state / 'run.json').read_text())
                    if not with_inventory:
                        del run['tenants']
                        release.write_json(self.state / 'run.json', run)
                    release.write_json(self.state / 'failed.json', {'commit': NEW, 'reason': 'x', 'at': 'now'})
                    self.runner.calls.clear()
                    self.assertEqual(self.main('rollback', '--environment', 'development'), release.EXIT_OK)
                    self.assertTrue(self.result().startswith(f'cancelled {NEW}'))
                    self.assertFalse(self.compose_stops() or self.commands('-u') or self.renames())
                    self.assertFalse([call for call in self.runner.calls if call[:2] == ['systemctl', 'stop']])
                    self.assertFalse(self.paths.maintenance.exists())
                    self.assertFalse((self.state / 'run.json').exists() or (self.state / 'failed.json').exists())
                    self.assertEqual(self.served(), OLD)
                    self.assertEqual(self.main(), release.EXIT_OK)
                    self.assertEqual(self.served(), NEW)

    def test_rollback_command_cancels_a_run_interrupted_inside_prepare_or_before_the_inventory(self):
        for fail_at in ('prepare', 'inventory'):
            with self.subTest(fail_at=fail_at):
                self.serve(OLD)
                real = release.Releaser.tenants
                calls = []

                def tenants(releaser, checkout):  # prepare reads it for the disk check; the second read is quiesce's
                    calls.append(checkout)
                    if fail_at == 'inventory' and len(calls) > 1:
                        raise KeyboardInterrupt
                    return real(releaser, checkout)

                patches = [mock.patch.object(release.Releaser, 'tenants', tenants)]
                if fail_at == 'prepare':
                    patches = [mock.patch.object(release.Releaser, 'prepare', side_effect=KeyboardInterrupt)]
                with patches[0], self.assertRaises(KeyboardInterrupt):
                    self.main()
                run = json.loads((self.state / 'run.json').read_text())
                self.assertNotIn('tenants', run)
                self.runner.calls.clear()
                self.assertEqual(self.main('rollback', '--environment', 'development'), release.EXIT_OK)
                self.assertFalse(self.compose_stops() or self.renames() or self.paths.maintenance.exists())
                self.assertFalse((self.state / 'run.json').exists())
                self.assertEqual(self.main(), release.EXIT_OK)
                self.assertEqual(self.served(), NEW)

    def test_status_reports_and_exits_3_when_halted(self):
        release.write_json(self.state / 'halted.json', {'reason': 'x'})
        with mock.patch('sys.stdout', new=io.StringIO()) as out:
            self.assertEqual(self.main('status', '--environment', 'development'), release.EXIT_HALTED)
        self.assertEqual(json.loads(out.getvalue())['served']['commit'], OLD)

    def test_worker_not_ready_after_commit_is_incomplete_and_the_next_run_resumes(self):
        self.worker_ready = False
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), f'incomplete {NEW} worker_not_ready')
        self.assertEqual(self.served(), NEW)
        self.assertEqual(self.renames(), [])
        self.worker_ready = True
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertFalse((self.state / 'run.json').exists())

    def test_failed_backup_restarts_the_worker_and_changes_nothing_else(self):
        original = self.runner.answer
        self.runner.answer = lambda argv, stdin: (1, 'store down') if 'capture' in argv else original(argv, stdin)
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back backup_failed')
        self.assertTrue([call for call in self.runner.calls if call[:2] == ['systemctl', 'start']])
        self.assertFalse(self.compose_stops())

    def test_insufficient_disk_is_refused_before_anything_stops(self):
        self.tenant_names = ['tenant_one', 'tenant_two']
        need = 5000 + 7000 + 1000 + 6 + release.BACKUP_COPIES * (7000 + 3)  # snapshots, filestores, one capture
        self.free = int(need * release.DISK_MARGIN) - 1
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused insufficient_disk')
        self.assertFalse(self.compose_stops() or self.commands('capture') or self.commands('systemctl'))
        self.assertEqual(self.served(), OLD)
        self.free = int(need * release.DISK_MARGIN)
        self.assertEqual(self.main(), release.EXIT_OK)

    def test_filestore_size_counts_toward_the_disk_need(self):
        (self.filestore('tenant_one') / 'big').write_bytes(b'x' * 4000)
        need = 5000 + 1000 + 4003 + release.BACKUP_COPIES * (5000 + 4003)
        self.free = int(need * release.DISK_MARGIN) - 1
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.free = int(need * release.DISK_MARGIN) + 10
        self.assertEqual(self.main(), release.EXIT_OK)

    # --- crash and rerun -------------------------------------------------------------------------------------
    def recorded_grants(self, name):
        return [[grantee, privilege, grantable == 't']
                for grantee, privilege, grantable in (row.split('|') for row in self.postgres.acl_rows(name))]

    def interrupted(self, phase):
        names = [name for name in self.tenant_names]
        run = {'commit': NEW, 'ref': 'refs/heads/main', 'version': None, 'document': document(NEW),
               'previous': {'commit': OLD, 'odooCommit': 'e' * 40, 'version': None},
               'previousReleaseEnv': release.release_env_text(OLD, 'e' * 40), 'phase': phase,
               'tenants': [{'tenantId': 't1', 'database': name, 'filestore': str(self.filestore(name))} for name in names],
               'snapshots': {name: True for name in names + ['liwan_control']},
               'access': {name: {'owner': 'odoo', 'grants': self.recorded_grants(name)}
                          for name in names + ['liwan_control']}}
        write_smoke(self.paths.releases / NEW)
        self.postgres.databases |= {databases.snapshot_name(name) for name in names + ['liwan_control']}
        release.write_json(self.state / 'run.json', run)

    def test_rerun_after_a_crash_before_the_upgrade_resumes_forward(self):
        for phase in ('verified', 'quiescing', 'captured', 'stopping', 'snapshotted'):
            with self.subTest(phase=phase):
                self.serve(OLD)
                self.interrupted(phase)
                self.assertEqual(self.main(), release.EXIT_OK)
                self.assertEqual(self.served(), NEW)
                self.assertFalse((self.state / 'halted.json').exists())

    def test_rerun_after_a_crash_at_opening_or_after_commit_resumes_forward(self):
        for phase in ('opening', 'opened', 'committed', 'cleanup'):
            with self.subTest(phase=phase):
                self.serve(NEW if phase == 'cleanup' else OLD)
                self.interrupted(phase)
                self.assertEqual(self.main(), release.EXIT_OK)
                self.assertEqual(self.served(), NEW)
                self.assertFalse((self.state / 'run.json').exists())

    def test_rerun_after_a_crash_during_upgrade_start_or_rollback_rolls_back(self):
        for phase in ('upgrading', 'starting', 'rolling_back'):
            with self.subTest(phase=phase):
                self.serve(OLD)
                self.alerts.clear()
                self.interrupted(phase)
                self.assertEqual(self.main(), release.EXIT_FAILED)
                self.assertEqual(self.result(), 'rolled back interrupted')
                self.assertEqual(self.served(), OLD)
                self.assertEqual(self.alert_events(), ['deploy_failed'])
                self.assertFalse(self.commands('-u'))

    def test_kill_before_create_never_swaps_a_stale_snapshot(self):
        self.stop_at_create = True
        with self.assertRaises(KeyboardInterrupt):
            self.main()
        run = json.loads((self.state / 'run.json').read_text())
        self.assertEqual(run['phase'], 'snapshotted')
        self.assertFalse(run.get('snapshots', {}).get('tenant_one'))
        run['phase'] = 'upgrading'  # force the rollback path with the database unsnapshotted
        release.write_json(self.state / 'run.json', run)
        self.stop_at_create = False
        self.sql.clear()
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertFalse(self.renames())

    def test_kill_between_drop_and_rename_resumes_rollback(self):
        self.interrupted('rolling_back')
        self.postgres.databases.discard('tenant_one')  # killed after DROP DATABASE, before the RENAME
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertTrue([sql for sql in self.sql if 'RENAME TO "tenant_one"' in sql])
        self.assertEqual(self.served(), OLD)

    def test_failed_snapshot_reopens_connections_on_rollback(self):
        self.fail_create = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertIn('ALTER DATABASE "tenant_one" ALLOW_CONNECTIONS true;\n', self.sql)
        self.assertFalse(self.renames())

    def test_resume_keeps_the_worker_stopped(self):
        self.interrupted('captured')
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertIn(['systemctl', 'stop', release.SHARED_WORKER_UNIT], self.runner.calls[:3])

    def test_filestore_swap_resumes_from_each_step(self):
        live = self.filestore('tenant_one')
        pre, failed = live.with_name(live.name + '.pre'), live.with_name(live.name + '.failed')
        states = {'before': (True, True, False), 'live_moved': (False, True, True), 'pre_moved': (True, False, True)}
        for name, (has_live, has_pre, has_failed) in states.items():
            with self.subTest(state=name):
                for path in (live, pre, failed):
                    shutil.rmtree(path, ignore_errors=True)
                for path, present, marker in ((live, has_live, 'new'), (pre, has_pre, 'old'), (failed, has_failed, 'new')):
                    if present:
                        path.mkdir()
                        (path / 'f').write_text('old' if name == 'pre_moved' and path == live else marker)
                databases.restore_filestore(live)
                self.assertEqual((live / 'f').read_text(), 'old')
                self.assertFalse(pre.exists() or failed.exists())

    # --- lock, secrets, state ----------------------------------------------------------------------------------
    def test_second_concurrent_start_exits_cleanly(self):
        with open(self.state / 'lock', 'a+') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.result(), 'nothing to do: another run holds the lock')
        self.assertEqual(self.runner.calls, [])

    def test_the_token_is_in_no_argument_log_state_file_or_foreign_environment(self):
        for failing in (False, True):
            self.fail_health = failing
            self.serve(OLD)
            self.main()
            self.main()
        logged = '\n'.join(' '.join(call) for call in self.runner.calls) + self.log_stream.getvalue()
        for secret in (SECRET, BACKUP_SECRET, TOKEN):
            self.assertNotIn(secret, logged)
        for path in self.state.rglob('*.json'):
            self.assertNotIn(TOKEN, path.read_text())
        for call, env, stdin in zip(self.runner.calls, self.runner.envs, self.runner.stdins):
            if TOKEN in (env or {}).values():
                self.assertEqual(call[0], 'git')  # only git (through its credential helper) gets the token in its environment
            if stdin and TOKEN in stdin:
                self.assertEqual(call[:2], ['docker', 'login'])
                self.assertEqual(stdin, TOKEN + '\n')

    def test_a_failed_command_logs_its_output_tail_with_secrets_masked(self):
        log = make_log([USER, TOKEN], self.log_stream)
        with self.assertRaises(CommandFailed):
            Runner(log)(['sh', '-c', 'echo "fatal: bad token $LEAK"; exit 1'], env={'LEAK': TOKEN})
        self.assertIn('fatal: bad token ***', self.log_stream.getvalue())
        self.assertNotIn(TOKEN, self.log_stream.getvalue())

    def test_registry_calls_use_the_private_docker_config_inside_the_state_dir(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        config = self.state / 'docker-config'
        self.assertEqual(config.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        registry_calls = [env for call, env in zip(self.runner.calls, self.runner.envs)
                          if call[:2] in (['docker', 'login'], ['docker', 'pull'], ['docker', 'create'])]
        self.assertTrue(registry_calls)
        for env in registry_calls:
            self.assertEqual(env['DOCKER_CONFIG'], str(config))

    def test_git_never_prompts_and_uses_only_the_environment_credential_helper(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        remote = [(call, env) for call, env in zip(self.runner.calls, self.runner.envs) if 'credential.helper=' in call]
        self.assertTrue(remote)
        for call, env in remote:
            self.assertEqual(env['GIT_TERMINAL_PROMPT'], '0')
            self.assertEqual(env['LIWAN_FORGEJO_READ_TOKEN'], TOKEN)
            self.assertIn('$LIWAN_FORGEJO_READ_TOKEN', ' '.join(call))  # a reference, never the value

    # --- snapshot, maintenance, worker --------------------------------------------------------------------------
    def test_snapshot_closes_connections_before_copy(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        snapshot = next(sql for sql in self.sql if 'CREATE DATABASE' in sql and 'tenant_one' in sql)
        order = ['ALLOW_CONNECTIONS false', 'pg_terminate_backend', 'WITH (FORCE)', 'CREATE DATABASE',
                 'ALLOW_CONNECTIONS true']
        positions = [snapshot.index(step) for step in order]
        self.assertEqual(positions, sorted(positions))

    def test_maintenance_marker_set_during_run_and_removed_after_open(self):
        seen = []
        original = self.runner.answer

        def watch(argv, stdin):
            if 'control-migrate' in argv:
                seen.append(self.paths.maintenance.exists())
            return original(argv, stdin)
        self.runner.answer = watch
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(seen, [True])
        self.assertFalse(self.paths.maintenance.exists())

    def test_worker_starts_only_after_served_is_written(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.worker_started_after_served, [True])

    def test_worker_is_stopped_before_the_tenant_inventory_and_only_once(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        calls = self.runner.calls
        stop = calls.index(['systemctl', 'stop', release.SHARED_WORKER_UNIT])
        inventory = [i for i, call in enumerate(calls) if call[0] == 'node'][-1]
        self.assertLess(stop, inventory)
        self.assertEqual(calls.count(['systemctl', 'stop', release.SHARED_WORKER_UNIT]), 1)

    def test_compose_never_builds_or_pulls(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        for call in self.runner.calls:
            if 'compose' in call and 'up' in call:
                self.assertIn('--no-build', call)
                self.assertEqual(call[call.index('--pull') + 1], 'never')

    def test_release_tree_is_readable_by_the_worker(self):
        previous = os.umask(0o077)
        try:
            self.assertEqual(self.main(), release.EXIT_OK)
        finally:
            os.umask(previous)
        tree = self.paths.releases / NEW
        self.assertEqual(tree.stat().st_mode & 0o777, 0o755)
        self.assertEqual((tree / 'deploy/odoo/upgrade_smoke.py').stat().st_mode & 0o777, 0o644)
        npm = self.commands('ci')[0]
        self.assertEqual(npm[npm.index('--workspace') + 1], 'apps/control-plane')

    # --- first deploy -------------------------------------------------------------------------------------------
    def first_deploy(self):
        (self.state / 'served.json').unlink()
        (self.state / 'release.env').unlink()
        self.registry_file.unlink()

    def test_first_deploy_applies_without_snapshots(self):
        self.first_deploy()
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.served(), NEW)
        self.assertFalse(self.compose_stops() or self.commands('capture') or self.sql)

    def test_first_deploy_failure_stops_halts_and_stays_in_maintenance(self):
        self.first_deploy()
        self.fail_health = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'halted health_check_failed')
        self.assertTrue(self.compose_stops() and self.paths.maintenance.exists())
        self.assertEqual(self.alert_events(), ['deploy_failed'])
        self.assertEqual(self.main(), release.EXIT_HALTED)

    # --- prune ----------------------------------------------------------------------------------------------------
    def test_commit_prunes_everything_older_than_the_previous_release(self):
        (self.paths.releases / ANCIENT).mkdir()
        (self.paths.releases / f'{ANCIENT}.partial').mkdir()
        release.write_json(self.state / f'releases/{ANCIENT}.json', {'images': [f'{REGISTRY}/liwan-odoo@sha256:{"1" * 64}']})
        release.write_json(self.state / f'releases/{OLD}.json', {'images': [f'liwan-odoo:{OLD}']})
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertFalse((self.paths.releases / ANCIENT).exists() or (self.paths.releases / f'{ANCIENT}.partial').exists())
        self.assertFalse((self.state / f'releases/{ANCIENT}.json').exists())
        self.assertTrue((self.paths.releases / OLD).exists() and (self.paths.releases / NEW).exists())
        self.assertTrue((self.state / f'releases/{OLD}.json').exists() and (self.state / f'releases/{NEW}.json').exists())
        removed = [call for call in self.runner.calls if call[:3] == ['docker', 'image', 'rm']]
        self.assertEqual(removed, [['docker', 'image', 'rm', f'{REGISTRY}/liwan-odoo@sha256:{"1" * 64}']])

    def test_a_rolled_back_run_prunes_nothing(self):
        (self.paths.releases / ANCIENT).mkdir()
        self.fail_health = True
        self.main()
        self.assertTrue((self.paths.releases / ANCIENT).exists())

    # --- review fixes -------------------------------------------------------------------------------------------
    def test_a_candidate_that_failed_after_the_stop_is_not_retried_until_rollback_clears_it(self):
        self.fail_health = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        failed = json.loads((self.state / 'failed.json').read_text())
        self.assertEqual((failed['commit'], failed['reason']), (NEW, 'health_check_failed'))
        self.runner.calls.clear()
        self.assertEqual(self.main(), release.EXIT_HALTED)  # red in the job, nothing touched
        self.assertEqual(self.result(), f'nothing to do: {NEW} failed before (health_check_failed); run "rollback" to try it again')
        self.assertFalse(self.compose_stops() or self.commands('capture'))
        self.head = 'c' * 40  # a new candidate is tried
        self.document = document(self.head)
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.served(), 'c' * 40)

    def test_rollback_command_clears_the_failed_candidate(self):
        release.write_json(self.state / 'failed.json', {'commit': NEW, 'reason': 'x'})
        self.assertEqual(self.main('rollback', '--environment', 'development'), release.EXIT_OK)
        self.assertFalse((self.state / 'failed.json').exists())
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.served(), NEW)

    def test_a_failure_before_the_snapshot_is_recorded_too(self):
        original = self.runner.answer
        self.runner.answer = lambda argv, stdin: (1, 'store down') if 'capture' in argv else original(argv, stdin)
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(json.loads((self.state / 'failed.json').read_text())['reason'], 'backup_failed')

    def test_registry_entry_without_tenant_id_is_refused_before_the_worker_stops(self):
        self.tenant_entry = {'database': 'tenant_one', 'filestore': 'tenant_one'}
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused invalid_tenant_registry')
        self.assertFalse(self.commands('systemctl') or self.compose_stops())
        self.assertFalse((self.state / 'run.json').exists())

    def test_an_unexpected_error_prints_a_result_line_and_leaves_the_run_resumable(self):
        original = self.runner.answer

        def broken(argv, stdin):
            if 'capture' in argv:
                raise RuntimeError('boom')
            return original(argv, stdin)
        self.runner.answer = broken
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'failed unexpected_error RuntimeError')
        self.assertEqual(json.loads((self.state / 'run.json').read_text())['phase'], 'captured')

    def test_a_failure_after_the_marker_phase_is_incomplete_and_never_rolls_back(self):
        with mock.patch.object(release.Releaser, 'leave_maintenance', side_effect=OSError('disk')):
            self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertTrue(self.result().startswith(f'incomplete {NEW}'))
        self.assertEqual(json.loads((self.state / 'run.json').read_text())['phase'], 'opened')
        self.assertFalse(self.renames())
        self.assertEqual(os.readlink(self.paths.current), str(self.paths.releases / NEW))
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.served(), NEW)

    def test_status_answers_while_a_run_holds_the_lock(self):
        with open(self.state / 'lock', 'a+') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with mock.patch('sys.stdout', new=io.StringIO()) as out:
                self.assertEqual(self.main('status', '--environment', 'development'), release.EXIT_OK)
        self.assertEqual(json.loads(out.getvalue())['served']['commit'], OLD)

    def test_commit_prunes_run_folders_of_older_releases(self):
        for commit in (ANCIENT, OLD):
            (self.state / 'runs' / commit).mkdir(parents=True)
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertFalse((self.state / 'runs' / ANCIENT).exists())
        self.assertTrue((self.state / 'runs' / OLD).exists() and (self.state / 'runs' / NEW).exists())


    def test_a_failing_child_that_echoes_a_config_secret_is_masked_in_the_log(self):
        log = make_log([USER, TOKEN], self.log_stream)

        class TailingRunner(FakeRunner):  # logs the output tail of a failed command like deploy.release.common.Runner
            def __call__(inner, argv, **kwargs):  # noqa: N805
                try:
                    return super().__call__(argv, **kwargs)
                except CommandFailed:
                    log('  ' + inner.last_output)
                    raise

            def answer(inner, argv, stdin):  # noqa: N805
                if 'capture' in argv:
                    inner.last_output = f'db password {SECRET} and s3 {BACKUP_SECRET} and token {TOKEN}'
                    return 1, inner.last_output
                return super().answer(argv, stdin)
        runner = TailingRunner(self)
        release.main(['run', '--environment', 'development'], paths=self.paths, runner=runner, log=log,
                     environ=self.environ, machine=self.machine)
        logged = self.log_stream.getvalue()
        self.assertIn('db password *** and s3 *** and token ***', logged)
        for secret in (SECRET, BACKUP_SECRET, TOKEN):
            self.assertNotIn(secret, logged)

    def test_quoted_and_url_secrets_are_masked_without_their_quotes_or_user_info(self):
        env = self.root / 'quoted.env'
        env.write_text('FOO_PASSWORD="quoted-secret-1"\nBAR_TOKEN=\'single-secret-2\'\n'
                       'DATABASE_URL=postgres://dbuser:url-password-3@db:5432/x\nPLAIN=visible-value\n')
        values = sensitive_values(read_env_file(env))
        self.assertIn('quoted-secret-1', values)
        self.assertIn('single-secret-2', values)
        self.assertIn('url-password-3', values)
        self.assertNotIn('visible-value', values)
        log = make_log(values, self.log_stream)
        log('tail: quoted-secret-1 single-secret-2 url-password-3 visible-value')
        self.assertIn('tail: *** *** *** visible-value', self.log_stream.getvalue())

    def test_production_refuses_a_tag_that_is_not_on_main(self):
        self.use_production(OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.7': NEW}
        self.on_main = False
        self.assertEqual(self.main('run', '--environment', 'production'), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused not_on_main')
        self.assertFalse(self.compose_stops() or self.product_pulls())
        self.on_main = True
        self.assertEqual(self.main('run', '--environment', 'production'), release.EXIT_OK)

    # --- registry and tenants ---------------------------------------------------------------------------------------
    def test_invalid_registry_entries_are_refused_before_anything_stops(self):
        bad = [{'tenantId': 't1', 'database': 'Bad-Name;', 'filestore': 'Bad-Name;'},
               {'tenantId': 't1', 'database': 'tenant_one', 'filestore': '../etc'},
               {'tenantId': 't1', 'database': 'tenant_one', 'filestore': 'other_one'}]
        for entry in bad:
            with self.subTest(entry=entry):
                self.runner.calls.clear()
                self.tenant_entry = entry
                self.assertEqual(self.main(), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused invalid_tenant_registry')
                self.assertFalse(self.compose_stops() or self.commands('capture'))

    def test_document_missing_a_published_image_is_refused(self):
        self.builds = BUILDS + f'{REGISTRY}/liwan-control-plane\tliwan-control-plane\tcontrol\tD\t.\t\n'
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused document_images_mismatch')
        self.assertFalse(self.compose_stops())


if __name__ == '__main__':
    unittest.main()
