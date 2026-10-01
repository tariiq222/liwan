# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Explicit local acceptance resources; never selects an existing Nasq stack.

prepare prints only the new project identity. compose forwards arguments to that
exact project. No destructive teardown command is provided; use compose stop to
retain its databases and evidence. Credentials stay in ignored private files.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
POINTER = HERE / '.state' / 'current.json'
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def network_subnets(project: str) -> dict[str, str]:
    ids = subprocess.check_output(['docker', 'network', 'ls', '-q'], text=True).split()
    networks = json.loads(subprocess.check_output(['docker', 'network', 'inspect', *ids], text=True))
    occupied = [ipaddress.ip_network(c['Subnet']) for n in networks
                for c in (n['IPAM']['Config'] or []) if c.get('Subnet')]
    result = {}
    for name in ('edge', 'guard_web', 'guard_odoo', 'database', 'vendor', 'vendor_database', 'control', 'restore_edge', 'restore_database', 'restore_guard_web', 'restore_guard_odoo'):
        existing = next((n for n in networks if n['Name'] == f'{project}_{name}'), None)
        if existing:
            result['NET_' + name.upper()] = existing['IPAM']['Config'][0]['Subnet']
            continue
        selected = next((ipaddress.ip_network(f'10.240.{i}.0/24') for i in range(32, 240)
                         if not any(ipaddress.ip_network(f'10.240.{i}.0/24').overlaps(other)
                                    for other in occupied if other.version == 4)), None)
        if selected is None:
            raise ValueError('no free acceptance subnet')
        result['NET_' + name.upper()] = str(selected)
        occupied.append(selected)
    return result


def prepare_networks(project: str) -> None:
    for key, subnet in network_subnets(project).items():
        short = key[4:].lower()
        name = project + '_' + short
        current = subprocess.run(['docker', 'network', 'inspect', name], capture_output=True, text=True)
        if current.returncode == 0:
            observed = json.loads(current.stdout)[0]
            if observed.get('Labels', {}).get('com.docker.compose.project') != project:
                raise ValueError('network belongs to another project')
            continue
        command = ['docker', 'network', 'create', '--subnet', subnet,
                   '--label', 'com.docker.compose.project=' + project]
        if short in ('database', 'guard_web', 'guard_odoo', 'vendor_database', 'restore_database', 'restore_guard_web', 'restore_guard_odoo'):
            command.append('--internal')
        subprocess.run([*command, name], check=True, stdout=subprocess.DEVNULL)


def write_private(path: Path, content: str, mode: int = 0o600) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def read_state() -> dict:
    state = json.loads(POINTER.read_text())
    directory = Path(state['stateDir'])
    if directory.parent != HERE / '.state' or not state['projectName'].startswith('nasq-saas-life-'):
        raise ValueError('invalid lifecycle state')
    return state


def compose(state: dict, args: list[str], **kwargs):
    if any(arg in {'down', 'rm'} for arg in args):
        raise ValueError('This harness retains resources; use stop. Removal needs separate authorization.')
    return subprocess.run(['docker', 'compose', '--project-name', state['projectName'],
                           '--env-file', state['envFile'], '-f', state['composeFile'], *args],
                          cwd=ROOT, check=True, **kwargs)


