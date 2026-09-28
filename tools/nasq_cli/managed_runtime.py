# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Single-adapter managed runtime (``compose-local``) for Package 2.

Entry point: ``PYTHONPATH=tools python3 -B -m nasq_cli.managed_runtime <command>
--target <tgt_...> [...] --json``. It reuses ``cli.py``'s parser and exit-code
contract through ``cli.main(adapter=...)``, exactly as ``operator.py`` and
``adapters.py`` do, and it changes no shared file.

Boundaries this module preserves:

- The general scratch operator lane is untouched. Managed targets are enrolled
  in a **separate** private document (``NASQ_MANAGED_INVENTORY``, schema version
  3); the 16-key version 2 entry keeps its exact shape.
- Enrollment is immutable: the descriptor is content-digested and the digest is
  bound into the durable receipt as the target fingerprint. Lifecycle is **not**
  a descriptor field, so it can never enter those bound bytes; it is derived
  from the operation journal and projected to ``<state_dir>/managed/``.
- Refusals are ordered so that a structural refusal never consults the world and
  never writes a journal row, while a world-dependent refusal returns a
  journal-legal ``conflict`` so it can never create a false quarantine.

Local acceptance boundaries:

- The default descriptor-bound DockerProbe validates a narrow four-service JSON
  Compose bundle and pinned local images. Unknown observations fail closed.
- Creation validates the enrolled catalog composition, initializes features and
  independently reads them back before loopback HTTP checks can report ready.
  That marker describes this local target, not a production release approval.
- Existing-customer ``tenant.entitle`` remains unwired. Initial-create feature
  application is a separate guarded script, not the scratch operator script.
- ``backup``, ``restore`` and ``upgrade`` stay outside the allowlist.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import NoReturn

from . import journal
from .cli import (
    EXIT_AUTHORIZATION,
    EXIT_CONFLICT,
    EXIT_FAILED_OPERATION,
    EXIT_INVALID_INPUT,
    EXIT_NEEDS_INTERVENTION,
    EXIT_OK,
    POLICY_MAX_BYTES,
    SCHEMA_VERSION,
)
from .cli import (
    main as cli_main,
)
from .managed_credentials import (
    CredentialsError,
    build_credentials_script,
    build_credentials_snapshot_script,
    parse_credentials,
)
from .managed_health import health as managed_health
from .managed_policy import PolicyError, parse_create_policy
from .managed_probe import DockerProbe, ProbeError
from .managed_process import ProcessError, local_docker_runner
from .managed_process import run as bounded_run
from .managed_secrets import resolve_secret
from .managed_verify import (
    VerificationError,
    build_policy_script,
    build_snapshot_script,
    parse_snapshot,
)

CATALOG_PATH = Path(__file__).resolve().parents[2] / 'deploy/catalog/solutions/platform.json'
INVENTORY_SCHEMA_VERSION = 3
PROJECTION_SCHEMA_VERSION = 1
MANAGED_INVENTORY_ENV = 'NASQ_MANAGED_INVENTORY'
STATE_ENV = 'NASQ_CLI_STATE_DIR'
ADAPTER_KIND = 'compose-local'
ADAPTER_VERSION = 1
SUBPROCESS_TIMEOUT = 1800
OUTPUT_LIMIT = 65536

TARGET_ID_RE = re.compile(r'^tgt_[a-z0-9_]{1,59}$')
IDENTIFIER_RE = re.compile(r'^[a-z][a-z0-9-]{0,62}$')
DB_NAME_RE = re.compile(r'^nasq_scratch_[a-z0-9_]{1,42}$')
DIGEST_RE = re.compile(r'^sha256:[0-9a-f]{64}$')

FORBIDDEN_DB_TOKENS = frozenset({
    'odoo19', 'production', 'prod', 'postgres', 'template0', 'template1',
})
FORBIDDEN_PORTS = frozenset({80, 443, 3000, 5432, 8069, 8072})
CONTROL_PLANE_PORTS = frozenset({55432, 14179})
CONTROL_PLANE_PROJECT = 'nasq-saas-control-local'
DESTRUCTIVE_SUBCOMMANDS = frozenset({'down', 'rm', 'kill', 'prune'})

LIFECYCLES = frozenset({'reserved', 'provisioned', 'quarantined', 'disabled'})
UNRESOLVED_STATUSES = frozenset({'mutating', 'needs_intervention'})

ALLOWED_OPERATIONS = frozenset({
    'tenant.preflight', 'tenant.inspect', 'health',
    'tenant.create', 'tenant.entitle',
})
READ_ONLY_OPERATIONS = frozenset({'tenant.preflight', 'tenant.inspect', 'health'})
# Receipt operations read the durable journal only. They are admissible for any
# enrolled target and are deliberately exempt from the per-descriptor
# allowed_operations list, the commercial-mode gate, world preflight and the
# lifecycle gate (a quarantined target must stay inspectable).
RECEIPT_OPERATIONS = frozenset({'status'})
# The only operations this adapter journals; a stored receipt naming anything
# else did not come from this boundary and is refused.
JOURNALED_OPERATIONS = frozenset({'tenant.create', 'tenant.entitle'})
RECEIPT_OPERATION_ID_RE = re.compile(r'^op_[a-f0-9]{32}$')
JOURNAL_DIGEST_RE = re.compile(r'^[0-9a-f]{64}$')
COMPOSE_ACTIONS = ('db.up', 'modules.install', 'services.up')

DOCUMENT_KEYS = frozenset({'schema_version', 'targets'})
TARGET_KEYS = frozenset({
    'adapter', 'environment_id', 'commercial_mode', 'resource_refs',
    'secret_refs', 'release_ref', 'allowed_operations', 'revision',
    'descriptor_digest',
})
ADAPTER_KEYS = frozenset({'kind', 'version'})
RESOURCE_KEYS = frozenset({
    'project', 'compose_file', 'db_name', 'data_dir', 'backup_root', 'ports',
})
PORT_KEYS = frozenset({'db', 'odoo', 'web'})
SECRET_KEYS = frozenset({'db_password', 'admin_password'})
RELEASE_KEYS = frozenset({
    'catalog_version', 'catalog_sha256', 'identity_kind',
    'odoo_image', 'web_image', 'proxy_image',
})
IDENTITY_KINDS = ('image_id', 'repo_digest')
COMMERCIAL_MODES = ('saas', 'non_saas')

