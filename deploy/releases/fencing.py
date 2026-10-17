"""Host-local runtime operation leases, independent of commercial claim locks.

The coordinator installs a durable per-tenant maintenance barrier before it
waits for every lease (including pending ones). No TTL or PID-based reclamation.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import stat
import uuid

SAFE_NAME = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$')
OPERATION = re.compile(r'^[a-z][a-z0-9_-]{0,63}$')


class ReleaseOperationError(ValueError):
    """Sanitized release admission refusal."""


def release_routes_enabled():
    return 'WEBVUE_RELEASE_ROUTES_DIR' in os.environ


def _canonical(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path or '..' in path.parts:
        raise ReleaseOperationError('release_operation_blocked')
    return path


def _fsync(directory):
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def _directory(path):
    _canonical(path)
    try: path.mkdir(mode=0o700)
    except FileExistsError:
        if not path.is_dir() or path.is_symlink(): raise ReleaseOperationError('release_operation_blocked') from None
    _fsync(path.parent)


def _read(path):
    _canonical(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'r', encoding='utf-8') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode): raise ValueError()
        data = source.read(65537)
    if len(data) > 65536: raise ValueError()
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError()
            result[key] = value
        return result
    value = json.loads(data, object_pairs_hook=unique)
    if not isinstance(value, dict): raise ValueError()
    return value


def _write_lease(path, value, *, exclusive=False):
    """Publish pending lease first, then replace its snapshot atomically."""
    _canonical(path)
    target = path if exclusive else path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
        json.dump(value, output, sort_keys=True, separators=(',', ':'))
        output.flush(); os.fsync(output.fileno())
    if not exclusive: os.replace(target, path)
    _fsync(path.parent)


def _barrier(root, tenant_id):
    path = root / (tenant_id + '.maintenance')
    if path.exists() or path.is_symlink(): raise ReleaseOperationError('release_operation_blocked')


def _route(root, binding):
    path = root / (binding['tenantId'] + '.json')
    if not path.exists() and not path.is_symlink(): return None
    value = _read(path)
    if (value.get('schemaVersion') != 1 or value.get('tenantId') != binding['tenantId'] or value.get('identityRevision') != binding['registryRevision']
            or value.get('state') != 'serving' or not isinstance(value.get('poolId'), str)
            or not SAFE_NAME.fullmatch(value['poolId']) or not isinstance(value.get('releaseId'), str)
            or not SAFE_NAME.fullmatch(value['releaseId'])
            or any(type(value.get(key)) is not int or value[key] < 1 for key in ('identityRevision', 'routeRevision', 'fence'))):
        raise ReleaseOperationError('release_operation_blocked')
    return value


def _remove_owned(path, expected):
    if _read(path) != expected: raise ReleaseOperationError('release_operation_blocked')
    path.unlink(); _fsync(path.parent)


@contextmanager
def tenant_operation(binding, operation, *, allow_unrouted=False):
    """Hold a durable lease across the actual helper operation, until finally.

    Unconfigured single-pool callers retain their current contract. Enabled
    callers must supply trusted registry identity. New-target provisioning can
    use an exclusive lease without a route; it must independently enforce its
    existing require_new_target check before any DB mutation.
    """
    if not release_routes_enabled():
        yield None
        return
    path, lock, lease = None, None, None
    lock_acquired = False
    try:
        root = _canonical(os.environ['WEBVUE_RELEASE_ROUTES_DIR'])
        if not root.is_dir(): raise ValueError()
        if (not isinstance(binding, dict) or not isinstance(binding.get('tenantId'), str)
                or not SAFE_NAME.fullmatch(binding['tenantId']) or type(binding.get('registryRevision')) is not int
                or binding['registryRevision'] < 1 or not isinstance(operation, str) or not OPERATION.fullmatch(operation)):
            raise ValueError()
        tenant_id = binding['tenantId']
        leases = root / 'leases'; _directory(leases)
        directory = leases / tenant_id; _directory(directory)
        path = directory / (str(uuid.uuid4()) + '.json')
        lease = {'tenantId': tenant_id, 'pid': os.getpid(), 'operation': operation,
                 'poolId': 'pending', 'routeRevision': 0, 'fence': 0}
        _write_lease(path, lease, exclusive=True)
        _barrier(root, tenant_id)
        route = _route(root, binding)
        if route is None:
            if not allow_unrouted or operation not in {'provision', 'provision_observe'}: raise ValueError()
            lock = directory / 'provision.lock'
            _write_lease(lock, lease, exclusive=True)
            lock_acquired = True
        else:
            lease = {**lease, 'poolId': route['poolId'], 'routeRevision': route['routeRevision'], 'fence': route['fence']}
            _write_lease(path, lease)
        _barrier(root, tenant_id)
    except Exception:
        # Failed admission also removes its own pending lease, never another's.
        if lock_acquired:
            try: _remove_owned(lock, lease)
            except Exception: pass  # Unknown lock ownership remains for reconciliation.
        if path is not None and path.exists():
            try: _remove_owned(path, lease)
            except Exception: pass  # Preserve unknown ownership for operator reconciliation.
        raise ReleaseOperationError('release_operation_blocked') from None
    try:
        yield dict(lease)
    finally:
        try:
            if lock is not None: _remove_owned(lock, lease)
            _remove_owned(path, lease)
        except Exception:
            raise ReleaseOperationError('release_operation_blocked') from None
