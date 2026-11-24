"""Tests for deploy/release/release.py with a fake command runner: no docker, git, psql or network is used."""
from __future__ import annotations

import base64
import contextlib
import fcntl
import fnmatch
import hashlib
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from deploy.release import databases, proof, release
from deploy.stack import render as stack_render
from deploy.release.common import CommandFailed, Runner, make_log, read_env_file, sensitive_values, unsafe_shared_file
from deploy.release.test_proof import fake_owner_lstat

OLD = 'a' * 40
NEW = 'b' * 40
ANCIENT = '9' * 40
ANNOTATION_OBJECT = 'f' * 40
SECRET = 'db-password-never-logged'
BACKUP_SECRET = 'backup-token-never-logged'
TOKEN = 'ghcr-token-never-logged'
GITHUB_TOKEN = 'github-token-never-logged'
USER = 'release-reader'
REGISTRY = 'ghcr.io/tariiq222'
AMD64 = 'sha256:' + 'a' * 64
ARM64 = 'sha256:' + 'b' * 64
REFERENCES = ('liwan-guard', 'liwan-odoo', 'liwan-web')
BUILDS = ''.join(f'{REGISTRY}/{name}\t{name}\t{name[6:]}\tDockerfile\t.\t\n' for name in REFERENCES) \
    + '-\tliwan-vendor-admin\tvendor-admin\tDockerfile\t.\t\n'
RELEASE_MANIFEST_IMAGE = {'odoo': 'liwan-odoo', 'web': 'liwan-web', 'guard': 'liwan-guard'}


def document(commit, platforms=('linux/amd64', 'linux/arm64')):
    first = {'linux/amd64': AMD64, 'linux/arm64': ARM64}[platforms[0]]
    images = {reference: f'{REGISTRY}/{reference}@{first}' for reference in REFERENCES}
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


REPOSITORY = Path(release.__file__).resolve().parents[2]
RENDERED = release.RENDERED_MARKER + '\n'
POLICY = 'LIWAN_RELEASE_TAG_POLICY=highest\n'


def seed_stack(checkout):
    """The stack definition a real checkout holds: the release renders its own template, not the running code's."""
    for name in STACK_FILES:
        (checkout / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPOSITORY / name, checkout / name)


def seed_pre_stack(checkout):
    """A release folder made before the stack definition existed: no renderer, only its old compose files."""
    (checkout / 'deploy').mkdir(parents=True, exist_ok=True)
    (checkout / 'deploy/docker-compose.yml').write_text('services: {}\n')


def stub_renderer(checkout, marker, contract=1, require=None, manifest_name='stack.json'):
    """A renderer of its own that writes distinct markers into the bundle, as that release's code would."""
    render = checkout / 'deploy/stack/render.py'
    render.parent.mkdir(parents=True, exist_ok=True)
    for init in (checkout / 'deploy/__init__.py', checkout / 'deploy/stack/__init__.py'):
        init.write_text('')
    render.write_text(f"""import json, os, pathlib, sys
argv = sys.argv[1:]
out = pathlib.Path(argv[argv.index('--out') + 1])
env = [pathlib.Path(argv[i + 1]) for i, word in enumerate(argv) if word == '--env-file']
text = ''.join(path.read_text() for path in env)
if {require!r} and {require!r} not in text:
    sys.stderr.write('render: {require} is missing from the env file (true or false)\\n')
    raise SystemExit(1)
(out / 'compose.yml').write_text('marker {marker}\\n')
(out / 'sizing.env').write_text('SIZING_MARKER={marker}\\n')
(out / 'odoo.conf').write_text({release.RENDERED_MARKER!r} + '\\n[options]\\nmarker = {marker}\\n')
(out / {manifest_name!r}).write_text(json.dumps(dict(contract={contract!r}, compose='compose.yml', envFiles=['sizing.env'],
                                          odooConf='odoo.conf', projectDirectory='deploy')))
""")


STACK_FILES = ('deploy/__init__.py', 'deploy/odoo_sizing.py', 'deploy/release/__init__.py', 'deploy/release/common.py',
               'deploy/stack/__init__.py', 'deploy/stack/render.py', 'deploy/stack/compose.yml', 'deploy/stack/odoo.conf.template')


def write_smoke(checkout):
    smoke = checkout / 'deploy/odoo/upgrade_smoke.py'
    smoke.parent.mkdir(parents=True, exist_ok=True)
    smoke.write_text("print('UPGRADE_SMOKE_OK')\n")
    seed_stack(checkout)


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
        if statement.startswith('DO $$') and 'privileged_or_missing_role' in statement:
            return 'privileged_or_missing_role' if case.runtime_role_violation else None
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


def ls_remote_lines(case, patterns):
    """What real git answers: a ref line per matching pattern, and the peeled ``^{}`` line of an annotated tag only
    for a pattern that matches it (a glob does, an exact tag name does not)."""
    for tag, commit in case.tags.items():
        annotated = tag in case.annotated
        for pattern in patterns:
            if fnmatch.fnmatchcase(f'refs/tags/{tag}', pattern):
                yield f'{ANNOTATION_OBJECT if annotated else commit}\trefs/tags/{tag}\n'
            if annotated and fnmatch.fnmatchcase(f'refs/tags/{tag}^{{}}', pattern):
                yield f'{commit}\trefs/tags/{tag}^{{}}\n'