JOURNAL_EXIT = {
    'ok': EXIT_OK,
    'conflict': EXIT_CONFLICT,
    'needs_intervention': EXIT_NEEDS_INTERVENTION,
}


class ManagedFailure(Exception):
    """A structured managed-runtime refusal carrying its own exit code."""

    def __init__(self, exit_code, code, stage, message):
        super().__init__(message)
        self.exit_code = exit_code
        self.code = code
        self.stage = stage
        self.message = message


def _fail(exit_code, code, stage, message) -> NoReturn:
    """Refuse through one structured channel; messages never carry private data."""
    raise ManagedFailure(exit_code, code, stage, message)


def _payload(fields, status, stage, *, changed=False, operation_id=None,
             error=None, **extra):
    result = {
        'schema_version': SCHEMA_VERSION,
        'operation_id': operation_id,
        'request_id': fields.get('request_id'),
        'target': fields.get('target'),
        'operation': fields.get('operation'),
        'status': status,
        'stage': stage,
        'changed': changed,
    }
    if error:
        result['error'] = error
    result.update(extra)
    return result


def _private_bytes(path, label, *, max_bytes=None):
    """Read one operator-owned private file; nothing permissive is accepted."""
    candidate = Path(path)
    if not candidate.is_absolute() or candidate.is_symlink():
        _fail(EXIT_AUTHORIZATION, 'descriptor_not_private', label,
              f'{label} must be an absolute regular file')
    try:
        info = candidate.stat()
    except OSError:
        _fail(EXIT_INVALID_INPUT, 'inventory_invalid', label,
              f'{label} cannot be read')
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or info.st_mode & 0o022):
        _fail(EXIT_AUTHORIZATION, 'descriptor_not_private', label,
              f'{label} must be operator owned and not writable by others')
    if max_bytes is not None and info.st_size > max_bytes:
        _fail(EXIT_INVALID_INPUT, 'invalid_input', label,
              f'{label} exceeds the {max_bytes} byte limit')
    try:
        raw = candidate.read_bytes()
    except OSError:
        _fail(EXIT_INVALID_INPUT, 'inventory_invalid', label,
              f'{label} cannot be read')
    if max_bytes is not None and len(raw) > max_bytes:
        _fail(EXIT_INVALID_INPUT, 'invalid_input', label,
              f'{label} exceeds the {max_bytes} byte limit')
    return raw


def _discard(path):
    try:
        os.unlink(path)
    except OSError:
        return


class ManagedState:
    """Journal-derived projection of one managed target's lifecycle and stage.

    This is an index over durable journal outcomes, not a second journal. The
    authoritative request binding, receipt, lock and unresolved-mutation gate
    all live in :mod:`nasq_cli.journal`.
    """

    def __init__(self, root):
        self.base = Path(root)
        self.root = self.base / 'managed'

    def path(self, target_id):
        key = hashlib.sha256(target_id.encode('utf-8')).hexdigest()
        return self.root / f'{key}.json'

    def read(self, target_id):
        try:
            raw = self.path(target_id).read_text(encoding='utf-8')
        except OSError:
            return None
        try:
            value = json.loads(raw)
        except ValueError:
            return None
        return value if isinstance(value, dict) else None

    def write(self, target_id, record):
        # The state root is created private: the journal refuses a state
        # directory that is readable by group or world.
        self.base.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.root.mkdir(mode=0o700, exist_ok=True)
        path = self.path(target_id)
        handle, temporary = tempfile.mkstemp(dir=str(self.root), prefix='.partial-')
        try:
            with os.fdopen(handle, 'w', encoding='utf-8') as stream:
                json.dump(record, stream, sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
        except (OSError, TypeError, ValueError):
            _discard(temporary)
            raise


def load_managed_inventory(path):
    """Validate the strict version 3 managed inventory envelope."""
    raw = _private_bytes(path, 'managed inventory')
    try:
        document = json.loads(raw)
    except ValueError:
        _fail(EXIT_INVALID_INPUT, 'inventory_invalid', 'inventory',
              'managed inventory is not valid JSON')
    if (not isinstance(document, dict) or set(document) != DOCUMENT_KEYS
            or type(document['schema_version']) is not int
            or document['schema_version'] != INVENTORY_SCHEMA_VERSION
            or not isinstance(document['targets'], dict)):
        _fail(EXIT_INVALID_INPUT, 'inventory_invalid', 'inventory',
              'managed inventory requires schema version 3 and a targets object')
    for target_id, entry in document['targets'].items():
        valid_id = isinstance(target_id, str) and TARGET_ID_RE.fullmatch(target_id)
        if not valid_id or not isinstance(entry, dict):
            _fail(EXIT_INVALID_INPUT, 'inventory_invalid', 'inventory',
                  'every managed target needs an opaque id and an object descriptor')
    return document


def descriptor_digest(target_id, descriptor):
    """Content digest of one immutable enrollment descriptor.

    Canonical JSON over ``{'target': target_id, 'descriptor': body}`` with any
    ``descriptor_digest`` key removed, so the digest never covers itself and no
    mutable lifecycle value can enter it.
    """
    body = dict(descriptor)
    body.pop('descriptor_digest', None)
    payload = json.dumps(
        {'target': target_id, 'descriptor': body},
        sort_keys=True, separators=(',', ':'), ensure_ascii=False,
    ).encode('utf-8')
    return 'sha256:' + hashlib.sha256(payload).hexdigest()


def descriptor_for(target_id, document):
    """Resolve one opaque target id to its descriptor and fingerprint."""
    entry = document['targets'].get(target_id)
    if not isinstance(entry, dict):
        _fail(EXIT_INVALID_INPUT, 'target_unknown', 'inventory',
              'the requested target is not enrolled in the managed inventory')
    return entry, descriptor_digest(target_id, entry)


def _validate_identifier(value, label):
    if not isinstance(value, str) or not IDENTIFIER_RE.fullmatch(value):
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              f'{label} must be a bounded local identifier')


