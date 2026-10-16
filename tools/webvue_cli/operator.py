# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Scratch-only local operator. Call with ``PYTHONPATH=tools python -m webvue_cli.operator``.

The service owns the inventory, state directory and private policy file. A
browser supplies only an inventory ID and declared command fields. This module
never accepts connection coordinates or executable paths from command flags.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

from . import journal
from .cli import SCHEMA_VERSION
from .cli import main as cli_main
from .managed_verify import _features_match
from .module_closure import ClosureError, install_closure

INVENTORY_ENV = 'WEBVUE_CLI_INVENTORY'
STATE_ENV = 'WEBVUE_CLI_STATE_DIR'
INVENTORY_MAX = 16384
POLICY_MAX = 16384
RELEASE_MAX = 16384
RESULT_MARKER = 'WEBVUE_OPERATOR_RESULT:'
IDENTIFIER = re.compile(r'^[a-z][a-z0-9_]{0,62}$')
SCRATCH_DB = re.compile(r'^webvue_scratch_[a-z0-9_]{1,42}$')
FEATURE_KEY = re.compile(r'^[a-z][a-z0-9_.-]{0,63}$')
ENTRY_KEYS = frozenset({
    'database', 'kind', 'pg_host', 'pg_port', 'pg_user', 'python', 'odoo_bin',
    'addons_paths', 'data_dir', 'psql', 'pg_dump', 'pg_restore', 'createdb',
    'backup_root', 'release_root', 'classification_file',
})
PATH_KEYS = frozenset({
    'python', 'odoo_bin', 'data_dir', 'psql', 'pg_dump', 'pg_restore',
    'createdb', 'backup_root', 'release_root', 'classification_file',
})
CREATE_MODULES = (
    'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_directory', 'webvue_notify', 'webvue_pmo',
    'webvue_meetings', 'webvue_meetings_pmo', 'webvue_hr', 'webvue_chat', 'webvue_tasks', 'webvue_tasks_pmo',
    'webvue_operations', 'webvue_operations_pmo', 'webvue_ai', 'webvue_pmo_ai',
)
CATALOG_PATH = Path(__file__).resolve().parents[2] / 'deploy' / 'catalog' / 'solutions' / 'platform.json'
PROFILE_SQL = (
    "SELECT commercial_mode, entitlement_source, COALESCE(valid_until::text, ''), "
    "policy_revision, quota_revision, status FROM webvue_tenant_profile "
    "WHERE singleton_key = 'tenant'"
)
STUCK_SQL = ("SELECT count(*) FROM ir_module_module "
             "WHERE state IN ('to upgrade', 'to install', 'to remove')")
