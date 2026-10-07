# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Opt-in scratch Compose first-create runner. JSON stdin/stdout, no shell.

Permanent reservations are never reclaimed automatically, even after lease
expiry. A controller grants every physical stage after fresh authoritative
claim validation. Interrupted attempts can only be independently observed.
"""
from __future__ import annotations
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

from tools.nasq_cli.managed_verify import ERROR_CODES, VerificationError, build_policy_script, build_snapshot_script, parse_snapshot
from tools.shared_saas_lifecycle.catalog_source import CatalogSourceError, resolve_catalog_path
from tools.nasq_cli.managed_credentials import build_credentials_script, parse_credentials
from tools.nasq_cli.managed_policy import POLICY_ERROR_CODES, PolicyError, parse_create_policy, parse_package_create_policy

ALLOWED_MODULES = {
    'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_notify', 'nasq_directory',
    'nasq_pmo', 'nasq_meetings', 'nasq_meetings_pmo', 'nasq_hr', 'nasq_chat',
}
MAX_OUTPUT = 65536

class EffectError(ValueError):
    pass


def validate_database(value):
    if not isinstance(value, str) or not re.fullmatch(r'nasq_scratch_[a-f0-9]{32}', value):
        raise EffectError('database_invalid')
    return value


def validate_modules(value):
    if (not isinstance(value, list) or not value or len(set(value)) != len(value)
            or not set(value) <= ALLOWED_MODULES):
        raise EffectError('modules_invalid')
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


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


def permit(stage):
    emit({'permit': stage})
    ready, _, _ = select.select([sys.stdin], [], [], 35)
    if not ready or json.loads(sys.stdin.readline(1024)) != {'proceed': True}:
        raise EffectError('authority_lost')


class Runner:
    def __init__(self, request):
        self.request = request
        self.config = request['config']
        config = self.config
        if (set(config) != {'schemaVersion', 'projectName', 'composeFile', 'envFile', 'stateDir', 'domainSuffix'}
                or config['schemaVersion'] != 1
                or not re.fullmatch(r'nasq-(?:saas|shared)-[a-z0-9-]{3,48}', config['projectName'])):
            raise EffectError('runtime_invalid')
        for key in ('composeFile', 'envFile', 'stateDir'):
            no_symlink(config[key])
        self.database = validate_database(request['job']['binding']['database'])
        if request['job']['operation'] not in ('provision', 'backup', 'restore') or request['job']['binding']['filestore'] != self.database:
            raise EffectError('operation_unavailable')
        if request['job']['operation'] == 'provision':
            validate_modules(request['job']['policy']['modules'])
        self.root = Path(config['stateDir'])
        self.reservation = self.root / 'reservations' / (self.database + '.json')
        self.credential = self.root / 'credentials' / (self.database + '.json')
        self.classification = self.root / 'classifications' / (self.database + '.json')
        self.base = ['docker', 'compose', '--project-name', config['projectName'], '--env-file', config['envFile'], '--file', config['composeFile']]
        self.current_container = None
        self.child = None

    def command(self, args, *, stdin='', timeout=90):
        # Continuously drain into a bounded tail; installation logs cannot grow
        # Python memory or a temporary disk spool without limit.
        tail = bytearray()
        self.child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
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
        reader.start()
        try:
            child.stdin.write(stdin.encode())
            child.stdin.close()
            child.wait(timeout=timeout)
            reader.join(timeout=5)
            if child.returncode != 0 or reader.is_alive():
                raise EffectError('runtime_command_failed')
            return bytes(tail).decode('utf-8', errors='replace')
        except subprocess.TimeoutExpired:
            self.cancel()
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
        config = json.loads(self.command(self.base + ['config', '--format', 'json']))
        if config.get('name') != self.config['projectName'] or not {'db', 'odoo'} <= set(config.get('services', {})):
            raise EffectError('foreign_project')
        ids = self.command(self.base + ['ps', '-q', 'db']).strip().splitlines()
        if len(ids) != 1 or not re.fullmatch(r'[a-f0-9]{12,64}', ids[0]):
            raise EffectError('database_service_unavailable')
        inspect = json.loads(self.command(['docker', 'inspect', ids[0]]))[0]
        labels = inspect.get('Config', {}).get('Labels', {})
        if labels.get('com.docker.compose.project') != self.config['projectName'] or labels.get('com.docker.compose.service') != 'db':
            raise EffectError('foreign_project')
        if self.request['job']['operation'] != 'provision':
            return
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

    def exists(self):
        sql = "SELECT count(*) FROM pg_database WHERE datname='" + self.database + "'"
        result = self.command(self.base + ['exec', '-T', 'db', 'psql', '-U', 'odoo', '-d', 'postgres', '-At', '-c', sql]).strip()
        if result not in ('0', '1'):
            raise EffectError('database_observation_invalid')
        return result == '1'

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
            '-e', 'NASQ_COMMERCIAL_CONFIG=/run/nasq-runtime/classifications/' + self.database + '.json',
            '--entrypoint', '/usr/local/bin/nasq-odoo', 'odoo', 'shell', '-c', '/etc/odoo/odoo.conf',
            '-d', self.database, '--no-http']
        try:
            return self.command(args, stdin=script, timeout=180)
        finally:
            self.current_container = None

    def assert_no_effect_containers(self):
        rows = self.command(['docker', 'ps', '--filter', 'label=com.docker.compose.project=' + self.config['projectName'], '--format', '{{.Names}}']).splitlines()
        if any('-effect-' in name for name in rows):
            raise EffectError('runtime_writer_present')

    def apply_owned(self):
        permit('runtime')
        gate = RuntimeGate(self.root, {'attemptId': self.request['attemptId'], 'fence': self.request['fence'], 'digest': self.request['payloadDigest']})
        gate.acquire()
        self.assert_no_effect_containers()
        self.apply()
        permit('release')
        self.assert_no_effect_containers()
        gate.complete()

    def apply(self):
        self.preflight()
        permit('reserve')
        for name in ('reservations', 'credentials', 'classifications'):
            entry = self.root / name
            if not entry.exists():
                entry.mkdir(mode=0o755 if name == 'classifications' else 0o700)
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
        self.current_container = self.config['projectName'] + '-effect-' + self.request['attemptId'][:8] + '-install'
        try:
            self.command(self.base + ['run', '--rm', '--no-deps', '-T', '--name', self.current_container,
                '-e', 'NASQ_COMMERCIAL_CONFIG=/run/nasq-runtime/classifications/' + self.database + '.json',
                '--entrypoint', '/usr/local/bin/nasq-odoo', 'odoo', '-c', '/etc/odoo/odoo.conf', '-d', self.database,
                '-i', ','.join(self.request['job']['policy']['modules']), '--without-demo=all', '--stop-after-init', '--no-http'], timeout=1500)
        finally:
            self.current_container = None
        policy = self.request['job']['policy']
        parse_snapshot(self.shell(build_policy_script(policy, self.database), 'policy', mutate=True), policy, self.database)
        credentials_script = 'import os\nos.environ["NASQ_ADMIN_PASSWORD"] = ' + repr(secret) + '\n' + build_credentials_script(self.database)
        parse_credentials(self.shell(credentials_script, 'password', mutate=True), self.database)
        output = self.shell(self.admin_script(secret, snapshot=False), 'admin', mutate=True)
        self.parse_admin(output)
        permit('complete')
        reserve(self.root / 'reservations' / (self.database + '.complete'), {'digest': self.request['payloadDigest'], 'attemptId': self.request['attemptId']})
        emit({'result': {'applied': True}})

    def admin_script(self, secret, *, snapshot):
        values = {'database': self.database, 'name': self.request['admin']['name'], 'login': self.request['admin']['login'],
                  'companyName': self.request['companyName'], 'modules': self.request['job']['policy']['modules'],
                  'packageAdmin': self.request['job'].get('packageAuthority') is not None}
        prefix = 'import json\nvalues = json.loads(' + repr(json.dumps(values)) + ')\nsecret = ' + repr(secret) + '\nsnapshot = ' + repr(snapshot) + '\n'
        return prefix + '''
result = {'verified': False}
try:
    if snapshot:
        env.cr.rollback()
        env.cr.execute('SET TRANSACTION READ ONLY')
        env.invalidate_all(flush=False)
    assert env.cr.dbname == values['database'] and env.su and env.uid == 1
    profile = env['nasq.tenant.profile'].search([], limit=2)
    assert len(profile) == 1 and profile.policy_revision == 1
    admin = env.ref('base.user_admin')
    assert admin.id != 1 and admin.active and admin.company_id == profile.root_company_id
    keys = ['system_admin']
    if 'nasq_pmo' in values['modules']:
        keys.append('pmo_manager')
    if 'nasq_hr' in values['modules']:
        keys.append('hr_manager')
    if not snapshot:
        assert admin.login == 'admin'
        admin._nasq_access_write({'login': values['login'], 'name': values['name']}, 'access.users.update')
        profile.root_company_id.write({'name': values['companyName']})
        for key in keys:
            role = env.ref({'pmo_manager': 'nasq_pmo', 'hr_manager': 'nasq_hr'}.get(key, 'nasq_core') + '.role_' + key)
            assignment = env['nasq.access.assignment'].search([('user_id', '=', admin.id), ('role_id', '=', role.id), ('company_id', '=', profile.root_company_id.id)])
            if not assignment:
                env['nasq.access.assignment'].create({'user_id': admin.id, 'role_id': role.id, 'company_id': profile.root_company_id.id})
        if values['packageAdmin']:
            # The stock nasq install seeds admin as vendor support. A package
            # customer administrator is counted against users.limit instead.
            support = env.ref('nasq_core.group_vendor_support')
            admin._nasq_access_write({'group_ids': [(3, support.id, 0)]}, 'access.users.assign_roles')
            # Role creation above may have synced support's wildcard grants.
            # Re-derive permission groups from retained customer assignments;
            # the existing service preserves unrelated explicit groups.
            admin._nasq_sync_capability_groups()
            env.flush_all()
    if values['packageAdmin']:
        service = env['nasq.entitlement.service']
        assert not admin.share and not admin.has_group('nasq_core.group_vendor_support')
        assert admin.id not in service._nasq_excluded_user_ids()
        assert service._nasq_count_users() >= 1
    assert admin.login == values['login'] and admin.name == values['name']
    assert profile.root_company_id.name == values['companyName']
    assigned = env['nasq.access.assignment'].search([('user_id', '=', admin.id), ('company_id', '=', profile.root_company_id.id)]).mapped('role_id.key')
    assert set(keys) <= set(assigned)
    env.cr.execute('SELECT password FROM res_users WHERE id=%s', [admin.id])
    hashed = env.cr.fetchone()[0]
    assert admin._crypt_context().verify(secret, hashed) and not admin._crypt_context().verify('admin', hashed)
    result = {'verified': True, 'uid': admin.id}
    if snapshot:
        env.cr.rollback()
    else:
        env.cr.commit()
except Exception:
    env.cr.rollback()
finally:
    secret = None
print('NASQ_SHARED_ADMIN:' + json.dumps(result))
'''

    def parse_admin(self, output):
        rows = [line[len('NASQ_SHARED_ADMIN:'):] for line in output.splitlines() if line.startswith('NASQ_SHARED_ADMIN:')]
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
        uid = self.parse_admin(self.shell(self.admin_script(credentials['password'], snapshot=True), 'read-admin'))
        # Actual HTTP authentication in the existing shared Odoo server; the
        # internal Host is the database name selected by the routing guard.
        auth = {'jsonrpc': '2.0', 'method': 'call', 'params': {'db': self.database, 'login': credentials['login'], 'password': credentials['password']}, 'id': 1}
        script = 'import json, urllib.request\npayload = ' + repr(json.dumps(auth)) + '\n'
        script += 'req = urllib.request.Request("http://127.0.0.1:8069/web/session/authenticate", data=payload.encode(), headers={"Content-Type":"application/json", "Host":' + repr(self.database) + '})\n'
        script += 'response=json.load(urllib.request.urlopen(req, timeout=30))\nprint(json.dumps({"authenticated":response.get("result",{}).get("uid") == ' + repr(uid) + '}))\n'
        result = json.loads(self.command(self.base + ['exec', '-T', 'odoo', '/opt/venv/bin/python', '-'], stdin=script, timeout=45))
        return verified_observation(self.request, result == {'authenticated': True})


# Non-secret refusal codes that may be reported; everything else is opaque.
REPORTABLE_CODES = frozenset(ERROR_CODES) | {
    'catalog_source_unavailable', 'catalog_source_ambiguous',
} | set(POLICY_ERROR_CODES)


def classify_error(error):
    code = getattr(error, 'code', None)
    if isinstance(error, (VerificationError, CatalogSourceError)) and code in REPORTABLE_CODES:
        return code
    # Policy/catalog validation refusals carry stable safe codes only.
    if isinstance(error, PolicyError) and error.code in POLICY_ERROR_CODES:
        return error.code
    return 'shared_effect_unverified'


def main():
    runner = None
    try:
        raw = sys.stdin.readline(MAX_OUTPUT + 1)
        if len(raw) > MAX_OUTPUT:
            raise EffectError('input_invalid')
        request = json.loads(raw)
        runner = Runner(request)
        def terminate(_signum, _frame):
            runner.cancel()
            raise EffectError('authority_lost')
        signal.signal(signal.SIGTERM, terminate)
        signal.signal(signal.SIGINT, terminate)
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