def _validate_resources(resources):
    if not isinstance(resources, dict) or set(resources) != RESOURCE_KEYS:
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'resource_refs must list exactly the approved private references')
    _validate_identifier(resources['project'], 'project')
    db_name = resources['db_name']
    if (not isinstance(db_name, str) or not DB_NAME_RE.fullmatch(db_name)
            or any(token in db_name.split('_') for token in FORBIDDEN_DB_TOKENS)):
        _fail(EXIT_AUTHORIZATION, 'target_disallowed', 'descriptor',
              'the target database must be an explicit disposable scratch name')
    for key in ('compose_file', 'data_dir', 'backup_root'):
        value = resources[key]
        if not isinstance(value, str) or not Path(value).is_absolute():
            _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
                  f'{key} must be an absolute path')
    ports = resources['ports']
    if (not isinstance(ports, dict) or set(ports) != PORT_KEYS
            or any(type(ports[key]) is not int or not 1 <= ports[key] <= 65535
                   for key in ports)):
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'ports must map db, odoo and web to valid TCP ports')


def _validate_secrets(secrets):
    if (not isinstance(secrets, dict) or set(secrets) != SECRET_KEYS
            or any(not isinstance(secrets[key], str) or not secrets[key]
                   for key in secrets)):
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'secret_refs must list opaque handles only, never secret bytes')


def _validate_release(release):
    if not isinstance(release, dict) or set(release) != RELEASE_KEYS:
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'release_ref must list the approved immutable references')
    for key in ('catalog_version', 'odoo_image', 'web_image', 'proxy_image'):
        if not isinstance(release[key], str) or not release[key]:
            _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
                  f'{key} must be a non-empty string')
    if (not isinstance(release['catalog_sha256'], str)
            or not DIGEST_RE.fullmatch(release['catalog_sha256'])):
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'catalog_sha256 must be a sha256 digest')
    identity_kind = release['identity_kind']
    if identity_kind not in IDENTITY_KINDS:
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'identity_kind must be exactly one of image_id or repo_digest')
    if identity_kind == 'image_id':
        for key in ('odoo_image', 'web_image', 'proxy_image'):
            if not DIGEST_RE.fullmatch(release[key]):
                _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
                      'image_id identity requires sha256 image digests')


def validate_descriptor(target_id, descriptor):
    """Validate the strict schema first, then enforce immutability."""
    if set(descriptor) != TARGET_KEYS:
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'the enrollment descriptor has missing or unknown keys')
    adapter = descriptor['adapter']
    if (not isinstance(adapter, dict) or set(adapter) != ADAPTER_KEYS
            or adapter['kind'] != ADAPTER_KIND
            or adapter['version'] != ADAPTER_VERSION):
        _fail(EXIT_AUTHORIZATION, 'adapter_unapproved', 'descriptor',
              'only the approved compose-local adapter version 1 may act')
    _validate_identifier(descriptor['environment_id'], 'environment_id')
    if descriptor['commercial_mode'] not in COMMERCIAL_MODES:
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'commercial_mode must be exactly saas or non_saas')
    _validate_resources(descriptor['resource_refs'])
    _validate_secrets(descriptor['secret_refs'])
    _validate_release(descriptor['release_ref'])
    operations = descriptor['allowed_operations']
    if (not isinstance(operations, list) or not operations
            or any(item not in ALLOWED_OPERATIONS for item in operations)):
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'allowed_operations must list approved managed operations only')
    revision = descriptor['revision']
    if type(revision) is not int or revision < 0:
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'revision must be a non-negative integer')
    recorded = descriptor['descriptor_digest']
    if not isinstance(recorded, str) or not DIGEST_RE.fullmatch(recorded):
        _fail(EXIT_INVALID_INPUT, 'descriptor_invalid', 'descriptor',
              'descriptor_digest must be a sha256 digest')
    if descriptor_digest(target_id, descriptor) != recorded:
        _fail(EXIT_AUTHORIZATION, 'descriptor_digest_mismatch', 'descriptor',
              'the enrollment descriptor does not match its recorded digest')


def _ports_overlap(left, right):
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    return bool(set(left.values()) & set(right.values()))


def _validate_aliases(target_id, descriptor, document):
    resources = descriptor['resource_refs']
    for other_id, other in document['targets'].items():
        if other_id == target_id or not isinstance(other, dict):
            continue
        other_resources = other.get('resource_refs')
        if not isinstance(other_resources, dict):
            continue
        shared = (
            other_resources.get('db_name') == resources['db_name']
            or other_resources.get('data_dir') == resources['data_dir']
            or other_resources.get('project') == resources['project']
            or _ports_overlap(other_resources.get('ports'), resources['ports'])
        )
        if shared:
            _fail(EXIT_AUTHORIZATION, 'resource_alias_forbidden', 'inventory',
                  'two enrolled targets may not share a database, data directory, project or port')


def _validate_compose_file(descriptor, root):
    candidate = Path(descriptor['resource_refs']['compose_file'])
    if candidate.is_symlink() or not candidate.is_file():
        _fail(EXIT_AUTHORIZATION, 'compose_file_invalid', 'descriptor',
              'the referenced compose file must be an absolute regular file')
    try:
        candidate.resolve().relative_to(root)
    except (OSError, ValueError):
        _fail(EXIT_AUTHORIZATION, 'compose_file_invalid', 'descriptor',
              'the referenced compose file must stay inside the enrollment root')


def _authorize_operation(operation, descriptor):
    if operation not in ALLOWED_OPERATIONS or operation not in descriptor['allowed_operations']:
        _fail(EXIT_AUTHORIZATION, 'operation_not_allowed', 'operation',
              'the managed adapter does not allow this operation for the target')
    if descriptor['commercial_mode'] != 'saas':
        _fail(EXIT_AUTHORIZATION, 'commercial_mode_forbidden', 'operation',
              'a non_saas installation keeps local policy and takes no managed operation')


