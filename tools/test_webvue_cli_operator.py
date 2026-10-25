# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Focused local operation journal tests. External commands are never started."""
import fcntl
import inspect
import json
import os
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

import check_cp2_scratch
from webvue_cli import journal, operator

from deploy import backup as backup_wrapper


class JournalCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.store = journal.OperationJournal(self.root / 'state')

    def test_replay_does_not_repeat_action_and_changed_content_conflicts(self):
        calls = []

        def action(operation_id):
            calls.append(operation_id)
            return {'status': 'ok', 'stage': 'done', 'changed': True}
        first = self.store.execute('demo', 'tenant.entitle', 'req_1', 'digest-a',
                                   'fingerprint-a', action)
        second = journal.OperationJournal(self.root / 'state').execute(
            'demo', 'tenant.entitle', 'req_1', 'digest-a', 'fingerprint-a', action)
        self.assertEqual(first['operation_id'], second['operation_id'])
        self.assertEqual(second['status'], 'ok')
        self.assertEqual(len(calls), 1)
        with self.assertRaises(journal.JournalConflict):
            self.store.execute('demo', 'tenant.entitle', 'req_1', 'digest-b',
                               'fingerprint-a', action)
        with self.assertRaises(journal.JournalConflict):
            self.store.execute('demo', 'tenant.entitle', 'req_1', 'digest-a',
                               'fingerprint-b', action)
        with self.assertRaises(journal.JournalConflict):
            self.store.execute('other', 'tenant.entitle', 'req_1', 'digest-a',
                               'fingerprint-a', action)

    def test_crash_after_mutation_entry_needs_intervention_on_restart(self):
        def crash(_operation_id):
            msg = 'simulated process failure'
            raise RuntimeError(msg)
        with self.assertRaises(RuntimeError):
            self.store.execute('demo', 'backup', 'req_1', 'digest-a',
                               'fingerprint-a', crash)
        restarted = journal.OperationJournal(self.root / 'state')
        receipt = restarted.inspect('demo', 'req_1')
        self.assertEqual(receipt['status'], 'needs_intervention')
        called = []
        replay = restarted.execute('demo', 'backup', 'req_1', 'digest-a',
                                   'fingerprint-a', lambda _id: called.append(True))
        self.assertEqual(replay['status'], 'needs_intervention')
        self.assertEqual(called, [])
        with self.assertRaises(journal.JournalUnsafe):
            restarted.execute('demo', 'backup', 'req_2', 'digest-b',
                              'fingerprint-a', lambda _id: called.append(True))
        self.assertEqual(called, [])
        self.assertIsNone(restarted.inspect('demo', 'req_2'))

    def test_unfinished_entry_blocks_a_new_request_before_status_inspection(self):
        with self.store._connection() as db:
            db.execute('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                       ('demo', 'req_1', 'op_' + 'a' * 32, 'backup',
                        'digest-a', 'fingerprint-a', 'mutating', None))
            db.commit()
        called = []
        with self.assertRaises(journal.JournalUnsafe):
            self.store.execute('demo', 'backup', 'req_2', 'digest-b',
                               'fingerprint-a', lambda _id: called.append(True))
        self.assertEqual(called, [])
        self.assertEqual(self.store.inspect('demo', 'req_1')['status'],
                         'needs_intervention')

    def test_live_per_target_os_lock_refuses_second_worker(self):
        lock_path = self.store.lock_path('demo')
        with lock_path.open('a+b') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(journal.TargetBusy):
                journal.OperationJournal(self.root / 'state').execute(
                    'demo', 'backup', 'req_1', 'digest-a', 'fingerprint-a',
                    lambda _id: {'status': 'ok'})
            fcntl.flock(handle, fcntl.LOCK_UN)

    def test_digest_includes_file_bytes_and_target_fingerprint(self):
        path = self.root / 'policy.json'
        path.write_text(json.dumps({'features': {'x': False}}))
        first = journal.payload_digest({'operation': 'tenant.entitle'}, [path], 'target-a')
        path.write_text(json.dumps({'features': {'x': True}}))
        self.assertNotEqual(first, journal.payload_digest(
            {'operation': 'tenant.entitle'}, [path], 'target-a'))
        path.write_text(json.dumps({'features': {'x': False}}))
        self.assertNotEqual(first, journal.payload_digest(
            {'operation': 'tenant.entitle'}, [path], 'target-b'))

    def test_backup_lookup_cannot_cross_targets(self):
        receipt = self.store.execute('demo', 'backup', 'req_1', 'digest-a', 'fingerprint-a',
                                     lambda _id: {'status': 'ok', 'stage': 'candidate_backup',
                                                  'changed': True})
        self.assertEqual(self.store.find_operation('demo', receipt['operation_id'])['status'], 'ok')
        self.assertIsNone(self.store.find_operation('other', receipt['operation_id']))

    def _operations_snapshot(self):
        with self.store._connection() as db:
            return db.execute(
                'SELECT target, request_id, operation_id, operation, digest,'
                ' fingerprint, status, receipt FROM operations'
                ' ORDER BY target, request_id',
            ).fetchall()

    def test_read_receipt_returns_identity_and_stored_receipt(self):
        receipt = self.store.execute(
            'demo', 'tenant.create', 'req_1', 'digest-a', 'fingerprint-a',
            lambda _id: {'status': 'ok', 'stage': 'provisioned', 'changed': True,
                         'deployment_ready': False},
        )
        read = self.store.read_receipt('demo', 'req_1')
        self.assertEqual(read['status'], 'ok')
        self.assertEqual(read['operation_id'], receipt['operation_id'])
        self.assertEqual(read['operation'], 'tenant.create')
        self.assertEqual(read['digest'], 'digest-a')
        self.assertEqual(read['fingerprint'], 'fingerprint-a')
        self.assertEqual(read['receipt']['stage'], 'provisioned')
        self.assertIs(read['receipt']['deployment_ready'], False)
        self.assertEqual(read['receipt']['operation'], 'tenant.create')

    def test_read_receipt_leaves_a_mutating_row_mutating(self):
        with self.store._connection() as db:
            db.execute('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                       ('demo', 'req_1', 'op_' + 'a' * 32, 'tenant.create',
                        'digest-a', 'fingerprint-a', 'mutating', None))
            db.commit()
        read = self.store.read_receipt('demo', 'req_1')
        self.assertEqual(read['status'], 'mutating')
        self.assertEqual(read['receipt'], {})
        self.assertEqual(read['operation_id'], 'op_' + 'a' * 32)
        self.assertEqual(read['operation'], 'tenant.create')
        self.assertEqual(read['digest'], 'digest-a')
        self.assertEqual(read['fingerprint'], 'fingerprint-a')
        with self.store._connection() as db:
            status, receipt = db.execute(
                'SELECT status, receipt FROM operations'
                ' WHERE target = ? AND request_id = ?',
                ('demo', 'req_1'),
            ).fetchone()
        self.assertEqual(status, 'mutating')
        self.assertIsNone(receipt)

    def test_read_receipt_writes_nothing_for_any_status(self):
        self.store.execute('demo', 'tenant.create', 'req_ok', 'digest-a', 'fingerprint-a',
                           lambda _id: {'status': 'ok', 'stage': 'done', 'changed': True})
        self.store.execute('demo', 'tenant.create', 'req_conflict', 'digest-b', 'fingerprint-a',
                           lambda _id: {'status': 'conflict', 'stage': 'preflight', 'changed': False})
        with self.store._connection() as db:
            db.execute('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                       ('demo', 'req_mutating', 'op_' + 'a' * 32, 'tenant.create',
                        'digest-c', 'fingerprint-a', 'mutating', None))
            db.commit()
        before = self._operations_snapshot()
        for request_id in ('req_ok', 'req_conflict', 'req_mutating', 'req_absent'):
            self.store.read_receipt('demo', request_id)
        self.assertEqual(self._operations_snapshot(), before)

    def test_read_receipt_absent_request_is_none(self):
        self.assertIsNone(self.store.read_receipt('demo', 'req_absent'))

    def test_read_receipt_defaults_operation_without_rewriting_the_row(self):
        payload = json.dumps({'status': 'ok', 'stage': 'done'})
        with self.store._connection() as db:
            db.execute('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                       ('demo', 'req_1', 'op_' + 'b' * 32, 'tenant.inspect',
                        'digest-a', 'fingerprint-a', 'ok', payload))
            db.commit()
        read = self.store.read_receipt('demo', 'req_1')
        self.assertEqual(read['receipt']['operation'], 'tenant.inspect')
        self.assertEqual(read['receipt']['stage'], 'done')
        with self.store._connection() as db:
            stored = db.execute(
                'SELECT receipt FROM operations WHERE target = ? AND request_id = ?',
                ('demo', 'req_1'),
            ).fetchone()[0]
        self.assertEqual(stored, payload)

    def test_read_receipt_refuses_a_held_target_lock(self):
        lock_path = self.store.lock_path('demo')
        with lock_path.open('a+b') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(journal.TargetBusy):
                self.store.read_receipt('demo', 'req_1')
            fcntl.flock(handle, fcntl.LOCK_UN)

    def test_read_receipt_never_calls_a_mutating_journal_method(self):
        source = inspect.getsource(journal.OperationJournal.read_receipt)
        for forbidden in ('_uncertain(', '.inspect(', '.find_operation(', '.execute('):
            self.assertNotIn(forbidden, source, forbidden)

    def _store_raw_receipt(self, request_id, payload):
        with self.store._connection() as db:
            db.execute('DELETE FROM operations WHERE target = ?', ('demo',))
            db.execute('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                       ('demo', request_id, 'op_' + 'c' * 32, 'tenant.inspect',
                        'digest-a', 'fingerprint-a', 'ok', payload))
            db.commit()

    def test_read_receipt_rejects_valid_non_object_json_bodies(self):
        # A stored body that parses to a list, string, number, boolean or JSON
        # null is corrupt data, not an absent receipt: it must raise rather than
        # be silently reported as {}.
        for payload in ('[]', '[1, 2]', '"text"', '5', 'true', 'null'):
            with self.subTest(payload=payload):
                self._store_raw_receipt('req_1', payload)
                with self.assertRaises(ValueError):
                    self.store.read_receipt('demo', 'req_1')

    def test_read_receipt_distinguishes_sql_null_from_json_null(self):
        with self.store._connection() as db:
            db.execute('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                       ('demo', 'req_sql_null', 'op_' + 'd' * 32, 'tenant.inspect',
                        'digest-a', 'fingerprint-a', 'ok', None))
            db.execute('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                       ('demo', 'req_json_null', 'op_' + 'e' * 32, 'tenant.inspect',
                        'digest-a', 'fingerprint-a', 'ok', 'null'))
            db.commit()
        self.assertEqual(self.store.read_receipt('demo', 'req_sql_null')['receipt'], {})
        with self.assertRaises(ValueError):
            self.store.read_receipt('demo', 'req_json_null')

    def test_read_receipt_rejects_invalid_json(self):
        self._store_raw_receipt('req_1', 'not json at all')
        with self.assertRaises(ValueError):
            self.store.read_receipt('demo', 'req_1')


class OperatorCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / 'state'
        self.data = self.root / 'data'
        self.backups = self.root / 'backups'
        self.releases = self.root / 'releases'
        self.addons = self.root / 'addons'
        for directory in (self.data, self.backups, self.releases, self.addons):
            directory.mkdir()
        for module in operator.CREATE_MODULES:
            module_dir = self.addons / module
            module_dir.mkdir()
            (module_dir / '__manifest__.py').write_text('{}')
        self.tools = {}
        for name in ('odoo-bin', 'psql', 'pg_dump', 'pg_restore', 'createdb'):
            path = self.root / name
            path.write_text('fixture')
            self.tools[name] = str(path)
        self.classification = self.root / 'classification.json'
        self.classification.write_text(json.dumps({
            'schema_version': 1, 'database': 'webvue_scratch_demo',
            'commercial_mode': 'non_saas', 'entitlement_source': 'local_policy',
            'expected_valid_until': None, 'valid_until_action': 'preserve',
        }))
        self.policy = self.root / 'policy.json'
        self.policy.write_text(json.dumps({
            'schema_version': 1, 'channel': 'local_policy',
            'features': {'users.limit': 12, 'storage.limit_mb': None},
        }))
        self.inventory = self.root / 'inventory.json'
        self.entry = {
            'database': 'webvue_scratch_demo', 'kind': 'scratch',
            'pg_host': '127.0.0.1', 'pg_port': 5432, 'pg_user': 'scratch_user',
            'python': sys.executable, 'odoo_bin': self.tools['odoo-bin'],
            'addons_paths': [str(self.addons)], 'data_dir': str(self.data),
            'psql': self.tools['psql'], 'pg_dump': self.tools['pg_dump'],
            'pg_restore': self.tools['pg_restore'],
            'createdb': self.tools['createdb'],
            'backup_root': str(self.backups), 'release_root': str(self.releases),
            'classification_file': str(self.classification),
        }
        self.write_inventory()
        self.old_env = {name: os.environ.get(name) for name in (
            operator.INVENTORY_ENV, operator.STATE_ENV, 'PGPASSWORD')}
        os.environ[operator.INVENTORY_ENV] = str(self.inventory)
        os.environ[operator.STATE_ENV] = str(self.state)
        os.environ['PGPASSWORD'] = 'hidden-password'
        self.addCleanup(self.restore_env)

    def restore_env(self):
        for name, value in self.old_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def write_inventory(self, entry=None):
        self.inventory.write_text(json.dumps({
            'version': 2, 'targets': {'demo': entry or self.entry},
        }))

    def fields(self, operation, **extra):
        result = {'operation': operation, 'target': 'demo'}
        if operation == 'tenant.entitle':
            result.update(policy_file=str(self.policy), expected_revision=3,
                          request_id='req_1')
        result.update(extra)
        return result

    def test_inventory_coordinates_are_explicit_and_wrong_target_never_runs(self):
        calls = []

        def runner(argv, env=None, stdin_text=None):
            calls.append((argv, env, stdin_text))
            if 'features::text' in argv[-1]:
                return 0, json.dumps({'users.limit': 25, 'storage.limit_mb': None,
                                       'pmo.enabled': True, 'private.future': 'omit'}) + '\n', ''
            return 0, 'non_saas\x1flocal_policy\x1f\x1f3\x1f1\x1factive\n', ''
        code, payload = operator.operation_adapter(self.fields('tenant.inspect'), runner=runner)
        self.assertEqual(code, 0, payload)
        argv, env, _ = calls[0]
        self.assertEqual(argv[0], self.tools['psql'])
        self.assertEqual(argv[argv.index('-h') + 1], '127.0.0.1')
        self.assertEqual(argv[argv.index('-p') + 1], '5432')
        self.assertEqual(argv[argv.index('-U') + 1], 'scratch_user')
        self.assertEqual(argv[argv.index('-d') + 1], 'webvue_scratch_demo')
        self.assertEqual(env['PGHOST'], '127.0.0.1')
        self.assertEqual(payload['profile']['features'], {
            'users.limit': 25, 'storage.limit_mb': None, 'pmo.enabled': True,
        })
        self.assertNotIn('hidden-password', json.dumps(payload))
        code, payload = operator.operation_adapter(self.fields('tenant.inspect', target='other'), runner=runner)
        self.assertEqual(code, 2, payload)
        self.assertEqual(len(calls), 2)

    def test_inventory_alias_to_same_physical_database_is_rejected(self):
        self.inventory.write_text(json.dumps({
            'version': 2, 'targets': {'demo': self.entry, 'alias': dict(self.entry)},
        }))
        calls = []
        code, payload = operator.operation_adapter(self.fields('tenant.inspect'),
                                                   runner=lambda *args: calls.append(args))
        self.assertEqual(code, 3, payload)
        self.assertEqual(payload['error']['code'], 'target_alias_forbidden')
        self.assertEqual(calls, [])

    def test_entitle_policy_is_distinct_from_classification_and_revision_is_locked(self):
        calls = []
        profile = 'non_saas\x1flocal_policy\x1f\x1f3\x1f1\x1factive\n'
        marker = 'WEBVUE_OPERATOR_RESULT:{"status":"ok","changed":true,"policy_revision":4}\n'

        def runner(argv, env=None, stdin_text=None):
            calls.append((argv, env, stdin_text))
            if 'shell' in argv:
                return 0, marker, ''
            if 'ir_module_module' in argv[-1]:
                return 0, '0\n', ''
            return 0, profile, ''
        code, payload = operator.operation_adapter(self.fields('tenant.entitle'), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertTrue(payload['changed'])
        script = next(item[2] for item in calls if item[2])
        self.assertIn('FOR UPDATE', script)
        self.assertIn('expected_revision', script)
        self.assertIn("'features': policy['features']", script)
        self.assertIn('OPERATOR_CONTEXT', script)
        self.assertNotIn('hidden-password', script + json.dumps(payload))
        self.assertEqual(len([c for c in calls if 'shell' in c[0]]), 1)
        replay_code, replay = operator.operation_adapter(self.fields('tenant.entitle'), runner=runner)
        self.assertEqual(replay_code, 0)
        self.assertEqual(replay['operation_id'], payload['operation_id'])
        self.assertEqual(len([c for c in calls if 'shell' in c[0]]), 1)
        self.policy.write_text(json.dumps({
            'schema_version': 1, 'channel': 'local_policy', 'features': {'users.limit': 13},
        }))
        conflict_code, conflict = operator.operation_adapter(self.fields('tenant.entitle'), runner=runner)
        self.assertEqual(conflict_code, 4)
        self.assertEqual(conflict['error']['code'], 'request_conflict')

    def test_non_saas_expiry_and_support_fields_are_rejected_before_child(self):
        self.policy.write_text(json.dumps({
            'schema_version': 1, 'channel': 'local_policy', 'features': {},
            'valid_until': '2027-01-01',
        }))
        calls = []
        code, payload = operator.operation_adapter(
            self.fields('tenant.entitle'), runner=lambda *args, **kwargs: calls.append(args))
        self.assertEqual(code, 2, payload)
        self.assertEqual(calls, [])

    def test_saas_policy_channel_matches_trusted_classification(self):
        self.classification.write_text(json.dumps({
            'schema_version': 1, 'database': 'webvue_scratch_demo',
            'commercial_mode': 'saas', 'entitlement_source': 'control_plane',
            'expected_valid_until': None, 'valid_until_action': 'preserve',
        }))
        self.policy.write_text(json.dumps({
            'schema_version': 1, 'channel': 'control_plane', 'features': {'users.limit': 12},
        }))
        profile = 'saas\x1fcontrol_plane\x1f\x1f3\x1f1\x1factive\n'

        def runner(argv, env=None, stdin_text=None):
            if 'shell' in argv:
                return 0, 'WEBVUE_OPERATOR_RESULT:{"status":"ok","changed":true,"policy_revision":4}\n', ''
            if 'ir_module_module' in argv[-1]:
                return 0, '0\n', ''
            return 0, profile, ''
        code, payload = operator.operation_adapter(self.fields('tenant.entitle'), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertTrue(payload['changed'])
        self.policy.write_text(json.dumps({
            'schema_version': 1, 'channel': 'local_policy', 'features': {'users.limit': 12},
        }))
        code, payload = operator.operation_adapter(self.fields('tenant.entitle', request_id='req_2'), runner=runner)
        self.assertEqual(code, 4, payload)
        self.assertEqual(payload['error']['code'], 'classification_conflict')

    def test_revision_rechecked_after_database_row_lock(self):
        def runner(argv, env=None, stdin_text=None):
            if 'shell' in argv:
                return 0, 'WEBVUE_OPERATOR_RESULT:{"status":"conflict","changed":false,"error_code":"revision_conflict"}\n', ''
            if 'ir_module_module' in argv[-1]:
                return 0, '0\n', ''
            return 0, 'non_saas\x1flocal_policy\x1f\x1f3\x1f1\x1factive\n', ''
        code, payload = operator.operation_adapter(self.fields('tenant.entitle'), runner=runner)
        self.assertEqual(code, 4, payload)
        self.assertEqual(payload['status'], 'conflict')
        self.assertFalse(payload['changed'])
        self.assertEqual(payload['error']['code'], 'revision_conflict')
        status_code, receipt = operator.operation_adapter(
            self.fields('status', request_id='req_1'), runner=runner)
        self.assertEqual(status_code, 4)
        self.assertEqual(receipt['operation_id'], payload['operation_id'])

    def test_failed_child_is_redacted_and_retry_is_intervention(self):
        def runner(argv, env=None, stdin_text=None):
            if 'shell' in argv:
                return 1, '', 'password=hidden-password host=10.0.0.1'
            if 'ir_module_module' in argv[-1]:
                return 0, '0\n', ''
            return 0, 'non_saas\x1flocal_policy\x1f\x1f3\x1f1\x1factive\n', ''
        code, payload = operator.operation_adapter(self.fields('tenant.entitle'), runner=runner)
        self.assertEqual(code, 6, payload)
        self.assertEqual(payload['status'], 'needs_intervention')
        self.assertNotIn('hidden-password', json.dumps(payload))
        code, replay = operator.operation_adapter(self.fields('tenant.entitle'), runner=runner)
        self.assertEqual(code, 6)
        self.assertEqual(replay['operation_id'], payload['operation_id'])

    def test_create_initializes_only_absent_scratch_and_applies_policy(self):
        self.policy.write_text(json.dumps({
            'schema_version': 1, 'channel': 'local_policy',
            'modules': ['webvue_core', 'webvue_platform', 'webvue_api', 'webvue_pmo', 'webvue_meetings'],
            'features': {'users.limit': None, 'storage.limit_mb': None,
                         'pmo.enabled': True, 'meetings.enabled': True,
                         'projects.max_projects': None},
        }))
        calls = []

        def runner(argv, env=None, stdin_text=None):
            calls.append((argv, env, stdin_text))
            if 'pg_database' in argv[-1]:
                return 0, '', ''
            if 'features::text' in argv[-1]:
                return 0, json.dumps({'users.limit': None, 'storage.limit_mb': None,
                                       'pmo.enabled': True, 'meetings.enabled': True,
                                       'projects.max_projects': None}) + '\n', ''
            if "state = 'installed'" in argv[-1]:
                return 0, 'webvue_core\nwebvue_platform\nwebvue_api\nwebvue_pmo\nwebvue_meetings\n', ''
            if argv[0] == self.tools['createdb']:
                return 0, '', ''
            if 'shell' in argv:
                return 0, 'WEBVUE_OPERATOR_RESULT:{"status":"ok","changed":true,"policy_revision":1}\n', ''
            if '-i' in argv:
                return 0, '', ''
            if 'ir_module_module' in argv[-1]:
                return 0, '0\n', ''
            return 0, 'non_saas\x1flocal_policy\x1f\x1f1\x1f0\x1factive\n', ''
        fields = self.fields('tenant.create', policy_file=str(self.policy), request_id='create_1')
        code, payload = operator.operation_adapter(fields, runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['stage'], 'health_verified')
        self.assertTrue(payload['changed'])
        self.assertEqual(payload['policy_revision'], 1)
        self.assertEqual(payload['database'], 'webvue_scratch_demo')
        self.assertEqual(payload['installed_modules'], ['webvue_core', 'webvue_platform',
                                                        'webvue_api', 'webvue_pmo', 'webvue_meetings'])
        self.assertEqual(payload['commercial_mode'], 'non_saas')
        self.assertFalse(payload['deployment_ready'])
        create = next(item[0] for item in calls if item[0][0] == self.tools['createdb'])
        self.assertEqual(create[-1], 'webvue_scratch_demo')
        install = next(item[0] for item in calls if '-i' in item[0])
        self.assertIn('--stop-after-init', install)
        self.assertIn('--no-http', install)
        self.assertIn('--addons-path=' + str(self.addons), install)
        self.assertEqual(install[install.index('-i') + 1],
                         'webvue_core,webvue_platform,webvue_api,webvue_pmo,webvue_meetings')
        self.assertNotIn('hidden-password', ' '.join(install))
        replay_code, replay = operator.operation_adapter(fields, runner=runner)
        self.assertEqual(replay_code, 0)
        self.assertEqual(replay['operation_id'], payload['operation_id'])
        self.assertEqual(len([c for c in calls if '-i' in c[0]]), 1)

    def test_create_independent_readback_accepts_only_legacy_null_extension(self):
        policy = {'schema_version': 1, 'channel': 'local_policy',
                  'modules': ['webvue_core', 'webvue_platform', 'webvue_api'],
                  'features': {'users.limit': None, 'storage.limit_mb': None}}
        self.policy.write_text(json.dumps(policy))
        original_bytes = self.policy.read_bytes()
        for index, (extra, expected_code) in enumerate([
            ({'branches.extra_limit': None}, 0),
            ({'branches.extra_limit': 0}, 6),
            ({'branches.extra_limit': False}, 6),
            ({'branches.extra_limit': None, 'other.limit': None}, 6),
            ({'branches.extra_limit': None, 'users.limit': False}, 6),
        ]):
            with self.subTest(extra=extra):
                os.environ[operator.STATE_ENV] = str(self.root / f'legacy-state-{index}')
                observed = {**policy['features'], **extra}
                def runner(argv, env=None, stdin_text=None):
                    if 'pg_database' in argv[-1]:
                        return 0, '', ''
                    if 'features::text' in argv[-1]:
                        return 0, json.dumps(observed) + '\n', ''
                    if "state = 'installed'" in argv[-1]:
                        return 0, 'webvue_core\nwebvue_platform\nwebvue_api\n', ''
                    if 'shell' in argv:
                        return 0, 'WEBVUE_OPERATOR_RESULT:{"status":"ok","changed":false,"policy_revision":1}\n', ''
                    if argv[0] == self.tools['createdb'] or '-i' in argv:
                        return 0, '', ''
                    if 'ir_module_module' in argv[-1]:
                        return 0, '0\n', ''
                    return 0, 'non_saas\x1flocal_policy\x1f\x1f1\x1f1\x1factive\n', ''
                code, payload = operator.operation_adapter(self.fields(
                    'tenant.create', policy_file=str(self.policy), request_id=f'legacy_create_{index}'), runner=runner)
                self.assertEqual(code, expected_code, payload)
                self.assertEqual(payload['stage'], 'health_verified' if expected_code == 0 else 'policy_verification')
                self.assertEqual(self.policy.read_bytes(), original_bytes)

    def test_create_rejects_unowned_module_composition(self):
        self.policy.write_text(json.dumps({
            'schema_version': 1, 'channel': 'local_policy',
            'modules': ['webvue_core', 'webvue_platform', 'webvue_api', 'web_theme_shadcn'],
            'features': {'users.limit': None, 'storage.limit_mb': None},
        }))
        calls = []
        code, payload = operator.operation_adapter(self.fields(
            'tenant.create', policy_file=str(self.policy), request_id='create_2'),
            runner=lambda *args: calls.append(args))
        self.assertEqual(code, 2, payload)
        self.assertEqual(calls, [])

    def test_backup_candidate_remains_unverified_and_restore_uses_new_database(self):
        store = self.data / 'filestore' / 'webvue_scratch_demo'
        store.mkdir(parents=True)
        commands = []

        def runner(argv, env=None, stdin_text=None):
            commands.append(argv)
            if str(operator.BACKUP_WRAPPER) in argv:
                destination = Path(argv[argv.index('--output-dir') + 1])
                destination.mkdir()
                (destination / 'database.dump').write_bytes(b'dump')
                (destination / 'filestore').mkdir()
                (destination / 'manifest.json').write_text(json.dumps(
                    backup_wrapper.candidate_manifest_payload(
                        db='webvue_scratch_demo', store=store,
                        dump_name='database.dump', filestore_name='filestore',
                        http_observation=None,
                    )))
                return 0, '', ''
            if str(operator.RESTORE_WRAPPER) in argv:
                backup_dir = Path(argv[argv.index('--backup-dir') + 1])
                destination = argv[argv.index('--target-db') + 1]
                (backup_dir / 'restore-verification.json').write_text(json.dumps({
                    'restore_verified': True, 'restored_into': destination,
                }))
                return 0, '{"webvue_modules_installed": 7}', ''
            return 0, '', ''
        backup_fields = self.fields('backup', request_id='backup_1')
        backup_code, backup = operator.operation_adapter(backup_fields, runner=runner)
        self.assertEqual(backup_code, 0, backup)
        self.assertEqual(backup['consistency'], 'UNVERIFIED')
        self.assertFalse(backup['recovery_ready'])
        restore_fields = self.fields('restore', request_id='restore_1',
                                     backup_id=backup['operation_id'], approval_id='approved_1')
        restore_code, restored = operator.operation_adapter(restore_fields, runner=runner)
        self.assertEqual(restore_code, 0, restored)
        self.assertTrue(restored['restore_verified'])
        self.assertNotEqual(restored['restored_into'], 'webvue_scratch_demo')
        restore_argv = next(c for c in commands if str(operator.RESTORE_WRAPPER) in c)
        self.assertIn('--pg-host', restore_argv)
        self.assertIn('approved_1', json.dumps(restored))

    def test_upgrade_failed_child_reports_isolated_rollback_only(self):
        (self.data / 'filestore' / 'webvue_scratch_demo').mkdir(parents=True)
        release = self.releases / 'release.json'
        release.write_text(json.dumps({'schema_version': 1, 'modules': ['webvue_platform']}))

        def runner(argv, env=None, stdin_text=None):
            if 'ir_module_module' in argv[-1] or 'pg_stat_activity' in argv[-1]:
                if "state = 'installed'" in argv[-1]:
                    return 0, 'webvue_platform\n', ''
                return 0, '0\n', ''
            if str(operator.BACKUP_WRAPPER) in argv:
                destination = Path(argv[argv.index('--output-dir') + 1])
                destination.mkdir()
                (destination / 'database.dump').write_bytes(b'dump')
                (destination / 'filestore').mkdir()
                (destination / 'manifest.json').write_text(json.dumps(
                    backup_wrapper.candidate_manifest_payload(
                        db='webvue_scratch_demo',
                        store=self.data / 'filestore' / 'webvue_scratch_demo',
                        dump_name='database.dump', filestore_name='filestore',
                        http_observation=None,
                    )))
                return 0, '', ''
            if '-u' in argv:
                return 1, '', 'password=hidden-password'
            if str(operator.RESTORE_WRAPPER) in argv:
                backup_dir = Path(argv[argv.index('--backup-dir') + 1])
                destination = argv[argv.index('--target-db') + 1]
                (backup_dir / 'restore-verification.json').write_text(json.dumps({
                    'restore_verified': True, 'restored_into': destination,
                }))
                return 0, '', ''
            return 0, 'non_saas\x1flocal_policy\x1f\x1f3\x1f1\x1factive\n', ''
        code, payload = operator.operation_adapter(self.fields(
            'upgrade', release=str(release), request_id='upgrade_1'), runner=runner)
        self.assertEqual(code, 6, payload)
        self.assertEqual(payload['status'], 'needs_intervention')
        self.assertTrue(payload['rollback_restore_verified'])
        self.assertNotEqual(payload['rollback_destination'], 'webvue_scratch_demo')
        self.assertNotIn('hidden-password', json.dumps(payload))

    def test_upgrade_success_reports_module_health_scope_without_application_claim(self):
        store = self.data / 'filestore' / 'webvue_scratch_demo'
        store.mkdir(parents=True)
        release = self.releases / 'release.json'
        release.write_text(json.dumps({'schema_version': 1, 'modules': ['webvue_platform']}))

        def runner(argv, env=None, stdin_text=None):
            if 'ir_module_module' in argv[-1] or 'pg_stat_activity' in argv[-1]:
                if "state = 'installed'" in argv[-1]:
                    return 0, 'webvue_platform\n', ''
                return 0, '0\n', ''
            if str(operator.BACKUP_WRAPPER) in argv:
                destination = Path(argv[argv.index('--output-dir') + 1])
                destination.mkdir()
                (destination / 'database.dump').write_bytes(b'dump')
                (destination / 'filestore').mkdir()
                (destination / 'manifest.json').write_text(json.dumps(
                    backup_wrapper.candidate_manifest_payload(
                        db='webvue_scratch_demo', store=store,
                        dump_name='database.dump', filestore_name='filestore',
                        http_observation=None,
                    )))
                return 0, '', ''
            if '-u' in argv:
                return 0, '', ''
            return 0, 'non_saas\x1flocal_policy\x1f\x1f3\x1f1\x1factive\n', ''
        code, payload = operator.operation_adapter(self.fields(
            'upgrade', release=str(release), request_id='upgrade_success'), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['stage'], 'module_upgrade_verified')
        self.assertFalse(payload['application_health_verified'])
        self.assertEqual(payload['profile']['commercial_mode'], 'non_saas')

    def test_release_with_non_string_module_fails_before_child(self):
        release = self.releases / 'broken.json'
        release.write_text(json.dumps({'schema_version': 1, 'modules': [{'name': 'webvue_platform'}]}))
        calls = []
        code, payload = operator.operation_adapter(self.fields(
            'upgrade', release=str(release), request_id='bad_upgrade'),
            runner=lambda *args: calls.append(args))
        self.assertEqual(code, 2, payload)
        self.assertEqual(calls, [])

    def test_scratch_runner_prepares_two_private_distinct_targets_without_execution(self):
        args = Namespace(
            evidence_dir=str(self.root / 'evidence'),
            db_prefix='webvue_scratch_cp2_unit', target_prefix='cp2unit', tier='projects',
            odoo_python=sys.executable, odoo_bin=self.tools['odoo-bin'],
            addons_path=[str(self.addons)], pg_bin=str(self.root),
            pg_host='127.0.0.1', pg_port=5432, pg_user='scratch_user',
        )
        prepared = check_cp2_scratch.prepare(args)
        self.assertEqual(len(prepared['targets']), 2)
        self.assertTrue(Path(prepared['inventory']).is_file())
        self.assertEqual(Path(prepared['inventory']).stat().st_mode & 0o777, 0o600)
        databases = {entry['database'] for entry in prepared['targets'].values()}
        self.assertEqual(len(databases), 2)
        for name, entry in prepared['targets'].items():
            policy = json.loads((self.root / 'evidence' /
                                 f"{'non_saas' if name.endswith('non_saas') else 'saas'}-create-policy.json").read_text())
            self.assertEqual(policy['modules'], ['webvue_core', 'webvue_platform',
                                                  'webvue_api', 'webvue_pmo', 'webvue_meetings'])
            self.assertEqual(policy['features']['pmo.enabled'], True)
            self.assertEqual(entry['kind'], 'scratch')




class EntitleScriptCompatibilityCase(unittest.TestCase):
    def run_entitle(self, desired, actual, revision=3, commercial=None):
        from unittest.mock import mock_open, patch
        from test_managed_verify import Environment, execute_script
        env = Environment()
        env.profile.features = dict(actual)
        env.profile.policy_revision = 3
        policy = {'schema_version': 1, 'channel': 'control_plane', 'features': desired}
        if commercial is not None:
            policy['commercial_valid_until'] = commercial
        raw = json.dumps(policy)
        with patch.dict(os.environ, {'WEBVUE_OPERATOR_POLICY_FILE': '/synthetic/policy.json', 'WEBVUE_EXPECTED_REVISION': str(revision)}), patch('builtins.open', mock_open(read_data=raw)):
            stdout = execute_script(operator.ENTITLE_SCRIPT, env)
        result = json.loads(stdout.split('WEBVUE_OPERATOR_RESULT:', 1)[1])
        self.assertEqual(json.dumps(policy), raw)
        return result, env

    def test_migrated_null_is_legacy_noop_without_revision_bump(self):
        desired = {'users.limit': 3, 'storage.limit_mb': None}
        actual = {**desired, 'branches.extra_limit': None}
        result, env = self.run_entitle(desired, actual)
        self.assertEqual(result, {'status': 'ok', 'changed': False, 'policy_revision': 3})
        self.assertEqual(env.profile.features, actual)
        self.assertFalse(any(event[0] in ('write', 'commit') for event in env.events))

    def test_explicit_zero_is_a_real_change(self):
        actual = {'users.limit': 3, 'storage.limit_mb': None, 'branches.extra_limit': None}
        result, env = self.run_entitle({**actual, 'branches.extra_limit': 0}, actual)
        self.assertEqual(result, {'status': 'ok', 'changed': True, 'policy_revision': 4})
        self.assertEqual(env.profile.features['branches.extra_limit'], 0)
        self.assertIn(('commit',), env.events)

    def test_writes_the_commercial_expiry(self):
        desired = {'users.limit': 3, 'storage.limit_mb': None}
        result, env = self.run_entitle(desired, desired, commercial='2026-11-08')
        self.assertEqual(result['status'], 'ok')
        self.assertTrue(result['changed'])
        self.assertEqual(str(env.profile.commercial_valid_until), '2026-11-08')
        self.assertIn(('commit',), env.events)

    def test_same_expiry_is_not_a_change(self):
        env = None
        desired = {'users.limit': 3, 'storage.limit_mb': None}
        from unittest.mock import mock_open, patch
        from test_managed_verify import Environment, execute_script
        env = Environment()
        env.profile.features = dict(desired)
        env.profile.policy_revision = 3
        env.profile.commercial_valid_until = __import__('datetime').date(2026, 11, 8)
        policy = {'schema_version': 1, 'channel': 'control_plane', 'features': desired,
                  'commercial_valid_until': '2026-11-08'}
        raw = json.dumps(policy)
        with patch.dict(os.environ, {'WEBVUE_OPERATOR_POLICY_FILE': '/synthetic/policy.json', 'WEBVUE_EXPECTED_REVISION': '3'}), patch('builtins.open', mock_open(read_data=raw)):
            stdout = execute_script(operator.ENTITLE_SCRIPT, env)
        result = json.loads(stdout.split('WEBVUE_OPERATOR_RESULT:', 1)[1])
        self.assertEqual(result, {'status': 'ok', 'changed': False, 'policy_revision': 3})
        self.assertFalse(any(event[0] in ('write', 'commit') for event in env.events))

    def test_stale_revision_still_refuses_legacy_noop(self):
        desired = {'users.limit': 3, 'storage.limit_mb': None}
        result, env = self.run_entitle(desired, {**desired, 'branches.extra_limit': None}, revision=2)
        self.assertEqual(result['error_code'], 'revision_conflict')
        self.assertFalse(any(event[0] in ('write', 'commit') for event in env.events))


if __name__ == '__main__':
    unittest.main()
