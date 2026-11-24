"""Isolated checks of the tenant storage effect: an in-memory OCI and an in-memory Odoo that runs the real script. No docker."""
import contextlib
import io
import json
import logging
import os
import tempfile
import unittest
from unittest.mock import patch

from tools.shared_saas_lifecycle import oci_provision as oci
from tools.shared_saas_lifecycle import odoo_effect
from tools.shared_saas_lifecycle import tenant_storage_effect as effect
from tools.shared_saas_lifecycle.odoo_effect import EffectError
from tools.shared_saas_lifecycle.test_oci_provision import ENV, KEY_DELAY, NAMING_KEY, Clock, FakeOci

DATABASE = 'liwan_scratch_' + 'a' * 32
REQUEST_ID = '687674dc-5789-4a99-b151-12d69f010cc3'
STATE_DIR = os.path.realpath(tempfile.mkdtemp(prefix='liwan-storage-test-'))
CONFIG = {'schemaVersion': 1, 'projectName': 'liwan-shared-test', 'composeFile': '/private/tmp/compose.yml',
          'envFile': '/private/tmp/runtime.env', 'stateDir': STATE_DIR, 'domainSuffix': 'test'}


def request(operation='ensure', **over):
    return {'schemaVersion': 1, 'operation': operation, 'tenantId': 'acme', 'database': DATABASE, 'requestId': REQUEST_ID,
            'config': CONFIG, **over}


# ---- an Odoo that runs the real static script ----------------------------------------------------------------------


class FakeFs:
    def __init__(self, world, record):
        self.world, self.record = world, record

    def _allowed(self):
        options = json.loads(self.record.options)
        if not self.world.api.can_access(options['key'], options['secret'], self.record.directory_path):
            raise PermissionError('denied')

    def pipe_file(self, path, data):
        self._allowed()
        self.world.objects[(self.record.directory_path, path)] = data

    def cat_file(self, path):
        self._allowed()
        return self.world.objects[(self.record.directory_path, path)]

    def rm_file(self, path):
        self._allowed()
        del self.world.objects[(self.record.directory_path, path)]


class FakeRecord:
    def __init__(self, world, vals):
        self.world = world
        self.__dict__.update(vals)

    @property
    def fs(self):
        return FakeFs(self.world, self)

    def write(self, vals):
        self.world.writes.append(dict(vals))
        self.__dict__.update(vals)

    def unlink(self):
        self.world.records.remove(self)

    def __bool__(self):
        return True


class FakeRecords(list):
    def __bool__(self):
        return bool(len(self))

    def __getattr__(self, name):
        return getattr(self[0], name)

    def write(self, vals):
        self[0].write(vals)

    def unlink(self):
        self[0].unlink()


class FakeStorageModel:
    def __init__(self, world):
        self.world = world

    def search(self, domain, limit=None):
        (field, op, value), = domain
        return FakeRecords([r for r in self.world.records if getattr(r, field) == value][:limit])

    def create(self, vals):
        self.world.writes.append(dict(vals))
        record = FakeRecord(self.world, vals)
        self.world.records.append(record)
        return record


class FakeEnv:
    su, uid = True, 1

    def __init__(self, world):
        self.world = world
        self.cr = type('Cursor', (), {'dbname': DATABASE, 'commit': lambda s: world.events.append('commit'),
                                      'rollback': lambda s: world.events.append('rollback')})()
        self.registry = type('Registry', (), {'signal_changes': lambda s: world.events.append('signal')})()

    def __getitem__(self, name):
        assert name == 'fs.storage'
        return FakeStorageModel(self.world)

    def flush_all(self):
        pass


def effect_record(world, code, bucket, key):
    return FakeRecord(world, {'code': code, 'directory_path': bucket, 'protocol': 's3', 'options': json.dumps({'key': key, 'secret': 's'}),
                              'use_as_default_for_attachments': False})