def _static_checks(target_id, descriptor, document, root):
    resources = descriptor['resource_refs']
    project = resources['project']
    if project == CONTROL_PLANE_PROJECT or project.startswith(f'{CONTROL_PLANE_PROJECT}-'):
        _fail(EXIT_AUTHORIZATION, 'control_plane_overlap', 'descriptor',
              'the target project may not overlap the control plane')
    for port in resources['ports'].values():
        if port in FORBIDDEN_PORTS or port in CONTROL_PLANE_PORTS:
            _fail(EXIT_AUTHORIZATION, 'control_plane_overlap', 'descriptor',
                  'the target may not bind a reserved or control-plane port')
    _validate_compose_file(descriptor, root)
    _validate_aliases(target_id, descriptor, document)


def _descriptor_bytes(target_id, descriptor):
    return json.dumps(
        {'target': target_id, 'descriptor': descriptor},
        sort_keys=True, separators=(',', ':'), ensure_ascii=False,
    ).encode('utf-8')


def observed_lifecycle(store, state, target_id, descriptor):
    """Derive lifecycle from durable outcomes; never from the descriptor bytes.

    ``store`` may be a live journal. It is passed as ``None`` from inside a
    journal action, because that action already holds the per-target OS lock and
    a nested journal call would fail; the journal's own unresolved-mutation gate
    runs before the action. The projection is the lifecycle source in that case.
    """
    record = state.read(target_id)
    request_id = record.get('request_id') if isinstance(record, dict) else None
    if store is not None and isinstance(request_id, str):
        try:
            receipt = store.inspect(target_id, request_id)
        except journal.TargetBusy:
            return 'quarantined'
        if isinstance(receipt, dict) and receipt.get('status') in UNRESOLVED_STATUSES:
            return 'quarantined'
    if not isinstance(record, dict):
        return 'reserved'
    lifecycle = record.get('lifecycle')
    return lifecycle if lifecycle in LIFECYCLES else 'quarantined'


def preflight(descriptor, *, probe, state, target_id):
    """Observe the world and return a conflict code, or ``None`` when clean."""
    resources = descriptor['resource_refs']
    release = descriptor['release_ref']
    observed_catalog = probe('catalog_sha256', release['catalog_version'])
    if observed_catalog != release['catalog_sha256']:
        return 'catalog_digest_mismatch'
    for key in ('odoo_image', 'web_image', 'proxy_image'):
        observed = probe('image_identity', release[key])
        if observed is None or observed != release[key]:
            return 'image_identity_untrusted'
    if probe('compose_file', resources['compose_file']) is not True:
        return 'compose_file_invalid'
    if probe('database_exists', resources['db_name']):
        return 'database_exists'
    if probe('project_exists', resources['project']):
        return 'project_shared'
    if probe('volume_exists', f"{resources['project']}-db"):
        return 'volume_shared'
    if probe('network_exists', f"{resources['project']}-private"):
        return 'network_shared'
    for port in resources['ports'].values():
        if probe('port_in_use', port):
            return 'port_shared'
    return None


def build_compose_argv(descriptor, action, *, modules=None):
    """Build one bounded Compose argv from a closed action registry."""
    if action not in COMPOSE_ACTIONS:
        _fail(EXIT_INVALID_INPUT, 'invalid_input', 'argv',
              'the requested compose action is not in the bounded registry')
    resources = descriptor['resource_refs']
    base = [
        'docker', 'compose',
        '-p', resources['project'],
        '-f', resources['compose_file'],
    ]
    if action == 'db.up':
        argv = base + ['up', '-d', 'db']
    elif action == 'modules.install':
        if (not isinstance(modules, list) or not modules
                or any(not isinstance(item, str) or not re.fullmatch(r'nasq_[a-z0-9_]+', item)
                       for item in modules)):
            _fail(EXIT_INVALID_INPUT, 'policy_invalid', 'policy',
                  'installation requires an explicitly validated module composition')
        argv = base + [
            'run', '--rm', '--no-deps', '-T', 'odoo',
            '-d', resources['db_name'],
            '-i', ','.join(modules),
            '--without-demo=all', '--no-http', '--workers=0',
            '--max-cron-threads=0', '--stop-after-init',
        ]
    else:
        argv = base + ['up', '-d']
    # Structural non-destructiveness: no path may ever name a removing verb.
    if any(token in DESTRUCTIVE_SUBCOMMANDS for token in argv):
        _fail(EXIT_INVALID_INPUT, 'invalid_input', 'argv',
              'the bounded argv may not contain a destructive subcommand')
    return argv


def _resolve_secrets(descriptor, resolver):
    values = {}
    for key, handle in descriptor['secret_refs'].items():
        try:
            values[key] = resolver(handle)
        except (KeyError, OSError, ValueError):
            _fail(EXIT_CONFLICT, 'secret_unavailable', 'secrets',
                  'a referenced secret handle cannot be resolved')
    return values


def _child_env(secrets):
    # Secrets reach the child through the environment only, never through argv,
    # never through the public payload and never through a receipt.
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    env['POSTGRES_PASSWORD'] = secrets['db_password']
    env['NASQ_ADMIN_PASSWORD'] = secrets['admin_password']
    return env


def _record(state, target_id, descriptor, fields, lifecycle, stage, clock):
    state.write(target_id, {
        'schema_version': PROJECTION_SCHEMA_VERSION,
        'target_id': target_id,
        'descriptor_digest': descriptor['descriptor_digest'],
        'stage': stage,
        'request_id': fields.get('request_id'),
        'lifecycle': lifecycle,
        'updated_at': clock(),
    })


def _verification_failed(code):
    raise VerificationError(code)


def _compose_base(descriptor):
    resources = descriptor['resource_refs']
    return ['docker', 'compose', '-p', resources['project'], '-f', resources['compose_file']]


def _shell_argv(descriptor, *, credentials=False):
    database = descriptor['resource_refs']['db_name']
    secret_env = ['-e', 'NASQ_ADMIN_PASSWORD'] if credentials else []
    return _compose_base(descriptor) + ['run', '--rm', '--no-deps', '-T'] + secret_env + [
        'odoo', 'shell',
        '-d', database, '--db-filter=^' + database + '$', '--no-http',
        '--workers=0', '--max-cron-threads=0',
    ]


def _http_health(descriptor, *, runner):
    """Verify exact running container identities and loopback product responses."""
    return managed_health(descriptor, runner=runner)


