"""Opt-in PostgreSQL infrastructure proof on exactly the authorized scratch names.

Never drops resources. A new run requires absent names/output. Preserved report
can be inspected after completion; reruns never overwrite an earlier fixture.
This is not Odoo upgrade or tenant business acceptance.
"""
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import time

from deploy.releases.backup import capture_tenant, validate_backup, restore_tenant
from deploy.releases.postgres import identifier, runtime_role_fixture, validate_runtime_role, fence_runtime

ATTACHMENT = b'LiwanOS isolated PostgreSQL infrastructure acceptance attachment\n'
CHECKS = ('role_valid', 'public_connect_rejected', 'membership_rejected',
          'active_transaction_refused', 'active_work_preserved', 'idle_old_terminated',
          'old_reconnect_refused', 'new_role_dml', 'backup_hashes_valid',
          'restored_fixture_matches', 'restored_attachment_matches')


def scratch_names(suffix='1016'):
    """Build isolated names for a separately authorized future scratch run."""
    if not isinstance(suffix, str) or not re.fullmatch(r'[a-z0-9_]{1,16}', suffix):
        raise ValueError('scratch_suffix_rejected')
    return ('liwan_scratch_updates_roles_' + suffix, 'liwan_scratch_updates_restore_roles_' + suffix,
            'liwan_updates_owner_' + suffix, 'liwan_updates_blue_' + suffix, 'liwan_updates_green_' + suffix)


def _connect(database, role='tariq'):
    import psycopg2
    return psycopg2.connect(host='127.0.0.1', port=5432, user=role, dbname=database, connect_timeout=5)


def _query(connection, statement, params=()):
    with connection.cursor() as cursor:
        cursor.execute(statement, params)
        return cursor.fetchall() if cursor.description else []


def _file_hash(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''): result.update(block)
    return result.hexdigest()