SESSIONS_SQL = ("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                "AND pid <> pg_backend_pid()")
BACKUP_WRAPPER = Path(__file__).resolve().parents[2] / 'deploy' / 'backup.py'
RESTORE_WRAPPER = Path(__file__).resolve().parents[2] / 'deploy' / 'restore_verify.py'

# The row lock and revision check are in the same Odoo transaction as the ORM
# update. The read-only psql snapshot used by preflight cannot authorize a write.
ENTITLE_SCRIPT = """\
import json
import os
from odoo.addons.webvue_platform.commercial_config import load_classification
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

def _features_match(actual, expected):
    # Only a migrated legacy null may extend a policy that omitted this key.
    observed = dict(actual)
    if 'branches.extra_limit' not in expected and observed.get('branches.extra_limit') is None:
        observed.pop('branches.extra_limit', None)
    return (set(observed) == set(expected)
            and all(type(value) is type(expected[key]) and value == expected[key]
                    for key, value in observed.items()))

result = {'status': 'needs_intervention', 'changed': False, 'error_code': 'operator_script_failed'}
try:
    with open(os.environ['WEBVUE_OPERATOR_POLICY_FILE'], encoding='utf-8') as stream:
        policy = json.load(stream)
    expected_revision = int(os.environ['WEBVUE_EXPECTED_REVISION'])
    profile = env['webvue.tenant.profile'].search([('singleton_key', '=', 'tenant')], limit=1)
    if not profile:
        result = {'status': 'needs_intervention', 'changed': False, 'error_code': 'profile_missing'}
    else:
        profile = profile._webvue_lock()  # SELECT ... FOR UPDATE; invalidates cached fields
        classification = load_classification(env.cr.dbname, profile.valid_until)
        if (profile.entitlement_source != policy['channel'] or
                classification['commercial_mode'] != profile.commercial_mode or
                classification['entitlement_source'] != profile.entitlement_source):
            result = {'status': 'conflict', 'changed': False, 'error_code': 'classification_conflict'}
        elif int(profile.policy_revision) != expected_revision:
            result = {'status': 'conflict', 'changed': False, 'error_code': 'revision_conflict'}
        elif _features_match(profile.features, policy['features']):
            result = {'status': 'ok', 'changed': False,
                      'policy_revision': int(profile.policy_revision)}
        else:
            profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': policy['features']})
            result = {'status': 'ok', 'changed': True,
                      'policy_revision': int(profile.policy_revision)}
            env.cr.commit()
except Exception:
    env.cr.rollback()
print('WEBVUE_OPERATOR_RESULT:' + json.dumps(result, sort_keys=True))
"""


class OperatorFailure(Exception):
    def __init__(self, exit_code, code, stage, message):
        super().__init__(message)
        self.exit_code, self.code, self.stage, self.message = exit_code, code, stage, message


def _fail(exit_code, code, stage, message):
    raise OperatorFailure(exit_code, code, stage, message)


def _payload(fields, status, stage, *, changed=False, operation_id=None, error=None, **extra):
    result = {
        'schema_version': SCHEMA_VERSION, 'operation_id': operation_id,
        'request_id': fields.get('request_id'), 'target': fields.get('target'),
        'operation': fields.get('operation'), 'status': status, 'stage': stage,
        'changed': changed,
    }
    if error:
        result['error'] = error
    result.update(extra)
    return result


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            msg = 'duplicate JSON key'
            raise ValueError(msg)
        result[key] = value
    return result


def _private_file(path, maximum, label):
    candidate = Path(path)
    if not candidate.is_absolute() or candidate.is_symlink():
        _fail(2, 'invalid_input', label, f'{label} must be an absolute regular file')
    try:
        info = candidate.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            _fail(2, 'invalid_input', label, f'{label} must be operator owned and not writable by others')
        with candidate.open('rb') as stream:
            data = stream.read(maximum + 1)
    except OSError:
        _fail(2, 'invalid_input', label, f'{label} cannot be read')
    if len(data) > maximum:
        _fail(2, 'invalid_input', label, f'{label} exceeds its size limit')
    return data


def _decode(raw, label):
    try:
        return json.loads(raw, object_pairs_hook=_object)
    except (UnicodeError, ValueError):
        _fail(2, 'invalid_input', label, f'{label} has invalid JSON')


def _inventory(target):
    name = os.environ.get(INVENTORY_ENV)
    if not name:
        _fail(2, 'invalid_input', 'inventory', f'{INVENTORY_ENV} is required')
    document = _decode(_private_file(name, INVENTORY_MAX, 'inventory'), 'inventory')
    if (not isinstance(document, dict) or set(document) != {'version', 'targets'}
            or type(document['version']) is not int or document['version'] != 2
            or not isinstance(document['targets'], dict)):
        _fail(2, 'invalid_input', 'inventory', 'inventory version 2 is required')
    entry = document['targets'].get(target)
    if not isinstance(entry, dict) or set(entry) != ENTRY_KEYS:
        _fail(2, 'invalid_input', 'inventory', 'target is absent or inventory entry is incomplete')
    for other_id, other in document['targets'].items():
        if other_id == target:
            continue
        if not isinstance(other, dict) or set(other) != ENTRY_KEYS:
            _fail(2, 'invalid_input', 'inventory', 'inventory contains an incomplete target entry')
        same_db = (other['pg_host'], other['pg_port'], other['database']) == (
            entry['pg_host'], entry['pg_port'], entry['database'])
        same_data = other['data_dir'] == entry['data_dir']
        if same_db or same_data:
            _fail(3, 'target_alias_forbidden', 'inventory',
                  'two inventory IDs cannot map to one database or data directory')
    db = entry['database']
    if (not isinstance(db, str) or not SCRATCH_DB.fullmatch(db)
            or any(token in db.split('_') for token in ('odoo19', 'production', 'prod'))):
        _fail(3, 'target_forbidden', 'inventory', 'target database must be an explicit scratch name')
    if entry['kind'] != 'scratch':
        _fail(3, 'target_forbidden', 'inventory', 'CP2 operator permits scratch targets only')
    if (not isinstance(entry['pg_host'], str) or not entry['pg_host']
            or any(c.isspace() for c in entry['pg_host'])
            or not isinstance(entry['pg_user'], str) or not IDENTIFIER.fullmatch(entry['pg_user'])
            or type(entry['pg_port']) is not int or not 1 <= entry['pg_port'] <= 65535):
        _fail(2, 'invalid_input', 'inventory', 'explicit PostgreSQL coordinates are required')
    for key in PATH_KEYS:
        value = entry[key]
        path = Path(value) if isinstance(value, str) else Path('.')
        if not isinstance(value, str) or not path.is_absolute() or (
                path.is_symlink() and key not in {'python', 'psql', 'pg_dump', 'pg_restore', 'createdb'}):
            _fail(2, 'invalid_input', 'inventory', f'inventory {key} requires an absolute path')
        if key in {'data_dir', 'backup_root', 'release_root'}:
            if not path.is_dir():
                _fail(2, 'invalid_input', 'inventory', f'inventory {key} directory is missing')
        elif not path.is_file():
            _fail(2, 'invalid_input', 'inventory', f'inventory {key} file is missing')
    paths = entry['addons_paths']
    if (not isinstance(paths, list) or not paths
            or any(not isinstance(item, str) or not Path(item).is_absolute()
                   or not Path(item).is_dir() for item in paths)):
        _fail(2, 'invalid_input', 'inventory', 'inventory addons_paths must list existing absolute directories')
    fingerprint = hashlib.sha256(json.dumps(
        {'target': target, 'entry': entry}, sort_keys=True,
        separators=(',', ':')).encode('utf-8')).hexdigest()
    return entry, fingerprint


def _classification(entry):
    raw = _private_file(entry['classification_file'], POLICY_MAX, 'classification')
    value = _decode(raw, 'classification')
    if (not isinstance(value, dict) or set(value) != {
            'schema_version', 'database', 'commercial_mode', 'entitlement_source',
            'expected_valid_until', 'valid_until_action'}
            or value['schema_version'] != 1 or value['database'] != entry['database']
            or value['commercial_mode'] not in ('non_saas', 'saas')
            or value['entitlement_source'] != {
                'non_saas': 'local_policy', 'saas': 'control_plane'}[value['commercial_mode']]
            or value['expected_valid_until'] is not None
            or value['valid_until_action'] != 'preserve'):
        _fail(4, 'classification_conflict', 'classification',
              'scratch classification must explicitly name this database and source')
    return raw


def _policy(path, *, create=False):
    raw = _private_file(path, POLICY_MAX, 'policy')
    value = _decode(raw, 'policy')
    expected_keys = {'schema_version', 'channel', 'features'} | ({'modules'} if create else set())
    if (not isinstance(value, dict) or set(value) != expected_keys
            or type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['channel'] not in ('local_policy', 'control_plane')
            or not isinstance(value['features'], dict)
            or len(value['features']) > 256):
        _fail(2, 'invalid_input', 'policy', 'local entitlement policy requires features only')
    for key, item in value['features'].items():
        if (not FEATURE_KEY.fullmatch(key) or type(item) not in (bool, int, type(None))
                or (type(item) is int and (item < 0 or item > 1000000000))):
            _fail(2, 'invalid_input', 'policy', 'policy contains an invalid feature value')
    if create:
        _catalog_composition(value)
    return raw


def _catalog_composition(policy):
    try:
        catalog = json.loads(CATALOG_PATH.read_bytes())
        base = catalog['base_modules']
        core = next(tier for tier in catalog['tiers'] if tier['id'] == 'core')
        modules = policy['modules']
        if (isinstance(modules, list) and all(isinstance(item, str) for item in modules)
                and len(set(modules)) == len(modules)):
            for tier in catalog['tiers']:
                candidate = base + tier['modules']
                if modules != candidate:
                    continue
                expected = {}
                for descriptor in core['features'] + ([] if tier['id'] == 'core' else tier['features']):
                    kind, key = descriptor.split(':', 1)
                    expected[key] = True if kind == 'boolean' else None
                if policy['features'] == expected:
                    return modules
    except (OSError, ValueError, KeyError, StopIteration, TypeError):
        pass
    return _fail(2, 'invalid_input', 'policy',
                 'create policy must match a published module and feature composition')


def _env(entry, **extra):
    result = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG', 'PGPASSWORD', 'PGPASSFILE')
              if key in os.environ}
    result.update({'PGHOST': entry['pg_host'], 'PGPORT': str(entry['pg_port']),
                   'PGUSER': entry['pg_user'], 'PYTHONDONTWRITEBYTECODE': '1'})
    result.update(extra)
    return result


