# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Opt-in scratch Compose first-create runner. JSON stdin/stdout, no shell.

Permanent reservations are never reclaimed automatically, even after lease
expiry. A controller grants every physical stage after fresh authoritative
claim validation. Interrupted attempts can only be independently observed.
"""
from __future__ import annotations
from contextlib import contextmanager, suppress
import json
import os
from pathlib import Path
import re
import secrets
import select
import signal
import subprocess
import sys
import threading

from deploy.release.tenant_postgres import (
    ODOO_RUNTIME_ROLE, POSTGRES_ADMIN_ROLE, tenant_bootstrap_sql, tenant_create_database_sql, tenant_isolation_sql,
)

from tools.liwan_cli.managed_verify import ERROR_CODES, VerificationError, build_policy_script, build_snapshot_script, parse_snapshot
from tools.shared_saas_lifecycle.catalog_source import CatalogSourceError, resolve_catalog_path
from tools.liwan_cli.managed_credentials import build_credentials_script, parse_credentials
from tools.liwan_cli.managed_policy import POLICY_ERROR_CODES, PolicyError, parse_create_policy, parse_package_create_policy

from tools.catalog_check import TEST_ONLY_MODULES
from tools.liwan_cli.module_closure import REPO_ADDONS

MODULE_ID = re.compile(r'(?:liwan|customer)_[a-z0-9_]+')
# The routed tenant host (`t<id>.<domain suffix>`), the same DNS name the routing registry accepts.
TENANT_HOST = re.compile(r'(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+')
MAX_OUTPUT = 65536
TENANT_DB_ROLE = ODOO_RUNTIME_ROLE  # db_user of the rendered Odoo config (deploy/stack/odoo.conf.template): the grantee, never the role that runs DDL
# The AI role's grants and schema in a tenant database: the file the operator also runs.
AI_TENANT_SCHEMA = Path(__file__).resolve().parents[2] / 'deploy' / 'ai' / 'tenant_schema.sql'
# System parameter that binds a tenant database to its control-plane tenant. The final deletion of a workspace
# refuses any database whose marker differs from the tenant it was asked to delete.
TENANT_MARKER_PARAMETER = 'liwan.control.tenant_id'
CONTROL_TENANT_ID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')

class EffectError(ValueError):
    pass


# Usage observations and read-back snapshots: `<project>-effect-<attempt8>-<kind>-<hex>`.
OBSERVE_CONTAINER = re.compile(r'-effect-[a-f0-9]{8}-(?:observe|snapshot|read-admin)-[a-f0-9]+$')


def validate_database(value):
    if not isinstance(value, str) or not re.fullmatch(r'liwan_scratch_[a-f0-9]{32}', value):
        raise EffectError('database_invalid')
    return value


def validate_modules(value):
    """A non-empty list of distinct LiwanOS or customer addons shipped in this repository.

    Which modules a policy installs comes from the trusted catalog; this only refuses
    names that cannot be an addon of this release (including test-only addons), so a new application needs no edit.
    """
    if (not isinstance(value, list) or not value
            or not all(isinstance(name, str) for name in value) or len(set(value)) != len(value)
            or not all(MODULE_ID.fullmatch(name) and name not in TEST_ONLY_MODULES
                       and (REPO_ADDONS / name / '__manifest__.py').is_file() for name in value)):
        raise EffectError('modules_invalid')
    return value


def validate_host(value, domain_suffix):
    if (not isinstance(value, str) or not TENANT_HOST.fullmatch(value)
            or not value.endswith('.' + domain_suffix)):
        raise EffectError('host_invalid')
    return value


def require_new_target(database_exists, filestore_exists):
    if database_exists is not False or filestore_exists is not False:
        raise EffectError('existing_target_refused')


def no_symlink(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise EffectError('runtime_path_invalid')
    for entry in [path, *path.parents]:
        if entry.is_symlink():
            raise EffectError('runtime_path_invalid')
    return path


def reserve(path, value):
    no_symlink(path)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except OSError:
        raise EffectError('resource_reserved') from None
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    parent = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


TERMINATION_SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)


def ignore_termination():
    for signum in TERMINATION_SIGNALS:
        signal.signal(signum, signal.SIG_IGN)


def install_termination_handler(runner):
    """The first termination signal cancels the running command and aborts the effect with `authority_lost`, so the
    cleanup in the `except` blocks runs (the backup restarts the shared odoo service). Every later signal is ignored
    for the rest of the process, so the cleanup is not interrupted: systemd (KillMode=control-group) and the gate both
    signal the group, and a second SIGTERM would otherwise kill the restart and leave odoo down for every tenant.
    A signal that arrives while that restart itself runs (`runner.restarting`) is ignored the same way: it is the only
    command that brings odoo back, so cancelling or aborting it would turn a signal into `odoo_restart_failed`.
    The cleanup is bounded (cancel 25 s + restart 30 s, inside the gate's grace of 60 s and the unit's TimeoutStopSec
    of 90 s)."""
    def terminate(_signum, _frame):
        signal.pthread_sigmask(signal.SIG_BLOCK, TERMINATION_SIGNALS)
        ignore_termination()
        if runner.restarting:
            return
        runner.cancel()
        raise EffectError('authority_lost')
    for signum in TERMINATION_SIGNALS:
        signal.signal(signum, terminate)


@contextmanager
def block_termination_signals():
    """Shield the post-failure odoo restart from a termination signal: the handler would raise `authority_lost` and
    skip the restart, leaving odoo down for every tenant. From the moment the signals are blocked here, a signal
    stays pending for the restart's duration. If odoo is started again, it is delivered when the previous mask is
    restored and still cancels the run with `authority_lost`; if the restart itself fails, `restart_after_failure`
    ignores the signals and the held one is discarded so that `odoo_restart_failed` stays the outcome. The few
    instructions between entering the cleanup path and this call stay uncovered: a signal landing there is consumed
    straight away and can still skip the restart — nothing in Python can block signals before its own cleanup path
    starts running. A signal that arrives while the restart itself runs is released to the handler again, whose
    `restarting` guard ignores it without touching the restart."""
    previous = signal.pthread_sigmask(signal.SIG_BLOCK, TERMINATION_SIGNALS)
    try:
        yield
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous)


class RuntimeGate:
    """Persistent project-wide ownership. Never reclaimed after unknown failure."""
    def __init__(self, root, identity):
        self.root = no_symlink(Path(root))
        self.path = self.root / 'runtime-gate'
        self.identity = identity

    def acquire(self):
        try:
            self.path.mkdir(mode=0o700)
        except OSError:
            raise EffectError('runtime_requires_intervention') from None
        reserve(self.path / 'owner.json', self.identity)

    def complete(self):
        no_symlink(self.path)
        if json.loads((self.path / 'owner.json').read_text()) != self.identity:
            raise EffectError('runtime_ownership_lost')
        history = self.root / 'runtime-gate-history'
        history.mkdir(mode=0o700, exist_ok=True)
        no_symlink(history)
        destination = history / self.identity['attemptId']
        if destination.exists():
            raise EffectError('runtime_completion_conflict')
        self.path.rename(destination)
        fd = os.open(self.root, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def verified_observation(request, verified):
    if not verified:
        return {'state': 'partial'}
    return {'state': 'present', 'binding': request['job']['binding'],
            'businessKey': request['businessKey'], 'payloadDigest': request['payloadDigest'], 'verified': True}


def password_step_script(database, credentials):
    """Probe the routed admin's password step without requesting or consuming a second factor."""
    auth = {'jsonrpc': '2.0', 'method': 'call', 'id': 1, 'params': {
        'db': database, 'login': credentials['login'], 'password': credentials['password'],
    }}
    values = f'database = {database!r}\npayload = {json.dumps(auth)!r}\n'
    return values + '''
import http.cookiejar
import json
import urllib.error
import urllib.request

root = 'http://127.0.0.1:8069'
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
login = urllib.request.Request(root + '/web/session/authenticate', data=payload.encode(),
                               headers={'Content-Type': 'application/json', 'Host': database})
verified = False
try:
    with opener.open(login, timeout=25) as response:
        result = json.load(response)
    if 'error' not in result and result.get('result') == {'uid': None}:
        channels = urllib.request.Request(root + '/api/v1/auth/channels', headers={'Host': database})
        with opener.open(channels, timeout=10) as response:
            options = json.load(response)
        verified = options.get('has_email') is True and 'email' in options.get('channels', [])
except urllib.error.HTTPError as error:
    if error.code not in (401, 403):
        raise
    verified = False
print(json.dumps({'passwordStepVerified': verified}))
'''


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