def _read_only_shell_argv(descriptor):
    """Exec an Odoo shell in the enrolled running service without creating a container."""
    database = descriptor['resource_refs']['db_name']
    return _compose_base(descriptor) + [
        'exec', '-T', 'odoo', 'odoo', 'shell',
        '-d', database, '--db-filter=^' + database + '$', '--no-http',
        '--workers=0', '--max-cron-threads=0',
    ]


def execute_steps(descriptor, *, runner, state, target_id, operation_id,
                  fields, secrets, clock, create_policy):
    """Create only a new target; verify independently before marking provisioned."""
    del operation_id
    env = _child_env(secrets)
    database = descriptor['resource_refs']['db_name']
    stage = 'database'
    try:
        code, _, _ = runner(build_compose_argv(descriptor, 'db.up'), env, None)
        if code != 0:
            _verification_failed('policy_script_failed')
        stage = 'database_readiness'
        ready = False
        for _attempt in range(30):
            code, _, _ = runner(_compose_base(descriptor) + [
                'exec', '-T', 'db', 'pg_isready', '-h', '127.0.0.1', '-p', '5432',
                '-U', 'odoo', '-d', database,
            ], env, None)
            if code == 0:
                ready = True
                break
            time.sleep(0.2)
        if not ready:
            _verification_failed('policy_script_failed')
        stage = 'modules'
        code, _, _ = runner(build_compose_argv(
            descriptor, 'modules.install', modules=create_policy['modules']), env, None)
        if code != 0:
            _verification_failed('policy_script_failed')
        stage = 'initial_policy'
        code, output, _ = runner(_shell_argv(descriptor), env,
                                 build_policy_script(create_policy, database))
        if code != 0:
            _verification_failed('policy_script_failed')
        applied = parse_snapshot(output, create_policy, database)
        stage = 'policy_readback'
        code, output, _ = runner(_shell_argv(descriptor), env, build_snapshot_script(database))
        if code != 0:
            _verification_failed('snapshot_invalid')
        observed = parse_snapshot(output, create_policy, database)
        if observed['policy_revision'] != applied['policy_revision'] or observed['policy_revision'] != 1:
            _verification_failed('profile_invalid')
        stage = 'credentials'
        code, output, _ = runner(_shell_argv(descriptor, credentials=True), env,
                                 build_credentials_script(database))
        if code != 0:
            _verification_failed('snapshot_invalid')
        parse_credentials(output, database)
        stage = 'credential_readback'
        code, output, _ = runner(_shell_argv(descriptor, credentials=True), env,
                                 build_credentials_snapshot_script(database))
        if code != 0:
            _verification_failed('snapshot_invalid')
        parse_credentials(output, database, expected_changed=False)
        stage = 'services'
        code, _, _ = runner(build_compose_argv(descriptor, 'services.up'), env, None)
        if code != 0:
            _verification_failed('policy_script_failed')
        stage = 'health'
        if not _http_health(descriptor, runner=runner):
            _verification_failed('snapshot_invalid')
    except (OSError, VerificationError, CredentialsError):
        _record(state, target_id, descriptor, fields, 'quarantined', stage, clock)
        return {'status': 'needs_intervention', 'stage': stage,
                'code': 'provisioning_unverified'}
    _record(state, target_id, descriptor, fields, 'provisioned', 'provisioned', clock)
    return {'status': 'ok', 'stage': 'provisioned', 'code': None, 'profile': observed}


def _run_mutation(fields, target_id, descriptor, state, probe, resolver, runner,
                  clock, operation_id, create_policy):
    operation = fields['operation']
    lifecycle = observed_lifecycle(None, state, target_id, descriptor)
    required = 'reserved' if operation == 'tenant.create' else 'provisioned'
    if lifecycle != required:
        _fail(EXIT_CONFLICT, 'lifecycle_conflict', 'lifecycle',
              'the target lifecycle does not allow this operation')
    if runner is _subprocess:
        try:
            runner = local_docker_runner()
        except ProcessError as error:
            _fail(EXIT_CONFLICT, error.code, 'preflight',
                  'a local Docker endpoint could not be verified')
        if isinstance(probe, DockerProbe):
            probe.runner = runner
    try:
        conflict = preflight(descriptor, probe=probe, state=state, target_id=target_id)
    except ProbeError as error:
        _fail(EXIT_CONFLICT, error.code, 'preflight',
              'managed resource observation is unavailable or unsafe')
    if conflict is not None:
        _fail(EXIT_CONFLICT, conflict, 'preflight',
              'the observed target world conflicts with the immutable enrollment')
    secrets = _resolve_secrets(descriptor, resolver)
    guarded_runner = runner
    if isinstance(probe, DockerProbe):
        try:
            input_snapshot = probe.validate_runtime_inputs(secrets)
        except ProbeError as error:
            _fail(EXIT_CONFLICT, error.code, 'preflight',
                  'managed runtime inputs do not match the approved secret bindings')

        def guarded_runner(argv, env=None, stdin_text=None):
            try:
                probe.assert_unchanged(input_snapshot)
            except ProbeError:
                _verification_failed('snapshot_invalid')
            return runner(argv, env, stdin_text)
    # Close the observation window as far as a non-atomic external probe can:
    # repeat every preflight check after secret/input preparation, immediately
    # before db.up. Only this confirmed pre-effect refusal is a clean conflict;
    # once the runner starts, uncertain outcomes remain quarantined.
    try:
        conflict = preflight(descriptor, probe=probe, state=state, target_id=target_id)
    except ProbeError as error:
        _fail(EXIT_CONFLICT, error.code, 'preflight',
              'managed resource recheck is unavailable or unsafe')
    if conflict is not None:
        _fail(EXIT_CONFLICT, conflict, 'preflight',
              'the rechecked target world conflicts with the immutable enrollment')
    outcome = execute_steps(
        descriptor, runner=guarded_runner, state=state, target_id=target_id,
        operation_id=operation_id, fields=fields, secrets=secrets, clock=clock,
        create_policy=create_policy,
    )
    if outcome['status'] != 'ok':
        return _payload(
            fields, 'needs_intervention', outcome['stage'], changed=True,
            lifecycle='quarantined',
            error={'code': outcome['code'],
                   'message': 'the provisioning outcome requires inspection'},
        )
    return _payload(fields, 'ok', 'provisioned', changed=True,
                    lifecycle='provisioned', deployment_ready=True,
                    policy_verified=True, profile=outcome['profile'],
                    policy_revision=outcome['profile']['policy_revision'])