def _subprocess(argv, env=None, stdin_text=None):
    # Odoo can be verbose; file capture keeps child output out of operator logs
    # and bounds the amount read into memory. Timeouts are failures, never success.
    with tempfile.TemporaryFile(mode='w+t', encoding='utf-8') as out:
        try:
            done = subprocess.run(argv, input=stdin_text, text=True, stdout=out,
                                  stderr=subprocess.DEVNULL, env=env, shell=False,
                                  check=False, timeout=1800)
        except (OSError, subprocess.TimeoutExpired):
            return 124, '', ''
        out.seek(0, os.SEEK_END)
        out.seek(max(0, out.tell() - 65536))
        return done.returncode, out.read(), ''


def _run(runner, argv, entry, stdin_text=None, **extra):
    try:
        code, out, _err = runner(argv, _env(entry, **extra), stdin_text)
    except (OSError, subprocess.TimeoutExpired):
        return 124, ''
    return code, out


def _psql(runner, entry, database, sql):
    argv = [entry['psql'], '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-F', '\x1f',
            '-h', entry['pg_host'], '-p', str(entry['pg_port']), '-U', entry['pg_user'],
            '-d', database, '-c', sql]
    code, out = _run(runner, argv, entry)
    if code != 0 or len(out) > 65536:
        _fail(5, 'operation_failed', 'database', 'database query failed')
    return [line.split('\x1f') for line in out.splitlines() if line.strip()]


