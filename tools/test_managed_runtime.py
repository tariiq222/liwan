# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""RED-first contract tests for the single-adapter managed runtime (Package 2).

These tests encode the frozen P2 design
(``docs/verification/2026-09-23-saas-p2-design-review.md``) and the confirmed
Package 2 plan (``docs/superpowers/plans/2026-09-23-saas-p2-managed-runtime-plan.md``).
They are authored before ``tools/nasq_cli/managed_runtime.py`` exists, so the
first run is the RED gate.

The local managed-create acceptance slice now supplies a real catalog-bound
core policy, database-readiness evidence, separate policy and credential
apply/readback snapshots, and explicit synthetic health success. The original guard/refusal/replay assertions
remain; success no longer means merely three zero-exit command results.

Everything here is hermetic: temporary directories and injected
runner/probe/resolver/clock doubles only. No Docker, network, database or
service is touched, and no shared file is modified.

Case groups and their plan ids:

- ``InventoryEnvelopeCase``    T-01..T-06
- ``DescriptorIdentityCase``   T-07..T-12, T-22..T-25
- ``PreflightCollisionCase``   T-13..T-21, T-26, T-27
- ``RefusalSemanticsCase``     T-28..T-30, T-48
- ``ReplayIdempotencyCase``    T-31..T-35
- ``LifecycleCase``            T-36..T-40
- ``FailurePreservationCase``  T-41..T-43
- ``BoundedArgvSecretsCase``   T-44..T-47, T-49
- ``ScratchRegressionCase``    T-50..T-52

T-50..T-52 are a deliberate, minimal in-file regression anchor: the general
scratch operator lane must stay unchanged. The comprehensive scratch suite lives
in ``tools/test_nasq_cli_scratch_guards.py`` and is not duplicated here.

Refusal-stage contract under test:
Phase A (structural, no journal, no effects) refuses with ``status: "error"``.
Phase C (world-dependent, inside the journal action) refuses with
``status: "conflict"`` so the journal never records a false quarantine.
Uncertain outcomes refuse with ``status: "needs_intervention"``.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sqlite3
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# RED gate: the module under test does not exist yet. Detect absence precisely
# (find_spec) so that a genuinely broken import inside the module raises loudly
# instead of being swallowed and reported as "not implemented".
if importlib.util.find_spec('nasq_cli.managed_runtime') is None:
    managed_runtime = None
else:
    from nasq_cli import managed_runtime

from nasq_cli import journal, operator

FIXED_CLOCK = '2026-09-23T00:00:00Z'
_DEFAULT_RECEIPT_BODY = object()
TARGET_A = 'tgt_accept_a_0001'
TARGET_B = 'tgt_accept_b_0002'
INVENTORY_SCHEMA_VERSION = 3
PAYLOAD_SCHEMA_VERSION = 1
IMAGE_A = 'sha256:' + 'a' * 64
IMAGE_WEB = 'sha256:' + 'b' * 64
IMAGE_PROXY = 'sha256:' + 'c' * 64
DB_A = 'nasq_scratch_accept_a'
DB_B = 'nasq_scratch_accept_b'
PROJECT_A = 'nasq-saas-accept-a-local'
CATALOG_PATH = Path(__file__).resolve().parents[1] / 'deploy/catalog/solutions/platform.json'
CORE_POLICY = {
    'schema_version': 1, 'channel': 'control_plane',
    'modules': ['nasq_core', 'nasq_platform', 'nasq_api'],
    'features': {'users.limit': None, 'storage.limit_mb': None},
}

INVENTORY_ENV = 'NASQ_MANAGED_INVENTORY'


def canonical_digest(target_id, descriptor):
    """Independent re-implementation of the documented immutable digest.

    ``sha256:`` over canonical JSON of ``{'target': target_id, 'descriptor': body}``
    with any ``descriptor_digest`` key removed (``sort_keys=True``,
    ``separators=(',', ':')``).
    """
    body = dict(descriptor)
    body.pop('descriptor_digest', None)
    payload = json.dumps(
        {'target': target_id, 'descriptor': body},
        sort_keys=True, separators=(',', ':'), ensure_ascii=False,
    ).encode('utf-8')
    return 'sha256:' + hashlib.sha256(payload).hexdigest()


# --------------------------------------------------------------------------
# injected doubles
# --------------------------------------------------------------------------
class ForbiddenRunner:
    """Runner double that fails the test if any effect is attempted."""

    def __init__(self):
        self.calls = 0

    def __call__(self, argv, env=None, stdin_text=None):
        self.calls += 1
        msg = 'the runner must not be called before a refusal'
        raise AssertionError(msg)


class RecordingRunner:
    """Record argv/env; simulate explicit apply and independent shell readback.

    Only shell invocations yield the sentinel. Explicit scripted/default results
    remain authoritative, so empty stdout cannot silently become policy evidence.
    """

    def __init__(self, results=None, default=None):
        self.calls = []
        self.results = list(results or [])
        self.default = default

    def __call__(self, argv, env=None, stdin_text=None):
        self.calls.append((list(argv), dict(env or {}), stdin_text))
        if self.results:
            return self.results.pop(0)
        if self.default is not None:
            return self.default
        if 'shell' in argv:
            if not isinstance(stdin_text, str) or not stdin_text:
                message = 'a simulated shell requires a script on stdin'
                raise AssertionError(message)
            if 'NASQ_MANAGED_CREDENTIALS:' in stdin_text:
                if '\nsnapshot = False\n' in stdin_text:
                    changed = True
                elif '\nsnapshot = True\n' in stdin_text:
                    changed = False
                else:
                    message = 'credential simulation requires an explicit snapshot mode'
                    raise AssertionError(message)
                credentials = {
                    'database': argv[argv.index('-d') + 1],
                    'changed': changed, 'verified': True,
                }
                return 0, 'NASQ_MANAGED_CREDENTIALS:' + json.dumps(credentials) + '\n', ''
            snapshot = {
                'database': argv[argv.index('-d') + 1],
                'commercial_mode': 'saas', 'entitlement_source': 'control_plane',
                'status': 'active', 'valid_until': None, 'policy_revision': 1,
                'features': CORE_POLICY['features'], 'modules': CORE_POLICY['modules'],
            }
            return 0, 'NASQ_MANAGED_POLICY:' + json.dumps(snapshot) + '\n', ''
        return 0, '', ''

    @property
    def argv(self):
        return [call[0] for call in self.calls]

    def tokens(self):
        return [token for argv in self.argv for token in argv]

    def envs(self):
        return [call[1] for call in self.calls]


class ForbiddenProbe:
    """Probe double that fails the test if resource state is consulted."""

    def __init__(self):
        self.checks = []

    def __call__(self, check, value=None):
        self.checks.append((check, value))
        msg = 'the probe must not be consulted before a refusal'
        raise AssertionError(msg)


class FakeProbe:
    """Read-only observation of a synthetic resource world."""

    def __init__(self, world=None, forbidden=None):
        self.world = dict(world or {})
        self.forbidden = set(forbidden or ())
        self.checks = []

    def __call__(self, check, value=None):
        self.checks.append((check, value))
        if check in self.forbidden:
            raise AssertionError(f'probe {check} must not be consulted')
        if check == 'port_in_use':
            return value in set(self.world.get('ports_in_use', ()))
        if check in ('project_exists', 'volume_exists', 'network_exists'):
            return value in set(self.world.get(check, ()))
        if check == 'database_exists':
            return value in set(self.world.get('databases', ()))
        if check == 'image_identity':
            return self.world.get('image_identities', {}).get(value, value)
        if check == 'catalog_sha256':
            return self.world.get('catalog_sha256')
        if check == 'compose_file':
            return bool(self.world.get('compose_file', True))
        return False


class SequencedProbe(FakeProbe):
    """Introduce one collision only on the second full resource observation."""

    def __init__(self, catalog_sha, *, collision=('project_exists', PROJECT_A),
                 fail_on_recheck=False):
        super().__init__({'catalog_sha256': catalog_sha})
        self.collision = collision
        self.fail_on_recheck = fail_on_recheck
        self.catalog_checks = 0

    def __call__(self, check, value=None):
        if check == 'catalog_sha256':
            self.catalog_checks += 1
        if self.catalog_checks == 2 and (check, value) == self.collision:
            self.checks.append((check, value))
            if self.fail_on_recheck:
                code = 'preflight_unavailable'
                raise managed_runtime.ProbeError(code)
            return True
        return super().__call__(check, value)


class FakeResolver:
    """Secret-handle resolver double. Values are only ever returned, never logged."""

    def __init__(self, secrets=None):
        self.secrets = dict(secrets or {})
        self.handles = []

    def __call__(self, handle):
        self.handles.append(handle)
        if handle not in self.secrets:
            raise KeyError(handle)
        return self.secrets[handle]