def _catalog_policies(descriptor):
    """Return the bounded set of catalog-authorized SaaS compositions.

    The enrollment binds the catalog bytes, not a mutable tier label. Readback is
    therefore accepted only when it matches one exact base-plus-tier policy.
    """
    try:
        raw = CATALOG_PATH.read_bytes()
        if 'sha256:' + hashlib.sha256(raw).hexdigest() != descriptor['release_ref']['catalog_sha256']:
            return []
        catalog = json.loads(raw)
        base = catalog['base_modules']
        policies = []
        for tier in catalog['tiers']:
            modules = base + tier['modules']
            features = {'users.limit': None, 'storage.limit_mb': None}
            for feature in tier['features']:
                kind, key = feature.split(':', 1)
                features[key] = True if kind == 'boolean' else None
            policy = {'schema_version': 1, 'channel': 'control_plane',
                      'modules': modules, 'features': features}
            encoded = json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()
            validated = parse_create_policy(
                encoded, catalog_path=CATALOG_PATH,
                catalog_sha256=descriptor['release_ref']['catalog_sha256'],
                commercial_mode=descriptor['commercial_mode'])
            policies.append(validated)
        return policies
    except (OSError, ValueError, KeyError, TypeError, PolicyError):
        return []


def _creation_policy(descriptor, state, target_id):
    """Resolve the exact original composition from the durable create receipt."""
    record = state.read(target_id)
    request_id = record.get('request_id') if isinstance(record, dict) else None
    if not isinstance(request_id, str) or not request_id:
        return None
    try:
        row = journal.OperationJournal(os.environ[STATE_ENV]).read_receipt(target_id, request_id)
    except (KeyError, journal.TargetBusy, journal.JournalUnsafe, OSError, ValueError):
        return None
    if (not isinstance(row, dict) or row.get('operation') != 'tenant.create'
            or row.get('status') != 'ok' or row.get('fingerprint') != descriptor['descriptor_digest']
            or not isinstance(row.get('receipt'), dict)):
        return None
    receipt = row['receipt']
    if (receipt.get('target') != target_id or receipt.get('request_id') != request_id
            or receipt.get('operation') != 'tenant.create'
            or receipt.get('status') != 'ok' or receipt.get('policy_verified') is not True
            or receipt.get('deployment_ready') is not True):
        return None
    profile = receipt.get('profile')
    if not isinstance(profile, dict):
        return None
    for policy in _catalog_policies(descriptor):
        try:
            verified = parse_snapshot(
                'NASQ_MANAGED_POLICY:' + json.dumps(profile, allow_nan=False),
                policy, descriptor['resource_refs']['db_name'])
            if verified['policy_revision'] == 1:
                return policy
        except (VerificationError, TypeError, ValueError):
            continue
    return None


def _read_profile(descriptor, target_id, state, runner):
    """Read and bind to DB, immutable descriptor and the original create tier."""
    database = descriptor['resource_refs']['db_name']
    policy = _creation_policy(descriptor, state, target_id)
    if policy is None:
        return None
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
    try:
        code, output, _ = runner(_read_only_shell_argv(descriptor), env,
                                 build_snapshot_script(database))
        if code != 0:
            return None
        profile = parse_snapshot(output, policy, database)
        if profile['policy_revision'] < 1:
            return None
        return profile
    except (OSError, ValueError, TypeError, VerificationError):
        return None


def _bound_lifecycle(state, target_id, descriptor):
    record = state.read(target_id)
    if record is None:
        return 'reserved'
    if (record.get('schema_version') != PROJECTION_SCHEMA_VERSION
            or record.get('target_id') != target_id
            or record.get('descriptor_digest') != descriptor['descriptor_digest']
            or record.get('lifecycle') not in LIFECYCLES):
        return 'quarantined'
    return observed_lifecycle(None, state, target_id, descriptor)


def _read_only(fields, operation, target_id, descriptor, state, runner):
    lifecycle = _bound_lifecycle(state, target_id, descriptor)
    if operation == 'tenant.preflight':
        return EXIT_OK, _payload(fields, 'validated_input', 'preflight',
                                 lifecycle=lifecycle, execution_ready=False)
    if lifecycle != 'provisioned':
        return EXIT_CONFLICT, _payload(
            fields, 'conflict', operation, lifecycle=lifecycle,
            error={'code': 'lifecycle_conflict',
                   'message': 'read-only verification requires a provisioned target'},
        )
    if runner is _subprocess:
        try:
            runner = local_docker_runner()
        except ProcessError:
            return EXIT_CONFLICT, _payload(
                fields, 'conflict', operation, lifecycle=lifecycle,
                error={'code': 'health_unverified' if operation == 'health' else 'snapshot_invalid',
                       'message': 'the approved local Docker endpoint is unavailable'},
            )
    if operation == 'health':
        try:
            healthy = _http_health(descriptor, runner=runner)
        except Exception:  # noqa: BLE001 - observation diagnostics are private
            healthy = False
        if not healthy:
            return EXIT_CONFLICT, _payload(
                fields, 'conflict', 'health', lifecycle=lifecycle,
                error={'code': 'health_unverified',
                       'message': 'fresh container and HTTP observations did not verify'},
            )
    profile = _read_profile(descriptor, target_id, state, runner)
    if profile is None:
        stage = 'health' if operation == 'health' else 'snapshot'
        return EXIT_CONFLICT, _payload(
            fields, 'conflict', stage, lifecycle=lifecycle,
            error={'code': 'snapshot_invalid',
                   'message': 'independent target policy readback did not verify'},
        )
    return EXIT_OK, _payload(
        fields, 'ok', 'health' if operation == 'health' else 'snapshot',
        lifecycle=lifecycle, profile=profile, policy_revision=profile['policy_revision'],
        fingerprint=descriptor['descriptor_digest'], policy_verified=True,
        **({'health_verified': True} if operation == 'health' else {}),
    )