def _profile(runner, entry):
    rows = _psql(runner, entry, entry['database'], PROFILE_SQL)
    if len(rows) != 1 or len(rows[0]) != 6:
        _fail(6, 'profile_missing', 'snapshot', 'classified tenant profile is missing')
    try:
        return dict(zip(('commercial_mode', 'entitlement_source', 'valid_until',
                         'policy_revision', 'quota_revision', 'status'),
                        (rows[0][0], rows[0][1], rows[0][2] or None,
                         int(rows[0][3]), int(rows[0][4]), rows[0][5])))
    except ValueError:
        _fail(6, 'profile_invalid', 'snapshot', 'tenant profile revisions are invalid')


def _feature_snapshot(runner, entry):
    rows = _psql(runner, entry, entry['database'],
                 "SELECT features::text FROM webvue_tenant_profile WHERE singleton_key = 'tenant'")
    try:
        values = json.loads(rows[0][0]) if len(rows) == 1 else None
        catalog = json.loads(CATALOG_PATH.read_bytes())
        allowed = {}
        for tier in catalog['tiers']:
            for descriptor in tier['features']:
                kind, key = descriptor.split(':')[:2]
                allowed[key] = kind
        if not isinstance(values, dict):
            _fail(6, 'profile_invalid', 'snapshot', 'tenant feature snapshot is invalid')
        visible = {}
        for key, value in values.items():
            kind = allowed.get(key)
            if kind is None:
                continue
            if (kind == 'boolean' and type(value) is bool) or (kind == 'limit' and (value is None or (type(value) is int and value >= 0))):
                visible[key] = value
            else:
                _fail(6, 'profile_invalid', 'snapshot', 'tenant feature snapshot is invalid')
        return visible
    except (OSError, ValueError, IndexError, KeyError, TypeError):
        _fail(6, 'profile_invalid', 'snapshot', 'tenant feature snapshot is invalid')


def _count(runner, entry, sql):
    rows = _psql(runner, entry, entry['database'], sql)
    try:
        return int(rows[0][0]) if len(rows) == 1 and len(rows[0]) == 1 else -1
    except ValueError:
        return -1


def _state():
    path = os.environ.get(STATE_ENV)
    if not path:
        _fail(2, 'invalid_input', 'journal', f'{STATE_ENV} is required')
    try:
        return journal.OperationJournal(path)
    except (OSError, journal.JournalUnsafe):
        _fail(3, 'forbidden', 'journal', 'private operation state is unavailable')


def _save_input(store, operation_id, name, raw):
    directory = store.root / 'inputs'
    directory.mkdir(mode=0o700, exist_ok=True)
    destination = directory / f'{operation_id}-{name}.json'
    if destination.exists():
        if destination.read_bytes() != raw:
            msg = 'operation input changed during execution'
            raise RuntimeError(msg)
        return destination
    with destination.open('xb') as stream:
        os.chmod(destination, 0o600)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    return destination


def _config(store, operation_id, entry):
    path = store.root / 'inputs' / f'{operation_id}-odoo.conf'
    content = ('[options]\n'
               f"addons_path = {','.join(entry['addons_paths'])}\n"
               f"data_dir = {entry['data_dir']}\n"
               f"db_host = {entry['pg_host']}\n"
               f"db_port = {entry['pg_port']}\n"
               f"db_user = {entry['pg_user']}\n"
               'workers = 0\nmax_cron_threads = 0\nlist_db = False\n')
    path.parent.mkdir(mode=0o700, exist_ok=True)
    if path.exists():
        if path.read_text(encoding='utf-8') != content:
            msg = 'operation config changed during execution'
            raise RuntimeError(msg)
        return path
    with path.open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    return path


def _odoo_argv(entry, config, database, mode, modules=None):
    argv = [entry['python'], entry['odoo_bin'], '-c', str(config), '-d', database,
            '--db_host=' + entry['pg_host'], '--db_port=' + str(entry['pg_port']),
            '--db_user=' + entry['pg_user'], '--addons-path=' + ','.join(entry['addons_paths']),
            '--data-dir=' + entry['data_dir'], '--db-filter=^' + database + '$',
            '--no-http', '--workers=0', '--max-cron-threads=0']
    if mode == 'shell':
        argv.insert(2, 'shell')
    else:
        argv.extend(['-' + mode, ','.join(modules), '--stop-after-init', '--without-demo=all'])
    return argv


