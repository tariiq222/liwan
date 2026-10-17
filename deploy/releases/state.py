# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Single-host rollout authority and crash-safe per-tenant route publications."""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import threading

IDENTIFIER = re.compile(r'[a-z][a-z0-9_-]{0,62}\Z')
ROUTE_FIELDS = ('tenantId', 'identityRevision', 'routeRevision', 'releaseId', 'poolId', 'fence', 'state', 'aiStateVersion')


class ReleaseConflict(RuntimeError):
    """Caller no longer owns the route or operation it observed."""


def name(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError('release_identifier_invalid')
    return value


def safe_directory(path):
    path = Path(path).absolute()
    for item in (path, *path.parents):
        if item.is_symlink():
            raise ValueError('release_path_symlink')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path, value):
    path = Path(path)
    safe_directory(path.parent)
    if path.is_symlink():
        raise ValueError('release_path_symlink')
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream, sort_keys=True, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_route(route):
    allowed = {'schemaVersion', *ROUTE_FIELDS, 'draining'}
    if not isinstance(route, dict) or set(route) - allowed or route.get('schemaVersion') != 1:
        raise ValueError('release_route_invalid')
    for field in ('tenantId', 'releaseId', 'poolId'):
        name(route.get(field))
    for field in ('identityRevision', 'routeRevision', 'fence'):
        if type(route.get(field)) is not int or route[field] < 1:
            raise ValueError('release_route_revision_invalid')
    if route.get('state') not in ('serving', 'maintenance'):
        raise ValueError('release_route_state_invalid')
    if route.get('aiStateVersion') is not None and (not isinstance(route['aiStateVersion'], str) or not route['aiStateVersion']):
        raise ValueError('release_ai_version_invalid')
    for previous in route.get('draining', []):
        if not isinstance(previous, dict) or set(previous) != {'releaseId', 'poolId', 'routeRevision', 'fence'}:
            raise ValueError('release_draining_invalid')
        name(previous['releaseId']); name(previous['poolId'])
        if any(type(previous[k]) is not int or previous[k] < 1 for k in ('routeRevision', 'fence')):
            raise ValueError('release_draining_invalid')
    return route