# --------------------------------------------------------------------------
# shared fixture
# --------------------------------------------------------------------------
class ManagedRuntimeCase(unittest.TestCase):
    def runtime(self):
        """RED gate: fail individually so the initial run counts every case."""
        if managed_runtime is None:
            self.fail(
                'nasq_cli.managed_runtime is not implemented yet '
                '(expected RED state before the implementation step)',
            )
        return managed_runtime

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = self.root / 'data'
        self.backups = self.root / 'backups'
        self.releases = self.root / 'releases'
        for directory in (self.data, self.backups, self.releases):
            directory.mkdir()
        self.state = self.root / 'state'
        self.compose_file = self.root / 'compose.yml'
        self.compose_file.write_text('services: {}\n')
        self.catalog = self.root / 'catalog.json'
        self.catalog.write_bytes(CATALOG_PATH.read_bytes())
        self.catalog_sha = 'sha256:' + hashlib.sha256(self.catalog.read_bytes()).hexdigest()
        self.secret_value = 'synthetic-secret-value-0123456789'
        self.admin_value = 'synthetic-admin-value-0123456789'
        self.inventory = self.root / 'managed-inventory.json'
        self.policy = self.root / 'policy.json'
        self.policy.write_bytes(json.dumps(CORE_POLICY).encode('utf-8') + b'\n')
        self.base = self.descriptor()
        self.write_inventory({TARGET_A: self.base})
        self.old_env = {name: os.environ.get(name)
                        for name in (INVENTORY_ENV, operator.STATE_ENV)}
        os.environ[INVENTORY_ENV] = str(self.inventory)
        os.environ[operator.STATE_ENV] = str(self.state)
        self.addCleanup(self.restore_env)
        # Every accidental live health call is forbidden. Successful-create
        # helpers override this guard locally with explicit synthetic evidence.
        health_guard = patch.object(self.runtime(), '_http_health',
                                    side_effect=AssertionError('live health is forbidden'))
        self.health_guard = health_guard.start()
        self.addCleanup(health_guard.stop)

    def restore_env(self):
        for name, value in self.old_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    # -- fixture builders -------------------------------------------------
    def descriptor(self, **overrides):
        body = {
            'adapter': {'kind': 'compose-local', 'version': 1},
            'environment_id': 'accept-local',
            'commercial_mode': 'saas',
            'resource_refs': {
                'project': PROJECT_A,
                'compose_file': str(self.compose_file),
                'db_name': DB_A,
                'data_dir': str(self.data),
                'backup_root': str(self.backups),
                'ports': {'db': 55433, 'odoo': 18169, 'web': 13100},
            },
            'secret_refs': {
                'db_password': str(self.root / 'db-password'),
                'admin_password': str(self.root / 'admin-password'),
            },
            'release_ref': {
                'catalog_version': 'ci-test',
                'catalog_sha256': self.catalog_sha,
                'identity_kind': 'image_id',
                'odoo_image': IMAGE_A,
                'web_image': IMAGE_WEB,
                'proxy_image': IMAGE_PROXY,
            },
            'allowed_operations': [
                'tenant.preflight', 'tenant.inspect', 'health',
                'tenant.create', 'tenant.entitle',
            ],
            'revision': 1,
        }
        for key, value in overrides.items():
            if (key in ('adapter', 'resource_refs', 'secret_refs', 'release_ref', 'ports')
                    and isinstance(value, dict)):
                merged = dict(body[key]) if key in body else {}
                merged.update(value)
                body[key] = merged
            else:
                body[key] = value
        body['descriptor_digest'] = canonical_digest(TARGET_A, body)
        return body

    def sibling(self, target_id=TARGET_B, **overrides):
        entry = self.descriptor(**overrides)
        entry['resource_refs'] = dict(entry['resource_refs'])
        entry['resource_refs']['project'] = 'nasq-saas-accept-b-local'
        entry['resource_refs']['db_name'] = DB_B
        entry['resource_refs']['data_dir'] = str(self.root / 'data-b')
        entry['resource_refs']['backup_root'] = str(self.root / 'backups-b')
        entry['resource_refs']['ports'] = {'db': 55434, 'odoo': 18170, 'web': 13101}
        (self.root / 'data-b').mkdir(exist_ok=True)
        (self.root / 'backups-b').mkdir(exist_ok=True)
        entry['descriptor_digest'] = canonical_digest(target_id, entry)
        return entry

    def write_inventory(self, targets, version=INVENTORY_SCHEMA_VERSION):
        self.inventory.write_text(json.dumps({'schema_version': version, 'targets': targets}))

    def rewrite(self, target_id=TARGET_A, **overrides):
        """Replace one descriptor on disk and return it."""
        targets = json.loads(self.inventory.read_text())['targets'] if \
            self.inventory.exists() else {}
        entry = self.descriptor(**overrides) if target_id == TARGET_A \
            else self.sibling(target_id=target_id, **overrides)
        targets[target_id] = entry
        self.write_inventory(targets)
        return entry

    def fields(self, operation='tenant.create', target=TARGET_A, **extra):
        result = {'operation': operation, 'target': target}
        if operation == 'tenant.create':
            result['policy_file'] = str(self.policy)
        if operation in ('tenant.create', 'tenant.entitle', 'backup', 'restore', 'upgrade'):
            result['request_id'] = 'req_0001'
        result.update(extra)
        return result

    def world(self, **overrides):
        base = {
            'ports_in_use': set(),
            'project_exists': set(),
            'volume_exists': set(),
            'network_exists': set(),
            'databases': set(),
            'catalog_sha256': self.catalog_sha,
            'image_identities': {},
        }
        base.update(overrides)
        return base

    def probe(self, **overrides):
        return FakeProbe(self.world(**overrides))

    def resolver(self, **overrides):
        secrets = {
            str(self.root / 'db-password'): self.secret_value,
            str(self.root / 'admin-password'): self.admin_value,
        }
        secrets.update(overrides)
        return FakeResolver(secrets)

    def adapter(self, fields, *, runner=None, probe=None, resolver=None):
        module = self.runtime()
        return module.managed_adapter(
            fields,
            runner=runner if runner is not None else RecordingRunner(),
            probe=probe if probe is not None else self.probe(),
            resolver=resolver if resolver is not None else self.resolver(),
            clock=lambda: FIXED_CLOCK,
        )

    def successful_create(self, runner=None, request_id='req_0001'):
        runner = runner if runner is not None else RecordingRunner()
        with patch.object(self.runtime(), '_http_health', return_value=True) as health:
            code, payload = self.adapter(
                self.fields('tenant.create', request_id=request_id), runner=runner)
        self.assertEqual(code, 0, payload)
        health.assert_called_once()
        self.assertEqual(health.call_args.args[0]['resource_refs']['db_name'], DB_A)
        self.assertEqual(len(runner.calls), 8)
        self.assertIn('pg_isready', runner.argv[1])
        install = runner.argv[2]
        self.assertEqual(install[install.index('-i') + 1], ','.join(CORE_POLICY['modules']))
        shell_calls = [call for call in runner.calls if 'shell' in call[0]]
        self.assertEqual(len(shell_calls), 4, 'policy and credentials each need apply and readback')
        self.assertNotEqual(shell_calls[0][2], shell_calls[1][2])
        self.assertIn('OPERATOR_CONTEXT', shell_calls[0][2])
        self.assertNotIn('OPERATOR_CONTEXT', shell_calls[1][2])
        for call in shell_calls[:2]:
            self.assertIn('NASQ_MANAGED_POLICY:', call[2])
            self.assertNotIn('-e', call[0])
        for call in shell_calls[2:]:
            argv, env, script = call
            self.assertIn('NASQ_MANAGED_CREDENTIALS:', script)
            self.assertEqual(argv[argv.index('-e') + 1], 'NASQ_ADMIN_PASSWORD')
            self.assertLess(argv.index('-e'), argv.index('odoo'))
            self.assertEqual(env['NASQ_ADMIN_PASSWORD'], self.admin_value)
            for secret in (self.secret_value, self.admin_value):
                self.assertNotIn(secret, ' '.join(argv))
                self.assertNotIn(secret, script)
        self.assertIn('\nsnapshot = False\n', shell_calls[2][2])
        self.assertIn('\nsnapshot = True\n', shell_calls[3][2])
        self.assertIn("_nasq_access_write({'password': secret}", shell_calls[2][2])
        self.assertNotIn('_nasq_access_write', shell_calls[3][2])
        self.assertIn('SET TRANSACTION READ ONLY', shell_calls[3][2])
        self.assertEqual(runner.argv[-1][-2:], ['up', '-d'])
        self.assertIs(payload['policy_verified'], True)
        self.assertEqual(payload['profile']['features'], CORE_POLICY['features'])
        self.assertEqual(payload['expected_modules'], ['nasq_api', 'nasq_core', 'nasq_platform'])
        return code, payload, runner

    def failed_create(self, runner=None, request_id='req_0001'):
        runner = runner if runner is not None else RecordingRunner(
            results=[(0, '', ''), (0, '', ''), (1, 'boom', '')])
        return self.adapter(self.fields('tenant.create', request_id=request_id), runner=runner)

    def error_code(self, payload):
        return (payload.get('error') or {}).get('code')

    def projection_path(self, target_id=TARGET_A):
        key = hashlib.sha256(target_id.encode('utf-8')).hexdigest()
        return self.state / 'managed' / f'{key}.json'

    def projection(self, target_id=TARGET_A):
        return self.runtime().ManagedState(self.state).read(target_id)

    def journal_rows(self):
        """Read the real on-disk operation journal, not a double."""
        path = self.state / 'operations.sqlite3'
        if not path.exists():
            return []
        connection = sqlite3.connect(str(path))
        try:
            return connection.execute(
                'SELECT target, request_id, operation, status FROM operations'
                ' ORDER BY rowid',
            ).fetchall()
        finally:
            connection.close()

    def unresolved_journal_rows(self):
        return [row for row in self.journal_rows()
                if row[3] in ('mutating', 'needs_intervention')]

    def refuse(self, expected_code, expected_error, *, fields=None, runner=None,
               probe=None, resolver=None):
        """Assert a pre-effect refusal.

        By default the probe is forbidden too: a Phase A (structural) refusal
        must be decided without consulting resource state at all. Phase C
        (world-dependent) refusals pass an explicit probe.
        """
        runner = runner if runner is not None else ForbiddenRunner()
        probe = probe if probe is not None else ForbiddenProbe()
        code, payload = self.adapter(
            fields if fields is not None else self.fields('tenant.create'),
            runner=runner, probe=probe, resolver=resolver)
        self.assertEqual(code, expected_code, payload)
        self.assertEqual(self.error_code(payload), expected_error, payload)
        self.assertEqual(runner.calls, 0, 'a pre-effect refusal must precede any effect')
        if isinstance(probe, ForbiddenProbe):
            self.assertEqual(probe.checks, [],
                             'a structural refusal must not consult resource state')
        return payload