class World:
    """OCI + the tenant database, shared by the whole run. `fail_write` makes the store step fail (before or after it ran)."""

    def __init__(self, mode='per_tenant'):
        self.clock = Clock()
        self.api = FakeOci(self.clock)
        self.mode = mode
        self.records, self.objects, self.writes, self.events, self.scripts = [], {}, [], [], []
        self.fail_write = None

    # the effect's OdooStore talks to this
    def run_script(self, script, *, stdin):
        values = json.loads(stdin)
        self.scripts.append((script, stdin))
        if values['op'] == 'write' and self.fail_write == 'before':
            return effect.SENTINEL + json.dumps({'error_code': 'script_failed'})
        if values['op'] == 'write' and self.fail_write == 'crash':
            raise KeyboardInterrupt
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            exec(compile(script, '<tenant-storage>', 'exec'), {'env': FakeEnv(self), 'values': values})
        return captured.getvalue()

    # the effect's OciClient talks to this
    def run_oci(self, payload):
        answer = oci.run(json.dumps(payload), {**ENV, 'OCI_POLICY_MODE': self.mode}, api=self.api, naming_key=NAMING_KEY, clock=self.clock)
        return json.dumps(answer)

    def primary(self):
        return next((r for r in self.records if r.code == effect.PRIMARY_CODE), None)

    def candidate(self):
        return next((r for r in self.records if r.code == effect.CANDIDATE_CODE), None)

    def keys(self):
        return [key for keys in self.api.keys.values() for key in keys]


def build(world):
    return effect.TenantStorageEffect(effect.OciClient(world, 'acme', REQUEST_ID),
                                      effect.OdooStore(world, DATABASE, REQUEST_ID), world.clock)


def run(world, operation, **over):
    return build(world).run(request(operation, **over))


class Case(unittest.TestCase):
    def setUp(self):
        self.world = World()
        # OciClient.call(op, **values) -> world.run_oci(payload) through the real parser
        self.effect = effect.TenantStorageEffect(
            effect.OciClient(self.world, 'acme', REQUEST_ID), effect.OdooStore(self.world, DATABASE, REQUEST_ID), self.world.clock)

    def run_op(self, operation):
        return self.effect.run(request(operation))

    def code_of(self, operation):
        with self.assertRaises(EffectError) as caught:
            self.run_op(operation)
        return str(caught.exception)

    def wait(self, seconds):
        self.world.clock.now += seconds