def _marker(out):
    for line in reversed(out.splitlines()):
        if line.startswith(RESULT_MARKER):
            try:
                value = json.loads(line[len(RESULT_MARKER):])
            except ValueError:
                break
            if isinstance(value, dict):
                return value
    return None


def _entitle(fields, entry, fingerprint, runner, store):
    policy_raw, classification_raw = _policy(fields['policy_file']), _classification(entry)
    channel = _decode(policy_raw, 'policy')['channel']
    classification = _decode(classification_raw, 'classification')
    if channel != classification['entitlement_source']:
        _fail(4, 'classification_conflict', 'classification',
              'policy channel does not match the trusted installation classification')
    digest = journal.payload_digest(fields, [policy_raw, classification_raw], fingerprint)

    def action(operation_id):
        profile = _profile(runner, entry)
        if (profile['commercial_mode'], profile['entitlement_source']) != (
                classification['commercial_mode'], classification['entitlement_source']):
            return _payload(fields, 'conflict', 'classification', changed=False,
                            error={'code': 'conversion_forbidden',
                                   'message': 'Commercial mode is immutable'})
        if profile['policy_revision'] != fields['expected_revision']:
            return _payload(fields, 'conflict', 'preflight', changed=False,
                            error={'code': 'revision_conflict', 'message': 'Policy revision changed'})
        if _count(runner, entry, STUCK_SQL) != 0:
            return _payload(fields, 'needs_intervention', 'preflight', changed=False,
                            error={'code': 'needs_intervention',
                                   'message': 'Module state is not settled'})
        policy_path = _save_input(store, operation_id, 'policy', policy_raw)
        classification_path = _save_input(store, operation_id, 'classification', classification_raw)
        config = _config(store, operation_id, entry)
        argv = _odoo_argv(entry, config, entry['database'], 'shell')
        code, out = _run(runner, argv, entry, ENTITLE_SCRIPT,
                         WEBVUE_OPERATOR_POLICY_FILE=str(policy_path),
                         WEBVUE_COMMERCIAL_CONFIG=str(classification_path),
                         WEBVUE_EXPECTED_REVISION=str(fields['expected_revision']))
        result = _marker(out) if code == 0 else None
        if result and result.get('status') == 'conflict':
            return _payload(fields, 'conflict', 'database_lock', changed=False,
                            error={'code': result.get('error_code', 'revision_conflict'),
                                   'message': 'Policy or classification changed before the row lock'})
        if not result or result.get('status') != 'ok':
            return _payload(fields, 'needs_intervention', 'entitlement_shell', changed=True,
                            error={'code': 'operation_failed',
                                   'message': 'Entitlement outcome requires inspection'})
        return _payload(fields, 'ok', 'entitlement_commit',
                        changed=result.get('changed') is True,
                        policy_revision=result.get('policy_revision'))

    return _execute(store, fields, digest, fingerprint, action)


def _execute(store, fields, digest, fingerprint, action):
    try:
        result = store.execute(fields['target'], fields['operation'], fields['request_id'],
                               digest, fingerprint, action)
    except journal.JournalConflict:
        _fail(4, 'request_conflict', 'journal', 'request id already names a different payload')
    except journal.TargetBusy:
        _fail(4, 'target_busy', 'journal', 'target operation is already running')
    except (OSError, RuntimeError, OperatorFailure, journal.JournalUnsafe):
        _fail(6, 'needs_intervention', 'journal', 'operation outcome requires inspection')
    result.setdefault('schema_version', SCHEMA_VERSION)
    return {'ok': 0, 'conflict': 4, 'needs_intervention': 6}[result['status']], result


def _module_available(entry, module):
    if not IDENTIFIER.fullmatch(module):
        return False
    return any((Path(directory) / module / '__manifest__.py').is_file()
               for directory in entry['addons_paths'])


def _validate_module_closure(entry, modules):
    # Every WebVue dependency must be resolvable; Odoo installs it implicitly,
    # so it need not be listed in the selection.
    for module in modules:
        if not _module_available(entry, module):
            _fail(2, 'invalid_input', 'inventory', 'selected module source is missing')
    try:
        install_closure(entry['addons_paths'], modules)
    except ClosureError:
        _fail(2, 'invalid_input', 'inventory', 'selected modules omit a required WebVue dependency')


