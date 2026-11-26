"""Per-effect request schemas for the effect gate.

The gate forwards the worker's request to a process that is root-equivalent, so the request is validated here, before any
effect module sees it: allowed keys only (nested objects too), exact types, bounded sizes, and a strict full-match pattern for
every identifier. A string reaches the effect only through one of two kinds of check:

- `pattern`: a full-match regular expression, and never a `/`, a backslash, a NUL, or a `.`/`..` path component, so no
  identifier can steer a path, a container name or a docker argument;
- `free_text`: a name, a login, a password or an issuer (the explicit free-text fields): bounded length and no control
  character; these only ever travel as JSON data into a script or a SQL literal.

The shapes mirror what the control plane sends (`apps/control-plane/src/shared/odoo-adapter.ts`, `admin-password-runner.ts`,
`tenant-status-runner.ts`, `tenant-deletion-effects-runner.ts`, `packages/commercial-contracts/src/shared/provisioning.ts`). The effects
keep their own, narrower checks; this layer cannot be bypassed because the gate is the only way to start an effect.
"""
from __future__ import annotations

import re

MAX_SAFE_INTEGER = 2 ** 53 - 1
MAX_LIST = 1024


class SchemaError(ValueError):
    """Carries no value: a refused request never echoes its content."""


def _path_safe(value):
    return not any(c in value for c in '/\\\x00') and value not in ('.', '..')


def pattern(expression, limit=256):
    compiled = re.compile(expression, re.ASCII)  # \d must not match non-ASCII digits

    def check(value):
        if not isinstance(value, str) or len(value) > limit or not compiled.fullmatch(value) or not _path_safe(value):
            raise SchemaError
        return value
    return check


def free_text(low, high):
    def check(value):
        if (not isinstance(value, str) or not low <= len(value) <= high
                or any(ord(c) < 32 or ord(c) == 127 for c in value)):
            raise SchemaError
        return value
    return check


def secret_text(low, high):
    """A password: any character but NUL, so the policy of the effect decides the rest."""
    def check(value):
        if not isinstance(value, str) or not low <= len(value) <= high or '\x00' in value:
            raise SchemaError
        return value
    return check


def integer(low=0, high=MAX_SAFE_INTEGER):
    def check(value):
        if type(value) is not int or not low <= value <= high:
            raise SchemaError
        return value
    return check


def boolean(value):
    if type(value) is not bool:
        raise SchemaError
    return value


def literal(*allowed):
    def check(value):
        if not any(value == item and type(value) is type(item) for item in allowed):
            raise SchemaError
        return value
    return check


def nullable(inner):
    def check(value):
        return value if value is None else inner(value)
    return check


def either(*alternatives):
    def check(value):
        for alternative in alternatives:
            try:
                return alternative(value)
            except SchemaError:
                continue
        raise SchemaError
    return check


def list_of(inner, high=MAX_LIST, low=0, unique=False):
    def check(value):
        if not isinstance(value, list) or not low <= len(value) <= high:
            raise SchemaError
        for item in value:
            inner(item)
        if unique and len({repr(item) for item in value}) != len(value):
            raise SchemaError
        return value
    return check


def mapping_of(key_check, value_check, high=MAX_LIST):
    def check(value):
        if not isinstance(value, dict) or len(value) > high:
            raise SchemaError
        for key, item in value.items():
            key_check(key)
            value_check(item)
        return value
    return check


def shape(required, optional=None):
    """An object whose keys are exactly `required` plus any of `optional`, each checked by its validator."""
    optional = optional or {}

    def check(value):
        if not isinstance(value, dict) or not set(required) <= set(value) or set(value) - set(required) - set(optional):
            raise SchemaError
        for key, item in value.items():
            (required[key] if key in required else optional[key])(item)
        return value
    return check


# ---- shared identifiers -------------------------------------------------------------------------------------------

UUID_PATTERN = r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'
UUID = pattern(UUID_PATTERN, 36)
DIGEST = pattern(r'[a-f0-9]{64}', 64)
RESOURCE = pattern(r'[a-z][a-z0-9_]{0,62}', 63)  # a database or filestore name
SCRATCH_DATABASE = pattern(r'liwan_scratch_[a-f0-9]{32}', 46)
TENANT_ID = pattern(r'[a-z][a-z0-9_-]{0,62}', 63)
LABEL = pattern(r'[a-zA-Z0-9._-]{1,100}', 100)
MODULE = pattern(r'[a-z][a-z0-9_]{0,127}', 128)
FEATURE_KEY = pattern(r'[a-z][a-z0-9_.-]{0,127}', 128)
# The routed host: DNS labels of letters, digits and inner hyphens.
HOST = pattern(r'(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*', 253)
DATE = pattern(r'\d{4}-\d{2}-\d{2}', 10)
DATETIME = pattern(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})', 40)
COMPILER_VERSION = either(integer(0, MAX_SAFE_INTEGER), pattern(r'[A-Za-z0-9._-]{1,64}', 64))
BUSINESS_KEY = pattern(r'\["shared-v1","[a-z][a-z0-9_-]{0,62}","(?:provision|backup|restore)","(?:initial|' + UUID_PATTERN + r')"\]', 200)
FEATURE_VALUE = either(boolean, literal(None), integer())