class EnsureTest(Case):
    def test_a_new_tenant_gets_resources_a_stored_key_and_waits(self):
        answer = self.run_op('ensure')
        self.assertEqual({'operation': 'ensure', 'tenantId': 'acme', 'requestId': REQUEST_ID, 'state': 'pending_key',
                          'stage': 'key_stored', 'retryAfterSeconds': 480}, answer)
        self.assertIn(answer['stage'], ('key_stored', 'verified'))
        primary = self.world.primary()
        self.assertEqual(oci.resource_name('acme', NAMING_KEY), primary.directory_path)
        self.assertEqual('s3', primary.protocol)
        options = json.loads(primary.options)
        self.assertEqual('us-east-1', options['client_kwargs']['region_name'])
        self.assertEqual('path', options['config_kwargs']['s3']['addressing_style'])
        self.assertEqual('when_required', options['config_kwargs']['request_checksum_calculation'])
        self.assertEqual('when_required', options['config_kwargs']['response_checksum_validation'])
        self.assertEqual('SHA256', options['s3_additional_kwargs']['ChecksumAlgorithm'])
        self.assertEqual('https://tenantns.compat.objectstorage.me-jeddah-1.oraclecloud.com', options['endpoint_url'])
        self.assertEqual([options['key']], [key['id'] for key in self.world.keys()])
        self.assertFalse(primary.use_as_default_for_attachments)  # not the attachment default before a key that works

    def test_the_stored_key_works_after_the_delay_and_verify_activates_it(self):
        self.run_op('ensure')
        self.wait(60)
        self.assertEqual('pending_key', self.run_op('verify')['state'])
        self.assertFalse(self.world.primary().use_as_default_for_attachments)
        self.wait(KEY_DELAY)
        answer = self.run_op('verify')
        self.assertEqual(('active', 'verified'), (answer['state'], answer['stage']))
        self.assertNotIn('retryAfterSeconds', answer)
        self.assertTrue(self.world.primary().use_as_default_for_attachments)
        self.assertEqual({}, {k: v for k, v in self.world.objects.items()})  # the probe object is removed again

    def test_a_pending_key_reports_the_remaining_wait_and_never_less_than_the_minimum(self):
        self.run_op('ensure')
        self.world.api.deny_all = True
        self.wait(300)
        self.assertEqual(180, self.run_op('verify')['retryAfterSeconds'])
        self.wait(200)
        self.assertEqual(effect.MIN_RETRY_SECONDS, self.run_op('verify')['retryAfterSeconds'])

    def test_ensure_repeated_while_pending_issues_no_second_key(self):
        self.run_op('ensure')
        first = [key['id'] for key in self.world.keys()]
        self.wait(30)
        self.assertEqual('pending_key', self.run_op('ensure')['state'])
        self.assertEqual(first, [key['id'] for key in self.world.keys()])

    def test_ensure_of_an_active_tenant_is_active_and_changes_nothing(self):
        self.run_op('ensure')
        self.wait(KEY_DELAY)
        self.assertEqual('active', self.run_op('ensure')['state'])
        before = (len(self.world.api.created), len(self.world.writes))
        self.assertEqual('active', self.run_op('ensure')['state'])
        self.assertEqual(before, (len(self.world.api.created), len(self.world.writes)))

    def test_ensure_removes_a_key_no_record_stores(self):
        self.run_op('ensure')
        user = next(iter(self.world.api.users.values()))
        stray = self.world.api.create_key(user['id'], 'stray')
        self.wait(KEY_DELAY)
        self.assertEqual('active', self.run_op('ensure')['state'])
        self.assertNotIn(stray['id'], [key['id'] for key in self.world.keys()])
        self.assertEqual(1, len(self.world.keys()))

    def test_a_key_that_disappeared_from_oci_is_replaced(self):
        self.run_op('ensure')
        user = next(iter(self.world.api.users.values()))
        self.world.api.keys[user['id']] = []
        self.assertEqual('pending_key', self.run_op('ensure')['state'])
        self.assertEqual(json.loads(self.world.primary().options)['key'], self.world.keys()[0]['id'])

    def test_the_fixed_policy_mode_works_the_same(self):
        self.world.mode = 'fixed'
        self.run_op('ensure')
        self.wait(KEY_DELAY)
        self.assertEqual('active', self.run_op('verify')['state'])
        self.assertEqual({oci.FIXED_POLICY_NAME}, set(self.world.api.policies))


class BucketMismatchTest(Case):
    def point_primary_elsewhere(self):
        self.run_op('ensure')
        self.world.primary().directory_path = 'lw-someoneelse'
        return dict(self.world.primary().__dict__), len(self.world.keys()), len(self.world.writes), len(self.world.api.created)

    def test_nothing_is_created_when_the_record_names_another_bucket_and_oci_is_still_empty(self):
        self.world.records.append(effect_record(self.world, effect.PRIMARY_CODE, 'lw-someoneelse', 'k'))
        for operation in ('ensure', 'rotate', 'verify'):
            self.assertEqual('bucket_mismatch', self.code_of(operation))
        self.assertEqual([], self.world.api.created)  # no bucket, user, group, policy or key
        self.assertEqual([], self.world.writes)

    def test_ensure_refuses_to_overwrite_a_record_for_another_bucket(self):
        before = self.point_primary_elsewhere()
        self.assertEqual('bucket_mismatch', self.code_of('ensure'))
        self.assertEqual(before, (dict(self.world.primary().__dict__), len(self.world.keys()), len(self.world.writes), len(self.world.api.created)))

    def test_rotate_refuses_too_and_writes_no_candidate(self):
        before = self.point_primary_elsewhere()
        self.assertEqual('bucket_mismatch', self.code_of('rotate'))
        self.assertEqual(before, (dict(self.world.primary().__dict__), len(self.world.keys()), len(self.world.writes), len(self.world.api.created)))
        self.assertIsNone(self.world.candidate())

    def test_the_code_is_one_the_runner_may_report(self):
        self.assertIn('bucket_mismatch', effect.ERROR_CODES)