def permit(stage):
    emit({'permit': stage})
    ready, _, _ = select.select([sys.stdin], [], [], 35)
    if not ready or json.loads(sys.stdin.readline(1024)) != {'proceed': True}:
        raise EffectError('authority_lost')


class Runner:
    # Set while the post-failure `start odoo` runs: `install_termination_handler` ignores a signal that arrives then
    # instead of cancelling the one command that brings the shared odoo back for every tenant.
    restarting = False

    def __init__(self, request):
        self.request = request
        self.config = request['config']
        config = self.config
        if (set(config) != {'schemaVersion', 'projectName', 'composeFile', 'envFile', 'stateDir', 'domainSuffix'}
                or config['schemaVersion'] != 1
                or not re.fullmatch(r'liwan-(?:saas|shared)-[a-z0-9-]{3,48}', config['projectName'])):
            raise EffectError('runtime_invalid')
        for key in ('composeFile', 'envFile', 'stateDir'):
            no_symlink(config[key])
        self.database = validate_database(request['job']['binding']['database'])
        if request['job']['operation'] not in ('provision', 'backup', 'restore') or request['job']['binding']['filestore'] != self.database:
            raise EffectError('operation_unavailable')
        if request['job']['operation'] == 'provision':
            # Top level beside `host` and `companyName`: the provision job schema itself does not carry the control tenant.
            if not isinstance(request.get('controlTenantId'), str) or not CONTROL_TENANT_ID.fullmatch(request['controlTenantId']):
                raise EffectError('input_invalid')
            validate_modules(request['job']['policy']['modules'])
            validate_host(request.get('host'), config['domainSuffix'])
        self.root = Path(config['stateDir'])
        self.reservation = self.root / 'reservations' / (self.database + '.json')
        self.credential = self.root / 'credentials' / (self.database + '.json')
        self.classification = self.root / 'classifications' / (self.database + '.json')
        self.base = ['docker', 'compose', '--project-name', config['projectName'], '--env-file', config['envFile'], '--file', config['composeFile']]
        self.current_container = None
        self.child = None

    def command(self, args, *, stdin='', timeout=90, stdout_only=False, detached=False):
        # Continuously drain into a bounded tail; installation logs cannot grow
        # Python memory or a temporary disk spool without limit.
        tail = bytearray()
        stderr = subprocess.DEVNULL if stdout_only else subprocess.STDOUT
        # `detached`: its own session, and the termination signals ignored (the disposition survives exec), so neither a
        # group signal from the gate nor a second signal to the effect can cut a command that must finish (the odoo restart).
        extra = {'start_new_session': True, 'preexec_fn': ignore_termination} if detached else {}
        self.child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, **extra)
        child = self.child
        def drain():
            while True:
                chunk = child.stdout.read(8192)
                if not chunk:
                    return
                tail.extend(chunk)
                if len(tail) > MAX_OUTPUT:
                    del tail[:-MAX_OUTPUT]
        reader = threading.Thread(target=drain, daemon=True)
        # Both helper threads start with the termination signals blocked (a thread inherits the mask of the thread
        # that starts it): a process-directed signal accepted by a helper is consumed instead of staying pending for
        # the main thread, which would defeat the post-failure restart shield no matter when the handler then fires.
        with block_termination_signals():
            reader.start()
        def feed():
            # A client that never reads must not block the effect on the pipe (only the worker's deadline would
            # rescue it then): the write runs beside `wait(timeout)` and the child's exit status decides the outcome.
            try:
                child.stdin.write(stdin.encode())
            except OSError:
                pass  # the child exited or stopped reading; its return code reports the failure
            finally:
                with suppress(OSError):
                    child.stdin.close()
        writer = threading.Thread(target=feed, daemon=True)
        with block_termination_signals():  # see the reader above: the helpers never accept a termination signal
            writer.start()
        try:
            child.wait(timeout=timeout)
            reader.join(timeout=5)
            writer.join(timeout=5)
            if child.returncode != 0 or reader.is_alive():
                raise EffectError('runtime_command_failed')
            return bytes(tail).decode('utf-8', errors='replace')
        except subprocess.TimeoutExpired:
            self.cancel()
            writer.join(timeout=5)  # the killed child closes the pipe; the feeder then closes its write end
            raise EffectError('runtime_timeout') from None
        finally:
            child.stdout.close()
            self.child = None

    def cancel(self):
        # A Compose client exit is not proof its container stopped. Kill only the
        # deterministic per-attempt name; reservations stay forever on any error.
        if self.current_container:
            subprocess.run(['docker', 'kill', self.current_container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)
        if self.child and self.child.poll() is None:
            self.child.kill()
            self.child.wait(timeout=10)

    def preflight(self):
        """Validate the runtime and the request; return whether the rendered project runs the ai service."""
        config = json.loads(self.command(self.base + ['config', '--format', 'json']))
        if config.get('name') != self.config['projectName'] or not {'db', 'odoo'} <= set(config.get('services', {})):
            raise EffectError('foreign_project')
        # The `ai` service is in the rendered config only when the env file enables the ai profile.
        ai_enabled = 'ai' in config['services']
        ids = self.command(self.base + ['ps', '-q', 'db']).strip().splitlines()
        if len(ids) != 1 or not re.fullmatch(r'[a-f0-9]{12,64}', ids[0]):
            raise EffectError('database_service_unavailable')
        inspect = json.loads(self.command(['docker', 'inspect', ids[0]]))[0]
        labels = inspect.get('Config', {}).get('Labels', {})
        if labels.get('com.docker.compose.project') != self.config['projectName'] or labels.get('com.docker.compose.service') != 'db':
            raise EffectError('foreign_project')
        if self.request['job']['operation'] != 'provision':
            return ai_enabled
        # The first customer administrator counts against users.limit (the control
        # plane's admitsRequiredAdmin rule): refuse before any reservation or install.
        limit = self.request['job']['policy']['features'].get('users.limit')
        if limit is not None and (type(limit) is not int or limit < 1):
            raise EffectError('users_limit_admin_required')
        # Policy composition is checked against the shipped catalog bytes, in
        # addition to the signed immutable catalog selected by the server.
        try:
            catalog = resolve_catalog_path(self.request['job']['catalog']['sourceSha256'])
        except CatalogSourceError:
            raise
        policy = json.dumps(self.request['job']['policy']).encode()
        reference = self.request['job'].get('packageAuthority')
        trusted = self.request.get('packageAuthority')
        if reference is not None or trusted is not None:
            if not reference or reference.get('catalog') != self.request['job']['catalog']:
                raise EffectError('package_authority_mismatch')
            parse_package_create_policy(policy, catalog_path=catalog,
                catalog_sha256='sha256:' + self.request['job']['catalog']['sourceSha256'],
                commercial_mode='saas', package_reference=reference, trusted_authority=trusted)
        else:
            parse_create_policy(policy, catalog_path=catalog,
                                catalog_sha256='sha256:' + self.request['job']['catalog']['sourceSha256'], commercial_mode='saas')
        return ai_enabled

    def exists(self):
        sql = "SELECT count(*) FROM pg_database WHERE datname='" + self.database + "'"
        result = self.command(self.base + ['exec', '-T', 'db', 'psql', '-U', POSTGRES_ADMIN_ROLE, '-d', 'postgres', '-At', '-c', sql]).strip()
        if result not in ('0', '1'):
            raise EffectError('database_observation_invalid')
        return result == '1'

    def _admin_psql(self, database, sql, variables=()):
        assignments = [argument for name, value in variables for argument in ('-v', name + '=' + value)]
        self.command(self.base + ['exec', '-T', 'db', 'psql', '-U', POSTGRES_ADMIN_ROLE, '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', *assignments], stdin=sql)

    def psql(self, sql, variables=()):
        # Admin statements run in database `postgres` only (c1b rule 1); the AI schema script reconnects to the
        # tenant database itself, pinned to pg_catalog.
        self._admin_psql('postgres', sql, variables)

    def bootstrap_tenant_database(self):
        # The one other admin script inside a tenant database (c1b rule 2): the fixed bootstrap, run in the still
        # empty target. Nothing that reads or writes tenant tables runs as the admin role.
        self._admin_psql(self.database, tenant_bootstrap_sql(TENANT_DB_ROLE))

    def create_isolated_database(self):
        # Odoo would create the database itself on `-d`, open to every role through PUBLIC. Create it
        # here instead, close it to PUBLIC, and only then let Odoo install into the existing empty
        # database (it initializes any database without ir_module_module). The creation recipe is
        # Odoo's own (deploy/release/tenant_postgres.py). Any failure raises and the job fails before the
        # install runs.
        self.psql(tenant_create_database_sql(self.database) + ';\n'
                  + tenant_isolation_sql(self.database, TENANT_DB_ROLE))
        # The database belongs to the admin role: the runtime role may create its tables in `public` only by the grant in the bootstrap.
        self.bootstrap_tenant_database()

    def prepare_ai_state(self, ai_enabled):
        # The AI role needs its grants and schema (a no-op without the role) and, when the deployment
        # runs the ai service, its tables: the runtime only validates them (`ai_state_uninitialized`).
        # The release control state comes first, once per deployment (for `ai_control_state_uninitialized`),
        # then the tenant state. All depend on the isolated empty database only, not on the Odoo install,
        # so they run first and a failure costs no install.
        # All are idempotent.
        self.psql(AI_TENANT_SCHEMA.read_text(), variables=[('tenant_db', self.database)])
        if not ai_enabled:
            return
        self.run_ai_initialization('control', '--initialize-control')
        self.run_ai_initialization('tenant', '--initialize-tenant', self.database)

    def run_ai_initialization(self, step, *arguments):
        self.current_container = self.config['projectName'] + '-effect-' + self.request['attemptId'][:8] + '-ai-' + step
        try:
            self.command(self.base + ['run', '--rm', '--no-deps', '-T', '--name', self.current_container,
                'ai', 'python', '-m', 'liwan_ai_service.store', *arguments], timeout=300)
        finally:
            self.current_container = None

    def filestore_exists(self):
        script = 'import json; from pathlib import Path; p=Path(' + repr('/var/lib/odoo/filestore/' + self.database) + '); print(json.dumps(p.exists() or p.is_symlink()))'
        value = json.loads(self.command(self.base + ['exec', '-T', 'odoo', '/opt/venv/bin/python', '-c', script]))
        if type(value) is not bool:
            raise EffectError('filestore_observation_invalid')
        return value

    def shell(self, script, stage, *, mutate=False):
        if mutate:
            permit(stage)
        attempt = self.request.get('attemptId') or self.request['job']['requestId']
        if not re.fullmatch(r'[a-f0-9-]{36}', attempt):
            raise EffectError('attempt_invalid')
        # Observation names use random suffixes and never collide with effects.
        suffix = stage if mutate else stage + '-' + secrets.token_hex(4)
        name = self.config['projectName'] + '-effect-' + attempt[:8] + '-' + suffix
        self.current_container = name
        args = self.base + ['run', '--rm', '--no-deps', '-T', '--name', name,
            '-e', 'LIWAN_COMMERCIAL_CONFIG=/run/liwan-runtime/classifications/' + self.database + '.json',
            '--entrypoint', '/usr/local/bin/liwan-odoo', 'odoo', 'shell', '-c', '/etc/odoo/odoo.conf',
            '-d', self.database, '--no-http']
        try:
            return self.command(args, stdin=script, timeout=180)
        finally:
            self.current_container = None

    def assert_no_effect_containers(self, *, ignore_observe=False, code='runtime_writer_present'):
        rows = self.command(['docker', 'ps', '--filter', 'label=com.docker.compose.project=' + self.config['projectName'], '--format', '{{.Names}}']).splitlines()
        for name in rows:
            if '-effect-' in name and not (ignore_observe and OBSERVE_CONTAINER.search(name)):
                raise EffectError(code)

    def apply_owned(self):
        permit('runtime')
        # Refuse a busy project BEFORE the gate exists: a refusal here has run no effect, so it
        # leaves nothing behind and the job can simply be retried once the other container ended.
        self.assert_no_effect_containers()
        gate = RuntimeGate(self.root, {'attemptId': self.request['attemptId'], 'fence': self.request['fence'], 'digest': self.request['payloadDigest']})
        gate.acquire()
        self.apply()
        permit('release')
        # Our effects are done and verified. A read-only usage observation of another tenant that
        # is still running must not wedge the lane (the gate would stay forever), so only a
        # container that can write (a mutating effect) refuses the release.
        self.assert_no_effect_containers(ignore_observe=True, code='runtime_writer_after_effect')
        gate.complete()

    def apply(self):
        ai_enabled = self.preflight()
        if type(ai_enabled) is not bool:  # a preflight that did not decide must stop the job, never skip the AI state
            raise EffectError('runtime_invalid')
        permit('reserve')
        for name in ('reservations', 'credentials', 'classifications'):
            entry = self.root / name
            if not entry.exists():
                mode = 0o755 if name == 'classifications' else 0o700
                entry.mkdir(mode=mode)
                entry.chmod(mode)  # mkdir's mode is masked by the unit's UMask=0077
            no_symlink(entry)
        require_new_target(self.exists(), self.filestore_exists())
        reserve(self.reservation, {'requestId': self.request['job']['requestId'], 'digest': self.request['payloadDigest'],
            'attemptId': self.request['attemptId'], 'fence': self.request['fence'], 'state': 'reserved'})
        # Reservation first, credentials never overwritten; interruption remains
        # quarantined, not a reason to rotate an existing human password.
        secret = secrets.token_urlsafe(36)
        reserve(self.credential, {'login': self.request['admin']['login'], 'password': secret, 'database': self.database})
        reserve(self.classification, {'schema_version': 1, 'database': self.database, 'commercial_mode': 'saas',
            'entitlement_source': 'control_plane', 'expected_valid_until': None, 'valid_until_action': 'preserve'})
        self.classification.chmod(0o644)
        permit('install')
        self.create_isolated_database()
        self.prepare_ai_state(ai_enabled)
        self.current_container = self.config['projectName'] + '-effect-' + self.request['attemptId'][:8] + '-install'
        try:
            self.command(self.base + ['run', '--rm', '--no-deps', '-T', '--name', self.current_container,
                '-e', 'LIWAN_COMMERCIAL_CONFIG=/run/liwan-runtime/classifications/' + self.database + '.json',
                '--entrypoint', '/usr/local/bin/liwan-odoo', 'odoo', '-c', '/etc/odoo/odoo.conf', '-d', self.database,
                '-i', ','.join(self.request['job']['policy']['modules']), '--without-demo=all', '--stop-after-init', '--no-http'], timeout=1500)
        finally:
            self.current_container = None
        policy = self.request['job']['policy']
        parse_snapshot(self.shell(build_policy_script(policy, self.database), 'policy', mutate=True), policy, self.database)
        credentials_script = 'import os\nos.environ["LIWAN_ADMIN_PASSWORD"] = ' + repr(secret) + '\n' + build_credentials_script(self.database)
        parse_credentials(self.shell(credentials_script, 'password', mutate=True), self.database)
        output = self.shell(self.admin_script(secret, snapshot=False), 'admin', mutate=True)
        self.parse_admin(output)
        permit('complete')
        reserve(self.root / 'reservations' / (self.database + '.complete'), {'digest': self.request['payloadDigest'], 'attemptId': self.request['attemptId']})
        emit({'result': {'applied': True}})

    def admin_script(self, secret, *, snapshot):
        values = {'database': self.database, 'name': self.request['admin']['name'], 'login': self.request['admin']['login'],
                  'companyName': self.request['companyName'], 'host': self.request['host'],
                  'controlTenantId': self.request['controlTenantId'], 'markerParameter': TENANT_MARKER_PARAMETER,
                  'mobile': self.request['admin'].get('mobile')}
        prefix = 'import json\nvalues = json.loads(' + repr(json.dumps(values)) + ')\nsecret = ' + repr(secret) + '\nsnapshot = ' + repr(snapshot) + '\n'
        return prefix + '''
result = {'verified': False}
try:
    from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
    from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
    if snapshot:
        env.cr.rollback()
        env.cr.execute('SET TRANSACTION READ ONLY')
        env.invalidate_all(flush=False)
    assert env.cr.dbname == values['database'] and env.su and env.uid == 1
    profile = env['liwan.tenant.profile'].search([], limit=2)
    assert len(profile) == 1 and profile.policy_revision == 1
    admin = env.ref('base.user_admin')
    assert admin.id != 1 and admin.active and admin.company_id == profile.root_company_id
    # Every application is installed; the applied policy decides the roles.
    keys = env['liwan.entitlement.service']._liwan_entitled_admin_roles()
    if not snapshot:
        assert admin.login == 'admin'
        admin._liwan_access_write({'login': values['login'], 'name': values['name'], 'email': values['login']}, 'access.users.update')
        profile.root_company_id.write({'name': values['companyName']})
        # Stock builds payment return/webhook and mail links from web.base.url: pin it to the routed host.
        profile.with_context(**{OPERATOR_CONTEXT: True})._liwan_set_public_origin(values['host'])
        # Binds this database to its control-plane tenant; idempotent for the same tenant, so a resumed run is safe.
        env['ir.config_parameter'].set_param(values['markerParameter'], values['controlTenantId'])
        for key in keys:
            role = env['liwan.access.role'].search([('key', '=', key)], limit=1)
            assert role
            assignment = env['liwan.access.assignment'].search([('user_id', '=', admin.id), ('role_id', '=', role.id), ('company_id', '=', profile.root_company_id.id)])
            if not assignment:
                env['liwan.access.assignment'].create({'user_id': admin.id, 'role_id': role.id, 'company_id': profile.root_company_id.id})
        # The stock liwan install seeds admin as vendor support. The first
        # administrator of a shared SaaS tenant is always the customer's own
        # (package or catalog provisioning alike), so it is counted against
        # users.limit and is not vendor support.
        support = env.ref('liwan_core.group_vendor_support')
        admin._liwan_access_write({'group_ids': [(3, support.id, 0)]}, 'access.users.assign_roles')
        # Role creation above may have synced support's wildcard grants.
        # Re-derive permission groups from retained customer assignments;
        # the existing service preserves unrelated explicit groups.
        admin._liwan_sync_capability_groups()
        # The number the sign-up verified by SMS spares the administrator the first-login mobile gate. A taken or
        # malformed number writes nothing and never fails provisioning: the gate simply stays.
        if values['mobile']:
            access = env['liwan.access.service']
            try:
                with access._liwan_mobile_guard():
                    admin._liwan_access_write({'liwan_mobile': access._liwan_normalize_mobile(values['mobile'])}, 'access.users.update')
            except LiwanAccessRule:
                pass
        env.flush_all()
    service = env['liwan.entitlement.service']
    assert not admin.share and not admin.has_group('liwan_core.group_vendor_support')
    assert admin.id not in service._liwan_excluded_user_ids()
    # Removing support is not a quota claim, so check the applied limit here:
    # a tenant must not be born over its own users.limit.
    users = service._liwan_count_users()
    limit = service._liwan_limit_value('users.limit')
    assert users >= 1 and (limit is None or users <= limit)
    assert admin.login == values['login'] and admin.name == values['name'] and admin.email == values['login']
    assert profile.root_company_id.name == values['companyName']
    params = env['ir.config_parameter']
    assert params.get_param('web.base.url') == 'https://' + values['host'] and params.get_param('web.base.url.freeze')
    assert params.get_param(values['markerParameter']) == values['controlTenantId']
    assigned = env['liwan.access.assignment'].search([('user_id', '=', admin.id), ('company_id', '=', profile.root_company_id.id)]).mapped('role_id.key')
    assert set(keys) <= set(assigned)
    env.cr.execute('SELECT password FROM res_users WHERE id=%s', [admin.id])
    hashed = env.cr.fetchone()[0]
    assert admin._crypt_context().verify(secret, hashed) and not admin._crypt_context().verify('admin', hashed)
    result = {'verified': True, 'uid': admin.id}
    if snapshot:
        env.cr.rollback()
    else:
        env.cr.commit()
        # The shared server may already cache this database's parameters: signal the pinned origin.
        env.registry.signal_changes()
except Exception:
    env.cr.rollback()
finally:
    secret = None
print('LIWAN_SHARED_ADMIN:' + json.dumps(result))
'''

    def parse_admin(self, output):
        rows = [line[len('LIWAN_SHARED_ADMIN:'):] for line in output.splitlines() if line.startswith('LIWAN_SHARED_ADMIN:')]
        if len(rows) != 1:
            raise EffectError('admin_unverified')
        value = json.loads(rows[0])
        if set(value) != {'verified', 'uid'} or value['verified'] is not True or type(value['uid']) is not int or value['uid'] <= 1:
            raise EffectError('admin_unverified')
        return value['uid']

    def observe(self):
        if (self.root / 'runtime-gate').exists():
            return {'state': 'unknown'}
        self.preflight()
        if not self.exists():
            return {'state': 'partial'} if self.reservation.exists() or self.filestore_exists() else {'state': 'absent'}
        if not self.reservation.exists():
            return {'state': 'partial'}
        completion = self.root / 'reservations' / (self.database + '.complete')
        if not completion.exists():
            return {'state': 'unknown'}
        no_symlink(completion)
        if json.loads(completion.read_text()).get('digest') != self.request['payloadDigest']:
            return {'state': 'partial'}
        no_symlink(self.reservation)
        reservation = json.loads(self.reservation.read_text())
        if reservation.get('digest') != self.request['payloadDigest'] or reservation.get('requestId') != self.request['job']['requestId']:
            return {'state': 'partial'}
        # No evidence can activate a route while the original physical actor has
        # a running container. Lease expiry alone never grants this permission.
        prefix = self.config['projectName'] + '-effect-' + reservation['attemptId'][:8] + '-'
        running = self.command(['docker', 'ps', '--filter', 'name=' + prefix, '--format', '{{.Names}}']).strip()
        if running:
            return {'state': 'unknown'}
        no_symlink(self.credential)
        credentials = json.loads(self.credential.read_text())
        policy = self.request['job']['policy']
        snapshot = parse_snapshot(self.shell(build_snapshot_script(self.database), 'snapshot'), policy, self.database)
        if snapshot['policy_revision'] != 1:
            return {'state': 'partial'}
        self.parse_admin(self.shell(self.admin_script(credentials['password'], snapshot=True), 'read-admin'))
        # The shell pins the exact user and mailbox. The HTTP hop verifies that the stored password
        # establishes a usable pending session on the routed database without sending a code.
        result = json.loads(self.command(
            self.base + ['exec', '-T', 'odoo', '/opt/venv/bin/python', '-'],
            stdin=password_step_script(self.database, credentials), timeout=45,
        ))
        return verified_observation(self.request, result == {'passwordStepVerified': True})


# Non-secret refusal codes that may be reported; everything else is opaque.
REPORTABLE_CODES = frozenset(ERROR_CODES) | {
    'catalog_source_unavailable', 'catalog_source_ambiguous',
} | set(POLICY_ERROR_CODES)

WRITER_REFUSALS = frozenset({'runtime_writer_present', 'runtime_writer_after_effect'})
# What a restore stage writes to its stderr when it refuses on purpose; the only stderr text that reaches a result.
STREAM_REFUSALS = ('ai_password_missing', 'ai_data_without_role', 'ai_archive_unreadable')
# Refusals raised before any effect; non-secret and distinct for the operator.
PRE_EFFECT_REFUSALS = frozenset({'inventory_role_fenced'})
# Backup outcomes the operator must tell apart: the shared Odoo could not be restarted (down for every tenant),
# and an inventory that cannot fit a valid manifest (refused before any outage when knowable).
BACKUP_REFUSALS = frozenset({'odoo_restart_failed', 'inventory_too_large'})


def classify_error(error):
    code = getattr(error, 'code', None)
    if isinstance(error, (VerificationError, CatalogSourceError)) and code in REPORTABLE_CODES:
        return code
    # Policy/catalog validation refusals carry stable safe codes only.
    if isinstance(error, PolicyError) and error.code in POLICY_ERROR_CODES:
        return error.code
    # Writer refusals are non-secret and the control plane tells them apart: only the
    # pre-gate one (nothing ran) may be retried.
    if isinstance(error, EffectError) and str(error) in WRITER_REFUSALS | PRE_EFFECT_REFUSALS | BACKUP_REFUSALS | set(STREAM_REFUSALS):
        return str(error)
    return 'shared_effect_unverified'


def main():
    runner = None
    try:
        raw = sys.stdin.readline(MAX_OUTPUT + 1)
        if len(raw) > MAX_OUTPUT:
            raise EffectError('input_invalid')
        request = json.loads(raw)
        runner = Runner(request)
        install_termination_handler(runner)
        if request['action'] == 'observe':
            emit({'result': runner.observe()})
        elif request['action'] == 'apply':
            runner.apply_owned()
        else:
            raise EffectError('operation_unavailable')
    except Exception as error:
        # Never disclose input, secret, command output, paths or exception text.
        # Only a code from the explicit allowlist crosses the boundary.
        emit({'error_code': classify_error(error)})
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
