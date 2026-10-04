# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Read-only readbacks for commercial C2 acceptance (control DB, tenant Odoo DB, Mailpit).

Only ever talks to project nasq-saas-commercial-acceptance via docker compose exec.
Every SQL is a SELECT run in a READ ONLY transaction; ids are validated before use.
"""
from __future__ import annotations

import json
import re
import subprocess
import urllib.request
from pathlib import Path

from tools.saas_commercial_acceptance import commercial_lifecycle as L

CONTROL_DB = 'nasq_control_scratch_commercial'
TENANT_DB_RE = re.compile(r'nasq_scratch_[a-f0-9]{32}')
UUID_RE = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
SECRET_RE = re.compile(r'(?i)(password|secret|token|key|cookie|authorization)(["\']?\s*[:=]\s*["\']?)[^"\',\s}]+')
CONTROL_TABLES = {
    'orders', 'invoices', 'invoice_lines', 'payment_attempts', 'payment_events', 'subscriptions',
    'subscription_revisions', 'commercial_branches', 'renewals', 'fulfillment_effects',
    'commercial_outbox', 'usage_snapshots', 'customers', 'customer_terms_revisions',
    'branch_quote_requests',
}


def redact(text: str) -> str:
    return SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + '[redacted]', text)


def assert_scratch(state: dict) -> None:
    if state.get('projectName') != L.PROJECT:
        raise ValueError('env pointer is not project ' + L.PROJECT)


def _psql(state: dict, service: str, user: str, database: str, sql: str):
    if not sql.lstrip().lower().startswith(('select', 'with')):
        raise ValueError('read-only SELECT required')
    wrapped = f'BEGIN READ ONLY; SELECT coalesce(json_agg(t), \'[]\'::json) FROM ({sql.rstrip(";")}) t; COMMIT;'
    out = L.compose(state, ['exec', '-T', service, 'psql', '-U', user, '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', wrapped],
                    capture_output=True, text=True).stdout
    # json_agg emits physical newlines between rows; parse the complete array.
    start = out.index('[')
    value, _ = json.JSONDecoder().raw_decode(out[start:])
    return value


def control(state: dict, sql: str):
    assert_scratch(state)
    return _psql(state, 'control-db', 'nasq_control', CONTROL_DB, sql)


def control_row(state: dict, table: str, row_id: str, id_column: str = 'id') -> dict | None:
    """One row of a control-plane table by id (table/column allow-listed, id validated as uuid or token)."""
    if table not in CONTROL_TABLES or not re.fullmatch(r'[a-z_]+', id_column):
        raise ValueError('table/column not allowed')
    if not (UUID_RE.fullmatch(row_id) or re.fullmatch(r'[A-Za-z0-9_-]{1,128}', row_id)):
        raise ValueError('invalid id')
    rows = control(state, f"SELECT * FROM {table} WHERE {id_column}::text='{row_id}'")
    return rows[0] if rows else None


def control_rows(state: dict, table: str, where_col: str, value: str) -> list[dict]:
    if table not in CONTROL_TABLES or not re.fullmatch(r'[a-z_]+', where_col) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value):
        raise ValueError('not allowed')
    return control(state, f"SELECT * FROM {table} WHERE {where_col}::text='{value}' ORDER BY 1")


def count_where(state: dict, table: str, where_col: str, value: str) -> int:
    return len(control_rows(state, table, where_col, value))


def linkage(state: dict, order_id: str) -> dict:
    """quote -> order -> invoice -> attempts -> events (ids only) for ledger assertions."""
    return {
        'order': control_row(state, 'orders', order_id),
        'invoices': control_rows(state, 'invoices', 'order_id', order_id),
        'attempts': control_rows(state, 'payment_attempts', 'order_id', order_id),
    }


def tenant_database(state: dict, host: str) -> str:
    registry = json.loads((Path(state['stateDir']) / 'registry/registry.json').read_text())
    target = next((t for t in registry['targets'] if t['host'] == host), None)
    if not target or not TENANT_DB_RE.fullmatch(target['database']):
        raise ValueError('no scratch tenant database for host')
    return target['database']


def odoo(state: dict, database: str, sql: str):
    assert_scratch(state)
    if not TENANT_DB_RE.fullmatch(database):
        raise ValueError('scratch tenant DB required')
    return _psql(state, 'db', 'odoo', database, sql)


def tenant_profile(state: dict, database: str) -> dict:
    rows = odoo(state, database, 'SELECT policy_revision, commercial_mode, commercial_revision_id, commercial_digest, features, retained_read_features FROM nasq_tenant_profile LIMIT 1')
    return rows[0]


def companies_and_branches(state: dict, database: str) -> dict:
    return {
        'companies': odoo(state, database, 'SELECT id, name, parent_id, active FROM res_company ORDER BY id'),
        'branches': odoo(state, database, 'SELECT branch_uid, company_id, operation_id, target_revision_id, state FROM nasq_tenant_branch ORDER BY id'),
    }


def users(state: dict, database: str) -> list[dict]:
    return odoo(state, database, 'SELECT id, login, active, company_id FROM res_users WHERE id > 2 ORDER BY id')


def attachment(state: dict, database: str, attachment_id: int) -> dict:
    """DB row plus physical bytes sha256 read from the odoo container filestore."""
    row = odoo(state, database, f'SELECT id, file_size, store_fname, checksum, res_model, res_id FROM ir_attachment WHERE id={int(attachment_id)}')[0]
    if not re.fullmatch(r'[a-f0-9]{2}/[a-f0-9]{40}', row['store_fname'] or ''):
        raise ValueError('invalid filestore path')
    path = f"/var/lib/odoo/filestore/{database}/{row['store_fname']}"
    script = ('from pathlib import Path;import hashlib,json;b=Path(%r).read_bytes();'
              'print(json.dumps({"sha256":hashlib.sha256(b).hexdigest(),"bytes":len(b)}))' % path)
    row['physical'] = json.loads(L.compose(state, ['exec', '-T', 'odoo', '/opt/venv/bin/python', '-c', script], capture_output=True, text=True).stdout)
    return row


def record_count(state: dict, database: str, table: str) -> int:
    if table not in {'project_project', 'project_task', 'hr_employee', 'ir_attachment', 'res_users', 'res_company'}:
        raise ValueError('table not allowed')
    return odoo(state, database, f'SELECT count(*) AS n FROM {table}')[0]['n']


def mailpit_messages(limit: int = 50) -> list[dict]:
    with urllib.request.urlopen(f'http://127.0.0.1:55428/api/v1/messages?limit={int(limit)}', timeout=10) as r:
        data = json.loads(r.read())
    return [{'id': m['ID'], 'to': [x['Address'] for x in m.get('To', [])], 'subject': m.get('Subject'), 'created': m.get('Created')} for m in data.get('messages', [])]


def mailpit_body(message_id: str) -> str:
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', message_id):
        raise ValueError('bad message id')
    with urllib.request.urlopen(f'http://127.0.0.1:55428/api/v1/message/{message_id}', timeout=10) as r:
        return redact(json.loads(r.read()).get('Text', ''))


def snapshot_fingerprint(state: dict, database: str) -> dict:
    """Row counts + attachment checksums, comparable before backup and after restore (reuse of restore_readback ideas)."""
    return {
        'counts': {t: record_count(state, database, t) for t in ('project_project', 'project_task', 'ir_attachment', 'res_users', 'res_company')},
        'attachments': odoo(state, database, "SELECT id, checksum, file_size FROM ir_attachment WHERE res_model='project.task' ORDER BY id"),
        'profile': tenant_profile(state, database),
        'branches': companies_and_branches(state, database)['branches'],
    }


def main() -> None:
    import argparse
    p = argparse.ArgumentParser(description='read-only commercial acceptance readback')
    p.add_argument('kind', choices=['order', 'profile', 'fingerprint', 'mail', 'sql', 'bindings'])
    p.add_argument('value', nargs='?')
    a = p.parse_args()
    state = L.read_state()
    if a.kind == 'order':
        out = linkage(state, a.value)
    elif a.kind == 'mail':
        out = mailpit_messages()
    elif a.kind == 'sql':
        out = control(state, a.value)
    elif a.kind == 'bindings':
        out = companies_and_branches(state, tenant_database(state, a.value))
    else:
        db = tenant_database(state, a.value)
        out = tenant_profile(state, db) if a.kind == 'profile' else snapshot_fingerprint(state, db)
    print(redact(json.dumps(out, indent=2, default=str)))


if __name__ == '__main__':
    main()