def _candidate_backup(entry, runner, operation_id):
    store = Path(entry['data_dir']) / 'filestore' / entry['database']
    if not store.is_dir():
        return None
    destination = Path(entry['backup_root']) / operation_id
    argv = [entry['python'], str(BACKUP_WRAPPER), '--opt-in', 'MANUAL_BACKUP_OPT_IN',
            '--acknowledge-unverified', 'CANDIDATE_BACKUP_UNVERIFIED',
            '--db-name', entry['database'], '--filestore', str(store),
            '--output-dir', str(destination), '--pg-dump', entry['pg_dump'],
            '--pg-host', entry['pg_host'], '--pg-port', str(entry['pg_port']),
            '--pg-user', entry['pg_user']]
    code, _ = _run(runner, argv, entry)
    manifest = destination / 'manifest.json'
    if code != 0 or not manifest.is_file():
        return None
    try:
        value = json.loads(manifest.read_bytes())
    except (OSError, ValueError):
        return None
    if (not isinstance(value, dict) or value.get('db_name') != entry['database']
            or value.get('database_dump') != 'database.dump'
            or value.get('filestore_copy') != 'filestore'
            or value.get('consistency') != 'UNVERIFIED'
            or value.get('recovery_ready') is not False):
        return None
    return destination


def _restore_candidate(entry, runner, backup_dir, operation_id, purpose):
    target_db = 'webvue_scratch_' + purpose + '_' + operation_id[-12:]
    destination = Path(entry['data_dir']) / 'filestore' / target_db
    if destination.exists() or not (backup_dir / 'database.dump').is_file():
        return target_db, False
    argv = [entry['python'], str(RESTORE_WRAPPER), '--backup-dir', str(backup_dir),
            '--target-db', target_db, '--target-filestore', str(destination),
            '--pg-restore', entry['pg_restore'], '--createdb', entry['createdb'],
            '--psql', entry['psql'], '--pg-host', entry['pg_host'],
            '--pg-port', str(entry['pg_port']), '--pg-user', entry['pg_user']]
    code, _ = _run(runner, argv, entry)
    record = backup_dir / 'restore-verification.json'
    if code != 0 or not record.is_file():
        return target_db, False
    try:
        value = json.loads(record.read_bytes())
    except (OSError, ValueError):
        return target_db, False
    return target_db, (value.get('restore_verified') is True
                       and value.get('restored_into') == target_db)


def _apply_policy(fields, entry, runner, store, operation_id, policy_raw,
                  classification_raw, expected_revision):
    policy_path = _save_input(store, operation_id, 'policy', policy_raw)
    classification_path = _save_input(store, operation_id, 'classification', classification_raw)
    config = _config(store, operation_id, entry)
    code, out = _run(
        runner, _odoo_argv(entry, config, entry['database'], 'shell'), entry,
        ENTITLE_SCRIPT, WEBVUE_OPERATOR_POLICY_FILE=str(policy_path),
        WEBVUE_COMMERCIAL_CONFIG=str(classification_path),
        WEBVUE_EXPECTED_REVISION=str(expected_revision),
    )
    return _marker(out) if code == 0 else None