class FakeRunner:
    """Answers each command from a small table and records every argv, stdin and environment it was given."""

    def __init__(self, case):
        self.case = case
        self.calls = []
        self.stdins = []
        self.envs = []
        self.timeouts = []
        self.cwds = []
        self.renders = []
        self.compose_files = []

    def __call__(self, argv, *, stdin=None, env=None, check=True, timeout=None, cwd=None):
        self.calls.append(argv)
        self.cwds.append(cwd)
        if argv[:2] == ['docker', 'compose'] and '-f' in argv and Path(argv[argv.index('-f') + 1]).parent.parent.name == 'stack':
            self.compose_files.append((argv, Path(argv[argv.index('-f') + 1]).read_text()))  # the render each command ran on
        self.stdins.append(stdin)
        self.envs.append(env)
        self.timeouts.append(timeout)
        self.last_env = env
        code, output = self.answer(argv, stdin or '')
        if check and code != 0:
            raise CommandFailed(argv, code)
        return code, output

    def answer(self, argv, stdin):
        case = self.case
        joined = ' '.join(argv)
        if argv[:4] == ['python3', '-B', '-m', 'deploy.stack.render']:  # the checkout's own renderer, really run
            self.renders.append((Path(self.cwds[-1]).name, argv, self.last_env['PYTHONPATH']))
            done = subprocess.run(argv, cwd=self.cwds[-1], env={**self.last_env, 'PATH': os.environ['PATH']}, text=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
            return done.returncode, done.stdout
        if argv[0] == 'git':
            return self.git(argv)
        if argv[0] == 'openssl':  # the proof's signer and verifier, without a real key
            if '-sign' in argv:
                if case.proof_sign_fails:
                    return 1, 'signing failed\n'
                Path(argv[argv.index('-out') + 1]).write_bytes(b'fake-signature')
                return 0, ''
            if '-outform' in argv:  # a key as DER: the same key in another encoding is the same bytes
                source = Path(argv[argv.index('-in') + 1])
                body = source.read_bytes().replace(b'\r\n', b'\n').strip()
                pinned = body if body.startswith(b'pub:') else b'pub:' + body
                Path(argv[argv.index('-out') + 1]).write_bytes(b'der:' + pinned)
                return 0, ''
            if case.proof_verify_fails:
                return 1, 'Signature Verification Failure\n'
            return 0, 'Signature Verified Successfully\n'
        if argv[0] == 'docker' and argv[1] in ('login', 'pull', 'create', 'cp', 'rm', 'rmi', 'image'):
            return self.docker(argv)
        if 'deploy/shared/validate_odoo_config.py' in joined:  # the candidate's own validator, run on the host's file
            restore = (self.last_env or {}).get('LIWAN_RESTORE_ROLE') == '1'
            return (1, 'shared_config_rejected') if (case.restore_config_invalid if restore else case.odoo_config_invalid) else (0, '')
        if 'config' in argv and '--quiet' in argv:  # the candidate's render check: silent, as the release.env it names says
            env_file = Path(argv[len(argv) - 1 - argv[::-1].index('--env-file') + 1])
            case.candidate_renders.append((argv, env_file.read_text()))
            return (1, f'required variable {case.missing_required} is missing a value: set it') \
                if case.missing_required else (0, '')
        if 'config' in argv and '--output' in argv:  # `compose config --output <file>`: the stack as the release.env names it
            tag = re.search(r'LIWAN_IMAGE_TAG=(\w+)', (case.state / 'release.env').read_text()).group(1)
            Path(argv[argv.index('--output') + 1]).write_text(json.dumps({'services': {}, 'imageTag': tag}))
            failing = {NEW: case.fail_render, OLD: case.fail_restore_render}
            return (1, 'render failed') if failing.get(tag) else (0, '')
        if '--initialize-control' in argv:
            return (1, 'AI initialization failed') if case.fail_ai_initialization else (0, '')
        if argv[0] == 'npm':  # npm writes its hidden lockfile last, so it marks a complete install
            if case.fail_npm:
                (Path(argv[argv.index('--prefix') + 1]) / 'node_modules').mkdir(exist_ok=True)  # a half-installed tree
                return 1, 'npm ERR! network'
            marker = Path(argv[argv.index('--prefix') + 1]) / release.DEPENDENCY_MARKER
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text('{}')
            return 0, ''
        if argv[0] == 'tar':
            checkout = Path(argv[argv.index('-C') + 1])
            write_smoke(checkout)
            if case.candidate_stack is not None:
                case.candidate_stack(checkout)
            return 0, ''
        if argv[0] == 'cp':  # cp -al <filestore> <filestore>.pre
            shutil.copytree(argv[2], argv[3])
            return 0, ''
        if 'deploy/image_pins.py' in joined:
            return 0, case.external if '--print-external' in argv else case.builds
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
            if case.db_restarting:
                return 1, 'Error response from daemon: Container abc is restarting, wait until the container is running'
            if case.db_unreachable:
                return 1, ('psql: error: connection to server at "127.0.0.1", port 15433 failed: Connection refused\n'
                           '\tIs the server running on that host and accepting TCP/IP connections?')
            if case.admin_role_missing and argv[argv.index('-U') + 1] == 'postgres':
                return 2, 'FATAL: role "postgres" does not exist'  # a volume made before the two roles existed
            if case.admin_password_wrong and argv[argv.index('-U') + 1] == 'postgres':
                return 2, ('psql: error: connection to server at "127.0.0.1", port 15433 failed: FATAL:  '
                           'password authentication failed for user "postgres"')
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
            return case.alert_result
        return 0, ''

    def git(self, argv):
        case = self.case
        if 'ls-remote' in argv:
            patterns = argv[argv.index('ls-remote') + 2:]
            return 0, ''.join(ls_remote_lines(case, patterns))
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
        if argv[1] == 'pull' and case.pull_failures.get(argv[-1], 0) > 0:
            case.pull_failures[argv[-1]] -= 1
            return 1, 'connection reset by peer'
        if argv[1] == 'create':
            return 0, 'container-1\n'
        if argv[1] == 'cp':
            # The release document as the registry published it; `document_raw` lets a test choose the exact bytes.
            raw = case.document_raw if case.document_raw is not None else json.dumps(case.document).encode()
            Path(argv[3]).write_bytes(raw)
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
        sleeper = mock.patch.object(release.time, 'sleep')
        self.sleeps = sleeper.start()
        self.sleep_marks = []
        self.sleeps.side_effect = self.record_sleep
        self.addCleanup(sleeper.stop)
        self.environ = {'PATH': '/usr/bin', 'LIWAN_GHCR_READ_USER': USER, 'LIWAN_GHCR_READ_TOKEN': TOKEN}
        self.paths = release.Paths(config_root=root / 'etc', state_root=root / 'state', releases=root / 'releases',
                                   current=root / 'current', maintenance=root / 'maintenance/active')
        self.state = self.paths.state_root / 'staging'
        self.tenant_names = ['tenant_one']
        for name in ('tenant_one', 'tenant_two'):
            (root / 'data/filestore' / name).mkdir(parents=True)
            (root / 'data/filestore' / name / 'f').write_text('old')
        (root / 'control-state/classifications').mkdir(parents=True)
        shared_env = root / 'shared.env'
        self.odoo_config = root / 'odoo.conf'
        self.odoo_config.write_text(RENDERED + '[options]\n')  # a config this command rendered earlier
        self.vendor_env = root / 'vendor-admin.env'
        self.vendor_env.write_text(f'NUXT_SERVICE_KEY={SECRET}\n')
        shared_text = (f'LIWAN_TENANT_REGISTRY_DIR={root}/registry\nLIWAN_SHARED_COMPOSE_FILE={root}/shared.compose.json\n'
                       f'LIWAN_SHARED_ODOO_CONFIG={self.odoo_config}\nLIWAN_VENDOR_ADMIN_ENV_FILE={self.vendor_env}\n'
                       f'DB_PASSWORD={SECRET}\nLIWAN_ODOO_ADMIN_PASSWD=$pbkdf2-sha512$1$c2FsdA$aGFzaA\n'
                       f'LIWAN_CONTROL_STATE_DIR={root}/control-state\n'
                       'LIWAN_STACK_COMMERCIAL_EDGE=true\nLIWAN_STACK_DB_HOST_LINK=true\n')
        shared_env.write_text(shared_text + 'LIWAN_RELEASE_TAG_POLICY=highest\n')
        (root / 'shared-production.env').write_text(shared_text + 'LIWAN_RELEASE_TAG_POLICY=explicit\n')
        self.write_config(shared_env, 'staging')
        self.write_config(root / 'shared-production.env', 'production')
        self.paths.releases.mkdir()
        (self.paths.releases / OLD).mkdir()
        seed_stack(self.paths.releases / OLD)
        self.paths.current.symlink_to(self.paths.releases / OLD)
        self.tags, self.ancestor, self.published, self.fetched = {'release/19.0.1.0.7': NEW}, True, True, True
        self.annotated = set()
        self.on_main = True
        self.fail_health, self.fail_upgrade_of = False, None
        self.candidate_stack = None  # a hook that dresses the extracted candidate checkout (a stub renderer, say)
        self.fail_render, self.fail_restore_render = False, False
        self.missing_required, self.candidate_renders, self.odoo_config_invalid = None, [], False
        self.restore_config_invalid = False
        self.document = document(NEW)
        self.document_raw = None  # the exact bytes of the release document, when a test needs them
        self.alerts, self.sql = [], []
        self.builds = BUILDS
        self.external = ''
        self.fail_npm = False
        self.fail_ai_initialization = False
        self.pull_failures = {}
        self.alert_result = (0, '')
        self.worker_ready = True
        self.worker_started_after_served = []
        self.expected_worker_commit = NEW
        self.tenant_entry = None
        self.registry_file = root / 'registry/registry.json'
        self.registry_file.parent.mkdir()
        self.registry_file.write_text('{}')
        self.stop_at_create = False
        self.fail_create = False
        self.runtime_role_violation = False
        self.admin_role_missing = False
        self.admin_password_wrong = False
        self.db_unreachable = False
        self.db_restarting = False
        self.proof_verify_fails = False
        self.proof_sign_fails = False
        self.postgres = FakePostgres()
        self.runner = FakeRunner(self)
        self.log_stream = io.StringIO()
        self.serve(OLD)

    def record_sleep(self, seconds):
        """Where in the command sequence a pause happened: the number of commands run before it."""
        self.sleep_marks.append((len(self.runner.calls), seconds))

    def write_config(self, shared_env, environment):
        self.paths.config_root.mkdir(exist_ok=True)
        config = self.paths.config_root / f'{environment}.env'
        config.write_text(
            'LIWAN_RELEASE_PROJECT=liwan\n'
            f'LIWAN_SHARED_ENV_FILE={shared_env}\n'
            'LIWAN_RELEASE_PG_DUMP=/usr/bin/pg_dump\nLIWAN_RELEASE_PG_HOST=127.0.0.1\n'
            'LIWAN_RELEASE_CONTROL_PG_HOST=127.0.0.1\n'
            f'LIWAN_RELEASE_ODOO_DATA_DIR={self.root}/data\nLIWAN_RELEASE_DISK_PATH={self.root}\n'
            f'LIWAN_BACKUP_S3_SECRET={BACKUP_SECRET}\n')
        config.chmod(0o600)

    def filestore(self, database):
        return self.root / 'data/filestore' / database

    def serve(self, commit, version=(1, 0, 6)):
        self.state.mkdir(parents=True, exist_ok=True)
        release.write_json(self.state / 'served.json', {'commit': commit, 'ref': 'refs/tags/release/19.0.1.0.6', 'version': list(version),
                                                        'odooCommit': 'e' * 40})
        release.write_atomic(self.state / 'release.env', release.release_env_text(commit, 'e' * 40))

    def main(self, *argv, environ=None):
        log = make_log([USER, TOKEN], self.log_stream)
        return release.main(list(argv) or ['run', '--environment', 'staging'], paths=self.paths, runner=self.runner,
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

    def test_candidate_comes_from_github_and_the_document_from_ghcr(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        listing = next(call for call in self.runner.calls if 'ls-remote' in call)
        self.assertEqual(listing[-2:], ['https://github.com/tariiq222/liwan.git', 'refs/tags/release/*'])
        docker = [call for call in self.runner.calls if call[0] == 'docker'][:6]
        self.assertEqual(docker[0], ['docker', 'login', 'ghcr.io', '--username', USER, '--password-stdin'])
        self.assertEqual(docker[1], ['docker', 'pull', '--quiet', f'{REGISTRY}/liwan-release:{NEW}'])
        self.assertEqual(docker[2], ['docker', 'create', f'{REGISTRY}/liwan-release:{NEW}', '/release.json'])
        self.assertEqual(docker[3][:2], ['docker', 'cp'])
        self.assertEqual(docker[4], ['docker', 'rm', 'container-1'])

    def test_no_change_stops_nothing(self):
        self.tags = {'release/19.0.1.0.7': OLD}
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
        for foreign in ('registry.example.test/liwanos', 'docker.io/tariiq222', 'ghcr.io/someone', 'ghcr.io.evil.test/tariiq222'):
            with self.subTest(registry=foreign):
                self.document['images']['liwan-odoo'] = f'{foreign}/liwan-odoo@{AMD64}'
                self.assertEqual(self.main(), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused document_invalid')
                self.assertFalse(self.product_pulls())

    # --- refusals before anything runs -------------------------------------------------------------------
    def test_missing_credential_is_refused_before_any_command(self):
        for names in (('LIWAN_GHCR_READ_TOKEN',), ('LIWAN_GHCR_READ_USER',),
                      ('LIWAN_GHCR_READ_USER', 'LIWAN_GHCR_READ_TOKEN')):
            with self.subTest(missing=names):
                self.log_stream.truncate(0)
                environ = {key: value for key, value in self.environ.items() if key not in names}
                self.assertEqual(self.main(environ=environ), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused missing_credential')
                self.assertIn('LIWAN_GHCR_READ_TOKEN in the job secrets', self.log_stream.getvalue())
        self.assertEqual(self.runner.calls, [])

    def test_unknown_environment_and_loose_config_are_refused(self):
        for name in ('Bad_Name', '../staging', 'x' * 40):
            self.assertEqual(self.main('run', '--environment', name), release.EXIT_REFUSED)
            self.assertEqual(self.result(), 'refused invalid_environment')
        for name in ('unknown', 'development'):  # an environment exists when its config file does
            self.assertEqual(self.main('run', '--environment', name), release.EXIT_REFUSED)
            self.assertEqual(self.result(), 'refused missing_config')
        (self.paths.config_root / 'staging.env').chmod(0o644)
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

    def test_an_arm64_server_accepts_an_arm64_only_document_and_one_listing_both(self):
        self.machine = 'aarch64'
        for platforms in (('linux/arm64',), ('linux/amd64', 'linux/arm64')):
            with self.subTest(platforms=platforms):
                self.document = document(NEW, platforms=platforms)
                self.assertEqual(self.main(), release.EXIT_OK)
                self.serve(OLD)

    def test_production_refuses_a_document_without_arm64_even_on_an_amd64_host(self):
        self.use_production(OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.7': NEW}
        self.document = document(NEW, platforms=('linux/amd64',))
        self.assertEqual(self.main('run', '--environment', 'production', '--tag', self.tag), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused document_invalid')
        self.assertIn('has no linux/arm64 image', self.log_stream.getvalue())
        self.assertFalse(self.compose_stops())

    def use_environment(self, environment, commit, version):
        self.state = self.paths.state_root / environment
        self.serve(commit, version=version)

    tag = 'release/19.0.1.0.7'

    def use_production(self, commit, version):
        """Production is `explicit`, so it always verifies a proof: its config holds the staging pair and staging answers
        with a proof of the candidate. The body is built at fetch time, because a test may replace the document first."""
        self.use_environment('production', commit, version)
        self.require_proof('production')
        fetch = mock.patch.object(proof, 'https_get', side_effect=lambda url: self.proof_body())
        fetch.start()
        self.addCleanup(fetch.stop)

    # --- production candidate -------------------------------------------------------------------------------
    def test_production_applies_exactly_the_given_tag_even_when_a_higher_one_exists(self):
        self.use_production(OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.10': 'c' * 40, 'release/19.0.1.0.7': NEW, 'not-a-release': 'd' * 40}
        self.assertEqual(self.main('run', '--environment', 'production', '--tag', 'release/19.0.1.0.7'), release.EXIT_OK)
        listing = next(call for call in self.runner.calls if 'ls-remote' in call)
        self.assertEqual(listing[-2], 'refs/tags/release/19.0.1.0.7')
        self.assertEqual(self.served(), NEW)
        self.assertEqual(json.loads((self.state / 'served.json').read_text())['version'], [1, 0, 7])

    def test_production_refuses_a_lower_or_equal_version(self):
        self.use_production(OLD, [1, 0, 6])
        for tag in ('release/19.0.1.0.5', 'release/19.0.1.0.6'):
            with self.subTest(tag=tag):
                self.tags = {tag: NEW}
                self.assertEqual(self.main('run', '--environment', 'production', '--tag', tag), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused older_candidate')
        self.assertFalse(self.compose_stops())

    def test_production_without_a_tag_is_refused_before_any_command(self):
        self.use_production(OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.7': NEW}
        self.assertEqual(self.main('run', '--environment', 'production'), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused tag_required')
        self.assertEqual(self.runner.calls, [])

    def test_production_resolves_annotated_and_lightweight_tags_to_their_commit(self):
        for annotated in (True, False):
            with self.subTest(annotated=annotated):
                self.runner.calls.clear()
                self.use_production(OLD, [1, 0, 6])
                self.tags = {'release/19.0.1.0.7': NEW}
                self.annotated = {'release/19.0.1.0.7'} if annotated else set()
                self.assertEqual(self.main('run', '--environment', 'production', '--tag', 'release/19.0.1.0.7'),
                                 release.EXIT_OK)
                self.assertEqual(self.served(), NEW)
                listing = next(call for call in self.runner.calls if 'ls-remote' in call)
                self.assertEqual(listing[-2:], ['refs/tags/release/19.0.1.0.7', 'refs/tags/release/19.0.1.0.7^{}'])
                self.assertIn(['docker', 'pull', '--quiet', f'{REGISTRY}/liwan-release:{NEW}'], self.runner.calls)

    def test_staging_resolves_an_annotated_tag_to_its_commit(self):
        self.use_environment('staging', OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.7': NEW}
        self.annotated = {'release/19.0.1.0.7'}
        self.assertEqual(self.main('run', '--environment', 'staging'), release.EXIT_OK)
        self.assertEqual(self.served(), NEW)

    def test_production_refuses_a_malformed_tag_before_any_command(self):
        self.use_production(OLD, [1, 0, 6])
        for tag in ('main', 'release/19.0.1.0', 'release/19.0.1.0.7.1', 'v1.0.7', 'refs/tags/release/19.0.1.0.7', '',
                    'release/19.0.1.0.7\n', 'release/19.0.\u0661.0.7', 'release/19.0.01.0.7', 'release/19.0.1.0.07'):
            with self.subTest(tag=tag):
                self.assertEqual(self.main('run', '--environment', 'production', '--tag', tag), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused invalid_tag')
        self.assertEqual(self.runner.calls, [])

    def test_production_refuses_a_tag_that_does_not_exist_before_any_image_is_pulled(self):
        self.use_production(OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.8': NEW}
        self.assertEqual(self.main('run', '--environment', 'production', '--tag', 'release/19.0.1.0.7'), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused tag_not_found')
        self.assertFalse(self.commands('fetch') or self.product_pulls() or self.compose_stops())
        self.assertFalse([call for call in self.runner.calls if call[:2] == ['docker', 'pull']])

    def test_a_repeated_tag_is_refused_not_last_wins(self):
        self.use_production(OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.7': NEW, 'release/19.0.1.0.8': 'c' * 40}
        self.assertEqual(self.main('run', '--environment', 'production', '--tag', 'release/19.0.1.0.7',
                                   '--tag', 'release/19.0.1.0.8'), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused tag_repeated')
        self.assertEqual(self.runner.calls, [])

    def test_a_tag_is_refused_for_staging_and_the_other_commands(self):
        self.tags = {'release/19.0.1.0.7': NEW}
        for argv, reason in ((('run', '--environment', 'staging', '--tag', 'release/19.0.1.0.7'), 'tag_not_allowed'),
                             (('rollback', '--environment', 'production', '--tag', 'release/19.0.1.0.7'), 'tag_not_allowed'),
                             (('status', '--environment', 'production', '--tag', 'release/19.0.1.0.7'), 'tag_not_allowed')):
            with self.subTest(argv=argv):
                self.assertEqual(self.main(*argv), release.EXIT_REFUSED)
                self.assertEqual(self.result(), f'refused {reason}')
        self.assertEqual(self.runner.calls, [])

    # --- staging candidate (the same release tags as production) -----------------------------------------
    def test_staging_applies_the_highest_release_tag(self):
        self.use_environment('staging', OLD, [1, 0, 6])
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

    def test_an_arm64_server_refuses_an_amd64_only_document(self):
        self.machine = 'aarch64'
        self.use_environment('staging', OLD, [1, 0, 6])
        self.tags = {'release/19.0.1.0.7': NEW}
        self.document = document(NEW, platforms=('linux/amd64',))
        self.assertEqual(self.main('run', '--environment', 'staging'), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused document_invalid')
        self.assertIn('has no linux/arm64 image', self.log_stream.getvalue())
        self.assertFalse(self.product_pulls() or self.compose_stops())

    def test_the_document_is_pulled_fresh_and_removed_after_every_read(self):
        for _ in range(2):
            self.runner.calls.clear()
            self.assertEqual(self.main(), release.EXIT_OK)
            image = f'{REGISTRY}/liwan-release:{NEW}'
            self.assertIn(['docker', 'pull', '--quiet', image], self.runner.calls)
            self.assertIn(['docker', 'rmi', image], self.runner.calls)
            self.serve(OLD)

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

    # --- the staging proof ---------------------------------------------------------------------------------
    def public_key(self):
        path = self.root / 'release-proof.pub'
        path.write_text('the fake verifier never reads this\n', encoding='ascii')
        path.chmod(0o644)
        return path

    def add_config(self, lines, environment='staging'):
        config = self.paths.config_root / f'{environment}.env'
        config.write_text(config.read_text() + lines)

    def require_proof(self, environment='staging'):
        """The verifying environment: a proof URL and the pinned public key, as production will hold them."""
        self.add_config(f'{release.PROOF_URL_KEY}=https://staging.example/_liwan/release-proof/\n'
                        f'{release.PROOF_PUBLIC_KEY_KEY}={self.public_key()}\n', environment)

    def sign_proof(self, directory=None):
        """The signing environment: its private key and the directory the edge serves."""
        key = self.root / 'release-proof.key'
        key.write_text('the fake signer never reads this\n', encoding='ascii')
        key.chmod(0o600)
        if directory is None:
            directory = self.root / 'served-proof'
            directory.mkdir()
        self.proof_dir = Path(directory)
        self.add_config(f'{release.PROOF_KEY_FILE_KEY}={key}\n{release.PROOF_DIR_KEY}={self.proof_dir}\n')

    def proof_body(self, **changes):
        """A proof file for the candidate, signing the document FakeRunner writes out of the document image."""
        payload = {'tag': 'release/19.0.1.0.7', 'commit': NEW, 'environment': 'staging',
                   'releaseDocumentDigest': proof.document_digest(json.dumps(self.document).encode()),
                   'at': '2026-11-24T10:00:00+00:00'}
        payload.update(changes)
        return proof.canonical({'contract': proof.CONTRACT, 'payload': payload,
                                'signature': base64.b64encode(b'fake-signature').decode('ascii')})

    def pulls(self):
        return [call for call in self.runner.calls if call[:2] == ['docker', 'pull']]

    def test_a_missing_staging_proof_refuses_before_anything_stops_or_is_recorded(self):
        self.require_proof()
        with mock.patch.object(proof, 'https_get',
                               side_effect=proof.ProofError(proof.PROOF_MISSING, 'the proof URL answers HTTP 404')):
            self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused staging_proof_missing')
        self.assertIn(NEW, self.log_stream.getvalue())
        self.assertNotIn('staging.example', self.log_stream.getvalue())  # the URL is masked in the log
        self.assertEqual(self.pulls(), [])  # before the document image and every product image
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('systemctl'), [])
        self.assertFalse((self.state / 'run.json').exists() or (self.state / 'failed.json').exists())
        self.assertEqual(self.served(), OLD)

    def test_an_invalid_staging_proof_refuses_before_anything_stops_or_is_recorded(self):
        self.require_proof()
        cases = {'wrong tag': (self.proof_body(tag='release/19.0.1.0.8'), False),
                 'wrong commit': (self.proof_body(commit=OLD), False),
                 'wrong document digest': (self.proof_body(releaseDocumentDigest='0' * 64), False),
                 'signature no pinned key made': (self.proof_body(), True)}
        for name, (body, verify_fails) in cases.items():
            with self.subTest(name):
                self.runner.calls.clear()
                self.proof_verify_fails = verify_fails
                with mock.patch.object(proof, 'https_get', return_value=body):
                    self.assertEqual(self.main(), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused staging_proof_invalid')
                self.assertEqual(self.compose_stops(), [])
                self.assertEqual(self.commands('systemctl'), [])
                self.assertFalse((self.state / 'run.json').exists() or (self.state / 'failed.json').exists())
                self.assertEqual(self.served(), OLD)

    def test_a_valid_staging_proof_lets_the_release_through(self):
        self.require_proof()
        with mock.patch.object(proof, 'https_get', return_value=self.proof_body()) as fetch:
            self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(fetch.call_args[0], (f'https://staging.example/_liwan/release-proof/{NEW}.json',))
        self.assertIn('-verify', next(call for call in self.runner.calls if call[0] == 'openssl'))
        self.assertEqual(self.served(), NEW)

    def test_without_a_proof_pair_nothing_is_fetched_signed_or_checked(self):
        with mock.patch.object(proof, 'https_get') as fetch:
            self.assertEqual(self.main(), release.EXIT_OK)
        fetch.assert_not_called()
        self.assertFalse([call for call in self.runner.calls if call[0] == 'openssl'])
        self.assertEqual(self.served(), NEW)
        self.assertFalse((self.state / 'proof').exists())
        # A `highest` environment may release ungated, but never silently: the run says so once.
        log = self.log_stream.getvalue()
        self.assertIn(f'{release.PROOF_URL_KEY} and {release.PROOF_PUBLIC_KEY_KEY} are unset', log)
        self.assertIn('LIWAN_RELEASE_TAG_POLICY=highest', log)
        # Without a signing key it also states explicitly that it signs nothing so no environment can pin it.
        self.assertIn(f'{release.PROOF_KEY_FILE_KEY} is unset', log)
        self.assertIn('signs nothing', log)

    def test_an_explicit_environment_is_refused_without_the_proof_pair(self):
        """Production's policy names one tag, so a missing pair would release with the gate silently off."""
        config = self.paths.config_root / 'production.env'
        base = config.read_text()
        cases = {'no pair': '',
                 'url only': f'{release.PROOF_URL_KEY}=https://staging.example/_liwan/release-proof/\n',
                 'key only': f'{release.PROOF_PUBLIC_KEY_KEY}={self.public_key()}\n'}
        for name, lines in cases.items():
            with self.subTest(name):
                self.log_stream.truncate(0)
                self.log_stream.seek(0)
                self.use_environment('production', OLD, [1, 0, 6])
                self.tags = {'release/19.0.1.0.7': NEW}
                config.write_text(base + lines)
                with mock.patch.object(proof, 'https_get', side_effect=AssertionError('the gate ran')):
                    self.assertEqual(self.main('run', '--environment', 'production', '--tag', self.tag),
                                     release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused invalid_config')
                self.assertEqual(self.pulls(), [])
                self.assertFalse(self.compose_stops() or (self.state / 'run.json').exists())
                self.assertIn(release.PROOF_URL_KEY, self.log_stream.getvalue())
                self.assertIn(release.PROOF_PUBLIC_KEY_KEY, self.log_stream.getvalue())

    def test_an_explicit_environment_with_the_pair_verifies_and_releases(self):
        """The same production config with both keys is gated: the proof decides, not the environment's name."""
        self.use_environment('production', OLD, [1, 0, 6])
        self.require_proof('production')
        self.tags = {'release/19.0.1.0.7': NEW}
        with mock.patch.object(proof, 'https_get', return_value=self.proof_body()) as fetch:
            self.assertEqual(self.main('run', '--environment', 'production', '--tag', self.tag), release.EXIT_OK)
        self.assertEqual(fetch.call_args[0], (f'https://staging.example/_liwan/release-proof/{NEW}.json',))
        self.assertEqual(self.served(), NEW)

    def test_the_proof_configuration_is_a_pair_of_https_values(self):
        config = self.paths.config_root / 'staging.env'
        base = config.read_text()
        key = self.public_key()
        for lines in (f'{release.PROOF_URL_KEY}=https://staging.example/_liwan/release-proof/\n',
                      f'{release.PROOF_PUBLIC_KEY_KEY}={key}\n',
                      f'{release.PROOF_URL_KEY}=http://staging.example/_liwan/release-proof/\n'
                      f'{release.PROOF_PUBLIC_KEY_KEY}={key}\n',
                      f'{release.PROOF_URL_KEY}=/_liwan/release-proof/\n{release.PROOF_PUBLIC_KEY_KEY}={key}\n'):
            with self.subTest(lines=lines):
                config.write_text(base + lines)
                self.assertEqual(self.main(), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused invalid_config')
                self.assertEqual(self.pulls(), [])
                self.assertFalse((self.state / 'run.json').exists())

    def test_nothing_to_do_and_a_resumed_run_never_reach_the_proof_gate(self):
        self.require_proof()
        with mock.patch.object(proof, 'https_get', side_effect=AssertionError('the gate ran')) as fetch:
            self.tags = {'release/19.0.1.0.7': OLD}
            self.assertEqual(self.main(), release.EXIT_OK)
            self.assertEqual(self.result(), f'nothing to do: serving {OLD}')
            self.assertEqual(fetch.call_count, 0)
            self.tags = {'release/19.0.1.0.7': NEW}
            self.interrupted('captured')
            self.assertEqual(self.main(), release.EXIT_OK)
            self.assertEqual(fetch.call_count, 0)
        self.assertEqual(self.served(), NEW)

    def test_no_configuration_skips_a_required_proof(self):
        self.require_proof()
        self.add_config('LIWAN_RELEASE_PROOF_OPTIONAL=1\nLIWAN_RELEASE_SKIP_PROOF=true\n')
        with mock.patch.object(proof, 'https_get', side_effect=proof.ProofError(proof.PROOF_MISSING)):
            self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused staging_proof_missing')
        self.assertFalse(self.compose_stops() or self.commands('systemctl'))
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            self.main('run', '--environment', 'staging', '--skip-proof')

    def test_a_signing_environment_writes_the_proof_at_the_commit_step(self):
        self.sign_proof()
        signed_after = []
        original = self.runner.answer

        def watch(argv, stdin):
            if argv[0] == 'openssl':
                signed_after.append(json.loads((self.state / 'served.json').read_text())['commit'])
            return original(argv, stdin)

        self.runner.answer = watch
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(signed_after, [NEW])  # served.json is written before the signature
        self.assertLess(self.runner.calls.index(['systemctl', 'start', release.SHARED_WORKER_UNIT]),
                        next(i for i, call in enumerate(self.runner.calls) if call[0] == 'openssl'))
        record = json.loads((self.proof_dir / f'{NEW}.json').read_text())
        payload = record['payload']
        self.assertEqual((payload['tag'], payload['commit'], payload['environment']),
                         ('release/19.0.1.0.7', NEW, 'staging'))
        self.assertEqual(payload['releaseDocumentDigest'], proof.document_digest(json.dumps(self.document).encode()))
        self.assertRegex(payload['at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$')
        self.assertEqual(record, json.loads((self.state / f'proof/{NEW}.json').read_text()))
        self.assertEqual(stat.S_IMODE((self.proof_dir / f'{NEW}.json').stat().st_mode), 0o644)
        self.assertFalse((self.proof_dir / f'{NEW}.json.tmp').exists())

    def test_a_failed_proof_signature_is_incomplete_and_the_next_run_signs_it(self):
        self.sign_proof()
        self.proof_sign_fails = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), f'incomplete {NEW} release_proof_failed')
        self.assertEqual(json.loads((self.state / 'run.json').read_text())['phase'], 'committed')
        self.assertFalse((self.proof_dir / f'{NEW}.json').exists())
        self.proof_sign_fails = False
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.result(), f'committed {NEW}')
        self.assertTrue((self.proof_dir / f'{NEW}.json').is_file())
        self.assertFalse((self.state / 'run.json').exists())

    def test_a_signing_environment_without_its_proof_directory_is_refused_in_prepare(self):
        self.sign_proof(directory=self.root / 'absent/served-proof')
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused proof_dir_missing')
        self.assertIn(str(self.root / 'absent/served-proof'), self.log_stream.getvalue())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('systemctl'), [])
        self.assertFalse((self.state / 'run.json').exists() or (self.state / 'failed.json').exists())
        self.assertEqual(self.served(), OLD)

    def test_a_missing_or_invalid_signing_key_is_refused_in_prepare_before_anything_stops(self):
        proof_dir = self.root / 'served-proof'
        proof_dir.mkdir()
        config = self.paths.config_root / 'staging.env'
        base = config.read_text()
        real_key = self.root / 'real-signing.key'
        real_key.write_text('PRIVATE-KEY-SECRET-NEVER-LOGGED\n', encoding='ascii')
        real_key.chmod(0o600)
        symlink_key = self.root / 'link-signing.key'
        symlink_key.symlink_to(real_key)
        loose_key = self.root / 'loose-signing.key'
        loose_key.write_text('PRIVATE-KEY-SECRET-NEVER-LOGGED\n', encoding='ascii')
        loose_key.chmod(0o644)
        writable_dir = self.root / 'writable-key-dir'
        writable_dir.mkdir()
        writable_key = writable_dir / 'signing.key'
        writable_key.write_text('PRIVATE-KEY-SECRET-NEVER-LOGGED\n', encoding='ascii')
        writable_key.chmod(0o600)
        writable_dir.chmod(0o775)
        self.addCleanup(writable_dir.chmod, 0o700)
        cases = (
            ('absent', self.root / 'absent-signing.key', 'cannot be read'),
            ('symlink', symlink_key, 'symlink'),
            ('wrong mode', loose_key, 'expected 0600'),
            ('writable parent', writable_key, 'parent directory'),
        )
        for name, key_path, expected_detail in cases:
            with self.subTest(name):
                self.log_stream.truncate(0)
                self.log_stream.seek(0)
                self.runner.calls.clear()
                config.write_text(base + f'{release.PROOF_KEY_FILE_KEY}={key_path}\n'
                                         f'{release.PROOF_DIR_KEY}={proof_dir}\n')
                self.assertEqual(self.main(), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused proof_key_invalid')
                log = self.log_stream.getvalue()
                self.assertIn(expected_detail, log)
                self.assertNotIn('PRIVATE-KEY-SECRET', log)
                self.assertEqual(self.compose_stops(), [])
                self.assertEqual(self.commands('systemctl'), [])
                self.assertFalse((self.state / 'run.json').exists() or (self.state / 'failed.json').exists())
                self.assertEqual(self.served(), OLD)
        # A key owned by another user is refused in prepare too.
        self.log_stream.truncate(0)
        self.log_stream.seek(0)
        config.write_text(base + f'{release.PROOF_KEY_FILE_KEY}={real_key}\n{release.PROOF_DIR_KEY}={proof_dir}\n')
        foreign_uid = os.geteuid() + 1
        with mock.patch.object(proof.os, 'lstat', side_effect=fake_owner_lstat({os.fspath(real_key)}, foreign_uid)):
            self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused proof_key_invalid')
        self.assertIn(f'owned by uid {foreign_uid}', self.log_stream.getvalue())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.served(), OLD)

    def test_an_environment_refuses_pinning_its_own_signing_public_key(self):
        self.sign_proof()
        own_pub = self.root / 'release-proof.key.pub'
        own_pub.write_text('pub:the fake signer never reads this\n', encoding='ascii')
        own_pub.chmod(0o644)
        self.add_config(f'{release.PROOF_URL_KEY}=https://staging.example/_liwan/release-proof/\n'
                        f'{release.PROOF_PUBLIC_KEY_KEY}={own_pub}\n')
        with mock.patch.object(proof, 'https_get', side_effect=AssertionError('the gate ran')):
            self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused invalid_config')
        self.assertIn('own signing public key', self.log_stream.getvalue())
        self.assertEqual(self.pulls(), [])
        self.assertFalse((self.state / 'run.json').exists())

    def test_a_pinned_copy_of_the_own_key_is_refused_whatever_its_encoding(self):
        """The refusal is about the key, not the file: a copy in another encoding is still this environment's own key,
        and it fires with no `.pub` beside the private key (which is what a deleted or renamed one leaves behind)."""
        self.sign_proof()
        config = self.paths.config_root / 'staging.env'
        base = config.read_text()
        cases = (
            ('crlf line endings', 'pub:the fake signer never reads this\r\n'),
            ('an extra trailing newline', 'pub:the fake signer never reads this\n\n'),
            ('the public half alone', 'the fake signer never reads this'),
        )
        for name, body in cases:
            with self.subTest(name):
                self.log_stream.truncate(0)
                self.log_stream.seek(0)
                pinned = self.root / 'copied-own.pub'
                pinned.write_text(body, encoding='ascii')
                pinned.chmod(0o644)
                config.write_text(base + f'{release.PROOF_URL_KEY}=https://staging.example/_liwan/release-proof/\n'
                                         f'{release.PROOF_PUBLIC_KEY_KEY}={pinned}\n')
                with mock.patch.object(proof, 'https_get', side_effect=AssertionError('the gate ran')):
                    self.assertEqual(self.main(), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused invalid_config')
                log = self.log_stream.getvalue()
                self.assertIn('own signing public key', log)
                self.assertNotIn('the fake signer never reads this', log)
                self.assertEqual(self.pulls(), [])

    def test_a_signing_environment_may_pin_another_key(self):
        """The comparison must not over-refuse: another environment's key is exactly what the gate wants pinned."""
        self.sign_proof()
        self.require_proof()
        with mock.patch.object(proof, 'https_get', return_value=self.proof_body()):
            self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.served(), NEW)

    def test_a_signing_key_openssl_cannot_read_is_refused_rather_than_trusted(self):
        """Without the derived key no pin can be shown not to be this environment's own, so the run refuses."""
        self.sign_proof()
        pinned = self.public_key()
        self.add_config(f'{release.PROOF_URL_KEY}=https://staging.example/_liwan/release-proof/\n'
                        f'{release.PROOF_PUBLIC_KEY_KEY}={pinned}\n')
        with mock.patch.object(proof, 'public_key_der', return_value=None):
            self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused invalid_config')
        log = self.log_stream.getvalue()
        self.assertIn(release.PROOF_KEY_FILE_KEY, log)
        self.assertNotIn('the fake signer never reads this', log)
        self.assertEqual(self.pulls(), [])
        self.assertFalse((self.state / 'run.json').exists())

    def test_the_proof_digest_is_the_sha256_of_the_document_file(self):
        """The contract is sha256 of the raw bytes of `/release.json`, the same value `sha256sum` prints for that file."""
        self.sign_proof()
        raw = json.dumps(self.document).encode()
        self.document_raw = raw
        self.assertEqual(self.main(), release.EXIT_OK)
        payload = json.loads((self.proof_dir / f'{NEW}.json').read_text())['payload']
        self.assertEqual(payload['releaseDocumentDigest'], hashlib.sha256(raw).hexdigest())

    def test_a_document_with_crlf_endings_is_digested_as_stored_not_normalised(self):
        """Decoding with universal newlines would turn CRLF into LF and sign a document the registry never published."""
        self.sign_proof()
        raw = json.dumps(self.document, indent=2).replace('\n', '\r\n').encode()
        self.assertIn(b'\r\n', raw)
        self.document_raw = raw
        self.assertEqual(self.main(), release.EXIT_OK)
        digest = json.loads((self.proof_dir / f'{NEW}.json').read_text())['payload']['releaseDocumentDigest']
        self.assertEqual(digest, hashlib.sha256(raw).hexdigest())
        self.assertNotEqual(digest, hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest())

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
        self.assertEqual(self.main('rollback', '--environment', 'staging'), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back interrupted')
        self.assertFalse((self.state / 'halted.json').exists() or self.paths.maintenance.exists())
        self.assertEqual(self.served(), OLD)

    def test_rollback_command_without_an_unfinished_run_only_clears_the_halt(self):
        release.write_json(self.state / 'halted.json', {'reason': 'x'})
        self.assertEqual(self.main('rollback', '--environment', 'staging'), release.EXIT_OK)
        self.assertFalse((self.state / 'halted.json').exists())
        self.assertEqual(self.runner.calls, [])

    def test_rollback_command_refuses_a_committed_run(self):
        self.interrupted('cleanup')
        self.assertEqual(self.main('rollback', '--environment', 'staging'), release.EXIT_REFUSED)
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
                    self.assertEqual(self.main('rollback', '--environment', 'staging'), release.EXIT_OK)
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
                self.assertEqual(self.main('rollback', '--environment', 'staging'), release.EXIT_OK)
                self.assertFalse(self.compose_stops() or self.renames() or self.paths.maintenance.exists())
                self.assertFalse((self.state / 'run.json').exists())
                self.assertEqual(self.main(), release.EXIT_OK)
                self.assertEqual(self.served(), NEW)

    def test_status_reports_and_exits_3_when_halted(self):
        release.write_json(self.state / 'halted.json', {'reason': 'x'})
        with mock.patch('sys.stdout', new=io.StringIO()) as out:
            self.assertEqual(self.main('status', '--environment', 'staging'), release.EXIT_HALTED)
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
        run = {'commit': NEW, 'ref': 'refs/tags/release/19.0.1.0.7', 'version': [1, 0, 7], 'document': document(NEW),
               'previous': {'commit': OLD, 'odooCommit': 'e' * 40, 'version': [1, 0, 6]},
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
        for secret in (SECRET, BACKUP_SECRET, TOKEN, GITHUB_TOKEN):
            self.assertNotIn(secret, logged)
        for path in self.state.rglob('*.json'):
            self.assertNotIn(TOKEN, path.read_text())
        for call, env, stdin in zip(self.runner.calls, self.runner.envs, self.runner.stdins):
            if GITHUB_TOKEN in (env or {}).values():
                self.assertEqual(call[0], 'git')  # only git (through its credential helper) gets the token in its environment
            self.assertNotIn(TOKEN, (env or {}).values())  # the registry token goes to docker login on stdin only
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

    def remote_git_calls(self):
        return [(call, env) for call, env in zip(self.runner.calls, self.runner.envs) if 'credential.helper=' in call]

    def test_no_subprocess_receives_a_token_it_does_not_need(self):
        self.environ['LIWAN_GITHUB_READ_TOKEN'] = GITHUB_TOKEN
        self.serve(OLD)
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertTrue(self.runner.calls)
        for call, env, stdin in zip(self.runner.calls, self.runner.envs, self.runner.stdins):
            with self.subTest(call=' '.join(call[:4])):
                self.assertIsNotNone(env, 'a call without an environment would inherit every token')
                self.assertNotIn('LIWAN_GHCR_READ_TOKEN', env)
                self.assertNotIn(TOKEN, env.values())
                if 'credential.helper=' in call:  # git talking to GitHub is the only call that holds the source token
                    self.assertEqual(env.get('LIWAN_GITHUB_READ_TOKEN'), GITHUB_TOKEN)
                else:
                    self.assertNotIn('LIWAN_GITHUB_READ_TOKEN', env)
                    self.assertNotIn(GITHUB_TOKEN, env.values())
                self.assertNotIn(GITHUB_TOKEN, ' '.join(call))
                if stdin and TOKEN in stdin:
                    self.assertEqual(call[:2], ['docker', 'login'])

    def test_git_without_a_github_token_runs_with_no_credential(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        remote = self.remote_git_calls()
        self.assertTrue(remote)
        for call, env in remote:
            self.assertEqual(env['GIT_TERMINAL_PROMPT'], '0')
            self.assertNotIn('LIWAN_GITHUB_READ_TOKEN', env)
            self.assertEqual([part for part in call if part.startswith('credential.helper=')], ['credential.helper='])

    def test_git_with_a_github_token_gets_it_only_through_the_environment_helper(self):
        self.environ['LIWAN_GITHUB_READ_TOKEN'] = GITHUB_TOKEN
        self.assertEqual(self.main(), release.EXIT_OK)
        remote = self.remote_git_calls()
        self.assertTrue(remote)
        for call, env in remote:
            self.assertEqual(env['GIT_TERMINAL_PROMPT'], '0')
            self.assertEqual(env['LIWAN_GITHUB_READ_TOKEN'], GITHUB_TOKEN)
            self.assertIn('$LIWAN_GITHUB_READ_TOKEN', ' '.join(call))  # a reference, never the value
            self.assertNotIn(GITHUB_TOKEN, ' '.join(call))
        for call, env in zip(self.runner.calls, self.runner.envs):
            if call[0] != 'git':
                self.assertNotIn('LIWAN_GITHUB_READ_TOKEN', env or {})

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
        self.assertIn('--include=dev', npm)  # tsx is a dev dependency and the worker runs it

    def test_pgpassfile_from_the_config_reaches_the_backup_environment(self):
        config = self.paths.config_root / 'staging.env'
        config.write_text(config.read_text() + 'PGPASSFILE=/etc/liwan-release/pgpass\n')
        self.assertEqual(self.main(), release.EXIT_OK)
        capture = self.commands('capture')[0]
        self.assertEqual(self.runner.envs[self.runner.calls.index(capture)]['PGPASSFILE'], '/etc/liwan-release/pgpass')

    def shared_compose(self):
        return json.loads((self.root / 'shared.compose.json').read_text())['imageTag']

    def test_the_worker_compose_file_is_rendered_from_the_deployed_stack_before_the_worker_starts(self):
        os.chmod(self.root / 'shared.env', 0o640)
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.shared_compose(), NEW)
        target = self.root / 'shared.compose.json'
        self.assertEqual(target.stat().st_mode & 0o777, 0o640)  # the shared env file's mode: it holds the same secrets
        self.assertFalse(target.with_name(target.name + '.tmp').exists())
        render = next(call for call in self.runner.calls if '--output' in call)
        self.assertEqual(render[render.index('--profile') + 1], '*')
        files = [render[index + 1] for index, word in enumerate(render) if word == '-f']
        self.assertEqual(files, [str(self.state / 'stack' / NEW / 'compose.yml')])
        self.assertLess(self.runner.calls.index(render), self.runner.calls.index(['systemctl', 'start', release.SHARED_WORKER_UNIT]))

    def test_a_failed_render_of_the_candidate_rolls_back_to_the_served_file(self):
        (self.root / 'shared.compose.json').write_text(json.dumps({'imageTag': OLD}))
        self.fail_render = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back shared_compose_render_failed')
        self.assertEqual(self.shared_compose(), OLD)  # the rollback rendered the restored release
        self.assertFalse((self.root / 'shared.compose.json.tmp').exists())

    def assert_refused_before_anything_stops(self, detail):
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused invalid_shared_env')
        self.assertIn(detail, self.log_stream.getvalue())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('psql'), [])
        self.assertEqual(self.commands('systemctl'), [])
        self.assertFalse((self.state / 'halted.json').exists())
        self.assertEqual(self.served(), OLD)

    def test_a_shared_env_file_without_the_compose_path_is_refused_before_anything_stops(self):
        (self.root / 'shared.env').write_text(f'LIWAN_TENANT_REGISTRY_DIR={self.root}/registry\nDB_PASSWORD={SECRET}\n{POLICY}')
        self.assert_refused_before_anything_stops('LIWAN_SHARED_COMPOSE_FILE')

    def test_a_relative_compose_path_is_refused_before_anything_stops(self):
        (self.root / 'shared.env').write_text(f'LIWAN_TENANT_REGISTRY_DIR={self.root}/registry\n'
                                              f'LIWAN_SHARED_COMPOSE_FILE=shared.compose.json\n{POLICY}')
        self.assert_refused_before_anything_stops('absolute path')

    def test_a_missing_compose_directory_is_refused_before_anything_stops(self):
        (self.root / 'shared.env').write_text(f'LIWAN_TENANT_REGISTRY_DIR={self.root}/registry\n'
                                              f'LIWAN_SHARED_COMPOSE_FILE={self.root}/absent/shared.compose.json\n{POLICY}')
        self.assert_refused_before_anything_stops('does not exist or is not writable')

    def test_a_shared_env_file_the_worker_cannot_read_is_refused_before_anything_stops(self):
        with mock.patch.object(release, 'unreadable_by_worker', return_value=True):
            self.assert_refused_before_anything_stops('unreadable by group and others')

    # --- first release on a fresh host -------------------------------------------------------------------
    def up_projects(self):
        return [call[call.index('-p') + 1] for call in self.runner.calls if 'up' in call and '--wait' in call]

    def test_the_control_api_starts_before_the_shared_stack_that_joins_its_network(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.up_projects(), ['liwan', 'liwan-control', 'liwan', 'liwan'])  # db alone, then control, then the stack

    def control_calls(self, verb):
        return [call for call in self.runner.calls if 'compose' in call and 'liwan-control' in call and verb in call]

    def test_the_vendor_console_starts_with_the_control_api_and_stops_with_it(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        (up,) = self.control_calls('--wait')
        self.assertEqual(up[-2:], ['control-api', 'vendor-console'])
        stops = self.control_calls('stop')
        self.assertTrue(stops)
        for stop in stops:
            self.assertEqual(stop[-2:], ['control-api', 'vendor-console'])

    def test_a_rollback_restarts_the_control_api_before_the_shared_stack_too(self):
        self.fail_health = True
        self.main()
        self.assertEqual(self.up_projects(), ['liwan', 'liwan-control', 'liwan', 'liwan', 'liwan-control', 'liwan'])

    def test_external_images_are_pulled_by_their_pinned_digest(self):
        pgvector = 'pgvector/pgvector:pg16@sha256:' + 'c' * 64
        postgres = 'postgres:16@sha256:' + 'd' * 64
        self.external = f'{pgvector}\n{postgres}\n'
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertIn(pgvector, self.product_pulls())
        self.assertIn(postgres, self.product_pulls())
        recorded = json.loads((self.state / f'releases/{NEW}.json').read_text())['images']
        self.assertFalse({pgvector, postgres} & set(recorded))  # an external image is never pruned with an old release

    def test_every_pull_has_a_timeout_and_a_failed_one_is_tried_again(self):
        flaky = f'{REGISTRY}/liwan-odoo@{AMD64}'
        self.pull_failures = {flaky: release.PULL_ATTEMPTS - 1}
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(len([call for call in self.runner.calls if call[-1] == flaky]), release.PULL_ATTEMPTS)
        self.assertEqual(self.pauses(), [release.PULL_RETRY_PAUSE_SECONDS] * (release.PULL_ATTEMPTS - 1))
        pulls = [index for index, call in enumerate(self.runner.calls) if call[:2] == ['docker', 'pull']
                 and 'liwan-release' not in call[-1]]
        self.assertTrue(pulls)
        self.assertEqual({self.runner.timeouts[index] for index in pulls}, {release.PULL_TIMEOUT_SECONDS})

    def test_a_pull_that_never_succeeds_is_refused_before_anything_stops(self):
        stuck = f'{REGISTRY}/liwan-odoo@{AMD64}'
        self.pull_failures = {stuck: 99}
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back image_pull_failed')
        self.assertEqual(len([call for call in self.runner.calls if call[-1] == stuck]), release.PULL_ATTEMPTS)
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('psql'), self.assertion_runs())  # the role check only: no size query ran
        self.assertEqual(self.served(), OLD)
        self.assertEqual(self.alert_events(), ['deploy_failed'])

    def test_a_command_that_runs_past_its_timeout_is_killed_and_fails(self):
        runner = Runner(lambda message: None)
        argv = [sys.executable, '-c', 'import time; time.sleep(30)']
        self.assertEqual(runner(argv, check=False, timeout=0.2)[0], release.TIMED_OUT)
        with self.assertRaises(CommandFailed):
            runner(argv, timeout=0.2)

    def test_the_output_a_command_wrote_before_its_timeout_reaches_the_log(self):
        lines = []
        runner = Runner(lines.append)
        argv = [sys.executable, '-u', '-c', 'import time; print("first"); print("last"); time.sleep(30)']
        with self.assertRaises(CommandFailed):
            runner(argv, timeout=1)
        self.assertEqual(['  first', '  last'], lines[-2:])


    def pauses(self):
        return [seconds for _, seconds in self.sleep_marks if seconds != release.WORKER_SETTLE_SECONDS]

    # --- worker dependencies and start ---------------------------------------------------------------------
    def npm_prefixes(self):
        return [call[call.index('--prefix') + 1] for call in self.runner.calls if call[0] == 'npm']

    def existing_release_folder(self, installed):
        target = self.paths.releases / NEW
        target.mkdir()
        write_smoke(target)
        if installed:
            (target / release.DEPENDENCY_MARKER).parent.mkdir(parents=True)
            (target / release.DEPENDENCY_MARKER).write_text('{}')
        return target

    def test_an_existing_release_folder_without_the_worker_dependencies_gets_them(self):
        target = self.existing_release_folder(installed=False)
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.npm_prefixes(), [str(target)])
        self.assertTrue((target / release.DEPENDENCY_MARKER).exists())

    def test_an_existing_release_folder_with_the_dependencies_is_left_alone(self):
        self.existing_release_folder(installed=True)
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.npm_prefixes(), [])

    def test_a_failed_install_into_an_existing_folder_leaves_no_tree_the_next_run_takes_as_complete(self):
        target = self.existing_release_folder(installed=False)
        self.fail_npm = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back worker_dependencies_failed')
        self.assertFalse((target / 'node_modules').exists())
        self.assertEqual(self.served(), OLD)
        self.fail_npm = False
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(len(self.npm_prefixes()), 2)

    def test_the_worker_is_checked_only_after_the_settle_period(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        calls = [' '.join(call) for call in self.runner.calls]
        start = calls.index('systemctl start ' + release.SHARED_WORKER_UNIT)
        self.assertIn((start + 1, release.WORKER_SETTLE_SECONDS), self.sleep_marks)  # between start and the check
        self.assertEqual(calls[start + 1], 'systemctl is-active --quiet ' + release.SHARED_WORKER_UNIT)
        unit = (Path(release.__file__).resolve().parents[1] / 'control-plane/liwan-shared-worker.service').read_text()
        restart = int(re.search(r'^RestartSec=(\d+)$', unit, re.MULTILINE).group(1))
        self.assertTrue(0 < release.WORKER_SETTLE_SECONDS < restart)  # a crashed worker is still auto-restarting at the check

    # --- the AI control state ----------------------------------------------------------------------------
    def ai_initializations(self):
        return [call for call in self.runner.calls if '--initialize-control' in call]

    def test_the_ai_control_tables_are_initialised_after_the_control_migration_and_before_the_start(self):
        shared = self.root / 'shared.env'
        shared.write_text(shared.read_text() + 'AI_DATABASE_URL=postgresql://liwan_ai:pw@db:5432/liwan_ai\n')
        self.assertEqual(self.main(), release.EXIT_OK)
        calls = self.runner.calls
        (initialize,) = self.ai_initializations()
        self.assertEqual(initialize[initialize.index('run'):], [
            'run', '--rm', '--pull', 'never', '-T', 'ai', 'python', '-m', 'liwan_ai_service.store', '--initialize-control'])
        migrate = next(i for i, call in enumerate(calls) if 'control-migrate' in call)
        up = next(i for i, call in enumerate(calls) if 'up' in call and '--wait' in call)
        self.assertLess(migrate, calls.index(initialize))
        self.assertLess(calls.index(initialize), up)

    def test_a_failed_ai_initialisation_rolls_the_release_back_with_its_own_reason(self):
        shared = self.root / 'shared.env'
        shared.write_text(shared.read_text() + 'AI_DATABASE_URL=postgresql://liwan_ai:pw@db:5432/liwan_ai\n')
        self.fail_ai_initialization = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back ai_control_initialization_failed')
        self.assertEqual(self.served(), OLD)

    def test_an_ai_database_given_through_the_release_environment_counts_as_configured(self):
        # compose also reads the process environment (the release config and the process), so the skip must see it too
        url = 'postgresql://liwan_ai:pw@db:5432/liwan_ai'
        self.assertEqual(self.main(environ={**self.environ, release.AI_DATABASE_URL_KEY: url}), release.EXIT_OK)
        self.assertEqual(len(self.ai_initializations()), 1)

    def test_an_empty_ai_database_in_the_process_environment_overrides_the_shared_file(self):
        shared = self.root / 'shared.env'
        shared.write_text(shared.read_text() + 'AI_DATABASE_URL=postgresql://liwan_ai:pw@db:5432/liwan_ai\n')
        self.assertEqual(self.main(environ={**self.environ, release.AI_DATABASE_URL_KEY: ''}), release.EXIT_OK)
        self.assertEqual(self.ai_initializations(), [])

    def test_the_ai_control_tables_are_left_alone_without_an_ai_database(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.ai_initializations(), [])

    # --- alerts --------------------------------------------------------------------------------------------
    def test_a_refused_alert_logs_the_reason_alerts_gave_with_secrets_masked(self):
        self.alert_result = (2, f'alerts: no alert channel is configured for {SECRET}\n')
        self.free = 0  # any failing run raises an alert
        self.main()
        log = self.log_stream.getvalue()
        self.assertIn('alert deploy_failed was not delivered (exit 2): no alert channel is configured for ***', log)
        self.assertNotIn(SECRET, log)

    def test_an_alert_that_fails_without_a_reason_keeps_the_plain_line(self):
        self.alert_result = (1, '')
        self.free = 0
        self.main()
        self.assertIn('alert deploy_failed was not delivered (exit 1)\n', self.log_stream.getvalue())

    # --- the shared Odoo config ------------------------------------------------------------------------------
    @property
    def pending_config(self):
        return self.odoo_config.with_name(self.odoo_config.name + '.next')

    def test_a_shared_odoo_config_path_that_cannot_be_written_is_refused_before_anything_stops(self):
        shared = self.root / 'shared.env'
        text = shared.read_text()
        self.odoo_config.unlink()
        self.odoo_config.mkdir()  # docker would create this directory itself on a missing bind source
        self.assert_refused_before_anything_stops('is not a file')
        shared.write_text(text.replace(f'LIWAN_SHARED_ODOO_CONFIG={self.odoo_config}\n', ''))
        self.assert_refused_before_anything_stops('LIWAN_SHARED_ODOO_CONFIG')
        shared.write_text(text.replace(str(self.odoo_config), 'odoo.conf'))
        self.assert_refused_before_anything_stops('absolute path')
        shared.write_text(text.replace(str(self.odoo_config), f'{self.root}/absent/odoo.conf'))
        self.assert_refused_before_anything_stops('does not exist or is not writable')

    def test_a_missing_vendor_console_env_file_is_refused_before_anything_stops(self):
        shared = self.root / 'shared.env'
        text = shared.read_text()
        self.vendor_env.unlink()
        self.assert_refused_before_anything_stops(str(self.vendor_env))
        self.vendor_env.mkdir()  # a directory at the path is not the file either
        self.log_stream.seek(0)
        self.log_stream.truncate(0)
        self.assert_refused_before_anything_stops(str(self.vendor_env))
        shared.write_text(text.replace(f'LIWAN_VENDOR_ADMIN_ENV_FILE={self.vendor_env}\n', ''))
        self.assert_refused_before_anything_stops('LIWAN_VENDOR_ADMIN_ENV_FILE')
        shared.write_text(text.replace(str(self.vendor_env), 'vendor-admin.env'))
        self.assert_refused_before_anything_stops('absolute path')
        self.assertNotIn(SECRET, self.log_stream.getvalue())

    def test_an_odoo_config_the_candidate_validator_rejects_is_refused_in_prepare_with_nothing_stopped(self):
        self.odoo_config_invalid = True
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused odoo_config_invalid')
        self.assertIn(str(self.pending_config), self.log_stream.getvalue())
        self.assertEqual(self.odoo_config.read_text(), RENDERED + '[options]\n')  # the live file is untouched
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('psql'), [])
        self.assertEqual(self.commands('systemctl'), [])
        self.assertEqual(self.candidate_renders, [])  # refused before the render, the pulls and the disk check
        self.assertFalse((self.state / 'halted.json').exists())

    def set_restore_config(self):
        restore = self.root / 'restore-odoo.conf'
        restore.write_text('[options]\n')
        shared = self.root / 'shared.env'
        shared.write_text(shared.read_text() + f'LIWAN_RESTORE_ODOO_CONFIG={restore}\n')
        return restore

    def validator_calls(self):
        return [(argv, env) for argv, env in zip(self.runner.calls, self.runner.envs)
                if 'deploy/shared/validate_odoo_config.py' in ' '.join(argv)]

    def test_a_restore_config_the_candidate_validator_rejects_is_refused_in_prepare_with_nothing_stopped(self):
        restore = self.set_restore_config()
        self.restore_config_invalid = True
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused odoo_config_invalid')
        self.assertIn(f'{restore} (LIWAN_RESTORE_ODOO_CONFIG)', self.log_stream.getvalue())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('psql'), [])
        self.assertEqual(self.commands('systemctl'), [])
        self.assertEqual(self.candidate_renders, [])
        self.assertFalse((self.state / 'halted.json').exists())

    def test_a_set_restore_config_is_validated_as_the_restore_profile_and_the_live_one_is_not(self):
        restore = self.set_restore_config()
        self.assertEqual(self.main(), release.EXIT_OK)
        calls = self.validator_calls()
        self.assertEqual([argv[3] for argv, _ in calls], [str(self.pending_config), str(restore)])
        self.assertNotIn('LIWAN_RESTORE_ROLE', calls[0][1])
        self.assertEqual(calls[1][1]['LIWAN_RESTORE_ROLE'], '1')

    def test_an_unset_restore_config_is_skipped(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual([argv[3] for argv, _ in self.validator_calls()], [str(self.pending_config)])

    def test_a_valid_odoo_config_is_checked_once_by_the_candidates_validator_with_the_hosts_path(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        checks = [argv for argv in self.runner.calls if 'deploy/shared/validate_odoo_config.py' in ' '.join(argv)]
        self.assertEqual(len(checks), 1)
        self.assertEqual(checks[0][:2], ['python3', '-B'])
        self.assertTrue(checks[0][2].endswith(f'{NEW}/deploy/shared/validate_odoo_config.py'))
        self.assertEqual(checks[0][3], str(self.pending_config))

    # --- the candidate's compose files, rendered before the stop ------------------------------------------------
    def test_a_required_key_missing_from_the_shared_env_is_refused_in_prepare_with_nothing_stopped(self):
        self.missing_required = 'LIWAN_CONTROL_EDGE_NETWORK'
        self.assert_refused_before_anything_stops('does not satisfy the compose files of')  # the real Runner logs the tail naming the key
        self.assertFalse((self.state / 'candidate.env').exists())
        self.assertEqual(self.sql, [])

    def test_a_healthy_candidate_render_uses_its_own_tag_silently_and_leaves_what_is_served_alone(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        projects = {argv[argv.index('-p') + 1] for argv, _ in self.candidate_renders}
        self.assertEqual(projects, {'liwan', release.CONTROL_PROJECT})
        for argv, env_text in self.candidate_renders:
            self.assertIn(f'LIWAN_IMAGE_TAG={NEW}', env_text)
            self.assertNotIn('--output', argv)  # nothing of the rendered stack is printed or logged
            self.assertNotIn('--format', argv)
            self.assertEqual(argv[-1], '--quiet')
        self.assertFalse((self.state / 'candidate.env').exists())
        self.assertEqual(self.served(), NEW)

    def test_a_shared_odoo_config_file_passes(self):
        self.assertEqual(self.main(), release.EXIT_OK)

    # --- the Odoo config the release renders -------------------------------------------------------------------
    def rendered_config(self):
        return stack_render.odoo_conf(read_env_file(self.root / 'shared.env'))

    def test_the_rendered_config_replaces_the_live_one_at_activation_with_its_owner_and_mode(self):
        self.odoo_config.chmod(0o440)
        before = self.odoo_config.stat()
        self.assertEqual(self.main(), release.EXIT_OK)
        live = self.odoo_config.stat()
        self.assertEqual(self.odoo_config.read_text(), self.rendered_config())
        self.assertEqual((stat.S_IMODE(live.st_mode), live.st_uid, live.st_gid), (0o440, before.st_uid, before.st_gid))
        self.assertFalse(self.pending_config.exists())
        self.assertIn(release.RENDERED_MARKER, self.odoo_config.read_text())

    def test_the_live_config_is_not_touched_until_the_release_stops_and_activates(self):
        seen = []
        original = FakeRunner.answer

        def answer(runner, argv, stdin):
            if argv[:2] == ['docker', 'pull']:
                seen.append((self.odoo_config.read_text(), self.pending_config.exists()))
            return original(runner, argv, stdin)

        with mock.patch.object(FakeRunner, 'answer', answer):
            self.assertEqual(self.main(), release.EXIT_OK)
        self.assertTrue(seen)
        self.assertEqual({live for live, _ in seen}, {RENDERED + '[options]\n'})
        self.assertIn(True, [pending for _, pending in seen])

    def test_a_missing_live_config_is_refused_before_anything_stops(self):
        self.odoo_config.unlink()
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused odoo_config_missing')
        self.assertIn('A4.7', self.log_stream.getvalue())
        self.assertFalse(self.odoo_config.exists() or self.pending_config.exists())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('systemctl'), [])
        self.assertEqual(self.served(), OLD)

    def test_an_adopted_hand_written_config_keeps_its_owner_group_and_mode_exactly(self):
        self.hand_written_config()
        self.odoo_config.chmod(0o440)
        before = self.odoo_config.stat()
        self.assertEqual(self.main(), release.EXIT_OK)
        after = self.odoo_config.stat()
        self.assertEqual((stat.S_IMODE(after.st_mode), after.st_uid, after.st_gid), (0o440, before.st_uid, before.st_gid))

    # --- each release renders its own stack ------------------------------------------------------------------
    def markers(self, *words):
        """The render marker each compose command ran on, for the commands that carry every word."""
        return [text.split()[1] for argv, text in self.runner.compose_files if all(word in argv for word in words)]

    def stub_old_and_new(self, **new_options):
        stub_renderer(self.paths.releases / OLD, 'old')
        self.candidate_stack = lambda checkout: stub_renderer(checkout, 'new', **new_options)

    def test_the_forward_run_renders_the_candidate_with_the_candidates_own_renderer(self):
        self.stub_old_and_new()
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertIn('new', self.markers('up'))
        self.assertEqual(set(self.markers('stop')), {'old'})  # the served release is stopped on its own render
        self.assertIn('marker = new', self.odoo_config.read_text())
        self.assertEqual({(name, os.path.realpath(path)) for name, _, path in self.runner.renders},
                         {(OLD, os.path.realpath(self.paths.releases / OLD)), (NEW, os.path.realpath(self.paths.releases / NEW))})
        for (_, argv, _), cwd in zip(self.runner.renders, [c for c in self.runner.cwds if c is not None]):
            self.assertEqual(argv[:5], ['python3', '-B', '-m', 'deploy.stack.render', 'bundle'])
            self.assertEqual(Path(argv[argv.index('--out') + 1]).parent, self.state / 'stack')
            self.assertEqual(stat.S_IMODE(Path(argv[argv.index('--out') + 1]).stat().st_mode), 0o700)

    def test_a_rollback_stops_on_the_failed_release_render_and_starts_on_the_previous_ones_with_its_own_odoo_conf(self):
        self.stub_old_and_new()
        self.odoo_config.write_text('[options]\nmarker = new\n')  # hand-written, and saying what the candidate renders
        self.odoo_config.chmod(0o440)
        before = self.odoo_config.stat()
        self.fail_health = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back health_check_failed')
        self.assertIn('new', self.markers('stop'))  # the failed release is stopped by its own code
        self.assertEqual(self.markers('up')[-1], 'old')
        after = self.odoo_config.stat()
        self.assertIn('marker = old', self.odoo_config.read_text())
        self.assertEqual((stat.S_IMODE(after.st_mode), after.st_uid, after.st_gid), (0o440, before.st_uid, before.st_gid))
        self.assertFalse(self.pending_config.exists())

    def future_candidate(self, checkout):
        """The real renderer and template with one more toggle of its own, which the served renderer has never heard of."""
        render = checkout / 'deploy/stack/render.py'
        text = render.read_text()
        self.assertIn("{'LIWAN_STACK_COMMERCIAL_EDGE', 'LIWAN_STACK_DB_HOST_LINK'}", text)
        render.write_text(text.replace("{'LIWAN_STACK_COMMERCIAL_EDGE', 'LIWAN_STACK_DB_HOST_LINK'}",
                                       "{'LIWAN_STACK_COMMERCIAL_EDGE', 'LIWAN_STACK_DB_HOST_LINK', 'LIWAN_STACK_FUTURE'}"))
        compose = checkout / 'deploy/stack/compose.yml'
        compose.write_text(compose.read_text() + '# @if LIWAN_STACK_FUTURE\n# future-block\n# @endif\n')

    def test_a_toggle_only_the_candidate_uses_is_ignored_by_the_served_renderer_and_the_release_commits(self):
        (self.root / 'shared.env').write_text((self.root / 'shared.env').read_text() + 'LIWAN_STACK_FUTURE=true\n')
        self.candidate_stack = self.future_candidate
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.result(), f'committed {NEW}')
        self.assertNotIn('future-block', (self.state / 'stack' / OLD / 'compose.yml').read_text())  # the served one ignored it
        self.assertIn('future-block', (self.state / 'stack' / NEW / 'compose.yml').read_text())  # the candidate rendered with it

    def test_a_candidate_whose_new_toggle_the_env_lacks_is_refused_before_anything_stops_naming_it(self):
        self.candidate_stack = self.future_candidate
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused invalid_shared_env')
        self.assertIn('LIWAN_STACK_FUTURE is missing', self.log_stream.getvalue())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.served(), OLD)

    def test_a_candidate_renderer_that_refuses_the_env_values_is_refused_before_anything_stops_naming_keys_only(self):
        stub_renderer(self.paths.releases / OLD, 'old')
        self.candidate_stack = lambda checkout: stub_renderer(checkout, 'new', require='LIWAN_STACK_NEEDED')
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused invalid_shared_env')
        self.assertIn('LIWAN_STACK_NEEDED', self.log_stream.getvalue())
        self.assertNotIn(SECRET, self.log_stream.getvalue())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.served(), OLD)

    def test_a_pre_stack_served_release_is_refused_before_anything_stops_is_pulled_or_recorded(self):
        shutil.rmtree(self.paths.releases / OLD / 'deploy/stack')
        seed_pre_stack(self.paths.releases / OLD)
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused previous_not_stack')
        self.assertIn('Pre-stack cutover', self.log_stream.getvalue())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual([call for call in self.runner.calls if call[:2] == ['docker', 'pull'] and 'liwan-release' not in call[-1]], [])  # only the release document's image
        self.assertEqual(self.commands('systemctl'), [])
        self.assertFalse((self.state / 'run.json').exists() or (self.state / 'halted.json').exists())
        self.assertEqual(self.served(), OLD)

    def test_a_candidate_without_a_renderer_is_refused_before_anything_stops(self):
        self.candidate_stack = lambda checkout: (checkout / 'deploy/stack/render.py').unlink()
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused candidate_not_stack')
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.served(), OLD)

    def test_a_stack_contract_the_command_does_not_read_is_refused_before_anything_stops(self):
        for name, options in (('newer contract', {'contract': 2}), ('no manifest', {'manifest_name': 'other.json'})):
            with self.subTest(name):
                self.stub_old_and_new(**options)
                self.assertEqual(self.main(), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused stack_contract_mismatch')
                self.assertEqual(self.compose_stops(), [])
                self.assertEqual(self.commands('systemctl'), [])
                self.assertEqual(self.served(), OLD)
                shutil.rmtree(self.paths.releases / NEW, ignore_errors=True)

    def test_a_rollback_over_a_hand_written_live_config_still_starts_the_previous_release(self):
        stub_renderer(self.paths.releases / OLD, 'old')
        self.candidate_stack = lambda checkout: stub_renderer(checkout, 'new')
        self.odoo_config.write_text('[options]\nmarker = new\n')  # adopted at prepare because it says what the candidate renders
        self.fail_health = True
        original = release.Releaser.prepare_odoo_config
        calls = []

        def spy(releaser, checkout, check_drift=True):
            calls.append((checkout.name, check_drift))
            if not check_drift:  # the failed release's config is on disk, but a hand edit after activation must not block it
                self.odoo_config.write_text('[options]\nmarker = edited-by-hand\n')
            return original(releaser, checkout, check_drift)

        with mock.patch.object(release.Releaser, 'prepare_odoo_config', spy):
            self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back health_check_failed')
        self.assertEqual(calls, [(NEW, True), (OLD, False)])
        self.assertIn('marker = old', self.odoo_config.read_text())
        self.assertEqual(self.markers('up')[-1], 'old')

    def test_a_halted_rollback_resumed_renders_the_previous_release_again_without_stale_files(self):
        stub_renderer(self.paths.releases / OLD, 'old')
        self.test_rollback_that_fails_halts_and_keeps_maintenance()
        stale = self.state / 'stack' / OLD / 'stale.txt'
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_text('left by the failed attempt')
        self.runner.answer = FakeRunner.answer.__get__(self.runner)
        self.runner.compose_files.clear()
        self.assertEqual(self.main('rollback', '--environment', 'staging'), release.EXIT_FAILED)
        self.assertFalse(stale.exists())
        self.assertEqual(set(self.markers('up')), {'old'})
        self.assertIn('marker = old', self.odoo_config.read_text())
        self.assertEqual(sorted(path.name for path in (self.state / 'stack' / OLD).iterdir()),
                         ['compose.yml', 'odoo.conf', 'sizing.env', 'stack.json'])

    def test_a_missing_classification_directory_is_refused_before_anything_stops(self):
        (self.root / 'control-state/classifications').rmdir()
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused classification_dir_missing')
        self.assertIn('classifications', self.log_stream.getvalue())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('systemctl'), [])
        self.assertEqual(self.served(), OLD)

    def hand_written_config(self, **changes):
        options = release.Releaser.config_options(self.rendered_config())
        options.update(changes)
        self.odoo_config.write_text('[options]\n' + ''.join(f'{name} = {value}\n' for name, value in options.items()))

    def test_a_hand_written_config_that_differs_from_the_render_is_refused_by_key_name_only(self):
        self.hand_written_config(workers='2', limit_memory_hard='1', db_password='a-different-secret-never-logged')
        before = self.odoo_config.read_text()
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused odoo_config_drift')
        log = self.log_stream.getvalue()
        self.assertIn('db_password, limit_memory_hard, workers', log)
        self.assertIn('db_password', log)  # a secret that differs is reported by name
        self.assertNotIn('a-different-secret-never-logged', log)
        self.assertNotIn(SECRET, log)
        self.assertEqual(self.odoo_config.read_text(), before)
        self.assertFalse(self.pending_config.exists())
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('systemctl'), [])
        self.assertEqual(self.served(), OLD)

    def test_a_hand_written_config_missing_a_key_or_carrying_an_extra_one_is_drift(self):
        for name, text in (('missing', ''.join(line for line in self.rendered_config().splitlines(True) if not line.startswith('workers'))),
                           ('extra', self.rendered_config() + 'db_name = a_tenant\n')):
            with self.subTest(name):
                self.odoo_config.write_text(text.replace(release.RENDERED_MARKER, ';'))
                self.assertEqual(self.main(), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused odoo_config_drift')

    def test_a_changed_secret_is_drift_reported_by_name_and_never_by_value(self):
        for key in ('db_password', 'admin_passwd'):
            with self.subTest(key):
                self.hand_written_config(**{key: 'a-different-secret-never-logged'})
                self.assertEqual(self.main(), release.EXIT_REFUSED)
                self.assertEqual(self.result(), 'refused odoo_config_drift')
                log = self.log_stream.getvalue()
                self.assertIn(key, log)
                self.assertNotIn('a-different-secret-never-logged', log)
                self.assertNotIn(SECRET, log)

    def test_a_hand_written_config_that_says_what_the_render_says_is_adopted(self):
        self.hand_written_config()
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.odoo_config.read_text(), self.rendered_config())

    def test_a_missing_secret_for_the_config_is_refused_before_anything_stops(self):
        shared = self.root / 'shared.env'
        shared.write_text(shared.read_text().replace('LIWAN_ODOO_ADMIN_PASSWD=$pbkdf2-sha512$1$c2FsdA$aGFzaA\n', ''))
        self.assert_refused_before_anything_stops('LIWAN_ODOO_ADMIN_PASSWD')

    def test_a_resumed_activation_finds_no_pending_config_and_keeps_the_live_one(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        rendered = self.odoo_config.read_text()
        releaser = release.Releaser('staging', release.load_config(self.paths, 'staging'), self.paths, self.runner,
                                    lambda *_: None, self.environ, self.machine)
        releaser.adopt_odoo_config()
        self.assertEqual(self.odoo_config.read_text(), rendered)

    # --- the stack definition the release renders ----------------------------------------------------------------
    def test_every_compose_command_runs_the_rendered_stack_from_the_checkouts_deploy_directory(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        stack = [call for call in self.runner.calls if call[:2] == ['docker', 'compose'] and '--project-directory' in call
                 and call[call.index('-p') + 1] == 'liwan']
        self.assertTrue(stack)
        for call in stack:
            self.assertIn(os.path.realpath(call[call.index('--project-directory') + 1]),
                          [os.path.realpath(self.paths.releases / name / 'deploy') for name in (OLD, NEW)])
            compose = Path(call[call.index('-f') + 1])
            self.assertEqual(compose.parent.parent, self.state / 'stack')
            self.assertIn(compose.parent.name, (OLD, NEW))
            files = [call[index + 1] for index, word in enumerate(call) if word == '--env-file']
            self.assertEqual([Path(files[0]), files[1], Path(files[2]).name in ('release.env', 'candidate.env')],
                             [compose.parent / 'sizing.env', str(self.root / 'shared.env'), True])
        self.assertFalse([call for call in self.runner.calls if call[:2] == ['docker', 'compose'] and '-f' in call
                          and call[call.index('-f') + 1].endswith('.yml') and 'docker-compose' in call[call.index('-f') + 1]])

    def test_the_toggles_of_the_shared_env_select_the_rendered_blocks(self):
        shared = self.root / 'shared.env'
        text = shared.read_text()
        for value, present in (('true', True), ('false', False)):
            with self.subTest(db_host_link=value):
                shared.write_text(text.replace('LIWAN_STACK_DB_HOST_LINK=true', f'LIWAN_STACK_DB_HOST_LINK={value}'))
                releaser = release.Releaser('staging', release.load_config(self.paths, 'staging'), self.paths, self.runner,
                                            lambda *_: None, self.environ, self.machine)
                releaser.state.mkdir(parents=True, exist_ok=True)
                releaser.compose(self.paths.releases / OLD)
                self.assertEqual('liwan-dbhost' in (self.state / 'stack' / OLD / 'compose.yml').read_text(), present)

    def test_a_shared_env_without_a_toggle_or_with_a_misspelled_one_is_refused_before_anything_stops(self):
        shared = self.root / 'shared.env'
        text = shared.read_text()
        for name, changed in (('missing', text.replace('LIWAN_STACK_DB_HOST_LINK=true\n', '')),
                              ('misspelled', text.replace('LIWAN_STACK_DB_HOST_LINK=true', 'LIWAN_STACK_DB_HOST_LNK=true')),
                              ('not a boolean', text.replace('LIWAN_STACK_DB_HOST_LINK=true', 'LIWAN_STACK_DB_HOST_LINK=yes'))):
            with self.subTest(name):
                shared.write_text(changed)
                self.assert_refused_before_anything_stops('cannot render the stack')

    def test_the_release_starts_named_services_so_the_tenant_storage_profile_never_comes_up(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        ups = [call for call in self.runner.calls if call[:2] == ['docker', 'compose'] and 'up' in call]
        self.assertTrue(ups)
        for call in ups:
            self.assertIn(call[-1], ('db', 'guard') + release.APP_SERVICES + (release.PROXY_SERVICE,) + release.CONTROL_SERVICES)
            self.assertNotIn('tenant-storage', ' '.join(call))
            self.assertNotIn('--profile', call)
        self.assertNotIn('tenant-storage', release.APP_SERVICES + release.CONTROL_SERVICES + (release.PROXY_SERVICE, release.EDGE_SERVICE))

    def test_only_a_root_owned_file_without_group_or_other_read_is_unreadable_by_the_worker(self):
        def info(uid, mode):
            return os.stat_result((0o100000 | mode, 0, 0, 1, uid, 0, 0, 0, 0, 0))
        self.assertTrue(release.unreadable_by_worker(info(0, 0o600)))
        self.assertFalse(release.unreadable_by_worker(info(0, 0o640)))
        self.assertFalse(release.unreadable_by_worker(info(0, 0o644)))
        self.assertFalse(release.unreadable_by_worker(info(990, 0o600)))

    def test_a_shared_env_is_unsafe_when_owned_outside_the_trust_set_or_writable_by_it(self):
        def info(uid, mode, gid=0):
            return os.stat_result((0o100000 | mode, 0, 0, 1, uid, gid, 0, 0, 0, 0))
        owners = {0, 990}
        self.assertFalse(unsafe_shared_file(info(0, 0o600), owners))
        self.assertFalse(unsafe_shared_file(info(0, 0o640, gid=999), owners, {0, 999}))  # A4.1: 640 root:docker
        self.assertFalse(unsafe_shared_file(info(990, 0o600), owners))
        self.assertTrue(unsafe_shared_file(info(0, 0o640, gid=1000), owners, {0, 999}))
        self.assertTrue(unsafe_shared_file(info(0, 0o660), owners, {0, 999}))
        self.assertTrue(unsafe_shared_file(info(0, 0o664), owners, {0, 999}))
        self.assertTrue(unsafe_shared_file(info(0, 0o644), owners, {0, 999}))
        self.assertTrue(unsafe_shared_file(info(1000, 0o600), owners, {0, 999}))

    def test_the_temporary_file_is_removed_when_the_owner_cannot_be_applied(self):
        with mock.patch.object(release.os, 'chown', side_effect=PermissionError('chown')):
            self.assertNotEqual(self.main(), release.EXIT_OK)
        self.assertFalse((self.root / 'shared.compose.json.tmp').exists())

    def test_a_rollback_renders_the_file_of_the_restored_release(self):
        self.fail_health = True
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.shared_compose(), OLD)  # the worker's view and the restored stack agree

    def test_a_failed_render_during_the_rollback_still_restarts_the_previous_release_but_not_the_worker(self):
        self.fail_health, self.fail_restore_render = True, True
        self.assertEqual(self.main(), release.EXIT_ROLLBACK_FAILED)
        self.assertEqual(self.result(), 'halted shared_compose_render_failed')
        self.assertTrue((self.state / 'halted.json').exists())
        restarted = [call for call in self.runner.calls if 'up' in call and f'{self.paths.releases / OLD}/deploy' in ' '.join(call)]
        self.assertTrue(restarted)
        self.assertTrue(any(call[-1] == 'guard' for call in restarted))  # the previous release serves customers again
        self.assertFalse(self.paths.maintenance.exists())
        self.assertNotIn(['systemctl', 'start', release.SHARED_WORKER_UNIT], self.runner.calls)
        self.assertEqual(self.paths.current.resolve(), (self.paths.releases / OLD).resolve())
        self.assertFalse((self.root / 'shared.compose.json').exists())  # the failed release's render is gone: the worker fails closed

    def test_a_rollback_after_a_failed_restore_render_renders_the_file_and_starts_the_worker(self):
        self.fail_health, self.fail_restore_render = True, True
        self.assertEqual(self.main(), release.EXIT_ROLLBACK_FAILED)
        self.assertFalse((self.root / 'shared.compose.json').exists())
        self.fail_restore_render = False
        self.assertEqual(self.main('rollback', '--environment', 'staging'), release.EXIT_FAILED)
        self.assertEqual(self.shared_compose(), OLD)
        self.assertIn(['systemctl', 'start', release.SHARED_WORKER_UNIT], self.runner.calls)

    def capture_ports(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        return [call[call.index('--pg-port') + 1] for call in self.commands('capture')]

    def test_the_backup_uses_the_database_ports_the_overlays_default_to(self):
        self.assertEqual(self.capture_ports(), ['15433', '15432'])

    def test_the_backup_uses_the_database_ports_of_the_shared_env_file(self):
        shared = self.root / 'shared.env'
        shared.write_text(shared.read_text() + 'LIWAN_DB_HOST_PORT=25433\nLIWAN_CONTROL_DB_HOST_PORT=25432\n')
        self.assertEqual(self.capture_ports(), ['25433', '25432'])

    def test_current_that_points_nowhere_is_refused_before_anything_changes(self):
        shutil.rmtree(self.paths.releases / OLD)
        for command in ('run', 'rollback'):
            self.runner.calls.clear()
            self.assertEqual(self.main(command, '--environment', 'staging'), release.EXIT_REFUSED)
            self.assertEqual(self.result(), 'refused current_dangling')
            self.assertEqual(self.runner.calls, [])
        self.assertTrue(self.paths.current.is_symlink())

    def test_current_that_is_a_directory_is_refused_before_anything_changes(self):
        self.paths.current.unlink()
        self.paths.current.mkdir()
        for command in ('run', 'rollback'):
            self.runner.calls.clear()
            self.assertEqual(self.main(command, '--environment', 'staging'), release.EXIT_REFUSED)
            self.assertEqual(self.result(), 'refused current_not_symlink')
            self.assertEqual(self.runner.calls, [])
        self.assertTrue(self.paths.current.is_dir() and not self.paths.current.is_symlink())

    # --- database roles ---------------------------------------------------------------------------------------
    def psql_users(self):
        return {call[call.index('-U') + 1] for call in self.runner.calls if 'psql' in call and '-U' in call
                and 'control-db' not in call}

    def image_pulls(self):
        return [call for call in self.commands('pull') if 'liwan-release' not in call[-1]]  # the release document's own pull is not an image

    def assertion_runs(self):
        return [call for call, stdin in zip(self.runner.calls, self.runner.stdins)
                if 'psql' in call and stdin and 'privileged_or_missing_role' in stdin]

    def test_tooling_sql_and_the_dump_run_as_the_admin_role_and_the_grantee_is_the_runtime_role(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.psql_users(), {'postgres'})
        dumps = [call for call in self.runner.calls if '--pg-user' in call and '--control-plane' not in call]
        self.assertEqual({call[call.index('--pg-user') + 1] for call in dumps}, {'postgres'})
        self.assertEqual(len(dumps), len(self.tenant_names))

    def test_the_rollback_regrants_the_runtime_role_and_issues_no_tenant_database_admin_session(self):
        self.fail_upgrade_of = 'tenant_one'
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertTrue(any('GRANT CONNECT ON DATABASE "tenant_one" TO "odoo"' in sql for sql in self.sql))
        self.assertFalse(any('ON SCHEMA' in sql for sql in self.sql))  # the snapshot copy already carries the schema ACL
        psql_calls = [call for call in self.runner.calls if 'psql' in call]
        self.assertTrue(psql_calls)
        self.assertEqual({call[call.index('-d') + 1] for call in psql_calls}, {'postgres'})

    def test_the_role_assertion_runs_before_the_capture_when_a_release_is_served(self):
        self.assertEqual(self.main(), release.EXIT_OK)
        calls = self.runner.calls
        first_assertion = calls.index(self.assertion_runs()[0])
        self.assertLess(first_assertion, calls.index(self.commands('capture')[0]))
        self.assertEqual(len(self.assertion_runs()), 3)  # first in prepare, then in capture, again in the start step
        self.assertLess(first_assertion, calls.index(self.image_pulls()[0]))
        self.assertIn("'tenant_one'", self.runner.stdins[first_assertion])
        self.assertLess(first_assertion, calls.index(self.compose_stops()[0]))

    def test_a_rejected_runtime_role_is_refused_before_anything_stops_and_the_served_release_is_untouched(self):
        self.runtime_role_violation = True
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused runtime_role_rejected')
        self.assertEqual(self.served(), OLD)
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.commands('capture'), [])
        self.assertEqual(self.commands('-u'), [])
        self.assertFalse(self.paths.maintenance.exists())
        self.assertEqual(self.alert_events(), ['deploy_failed'])
        self.assertEqual(len(self.assertion_runs()), 1)
        self.assertEqual(os.readlink(self.paths.current), str(self.paths.releases / OLD))

    def test_an_old_volume_without_the_admin_role_is_refused_before_any_pull_and_once_per_candidate(self):
        self.admin_role_missing = True  # every `-U postgres` session fails, not only the role assertion
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused runtime_role_rejected')
        self.assertEqual(self.image_pulls(), [])
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.served(), OLD)
        self.assertEqual(self.alert_events(), ['deploy_failed'])
        queries = len(self.commands('psql'))
        # The next scheduled run does not pull, query or alert again until the candidate changes or `rollback` clears it.
        self.assertEqual(self.main(), release.EXIT_HALTED)
        self.assertIn('failed before (runtime_role_rejected)', self.result())
        self.assertEqual(self.image_pulls(), [])
        self.assertEqual(self.alert_events(), ['deploy_failed'])
        self.assertEqual(len(self.commands('psql')), queries)

    def test_a_failed_role_check_that_names_no_role_problem_is_retried_and_never_recorded(self):
        self.db_restarting = True  # the db container restarts while `prepare` asks the role question
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back runtime_role_check_failed')
        self.assertFalse((self.state / 'failed.json').exists())
        self.assertEqual(self.served(), OLD)
        self.assertEqual(self.compose_stops(), [])
        self.db_restarting = False  # the next scheduled run goes through
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.served(), NEW)

    def test_a_role_problem_in_the_output_is_recorded_once_per_candidate(self):
        self.runtime_role_violation = True
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertTrue((self.state / 'failed.json').exists())

    def test_a_wrong_admin_password_is_refused_and_recorded_once_per_candidate(self):
        self.admin_password_wrong = True  # DB_ADMIN_PASSWORD does not match the password of the volume's admin role
        self.assertEqual(self.main(), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused runtime_role_rejected')
        self.assertTrue((self.state / 'failed.json').exists())
        self.assertEqual(self.served(), OLD)
        self.assertEqual(self.compose_stops(), [])
        self.assertEqual(self.main(), release.EXIT_HALTED)

    def test_a_transient_connection_failure_is_retried_and_never_recorded(self):
        self.db_unreachable = True  # the server is not accepting connections yet, which says nothing about the volume
        self.assertEqual(self.main(), release.EXIT_FAILED)
        self.assertEqual(self.result(), 'rolled back runtime_role_check_failed')
        self.assertFalse((self.state / 'failed.json').exists())
        self.assertEqual(self.served(), OLD)
        self.db_unreachable = False  # the next scheduled run goes through
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.served(), NEW)

    def test_the_role_check_separates_volume_problems_from_connection_problems(self):
        for output in ('FATAL: role "postgres" does not exist',
                       'psql: error: connection to server at "127.0.0.1", port 15433 failed: FATAL:  password '
                       'authentication failed for user "postgres"',
                       'FATAL:  role "postgres" is not permitted to log in',
                       'ERROR:  privileged_or_missing_role'):
            with self.subTest(output=output):
                self.assertTrue(release.runtime_role_failure_output(output))
        for output in ('Error response from daemon: Container abc is restarting, wait until the container is running',
                       'psql: error: connection to server at "127.0.0.1", port 15433 failed: Connection refused',
                       'psql: error: FATAL:  the database system is starting up',
                       'psql: error: could not connect to server: No such file or directory'):
            with self.subTest(output=output):
                self.assertFalse(release.runtime_role_failure_output(output))

    def test_a_rejected_runtime_role_on_a_first_deploy_starts_no_application(self):
        self.first_deploy()
        self.runtime_role_violation = True
        self.assertNotEqual(self.main(), release.EXIT_OK)
        started = [call for call in self.runner.calls if 'up' in call and 'odoo' in call]
        self.assertEqual(started, [])
        self.assertEqual(len(self.assertion_runs()), 1)
        self.assertTrue(any('db' == call[-1] for call in self.runner.calls if 'up' in call))
        self.assertFalse((self.state / 'served.json').exists())

    # --- first deploy -------------------------------------------------------------------------------------------
    def first_deploy(self):
        (self.state / 'served.json').unlink()
        (self.state / 'release.env').unlink()
        self.registry_file.unlink()

    def test_first_deploy_applies_without_snapshots(self):
        self.first_deploy()
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.served(), NEW)
        self.assertFalse(self.compose_stops() or self.commands('capture'))
        self.assertEqual(len(self.sql), 1)  # only the runtime role assertion, run before any application starts
        self.assertIn("RAISE EXCEPTION 'privileged_or_missing_role'", self.sql[0])

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

    def test_commit_prunes_the_rendered_stacks_of_older_and_refused_releases_with_their_odoo_conf(self):
        for name in (ANCIENT, 'c' * 40):  # an old release and a candidate that was refused earlier
            (self.state / 'stack' / name).mkdir(parents=True)
            (self.state / 'stack' / name / 'odoo.conf').write_text(f'db_password = {SECRET}\n')
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(sorted(path.name for path in (self.state / 'stack').iterdir()), sorted([OLD, NEW]))

    def test_the_render_cache_follows_the_inputs_of_the_one_directory_a_commit_has(self):
        releaser = release.Releaser('staging', release.load_config(self.paths, 'staging'), self.paths, self.runner,
                                    lambda *_: None, self.environ, self.machine)
        releaser.state.mkdir(parents=True, exist_ok=True)
        checkout = self.paths.releases / OLD
        first, second = self.root / 'one.env', self.root / 'two.env'
        first.write_text('LIWAN_STACK_DB_HOST_LINK=true\n')
        second.write_text('LIWAN_STACK_DB_HOST_LINK=false\n')
        rendered = lambda: 'liwan-dbhost' in (self.state / 'stack' / OLD / 'compose.yml').read_text()  # noqa: E731
        releaser.stack(checkout, first)
        self.assertTrue(rendered())
        releaser.stack(checkout, second)
        self.assertFalse(rendered())
        releaser.stack(checkout, first)  # back to the first inputs: the files on disk are re-rendered, not the stale entry
        self.assertTrue(rendered())
        before = len(self.runner.renders)
        releaser.stack(checkout, first)
        self.assertEqual(len(self.runner.renders), before)  # unchanged inputs reuse the render

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
        self.tags = {'release/19.0.1.0.8': 'c' * 40}  # a new candidate is tried
        self.document = document('c' * 40)
        self.assertEqual(self.main(), release.EXIT_OK)
        self.assertEqual(self.served(), 'c' * 40)

    def test_rollback_command_clears_the_failed_candidate(self):
        release.write_json(self.state / 'failed.json', {'commit': NEW, 'reason': 'x'})
        self.assertEqual(self.main('rollback', '--environment', 'staging'), release.EXIT_OK)
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
                self.assertEqual(self.main('status', '--environment', 'staging'), release.EXIT_OK)
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
        release.main(['run', '--environment', 'staging'], paths=self.paths, runner=runner, log=log,
                     environ=self.environ, machine=self.machine)
        logged = self.log_stream.getvalue()
        self.assertIn('db password *** and s3 *** and token ***', logged)
        for secret in (SECRET, BACKUP_SECRET, TOKEN, GITHUB_TOKEN):
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
        self.assertEqual(self.main('run', '--environment', 'production', '--tag', self.tag), release.EXIT_REFUSED)
        self.assertEqual(self.result(), 'refused not_on_main')
        self.assertFalse(self.compose_stops() or self.product_pulls())
        self.on_main = True
        self.assertEqual(self.main('run', '--environment', 'production', '--tag', self.tag), release.EXIT_OK)

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