class FailureTest(Case):
    def test_oci_failures_stop_before_anything_is_written(self):
        for code in ('oci_refused', 'oci_unreachable', 'limit_reached'):
            self.world.api.fail = code
            self.assertEqual(code, self.code_of('ensure'))
            self.assertEqual([], self.world.records)

    def test_a_key_that_cannot_be_stored_is_deleted_and_the_next_call_heals(self):
        self.world.fail_write = 'before'
        self.assertEqual('store_failed', self.code_of('ensure'))
        self.assertEqual([], self.world.keys())
        self.world.fail_write = None
        self.assertEqual('pending_key', self.run_op('ensure')['state'])
        self.assertEqual(1, len(self.world.keys()))

    def test_a_crash_between_issue_and_store_leaves_a_key_the_next_call_removes(self):
        self.world.fail_write = 'crash'
        with self.assertRaises(KeyboardInterrupt):
            self.run_op('ensure')
        self.assertEqual(1, len(self.world.keys()))
        self.assertIsNone(self.world.primary())
        self.world.fail_write = None
        self.assertEqual('pending_key', self.run_op('ensure')['state'])
        self.assertEqual(1, len(self.world.keys()))
        self.assertEqual(json.loads(self.world.primary().options)['key'], self.world.keys()[0]['id'])

    def test_verify_without_a_stored_key_is_store_failed(self):
        self.assertEqual('store_failed', self.code_of('verify'))

    def test_a_key_that_never_works_fails_after_the_window(self):
        self.run_op('ensure')
        self.world.api.deny_all = True
        self.wait(effect.KEY_WINDOW_SECONDS - 1)
        self.assertEqual('pending_key', self.run_op('verify')['state'])
        self.wait(2)
        self.assertEqual('key_not_valid', self.code_of('verify'))
        self.assertEqual('key_not_valid', self.code_of('ensure'))

    def test_ensure_restores_a_policy_that_was_removed(self):
        self.run_op('ensure')
        self.world.api.policies.clear()
        self.wait(KEY_DELAY)
        self.assertEqual('active', self.run_op('ensure')['state'])

    def test_verify_fails_when_the_stored_key_or_the_bucket_is_gone_from_oci(self):
        self.run_op('ensure')
        self.world.api.keys[next(iter(self.world.api.users))] = []
        self.assertEqual('key_not_valid', self.code_of('verify'))
        self.world.api.buckets.clear()
        self.assertEqual('key_not_valid', self.code_of('verify'))

    def test_a_script_error_is_a_code_not_text(self):
        self.world.run_script = lambda script, *, stdin: effect.SENTINEL + json.dumps({'error_code': 'secret-text'})
        self.assertEqual('script_failed', self.code_of('verify'))

    def test_an_unreadable_container_answer_is_script_failed(self):
        for answer in ('', 'not json', '[]', '{"result":{}}', '{"result":{"bucket":1}}', '{"error_code":"made_up"}', '{"result":{},"extra":1}',
                       '{"error_code":"oci_refused"}\n{"error_code":"oci_refused"}'):
            self.world.run_oci = lambda payload, _answer=answer: _answer
            self.assertEqual('script_failed', self.code_of('ensure'), answer)