def _request_identity(fields):
    """Keep status lookup arguments out of the original mutation identity."""
    return {key: value for key, value in fields.items()
            if key not in {'policy_bytes_file', 'policy_file'}}


def _status(fields, target_id, descriptor, fingerprint, state_root):
    """Receipt lookup for one bound request.

    Read-only by construction: it receives no runner, no probe and no state
    handle, so it cannot execute a step, observe the world, or write the
    lifecycle projection. It never resolves a row, clears quarantine, or
    activates a tenant.
    """
    if not isinstance(target_id, str) or not TARGET_ID_RE.fullmatch(target_id):
        _fail(EXIT_INVALID_INPUT, 'invalid_input', 'target',
              'a receipt lookup requires a strict managed target id')
    request_id = fields.get('request_id')
    if not isinstance(request_id, str) or not request_id:
        _fail(EXIT_INVALID_INPUT, 'invalid_input', 'request',
              'a receipt lookup requires a request id')
    policy_path = fields.get('policy_bytes_file')
    if not isinstance(policy_path, str):
        _fail(EXIT_INVALID_INPUT, 'invalid_input', 'policy',
              'status requires an independent policy byte file')
    policy_bytes = _private_bytes(
        policy_path, 'policy bytes file', max_bytes=POLICY_MAX_BYTES)
    try:
        store = journal.OperationJournal(state_root)
        row = store.read_receipt(target_id, request_id)
    except journal.TargetBusy:
        _fail(EXIT_CONFLICT, 'target_busy', 'journal',
              'another operation is already running for this target')
    except (journal.JournalUnsafe, OSError):
        _fail(EXIT_NEEDS_INTERVENTION, 'journal_unavailable', 'journal',
              'the durable operation journal is unavailable')
    except ValueError:
        _fail(EXIT_NEEDS_INTERVENTION, 'receipt_invalid', 'journal',
              'the stored receipt is not a usable JSON object')
    if row is None:
        _fail(EXIT_INVALID_INPUT, 'invalid_input', 'journal',
              'request receipt does not exist')
    if not RECEIPT_OPERATION_ID_RE.fullmatch(str(row['operation_id'])):
        _fail(EXIT_NEEDS_INTERVENTION, 'receipt_invalid', 'journal',
              'the stored receipt identity is malformed')
    if row['operation'] not in JOURNALED_OPERATIONS:
        _fail(EXIT_NEEDS_INTERVENTION, 'receipt_invalid', 'journal',
              'the stored receipt names an operation this adapter does not journal')
    if row['operation'] != 'tenant.create':
        _fail(EXIT_NEEDS_INTERVENTION, 'receipt_invalid', 'journal',
              'the stored receipt operation is not verifiable in this slice')
    exit_code = JOURNAL_EXIT.get(row['status'])
    if exit_code is None:
        # A mutating row legitimately carries no receipt body yet, so the settled
        # outcome is checked before the body: reporting a malformed body here
        # would mislabel an in-flight mutation.
        _fail(EXIT_NEEDS_INTERVENTION, 'receipt_unsettled', 'journal',
              'the stored receipt has no settled outcome yet')
    body = row['receipt']
    if (body.get('target') != target_id or body.get('request_id') != request_id
            or body.get('operation') != row['operation']):
        _fail(EXIT_NEEDS_INTERVENTION, 'receipt_invalid', 'journal',
              'the stored receipt is bound to a different target, request or operation')
    if row['fingerprint'] != fingerprint:
        _fail(EXIT_CONFLICT, 'fingerprint_mismatch', 'journal',
              'the stored receipt was created for a different enrollment descriptor')
    if not isinstance(row['digest'], str) or not JOURNAL_DIGEST_RE.fullmatch(row['digest']):
        _fail(EXIT_NEEDS_INTERVENTION, 'receipt_invalid', 'journal',
              'the stored receipt digest is malformed')
    identity_fields = _request_identity(fields)
    identity_fields['operation'] = row['operation']
    expected_digest = journal.payload_digest(
        identity_fields, [policy_bytes, _descriptor_bytes(target_id, descriptor)], fingerprint)
    if row['digest'] != expected_digest:
        _fail(EXIT_CONFLICT, 'policy_digest_mismatch', 'journal',
              'the stored receipt was created for different policy bytes or request data')
    if not isinstance(row['fingerprint'], str) or row['fingerprint'] != fingerprint:
        _fail(EXIT_CONFLICT, 'fingerprint_mismatch', 'journal',
              'the stored receipt was created for a different enrollment descriptor')
    receipt_fields = dict(fields)
    receipt_fields['operation'] = row['operation']
    verified = {}
    if (row['status'] == 'ok' and body.get('policy_verified') is True
            and body.get('deployment_ready') is True):
        try:
            policy = parse_create_policy(
                policy_bytes, catalog_path=CATALOG_PATH,
                catalog_sha256=descriptor['release_ref']['catalog_sha256'],
                commercial_mode=descriptor['commercial_mode'])
            profile = parse_snapshot('NASQ_MANAGED_POLICY:' + json.dumps(body.get('profile')),
                                     policy, descriptor['resource_refs']['db_name'])
            if profile['policy_revision'] != 1:
                _verification_failed('profile_invalid')
            verified = {'policy_verified': True, 'deployment_ready': True,
                        'profile': profile, 'policy_revision': profile['policy_revision']}
        except (PolicyError, VerificationError, TypeError, ValueError):
            _fail(EXIT_NEEDS_INTERVENTION, 'receipt_invalid', 'receipt',
                  'the stored creation evidence is not verifiable')
    return exit_code, _payload(
        receipt_fields, row['status'], str(body.get('stage') or 'receipt'),
        operation_id=row['operation_id'], digest=row['digest'],
        fingerprint=row['fingerprint'], receipt=body,
        **(verified if verified else {'policy_verified': False}),
    )


