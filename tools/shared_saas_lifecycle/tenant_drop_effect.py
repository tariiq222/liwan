# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Final deletion of one tenant's workspace: separate, idempotent, individually callable stages.

JSON on stdin and stdout like the other effects; a mutating stage asks the control plane for a permit
(`odoo_effect.permit`) before its first change. The control plane never lets this process derive a target:
every name comes from `plan`, and the plan is refused unless `planDigest` equals the SHA-256 of its canonical
JSON (sorted keys, no whitespace, non-ASCII kept as UTF-8; the plan holds strings, integers, booleans and
lists only).

Each stage observes first, treats "already absent" as done, acts, observes again and returns evidence made of
states and counts. Nothing returned or logged holds a secret, a file name below a removed root or file content.
`dryRun: true` runs every check of a stage, reports what it would do and changes nothing.

The reservation files under `<stateDir>/reservations/` are never touched: they are the tombstone that keeps the
name from being reused. See docs/operations/tenant-deletion-effects.md for the stage contracts.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import unicodedata

from tools.shared_saas_lifecycle import tenant_drop_files as files
from tools.shared_saas_lifecycle.odoo_effect import (
    EffectError, MAX_OUTPUT, TENANT_DB_ROLE, TENANT_MARKER_PARAMETER, no_symlink, permit, validate_host,
)

STAGES = ('verify', 'stamp_marker', 'drop_database', 'remove_filestore', 'remove_restore_copies', 'purge_local_backups', 'remove_side_files')
MUTATING_STAGES = frozenset(STAGES) - {'verify'}

DATABASE_IDENTIFIER = re.compile(r'^[a-z][a-z0-9_]{0,62}$')
TENANT_ID = re.compile(r'^[a-z][a-z0-9_-]{0,62}$')
RESTORE_COPY = re.compile(r'^liwan_scratch_[a-f0-9]{32}$')
TENANT_SCRATCH = re.compile(r'^liwan_scratch_')
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
SHA256 = re.compile(r'^[a-f0-9]{64}$')
LIVE_SEGMENT = re.compile(r'(?:^|_)(odoo19|production|prod|postgres|template0|template1)(?:_|$)')
BLOCKED_DATABASES = frozenset({'postgres', 'template0', 'template1', 'odoo19', 'production', 'liwan_dev', 'liwan_ai'})

PLAN_KEYS = frozenset({'schemaVersion', 'requestId', 'controlTenantId', 'tenantId', 'database', 'filestore', 'host',
                       'customerName', 'controlPlaneDatabase', 'restoreCopies', 'backupIds'})
CONFIG_KEYS = frozenset({'schemaVersion', 'projectName', 'composeFile', 'envFile', 'stateDir', 'domainSuffix'})
OPTIONAL_CONFIG_KEYS = frozenset({'aiEgressDir', 'releaseBackupConfig'})
SERVICES = {'tenant': ('db', 'odoo'), 'restore': ('restore-db', 'restore-odoo')}
FENCE_WAIT_SECONDS = 30

# Non-secret refusal codes that may cross the boundary; anything else is reported as `tenant_drop_failed`.
ERROR_CODES = frozenset({
    'input_invalid', 'runtime_invalid', 'plan_invalid', 'plan_digest_mismatch', 'operation_unavailable',
    'database_name_invalid', 'database_filestore_mismatch', 'database_blocklisted', 'database_is_scratch_copy',
    'database_is_control_plane', 'host_invalid',
    'identity_query_failed', 'identity_base_url_mismatch', 'identity_base_url_not_frozen', 'identity_profile_count',
    'identity_profile_mode', 'identity_company_mismatch', 'identity_marker_missing', 'identity_marker_mismatch',
    'restore_target_invalid', 'backup_id_invalid', 'database_missing', 'database_fence_unproven',
    'restore_copy_unreadable', 'restore_copy_marker_missing', 'restore_copy_marker_mismatch',
    'database_command_failed', 'database_fence_failed', 'database_drop_failed', 'database_still_present',
    'files_command_failed', 'files_still_present',
    'path_invalid', 'path_symlink', 'name_invalid', 'filestore_ambiguous', 'remove_failed',
    'authority_lost', 'release_operation_blocked',
})


