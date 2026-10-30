# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Legacy read-only adapter retained for inspect, preflight and health.

All mutation uses ``python -m liwan_cli.operator``. This entry explicitly
refuses tenant.entitle, backup, restore and upgrade because it has no journal
or target lock. The parser-only bare entry remains unchanged.

Trust model:
- The target resolves through one explicit local inventory file
  (LIWAN_CLI_INVENTORY: absolute, bounded, strict schema). There is no
  default inventory, database, host, or port anywhere in this module.
- Database reads are read-only psql SELECTs built as list argv (no shell
  interpolation, per CP0 section 11).
- No operation in this module mutates a database.
- No child output is copied to stdout or stderr.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable
from datetime import date
from pathlib import Path

from .cli import EXIT_CODES, SCHEMA_VERSION
from .cli import main as cli_main

Runner = Callable[..., tuple[int, str, str]]

INVENTORY_ENV = 'LIWAN_CLI_INVENTORY'
INVENTORY_MAX_BYTES = 16384
INVENTORY_VERSION = 1
INVENTORY_KEYS = frozenset({'version', 'targets'})
INVENTORY_ENTRY_KEYS = frozenset({'database', 'kind', 'odoo_bin', 'odoo_conf'})
INVENTORY_KINDS = frozenset({'scratch', 'customer'})
# Same forbidden-name rule as deploy/backup.py: exact names plus bounded tokens.
FORBIDDEN_DB_EXACT = frozenset({
    'odoo19', 'production', 'prod', 'postgres', 'template0', 'template1',
})
FORBIDDEN_DB_RE = re.compile(
    r'(?:^|_)(odoo19|production|postgres|template0|template1)(?:_|$)', re.IGNORECASE,
)
DB_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
COMMERCIAL_CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / 'odoo-addons' / 'liwan_platform' / 'commercial_config.py'
)
PROFILE_TABLE = 'liwan_tenant_profile'
PSQL_ARGS = ('-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-F', '\x1f')
# A shell that fails while loading the registry still commits reset_modules_state.
# These flags keep that process from serving HTTP or starting cron.
SHELL_GUARD_ARGS = ('--no-http', '--workers=0', '--max-cron-threads=0', '--http-port=8179')
UNWIRED_OPERATIONS = frozenset({'backup', 'restore', 'upgrade'})

PROFILE_SQL = (
    f"SELECT commercial_mode, entitlement_source, COALESCE(valid_until::text, ''),"
    f" policy_revision, quota_revision, status FROM {PROFILE_TABLE}"
    " WHERE singleton_key = 'tenant'"
)
STUCK_SQL = (
    "SELECT count(*) FROM ir_module_module"
    " WHERE state IN ('to upgrade', 'to install', 'to remove')"
)


class _AdapterFailure(Exception):
    """Internal control flow: one structured adapter failure, never escaped."""

    def __init__(self, exit_code, code, message, stage):
        super().__init__(message)
        self.exit_code = exit_code
        self.code = code
        self.message = message
        self.stage = stage


def _payload(fields, status, *, stage, changed=False, error=None, **extra):
    payload = {
        'schema_version': SCHEMA_VERSION,
        'operation': fields.get('operation'),
        'target': fields.get('target'),
        'status': status,
        'stage': stage,
        'changed': changed,
    }
    for key in ('request_id', 'expected_revision'):
        if fields.get(key) is not None:
            payload[key] = fields[key]
    if error is not None:
        payload['error'] = error
    payload.update(extra)
    return payload


def _run_subprocess(command, env=None, stdin_text=None):
    completed = subprocess.run(
        command, input=stdin_text, capture_output=True, text=True, env=env, check=False,
    )
    return completed.returncode, completed.stdout, completed.stderr


def _child_reason(prefix, stderr):
    """Return a fixed reason; child streams may contain credentials or URLs."""
    del stderr
    return prefix


