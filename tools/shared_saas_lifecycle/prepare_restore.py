# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Add isolated restore resources without replacing existing local state."""
from __future__ import annotations
import fcntl
import json
import os
from pathlib import Path
import secrets
import shlex
from tools.shared_saas_lifecycle.lifecycle import ROOT, prepare_networks, write_private


def prepare_restore(state):
    # Stable lock inode survives atomic environment replacement. A second
    # preparer rereads committed secrets only after the first has finished.
    lock_path = Path(state['stateDir']) / 'restore-prepare.lock'
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        _prepare_restore(state)


def _prepare_restore(state):
    directory = Path(state['stateDir'])
    env_file = Path(state['envFile'])
    values = {}
    original = env_file.read_text()
    for line in original.splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        key, raw = line.split('=', 1)
        parsed = shlex.split(raw)
        if len(parsed) != 1:
            raise ValueError('invalid private Compose environment')
        values[key] = parsed[0]
    additions = {
        'RESTORE_DB_PASSWORD': secrets.token_hex(24),
        'RESTORE_PROXY_TOKEN': secrets.token_hex(32),
        'RESTORE_SESSION_KEYS': json.dumps({'r1': secrets.token_hex(32)}, separators=(',', ':')),
    }
    missing = {key: value for key, value in additions.items() if key not in values}
    if missing:
        temp = env_file.with_suffix('.restore-pending-' + secrets.token_hex(12))
        write_private(temp, original.rstrip() + '\n' + ''.join(f"{k}='{v}'\n" for k, v in missing.items()))
        with temp.open('rb') as stream:
            os.fsync(stream.fileno())
        os.replace(temp, env_file)
        parent_fd = os.open(env_file.parent, os.O_RDONLY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        values.update(missing)
    config = ('[options]\ndb_host = restore-db\ndb_user = odoo\n'
              f'db_password = {values["RESTORE_DB_PASSWORD"]}\n'
              f'admin_passwd = {secrets.token_hex(32)}\n'
              'dbfilter = ^%h$\nlist_db = False\nproxy_mode = False\n'
              'data_dir = /var/lib/odoo\nworkers = 2\nmax_cron_threads = 0\n')
    path = directory / 'restore-odoo.conf'
    if not path.exists():
        write_private(path, config, 0o440)
    else:
        current = path.read_text()
        for item in ['db_host = restore-db', 'list_db = False', 'max_cron_threads = 0', f'db_password = {values["RESTORE_DB_PASSWORD"]}']:
            if item not in current.splitlines():
                raise ValueError('existing restore config mismatch')
    registry = directory / 'restore-registry'
    registry.mkdir(mode=0o755, exist_ok=True)
    if not (registry / 'registry.json').exists():
        write_private(registry / 'registry.json', json.dumps({'schemaVersion': 1, 'snapshotRevision': 0, 'targets': []}), 0o644)
    # Use the shipped edge policy; only this private generated include changes
    # the host, upstream and independent limiter zone names for restore traffic.
    edge = (ROOT / 'deploy/shared/Caddyfile').read_text()
    if edge.count('{$DOMAIN}') != 1 or edge.count('reverse_proxy guard:8080') != 1:
        raise ValueError('shared ingress template changed')
    edge = edge.replace('{$DOMAIN}', '*.restore.saas.accept.nasq.test').replace('reverse_proxy guard:8080', 'reverse_proxy restore-guard:8080').replace('zone nasq_', 'zone restore_nasq_')
    path = directory / 'restore.Caddyfile'
    if not path.exists():
        write_private(path, edge, 0o644)
    elif path.read_text() != edge:
        raise ValueError('restore ingress policy differs; review before replacing')
    prepare_networks(state['projectName'])
    print('Prepared isolated restore profile; existing credentials and resources preserved')