# --------------------------------------------------------------------------
# T-01..T-06 inventory envelope
# --------------------------------------------------------------------------
class InventoryEnvelopeCase(ManagedRuntimeCase):
    def test_t01_managed_inventory_env_is_required(self):
        module = self.runtime()
        os.environ.pop(module.MANAGED_INVENTORY_ENV, None)
        runner = ForbiddenRunner()
        probe = ForbiddenProbe()
        code, payload = self.adapter(
            self.fields('tenant.create'), runner=runner, probe=probe)
        self.assertEqual(code, 2, payload)
        self.assertEqual(self.error_code(payload), 'managed_inventory_required')
        self.assertEqual(runner.calls, 0)
        self.assertEqual(probe.checks, [])

    def test_t02_unknown_target_is_invalid_input(self):
        runner = ForbiddenRunner()
        probe = ForbiddenProbe()
        code, payload = self.adapter(
            self.fields('tenant.create', target='tgt_absent_9999'),
            runner=runner, probe=probe)
        self.assertEqual(code, 2, payload)
        self.assertEqual(self.error_code(payload), 'target_unknown')
        self.assertEqual(runner.calls, 0)
        self.assertEqual(probe.checks, [])

    def test_t03_inventory_document_is_strict_and_private(self):
        self.inventory.write_text(json.dumps({
            'schema_version': INVENTORY_SCHEMA_VERSION,
            'targets': {TARGET_A: self.base},
            'extra': 1,
        }))
        payload = self.refuse(2, 'inventory_invalid',
                              fields=self.fields('tenant.inspect'))
        self.assertEqual(payload['status'], 'error')
        self.write_inventory({TARGET_A: self.base})
        os.chmod(self.inventory, 0o666)
        self.addCleanup(os.chmod, self.inventory, 0o600)
        payload = self.refuse(3, 'descriptor_not_private',
                              fields=self.fields('tenant.inspect'))
        self.assertEqual(payload['status'], 'error')

    def test_t04_schema_version_is_enforced(self):
        self.write_inventory({TARGET_A: self.base}, version=2)
        self.refuse(2, 'inventory_invalid')

    def test_t05_target_descriptor_is_strict(self):
        incomplete = dict(self.base)
        incomplete.pop('resource_refs')
        self.write_inventory({TARGET_A: incomplete})
        self.refuse(2, 'descriptor_invalid')
        extra = dict(self.base)
        extra['unexpected'] = True
        extra['descriptor_digest'] = canonical_digest(TARGET_A, extra)
        self.write_inventory({TARGET_A: extra})
        self.refuse(2, 'descriptor_invalid')

    def test_t06_lifecycle_field_is_refused_not_ignored(self):
        for key in ('lifecycle', 'state', 'status'):
            with self.subTest(key=key):
                entry = dict(self.base)
                entry.pop('descriptor_digest', None)
                entry[key] = 'provisioned'
                entry['descriptor_digest'] = canonical_digest(TARGET_A, entry)
                self.write_inventory({TARGET_A: entry})
                self.refuse(2, 'descriptor_invalid')


# --------------------------------------------------------------------------
# T-07..T-12, T-22..T-25 descriptor identity
# --------------------------------------------------------------------------
class DescriptorIdentityCase(ManagedRuntimeCase):
    def test_t07_descriptor_digest_is_stable(self):
        module = self.runtime()
        first = module.descriptor_digest(TARGET_A, self.base)
        second = module.descriptor_digest(TARGET_A, dict(self.base))
        self.assertEqual(first, second)
        self.assertEqual(first, self.base['descriptor_digest'])
        self.assertEqual(first, canonical_digest(TARGET_A, self.base))

    def test_t08_descriptor_digest_covers_every_field(self):
        module = self.runtime()
        baseline = module.descriptor_digest(TARGET_A, self.base)
        for override in (
            {'environment_id': 'other-env'},
            {'commercial_mode': 'non_saas'},
            {'revision': 2},
            {'adapter': {'kind': 'compose-local', 'version': 2}},
            {'resource_refs': {'db_name': DB_B}},
            {'resource_refs': {'ports': {'db': 55444}}},
            {'secret_refs': {'db_password': str(self.root / 'other-secret')}},
            {'release_ref': {'catalog_version': 'ci-test-2'}},
            {'allowed_operations': ['tenant.inspect']},
        ):
            with self.subTest(**override):
                entry = self.descriptor(**override)
                self.assertNotEqual(module.descriptor_digest(TARGET_A, entry), baseline)

    def test_t09_descriptor_digest_ignores_journal_state(self):
        module = self.runtime()
        before = module.descriptor_digest(TARGET_A, self.base)
        self.successful_create()
        self.assertEqual(module.descriptor_digest(TARGET_A, self.base), before)
        stored = json.loads(self.inventory.read_text())['targets'][TARGET_A]
        self.assertEqual(stored, self.base)

    def test_t10_descriptor_digest_mismatch_is_refused(self):
        tampered = dict(self.base)
        tampered['environment_id'] = 'tampered-env'
        self.write_inventory({TARGET_A: tampered})
        self.refuse(3, 'descriptor_digest_mismatch')

    def test_t11_adapter_kind_must_be_compose_local(self):
        for adapter in ({'kind': 'native-local', 'version': 1},
                        {'kind': 'compose-local', 'version': 99}):
            with self.subTest(adapter=adapter):
                self.write_inventory({TARGET_A: self.descriptor(adapter=adapter)})
                self.refuse(3, 'adapter_unapproved')

    def test_t12_operation_not_allowed_is_refused(self):
        for operation in ('backup', 'restore', 'upgrade'):
            with self.subTest(operation=operation):
                self.refuse(3, 'operation_not_allowed',
                            fields=self.fields(operation))

    def test_t22_identity_kind_is_exclusive(self):
        self.write_inventory({TARGET_A: self.descriptor(
            release_ref={'identity_kind': None})})
        self.refuse(2, 'descriptor_invalid')
        self.write_inventory({TARGET_A: self.descriptor(
            release_ref={'identity_kind': 'manifest_and_config'})})
        self.refuse(2, 'descriptor_invalid')

    def test_t23_repo_digest_without_digest_is_refused(self):
        self.write_inventory({TARGET_A: self.descriptor(
            release_ref={'identity_kind': 'repo_digest'})})
        payload = self.refuse(4, 'image_identity_untrusted',
                              probe=self.probe(image_identities={IMAGE_A: None}))
        self.assertEqual(payload['status'], 'conflict')

    def test_t24_image_identity_mismatch_is_refused(self):
        payload = self.refuse(
            4, 'image_identity_untrusted',
            probe=self.probe(image_identities={IMAGE_A: 'sha256:' + 'd' * 64}))
        self.assertEqual(payload['status'], 'conflict')

    def test_t25_catalog_digest_mismatch_is_refused(self):
        payload = self.refuse(
            4, 'catalog_digest_mismatch',
            probe=self.probe(catalog_sha256='sha256:' + 'e' * 64))
        self.assertEqual(payload['status'], 'conflict')