def _load_inventory(target):
    if not target:
        raise _AdapterFailure(2, 'invalid_input', 'target is required', 'inventory')
    filename = os.environ.get(INVENTORY_ENV)
    if not filename or not Path(filename).is_absolute():
        raise _AdapterFailure(
            2, 'invalid_input', f'set {INVENTORY_ENV} to an absolute local inventory file', 'inventory',
        )
    try:
        with Path(filename).open('rb') as stream:
            raw = stream.read(INVENTORY_MAX_BYTES + 1)
    except OSError as error:
        raise _AdapterFailure(
            2, 'invalid_input', f'inventory unreadable: {error.strerror or error}', 'inventory',
        ) from error
    if len(raw) > INVENTORY_MAX_BYTES:
        raise _AdapterFailure(2, 'invalid_input', f'inventory exceeds {INVENTORY_MAX_BYTES} bytes', 'inventory')
    try:
        data = json.loads(raw)
    except ValueError as error:
        raise _AdapterFailure(2, 'invalid_input', f'inventory is not valid JSON: {error}', 'inventory') from error
    if not isinstance(data, dict) or set(data) != INVENTORY_KEYS or data['version'] != INVENTORY_VERSION:
        raise _AdapterFailure(
            2, 'invalid_input', f'inventory requires version {INVENTORY_VERSION} and targets only', 'inventory',
        )
    targets = data['targets']
    if not isinstance(targets, dict) or not isinstance(targets.get(target), dict):
        raise _AdapterFailure(2, 'invalid_input', 'target is not in the local inventory', 'inventory')
    entry = targets[target]
    if set(entry) - INVENTORY_ENTRY_KEYS or not entry.get('database') or entry.get('kind') not in INVENTORY_KINDS:
        raise _AdapterFailure(
            2, 'invalid_input', 'inventory entry needs database, kind and no unknown keys', 'inventory',
        )
    for key in ('odoo_bin', 'odoo_conf'):
        value = entry.get(key)
        if value is not None and (not isinstance(value, str) or not Path(value).is_absolute()):
            raise _AdapterFailure(2, 'invalid_input', f'inventory {key} must be an absolute path', 'inventory')
    return entry


def _entry_database(entry):
    database = entry['database']
    forbidden = (
        not isinstance(database, str)
        or not DB_NAME_RE.fullmatch(database)
        or database.lower() in FORBIDDEN_DB_EXACT
        or FORBIDDEN_DB_RE.search(database)
    )
    if forbidden:
        raise _AdapterFailure(
            3, 'target_forbidden',
            'database name is forbidden or is not a plain PostgreSQL identifier', 'inventory',
        )
    if entry.get('kind') == 'scratch' and 'scratch' not in database.lower():
        raise _AdapterFailure(
            3, 'target_forbidden',
            'a scratch-kind target must name a scratch database', 'inventory',
        )
    return database