class RotateTest(Case):
    def activate(self):
        self.run_op('ensure')
        self.wait(KEY_DELAY)
        self.assertEqual('active', self.run_op('verify')['state'])

    def test_rotation_keeps_the_live_key_until_the_new_one_works(self):
        self.activate()
        old = json.loads(self.world.primary().options)
        answer = self.run_op('rotate')
        self.assertEqual(('pending_key', 'key_stored'), (answer['state'], answer['stage']))
        self.assertEqual(old, json.loads(self.world.primary().options))  # the live record is untouched
        self.assertFalse(self.world.candidate().use_as_default_for_attachments)
        self.assertEqual(2, len(self.world.keys()))
        self.wait(30)
        self.assertEqual('pending_key', self.run_op('rotate')['state'])
        self.assertEqual(2, len(self.world.keys()))
        self.wait(KEY_DELAY)
        answer = self.run_op('rotate')
        self.assertEqual(('active', 'verified'), (answer['state'], answer['stage']))
        new = json.loads(self.world.primary().options)
        self.assertNotEqual(old['key'], new['key'])
        self.assertIsNone(self.world.candidate())
        self.assertEqual([new['key']], [key['id'] for key in self.world.keys()])
        self.assertTrue(self.world.primary().use_as_default_for_attachments)

    def test_the_old_key_stays_usable_during_the_rotation(self):
        self.activate()
        old = json.loads(self.world.primary().options)
        self.run_op('rotate')
        self.assertTrue(self.world.api.can_access(old['key'], old['secret'], self.world.primary().directory_path))
        self.assertEqual('active', self.run_op('verify')['state'])

    def test_rotation_without_a_live_key_is_refused(self):
        self.assertEqual('store_failed', self.code_of('rotate'))

    def test_a_candidate_that_never_works_is_dropped_and_the_live_key_survives(self):
        self.activate()
        self.run_op('rotate')
        self.world.api.deny_all = True
        self.wait(effect.KEY_WINDOW_SECONDS + 1)
        self.assertEqual('key_not_valid', self.code_of('rotate'))
        self.assertIsNone(self.world.candidate())
        self.assertEqual(1, len(self.world.keys()))
        self.assertIsNotNone(self.world.primary())

    def test_a_candidate_whose_key_is_gone_is_replaced(self):
        self.activate()
        self.run_op('rotate')
        user = next(iter(self.world.api.users.values()))
        gone = json.loads(self.world.candidate().options)['key']
        self.world.api.keys[user['id']] = [k for k in self.world.api.keys[user['id']] if k['id'] != gone]
        self.assertEqual('pending_key', self.run_op('rotate')['state'])
        self.assertNotEqual(gone, json.loads(self.world.candidate().options)['key'])
        self.assertEqual(2, len(self.world.keys()))

    def test_a_crash_after_promotion_leaves_a_stale_key_the_next_call_removes(self):
        self.activate()
        self.run_op('rotate')
        self.wait(KEY_DELAY)
        # the promotion ran, the old key was not yet deleted
        with patch.object(self.world.api, 'delete_key', lambda *a: None):
            self.run_op('rotate')
        self.assertEqual(2, len(self.world.keys()))
        self.assertEqual('active', self.run_op('ensure')['state'])
        self.assertEqual(1, len(self.world.keys()))

    def test_a_rotation_that_stopped_after_promotion_is_finished_not_repeated(self):
        self.activate()
        self.run_op('rotate')
        self.wait(KEY_DELAY)
        with patch.object(self.world.api, 'delete_key', lambda *a: None):
            self.run_op('rotate')  # promoted; the old key was not deleted
        promoted = json.loads(self.world.primary().options)['key']
        self.assertEqual(2, len(self.world.keys()))
        issued_before = len([c for c in self.world.api.created if c[0] == 'key'])
        answer = self.run_op('rotate')
        self.assertEqual(('active', 'verified'), (answer['state'], answer['stage']))
        self.assertEqual([promoted], [key['id'] for key in self.world.keys()])
        self.assertEqual(promoted, json.loads(self.world.primary().options)['key'])
        self.assertIsNone(self.world.candidate())
        self.assertEqual(issued_before, len([c for c in self.world.api.created if c[0] == 'key']))  # no new key

    def test_a_new_rotation_request_after_a_finished_one_rotates_again(self):
        self.activate()
        self.run_op('rotate'); self.wait(KEY_DELAY); self.run_op('rotate')
        first = json.loads(self.world.primary().options)['key']
        self.assertEqual('pending_key', self.run_op('rotate')['state'])
        self.wait(KEY_DELAY)
        self.assertEqual('active', self.run_op('rotate')['state'])
        self.assertNotEqual(first, json.loads(self.world.primary().options)['key'])

    def test_a_key_issued_but_not_stored_during_rotation_is_replaced_not_mistaken_for_leftover(self):
        self.activate()
        user = next(iter(self.world.api.users.values()))
        self.wait(10)
        self.world.api.create_key(user['id'], 'stray-newer')  # newer than the live key, held by no record
        self.assertEqual('pending_key', self.run_op('rotate')['state'])
        self.assertIsNotNone(self.world.candidate())
        self.assertEqual(2, len(self.world.keys()))

    def test_ensure_during_a_rotation_does_not_remove_the_candidate_key(self):
        self.activate()
        self.run_op('rotate')
        self.assertEqual('active', self.run_op('ensure')['state'])
        self.assertEqual(2, len(self.world.keys()))
        self.assertIsNotNone(self.world.candidate())