def run_scratch(output_root, *, suffix='1016'):
    """Run exact authorized fixture using actual DB driver and subprocess tools."""
    DATABASE, RESTORED, OWNER, BLUE, GREEN = scratch_names(suffix)
    if os.environ.get('LIWAN_RUN_PG_SCRATCH') != '1': raise ValueError('scratch_opt_in_required')
    root = Path(output_root)
    if not root.is_absolute() or root.resolve() != root or root.exists(): raise ValueError('scratch_output_must_be_new')
    tools = {key: shutil.which(name) for key, name in [('pgDump', 'pg_dump'), ('pgRestore', 'pg_restore'), ('createdb', 'createdb')]}
    if not all(tools.values()): raise ValueError('postgres_tools_missing')
    connections = []
    checks = {name: False for name in CHECKS}
    report = {'version': 1, 'scope': 'postgres_infrastructure_fixture', 'odoo_acceptance': False,
              'database': DATABASE, 'restoredDatabase': RESTORED, 'roles': [OWNER, BLUE, GREEN],
              'checks': checks, 'passed': False, 'stage': 'preflight', 'resourcesPreserved': True}
    bootstrap = _connect('postgres'); connections.append(bootstrap); bootstrap.autocommit = True
    existing_dbs = _query(bootstrap, 'SELECT datname FROM pg_database WHERE datname IN (%s,%s)', (DATABASE, RESTORED))
    existing_roles = _query(bootstrap, 'SELECT rolname FROM pg_roles WHERE rolname IN (%s,%s,%s)', (OWNER, BLUE, GREEN))
    if existing_dbs or existing_roles:
        bootstrap.close(); raise ValueError('scratch_names_must_be_new')
    root.mkdir(parents=True, mode=0o700, exist_ok=False)
    try:
        report['stage'] = 'create_fixture'
        _query(bootstrap, f'CREATE ROLE {identifier(OWNER)} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
        _query(bootstrap, f'CREATE DATABASE {identifier(DATABASE)} OWNER {identifier(OWNER)}')
        admin = _connect(DATABASE); connections.append(admin); admin.autocommit = True
        _query(admin, 'SET ROLE ' + identifier(OWNER))
        _query(admin, 'CREATE TABLE release_infrastructure_probe (id integer PRIMARY KEY, value text NOT NULL)')
        _query(admin, 'INSERT INTO release_infrastructure_probe VALUES (%s,%s)', (1, 'before'))
        _query(admin, 'RESET ROLE')
        for statement in runtime_role_fixture(DATABASE, OWNER, [BLUE, GREEN]): _query(admin, statement)
        checks['role_valid'] = all(validate_runtime_role(admin, role, DATABASE)['valid'] for role in (BLUE, GREEN))
        report['stage'] = 'validate_privilege_refusals'
        _query(admin, f'GRANT CONNECT ON DATABASE {identifier(DATABASE)} TO PUBLIC')
        checks['public_connect_rejected'] = not validate_runtime_role(admin, BLUE, DATABASE)['valid']
        _query(admin, f'REVOKE CONNECT ON DATABASE {identifier(DATABASE)} FROM PUBLIC')
        _query(admin, f'GRANT {identifier(OWNER)} TO {identifier(BLUE)}')
        checks['membership_rejected'] = not validate_runtime_role(admin, BLUE, DATABASE)['valid']
        _query(admin, f'REVOKE {identifier(OWNER)} FROM {identifier(BLUE)}')

        report['stage'] = 'active_transaction_fence'
        binding = {'tenantId': 'infrastructure_fixture', 'database': DATABASE, 'filestore': DATABASE,
                   'fence': 1, 'gateClosed': True, 'admittedWriters': 0}
        old = _connect(DATABASE, BLUE); connections.append(old)
        _query(old, 'UPDATE release_infrastructure_probe SET value=%s WHERE id=1', ('uncommitted',))
        refused = fence_runtime(binding, BLUE, GREEN, lambda db: _connect(db), deadline_seconds=0)
        checks['active_transaction_refused'] = not refused['fenced'] and refused['reason'] == 'active_transactions'
        checks['active_work_preserved'] = _query(old, 'SELECT value FROM release_infrastructure_probe WHERE id=1') == [('uncommitted',)]
        old.rollback(); old.autocommit = True

        report['stage'] = 'idle_fence_and_reconnect'
        fenced = fence_runtime(binding, BLUE, GREEN, lambda db: _connect(db), deadline_seconds=2)
        if not fenced['fenced'] and fenced.get('reason') == 'old_connections_remain':
            time.sleep(0.15)  # One bounded retry only for asynchronous backend exit.
            fenced = fence_runtime(binding, BLUE, GREEN, lambda db: _connect(db), deadline_seconds=2)
        report['fenceEvidence'] = fenced
        old_terminated = False
        try: _query(old, 'SELECT 1')
        except Exception: old_terminated = True
        checks['idle_old_terminated'] = fenced['fenced'] and old_terminated
        try:
            unexpected = _connect(DATABASE, BLUE); unexpected.close()
        except Exception:
            checks['old_reconnect_refused'] = True
        new = _connect(DATABASE, GREEN); connections.append(new); new.autocommit = True
        _query(new, 'INSERT INTO release_infrastructure_probe VALUES (%s,%s)', (2, 'green-write'))
        _query(new, 'UPDATE release_infrastructure_probe SET value=%s WHERE id=1', ('after',))
        expected_rows = [(1, 'after'), (2, 'green-write')]
        checks['new_role_dml'] = _query(new, 'SELECT id,value FROM release_infrastructure_probe ORDER BY id') == expected_rows
        new.close(); old.close()

        report['stage'] = 'quiescent_dump_and_filestore'
        store = root / 'source' / 'filestore' / DATABASE
        store.mkdir(parents=True)
        (store / 'attachment').write_bytes(ATTACHMENT)
        def quiescence(current):
            active = _query(admin, "SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid() AND backend_type='client backend' AND (state<>'idle' OR xact_start IS NOT NULL)", (DATABASE,))[0][0]
            old_count = _query(admin, 'SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND usename=%s', (DATABASE, BLUE))[0][0]
            return {**current, 'activeTransactions': active, 'oldConnections': old_count}
        config = {'mode': 'local', 'outputDir': str(root / 'backup'), 'filestorePath': str(store),
                  **tools, 'pgEnv': {'PGHOST': '127.0.0.1', 'PGPORT': '5432', 'PGUSER': 'tariq'},
                  'timeoutSeconds': 60, 'image': 'local/postgres-fixture@sha256:' + _file_hash(tools['pgDump']),
                  'recheck': quiescence}
        receipt = capture_tenant(binding, quiescence(binding), config)
        checks['backup_hashes_valid'] = validate_backup(root / 'backup')['valid']
        report['backupHashes'] = receipt['hashes']
        report['imageIdentityKind'] = 'fixture_tool_binary_metadata_only'

        report['stage'] = 'scratch_restore'
        restored_store = root / 'restored' / RESTORED
        restored = restore_tenant(root / 'backup', {'tenantId':binding['tenantId'],'database': RESTORED,'filestore':RESTORED}, {**config,
            'restoreAllowed': True, 'writesResumed': False,'recoverySource':{key:receipt[key] for key in ('tenantId','database','filestore','fence')}, 'targetFilestore': str(restored_store)})
        target = _connect(RESTORED); connections.append(target); target.autocommit = True
        checks['restored_fixture_matches'] = _query(target, 'SELECT id,value FROM release_infrastructure_probe ORDER BY id') == expected_rows
        expected_attachment = hashlib.sha256(ATTACHMENT).hexdigest()
        checks['restored_attachment_matches'] = _file_hash(restored_store / 'attachment') == expected_attachment
        report['attachmentSha256'] = expected_attachment
        report['restoreEvidence'] = restored
        report['passed'] = all(checks.values())
        report['stage'] = 'complete' if report['passed'] else 'checks_failed'
        if not report['passed']: raise ValueError('scratch_checks_failed')
        return report
    except Exception:
        report['error'] = 'scratch_acceptance_failed'
        raise RuntimeError('scratch_acceptance_failed_at_' + report['stage']) from None
    finally:
        for connection in connections:
            try: connection.close()
            except Exception: pass  # Preserve the original acceptance result.
        (root / 'report.json').write_text(json.dumps(report, sort_keys=True, indent=2) + '\n')