def _load_commercial_config():
    if not COMMERCIAL_CONFIG_PATH.is_file():
        raise _AdapterFailure(
            2, 'invalid_input', 'liwan_platform commercial_config module not found beside this checkout', 'classification',
        )
    spec = importlib.util.spec_from_file_location('liwan_cli_commercial_config', COMMERCIAL_CONFIG_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _assert_private_policy(policy_file):
    """A swapped world-writable policy must not reach classification or the shell."""
    path = Path(policy_file)
    try:
        info = path.stat()
    except OSError as error:
        raise _AdapterFailure(
            2, 'invalid_input', f'policy file unreadable: {error.strerror or error}', 'classification',
        ) from error
    if info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise _AdapterFailure(
            2, 'invalid_input',
            'policy file must be owned by the operator and not group- or world-writable', 'classification',
        )


def _classify(module, database, valid_until, policy_file):
    """Validate the operator input through load_classification, env restored after."""
    _assert_private_policy(policy_file)
    previous = os.environ.get(module.CONFIG_ENV)
    os.environ[module.CONFIG_ENV] = policy_file
    try:
        return module.load_classification(database, valid_until), None
    except ValueError as error:
        return None, str(error)
    finally:
        if previous is None:
            os.environ.pop(module.CONFIG_ENV, None)
        else:
            os.environ[module.CONFIG_ENV] = previous


def _psql(run, database, sql):
    command = ['psql', *PSQL_ARGS, '-d', database, '-c', sql]
    try:
        code, out, err = run(command)
    except OSError as error:
        return None, str(error)
    if code != 0 or 'ERROR' in (err or '') or 'WARNING' in (err or ''):
        return None, err or f'psql exited with {code}'
    lines = [line for line in out.splitlines() if line.strip()]
    return [line.split('\x1f') for line in lines], None


def _require_profile(run, database, stage):
    rows, err = _psql(run, database, PROFILE_SQL)
    if rows is None:
        raise _AdapterFailure(5, 'operation_failed', _child_reason('snapshot read failed', err), stage)
    if len(rows) != 1 or len(rows[0]) != 6:
        raise _AdapterFailure(
            6, 'profile_missing', 'the target has no classified tenant profile row', stage,
        )
    try:
        return {
            'commercial_mode': rows[0][0],
            'entitlement_source': rows[0][1],
            'valid_until': rows[0][2] or None,
            'policy_revision': int(rows[0][3]),
            'quota_revision': int(rows[0][4]),
            'status': rows[0][5],
        }
    except ValueError as error:
        raise _AdapterFailure(
            6, 'needs_intervention', f'profile revision columns are not integers: {error}', stage,
        ) from error


def _parse_date(text):
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise _AdapterFailure(
            6, 'needs_intervention', f'profile valid_until is not an ISO date: {error}', 'classification',
        ) from error


def _inspect(fields, database, run):
    profile = _require_profile(run, database, 'snapshot')
    return 0, _payload(fields, 'ok', stage='snapshot', changed=False, profile=profile)


def _preflight(fields, database, run):
    profile = _require_profile(run, database, 'classification')
    module = _load_commercial_config()
    _classification, failure = _classify(module, database, _parse_date(profile['valid_until']), fields['policy_file'])
    if failure:
        return 4, _payload(
            fields, 'error', stage='classification', changed=False,
            error={'code': 'classification_conflict', 'message': failure}, conflicts=[failure],
            execution_ready=False,
        )
    return 0, _payload(
        fields, 'validated_input', stage='classification', changed=False, execution_ready=False,
        conflicts=[], snapshot={
            'commercial_mode': profile['commercial_mode'],
            'entitlement_source': profile['entitlement_source'],
            'valid_until': profile['valid_until'],
            'policy_revision': profile['policy_revision'],
        },
        note='conflict review only; a preflight never announces execution readiness',
    )


def _health(fields, database, run):
    profile = _require_profile(run, database, 'health')
    rows, err = _psql(run, database, STUCK_SQL)
    if rows is None or not rows or not rows[0]:
        raise _AdapterFailure(5, 'operation_failed', _child_reason('module state read failed', err), 'health')
    try:
        stuck = int(rows[0][0])
    except ValueError as error:
        raise _AdapterFailure(5, 'operation_failed', f'module state count is not an integer: {error}', 'health') from error
    if stuck:
        return 6, _payload(
            fields, 'needs_intervention', stage='health', changed=False, profile=profile, stuck_modules=stuck,
            error={'code': 'needs_intervention', 'message': f'{stuck} modules are stuck in a pending state'},
        )
    return 0, _payload(fields, 'ok', stage='health', changed=False, profile=profile, stuck_modules=stuck)


def _dispatch(fields, run):
    operation = fields.get('operation')
    if operation == 'tenant.entitle':
        raise _AdapterFailure(
            5, 'operator_entry_required',
            'tenant.entitle requires python -m liwan_cli.operator with durable receipts',
            'adapter',
        )
    if operation in UNWIRED_OPERATIONS:
        raise _AdapterFailure(
            EXIT_CODES['operation_failed'], 'operation_not_wired',
            f'{operation} stays unwired in CP2-T4: CP0 section 11 requires receipts first'
            ' and receipts/locks/fencing land in CP2-T5',
            'adapter',
        )
    entry = _load_inventory(fields.get('target'))
    database = _entry_database(entry)
    if operation == 'tenant.inspect':
        return _inspect(fields, database, run)
    if operation == 'tenant.preflight':
        return _preflight(fields, database, run)
    if operation == 'health':
        return _health(fields, database, run)
    raise _AdapterFailure(2, 'invalid_input', f'unknown operation {operation}', 'adapter')


def deploy_adapter(fields, *, runner=None):
    """The CP2-T4 adapter seam: (validated fields) -> (exit code, payload)."""
    run = runner or _run_subprocess
    try:
        return _dispatch(fields, run)
    except _AdapterFailure as failure:
        return failure.exit_code, _payload(
            fields, 'error', stage=failure.stage, error={'code': failure.code, 'message': failure.message},
        )


def main(argv=None):
    """Executing operator entry: PYTHONPATH=tools python3 -B -m liwan_cli.adapters ..."""
    return cli_main(argv, adapter=deploy_adapter)


if __name__ == '__main__':
    sys.exit(main())
