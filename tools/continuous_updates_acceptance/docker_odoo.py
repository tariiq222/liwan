"""Preserved local Docker HTTP/cron proof on one explicitly authorized restore.

This builds an acceptance source overlay on the cached, commit-labelled image;
it does not certify the complete product Dockerfile. No resources are removed.
Run with the coordinator's Python environment and source root on PYTHONPATH.
"""
from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import time
from urllib.request import HTTPCookieProcessor, Request, build_opener

from deploy.releases.backup import restore_tenant, validate_backup
from deploy.releases.migrate import source_tree_digest
from deploy.releases.postgres import fence_runtime, identifier, runtime_role_fixture, validate_runtime_role
from deploy.releases.runtime_identity import RuntimeIdentityError, inspect_odoo_runtime
from deploy.releases.state import ReleaseState, atomic_json

DATABASE = 'webvue_scratch_updates_docker_t03_1016'
OWNER = 'webvue_updates_docker_owner_1016'
BLUE = 'webvue_updates_docker_blue_1016'
GREEN = 'webvue_updates_docker_green_1016'
STOCK = '34eed49d88f0f4357e1f54fe82cb0ad280939572'
BASE = 'webvue-odoo:67902a0'
TAG = 'webvue-updates-odoo-review:current-source-1016'
NAMES = {'blue': 'webvue-updates-odoo-review-blue-1016',
    'green': 'webvue-updates-odoo-review-green-1016', 'cron': 'webvue-updates-odoo-review-cron-1016'}


def run(argv, *, timeout=30, **kwargs):
    return subprocess.run(argv, check=True, capture_output=True, timeout=timeout, **kwargs)


def docker_json(argv):
    return json.loads(run(['docker', *argv]).stdout)


def connect(database, role='tariq'):
    import psycopg2
    return psycopg2.connect(host='127.0.0.1', port=5432, user=role, dbname=database, connect_timeout=5)


def sql(connection, statement, parameters=()):
    with connection.cursor() as cursor:
        cursor.execute(statement, parameters)
        return cursor.fetchall() if cursor.description else []


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(root, report):
    atomic_json(root / 'report.json', report)


def build(source, root, report):
    base = docker_json(['image', 'inspect', BASE])[0]
    if base['Config']['Labels'].get('sa.webvue.odoo-commit') != STOCK:
        raise ValueError('cached_stock_commit_mismatch')
    digests = base.get('RepoDigests', [])
    if not digests: raise ValueError('cached_base_digest_required')
    base_digest = digests[0]
    context = root / 'build-context'
    context.mkdir()
    shutil.copytree(source / 'odoo-addons', context / 'odoo-addons',
        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    paths = ['deploy/security/odoo_secure.py', 'deploy/shared/launch_odoo.py',
        'deploy/shared/validate_odoo_config.py', 'deploy/odoo/entrypoint.sh',
        'tools/oca_addons.py', 'deploy/oca-addons.json']
    for name in paths:
        destination = context / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, destination)
    facts = {'baseImageId': base['Id'], 'stockCommitLabel': STOCK,
        'baseImageDigest': base_digest, 'addonTreeDigest': source_tree_digest(context),
        'files': {name: sha(context / name) for name in paths}}
    if (facts['addonTreeDigest'] != source_tree_digest(source)
            or any(facts['files'][name] != sha(source / name) for name in paths)):
        raise ValueError('source_changed_during_copy')
    artifact = hashlib.sha256(json.dumps(facts, sort_keys=True).encode()).hexdigest()
    (context / 'Dockerfile').write_text(
        'FROM ' + BASE + '\nUSER root\n'
        'COPY odoo-addons /opt/webvue/addons\n'
        'COPY deploy/security/odoo_secure.py /opt/webvue/odoo_secure.py\n'
        'COPY deploy/shared/launch_odoo.py deploy/shared/validate_odoo_config.py /opt/webvue/shared/\n'
        'COPY deploy/odoo/entrypoint.sh /usr/local/bin/webvue-odoo\n'
        'COPY tools/oca_addons.py /opt/webvue/tools/oca_addons.py\n'
        'COPY deploy/oca-addons.json /opt/webvue/deploy/oca-addons.json\n'
        'RUN chmod 0755 /usr/local/bin/webvue-odoo && chmod -R a-w /opt/webvue\n'
        'LABEL webvue.acceptance.kind="cached-base-current-source-overlay" '
        'webvue.acceptance.source-sha256="' + artifact + '"\nUSER 501:501\n')
    result = subprocess.run(['docker', 'build', '--pull=false', '--network=none', '-t', TAG, str(context)],
        stdout=(root / 'build.log').open('wb'), stderr=subprocess.STDOUT, timeout=180)
    if result.returncode: raise ValueError('acceptance_overlay_build_failed')
    if docker_json(['image', 'inspect', BASE])[0]['Id'] != base['Id']:
        raise ValueError('cached_base_changed_during_build')
    image = docker_json(['image', 'inspect', TAG])[0]
    base_layers = base.get('RootFS', {}).get('Layers', [])
    built_layers = image.get('RootFS', {}).get('Layers', [])
    if (not base_layers or built_layers[:len(base_layers)] != base_layers
            or image['Config']['Labels'].get('sa.webvue.odoo-commit') != STOCK):
        raise ValueError('built_image_base_mismatch')
    report['artifact'] = {**facts, 'sourceArtifactDigest': artifact, 'imageId': image['Id'],
        'repoDigests': image.get('RepoDigests', []), 'baseLayerPrefixVerified': True, 'scope': 'cached-base-current-source-overlay',
        'fullProductDockerfile': False}
    return image