class SecretTest(Case):
    """The secret reaches `fs.storage` only: not an answer, a log line, an exception, stderr, a file or any later script input."""

    def secret_free(self, text):
        for key in self.world.keys():
            self.assertNotIn(key['key'], text)

    def test_the_secret_is_in_no_answer_and_in_one_script_input_only(self):
        logging.disable(logging.NOTSET)
        with self.assertLogs(level='DEBUG') as logs, contextlib.redirect_stderr(io.StringIO()) as err, \
                contextlib.redirect_stdout(io.StringIO()) as out:
            logging.getLogger().debug('start')
            answers = [self.run_op('ensure')]
            self.wait(KEY_DELAY)
            answers += [self.run_op('verify'), self.run_op('rotate')]
            self.wait(KEY_DELAY)
            answers += [self.run_op('rotate')]
        secrets = set()
        for record in [self.world.primary()]:
            secrets.add(json.loads(record.options)['secret'])
        self.assertTrue(secrets)
        everything = json.dumps(answers) + out.getvalue() + err.getvalue() + '\n'.join(logs.output)
        for secret in secrets:
            self.assertNotIn(secret, everything)
        # the secret travels only in the stdin of a `write` script call, and each script clears its values
        for script, stdin in self.world.scripts:
            if json.loads(stdin)['op'] != 'write':
                self.assertNotIn('secret', json.loads(stdin))
        self.assertIn('values.clear()', effect.build_script())

    def test_the_oci_container_receives_no_secret_and_its_request_has_no_name(self):
        payloads = []
        original = self.world.run_oci
        self.world.run_oci = lambda payload: payloads.append(payload) or original(payload)
        self.run_op('ensure')
        self.assertTrue(payloads)
        for payload in payloads:
            self.assertLessEqual(set(payload), {'operation', 'tenantId', 'requestId', 'keepKeyIds', 'keyId'})
            self.assertNotIn('secret', json.dumps(payload))

    def test_a_failing_store_does_not_leak_the_secret_into_the_error(self):
        self.world.fail_write = 'before'
        with self.assertRaises(EffectError) as caught:
            self.run_op('ensure')
        self.assertEqual(('store_failed',), caught.exception.args)
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)

    def test_main_prints_one_line_without_the_secret(self):
        out = io.StringIO()
        with patch.object(effect, 'ComposeRunner', lambda *_a: self.world), \
                patch.object(effect, 'effect_operation', lambda *_a, **_k: contextlib.nullcontext()):
            status = effect.main(io.StringIO(json.dumps(request('ensure')) + '\n'), out)
        self.assertEqual(0, status)
        lines = out.getvalue().splitlines()
        self.assertEqual(1, len(lines))
        self.assertEqual('pending_key', json.loads(lines[0])['result']['state'])
        self.secret_free(out.getvalue())