def prepare() -> None:
    if POINTER.exists():
        raise ValueError('state exists; inspect or resume it, never overwrite it')
    for port in (80, 443, 55447):
        with socket.socket() as probe:
            # The Docker daemon publishes privileged ports; this unprivileged
            # host process only checks for an existing listener.
            probe.settimeout(1)
            if probe.connect_ex(('127.0.0.1', port)) == 0:
                raise ValueError(f'acceptance port {port} unavailable')
    project = f'nasq-saas-life-{int(time.time())}'
    directory = HERE / '.state' / project
    directory.mkdir(parents=True, mode=0o755)
    for name in ('registry', 'classifications', 'operator'):
        (directory / name).mkdir(mode=0o755)
    (directory / 'credentials').mkdir(mode=0o700)
    state = {'schemaVersion': 1, 'projectName': project,
             'composeFile': str(HERE / 'compose.yml'), 'envFile': str(directory / 'compose.env'),
             'stateDir': str(directory), 'domainSuffix': 'saas.accept.nasq.test'}
    values = {
        'NASQ_PROJECT': project,
        'NASQ_REPO_ROOT': str(ROOT), 'NASQ_LIFECYCLE_STATE': str(directory),
        'DB_PASSWORD': secrets.token_hex(24), 'VENDOR_DB_PASSWORD': secrets.token_hex(24),
        'CONTROL_DB_PASSWORD': secrets.token_hex(24), 'CONTROL_SERVICE_KEY': secrets.token_hex(32),
        'PROXY_TOKEN': secrets.token_hex(32),
        'SESSION_KEYS': json.dumps({'k1': secrets.token_hex(32)}, separators=(',', ':')),
        'ODOO_IMAGE': os.environ.get('NASQ_LIFECYCLE_ODOO_IMAGE', 'sha256:cdc9894289ed7aed9ab3380fc37233e73bc85ab38942f87bc17e8d7d513ce790'),
        'GUARD_IMAGE': os.environ.get('NASQ_LIFECYCLE_GUARD_IMAGE', 'nasq-guard:9fc26f3-r3'),
        'CADDY_IMAGE': os.environ.get('NASQ_LIFECYCLE_CADDY_IMAGE', 'nasq-accept-caddy:9fc26f3-r3'),
        'SHARED_WEB_IMAGE': 'nasq-web:saas-life-shared',
        'VENDOR_WEB_IMAGE': 'nasq-web:saas-life-vendor',
        'CONTROL_IMAGE': 'nasq-control:saas-life',
    }
    values.update(network_subnets(project))
    write_private(directory / 'compose.env', '\n'.join(f"{key}='{value}'" for key, value in values.items()) + '\n')
    write_private(directory / 'runtime.json', json.dumps(state, indent=2))
    write_private(directory / 'registry' / 'registry.json', json.dumps({'schemaVersion': 1, 'snapshotRevision': 0, 'targets': []}), 0o644)
    write_private(directory / 'inventory.json', json.dumps({'schema_version': 2, 'targets': {}}))
    for prefix, database_host, password_key in [('', 'db', 'DB_PASSWORD'), ('vendor-', 'vendor-db', 'VENDOR_DB_PASSWORD')]:
        shared = prefix == ''
        config = ('[options]\n'
                  f'db_host = {database_host}\ndb_user = odoo\ndb_password = {values[password_key]}\n'
                  f'admin_passwd = {secrets.token_hex(32)}\n'
                  f'dbfilter = {"^%h$" if shared else "^nasq_vendor_scratch$"}\n'
                  'list_db = False\nproxy_mode = False\ndata_dir = /var/lib/odoo\nworkers = 2\n'
                  'max_cron_threads = 0\n')
        if not shared:
            config += 'db_name = nasq_vendor_scratch\n'
        write_private(directory / f'{prefix}odoo.conf', config, 0o440)
    write_private(directory / 'vendor-admin.json', json.dumps({
        'login': 'operator@vendor.saas.accept.nasq.test', 'password': secrets.token_urlsafe(32),
    }))
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '7',
                    '-subj', '/CN=control-api', '-addext', 'subjectAltName=DNS:control-api',
                    '-keyout', str(directory / 'control-key.pem'),
                    '-out', str(directory / 'control-cert.pem')],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    (directory / 'control-key.pem').chmod(0o600)
    (directory / 'control-cert.pem').chmod(0o644)
    subprocess.run(['python3', str(ROOT / 'deploy/classification.py'), 'fixture',
                    '--database', 'nasq_vendor_scratch', '--mode', 'non_saas',
                    '--output', str(directory / 'classifications/vendor.json')], check=True)
    write_private(POINTER, json.dumps(state, indent=2))
    from tools.shared_saas_lifecycle.prepare_restore import prepare_restore
    prepare_restore(state)
    print(f'Prepared isolated project {project}')


def bootstrap_vendor(state: dict) -> None:
    # Only the vendor company identity is seeded here. Customer provisioning is
    # exclusively driven by the application worker during the browser journey.
    directory = Path(state['stateDir'])
    compose(state, ['exec', '-T', 'vendor-db', 'createdb', '-U', 'odoo', 'nasq_vendor_scratch'])
    base = ['run', '--rm', '--no-deps', '-T', '-e',
            'NASQ_COMMERCIAL_CONFIG=/run/nasq-runtime/classifications/vendor.json',
            '--entrypoint', '/usr/local/bin/nasq-odoo', 'vendor-odoo']
    compose(state, [*base, 'server', '-d', 'nasq_vendor_scratch',
                    '-i', 'nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr',
                    '--stop-after-init', '--no-http'])
    script = (ROOT / 'deploy/control-plane-outage/bootstrap.py').read_text()
    credential = json.loads((directory / 'vendor-admin.json').read_text())
    child_env = dict(os.environ, NASQ_FIXTURE_ADMIN_LOGIN=credential['login'],
                     NASQ_FIXTURE_ADMIN_PASSWORD=credential['password'],
                     NASQ_FIXTURE_MARKER='SAAS-LIFECYCLE-VENDOR')
    seed = ['run', '--rm', '--no-deps', '-T', '-e', 'NASQ_FIXTURE_ADMIN_LOGIN',
            '-e', 'NASQ_FIXTURE_ADMIN_PASSWORD', '-e', 'NASQ_FIXTURE_MARKER',
            '-e', 'NASQ_COMMERCIAL_CONFIG=/run/nasq-runtime/classifications/vendor.json',
            '--entrypoint', '/usr/local/bin/nasq-odoo', 'vendor-odoo',
            'shell', '-d', 'nasq_vendor_scratch', '--no-http']
    compose(state, seed, input=script, text=True, env=child_env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'compose', 'bootstrap-vendor', 'bootstrap-catalog', 'prepare-restore', 'state'])
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare()
        return
    state = read_state()
    if args.action == 'prepare-restore':
        from tools.shared_saas_lifecycle.prepare_restore import prepare_restore
        prepare_restore(state)
    elif args.action == 'compose':
        compose(state, args.arguments)
    elif args.action == 'bootstrap-vendor':
        bootstrap_vendor(state)
    elif args.action == 'bootstrap-catalog':
        result = compose(state, ['exec', '-T', 'vendor-db', 'psql', '-U', 'odoo', '-d', 'nasq_vendor_scratch', '-At', '-c', "SELECT id FROM res_users WHERE login='operator@vendor.saas.accept.nasq.test'"], capture_output=True, text=True)
        uid = result.stdout.strip()
        if not uid.isdigit() or int(uid) <= 1:
            raise ValueError('vendor fixture administrator not found')
        compose(state, ['exec', '-T', 'control-api', 'node', '--import', 'tsx', 'tools/shared_saas_lifecycle/bootstrap_catalog.mjs', uid])
    else:
        print(json.dumps(state, indent=2))


if __name__ == '__main__':
    main()