# --------------------------------------------------------------------------
# T-13..T-21, T-26, T-27 collision and conflict preflight
# --------------------------------------------------------------------------
class PreflightCollisionCase(ManagedRuntimeCase):
    def test_t13_non_saas_without_binding_is_refused(self):
        self.write_inventory({TARGET_A: self.descriptor(commercial_mode='non_saas')})
        self.refuse(3, 'commercial_mode_forbidden')

    def test_t14_existing_database_is_refused(self):
        payload = self.refuse(4, 'database_exists', probe=self.probe(databases={DB_A}))
        self.assertEqual(payload['status'], 'conflict')

    def test_t15_disallowed_target_database_is_refused(self):
        for db_name in ('odoo19', 'production', 'nasq_scratch_prod', 'nasq_demo',
                        'nasq_scratch_odoo19'):
            with self.subTest(db_name=db_name):
                self.write_inventory({TARGET_A: self.descriptor(
                    resource_refs={'db_name': db_name})})
                self.refuse(3, 'target_disallowed')

    def test_t16_shared_port_is_refused(self):
        self.refuse(4, 'port_shared', probe=self.probe(ports_in_use={55433}))

    def test_t17_shared_project_is_refused(self):
        self.refuse(4, 'project_shared', probe=self.probe(project_exists={PROJECT_A}))

    def test_t18_shared_volume_is_refused(self):
        self.refuse(4, 'volume_shared',
                    probe=self.probe(volume_exists={f'{PROJECT_A}-db'}))

    def test_t19_shared_network_is_refused(self):
        self.refuse(4, 'network_shared',
                    probe=self.probe(network_exists={f'{PROJECT_A}-private'}))

    def test_t20_control_plane_overlap_is_refused(self):
        for ports in ({'db': 55432}, {'odoo': 14179}, {'web': 3000},
                      {'db': 5432}, {'odoo': 8069}, {'web': 80}, {'web': 443}):
            with self.subTest(ports=ports):
                merged = {'db': 55433, 'odoo': 18169, 'web': 13100}
                merged.update(ports)
                self.write_inventory({TARGET_A: self.descriptor(
                    resource_refs={'ports': merged})})
                payload = self.refuse(3, 'control_plane_overlap')
                self.assertEqual(payload['status'], 'error')
        self.write_inventory({TARGET_A: self.descriptor(
            resource_refs={'project': 'nasq-saas-control-local'})})
        self.refuse(3, 'control_plane_overlap')

    def test_t21_sibling_descriptors_cannot_share_resources(self):
        colliding = self.sibling()
        colliding['resource_refs'] = dict(colliding['resource_refs'])
        colliding['resource_refs']['db_name'] = DB_A
        colliding['descriptor_digest'] = canonical_digest(TARGET_B, colliding)
        self.write_inventory({TARGET_A: self.base, TARGET_B: colliding})
        runner = ForbiddenRunner()
        code, payload = self.adapter(
            self.fields('tenant.create', target=TARGET_B), runner=runner)
        self.assertEqual(code, 3, payload)
        self.assertEqual(self.error_code(payload), 'resource_alias_forbidden')
        self.assertEqual(runner.calls, 0)

    def test_t26_compose_file_confined_to_descriptor_root(self):
        outside = Path(tempfile.mkdtemp()) / 'compose.yml'
        outside.write_text('services: {}\n')
        self.addCleanup(outside.unlink)
        self.write_inventory({TARGET_A: self.descriptor(
            resource_refs={'compose_file': str(outside)})})
        self.refuse(3, 'compose_file_invalid')
        self.write_inventory({TARGET_A: self.descriptor(
            resource_refs={'compose_file': str(self.root / 'absent.yml')})})
        self.refuse(3, 'compose_file_invalid')

    def test_t27_missing_secret_handle_is_refused(self):
        payload = self.refuse(4, 'secret_unavailable', probe=self.probe(),
                              resolver=FakeResolver({}))
        self.assertEqual(payload['status'], 'conflict')
        self.assertNotIn(self.secret_value, json.dumps(payload))

    def test_new_resource_after_initial_preflight_refuses_before_db_up(self):
        collisions = (
            ('database_exists', DB_A, 'database_exists'),
            ('project_exists', PROJECT_A, 'project_shared'),
            ('volume_exists', f'{PROJECT_A}-db', 'volume_shared'),
            ('network_exists', f'{PROJECT_A}-private', 'network_shared'),
            ('port_in_use', 55433, 'port_shared'),
        )
        for check, value, expected in collisions:
            with self.subTest(check=check):
                probe = SequencedProbe(self.catalog_sha, collision=(check, value))
                runner = ForbiddenRunner()
                code, payload = self.adapter(
                    self.fields('tenant.create', request_id=f'req_race_{check}'),
                    runner=runner, probe=probe)
                self.assertEqual(code, 4, payload)
                self.assertEqual(self.error_code(payload), expected)
                self.assertEqual(payload['status'], 'conflict')
                self.assertIs(payload['changed'], False)
                self.assertEqual(payload['stage'], 'preflight')
                self.assertEqual(probe.catalog_checks, 2, 'complete preflight must rerun')
                self.assertEqual(runner.calls, 0)
                self.assertIsNone(self.projection())
                self.assertEqual(self.unresolved_journal_rows(), [])
        self.assertEqual([row[3] for row in self.journal_rows()], ['conflict'] * 5)

    def test_recheck_probe_failure_is_no_effect_conflict(self):
        probe = SequencedProbe(self.catalog_sha, fail_on_recheck=True)
        payload = self.refuse(4, 'preflight_unavailable', probe=probe)
        self.assertEqual(payload['status'], 'conflict')
        self.assertIs(payload['changed'], False)
        self.assertEqual(probe.catalog_checks, 2)
        self.assertEqual(self.journal_rows()[0][3], 'conflict')
        self.assertIsNone(self.projection())

    def test_complete_recheck_precedes_first_runner_call(self):
        probe = self.probe()
        observed_at_first_effect = []
        recording = RecordingRunner()

        def runner(argv, env=None, stdin_text=None):
            if not observed_at_first_effect:
                observed_at_first_effect.extend(probe.checks)
            return recording(argv, env, stdin_text)

        with patch.object(self.runtime(), '_http_health', return_value=True):
            code, payload = self.adapter(self.fields('tenant.create'),
                                         runner=runner, probe=probe)
        self.assertEqual(code, 0, payload)
        checks = [name for name, _value in observed_at_first_effect]
        self.assertEqual(checks.count('catalog_sha256'), 2)
        for name in ('image_identity', 'compose_file', 'database_exists',
                     'project_exists', 'volume_exists', 'network_exists', 'port_in_use'):
            self.assertEqual(checks.count(name),
                             {'image_identity': 6, 'port_in_use': 6}.get(name, 2))
        self.assertEqual(recording.argv[0][-3:], ['up', '-d', 'db'])