def _dispatch(fields, *, runner, probe, resolver, clock):
    operation = fields.get('operation')
    target_id = fields.get('target')
    state_root = os.environ.get(STATE_ENV)
    if not state_root:
        _fail(EXIT_INVALID_INPUT, 'invalid_input', 'state',
              f'{STATE_ENV} must name the private operator state directory')
    inventory_path = os.environ.get(MANAGED_INVENTORY_ENV)
    if not inventory_path:
        _fail(EXIT_INVALID_INPUT, 'managed_inventory_required', 'inventory',
              f'{MANAGED_INVENTORY_ENV} must name the private managed inventory')
    document = load_managed_inventory(inventory_path)
    descriptor, fingerprint = descriptor_for(target_id, document)
    validate_descriptor(target_id, descriptor)
    if probe is None:
        probe = DockerProbe(descriptor, catalog_path=CATALOG_PATH, runner=runner)
    # Receipt operations are admissible before the target allowlist, the
    # commercial-mode gate and the static resource checks: reading durable
    # evidence must not depend on the target's current world.
    if operation in RECEIPT_OPERATIONS:
        return _status(fields, target_id, descriptor, fingerprint, state_root)
    _authorize_operation(operation, descriptor)
    root = Path(inventory_path).resolve().parent
    _static_checks(target_id, descriptor, document, root)
    state = ManagedState(state_root)
    if operation in READ_ONLY_OPERATIONS:
        return _read_only(fields, operation, target_id, descriptor, state, runner)
    if operation == 'tenant.entitle':
        lifecycle = observed_lifecycle(None, state, target_id, descriptor)
        if lifecycle != 'provisioned':
            _fail(EXIT_CONFLICT, 'lifecycle_conflict', 'lifecycle',
                  'entitlement requires a provisioned target')
        _fail(EXIT_FAILED_OPERATION, 'policy_application_not_wired', 'entitlement',
              'managed entitlement application is deferred; the scratch entitlement script is not reused')
    request_id = fields.get('request_id')
    if not isinstance(request_id, str) or not request_id:
        _fail(EXIT_INVALID_INPUT, 'invalid_input', 'request',
              'a managed mutation requires a request id')
    if operation == 'tenant.create':
        policy_path = fields.get('policy_file')
        if not isinstance(policy_path, str):
            _fail(EXIT_INVALID_INPUT, 'invalid_input', 'policy',
                  'managed create requires a policy byte file')
        policy_bytes = _private_bytes(
            policy_path, 'policy file', max_bytes=POLICY_MAX_BYTES)
        try:
            create_policy = parse_create_policy(
                policy_bytes, catalog_path=CATALOG_PATH,
                catalog_sha256=descriptor['release_ref']['catalog_sha256'],
                commercial_mode=descriptor['commercial_mode'],
            )
        except PolicyError as error:
            _fail(EXIT_INVALID_INPUT, error.code, 'policy',
                  'managed create policy must match the enrolled catalog composition')
        identity_fields = _request_identity(fields)
        digest = journal.payload_digest(
            identity_fields, [policy_bytes, _descriptor_bytes(target_id, descriptor)],
            fingerprint)
    else:
        policy_bytes = None
        digest = journal.payload_digest(
            fields, [_descriptor_bytes(target_id, descriptor)], fingerprint)
    store = journal.OperationJournal(state_root)
    refused = {}

    def action(operation_id):
        # No refusal may escape to journal.execute: journal.py turns any escaping
        # exception into an uncertain outcome, which would quarantine a target
        # that was refused before any effect. Every refusal is therefore returned
        # as a journal-legal status, and its original exit code is carried out.
        try:
            return _run_mutation(fields, target_id, descriptor, state, probe,
                                 resolver, runner, clock, operation_id, create_policy)
        except ManagedFailure as failure:
            refused['failure'] = failure
            uncertain = failure.exit_code == EXIT_NEEDS_INTERVENTION
            status = 'needs_intervention' if uncertain else 'conflict'
            return _payload(fields, status, failure.stage, changed=uncertain,
                            error={'code': failure.code,
                                   'message': failure.message})

    try:
        result = store.execute(target_id, operation, request_id, digest,
                               fingerprint, action)
    except journal.JournalConflict:
        _fail(EXIT_CONFLICT, 'request_conflict', 'journal',
              'the request id is already bound to different content or target')
    except journal.TargetBusy:
        _fail(EXIT_CONFLICT, 'target_busy', 'journal',
              'another operation is already running for this target')
    except journal.JournalUnsafe:
        _fail(EXIT_NEEDS_INTERVENTION, 'needs_intervention', 'journal',
              'a prior mutation requires inspection before another can start')
    except (OSError, RuntimeError):
        _fail(EXIT_NEEDS_INTERVENTION, 'needs_intervention', 'journal',
              'the operation outcome requires inspection')
    result.setdefault('schema_version', SCHEMA_VERSION)
    failure = refused.get('failure')
    if failure is not None:
        return failure.exit_code, result
    return JOURNAL_EXIT[result['status']], result


def managed_adapter(fields, *, runner=None, probe=None, resolver=None, clock=None):
    """The managed entry seam: validated fields in, (exit code, payload) out."""
    try:
        return _dispatch(
            fields,
            runner=runner if runner is not None else _subprocess,
            probe=probe,
            resolver=resolver if resolver is not None else _resolve_handle,
            clock=clock if clock is not None else _utc_now,
        )
    except ManagedFailure as failure:
        if failure.exit_code == EXIT_NEEDS_INTERVENTION:
            status = 'needs_intervention'
        elif failure.exit_code == EXIT_CONFLICT:
            status = 'conflict'
        else:
            status = 'error'
        return failure.exit_code, _payload(
            fields, status, failure.stage,
            error={'code': failure.code, 'message': failure.message},
        )


def _subprocess(argv, env=None, stdin_text=None):
    """Bounded child execution: argv list, no shell, capped output, hard timeout."""
    return bounded_run(argv, env, stdin_text, timeout=SUBPROCESS_TIMEOUT,
                       output_limit=OUTPUT_LIMIT)


def _resolve_handle(handle):
    """Default secret resolver: an operator-owned file holding the value."""
    return resolve_secret(handle)


def _utc_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def main(argv=None):
    return cli_main(argv, adapter=managed_adapter)


if __name__ == '__main__':
    sys.exit(main())