def canonical_plan_digest(plan):
    text = json.dumps(plan, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _is_plain_list(value):
    return isinstance(value, list) and len(set(value)) == len(value) and all(isinstance(item, str) for item in value)


def validate_plan(plan, digest, config):
    """The plan as the control plane sealed it, or an `EffectError`; checks shape, digest and every name."""
    if not isinstance(digest, str) or not SHA256.fullmatch(digest):
        raise EffectError('plan_invalid')
    if not isinstance(plan, dict) or set(plan) != PLAN_KEYS or plan['schemaVersion'] != 1:
        raise EffectError('plan_invalid')
    try:
        actual = canonical_plan_digest(plan)
    except (TypeError, ValueError):
        raise EffectError('plan_invalid') from None
    if actual != digest:
        raise EffectError('plan_digest_mismatch')
    strings = ('requestId', 'controlTenantId', 'tenantId', 'database', 'filestore', 'host', 'customerName', 'controlPlaneDatabase')
    if not all(isinstance(plan[key], str) for key in strings):
        raise EffectError('plan_invalid')
    if not UUID.fullmatch(plan['requestId']) or not UUID.fullmatch(plan['controlTenantId']) or not TENANT_ID.fullmatch(plan['tenantId']):
        raise EffectError('plan_invalid')
    if not plan['customerName'].strip() or len(plan['customerName']) > 200:
        raise EffectError('plan_invalid')
    if not DATABASE_IDENTIFIER.fullmatch(plan['controlPlaneDatabase']):
        raise EffectError('plan_invalid')
    try:
        validate_host(plan['host'], config['domainSuffix'])
    except EffectError:
        raise EffectError('host_invalid') from None
    if not _is_plain_list(plan['restoreCopies']) or not _is_plain_list(plan['backupIds']):
        raise EffectError('plan_invalid')
    if not all(RESTORE_COPY.fullmatch(name) for name in plan['restoreCopies']):
        raise EffectError('restore_target_invalid')
    if not all(UUID.fullmatch(name) for name in plan['backupIds']):
        raise EffectError('backup_id_invalid')
    return plan


def validate_tenant_database(plan):
    """The name guards of a TENANT drop. Nothing about the database content is read here."""
    database = plan['database']
    if not DATABASE_IDENTIFIER.fullmatch(database) or not DATABASE_IDENTIFIER.fullmatch(plan['filestore']):
        raise EffectError('database_name_invalid')
    if database != plan['filestore']:
        raise EffectError('database_filestore_mismatch')
    control = plan['controlPlaneDatabase']
    if database == control or database.startswith(control + '_') or database.endswith('_' + control) or ('_' + control + '_') in database:
        raise EffectError('database_is_control_plane')
    if database in BLOCKED_DATABASES or LIVE_SEGMENT.search(database):
        raise EffectError('database_blocklisted')
    if TENANT_SCRATCH.match(database):
        raise EffectError('database_is_scratch_copy')
    return database


def validate_restore_copy(name):
    """The name guard of a restore-copy removal: the opposite rule of the tenant drop."""
    if not isinstance(name, str) or not RESTORE_COPY.fullmatch(name):
        raise EffectError('restore_target_invalid')
    return name


def nfc(value):
    return unicodedata.normalize('NFC', value)


IDENTITY_SQL = (
    "SELECT json_build_object("
    "'params', COALESCE((SELECT json_object_agg(key, value) FROM ir_config_parameter WHERE key IN "
    "('web.base.url', 'web.base.url.freeze', '" + TENANT_MARKER_PARAMETER + "')), '{}'::json), "
    "'profileCount', (SELECT count(*) FROM liwan_tenant_profile), "
    "'profiles', COALESCE((SELECT json_agg(json_build_object('mode', p.commercial_mode, 'source', p.entitlement_source, 'company', c.name)) "
    "FROM liwan_tenant_profile p LEFT JOIN res_company c ON c.id = p.root_company_id), '[]'::json))::text"
)


def evaluate_identity(snapshot, plan):
    """Facts read back from the tenant database, and the first refusal code they imply (or None).

    The marker is the strong identity. The company name is a reported fact: it only decides when the marker is
    absent and a marker is being stamped (`require_company`, see `stamp_marker`); a company renamed inside the
    tenant, or a commercial name that differs from the provisioning name, never blocks a deletion whose marker matches.
    """
    params = snapshot['params']
    profiles = snapshot['profiles']
    single = snapshot['profileCount'] == 1 and len(profiles) == 1
    profile = profiles[0] if single else None
    marker = params.get(TENANT_MARKER_PARAMETER)
    checks = {
        'baseUrl': params.get('web.base.url') == 'https://' + plan['host'],
        'baseUrlFrozen': params.get('web.base.url.freeze') == 'True',
        'profileCount': snapshot['profileCount'],
        'profile': bool(profile and profile['mode'] == 'saas' and profile['source'] == 'control_plane'),
        'company': bool(profile and isinstance(profile['company'], str) and nfc(profile['company']) == nfc(plan['customerName'])),
        'marker': 'missing' if marker is None else 'match' if marker == plan['controlTenantId'] else 'mismatch',
    }
    if not checks['baseUrl']:
        code = 'identity_base_url_mismatch'
    elif not checks['baseUrlFrozen']:
        code = 'identity_base_url_not_frozen'
    elif not single:
        code = 'identity_profile_count'
    elif not checks['profile']:
        code = 'identity_profile_mode'
    elif checks['marker'] == 'missing':
        code = 'identity_marker_missing'
    elif checks['marker'] == 'mismatch':
        code = 'identity_marker_mismatch'
    else:
        code = None
    return code, checks


MARKER_SQL = 'SELECT value FROM ir_config_parameter WHERE key = ' + "'" + TENANT_MARKER_PARAMETER + "'"


class Backend:
    """What the stages need from the runtime: SQL by service and the container-side file operation.

    `psql(service, database, sql)` returns stdout of a single-line-per-row, unaligned, tuples-only run and
    raises `database_command_failed`; `filestore(service, payload)` runs `tenant_drop_files.run` where the
    files live and returns its evidence.
    """

    def psql(self, service, database, sql):
        raise NotImplementedError

    def data_dir(self, service):
        """The Odoo data directory the file operation of this service runs in."""
        raise NotImplementedError

    def filestore(self, service, payload):
        raise NotImplementedError


PSQL_FLAGS = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']


def _run(args, stdin, timeout, error_code):
    try:
        done = subprocess.run(args, input=stdin.encode('utf-8'), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise EffectError(error_code) from None
    if done.returncode != 0 or len(done.stdout) > MAX_OUTPUT:
        raise EffectError(error_code)
    return done.stdout.decode('utf-8')


def _parse_files_output(output):
    try:
        value = json.loads(output)
    except ValueError:
        raise EffectError('files_command_failed') from None
    if not isinstance(value, dict):
        raise EffectError('files_command_failed')
    if set(value) == {'refused'}:
        code = value['refused']
        raise EffectError(code if code in ERROR_CODES else 'files_command_failed')
    return value


class ComposeBackend(Backend):
    """The shared Compose project: `docker compose exec` into db/restore-db and odoo/restore-odoo."""

    def __init__(self, config, data_dir=files.CONTAINER_DATA_DIR):
        self._data_dir = data_dir
        self.base = ['docker', 'compose', '--project-name', config['projectName'], '--env-file', config['envFile'],
                     '--file', config['composeFile'], '--profile', 'restore']

    def psql(self, service, database, sql):
        args = self.base + ['exec', '-T', '-e', 'PGCLIENTENCODING=UTF8', service, 'psql', '-U', TENANT_DB_ROLE, '-d', database] + PSQL_FLAGS
        return _run(args, sql, 180, 'database_command_failed')

    def data_dir(self, service):
        return self._data_dir

    def filestore(self, service, payload):
        source = Path(files.__file__).read_text(encoding='utf-8')
        args = self.base + ['exec', '-T', service, '/opt/venv/bin/python', '-c', source]
        return _parse_files_output(_run(args, json.dumps(payload), 300, 'files_command_failed'))


class LocalBackend(Backend):
    """A server and data directories reachable from this process (tests, and an operator running on the host)."""

    def __init__(self, psql_argv, data_dirs):
        self.psql_argv, self.data_dirs = psql_argv, data_dirs

    def psql(self, service, database, sql):
        return _run(list(self.psql_argv[service]) + ['-d', database] + PSQL_FLAGS, "SET client_encoding TO 'UTF8';\n" + sql, 180, 'database_command_failed')

    def data_dir(self, service):
        return str(self.data_dirs[service])

    def filestore(self, service, payload):
        return _parse_files_output(json.dumps(files.run(payload)))


def quote_literal(value):
    if not isinstance(value, str) or '\x00' in value:
        raise EffectError('input_invalid')
    return "'" + value.replace("'", "''") + "'"


def quote_identifier(value):
    if not isinstance(value, str) or not DATABASE_IDENTIFIER.fullmatch(value):
        raise EffectError('database_name_invalid')
    return '"' + value + '"'


class TenantDrop:
    """The six stages over one validated plan. `permit_fn` and `clock` are seams for tests."""

    def __init__(self, request, backend, permit_fn=permit, sleep=time.sleep):
        self.request = request
        config = request['config']
        self.config = config
        self.plan = validate_plan(request.get('plan'), request.get('planDigest'), config)
        self.dry_run = request.get('dryRun', False)
        if type(self.dry_run) is not bool:
            raise EffectError('input_invalid')
        self.backend, self.permit, self.sleep = backend, permit_fn, sleep
        self._permitted = set()
        self.state_dir = Path(config['stateDir'])
        self.ai_egress_dir = Path(config['aiEgressDir']) if config.get('aiEgressDir') else None

    # ---- shared helpers -------------------------------------------------------------------------------

    def _permit(self, stage):
        """One permit per mutating stage, asked before its first change and never for a dry run."""
        if not self.dry_run and stage not in self._permitted:
            self.permit(stage)
            self._permitted.add(stage)

    def _database_state(self, service, database):
        """None when absent, else `{allow, stamp}` read from the maintenance database (works while fenced)."""
        sql = ("SELECT datallowconn::text || '|' || COALESCE(shobj_description(oid, 'pg_database'), '') "
               'FROM pg_database WHERE datname = ' + quote_literal(database))
        value = self.backend.psql(service, 'postgres', sql).strip('\n')
        if not value:
            return None
        allow, _, stamp = value.partition('|')
        if allow not in ('true', 'false'):
            raise EffectError('database_command_failed')
        return {'allow': allow == 'true', 'stamp': stamp}

    def _exists(self, service, database):
        return self._database_state(service, database) is not None

    @property
    def stamp(self):
        """Readable from outside the database: this request and this exact plan."""
        return f"liwan-drop {self.plan['requestId']} {self.request['planDigest']}"

    def _sessions(self, service, database):
        sql = 'SELECT count(*) FROM pg_stat_activity WHERE datname = ' + quote_literal(database) + ' AND pid <> pg_backend_pid()'
        value = self.backend.psql(service, 'postgres', sql).strip()
        if not value.isdigit():
            raise EffectError('database_command_failed')
        return int(value)

    def _read_identity(self, database):
        try:
            snapshot = json.loads(self.backend.psql('db', database, IDENTITY_SQL))
            if not isinstance(snapshot, dict) or set(snapshot) != {'params', 'profileCount', 'profiles'}:
                raise ValueError()
            if not isinstance(snapshot['params'], dict) or type(snapshot['profileCount']) is not int:
                raise ValueError()
            if not isinstance(snapshot['profiles'], list) or not all(isinstance(row, dict) and set(row) == {'mode', 'source', 'company'} for row in snapshot['profiles']):
                raise ValueError()
        except EffectError:
            raise EffectError('identity_query_failed') from None
        except (ValueError, TypeError):
            raise EffectError('identity_query_failed') from None
        return snapshot

    def _drop_database(self, service, database):
        """Observe, drop with FORCE, observe again. Returns the evidence of one database."""
        if not self._exists(service, database):
            return {'state': 'absent', 'sessionsTerminated': 0}
        sessions = self._sessions(service, database)
        if self.dry_run:
            return {'state': 'would_drop', 'sessionsTerminated': sessions}
        try:
            self.backend.psql(service, 'postgres', f'DROP DATABASE {quote_identifier(database)} WITH (FORCE)')
        except EffectError:
            raise EffectError('database_drop_failed') from None
        if self._exists(service, database):
            raise EffectError('database_still_present')
        return {'state': 'dropped', 'sessionsTerminated': sessions}

    def _fence(self, service, database, quoted):
        """Close the database to new sessions the way tenant provisioning closes it, then end the open ones."""
        statements = (
            f'REVOKE CONNECT ON DATABASE {quoted} FROM PUBLIC',
            f'REVOKE CONNECT ON DATABASE {quoted} FROM {quote_identifier(TENANT_DB_ROLE)}',
            f'ALTER DATABASE {quoted} WITH ALLOW_CONNECTIONS false',
            'SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = ' + quote_literal(database) + ' AND pid <> pg_backend_pid()',
        )
        try:
            self.backend.psql(service, 'postgres', ';\n'.join(statements))
        except EffectError:
            raise EffectError('database_fence_failed') from None
        deadline = time.monotonic() + FENCE_WAIT_SECONDS
        while self._sessions(service, database):
            if time.monotonic() >= deadline:
                raise EffectError('database_fence_failed')
            self.sleep(0.2)

    def _files(self, service, name, dry_run):
        payload = files.filestore_payload(self.backend.data_dir(service), name, self.plan['requestId'], dry_run)
        return self.backend.filestore(service, payload)

    def _remove_filestore(self, service, name, stage):
        """Observe (dry), permit, rename and remove, observe again. The same call serves a dry run."""
        seen = self._files(service, name, dry_run=True)
        if seen['state'] == 'absent' or self.dry_run:
            return seen
        self._permit(stage)
        done = self._files(service, name, dry_run=False)
        if self._files(service, name, dry_run=True)['state'] != 'absent':
            raise EffectError('files_still_present')
        return done

    def _remove_tree(self, parent, name, pattern, stage):
        if not self._directory_present(parent):
            return {'state': 'absent', 'files': 0, 'directories': 0, 'bytes': 0, 'exportFiles': 0}
        args = (parent, name, pattern, self.plan['requestId'])
        seen = self._local(files.remove_tree, *args, True)
        if seen['state'] == 'absent' or self.dry_run:
            return seen
        self._permit(stage)
        done = self._local(files.remove_tree, *args, False)
        if self._local(files.remove_tree, *args, True)['state'] != 'absent':
            raise EffectError('files_still_present')
        return done

    def _remove_file(self, parent, name, stage):
        if not self._directory_present(parent):
            return {'state': 'absent'}
        seen = self._local(files.remove_file, parent, name, True)
        if seen['state'] == 'absent' or self.dry_run:
            return seen
        self._permit(stage)
        done = self._local(files.remove_file, parent, name, False)
        if self._local(files.remove_file, parent, name, True)['state'] != 'absent':
            raise EffectError('files_still_present')
        return done

    @staticmethod
    def _directory_present(path):
        path = Path(path)
        if path.is_symlink():
            raise EffectError('path_symlink')
        return path.exists()

    @staticmethod
    def _local(operation, *args):
        try:
            return operation(*args)
        except files.FileRefused as refusal:
            code = str(refusal)
            raise EffectError(code if code in ERROR_CODES else 'path_invalid') from None
        except OSError:
            raise EffectError('remove_failed') from None

    # ---- stages ---------------------------------------------------------------------------------------

    def _identity(self, database):
        """The first refusal code and the facts of a database that accepts connections."""
        return evaluate_identity(self._read_identity(database), self.plan)

    def _prove_identity(self, database):
        """What is known about the tenant database, or a refusal. Used by `verify` and twice by the drop.

        Returns None when absent, `{'fenced': True}` when a previous run of THIS request and plan fenced it (the
        stamp is readable from the maintenance database, so identity was proven before the fence), else the facts.
        A stamp on a database that still accepts connections never bypasses the identity read.
        """
        state = self._database_state('db', database)
        if state is None:
            return None
        if not state['allow']:
            if state['stamp'] != self.stamp:
                raise EffectError('database_fence_unproven')
            return {'fenced': True}
        code, checks = self._identity(database)
        if code:
            raise EffectError(code)
        return {'fenced': False, 'checks': checks}

    def verify(self):
        """Cheap and read-only: one verdict (`ok`, `refused` or `absent`) with the facts that decided it.

        `ok` means a drop would pass its identity gate now. A refusal is returned, not raised, so a caller can log
        every fact; name and plan errors still raise because nothing can be said about a database then.
        """
        database = validate_tenant_database(self.plan)
        state = self._database_state('db', database)
        if state is None:
            return {'database': database, 'verdict': 'absent'}
        if not state['allow']:
            if state['stamp'] == self.stamp:
                return {'database': database, 'verdict': 'ok', 'fenced': True}
            return {'database': database, 'verdict': 'refused', 'code': 'database_fence_unproven', 'fenced': True}
        code, checks = self._identity(database)
        if code:
            return {'database': database, 'verdict': 'refused', 'code': code, 'fenced': False, 'checks': checks}
        return {'database': database, 'verdict': 'ok', 'fenced': False, 'checks': checks}

    def stamp_marker(self):
        """Backfill the control-tenant marker of an existing tenant that has none. Never overwrites a value.

        The other identity checks must pass first, and here the company name must match too: with no marker it is
        the only link between the database and the customer.
        """
        database = validate_tenant_database(self.plan)
        state = self._database_state('db', database)
        if state is None:
            raise EffectError('database_missing')
        if not state['allow']:
            raise EffectError('database_fence_unproven')
        code, checks = self._identity(database)
        if code not in (None, 'identity_marker_missing'):
            raise EffectError(code)
        if checks['marker'] == 'match':
            return {'database': database, 'state': 'present', 'checks': checks}
        if not checks['company']:
            raise EffectError('identity_company_mismatch')
        if self.dry_run:
            return {'database': database, 'state': 'would_stamp', 'checks': checks}
        self._permit('stamp-marker')
        insert = ('INSERT INTO ir_config_parameter (key, value) VALUES (' + quote_literal(TENANT_MARKER_PARAMETER) + ', '
                  + quote_literal(self.plan['controlTenantId']) + ') ON CONFLICT (key) DO NOTHING')
        self.backend.psql('db', database, insert)
        again_code, again = self._identity(database)
        if again_code or again['marker'] != 'match':
            raise EffectError('identity_marker_mismatch' if again['marker'] == 'mismatch' else again_code or 'identity_query_failed')
        return {'database': database, 'state': 'stamped', 'checks': again}

    def drop_database(self):
        database = validate_tenant_database(self.plan)
        proven = self._prove_identity(database)
        if proven is None:
            return {'database': database, 'state': 'absent', 'sessionsTerminated': 0}
        if self.dry_run:
            return {'database': database, **self._drop_database('db', database)}
        self._permit('drop-database')
        # Authority and database content are both current: prove again after the permit.
        proven = self._prove_identity(database)
        if proven is None:
            return {'database': database, 'state': 'absent', 'sessionsTerminated': 0}
        sessions = self._sessions('db', database)
        if not proven['fenced']:
            self._stamp_database(database)
            self._fence('db', database, quote_identifier(database))
        result = self._drop_database('db', database)
        if result['state'] == 'dropped':
            result['sessionsTerminated'] = max(result['sessionsTerminated'], sessions)
        return {'database': database, **result}

    def _stamp_database(self, database):
        """Written only after a full successful identity check: a fenced database can be resumed without a connection."""
        try:
            self.backend.psql('db', 'postgres', f'COMMENT ON DATABASE {quote_identifier(database)} IS {quote_literal(self.stamp)}')
        except EffectError:
            raise EffectError('database_fence_failed') from None

    def remove_filestore(self):
        database = validate_tenant_database(self.plan)
        if self._exists('db', database):
            if self.dry_run:
                return {'name': database, 'blockedBy': 'database_still_present', **self._files('odoo', database, dry_run=True)}
            raise EffectError('database_still_present')
        return {'name': database, **self._remove_filestore('odoo', database, 'remove-filestore')}

    def _prove_restore_copy(self, name):
        """A copy is dropped only when the marker inside it names THIS tenant (a restore carries the source's marker)."""
        state = self._database_state('restore-db', name)
        if state is None:
            return False
        if not state['allow']:
            raise EffectError('restore_copy_unreadable')
        try:
            marker = self.backend.psql('restore-db', name, MARKER_SQL).strip('\n')
        except EffectError:
            raise EffectError('restore_copy_unreadable') from None
        if not marker:
            raise EffectError('restore_copy_marker_missing')
        if marker != self.plan['controlTenantId']:
            raise EffectError('restore_copy_marker_mismatch')
        return True

    def remove_restore_copies(self):
        """Only the copies the plan lists, each matching the name rule AND carrying this tenant's marker.

        A copy whose database is already gone is finished by name (its files and side files), since there is nothing
        left to read the marker from.
        """
        copies = []
        for name in self.plan['restoreCopies']:
            validate_restore_copy(name)
            present = self._prove_restore_copy(name)
            if present and not self.dry_run:
                self._permit('remove-restore-copies')
            copies.append({
                'name': name,
                'database': self._drop_database('restore-db', name),
                'filestore': self._remove_filestore('restore-odoo', name, 'remove-restore-copies'),
                'restoreEffect': self._remove_file(self.state_dir / 'restore-effects', name + '.json', 'remove-restore-copies'),
                'classification': self._remove_file(self.state_dir / 'classifications', name + '.json', 'remove-restore-copies'),
            })
        return {'copies': copies, 'count': len(copies)}

    def purge_local_backups(self):
        backups = [{'id': backup_id, **self._remove_tree(self.state_dir / 'backups', backup_id, files.UUID_NAME, 'purge-local-backups')}
                   for backup_id in self.plan['backupIds']]
        return {'backups': backups, 'count': len(backups)}

    def remove_side_files(self):
        """Credentials, classification and AI egress hosts. The reservation files stay: they are the tombstone."""
        database = validate_tenant_database(self.plan)
        result = {
            'credentials': self._remove_file(self.state_dir / 'credentials', database + '.json', 'remove-side-files'),
            'classification': self._remove_file(self.state_dir / 'classifications', database + '.json', 'remove-side-files'),
        }
        if self.ai_egress_dir is None:
            result['aiEgress'] = {'state': 'not_configured'}
        else:
            result['aiEgress'] = self._remove_file(self.ai_egress_dir, database + '.hosts', 'remove-side-files')
        return result

    def run(self, stage):
        if stage not in STAGES:
            raise EffectError('operation_unavailable')
        return {'stage': stage, 'dryRun': self.dry_run, **getattr(self, stage)()}


def validate_config(config):
    keys = set(config) if isinstance(config, dict) else set()
    if (not CONFIG_KEYS <= keys or keys - CONFIG_KEYS - OPTIONAL_CONFIG_KEYS or config['schemaVersion'] != 1
            or not re.fullmatch(r'liwan-(?:saas|shared)-[a-z0-9-]{3,48}', str(config['projectName']))
            or not isinstance(config['domainSuffix'], str)):
        raise EffectError('runtime_invalid')
    for key in ('composeFile', 'envFile', 'stateDir', 'aiEgressDir'):
        if key in config:
            if not isinstance(config[key], str):
                raise EffectError('runtime_invalid')
            try:
                no_symlink(config[key])
            except EffectError:
                raise EffectError('runtime_invalid') from None
    return config


def execute(request, backend=None, permit_fn=permit):
    """Validate the request and run its stage. `backend` defaults to the Compose project of the config."""
    if not isinstance(request, dict) or request.get('action') not in STAGES:
        raise EffectError('operation_unavailable')
    validate_config(request.get('config'))
    return TenantDrop(request, backend or ComposeBackend(request['config']), permit_fn).run(request['action'])


def classify_error(error):
    code = str(error) if isinstance(error, EffectError) else ''
    return code if code in ERROR_CODES else 'tenant_drop_failed'


def main(stdin=None, stdout=None):
    out = stdout or sys.stdout
    previous = {}
    try:
        raw = (stdin or sys.stdin).readline(MAX_OUTPUT + 1)
        if len(raw) > MAX_OUTPUT:
            raise EffectError('input_invalid')

        def terminate(_signum, _frame):
            raise EffectError('authority_lost')

        for signum in (signal.SIGTERM, signal.SIGINT):
            previous[signum] = signal.signal(signum, terminate)
        request = json.loads(raw)
        emit_result = {'result': execute(request)}
        status = 0
    except Exception as error:
        # Never disclose input, command output, paths or exception text: only an allowlisted code.
        emit_result, status = {'error_code': classify_error(error)}, 1
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    print(json.dumps(emit_result, separators=(',', ':')), file=out, flush=True)
    return status


if __name__ == '__main__':
    sys.exit(main())