# --------------------------------------------------------------------------
# T-28..T-30, T-48 refusal semantics and the exit-code contract
# --------------------------------------------------------------------------
class RefusalSemanticsCase(ManagedRuntimeCase):
    def test_t28_phase_c_refusals_return_conflict_status(self):
        scenarios = {
            'database_exists': {'databases': {DB_A}},
            'port_shared': {'ports_in_use': {55433}},
            'project_shared': {'project_exists': {PROJECT_A}},
            'volume_shared': {'volume_exists': {f'{PROJECT_A}-db'}},
            'network_shared': {'network_exists': {f'{PROJECT_A}-private'}},
            'catalog_digest_mismatch': {'catalog_sha256': 'sha256:' + 'e' * 64},
            'image_identity_untrusted': {
                'image_identities': {IMAGE_A: 'sha256:' + 'd' * 64}},
        }
        for expected, world in scenarios.items():
            with self.subTest(scenario=expected):
                # Each scenario is a distinct request: a Phase C conflict binds its
                # request id to the recorded outcome, so ids must not be reused here.
                code, payload = self.adapter(
                    self.fields('tenant.create', request_id=f'req_{expected}'),
                    runner=ForbiddenRunner(), probe=self.probe(**world))
                self.assertEqual(code, 4, payload)
                self.assertEqual(payload['status'], 'conflict', payload)
                self.assertEqual(self.error_code(payload), expected)
                self.assertNotEqual(payload['status'], 'error')
                self.assertNotEqual(payload['status'], 'needs_intervention')
        self.successful_create()
        code, payload = self.adapter(
            self.fields('tenant.create', request_id='req_0002'),
            runner=ForbiddenRunner(), probe=self.probe())
        self.assertEqual(code, 4, payload)
        self.assertEqual(payload['status'], 'conflict')
        self.assertEqual(self.error_code(payload), 'lifecycle_conflict')

    def test_t29_refusal_does_not_quarantine_target(self):
        self.refuse(4, 'database_exists', probe=self.probe(databases={DB_A}))
        self.assertIsNone(self.projection())
        _, payload, runner = self.successful_create(request_id='req_0002')
        self.assertEqual(payload['lifecycle'], 'provisioned')
        self.assertTrue(runner.argv)

    def test_t30_phase_a_refusal_writes_no_receipt(self):
        self.write_inventory({TARGET_A: self.descriptor(
            adapter={'kind': 'native-local', 'version': 1})})
        code, payload = self.adapter(
            self.fields('tenant.create', request_id='req_phase_a'),
            runner=ForbiddenRunner())
        self.assertEqual(code, 3, payload)
        self.write_inventory({TARGET_A: self.base})
        runner = RecordingRunner()
        code, payload, _ = self.successful_create(runner=runner, request_id='req_phase_a')
        self.assertEqual(code, 0, payload)
        self.assertTrue(runner.argv)

    def test_t53_phase_c_refusal_records_conflict_not_uncertainty(self):
        """A no-effect refusal must never be recorded as an uncertain outcome.

        This reads the real on-disk ``OperationJournal``, so it fails if a Phase C
        refusal ever escapes the journal action: ``journal.py`` converts any
        escaping exception into ``needs_intervention``, which would quarantine a
        target that was refused before any effect.

        The refusal path is deliberately given a runner that raises if reached.
        """
        # (1) Collision refusal: recorded as a conflict, not as uncertainty.
        payload = self.refuse(4, 'database_exists', probe=self.probe(databases={DB_A}))
        self.assertEqual(payload['status'], 'conflict')
        self.assertIsNone(self.projection(), 'a refusal must not write a projection')
        self.assertEqual(self.journal_rows(), [
            (TARGET_A, 'req_0001', 'tenant.create', 'conflict'),
        ])
        self.assertEqual(self.unresolved_journal_rows(), [])

        # (2) The target is not quarantined: a fresh request is still admitted.
        _, admitted, runner = self.successful_create(request_id='req_0002')
        self.assertEqual(admitted['status'], 'ok')
        self.assertTrue(runner.argv)

        # (3) Lifecycle refusal on the now-provisioned target behaves the same way.
        refusal = self.refuse(4, 'lifecycle_conflict',
                              fields=self.fields('tenant.create', request_id='req_0003'),
                              probe=self.probe())
        self.assertEqual(refusal['status'], 'conflict')
        statuses = {row[1]: row[3] for row in self.journal_rows()}
        self.assertEqual(statuses['req_0003'], 'conflict')
        self.assertEqual(statuses['req_0002'], 'ok')
        self.assertEqual(self.unresolved_journal_rows(), [])
        self.assertEqual(self.projection()['lifecycle'], 'provisioned')

    def test_t48_exit_codes_match_the_contract(self):
        table = {
            'managed_inventory_required': (2, 'error'),
            'target_unknown': (2, 'error'),
            'descriptor_invalid': (2, 'error'),
            'inventory_invalid': (2, 'error'),
            'descriptor_digest_mismatch': (3, 'error'),
            'descriptor_not_private': (3, 'error'),
            'adapter_unapproved': (3, 'error'),
            'operation_not_allowed': (3, 'error'),
            'commercial_mode_forbidden': (3, 'error'),
            'target_disallowed': (3, 'error'),
            'control_plane_overlap': (3, 'error'),
            'compose_file_invalid': (3, 'error'),
            'resource_alias_forbidden': (3, 'error'),
            'database_exists': (4, 'conflict'),
            'port_shared': (4, 'conflict'),
            'project_shared': (4, 'conflict'),
            'volume_shared': (4, 'conflict'),
            'network_shared': (4, 'conflict'),
            'image_identity_untrusted': (4, 'conflict'),
            'catalog_digest_mismatch': (4, 'conflict'),
            'secret_unavailable': (4, 'conflict'),
            'request_conflict': (4, 'conflict'),
            'lifecycle_conflict': (4, 'conflict'),
            'provisioning_interrupted': (6, 'needs_intervention'),
        }
        observed = {}

        def record(name, result):
            observed[name] = result

        os.environ.pop(INVENTORY_ENV, None)
        record('managed_inventory_required',
               self.adapter(self.fields('tenant.create'), runner=ForbiddenRunner()))
        os.environ[INVENTORY_ENV] = str(self.inventory)
        record('target_unknown', self.adapter(
            self.fields('tenant.create', target='tgt_absent_1'), runner=ForbiddenRunner()))
        self.write_inventory({'broken': 1})
        record('inventory_invalid', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        self.write_inventory({TARGET_A: self.descriptor(revision='one')})
        record('descriptor_invalid', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        self.write_inventory({TARGET_A: self.descriptor()})
        os.chmod(self.inventory, 0o666)
        record('descriptor_not_private', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        os.chmod(self.inventory, 0o600)
        tampered = self.descriptor()
        tampered['environment_id'] = 'tampered'
        self.write_inventory({TARGET_A: tampered})
        record('descriptor_digest_mismatch', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        self.write_inventory({TARGET_A: self.descriptor(
            adapter={'kind': 'native-local', 'version': 1})})
        record('adapter_unapproved', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        self.write_inventory({TARGET_A: self.base})
        record('operation_not_allowed', self.adapter(
            self.fields('backup'), runner=ForbiddenRunner()))
        self.write_inventory({TARGET_A: self.descriptor(commercial_mode='non_saas')})
        record('commercial_mode_forbidden', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        self.write_inventory({TARGET_A: self.descriptor(
            resource_refs={'db_name': 'odoo19'})})
        record('target_disallowed', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        self.write_inventory({TARGET_A: self.descriptor(
            resource_refs={'ports': {'db': 55432, 'odoo': 18169, 'web': 13100}})})
        record('control_plane_overlap', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        self.write_inventory({TARGET_A: self.descriptor(
            resource_refs={'compose_file': str(self.root / 'absent.yml')})})
        record('compose_file_invalid', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        colliding = self.sibling()
        colliding['resource_refs'] = dict(colliding['resource_refs'])
        colliding['resource_refs']['db_name'] = DB_A
        colliding['descriptor_digest'] = canonical_digest(TARGET_B, colliding)
        self.write_inventory({TARGET_A: self.base, TARGET_B: colliding})
        record('resource_alias_forbidden', self.adapter(
            self.fields('tenant.create', target=TARGET_B), runner=ForbiddenRunner()))
        self.write_inventory({TARGET_A: self.base})
        for name, world in (
            ('database_exists', {'databases': {DB_A}}),
            ('port_shared', {'ports_in_use': {55433}}),
            ('project_shared', {'project_exists': {PROJECT_A}}),
            ('volume_shared', {'volume_exists': {f'{PROJECT_A}-db'}}),
            ('network_shared', {'network_exists': {f'{PROJECT_A}-private'}}),
            ('image_identity_untrusted',
             {'image_identities': {IMAGE_A: 'sha256:' + 'd' * 64}}),
            ('catalog_digest_mismatch', {'catalog_sha256': 'sha256:' + 'e' * 64}),
        ):
            # A conflict binds its request id to that outcome, so each Phase C
            # scenario needs its own identity.
            record(name, self.adapter(
                self.fields('tenant.create', request_id=f'req_{name}'),
                runner=ForbiddenRunner(), probe=self.probe(**world)))
        record('secret_unavailable', self.adapter(
            self.fields('tenant.create', request_id='req_secret'),
            runner=ForbiddenRunner(), resolver=FakeResolver({})))
        self.successful_create()
        # Reusing the bound request id with changed descriptor content conflicts;
        # a byte-identical replay would instead return the original receipt.
        self.rewrite(environment_id='accept-local-2')
        record('request_conflict', self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner()))
        record('lifecycle_conflict', self.adapter(
            self.fields('tenant.create', request_id='req_0002'),
            runner=ForbiddenRunner()))
        isolated = self.state / 'isolated'
        previous = os.environ[operator.STATE_ENV]
        os.environ[operator.STATE_ENV] = str(isolated)
        try:
            record('provisioning_interrupted',
                   self.failed_create(request_id='req_0003'))
        finally:
            os.environ[operator.STATE_ENV] = previous

        self.assertEqual(set(observed), set(table))
        for name, (code, payload) in observed.items():
            with self.subTest(name=name):
                self.assertEqual(code, table[name][0], f'{name}: {payload}')
                self.assertEqual(payload['status'], table[name][1], f'{name}: {payload}')


# --------------------------------------------------------------------------
# T-63..T-70 managed status receipt lookup (G-1 receipt operation)
# --------------------------------------------------------------------------
class StatusReceiptCase(ManagedRuntimeCase):
    def status_fields(self, request_id='req_0001', policy_path=None):
        return self.fields(
            'status', request_id=request_id,
            policy_bytes_file=str(policy_path or self.policy))

    def seed_journal_row(self, request_id, *, operation='tenant.create', operation_id=None,
                         digest='a' * 64, fingerprint=None, status='ok',
                         body=_DEFAULT_RECEIPT_BODY):
        """Write a journal row directly, bypassing the adapter, to probe validation."""
        if operation_id is None:
            operation_id = 'op_' + 'c' * 32
        if fingerprint is None:
            fingerprint = self.base['descriptor_digest']
        if digest == 'a' * 64:
            digest = journal.payload_digest(
                {'operation': operation, 'target': TARGET_A,
                 'request_id': request_id},
                [self.policy.read_bytes(), managed_runtime._descriptor_bytes(
                    TARGET_A, self.base)], fingerprint)
        if body is _DEFAULT_RECEIPT_BODY:
            body = {'target': TARGET_A, 'request_id': request_id, 'operation': operation,
                    'status': status, 'stage': 'provisioned'}
        payload = json.dumps(body) if isinstance(body, dict) else body
        store = journal.OperationJournal(self.state)
        with store._connection() as db:
            db.execute('DELETE FROM operations WHERE target = ?', (TARGET_A,))
            db.execute('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                       (TARGET_A, request_id, operation_id, operation, digest,
                        fingerprint, status, payload))
            db.commit()

    def raw_journal_row(self, request_id):
        path = self.state / 'operations.sqlite3'
        connection = sqlite3.connect(str(path))
        try:
            return connection.execute(
                'SELECT operation_id, operation, digest, fingerprint, status, receipt'
                ' FROM operations WHERE target = ? AND request_id = ?',
                (TARGET_A, request_id)).fetchone()
        finally:
            connection.close()

    def test_t63_status_returns_the_stored_receipt(self):
        _, created, _create_runner = self.successful_create()
        runner = ForbiddenRunner()
        probe = ForbiddenProbe()
        code, payload = self.adapter(self.status_fields(), runner=runner, probe=probe)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['status'], 'ok', payload)
        self.assertEqual(payload['operation'], 'tenant.create')
        self.assertEqual(payload['receipt']['operation'], 'tenant.create')
        self.assertEqual(payload['operation_id'], created['operation_id'])
        self.assertEqual(payload['request_id'], 'req_0001')
        self.assertEqual(payload['target'], TARGET_A)
        self.assertEqual(payload['fingerprint'], self.base['descriptor_digest'])
        self.assertTrue(payload['digest'])
        self.assertEqual(payload['receipt']['stage'], 'provisioned')
        self.assertIs(payload['policy_verified'], True)
        self.assertIs(payload['deployment_ready'], True)
        self.assertEqual(payload['profile']['features'], CORE_POLICY['features'])
        self.assertEqual(payload['profile']['policy_revision'], 1)

    def test_status_requires_independent_policy_bytes_and_rejects_mismatch(self):
        self.successful_create()
        runner, probe = ForbiddenRunner(), ForbiddenProbe()
        missing = self.fields('status', request_id='req_0001')
        code, payload = self.adapter(missing, runner=runner, probe=probe)
        self.assertEqual(code, 2, payload)
        self.assertEqual(self.error_code(payload), 'invalid_input')
        self.assertEqual(runner.calls, 0)
        self.assertEqual(probe.checks, [])

        other = self.root / 'other-policy.json'
        other.write_bytes(self.policy.read_bytes() + b' ')
        before_rows, before_projection = self.journal_rows(), self.projection()
        code, payload = self.adapter(
            self.status_fields(policy_path=other), runner=runner, probe=probe)
        self.assertEqual(code, 4, payload)
        self.assertEqual(self.error_code(payload), 'policy_digest_mismatch')
        self.assertIs(payload.get('policy_verified'), None)
        self.assertNotIn(self.secret_value, json.dumps(payload))
        self.assertEqual(self.journal_rows(), before_rows)
        self.assertEqual(self.projection(), before_projection)
        self.assertEqual(runner.calls, 0)
        self.assertEqual(probe.checks, [])

    def test_t64_status_has_no_effects(self):
        _, _, create_runner = self.successful_create()
        calls_after_create = len(create_runner.calls)
        projection_before = self.projection()
        rows_before = self.journal_rows()
        receipt_before = self.raw_journal_row('req_0001')
        runner = ForbiddenRunner()
        probe = ForbiddenProbe()
        code, payload = self.adapter(self.status_fields(), runner=runner, probe=probe)
        self.assertEqual(code, 0)
        # no runner, no probe, no projection write, no journal mutation, no new row
        self.assertEqual(runner.calls, 0)
        self.assertEqual(probe.checks, [])
        self.assertEqual(len(create_runner.calls), calls_after_create)
        self.assertEqual(self.projection(), projection_before)
        self.assertEqual(self.journal_rows(), rows_before)
        self.assertEqual(self.raw_journal_row('req_0001'), receipt_before)
        self.assertEqual(payload['operation'], 'tenant.create')
        self.assertIs(payload['policy_verified'], True)
        self.assertIs(payload['deployment_ready'], True)
        self.assertEqual(payload['profile']['features'], CORE_POLICY['features'])
        self.assertEqual(payload['expected_modules'], ['nasq_api', 'nasq_core', 'nasq_platform'])
        self.assertEqual(payload['profile']['policy_revision'], 1)

    def test_legacy_incomplete_receipt_stays_unverified_and_read_only(self):
        self.seed_journal_row('req_legacy')
        before = self.raw_journal_row('req_legacy')
        runner, probe = ForbiddenRunner(), ForbiddenProbe()
        code, payload = self.adapter(self.status_fields('req_legacy'), runner=runner, probe=probe)
        self.assertEqual(code, 0, payload)
        self.assertIs(payload['policy_verified'], False)
        self.assertIsNot(payload.get('deployment_ready'), True)
        self.assertNotIn('profile', payload)
        self.assertEqual(self.raw_journal_row('req_legacy'), before)
        self.assertIsNone(self.projection())
        self.assertEqual(runner.calls, 0)
        self.assertEqual(probe.checks, [])
        self.health_guard.assert_not_called()

    def test_t65_status_missing_receipt_is_bounded(self):
        runner = ForbiddenRunner()
        probe = ForbiddenProbe()
        code, payload = self.adapter(self.status_fields('req_absent'),
                                     runner=runner, probe=probe)
        self.assertNotEqual(code, 0)
        self.assertEqual(payload['status'], 'error')
        self.assertEqual(self.error_code(payload), 'invalid_input')
        self.assertEqual(runner.calls, 0)
        self.assertEqual(probe.checks, [])

    def test_t66_status_is_exempt_from_the_descriptor_allowlist(self):
        self.write_inventory({TARGET_A: self.descriptor(
            allowed_operations=['tenant.create'])})
        _, created, _ = self.successful_create()
        code, payload = self.adapter(self.status_fields(),
                                     runner=ForbiddenRunner(), probe=ForbiddenProbe())
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['operation_id'], created['operation_id'])
        # a target operation outside the descriptor list is still refused
        refusal = self.refuse(3, 'operation_not_allowed',
                              fields=self.fields('tenant.inspect'))
        self.assertEqual(refusal['status'], 'error')

    def test_t67_status_is_permitted_on_a_quarantined_target(self):
        code, failed = self.failed_create()
        self.assertEqual(code, 6, failed)
        self.assertEqual(self.projection()['lifecycle'], 'quarantined')
        rows_before = self.journal_rows()
        code, payload = self.adapter(self.status_fields(),
                                     runner=ForbiddenRunner(), probe=ForbiddenProbe())
        self.assertEqual(code, 6, payload)
        self.assertEqual(payload['status'], 'needs_intervention')
        # it neither clears the row nor changes the projection
        self.assertEqual(self.projection()['lifecycle'], 'quarantined')
        self.assertEqual(self.journal_rows(), rows_before)

    def test_t68_status_fails_closed_on_a_non_object_or_corrupt_body(self):
        for body in ('[]', '[1, 2]', '"text"', '5', 'null', 'not json at all'):
            with self.subTest(body=body):
                self.seed_journal_row('req_bad_body', body=body)
                code, payload = self.adapter(
                    self.status_fields('req_bad_body'),
                    runner=ForbiddenRunner(), probe=ForbiddenProbe())
                self.assertEqual(code, 6, payload)
                self.assertEqual(payload['status'], 'needs_intervention')
                self.assertEqual(self.error_code(payload), 'receipt_invalid')

    def test_t69_status_rejects_a_mismatched_enrollment_fingerprint(self):
        self.successful_create()
        self.rewrite(environment_id='accept-local-2')
        code, payload = self.adapter(self.status_fields(),
                                     runner=ForbiddenRunner(), probe=ForbiddenProbe())
        self.assertEqual(code, 4, payload)
        self.assertEqual(payload['status'], 'conflict')
        self.assertEqual(self.error_code(payload), 'fingerprint_mismatch')

    def test_t70_status_rejects_a_malformed_or_foreign_receipt(self):
        cases = (
            ('req_bad_id', {'operation_id': 'op_zzz'}),
            ('req_foreign', {'operation': 'upgrade'}),
            ('req_bad_digest', {'digest': 'not-a-digest'}),
            ('req_other_target', {'body': {'target': 'tgt_other_1',
                                           'request_id': 'req_other_target'}}),
        )
        for request_id, overrides in cases:
            with self.subTest(request_id=request_id):
                self.seed_journal_row(request_id, **overrides)
                code, payload = self.adapter(
                    self.status_fields(request_id),
                    runner=ForbiddenRunner(), probe=ForbiddenProbe())
                self.assertEqual(code, 6, payload)
                self.assertEqual(payload['status'], 'needs_intervention')
                self.assertEqual(self.error_code(payload), 'receipt_invalid')

    def test_t71_status_on_a_mutating_row_is_unsettled_and_unchanged(self):
        self.seed_journal_row('req_mutating', status='mutating', body=None)
        code, payload = self.adapter(self.status_fields('req_mutating'),
                                     runner=ForbiddenRunner(), probe=ForbiddenProbe())
        self.assertEqual(code, 6, payload)
        self.assertEqual(payload['status'], 'needs_intervention')
        self.assertEqual(self.error_code(payload), 'receipt_unsettled')
        # the lookup did not transition the row
        self.assertEqual(self.raw_journal_row('req_mutating')[4], 'mutating')


# --------------------------------------------------------------------------
# T-31..T-35 replay and idempotency
# --------------------------------------------------------------------------
class ReplayIdempotencyCase(ManagedRuntimeCase):
    def test_t31_replay_does_not_rerun_preflight(self):
        _, first, runner = self.successful_create()
        alternate_policy = self.root / 'same-policy-other-path.json'
        alternate_policy.write_bytes(self.policy.read_bytes())
        self.policy = alternate_policy
        calls_after_create = len(runner.calls)
        replay_runner = ForbiddenRunner()
        code, second = self.adapter(
            self.fields('tenant.create'), runner=replay_runner,
            probe=self.probe(databases={DB_A}))
        self.assertEqual(code, 0, second)
        self.assertEqual(second['operation_id'], first['operation_id'])
        self.assertEqual(replay_runner.calls, 0)
        self.assertEqual(len(runner.calls), calls_after_create)

    def test_t32_replay_returns_original_receipt(self):
        _, first, _ = self.successful_create()
        code, second = self.adapter(
            self.fields('tenant.create'), runner=ForbiddenRunner())
        self.assertEqual(code, 0, second)
        for key in ('operation_id', 'request_id', 'target', 'operation'):
            self.assertEqual(second[key], first[key], key)
        self.assertEqual(second['status'], 'ok')
        self.assertIs(second['changed'], True)

    def test_policy_byte_change_with_same_request_id_conflicts(self):
        self.successful_create()
        self.policy.write_bytes(self.policy.read_bytes() + b' ')
        runner = ForbiddenRunner()
        code, payload = self.adapter(self.fields('tenant.create'), runner=runner)
        self.assertEqual(code, 4, payload)
        self.assertEqual(self.error_code(payload), 'request_conflict')
        self.assertEqual(runner.calls, 0)

    def test_t33_changed_content_with_same_request_id_conflicts(self):
        self.successful_create()
        self.rewrite(environment_id='accept-local-2')
        runner = ForbiddenRunner()
        code, payload = self.adapter(self.fields('tenant.create'), runner=runner)
        self.assertEqual(code, 4, payload)
        self.assertEqual(self.error_code(payload), 'request_conflict')
        self.assertEqual(runner.calls, 0)

    def test_t34_request_id_cannot_cross_targets(self):
        self.successful_create()
        self.write_inventory({TARGET_A: self.base, TARGET_B: self.sibling()})
        runner = ForbiddenRunner()
        code, payload = self.adapter(
            self.fields('tenant.create', target=TARGET_B), runner=runner)
        self.assertEqual(code, 4, payload)
        self.assertEqual(self.error_code(payload), 'request_conflict')
        self.assertEqual(runner.calls, 0)

    def test_t35_unresolved_mutation_blocks_new_request(self):
        _, payload = self.failed_create()
        self.assertEqual(payload['status'], 'needs_intervention', payload)
        code, blocked = self.adapter(
            self.fields('tenant.create', request_id='req_0002'),
            runner=ForbiddenRunner())
        self.assertEqual(code, 6, blocked)
        self.assertEqual(blocked['status'], 'needs_intervention')


# --------------------------------------------------------------------------
# T-36..T-40 lifecycle
# --------------------------------------------------------------------------
class LifecycleCase(ManagedRuntimeCase):
    def test_health_stays_unverified_without_a_target_probe(self):
        runner = ForbiddenRunner()
        with patch.object(self.runtime(), '_http_health', return_value=False):
            code, payload = self.adapter(self.fields('health'), runner=runner)
        self.assertEqual(code, 4, payload)
        self.assertEqual(payload['status'], 'conflict')
        self.assertEqual(payload['error']['code'], 'lifecycle_conflict')
        self.assertEqual(runner.calls, 0)

    def test_inspect_reads_policy_snapshot_and_returns_safe_profile(self):
        self.successful_create()
        runner = RecordingRunner()
        code, payload = self.adapter(self.fields('tenant.inspect'), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['stage'], 'snapshot')
        self.assertEqual(payload['profile']['modules'], CORE_POLICY['modules'])
        self.assertEqual(payload['profile']['features'], CORE_POLICY['features'])
        self.assertEqual(payload['policy_revision'], 1)
        self.assertEqual(len(runner.calls), 1)
        argv, _env, script = runner.calls[0]
        self.assertIn('exec', argv)
        self.assertIn('shell', argv)
        self.assertIn('SET TRANSACTION READ ONLY', script)
        self.assertNotIn('write(', script)
        self.assertEqual(payload['fingerprint'], self.base['descriptor_digest'])

    def test_inspect_rejects_policy_drift_and_wrong_database(self):
        self.successful_create()

        def mismatched(argv, env=None, stdin_text=None):
            if 'shell' not in argv:
                return 0, '', ''
            snapshot = {
                'database': DB_A, 'commercial_mode': 'saas',
                'entitlement_source': 'control_plane', 'status': 'active',
                'valid_until': None, 'policy_revision': 2,
                'features': CORE_POLICY['features'],
                'modules': [*CORE_POLICY['modules'], 'nasq_unknown'],
            }
            return 0, 'NASQ_MANAGED_POLICY:' + json.dumps(snapshot) + '\\n', ''

        code, payload = self.adapter(self.fields('tenant.inspect'), runner=mismatched)
        self.assertEqual(code, 4, payload)
        self.assertNotIn('profile', payload)
        self.assertEqual(payload['error']['code'], 'snapshot_invalid')

    def test_inspect_rejects_readback_from_another_valid_catalog_tier(self):
        self.successful_create()

        def other_tier(argv, env=None, stdin_text=None):
            if 'shell' not in argv:
                return 0, '', ''
            snapshot = {
                'database': DB_A, 'commercial_mode': 'saas',
                'entitlement_source': 'control_plane', 'status': 'active',
                'valid_until': None, 'policy_revision': 2,
                'features': {'users.limit': None, 'storage.limit_mb': None,
                             'hr.enabled': True},
                'modules': ['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_hr'],
            }
            return 0, 'NASQ_MANAGED_POLICY:' + json.dumps(snapshot) + '\\n', ''

        code, payload = self.adapter(self.fields('tenant.inspect'), runner=other_tier)
        self.assertEqual(code, 4, payload)
        self.assertEqual(payload['error']['code'], 'snapshot_invalid')
        self.assertNotIn('profile', payload)

    def test_inspect_quarantine_does_not_probe_target_or_claim_profile(self):
        self.runtime().ManagedState(self.state).write(TARGET_A, {
            'schema_version': 1, 'target_id': TARGET_A,
            'descriptor_digest': self.base['descriptor_digest'],
            'stage': 'interrupted', 'request_id': 'req_0001',
            'lifecycle': 'quarantined', 'updated_at': FIXED_CLOCK,
        })
        runner = ForbiddenRunner()
        code, payload = self.adapter(self.fields('tenant.inspect'), runner=runner)
        self.assertEqual(code, 4, payload)
        self.assertNotIn('profile', payload)
        self.assertEqual(runner.calls, 0)

    def test_health_freshly_checks_http_then_database_policy(self):
        self.successful_create()
        runner = RecordingRunner()
        with patch.object(self.runtime(), '_http_health', return_value=True) as health:
            code, payload = self.adapter(self.fields('health'), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['profile']['policy_revision'], 1)
        self.assertEqual(runner.calls[0][0][runner.calls[0][0].index('shell')], 'shell')
        health.assert_called_once()

    def test_health_quarantine_skips_all_probes(self):
        self.runtime().ManagedState(self.state).write(TARGET_A, {
            'schema_version': 1, 'target_id': TARGET_A,
            'descriptor_digest': self.base['descriptor_digest'],
            'stage': 'interrupted', 'request_id': 'req_0001',
            'lifecycle': 'quarantined', 'updated_at': FIXED_CLOCK,
        })
        runner = ForbiddenRunner()
        with patch.object(self.runtime(), '_http_health') as health:
            code, payload = self.adapter(self.fields('health'), runner=runner)
        self.assertEqual(code, 4, payload)
        self.assertEqual(runner.calls, 0)
        health.assert_not_called()

    def test_t36_reserved_admits_create(self):
        code, payload, runner = self.successful_create()
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['status'], 'ok', payload)
        self.assertEqual(payload['stage'], 'provisioned', payload)
        self.assertIs(payload['changed'], True)
        self.assertIs(payload['deployment_ready'], True)
        self.assertEqual(payload['lifecycle'], 'provisioned')
        self.assertTrue(runner.argv)

    def test_t37_provisioned_refuses_second_create(self):
        self.successful_create()
        self.refuse(4, 'lifecycle_conflict',
                    fields=self.fields('tenant.create', request_id='req_0002'),
                    probe=self.probe())

    def test_t38_quarantined_refuses_mutations(self):
        module = self.runtime()
        module.ManagedState(self.state).write(TARGET_A, {
            'schema_version': module.PROJECTION_SCHEMA_VERSION,
            'target_id': TARGET_A,
            'descriptor_digest': self.base['descriptor_digest'],
            'stage': 'provisioning_interrupted',
            'request_id': 'req_0001',
            'lifecycle': 'quarantined',
            'updated_at': FIXED_CLOCK,
        })
        self.refuse(4, 'lifecycle_conflict',
                    fields=self.fields('tenant.create', request_id='req_0003'),
                    probe=self.probe())
        runner = ForbiddenRunner()
        code, payload = self.adapter(
            self.fields('tenant.inspect'), runner=runner)
        self.assertEqual(code, 4, payload)
        self.assertEqual(payload['lifecycle'], 'quarantined')
        self.assertNotIn('profile', payload)
        self.assertEqual(runner.calls, 0)

    def test_t39_lifecycle_projection_survives_restart(self):
        module = self.runtime()
        self.successful_create()
        record = module.ManagedState(self.state).read(TARGET_A)
        self.assertIsNotNone(record)
        self.assertEqual(record['lifecycle'], 'provisioned')
        self.assertEqual(record['descriptor_digest'], self.base['descriptor_digest'])
        code, payload = self.adapter(
            self.fields('tenant.inspect'), runner=RecordingRunner())
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['lifecycle'], 'provisioned')

    def test_t40_projection_is_private(self):
        self.successful_create()
        path = self.projection_path()
        self.assertTrue(path.is_file(), path)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        json.loads(path.read_text())
        leftovers = [item.name for item in path.parent.iterdir() if item.name != path.name]
        self.assertEqual(leftovers, [], 'no partial or temporary projection may remain')


# --------------------------------------------------------------------------
# T-41..T-43 non-destructive failure preservation
# --------------------------------------------------------------------------
class FailurePreservationCase(ManagedRuntimeCase):
    def test_t41_interrupted_create_preserves_resources(self):
        runner = RecordingRunner(results=[(0, '', ''), (0, '', ''), (1, 'boom', '')])
        code, payload = self.failed_create(runner=runner)
        self.assertEqual(code, 6, payload)
        self.assertEqual(payload['status'], 'needs_intervention', payload)
        record = self.projection()
        self.assertIsNotNone(record, 'the failure stage must be preserved')
        self.assertEqual(record['lifecycle'], 'quarantined')
        self.assertTrue(record['stage'])
        self.assertNotEqual(record['stage'], 'reserved')
        tokens = runner.tokens()
        self.assertNotIn('down', tokens)
        self.assertNotIn('rm', tokens)
        self.assertNotIn('kill', tokens)

    def test_t42_no_destructive_argv_is_emitted(self):
        runner = RecordingRunner(results=[(0, '', ''), (0, '', ''), (1, 'boom', '')])
        self.failed_create(runner=runner)
        tokens = runner.tokens()
        for verb in ('down', 'rm', 'kill', 'prune'):
            self.assertNotIn(verb, tokens, verb)
        # A one-shot container legitimately uses the --rm flag; that is not `rm`.
        self.assertIn('--rm', tokens)
        # Every child invocation is a bounded docker compose argv list.
        self.assertTrue(runner.argv)
        for argv in runner.argv:
            self.assertEqual(argv[:2], ['docker', 'compose'], argv)

    def test_t43_uncertain_outcome_quarantines(self):
        code, payload = self.failed_create()
        self.assertEqual(code, 6, payload)
        self.assertEqual(payload['status'], 'needs_intervention')
        self.assertIs(payload['changed'], True)
        self.assertEqual(self.projection()['lifecycle'], 'quarantined')


# --------------------------------------------------------------------------
# T-44..T-47, T-49 bounded argv, secrets and the CLI surface
# --------------------------------------------------------------------------
class BoundedArgvSecretsCase(ManagedRuntimeCase):
    def test_t44_compose_argv_is_bounded_and_listed(self):
        module = self.runtime()
        argv = module.build_compose_argv(self.base, 'db.up')
        self.assertIsInstance(argv, list)
        self.assertTrue(all(isinstance(item, str) for item in argv))
        self.assertEqual(argv[0], 'docker')
        self.assertEqual(argv[1], 'compose')
        self.assertIn('-p', argv)
        self.assertEqual(argv[argv.index('-p') + 1], PROJECT_A)
        self.assertIn('-f', argv)
        self.assertEqual(argv[argv.index('-f') + 1], str(self.compose_file))
        self.assertNotIn('--privileged', argv)
        self.assertNotIn(';', ' '.join(argv))
        install = module.build_compose_argv(
            self.base, 'modules.install', modules=CORE_POLICY['modules'])
        self.assertEqual(install[install.index('-i') + 1], ','.join(CORE_POLICY['modules']))
        with self.assertRaises(module.ManagedFailure) as caught:
            module.build_compose_argv(self.base, 'modules.install')
        self.assertEqual(caught.exception.code, 'policy_invalid')

    def test_t45_argv_rejects_injection(self):
        for db_name in ('nasq_scratch_a;rm -rf /', 'nasq_scratch_a\n--privileged',
                        'nasq_scratch_$(id)', 'nasq_scratch_a`id`'):
            with self.subTest(db_name=db_name):
                self.write_inventory({TARGET_A: self.descriptor(
                    resource_refs={'db_name': db_name})})
                runner = RecordingRunner()
                code, payload = self.adapter(self.fields('tenant.create'), runner=runner)
                self.assertIn(code, (2, 3), payload)
                self.assertEqual(payload['status'], 'error')
                self.assertEqual(runner.calls, [])

    def test_t46_secret_value_never_enters_argv_or_receipt(self):
        _, payload, runner = self.successful_create()
        flat = ' '.join(runner.tokens())
        serialized = json.dumps(payload)
        for secret in (self.secret_value, self.admin_value):
            self.assertNotIn(secret, flat)
            self.assertNotIn(secret, serialized)
        carrying = [env for env in runner.envs()
                    if self.secret_value in env.values() or self.admin_value in env.values()]
        self.assertTrue(carrying, 'secrets must reach the child through env only')

    def test_t47_receipt_is_sanitized(self):
        _, payload, _ = self.successful_create()
        serialized = json.dumps(payload)
        for private in (str(self.data), str(self.backups), str(self.compose_file),
                        str(self.root / 'db-password'), str(self.root / 'admin-password')):
            self.assertNotIn(private, serialized, private)
        self.assertNotIn('stdout', serialized)
        self.assertNotIn('stderr', serialized)
        self.assertNotIn('secret_ref', serialized)

    def test_t49_stdout_is_one_json_document(self):
        module = self.runtime()
        self.successful_create()
        stream = io.StringIO()
        runner = RecordingRunner()
        with patch.object(module, 'local_docker_runner', return_value=runner):
            with contextlib.redirect_stdout(stream):
                code = module.main(['tenant', 'inspect', '--target', TARGET_A, '--json'])
        self.assertEqual(code, 0)
        lines = [line for line in stream.getvalue().splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, lines)
        payload = json.loads(lines[0])
        self.assertEqual(payload['target'], TARGET_A)
        self.assertEqual(payload['schema_version'], PAYLOAD_SCHEMA_VERSION)


# --------------------------------------------------------------------------
# T-50..T-52 scratch-lane regression anchor
# --------------------------------------------------------------------------
class ScratchRegressionCase(ManagedRuntimeCase):
    def scratch_entry(self, kind='scratch'):
        for name in ('odoo-bin', 'psql', 'pg_dump', 'pg_restore', 'createdb'):
            (self.root / name).write_text('fixture')
        addons = self.root / 'addons'
        for module in operator.CREATE_MODULES:
            (addons / module).mkdir(parents=True, exist_ok=True)
            (addons / module / '__manifest__.py').write_text('{}')
        (self.root / 'classification.json').write_text(json.dumps({
            'schema_version': 1, 'database': 'nasq_scratch_demo',
            'commercial_mode': 'non_saas', 'entitlement_source': 'local_policy',
            'expected_valid_until': None, 'valid_until_action': 'preserve',
        }))
        return {
            'database': 'nasq_scratch_demo', 'kind': kind,
            'pg_host': '127.0.0.1', 'pg_port': 5432, 'pg_user': 'scratch_user',
            'python': sys.executable, 'odoo_bin': str(self.root / 'odoo-bin'),
            'addons_paths': [str(addons)], 'data_dir': str(self.data),
            'psql': str(self.root / 'psql'), 'pg_dump': str(self.root / 'pg_dump'),
            'pg_restore': str(self.root / 'pg_restore'),
            'createdb': str(self.root / 'createdb'),
            'backup_root': str(self.backups), 'release_root': str(self.releases),
            'classification_file': str(self.root / 'classification.json'),
        }

    def install_scratch_inventory(self, entry):
        path = self.root / 'inventory-v2.json'
        path.write_text(json.dumps({'version': 2, 'targets': {'demo': entry}}))
        previous = os.environ.get(operator.INVENTORY_ENV)
        os.environ[operator.INVENTORY_ENV] = str(path)
        self.addCleanup(self._restore, operator.INVENTORY_ENV, previous)

    def _restore(self, name, value):
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value

    def test_t50_scratch_operator_guard_unchanged(self):
        self.install_scratch_inventory(self.scratch_entry(kind='customer'))
        runner = ForbiddenRunner()
        code, payload = operator.operation_adapter(
            {'operation': 'tenant.inspect', 'target': 'demo'}, runner=runner)
        self.assertEqual(code, 3, payload)
        self.assertEqual(payload['error']['code'], 'target_forbidden')
        self.assertEqual(runner.calls, 0)

    def test_t51_v2_entry_keys_unchanged(self):
        expected = {
            'database', 'kind', 'pg_host', 'pg_port', 'pg_user', 'python', 'odoo_bin',
            'addons_paths', 'data_dir', 'psql', 'pg_dump', 'pg_restore', 'createdb',
            'backup_root', 'release_root', 'classification_file',
        }
        self.assertEqual(len(operator.ENTRY_KEYS), 16)
        self.assertEqual(operator.ENTRY_KEYS, frozenset(expected))

    def test_t52_scratch_lane_still_admitted(self):
        self.install_scratch_inventory(self.scratch_entry())

        def runner(argv, env=None, stdin_text=None):
            if 'features::text' in argv[-1]:
                return 0, json.dumps({'users.limit': 25, 'storage.limit_mb': None}) + '\n', ''
            return 0, 'non_saas\x1flocal_policy\x1f\x1f3\x1f1\x1factive\n', ''

        code, payload = operator.operation_adapter(
            {'operation': 'tenant.inspect', 'target': 'demo'}, runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['stage'], 'snapshot')
        self.assertEqual(payload['profile']['policy_revision'], 3)


if __name__ == '__main__':
    unittest.main()
