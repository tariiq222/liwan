# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Explicit local-only acceptance entrypoint; never removes or reuses resources."""
import hashlib
import json
import os
import secrets
import socket
import sys
import tempfile
import uuid
from pathlib import Path

from webvue_cli.managed_bundle import render_bundle
from webvue_cli.managed_process import local_docker_runner
from webvue_cli.managed_runtime import CATALOG_PATH, descriptor_digest, managed_adapter


def verify_replay(fields, created):
    """Use durable real state but prohibit every new effect/observation."""
    def forbidden(*_args, **_kwargs):
        message = 'receipt verification attempted an external operation'
        raise AssertionError(message)

    kwargs = {'runner': forbidden, 'probe': forbidden, 'resolver': forbidden}
    code, replay = managed_adapter(fields, **kwargs)
    assert code == 0 and replay['operation_id'] == created['operation_id']
    assert replay['profile'] == created['profile']
    status_fields = {'operation': 'status', 'target': fields['target'],
                     'request_id': fields['request_id'], 'policy_bytes_file': fields['policy_file']}
    code, durable = managed_adapter(status_fields, **kwargs)
    assert code == 0 and durable['policy_verified'] is True and durable['deployment_ready'] is True
    assert durable['profile'] == created['profile']
    alternate = Path(fields['policy_file']).with_name('policy-alternate.json')
    alternate.write_bytes(Path(fields['policy_file']).read_bytes() + b'\n')
    code, conflict = managed_adapter(dict(fields, policy_file=str(alternate)), **kwargs)
    assert code == 4 and conflict['error']['code'] == 'request_conflict'
    code, repeated = managed_adapter(dict(fields, request_id=str(uuid.uuid4())), **kwargs)
    assert code == 4 and repeated['error']['code'] == 'lifecycle_conflict'
    return {'replay_without_effects': True, 'durable_status_verified': True,
            'changed_bytes_refused': True, 'second_create_refused': True}


def main():
    os.umask(0o077)
    root = Path(tempfile.mkdtemp(prefix='webvue-managed-acceptance-')).resolve()
    suffix = secrets.token_hex(4)
    target = 'tgt_local_' + suffix
    project = 'webvue-accept-' + suffix
    sockets = []
    ports = {}
    for key in ('db', 'odoo', 'web'):
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0))
        sockets.append(sock)
        ports[key] = sock.getsockname()[1]
    runner = local_docker_runner()
    images = {}
    for key, tag in {'odoo': 'webvue-acceptance-odoo:d780862e',
                     'web': 'webvue-acceptance-web:d780862e',
                     'proxy': 'caddy:2.11.4', 'db': 'postgres:16'}.items():
        code, output, _ = runner(['docker', 'image', 'inspect', tag])
        if code:
            sys.exit('local image unavailable')
        images[key] = json.loads(output)[0]['Id']
    catalog = json.loads(CATALOG_PATH.read_bytes())
    descriptor = {
        'adapter': {'kind': 'compose-local', 'version': 1},
        'environment_id': 'local-acceptance', 'commercial_mode': 'saas',
        'resource_refs': {'project': project, 'compose_file': str(root / 'compose.json'),
                          'db_name': 'webvue_scratch_' + suffix,
                          'data_dir': str(root / 'data'), 'backup_root': str(root / 'backups'),
                          'ports': ports},
        'secret_refs': {key: str(root / (key + '.secret')) for key in ('db_password', 'admin_password')},
        'release_ref': {'catalog_version': str(catalog.get('version', 'local-acceptance')),
                        'catalog_sha256': 'sha256:' + hashlib.sha256(CATALOG_PATH.read_bytes()).hexdigest(),
                        'identity_kind': 'image_id', 'odoo_image': images['odoo'],
                        'web_image': images['web'], 'proxy_image': images['proxy']},
        'allowed_operations': ['tenant.preflight', 'tenant.inspect', 'health', 'tenant.create'],
        'revision': 1,
    }
    descriptor['descriptor_digest'] = descriptor_digest(target, descriptor)
    passwords = {key: secrets.token_urlsafe(36) for key in ('db_password', 'admin_password')}
    for key, value in passwords.items():
        Path(descriptor['secret_refs'][key]).write_text(value, encoding='utf-8')
    bundle = render_bundle(descriptor, postgres_image=images['db'],
                           db_password=passwords['db_password'], admin_password=passwords['admin_password'])
    for name, value in bundle.items():
        path = root / name
        path.write_text(value)
        path.chmod(0o600 if name == 'compose.json' else 0o444)
    for name in ('data', 'backups', 'state'):
        (root / name).mkdir(mode=0o700)
    inventory = root / 'inventory.json'
    inventory.write_text(json.dumps({'schema_version': 3, 'targets': {target: descriptor}}))
    tier = next(item for item in catalog['tiers'] if item['id'] == 'people')
    features = {'users.limit': None, 'storage.limit_mb': None}
    for feature in tier['features']:
        kind, key = feature.split(':', 1)
        features[key] = True if kind == 'boolean' else None
    policy = {'schema_version': 1, 'channel': 'control_plane',
              'modules': catalog['base_modules'] + tier['modules'], 'features': features}
    policy_path = root / 'policy.json'
    policy_path.write_text(json.dumps(policy))
    os.environ['WEBVUE_MANAGED_INVENTORY'] = str(inventory)
    os.environ['WEBVUE_CLI_STATE_DIR'] = str(root / 'state')
    for sock in sockets:
        sock.close()
    fields = {'operation': 'tenant.create', 'target': target,
              'request_id': str(uuid.uuid4()), 'policy_file': str(policy_path)}
    (root / 'request.json').write_text(json.dumps(fields))
    sys.stdout.write(json.dumps({'private_root': str(root), 'project': project, 'target': target, 'ports': ports}) + '\n')
    sys.stdout.flush()
    code, receipt = managed_adapter(fields)
    (root / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    if code == 0:
        checks = verify_replay(fields, receipt)
        (root / 'replay-evidence.json').write_text(json.dumps(checks, indent=2))
        sys.stdout.write(json.dumps(checks) + '\n')
    sys.stdout.write(json.dumps({'exit_code': code, 'receipt': receipt}) + '\n')
    sys.stdout.flush()
    return code


if __name__ == '__main__':
    sys.exit(main())