class ScriptTest(unittest.TestCase):
    def test_the_script_is_static_compiles_and_prints_through_the_sentinel(self):
        script = effect.build_script()
        compile(script, '<script>', 'exec')
        self.assertEqual(script, effect.build_script())
        self.assertNotIn(DATABASE, script)
        self.assertNotIn('print(values', script)
        self.assertIn("env.cr.dbname != values['database']", script)
        self.assertIn('not env.su or env.uid != 1', script)

    def test_parse_output_is_strict(self):
        good = effect.SENTINEL + json.dumps({'primary': None, 'candidate': {'bucket': 'b', 'accessKeyId': 'k'}})
        self.assertEqual({'primary': None, 'candidate': {'bucket': 'b', 'accessKeyId': 'k'}}, effect.parse_output(good, 'observe'))
        for text, op in ((good + '\n' + good, 'observe'), ('noise', 'observe'), (effect.SENTINEL + '[]', 'observe'),
                         (effect.SENTINEL + json.dumps({'primary': None}), 'observe'),
                         (effect.SENTINEL + json.dumps({'primary': {'bucket': 'b'}, 'candidate': None}), 'observe'),
                         (effect.SENTINEL + json.dumps({'verified': False}), 'verify'),
                         (effect.SENTINEL + json.dumps({'verified': True, 'secret': 'x'}), 'verify'), (None, 'verify'),
                         (effect.SENTINEL + 'x' * (odoo_effect.MAX_OUTPUT + 1), 'verify')):
            with self.assertRaises(EffectError) as caught:
                effect.parse_output(text, op)
            self.assertEqual('script_failed', str(caught.exception))
        with self.assertRaises(EffectError) as caught:
            effect.parse_output(effect.SENTINEL + json.dumps({'error_code': 'key_not_valid'}), 'verify')
        self.assertEqual('key_not_valid', str(caught.exception))

    def test_the_script_refuses_a_foreign_database_or_a_normal_user(self):
        world = World()
        env = FakeEnv(world)
        for patch_env, values in ((None, {'database': 'liwan_scratch_' + 'b' * 32}),):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                exec(compile(effect.build_script(), 's', 'exec'), {'env': env, 'values': {'op': 'observe', **values}})
            self.assertEqual({'error_code': 'script_failed'}, json.loads(out.getvalue()[len(effect.SENTINEL):]))
        env.su = False
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            exec(compile(effect.build_script(), 's', 'exec'), {'env': env, 'values': {'op': 'observe', 'database': DATABASE}})
        self.assertEqual({'error_code': 'script_failed'}, json.loads(out.getvalue()[len(effect.SENTINEL):]))

    def test_two_records_with_one_code_are_refused(self):
        world = World()
        for _ in range(2):
            FakeStorageModel(world).create({'code': effect.PRIMARY_CODE, 'directory_path': 'b', 'options': '{}'})
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            exec(compile(effect.build_script(), 's', 'exec'), {'env': FakeEnv(world), 'values': {'op': 'observe', 'database': DATABASE}})
        self.assertEqual({'error_code': 'script_failed'}, json.loads(out.getvalue()[len(effect.SENTINEL):]))


class RequestTest(unittest.TestCase):
    def test_a_valid_request_passes(self):
        for operation in effect.OPERATIONS:
            self.assertEqual(operation, effect.validate_request(request(operation))['operation'])

    def test_invalid_requests_are_refused(self):
        bad = [request('drop'), request(schemaVersion=2), request(tenantId='../x'), request(tenantId='Acme'), request(requestId='nope'),
               request(database='liwan_acme'), request(bucket='lw-x'), {**request(), 'config': 'x'}, [], 'x',
               {k: v for k, v in request().items() if k != 'tenantId'}, {k: v for k, v in request().items() if k != 'config'}]
        for item in bad:
            with self.assertRaises(EffectError) as caught:
                effect.validate_request(item)
            self.assertEqual('request_invalid', str(caught.exception))

    def test_main_reports_invalid_input_as_a_code(self):
        for raw in ('', '{broken', '[]', json.dumps({**request(), 'operation': 'drop'}), 'x' * (odoo_effect.MAX_OUTPUT + 2)):
            out = io.StringIO()
            self.assertEqual(1, effect.main(io.StringIO(raw + '\n'), out))
            self.assertEqual({'error_code': 'request_invalid'}, json.loads(out.getvalue()))

    def test_an_unexpected_error_is_script_failed_without_text(self):
        out = io.StringIO()
        with patch.object(effect, 'ComposeRunner', lambda *_a: (_ for _ in ()).throw(RuntimeError('secret-text'))):
            self.assertEqual(1, effect.main(io.StringIO(json.dumps(request()) + '\n'), out))
        self.assertEqual({'error_code': 'script_failed'}, json.loads(out.getvalue()))

    def test_an_unknown_effect_code_is_reported_as_script_failed(self):
        out = io.StringIO()
        with patch.object(effect, 'ComposeRunner', lambda *_a: object()), \
                patch.object(effect, 'execute', lambda *_a: (_ for _ in ()).throw(EffectError('leaky_detail'))):
            effect.main(io.StringIO(json.dumps(request()) + '\n'), out)
        self.assertEqual({'error_code': 'script_failed'}, json.loads(out.getvalue()))