BINDING = shape({'tenantId': TENANT_ID, 'database': RESOURCE, 'filestore': RESOURCE, 'registryRevision': integer(1)})
TENANT = shape({'database': RESOURCE, 'host': HOST})
FEATURES = mapping_of(FEATURE_KEY, FEATURE_VALUE, 256)
MODULES = list_of(MODULE, 1024, 1, unique=True)
CATALOG = shape({'version': LABEL, 'tier': LABEL, 'sourceSha256': DIGEST})
POLICY = shape({'schema_version': literal(1), 'channel': literal('control_plane'), 'modules': MODULES, 'features': mapping_of(FEATURE_KEY, FEATURE_VALUE, 1024)})
PACKAGE_AUTHORITY = shape({'schemaVersion': literal(2), 'revisionId': UUID, 'digest': DIGEST, 'catalog': CATALOG, 'policy': POLICY})
ATTEMPT = {'attemptId': UUID, 'fence': integer()}
FIXED = {'businessKey': BUSINESS_KEY, 'payloadDigest': DIGEST}


def _job(operation, extra=None, optional=None):
    return shape({'schemaVersion': literal(1), 'requestId': UUID, 'binding': BINDING, 'operation': literal(operation), **(extra or {})}, optional)


# ---- one schema per effect ----------------------------------------------------------------------------------------

ADMIN = shape({'name': free_text(1, 256), 'login': free_text(1, 256)}, {'mobile': free_text(1, 32)})

ODOO_EFFECT = shape(
    {'action': literal('observe', 'apply'), 'businessKey': BUSINESS_KEY, 'payloadDigest': DIGEST, 'admin': ADMIN,
     'companyName': free_text(1, 512), 'host': HOST, 'controlTenantId': UUID,
     'job': _job('provision', {'catalog': CATALOG, 'policy': POLICY}, {'packageAuthority': PACKAGE_AUTHORITY})},
    {'packageAuthority': PACKAGE_AUTHORITY, **ATTEMPT})

_ACTOR = shape({'issuer': free_text(1, 256), 'actorUid': integer(1)})
_BACKUP_AUTHORITY = shape({'controlTenantId': UUID, 'actor': _ACTOR, 'backupId': UUID}, {'manifestSha256': DIGEST})
_RESTORE_AUTHORITY = shape(
    {'controlTenantId': UUID, 'actor': _ACTOR, 'backupId': UUID, 'approvalId': UUID, 'targetDatabase': SCRATCH_DATABASE,
     'manifestSha256': DIGEST, 'databaseSha256': DIGEST, 'filestoreSha256': DIGEST})
_BACKUP_JOB = _job('backup')
_RESTORE_JOB = _job('restore', {'approvalId': UUID, 'backup': shape(
    {'schemaVersion': literal(1), 'backupId': UUID, 'binding': BINDING, 'databaseSha256': DIGEST, 'filestoreSha256': DIGEST,
     'consistency': literal('verified')})})
_COMMERCIAL = shape({'revisionId': UUID, 'digest': DIGEST})


def odoo_backup(request):
    """The job decides the operation, and the operation decides the authority and the other keys.

    ``reconcile`` is the recovery action, not an operation: it starts the shared Odoo a killed
    attempt may have left stopped, and it carries the same job and authority so the effect can
    name the tenant and the intent it is repairing.
    """
    operation = request.get('job', {}).get('operation') if isinstance(request.get('job'), dict) else None
    if operation == 'backup':
        job, authority, optional = _BACKUP_JOB, _BACKUP_AUTHORITY, {}
    elif operation == 'restore':
        job, authority, optional = _RESTORE_JOB, _RESTORE_AUTHORITY, {'commercial': _COMMERCIAL}
    else:
        raise SchemaError
    return shape({'action': literal('observe', 'apply', 'reconcile'), 'job': job, 'authority': authority, **FIXED},
                 {**optional, **ATTEMPT})(request)


_BRANCHES = shape(
    {'apply': list_of(shape({'branch_id': UUID, 'name': free_text(1, 120)}), 256), 'archive': list_of(UUID, 256)},
    {'restore': list_of(UUID, 256)})
