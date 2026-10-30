"""Durable, AI-only shared-state maintenance. No implicit migration or process termination.

Trusted operator configuration names every affected tenant, old process and new process.
The only executable extension is an explicitly reviewed migration object. Unknown state
versions remain blocked; this module does not invent a future AI schema migration.
"""
from __future__ import annotations

from contextlib import ExitStack
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import stat
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .manifest import manifest_digest, validate_manifest
from .state import ReleaseConflict, atomic_json, digest, name, sync_directory

KNOWN_STATE_VERSIONS = frozenset({'1'})
COUNTS = ('active_runs', 'running', 'claimed_writes', 'pending_reads', 'local_requests', 'settling')
CONFIG_FIELDS = {'sharedStateId', 'tenantIds', 'oldServices', 'newServices', 'poolTargets', 'tokenFile', 'timeoutSeconds'}
SHA256 = re.compile(r'[a-f0-9]{64}\Z')
STATE_ID = re.compile(r'state_[a-f0-9]{32}\Z')
GENERATION_ID = re.compile(r'[a-z][a-z0-9_-]{0,62}\Z')


@dataclass(frozen=True)
class ReviewedAiMigration:
    """Injected reviewed adapter, never a default upgrade. The caller verifies code provenance.

    ``action(context)`` runs once and returns migrated/sharedStateId/fromVersion/toVersion/digest.
    review_digest identifies the reviewed adapter bytes; it does not hash a Python closure.
    """
    shared_state_id: str
    from_version: str
    to_version: str
    review_reference: str
    review_digest: str
    action: Callable[[dict], dict]

    def identity(self):
        return {'sharedStateId': self.shared_state_id, 'fromVersion': self.from_version,
                'toVersion': self.to_version, 'reviewReference': self.review_reference, 'reviewDigest': self.review_digest}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def _json_file(path):
    path = Path(path)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'r') as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError()
            raw = stream.read(1048577)
        if len(raw) > 1048576:
            raise ValueError()
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (OSError, ValueError, UnicodeError):
        raise ReleaseConflict('ai_maintenance_file_invalid') from None


def _token(path):
    path = Path(path)
    try:
        if not path.is_absolute() or any(item.is_symlink() for item in (path, *path.parents)):
            raise ValueError()
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'r') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
                raise ValueError()
            value = stream.read(4097).strip()
        if not 24 <= len(value) <= 4096 or any(not 33 <= ord(char) <= 126 for char in value):
            raise ValueError()
        return value
    except (OSError, ValueError, UnicodeError):
        raise ValueError('ai_service_token_invalid') from None


def _service(value, state_id):
    if not isinstance(value, dict) or set(value) != {'id', 'url', 'sharedStateId', 'aiStateVersion'}:
        raise ValueError('ai_service_config_invalid')
    if not isinstance(value['id'], str) or not GENERATION_ID.fullmatch(value['id']):
        raise ValueError('ai_service_config_invalid')
    if value['sharedStateId'] != state_id or value['aiStateVersion'] not in KNOWN_STATE_VERSIONS:
        raise ValueError('ai_state_scope_or_version_unknown')
    url = urlsplit(value['url'])
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise ValueError('ai_service_url_invalid')
    return {**value, 'url': value['url'].rstrip('/')}


def _observe(service, method, token, timeout):
    path = '/internal/release/drain' if method == 'POST' else '/internal/release/readiness'
    request = Request(service['url'] + path, method=method, data=b'' if method == 'POST' else None,
                      headers={'x-liwan-service-token': token, 'accept': 'application/json'})
    try:
        with build_opener(_NoRedirect()).open(request, timeout=timeout) as response:
            if response.status != 200:
                raise ValueError()
            raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError()
        result = json.loads(raw)
        if (not isinstance(result, dict) or result.get('state_version') != service['aiStateVersion']
                or result.get('state_id') != service['sharedStateId'] or result.get('generation_id') != service['id']
                or result.get('activity_scope') != 'shared_state' or type(result.get('accepting')) is not bool
                or type(result.get('drained')) is not bool or not isinstance(result.get('connections'), dict)
                or any(type(result.get(key)) is not int or result[key] < 0 for key in COUNTS)
                or result['active_runs'] != sum(result[key] for key in ('running', 'claimed_writes', 'pending_reads'))):
            raise ValueError()
        connections = result['connections']
        if (any(type(connections.get(key)) is not int or connections[key] < 0 for key in ('pool_size', 'pool_available'))
                or connections['pool_available'] > connections['pool_size']
                or type(connections.get('requests_waiting', 0)) is not int or connections.get('requests_waiting', 0) < 0):
            raise ValueError()
        return result
    except (OSError, ValueError, TypeError, HTTPError, URLError):
        raise ReleaseConflict('ai_service_observation_failed') from None