class LockAndGateTest(Case):
    def test_a_second_operation_on_the_same_tenant_is_refused_while_one_runs(self):
        with effect.tenant_lock(STATE_DIR, 'acme'):
            with self.assertRaises(EffectError) as caught:
                with effect.tenant_lock(STATE_DIR, 'acme'):
                    self.fail('entered twice')
            self.assertEqual('operation_in_progress', str(caught.exception))
            with effect.tenant_lock(STATE_DIR, 'other'):  # another tenant is not blocked
                pass

    def test_the_lock_is_released_after_a_failure(self):
        with self.assertRaises(RuntimeError):
            with effect.tenant_lock(STATE_DIR, 'acme'):
                raise RuntimeError()
        with effect.tenant_lock(STATE_DIR, 'acme'):
            pass

    def test_the_lock_file_lives_in_the_dedicated_state_directory_and_is_private(self):
        with effect.tenant_lock(STATE_DIR, 'acme'):
            path = os.path.join(STATE_DIR, 'tenant-storage', 'acme.lock')
            self.assertEqual(0o600, os.stat(path).st_mode & 0o777)
            self.assertEqual(0o700, os.stat(os.path.dirname(path)).st_mode & 0o777)

    def test_a_link_in_place_of_the_lock_is_refused(self):
        target = os.path.join(STATE_DIR, 'elsewhere')
        open(target, 'w').close()
        link = os.path.join(STATE_DIR, 'tenant-storage', 'linked.lock')
        os.makedirs(os.path.dirname(link), mode=0o700, exist_ok=True)
        if os.path.lexists(link):
            os.unlink(link)
        os.symlink(target, link)
        with self.assertRaises(EffectError):
            with effect.tenant_lock(STATE_DIR, 'linked'):
                pass

    def test_execute_runs_under_the_lock_and_maps_a_busy_tenant(self):
        with patch.object(effect, 'effect_operation', lambda *_a, **_k: contextlib.nullcontext()):
            self.assertEqual('pending_key', effect.execute(request('ensure'), self.world)['state'])
            with effect.tenant_lock(STATE_DIR, 'acme'):
                with self.assertRaises(EffectError) as caught:
                    effect.execute(request('ensure'), self.world)
            self.assertEqual('operation_in_progress', str(caught.exception))

    def test_execute_needs_the_release_binding_when_release_routes_are_on(self):
        with patch.object(odoo_effect, 'release_routes_enabled', lambda: True):
            with self.assertRaises(EffectError) as caught:
                effect.execute(request('ensure'), self.world)
        self.assertEqual('release_operation_blocked', str(caught.exception))
        self.assertEqual([], self.world.records)

    def test_execute_maps_any_unexpected_failure_to_a_code(self):
        broken = type('Broken', (), {'run_oci': lambda s, p: 1 / 0, 'run_script': lambda s, *a, **k: 1 / 0})()
        with patch.object(effect, 'effect_operation', lambda *_a, **_k: contextlib.nullcontext()):
            with self.assertRaises(EffectError) as caught:
                effect.execute(request('ensure'), broken)
        self.assertEqual('script_failed', str(caught.exception))

    def test_the_compose_runner_runs_the_oci_service_one_shot_and_reads_stdout_only(self):
        runner = effect.ComposeRunner({'tenant': {'database': DATABASE}, 'config': CONFIG})
        seen = {}
        runner.command = lambda args, **kw: seen.update(args=args, kw=kw) or '{"result":{}}'
        runner.run_oci({'operation': 'inspect'})
        self.assertEqual('tenant-storage', seen['args'][-1])
        self.assertEqual(['run', '--rm', '--no-deps', '-T'], seen['args'][seen['args'].index('run'):seen['args'].index('run') + 4])
        self.assertIs(True, seen['kw']['stdout_only'])
        self.assertNotIn('-e', seen['args'])  # no secret or setting on the command line
        self.assertIsNone(runner.current_container)


if __name__ == '__main__':
    unittest.main()