class ReleaseState:
    def __init__(self, root):
        self.root = safe_directory(root)
        self.routes = safe_directory(self.root / 'routes')
        self.locks = safe_directory(self.root / 'locks')
        self.path = self.root / 'release.sqlite'
        self._held = threading.local()
        if self.path.is_symlink():
            raise ValueError('release_path_symlink')
        with self.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS tenants (
                    tenant_id TEXT PRIMARY KEY, database_name TEXT UNIQUE NOT NULL,
                    filestore TEXT UNIQUE NOT NULL, identity_revision INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS routes (
                    tenant_id TEXT PRIMARY KEY REFERENCES tenants(tenant_id),
                    identity_revision INTEGER NOT NULL, route_revision INTEGER NOT NULL,
                    release_id TEXT NOT NULL, pool_id TEXT NOT NULL, fence INTEGER NOT NULL,
                    state TEXT NOT NULL, ai_version TEXT);
                CREATE TABLE IF NOT EXISTS draining_routes (
                    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
                    release_id TEXT NOT NULL,pool_id TEXT NOT NULL,
                    route_revision INTEGER NOT NULL,fence INTEGER NOT NULL,
                    PRIMARY KEY(tenant_id,route_revision));
                CREATE TABLE IF NOT EXISTS publications (
                    tenant_id TEXT PRIMARY KEY REFERENCES tenants(tenant_id),
                    expected_revision INTEGER NOT NULL, target TEXT NOT NULL,
                    digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS requests (
                    request_id TEXT PRIMARY KEY, payload_digest TEXT NOT NULL,
                    stage TEXT NOT NULL, error_code TEXT);
                CREATE TABLE IF NOT EXISTS operations (
                    request_id TEXT NOT NULL REFERENCES requests(request_id),
                    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
                    stage TEXT NOT NULL, fence INTEGER NOT NULL,
                    backup_digest TEXT, migration_digest TEXT, retirement_digest TEXT,
                    PRIMARY KEY(request_id,tenant_id));
            ''')
        os.chmod(self.path, 0o600)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA synchronous=FULL')
        try:
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def locked(self, tenant_id):
        held = getattr(self._held, 'names', set())
        if tenant_id in held:
            yield
            return
        path = self.locks / (name(tenant_id) + '.lock')
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise ReleaseConflict('tenant_operation_busy') from exc
            self._held.names = held | {tenant_id}
            try:
                yield
            finally:
                self._held.names = held
        finally:
            os.close(descriptor)

    def register(self, binding, route):
        validate_route(route)
        tenant = name(binding['tenantId'])
        database = name(binding['database'])
        if binding['filestore'] != database or tenant != route['tenantId'] or binding['registryRevision'] != route['identityRevision']:
            raise ReleaseConflict('tenant_binding_mismatch')
        with self.locked('global_publication'), self.locked(tenant):
            if (self.routes/'ai.maintenance').exists():
                raise ReleaseConflict('shared_service_maintenance')
            with self.connection() as db:
                previous = db.execute('SELECT * FROM tenants WHERE tenant_id=?', (tenant,)).fetchone()
                if previous and (previous['database_name'] != database or previous['filestore'] != binding['filestore'] or previous['identity_revision'] != binding['registryRevision']):
                    raise ReleaseConflict('tenant_binding_immutable')
                db.execute('INSERT OR IGNORE INTO tenants VALUES (?,?,?,?)', (tenant, database, binding['filestore'], binding['registryRevision']))
                old = db.execute('SELECT 1 FROM routes WHERE tenant_id=?', (tenant,)).fetchone()
                if old and self.route(tenant) != route:
                    raise ReleaseConflict('tenant_already_registered')
                self._store_route(db, route)
            # Commit authority first. A crash before projection denies admission;
            # exact bootstrap retry can repair an absent projection safely.
            path=self.routes/(tenant+'.json')
            if path.exists() and json.loads(path.read_text()) != route:
                raise ReleaseConflict('bootstrap_projection_conflict')
            atomic_json(path, route)

    @staticmethod
    def _store_route(db, route):
        db.execute('INSERT OR REPLACE INTO routes VALUES (?,?,?,?,?,?,?,?)', tuple(route.get(field) for field in ROUTE_FIELDS))
        db.execute('DELETE FROM draining_routes WHERE tenant_id=?', (route['tenantId'],))
        for previous in route.get('draining', []):
            db.execute('INSERT INTO draining_routes VALUES (?,?,?,?,?)', (route['tenantId'],previous['releaseId'],previous['poolId'],previous['routeRevision'],previous['fence']))

    def route(self, tenant_id):
        with self.connection() as db:
            row = db.execute('SELECT * FROM routes WHERE tenant_id=?', (name(tenant_id),)).fetchone()
            draining = db.execute('SELECT release_id,pool_id,route_revision,fence FROM draining_routes WHERE tenant_id=? ORDER BY route_revision', (tenant_id,)).fetchall()
        if row is None:
            raise ReleaseConflict('tenant_not_registered')
        value = {'schemaVersion': 1, **dict(zip(ROUTE_FIELDS, tuple(row)))}
        if draining:
            value['draining'] = [dict(zip(('releaseId','poolId','routeRevision','fence'), tuple(item))) for item in draining]
        if value['aiStateVersion'] is None:
            del value['aiStateVersion']
        return value

    def binding(self, tenant_id):
        with self.connection() as db:
            row = db.execute('SELECT * FROM tenants WHERE tenant_id=?', (name(tenant_id),)).fetchone()
        if row is None:
            raise ReleaseConflict('tenant_not_registered')
        return {'tenantId': row['tenant_id'], 'database': row['database_name'], 'filestore': row['filestore'], 'registryRevision': row['identity_revision']}

    def publish(self, target, *, expected_revision, checkpoint=lambda stage: None):
        validate_route(target)
        tenant = target['tenantId']
        with self.locked(tenant):
            current = self.route(tenant)
            if current['routeRevision'] != expected_revision or target['routeRevision'] != expected_revision + 1 or target['fence'] <= current['fence'] or target['identityRevision'] != current['identityRevision']:
                raise ReleaseConflict('release_route_conflict')
            with self.connection() as db:
                pending = db.execute('SELECT digest FROM publications WHERE tenant_id=?', (tenant,)).fetchone()
                if pending and pending['digest'] != digest(target):
                    raise ReleaseConflict('release_publication_pending')
                db.execute('INSERT OR REPLACE INTO publications VALUES (?,?,?,?)', (tenant, expected_revision, json.dumps(target, sort_keys=True), digest(target)))
            checkpoint('intent_committed')
            atomic_json(self.routes / (tenant + '.json'), target)
            checkpoint('published')
            with self.connection() as db:
                self._store_route(db, target)
                db.execute('DELETE FROM publications WHERE tenant_id=?', (tenant,))
            checkpoint('observed_committed')

    def reconcile(self, tenant_id):
        tenant = name(tenant_id)
        with self.locked(tenant), self.connection() as db:
            pending = db.execute('SELECT * FROM publications WHERE tenant_id=?', (tenant,)).fetchone()
            path = self.routes / (tenant + '.json')
            if path.is_symlink():
                raise ReleaseConflict('release_route_invalid')
            observed = validate_route(json.loads(path.read_text()))
            if pending and digest(observed) == pending['digest']:
                self._store_route(db, observed)
                db.execute('DELETE FROM publications WHERE tenant_id=?', (tenant,))
            elif pending and digest(observed) != digest(self.route(tenant)):
                raise ReleaseConflict('release_publication_ambiguous')
        return self.route(tenant)

    def retire_routes(self, tenant_id, expected_revision):
        tenant = name(tenant_id)
        with self.locked(tenant):
            route = self.route(tenant)
            if route['routeRevision'] != expected_revision:
                raise ReleaseConflict('release_route_conflict')
            route.pop('draining', None)
            with self.connection() as db:
                db.execute('INSERT OR REPLACE INTO publications VALUES (?,?,?,?)', (tenant,expected_revision,json.dumps(route,sort_keys=True),digest(route)))
            atomic_json(self.routes / (tenant + '.json'),route)
            with self.connection() as db:
                self._store_route(db,route)
                db.execute('DELETE FROM publications WHERE tenant_id=?',(tenant,))

    def maintenance(self, tenant_id, fence):
        tenant = name(tenant_id)
        if self.route(tenant)['fence'] != fence:
            raise ReleaseConflict('release_fence_conflict')
        path = self.routes / (tenant + '.maintenance')
        if path.exists():
            if path.is_symlink() or json.loads(path.read_text()) != {'tenantId': tenant, 'fence': fence}:
                raise ReleaseConflict('release_maintenance_conflict')
            return
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump({'tenantId': tenant, 'fence': fence}, stream)
            stream.flush(); os.fsync(stream.fileno())
        sync_directory(self.routes)

    def resume(self, tenant_id, fence):
        tenant = name(tenant_id)
        path = self.routes / (tenant + '.maintenance')
        if path.is_symlink() or not path.exists() or json.loads(path.read_text()).get('fence') != fence:
            raise ReleaseConflict('release_maintenance_conflict')
        path.unlink()
        sync_directory(self.routes)

    def request(self, request_id, payload):
        request_id = name(request_id)
        value = digest(payload)
        with self.connection() as db:
            row = db.execute('SELECT * FROM requests WHERE request_id=?', (request_id,)).fetchone()
            if row and row['payload_digest'] != value:
                raise ReleaseConflict('release_request_reused')
            db.execute("INSERT OR IGNORE INTO requests VALUES (?,?,'planned',NULL)", (request_id, value))

    def stage(self, request_id, tenant_id, stage, fence, *, error=None, backup_digest=None, migration_digest=None, retirement_digest=None):
        with self.connection() as db:
            db.execute('INSERT INTO operations VALUES (?,?,?,?,?,?,?) ON CONFLICT(request_id,tenant_id) DO UPDATE SET stage=excluded.stage,fence=excluded.fence,backup_digest=COALESCE(excluded.backup_digest,operations.backup_digest),migration_digest=COALESCE(excluded.migration_digest,operations.migration_digest),retirement_digest=COALESCE(excluded.retirement_digest,operations.retirement_digest)', (name(request_id), name(tenant_id), stage, fence, backup_digest, migration_digest, retirement_digest))
            db.execute('UPDATE requests SET stage=?,error_code=? WHERE request_id=?', (stage, error, request_id))

    def receipt(self, request_id):
        with self.connection() as db:
            request = db.execute('SELECT * FROM requests WHERE request_id=?', (name(request_id),)).fetchone()
            if request is None:
                raise ReleaseConflict('release_request_missing')
            operations = db.execute('SELECT * FROM operations WHERE request_id=? ORDER BY tenant_id', (request_id,)).fetchall()
        return {'requestId': request_id, 'stage': request['stage'], 'errorCode': request['error_code'], 'tenants': [dict(row) for row in operations]}