def _drained(value):
    connections = value['connections']
    return (value['accepting'] is False and value['drained'] is True and all(value[key] == 0 for key in COUNTS)
            and connections['pool_available'] == connections['pool_size'] and connections.get('requests_waiting', 0) == 0)


class AiMaintenanceCoordinator:
    def __init__(self, state, config, migration=None):
        self.state = state
        # Freeze caller-owned JSON input by value. Tokens never enter the SQLite request payload.
        self.config = json.loads(json.dumps(config, allow_nan=False))
        self.migration = migration

    def _inputs(self, request, manifest):
        manifest = validate_manifest(manifest)
        if (manifest['mode'] != 'service_maintenance' or tuple(manifest['affectedServices']) != ('ai',)
                or manifest['upgradeModules'] or manifest['installModules']
                or request.get('manifestDigest') != manifest_digest(manifest)
                or request.get('approvedMode') != 'service_maintenance'):
            raise ReleaseConflict('ai_maintenance_approval_mismatch')
        config = self.config
        if not isinstance(config, dict) or set(config) != CONFIG_FIELDS:
            raise ValueError('ai_maintenance_config_invalid')
        if not isinstance(config['sharedStateId'], str) or not STATE_ID.fullmatch(config['sharedStateId']):
            raise ValueError('ai_state_identity_invalid')
        name(request.get('requestId'))
        tenants = config['tenantIds']
        if (not isinstance(tenants, list) or not tenants or len(set(tenants)) != len(tenants)
                or not isinstance(request.get('tenantIds'), (list, tuple)) or len(set(request['tenantIds'])) != len(request['tenantIds'])
                or set(tenants) != set(request['tenantIds'])):
            raise ReleaseConflict('ai_affected_tenants_unknown')
        for tenant in tenants:
            name(tenant)
        with self.state.connection() as db:
            registered = {row[0] for row in db.execute('SELECT tenant_id FROM tenants')}
        if set(tenants) != registered:
            raise ReleaseConflict('ai_affected_tenants_unknown')
        expected = request.get('expectedRoutes')
        if not isinstance(expected, dict) or set(expected) != set(tenants) or any(type(v) is not int or v < 1 for v in expected.values()):
            raise ReleaseConflict('ai_expected_routes_missing')
        services = {}
        for field in ('oldServices', 'newServices'):
            values = config[field]
            if not isinstance(values, list) or not values:
                raise ValueError('ai_service_target_missing')
            services[field] = [_service(item, config['sharedStateId']) for item in values]
        combined = [*services['oldServices'], *services['newServices']]
        if len({item['id'] for item in combined}) != len(combined) or len({item['url'] for item in combined}) != len(combined):
            raise ValueError('ai_service_target_ambiguous')
        versions = {item['aiStateVersion'] for item in services['oldServices']}
        if (len(versions) != 1 or manifest['aiStateVersion'] not in KNOWN_STATE_VERSIONS
                or any(item['aiStateVersion'] != manifest['aiStateVersion'] for item in services['newServices'])):
            raise ReleaseConflict('ai_state_version_unsupported')
        migration = self.migration
        if not isinstance(migration, ReviewedAiMigration) or not callable(migration.action):
            raise ReleaseConflict('ai_migration_adapter_unavailable')
        if (migration.shared_state_id != config['sharedStateId'] or migration.from_version not in versions
                or migration.to_version != manifest['aiStateVersion'] or not isinstance(migration.review_reference, str)
                or not 1 <= len(migration.review_reference) <= 256
                or not isinstance(migration.review_digest, str) or not SHA256.fullmatch(migration.review_digest)):
            raise ReleaseConflict('ai_migration_adapter_unreviewed')
        timeout = config['timeoutSeconds']
        if type(timeout) not in (int, float) or not 0 < timeout <= 30:
            raise ValueError('ai_service_timeout_invalid')
        targets = config['poolTargets']
        new_ids = {item['id'] for item in services['newServices']}
        if not isinstance(targets, dict) or not targets or set(targets.values()) != new_ids:
            raise ReleaseConflict('ai_pool_targets_missing')
        for pool in targets:
            name(pool)
        return manifest, sorted(tenants), services, _token(config['tokenFile'])

    def _pools(self, request, tenants, services):
        affected = set()
        for tenant in tenants:
            route = self.state.route(tenant)
            if request['expectedRoutes'][tenant] != route['routeRevision']:
                raise ReleaseConflict('release_route_conflict')
            affected.add(route['poolId'])
            affected.update(old['poolId'] for old in route.get('draining', []))
        if set(self.config['poolTargets']) != affected:
            raise ReleaseConflict('ai_pool_targets_missing')
        pools = _json_file(self.state.routes / 'pools.json')
        if pools.get('schemaVersion') != 1 or not isinstance(pools.get('pools'), dict):
            raise ReleaseConflict('ai_pool_source_unknown')
        old_by_url = {item['url']: item for item in services['oldServices']}
        for pool_id in affected:
            pool = pools['pools'].get(pool_id, {})
            source = old_by_url.get(pool.get('aiUrl', '').rstrip('/'))
            if pool.get('poolId') != pool_id or source is None or pool.get('aiStateVersion') != source['aiStateVersion']:
                raise ReleaseConflict('ai_pool_source_unknown')
        return pools

    def _stage(self, request, tenants, phase, **kwargs):
        for tenant in tenants:
            self.state.stage(request['requestId'], tenant, phase, self.state.route(tenant)['fence'], **kwargs)

    def _scope_unchanged(self, tenants, db=None):
        if db is None:
            with self.state.connection() as connection:
                return self._scope_unchanged(tenants, connection)
        if {row[0] for row in db.execute('SELECT tenant_id FROM tenants')} != set(tenants):
            raise ReleaseConflict('ai_affected_tenants_changed')

    def apply(self, request, manifest):
        manifest, tenants, services, token = self._inputs(request, manifest)
        bound = {'request': request, 'configDigest': digest(self.config), 'migration': self.migration.identity()}
        marker = self.state.routes / 'ai.maintenance'
        with self.state.locked('ai_service_maintenance'), self.state.locked('global_publication'), ExitStack() as locks:
            self.state.request(request['requestId'], bound)
            receipt = self.state.receipt(request['requestId'])
            if receipt['stage'] == 'verified':
                if {row['tenant_id'] for row in receipt['tenants']} != set(tenants) or any(row['stage'] != 'verified' for row in receipt['tenants']):
                    raise ReleaseConflict('ai_maintenance_requires_reconciliation')
                if marker.exists() or marker.is_symlink():
                    raise ReleaseConflict('ai_verified_barrier_requires_reconciliation')
                return receipt
            if receipt['tenants'] or receipt['stage'] != 'planned':
                raise ReleaseConflict('ai_maintenance_requires_reconciliation')
            for tenant in tenants:
                locks.enter_context(self.state.locked(tenant))
            self._scope_unchanged(tenants)
            pools = self._pools(request, tenants, services)
            # Bind observed database and generation identities before closing any
            # service or allowing the migration adapter to mutate shared state.
            for service in (*services['oldServices'], *services['newServices']):
                _observe(service, 'GET', token, self.config['timeoutSeconds'])
            if marker.exists() or marker.is_symlink():
                raise ReleaseConflict('ai_maintenance_barrier_conflict')
            barrier = {'schemaVersion': 1, 'requestId': request['requestId'], 'manifestDigest': manifest_digest(manifest),
                       'sharedStateId': self.config['sharedStateId'], 'tenantIds': tenants, 'configDigest': digest(self.config)}
            self._stage(request, tenants, 'prepared_ai')
            try:
                atomic_json(marker, barrier)
                self._stage(request, tenants, 'draining_ai')
                for service in services['oldServices']:
                    result = _observe(service, 'POST', token, self.config['timeoutSeconds'])
                    if result['accepting'] is not False:
                        raise ReleaseConflict('ai_drain_not_observed')
                old_evidence = [_observe(service, 'GET', token, self.config['timeoutSeconds']) for service in services['oldServices']]
                if not all(_drained(item) for item in old_evidence):
                    return self.state.receipt(request['requestId'])
                self._scope_unchanged(tenants)
                self._stage(request, tenants, 'migrating_ai')
                context = {'requestId': request['requestId'], 'manifestDigest': manifest_digest(manifest),
                           'sharedStateId': self.config['sharedStateId'], 'tenantIds': tenants,
                           'fromVersion': self.migration.from_version, 'toVersion': self.migration.to_version,
                           'barrierPath': str(marker)}
                migrated = self.migration.action(json.loads(json.dumps(context)))
                if (not isinstance(migrated, dict) or migrated.get('migrated') is not True
                        or any(migrated.get(key) != context[key] for key in ('sharedStateId', 'fromVersion', 'toVersion'))
                        or not isinstance(migrated.get('digest'), str) or not SHA256.fullmatch(migrated['digest'])):
                    raise ReleaseConflict('ai_migration_unverified')
                self._stage(request, tenants, 'validating_ai', migration_digest=migrated['digest'])
                self._verify_services(services, token)
                target = json.loads(json.dumps(pools))
                new_by_id = {item['id']: item for item in services['newServices']}
                for pool_id, service_id in self.config['poolTargets'].items():
                    selected = new_by_id[service_id]
                    target['pools'][pool_id]['aiUrl'] = selected['url']
                    target['pools'][pool_id]['aiStateVersion'] = selected['aiStateVersion']
                if digest(_json_file(self.state.routes / 'pools.json')) != digest(pools):
                    raise ReleaseConflict('ai_pool_publication_conflict')
                atomic_json(self.state.routes / 'pools.json', target)
                self._stage(request, tenants, 'published_ai')
                self._verify_services(services, token)
                if _json_file(marker) != barrier or digest(_json_file(self.state.routes / 'pools.json')) != digest(target):
                    raise ReleaseConflict('ai_publication_unverified')
                # One SQLite transaction completes every affected tenant and the shared request together.
                with self.state.connection() as db:
                    self._scope_unchanged(tenants, db)
                    rows = db.execute('SELECT tenant_id,stage FROM operations WHERE request_id=?', (request['requestId'],)).fetchall()
                    if {row[0] for row in rows} != set(tenants) or any(row[1] != 'published_ai' for row in rows):
                        raise ReleaseConflict('ai_maintenance_phase_incomplete')
                    db.execute("UPDATE operations SET stage='verified' WHERE request_id=?", (request['requestId'],))
                    db.execute("UPDATE requests SET stage='verified',error_code=NULL WHERE request_id=?", (request['requestId'],))
            except Exception:
                self._stage(request, tenants, 'needs_intervention', error='ai_maintenance_failed')
                raise ReleaseConflict('ai_maintenance_failed') from None
            # If the process dies here the durable barrier remains and a verified retry asks for explicit reconciliation.
            marker.unlink()
            sync_directory(self.state.routes)
            return self.state.receipt(request['requestId'])

    def _verify_services(self, services, token):
        for service in services['oldServices']:
            if not _drained(_observe(service, 'GET', token, self.config['timeoutSeconds'])):
                raise ReleaseConflict('ai_old_generation_not_drained')
        for service in services['newServices']:
            value = _observe(service, 'GET', token, self.config['timeoutSeconds'])
            if value['accepting'] is not True or value['drained'] is not False:
                raise ReleaseConflict('ai_new_generation_not_ready')