def _other_mutation(fields, entry, fingerprint, runner, store):
    operation = fields['operation']
    classification_raw = _classification(entry)
    files = [classification_raw]
    policy_raw = None
    release = None
    modules = None
    backup_receipt = None
    if operation == 'tenant.create':
        policy_raw = _policy(fields['policy_file'], create=True)
        files.append(policy_raw)
        if _decode(policy_raw, 'policy')['channel'] != _decode(
                classification_raw, 'classification')['entitlement_source']:
            _fail(4, 'classification_conflict', 'classification',
                  'policy channel does not match trusted classification')
        modules = _decode(policy_raw, 'policy')['modules']
        _validate_module_closure(entry, modules)
    elif operation == 'upgrade':
        release = Path(fields['release'])
        root = Path(entry['release_root']).resolve()
        if release.is_symlink() or not release.resolve().is_relative_to(root):
            _fail(3, 'forbidden', 'release', 'release must be within trusted release_root')
        raw = _private_file(release, RELEASE_MAX, 'release')
        value = _decode(raw, 'release')
        if (not isinstance(value, dict) or set(value) != {'schema_version', 'modules'}
                or type(value['schema_version']) is not int or value['schema_version'] != 1
                or not isinstance(value['modules'], list) or not 1 <= len(value['modules']) <= 32
                or not all(isinstance(m, str) for m in value['modules'])
                or len(set(value['modules'])) != len(value['modules'])
                or not all(_module_available(entry, m) for m in value['modules'])):
            _fail(2, 'invalid_input', 'release', 'release modules are not approved local addons')
        modules = value['modules']
        files.append(raw)
    elif operation == 'restore':
        try:
            backup_receipt = store.find_operation(fields['target'], fields['backup_id'])
        except journal.TargetBusy:
            _fail(4, 'target_busy', 'journal', 'target operation is still running')
        if (not backup_receipt or backup_receipt.get('operation') != 'backup'
                or backup_receipt.get('status') != 'ok'
                or backup_receipt.get('consistency') != 'UNVERIFIED'):
            _fail(4, 'backup_conflict', 'backup', 'backup receipt is not a candidate for this target')
    digest = journal.payload_digest(fields, files, fingerprint)

    def action(operation_id):
        if operation == 'tenant.create':
            database = entry['database']
            existing = _psql(runner, entry, 'postgres',
                             "SELECT 1 FROM pg_database WHERE datname = '" + database + "'")
            filestore = Path(entry['data_dir']) / 'filestore' / database
            if existing or filestore.exists():
                return _payload(fields, 'conflict', 'create_preflight', changed=False,
                                error={'code': 'target_exists',
                                       'message': 'Scratch database or filestore already exists'})
            argv = [entry['createdb'], '-h', entry['pg_host'], '-p', str(entry['pg_port']),
                    '-U', entry['pg_user'], '-E', 'UTF8', '--template=template0', database]
            code, _ = _run(runner, argv, entry)
            if code != 0:
                return _payload(fields, 'needs_intervention', 'database_create', changed=True,
                                error={'code': 'operation_failed',
                                       'message': 'Scratch database creation outcome is uncertain'})
            classification_path = _save_input(store, operation_id, 'classification', classification_raw)
            config = _config(store, operation_id, entry)
            code, _ = _run(runner, _odoo_argv(entry, config, database, 'i', modules),
                           entry, WEBVUE_COMMERCIAL_CONFIG=str(classification_path))
            if code != 0:
                return _payload(fields, 'needs_intervention', 'module_install', changed=True,
                                error={'code': 'operation_failed',
                                       'message': 'Scratch module installation requires inspection'})
            profile = _profile(runner, entry)
            result = _apply_policy(fields, entry, runner, store, operation_id,
                                   policy_raw, classification_raw, profile['policy_revision'])
            if not result or result.get('status') != 'ok':
                return _payload(fields, 'needs_intervention', 'initial_policy', changed=True,
                                error={'code': 'operation_failed',
                                       'message': 'Initial entitlement outcome requires inspection'})
            if _count(runner, entry, STUCK_SQL) != 0:
                return _payload(fields, 'needs_intervention', 'health', changed=True,
                                error={'code': 'health_failed',
                                       'message': 'Scratch installation health is unresolved'})
            features = _psql(runner, entry, database,
                             "SELECT features::text FROM webvue_tenant_profile WHERE singleton_key = 'tenant'")
            try:
                actual_features = json.loads(features[0][0]) if len(features) == 1 else None
            except (ValueError, IndexError):
                actual_features = None
            if (type(actual_features) is not dict
                    or not _features_match(actual_features, _decode(policy_raw, 'policy')['features'])):
                return _payload(fields, 'needs_intervention', 'policy_verification', changed=True,
                                error={'code': 'policy_mismatch',
                                       'message': 'Installed feature policy does not match the approved composition'})
            module_names = ','.join("'" + name + "'" for name in modules)
            installed_rows = _psql(runner, entry, database,
                                   'SELECT name FROM ir_module_module WHERE name IN ('
                                   + module_names + ") AND state = 'installed'")
            installed = {row[0] for row in installed_rows if len(row) == 1}
            if installed != set(modules):
                return _payload(fields, 'needs_intervention', 'module_verification', changed=True,
                                error={'code': 'modules_missing',
                                       'message': 'Selected local modules were not all installed'})
            return _payload(fields, 'ok', 'health_verified', changed=True,
                            policy_revision=result.get('policy_revision'),
                            database=database, installed_modules=modules,
                            commercial_mode=_decode(classification_raw, 'classification')['commercial_mode'],
                            entitlement_source=_decode(classification_raw, 'classification')['entitlement_source'],
                            policy_verified=True, deployment_ready=False)

        if operation == 'backup':
            destination = _candidate_backup(entry, runner, operation_id)
            if destination is None:
                return _payload(fields, 'needs_intervention', 'backup_capture', changed=True,
                                error={'code': 'backup_failed',
                                       'message': 'Candidate backup outcome requires inspection'})
            return _payload(fields, 'ok', 'candidate_backup', changed=True,
                            backup_id=operation_id, backup_dir=str(destination),
                            consistency='UNVERIFIED', recovery_ready=False)

        if operation == 'restore':
            backup_dir = Path(entry['backup_root']) / fields['backup_id']
            target_db, verified = _restore_candidate(entry, runner, backup_dir,
                                                      operation_id, 'restore')
            if not verified:
                return _payload(fields, 'needs_intervention', 'restore_verification', changed=True,
                                restored_into=target_db,
                                error={'code': 'restore_failed',
                                       'message': 'Scratch restore requires inspection'})
            return _payload(fields, 'ok', 'restore_verified', changed=True,
                            backup_id=fields['backup_id'], approval_id=fields['approval_id'],
                            restored_into=target_db, restore_verified=True,
                            capture_consistency='UNVERIFIED')

        if _count(runner, entry, SESSIONS_SQL) != 0 or _count(runner, entry, STUCK_SQL) != 0:
            return _payload(fields, 'needs_intervention', 'upgrade_preflight', changed=False,
                            error={'code': 'quiescence_unverified',
                                   'message': 'Scratch target has active sessions or pending modules'})
        backup_dir = _candidate_backup(entry, runner, operation_id)
        if backup_dir is None:
            return _payload(fields, 'needs_intervention', 'candidate_backup', changed=True,
                            error={'code': 'backup_failed',
                                   'message': 'Candidate backup failed before upgrade'})
        config = _config(store, operation_id, entry)
        classification_path = _save_input(store, operation_id, 'classification', classification_raw)
        code, _ = _run(runner, _odoo_argv(entry, config, entry['database'], 'u', modules),
                       entry, WEBVUE_COMMERCIAL_CONFIG=str(classification_path))
        profile = None
        healthy = False
        if code == 0:
            try:
                profile = _profile(runner, entry)
                classification = _decode(classification_raw, 'classification')
                module_names = ','.join("'" + name + "'" for name in modules)
                installed_rows = _psql(
                    runner, entry, entry['database'],
                    'SELECT name FROM ir_module_module WHERE name IN ('
                    + module_names + ") AND state = 'installed'",
                )
                installed = {row[0] for row in installed_rows if len(row) == 1}
                healthy = (_count(runner, entry, STUCK_SQL) == 0
                           and installed == set(modules)
                           and profile['commercial_mode'] == classification['commercial_mode']
                           and profile['entitlement_source'] == classification['entitlement_source'])
            except OperatorFailure:
                healthy = False
        if not healthy:
            rollback_db, verified = _restore_candidate(entry, runner, backup_dir,
                                                        operation_id, 'rollback')
            return _payload(fields, 'needs_intervention', 'upgrade_restore_verification',
                            changed=True, candidate_backup_id=operation_id,
                            rollback_destination=rollback_db,
                            rollback_restore_verified=verified,
                            original_target_recovered=False,
                            rollback_capture_consistency='UNVERIFIED',
                            recovery_ready=False,
                            error={'code': 'upgrade_failed',
                                   'message': 'Original target requires inspection; isolated rollback copy is separate'})
        return _payload(fields, 'ok', 'module_upgrade_verified', changed=True,
                        candidate_backup_id=operation_id,
                        backup_consistency='UNVERIFIED', recovery_ready=False,
                        release_modules=modules, profile=profile,
                        application_health_verified=False,
                        deployment_ready=False)

    return _execute(store, fields, digest, fingerprint, action)