def setup_database(source, root, report):
    fixture = source / '.superpowers/continuous-updates/tenants-scratch'
    backup = fixture / 'release-scratch/backups/tenant_03/1'
    if not (fixture / 'release-scratch/routes/tenant_03.maintenance').is_file():
        raise ValueError('original_maintenance_required')
    admin = connect('postgres'); admin.autocommit = True
    try:
        if sql(admin, 'SELECT datname FROM pg_database WHERE datname=%s', (DATABASE,)):
            raise ValueError('restore_database_must_be_absent')
        if sql(admin, 'SELECT rolname FROM pg_roles WHERE rolname IN (%s,%s,%s)', (OWNER, BLUE, GREEN)):
            raise ValueError('acceptance_roles_must_be_absent')
    finally:
        admin.close()
    evidence = validate_backup(backup)
    if not evidence['valid']: raise ValueError('source_backup_invalid')
    receipt = evidence['receipt']
    data = root / 'data'
    store = data / 'filestore' / DATABASE
    restored = restore_tenant(backup, {'tenantId': 'tenant_03', 'database': DATABASE, 'filestore': DATABASE},
        {'mode': 'local', 'restoreAllowed': True, 'writesResumed': False,
         'recoverySource': {key: receipt[key] for key in ('tenantId', 'database', 'filestore', 'fence')},
         'targetFilestore': str(store), 'createdb': '/opt/homebrew/bin/createdb',
         'pgRestore': '/opt/homebrew/bin/pg_restore',
         'pgEnv': {'PGHOST': '127.0.0.1', 'PGPORT': '5432', 'PGUSER': 'tariq'}, 'timeoutSeconds': 120})
    (data / 'sessions').mkdir(mode=0o700)
    passwords = {role: secrets.token_urlsafe(32) for role in (BLUE, GREEN)}
    with connect(DATABASE) as connection:
        sql(connection, 'CREATE ROLE ' + identifier(OWNER) +
            ' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
        for statement in runtime_role_fixture(DATABASE, OWNER, [BLUE, GREEN]): sql(connection, statement)
        from psycopg2 import sql as pgsql
        for role, password in passwords.items():
            sql(connection, pgsql.SQL('ALTER ROLE {} PASSWORD {}').format(pgsql.Identifier(role), pgsql.Literal(password)))
        report['runtimeRoles'] = {role: validate_runtime_role(connection, role, DATABASE) for role in passwords}
        if not all(item['valid'] for item in report['runtimeRoles'].values()):
            raise ValueError('runtime_roles_invalid')
    report['restore'] = restored
    return data, passwords, fixture


def configuration(root, role, password, *, cron=False):
    path = root / ('cron.conf' if cron else role + '.conf')
    path.write_text('[options]\ndb_host=host.docker.internal\ndb_port=5432\ndb_user=' + role +
        '\ndb_password=' + password + '\nadmin_passwd=' + secrets.token_urlsafe(32) +
        '\ndbfilter=^%h$\nlist_db=False\nproxy_mode=False\ndata_dir=/var/lib/odoo\nworkers=2\n'
        'http_interface=0.0.0.0\nhttp_port=8069\nlog_level=info\n'
        + 'db_app_name=webvue-docker-review-' + ('cron' if cron else 'http') + '-{pid}\n'
        + ('db_name=' + DATABASE + '\nmax_cron_threads=1\n' if cron else 'max_cron_threads=0\n'))
    path.chmod(0o400)
    return path


def create(root, image, data, config, pool, role, *, cron=False, port=None):
    name = NAMES['cron' if cron else ('blue' if pool == 'dockblue' else 'green')]
    # Entrypoint must be an exact array, not a single Python command plus Cmd script.
    # Docker CLI cannot supply a multi-element entrypoint; use create then the API
    # via an inspectable Compose document instead (created below).
    service = {'image': image['Id'], 'container_name': name, 'user': '501:501',
        'entrypoint': ['/opt/venv/bin/python', '/opt/webvue/shared/launch_odoo.py'],
        'command': ['--no-http', '--max-cron-threads=1', '--database=' + DATABASE] if cron else ['--max-cron-threads=0'],
        'environment': {'WEBVUE_TENANCY_MODE': 'shared', 'WEBVUE_RELEASE_POOL_ID': pool,
            'WEBVUE_RELEASE_DB_USER': role, 'WEBVUE_RELEASE_ROLE': 'cron' if cron else 'http'},
        'labels': {'webvue.pool': pool, 'webvue.release': 'dockerreview',
            'webvue.db-config-sha256': sha(config), 'webvue.runtime': 'cron' if cron else 'http'},
        'volumes': [{'type': 'bind', 'source': str(config), 'target': '/etc/odoo/odoo.conf', 'read_only': True},
            {'type': 'bind', 'source': str(data), 'target': '/var/lib/odoo'}]}
    if cron:
        service['environment']['WEBVUE_RELEASE_DATABASES'] = DATABASE
        service['labels']['webvue.database'] = DATABASE
    if port: service['ports'] = ['127.0.0.1:' + str(port) + ':8069']
    compose = root / (name + '.compose.json')
    compose.write_text(json.dumps({'services': {'odoo': service}}, indent=2))
    run(['docker', 'compose', '-p', name, '-f', str(compose), 'create', '--no-build'], timeout=30)
    return name


def identity(name, image, config, pool, role, *, cron=False, stopped=False):
    digests = image.get('RepoDigests', [])
    expected = {'poolId': pool, 'releaseId': 'dockerreview', 'image': digests[0] if digests else
        'local/acceptance-unpublished@sha256:' + image['Id'].removeprefix('sha256:'),
        'dbUser': role, 'dbHost': 'host.docker.internal', 'configPath': str(config),
        'configDigest': sha(config), 'tenancyMode': 'shared'}
    try:
        proof = inspect_odoo_runtime(name, expected, cron_databases=[DATABASE] if cron else None, allow_stopped=stopped)
    except RuntimeIdentityError:
        if digests: raise
        return {'accepted': False, 'reason': 'local_artifact_has_no_registry_digest', 'defaultInspectorRefused': True}
    return {'accepted': True, 'proof': proof}


def request(opener, port, path, *, body=None):
    headers = {'Host': DATABASE}
    if body is not None: headers['Content-Type'] = 'application/json'
    with opener.open(Request('http://127.0.0.1:' + str(port) + path,
            data=json.dumps(body).encode() if body is not None else None, headers=headers), timeout=8) as response:
        return response.status, response.read()


def wait_http(opener, port):
    deadline = time.monotonic() + 90
    attempts = 0
    while True:
        attempts += 1
        try:
            status, _ = request(opener, port, '/web/login')
            if status == 200: return attempts
        except Exception:
            if time.monotonic() >= deadline: raise ValueError('http_readiness_timeout') from None
        time.sleep(1)


def observe_cron(root, report):
    """Read only: prove one live worker and its tenant DB connection, not master startup."""
    deadline = time.monotonic() + 90
    observed = set()
    while True:
        logs = run(['docker', 'logs', NAMES['cron']])
        text = (logs.stdout + logs.stderr).decode()
        workers = set(re.findall(r'Worker WorkerCron \((\d+)\) alive', text))
        with connect(DATABASE) as connection:
            rows = sql(connection, 'SELECT datname,application_name,state FROM pg_stat_activity '
                'WHERE usename=%s', (GREEN,))
        observed.update(tuple(row) for row in rows)
        expected = {'webvue-docker-review-cron-' + pid for pid in workers}
        worker_connection = any(db == DATABASE and app in expected for db, app, _ in observed)
        if len(workers) == 1 and worker_connection: break
        if time.monotonic() >= deadline: raise ValueError('actual_cron_worker_not_observed')
        time.sleep(0.5)
    top = run(['docker', 'top', NAMES['cron'], '-eo', 'pid,args']).stdout.decode()
    (root / 'cron-processes.log').write_text(top)
    (root / 'cron-container.log').write_text(text)
    report['cronWorkerIds'] = sorted(workers)
    report['singletonCronWorkerObserved'] = len(top.strip().splitlines()) == 3 and len(workers) == 1
    report['cronWorkerTenantConnectionObserved'] = worker_connection
    report['cronOnlyExpectedDatabaseAndStockNotificationListener'] = all(
        db in (DATABASE, 'postgres') for db, app, _ in observed if app.startswith('webvue-docker-review-cron-'))
    report['workerConnectionEvidence'] = sorted(observed)
    report['httpHasNoCronWorkers'] = all(b'Worker WorkerCron' not in (
        (result := run(['docker', 'logs', NAMES[key]])).stdout + result.stderr) for key in ('blue', 'green'))
    if not all(report[key] for key in ('singletonCronWorkerObserved', 'cronWorkerTenantConnectionObserved',
            'cronOnlyExpectedDatabaseAndStockNotificationListener', 'httpHasNoCronWorkers')):
        raise ValueError('cron_worker_scope_incomplete')


def acceptance(source, root):
    if root.exists() or root.resolve() != root or not root.name.startswith('docker-odoo-review-'):
        raise ValueError('new_canonical_acceptance_output_required')
    if os.getuid() != 501: raise ValueError('acceptance_requires_uid_501')
    root.mkdir(parents=True, mode=0o700)
    report = {'scope': 'local-docker-cached-base-current-source-overlay', 'database': DATABASE,
        'containers': NAMES, 'stage': 'build', 'passed': False, 'resourcesPreserved': True,
        'fullProductDockerfile': False, 'externalRegistryPublish': False}
    try:
        image = build(source, root, report)
        report['stage'] = 'restore'
        save(root, report)
        data, passwords, fixture = setup_database(source, root, report)
        configs = {'blue': configuration(root, BLUE, passwords[BLUE]),
            'green': configuration(root, GREEN, passwords[GREEN]),
            'cron': configuration(root, GREEN, passwords[GREEN], cron=True)}
        for key, pool, role, port in [('blue', 'dockblue', BLUE, 18269), ('green', 'dockgreen', GREEN, 18272)]:
            create(root, image, data, configs[key], pool, role, port=port)
        create(root, image, data, configs['cron'], 'dockgreen', GREEN, cron=True)
        report['cronInitiallyStopped'] = docker_json(['inspect', NAMES['cron']])[0]['State']['Running'] is False
        report['cronCandidateIdentity'] = identity(NAMES['cron'], image, configs['cron'], 'dockgreen', GREEN, cron=True, stopped=True)
        report['stage'] = 'http'
        save(root, report)
        jar = http.cookiejar.CookieJar()
        opener = build_opener(HTTPCookieProcessor(jar))
        for key, port in [('blue', 18269), ('green', 18272)]:
            run(['docker', 'start', NAMES[key]])
            report[key + 'HttpReadinessAttempts'] = wait_http(opener, port)
            report[key + 'Identity'] = identity(NAMES[key], image, configs[key], 'dock' + key, BLUE if key == 'blue' else GREEN)
        password = (fixture / 'admin-password').read_text().strip()
        _, body = request(opener, 18269, '/web/session/authenticate', body={'jsonrpc': '2.0', 'method': 'call',
            'params': {'db': DATABASE, 'login': 'admin', 'password': password}, 'id': 1})
        authenticated = json.loads(body).get('result', {})
        if not isinstance(authenticated.get('uid'), int) or authenticated['uid'] < 1:
            raise ValueError('restored_runtime_authentication_failed')
        for key, port in [('blue', 18269), ('green', 18272)]:
            _, body = request(opener, port, '/api/v1/me')
            if json.loads(body).get('id') != authenticated['uid']:
                raise ValueError('shared_session_unreadable')
        session = next(cookie.value for cookie in jar if cookie.name == 'session_id')
        session_path = root / 'session'
        session_path.write_text(session); session_path.chmod(0o600)
        report['sameSessionAcrossRoles'] = True
        probe = json.loads((fixture / 'final-runtime.json').read_text())['tenants']['tenant_03']['attachmentProbe']
        _, body = request(opener, 18272, probe['httpPath'])
        report['attachmentReadableOverHttpAndDisk'] = (hashlib.sha256(body).hexdigest() == probe['sha256'] ==
            sha(data / 'filestore' / DATABASE / probe['relativePath']))
        if not report['attachmentReadableOverHttpAndDisk']: raise ValueError('restored_attachment_mismatch')
        # The guarded shared launcher must reject CLI database-role overrides before Odoo imports/connects.
        rejected = subprocess.run(['docker', 'run', '--rm', '--user', '501:501', '--entrypoint', '/opt/venv/bin/python',
            '-e', 'WEBVUE_TENANCY_MODE=shared', '-e', 'WEBVUE_RELEASE_POOL_ID=dockgreen',
            '-e', 'WEBVUE_RELEASE_ROLE=http', '-e', 'WEBVUE_RELEASE_DB_USER=' + GREEN,
            '--mount', 'type=bind,src=' + str(configs['green']) + ',dst=/etc/odoo/odoo.conf,readonly',
            image['Id'], '/opt/webvue/shared/launch_odoo.py', '--db_user=tariq'], capture_output=True, timeout=20)
        report['unsafeRoleOverrideRefused'] = rejected.returncode == 1 and b'shared_config_rejected' in rejected.stderr
        if not report['unsafeRoleOverrideRefused']: raise ValueError('guarded_argument_override_accepted')
        state = ReleaseState(root / 'release-scratch')
        binding = {'tenantId': 'docker_t03', 'database': DATABASE, 'filestore': DATABASE, 'registryRevision': 1}
        old = {'schemaVersion': 1, 'tenantId': binding['tenantId'], 'identityRevision': 1, 'routeRevision': 1,
            'releaseId': 'dockerreview', 'poolId': 'dockblue', 'fence': 1, 'state': 'serving'}
        state.register(binding, old)
        state.maintenance(binding['tenantId'], 1)
        if list((state.routes / 'leases').glob('**/*.json')): raise ValueError('acceptance_writers_remain')
        report['stage'] = 'role_fence'
        save(root, report)
        proof = fence_runtime({**binding, 'fence': 1, 'gateClosed': True, 'admittedWriters': 0},
            BLUE, GREEN, connect, deadline_seconds=5)
        if not proof['fenced'] and proof.get('reason') == 'old_connections_remain':
            time.sleep(0.15)
            proof = fence_runtime({**binding, 'fence': 1, 'gateClosed': True, 'admittedWriters': 0},
                BLUE, GREEN, connect, deadline_seconds=5)
        report['fenceEvidence'] = proof
        if not proof['fenced']: raise ValueError('actual_database_fence_refused')
        try:
            unexpected = connect(DATABASE, BLUE); unexpected.close()
        except Exception:
            report['oldRoleReconnectRefused'] = True
        if not report.get('oldRoleReconnectRefused'): raise ValueError('old_role_connect_survived')
        report['stage'] = 'cron_start'
        save(root, report)
        run(['docker', 'start', NAMES['cron']])
        report['cronRunningIdentity'] = identity(NAMES['cron'], image, configs['cron'], 'dockgreen', GREEN, cron=True)
        # Infrastructure-only observation: actual Odoo cron connections, never Odoo-table SQL.
        deadline = time.monotonic() + 90
        samples = []
        while time.monotonic() < deadline:
            with connect(DATABASE) as connection:
                rows = sql(connection, 'SELECT usename,application_name,state FROM pg_stat_activity '
                    'WHERE datname=%s AND usename=%s', (DATABASE, GREEN))
            samples.append(rows)
            if any('cron' in row[1].lower() for row in rows): break
            time.sleep(0.5)
        report['cronConnectionObserved'] = any('cron' in row[1].lower() for rows in samples for row in rows)
        report['connectionApplicationNames'] = sorted({row[1] for rows in samples for row in rows})
        top = run(['docker', 'top', NAMES['cron'], '-eo', 'pid,args']).stdout.decode()
        (root / 'cron-processes.log').write_text(top)
        report['singletonCronArgv'] = '--max-cron-threads=1' in top and '--database=' + DATABASE in top
        report['httpCronDisabledArgv'] = all('--max-cron-threads=0' in
            run(['docker', 'top', NAMES[key], '-eo', 'pid,args']).stdout.decode() for key in ('blue', 'green'))
        _, body = request(opener, 18272, '/api/v1/me')
        report['sessionReadableAfterFenceAndCronStart'] = json.loads(body).get('id') == authenticated['uid']
        observe_cron(root, report)
        report['passed'] = all(report.get(key) is True for key in ('cronInitiallyStopped', 'sameSessionAcrossRoles',
            'attachmentReadableOverHttpAndDisk', 'unsafeRoleOverrideRefused', 'oldRoleReconnectRefused',
            'cronConnectionObserved', 'singletonCronArgv', 'httpCronDisabledArgv', 'sessionReadableAfterFenceAndCronStart'))
        report['stage'] = 'complete' if report['passed'] else 'observation_incomplete'
        if not report['passed']: raise ValueError('docker_acceptance_checks_incomplete')
        return report
    except Exception as error:
        report['errorType'] = type(error).__name__
        raise RuntimeError('docker_odoo_acceptance_failed_at_' + report['stage']) from None
    finally:
        for key, name in NAMES.items():
            result = subprocess.run(['docker', 'logs', '--tail', '150', name], capture_output=True, timeout=10)
            (root / (key + '-container.log')).write_bytes(result.stdout + result.stderr)
        save(root, report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--observe-existing', action='store_true', help='Only recheck preserved cron worker evidence; never recreate resources')
    args = parser.parse_args()
    if args.observe_existing:
        report = json.loads((args.output / 'report.json').read_text())
        if report.get('database') != DATABASE or report.get('stage') != 'complete':
            raise ValueError('completed_acceptance_report_required')
        observe_cron(args.output, report)
        save(args.output, report)
        print(json.dumps({'singletonCronWorkerObserved': report['singletonCronWorkerObserved'],
            'cronWorkerTenantConnectionObserved': report['cronWorkerTenantConnectionObserved']}))
        return
    report = acceptance(args.source_root.resolve(), args.output)
    print(json.dumps({'passed': report['passed'], 'scope': report['scope'], 'report': str(args.output / 'report.json')}))


if __name__ == '__main__': main()