_ENTITLEMENT = shape({'modules': MODULES, 'features': FEATURES, 'digest': DIGEST, 'compiler_version': COMPILER_VERSION})
_RESTORE_BINDING = shape({'requestId': UUID, 'approvalId': UUID, 'backupId': UUID, 'digest': DIGEST, 'manifestSha256': DIGEST})
_SUBSCRIPTION_OPTIONAL = {
    'restore': _RESTORE_BINDING, 'admin_login': free_text(1, 254),
    'commercial_valid_until': nullable(DATE), 'commercial_valid_until_revision': integer(),
    'trial_ends_at': nullable(DATETIME), 'post_trial_features': FEATURES, 'post_trial_modules': list_of(MODULE, 1024, unique=True),
    'post_trial_digest': DIGEST, 'excess_settle': literal(True),
    'recoverable_predecessors': list_of(shape({'revision_id': UUID, 'digest': DIGEST}), 256, 1, unique=True),
    'ai_push': literal(True), 'ai_expected_post_trial_digest': DIGEST,
}
_RECONFIGURE_KEYS = ('order_id', 'operation_id', 'previous_revision_id', 'target_revision_id', 'entitlement', 'branches')
_SUBSCRIPTION = shape(
    {'action': literal('observe', 'reconfigure'), 'tenant': TENANT, **ATTEMPT},
    {**_SUBSCRIPTION_OPTIONAL, 'order_id': UUID, 'operation_id': UUID, 'previous_revision_id': nullable(UUID),
     'target_revision_id': UUID, 'entitlement': _ENTITLEMENT, 'branches': _BRANCHES})


def subscription_effect(request):
    _SUBSCRIPTION(request)
    if request['action'] == 'reconfigure' and not set(_RECONFIGURE_KEYS) <= set(request):
        raise SchemaError
    return request


ADMIN_PASSWORD_EFFECT = shape(
    {'action': literal('set_admin_password'), 'tenant': TENANT,
     'login': free_text(1, 256), 'password': secret_text(1, 256)})

TENANT_STATUS_EFFECT = shape(
    {'action': literal('set_tenant_status'), 'tenant': TENANT,
     'status': literal('active', 'suspended'), 'reason': nullable(literal('non_payment', 'vendor'))})

DROP_STAGES = ('verify', 'stamp_marker', 'drop_database', 'remove_filestore', 'remove_restore_copies', 'purge_local_backups', 'remove_side_files')
TENANT_DROP_EFFECT = shape(
    {'action': literal(*DROP_STAGES), 'planDigest': DIGEST, 'plan': shape(
        {'schemaVersion': literal(1), 'requestId': UUID, 'controlTenantId': UUID, 'tenantId': TENANT_ID, 'database': RESOURCE,
         'filestore': RESOURCE, 'host': HOST, 'customerName': free_text(1, 200), 'controlPlaneDatabase': RESOURCE,
         'restoreCopies': list_of(SCRATCH_DATABASE, unique=True), 'backupIds': list_of(UUID, unique=True)})},
    {'dryRun': boolean})

# Resource names are never in the request: the effect derives them from `tenantId`. `requestId` is the id of one run (a fresh uuid per run).
TENANT_STORAGE_EFFECT = shape(
    {'schemaVersion': literal(1), 'operation': literal('ensure', 'verify', 'rotate', 'drop'), 'tenantId': TENANT_ID,
     'database': RESOURCE, 'requestId': UUID})

# The company's telephony allocation: the host, the SIP port and the RTP block the control plane decided. `ensure` records
# it; every other operation reads the record already in the effect's state directory.
TELEPHONY_ALLOCATION = shape({'host': HOST, 'sipPort': integer(1, 65535), 'rtpStart': integer(1024, 65535),
                              'rtpEnd': integer(1024, 65535)})
_TELEPHONY = shape({'schemaVersion': literal(1), 'operation': literal('ensure', 'verify', 'suspend', 'resume', 'drop'),
                    'tenantId': TENANT_ID, 'requestId': UUID}, {'allocation': TELEPHONY_ALLOCATION})


def tenant_telephony_effect(request):
    _TELEPHONY(request)
    allocation = request.get('allocation')
    if request['operation'] == 'ensure':
        if allocation is None or allocation['rtpStart'] > allocation['rtpEnd']:
            raise SchemaError
    elif allocation is not None:
        raise SchemaError
    return request


SCHEMAS = {
    'odoo_effect': ODOO_EFFECT, 'odoo_backup': odoo_backup, 'subscription_effect': subscription_effect,
    'admin_password_effect': ADMIN_PASSWORD_EFFECT, 'tenant_status_effect': TENANT_STATUS_EFFECT,
    'tenant_drop_effect': TENANT_DROP_EFFECT, 'tenant_storage_effect': TENANT_STORAGE_EFFECT,
    'tenant_telephony_effect': tenant_telephony_effect,
}


def validate(effect, request):
    """Returns the request when it fits the effect's schema; raises `SchemaError` otherwise."""
    try:
        SCHEMAS[effect](request)
    except (SchemaError, RecursionError, TypeError, KeyError):
        raise SchemaError from None
    return request