def _dispatch(fields, runner):
    entry, fingerprint = _inventory(fields['target'])
    operation = fields['operation']
    if operation == 'tenant.inspect':
        profile = _profile(runner, entry)
        profile['features'] = _feature_snapshot(runner, entry)
        return 0, _payload(fields, 'ok', 'snapshot', profile=profile)
    if operation == 'health':
        profile = _profile(runner, entry)
        stuck = _count(runner, entry, STUCK_SQL)
        if stuck != 0:
            _fail(6, 'needs_intervention', 'health', 'module state is not settled')
        return 0, _payload(fields, 'ok', 'health', profile=profile, stuck_modules=0)
    if operation == 'tenant.preflight':
        policy = _policy(fields['policy_file'])
        _classification(entry)
        profile = _profile(runner, entry)
        return 0, _payload(fields, 'validated_input', 'preflight',
                           profile=profile, policy_digest=hashlib.sha256(policy).hexdigest(),
                           execution_ready=False)
    store = _state()
    if operation == 'status':
        try:
            receipt = store.inspect(fields['target'], fields['request_id'])
        except journal.TargetBusy:
            _fail(4, 'target_busy', 'journal', 'target operation is still running')
        if receipt is None:
            _fail(2, 'invalid_input', 'journal', 'request receipt does not exist')
        receipt.setdefault('schema_version', SCHEMA_VERSION)
        return {'ok': 0, 'conflict': 4, 'needs_intervention': 6}[receipt['status']], receipt
    if operation == 'tenant.entitle':
        return _entitle(fields, entry, fingerprint, runner, store)
    if operation in ('tenant.create', 'backup', 'restore', 'upgrade'):
        return _other_mutation(fields, entry, fingerprint, runner, store)
    return _fail(2, 'invalid_input', 'operator', 'unknown operation')


def operation_adapter(fields, *, runner=None):
    try:
        return _dispatch(fields, runner or _subprocess)
    except OperatorFailure as error:
        return error.exit_code, _payload(
            fields, 'needs_intervention' if error.exit_code == 6 else 'error',
            error.stage, error={'code': error.code, 'message': error.message})


def main(argv=None):
    return cli_main(argv, adapter=operation_adapter)


if __name__ == '__main__':
    sys.exit(main())
