"""Role evidence binds actual guarded container launch, immutable config and image bytes."""
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


SECRET = b'[options]\ndb_user = pool_blue\ndb_host = postgres\ndb_password = private-not-for-evidence\n'


class RuntimeIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve(); self.config = self.root / 'odoo.conf'
        self.config.write_bytes(SECRET); self.config.chmod(0o400)
        self.hash = hashlib.sha256(SECRET).hexdigest()
        self.expected = {'poolId': 'blue', 'releaseId': 'r1', 'image': 'webvue/odoo@sha256:' + 'a' * 64,
                         'dbUser': 'pool_blue', 'dbHost': 'postgres', 'configPath': str(self.config),
                         'configDigest': self.hash, 'tenancyMode': 'shared'}
        self.container = {'Id': 'b' * 64, 'Image': 'sha256:' + 'c' * 64,
                          'State': {'Running': True, 'StartedAt': (datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat().replace('+00:00', 'Z')},
                          'Config': {'Image': self.expected['image'], 'Labels': {'webvue.pool': 'blue', 'webvue.release': 'r1', 'webvue.runtime': 'http', 'webvue.db-config-sha256': self.hash},
                                     'Env': ['WEBVUE_TENANCY_MODE=shared', 'WEBVUE_RELEASE_POOL_ID=blue', 'WEBVUE_RELEASE_ROLE=http', 'WEBVUE_RELEASE_DB_USER=pool_blue'],
                                     'Entrypoint': ['/opt/venv/bin/python', '/opt/webvue/shared/launch_odoo.py'], 'Cmd': ['--max-cron-threads=0']},
                          'Path': '/opt/venv/bin/python', 'Args': ['/opt/webvue/shared/launch_odoo.py', '--max-cron-threads=0'],
                          'Mounts': [{'Type': 'bind', 'Source': str(self.config), 'Destination': '/etc/odoo/odoo.conf', 'RW': False}]}
        self.image = {'Id': self.container['Image'], 'RepoDigests': [self.expected['image']]}
        self.mounted = SECRET; self.commands = []; self.timeouts = []; self.call_cost = 0; self.clock = [0.0]

    def runner(self, argv, **kwargs):
        self.commands.append(argv); self.timeouts.append(kwargs['timeout']); self.clock[0] += self.call_cost
        self.assertTrue(kwargs['capture_output']); self.assertTrue(kwargs['check'])
        if argv == ['docker', 'inspect', 'blue-odoo']:
            value = json.dumps([self.container]).encode()
        elif argv == ['docker', 'image', 'inspect', self.container['Image']]:
            value = json.dumps([self.image]).encode()
        elif argv == ['docker', 'exec', self.container['Id'], 'cat', '/etc/odoo/odoo.conf']:
            value = self.mounted
        else:
            self.fail('unexpected docker operation')
        return subprocess.CompletedProcess(argv, 0, value, b'')

    def inspect(self, expected=None, **options):
        from .runtime_identity import inspect_odoo_runtime
        return inspect_odoo_runtime('blue-odoo', expected or self.expected, runner=self.runner, **options)

    def refused(self, expected=None, **options):
        from .runtime_identity import RuntimeIdentityError
        with self.assertRaisesRegex(RuntimeIdentityError, '^odoo_runtime_identity_rejected$'):
            self.inspect(expected, **options)

    def test_release_inspection_keeps_the_fixed_ten_second_bound(self):
        self.inspect()
        self.assertEqual(self.timeouts, [10, 10, 10])

    def test_backup_inspection_gives_each_docker_call_only_what_is_left(self):
        from .backup import Deadline
        self.call_cost = 3
        self.inspect(deadline=Deadline(12, lambda: self.clock[0]))
        self.assertEqual(self.timeouts, [10, 9, 6])  # inspect, image inspect, exec cat

    def test_backup_inspection_past_the_budget_dispatches_nothing_more(self):
        from .backup import Deadline
        self.call_cost = 2
        with self.assertRaisesRegex(ValueError, '^backup_deadline_exceeded$') as error:
            self.inspect(deadline=Deadline(1, lambda: self.clock[0]))
        self.assertIsNone(error.exception.__context__)
        self.assertEqual(self.commands, [['docker', 'inspect', 'blue-odoo']])
        self.assertEqual(self.timeouts, [1])

    def test_realistic_inspect_binds_actual_role_host_config_and_immutable_image_without_secret_output(self):
        result = self.inspect()
        self.assertTrue(result['ready']); self.assertEqual(result['dbUser'], 'pool_blue'); self.assertEqual(result['dbHost'], 'postgres')
        self.assertEqual(result['configDigest'], self.hash); self.assertEqual(result['image'], self.expected['image'])
        self.assertNotIn('private-not-for-evidence', json.dumps(result)); self.assertNotIn('password', json.dumps(result))
        self.assertIn(['docker', 'exec', self.container['Id'], 'cat', '/etc/odoo/odoo.conf'], self.commands)

    def test_stopped_wrong_pool_release_role_env_and_hash_label_are_refused(self):
        variants = [lambda: self.container['State'].update(Running=False),
                    lambda: self.container['Config']['Labels'].update({'webvue.pool': 'green'}),
                    lambda: self.container['Config']['Labels'].update({'webvue.release': 'r2'}),
                    lambda: self.container['Config']['Labels'].update({'webvue.db-config-sha256': 'f' * 64}),
                    lambda: self.container['Config']['Env'].append('WEBVUE_RELEASE_DB_USER=postgres')]
        original = copy.deepcopy(self.container)
        for mutate in variants:
            with self.subTest(mutate=variants.index(mutate)):
                self.container = copy.deepcopy(original); mutate(); self.refused()

    def test_wrong_mounted_content_and_role_host_parse_are_refused_even_with_matching_declared_digest(self):
        self.mounted = SECRET.replace(b'pool_blue', b'postgres')
        self.refused()
        self.mounted = SECRET
        for field, value in (('dbUser', 'pool_green'), ('dbHost', 'another-postgres')):
            with self.subTest(field=field): self.refused({**self.expected, field: value})

    def test_matching_hashes_do_not_replace_actual_database_role_and_host_parsing(self):
        for modified in (SECRET.replace(b'pool_blue', b'postgres'), SECRET.replace(b'db_host = postgres', b'db_host = otherhost')):
            with self.subTest(config_digest=hashlib.sha256(modified).hexdigest()):
                self.config.chmod(0o600); self.config.write_bytes(modified); self.config.chmod(0o400)
                self.mounted = modified
                config_digest = hashlib.sha256(modified).hexdigest()
                self.expected['configDigest'] = config_digest
                self.container['Config']['Labels']['webvue.db-config-sha256'] = config_digest
                self.refused()

    def test_a_mount_cannot_replace_the_guarded_launcher_or_its_imports(self):
        for destination in ('/opt/webvue/shared/launch_odoo.py', '/opt/webvue/shared/validate_odoo_config.py', '/opt/webvue/addons', '/opt/odoo', '/opt/venv', '/usr/local/bin/webvue-odoo',
                            '/opt/oca', '/opt/oca/server-ux', '/opt/webvue/tools', '/opt/webvue/tools/oca_addons.py',
                            '/opt/webvue/deploy', '/opt/webvue/deploy/oca-addons.json'):
            with self.subTest(destination=destination):
                original = copy.deepcopy(self.container['Mounts'])
                self.container['Mounts'].append({'Type': 'bind', 'Source': '/tmp/unreviewed', 'Destination': destination, 'RW': False})
                self.refused(); self.container['Mounts'] = original

    def test_wrong_image_content_and_digest_are_refused(self):
        self.image['RepoDigests'] = ['other@sha256:' + 'a' * 64]; self.refused()
        self.image['RepoDigests'] = [self.expected['image']]; self.image['Id'] = 'sha256:' + 'd' * 64; self.refused()

    def test_writeable_different_source_and_volume_mounts_are_refused(self):
        for change in ({'RW': True}, {'Source': '/different/odoo.conf'}, {'Type': 'volume'}):
            with self.subTest(change=change):
                original = copy.deepcopy(self.container['Mounts']); self.container['Mounts'][0].update(change)
                self.refused(); self.container['Mounts'] = original

    def test_host_secret_mode_symlink_and_changed_after_start_are_refused(self):
        self.config.chmod(0o600); self.refused(); self.config.chmod(0o400)
        link = self.root / 'link.conf'; link.symlink_to(self.config)
        self.refused({**self.expected, 'configPath': str(link)})
        self.container['State']['StartedAt'] = '2000-01-01T00:00:00.000000000Z'; self.refused()

    def test_host_file_bytes_must_match_the_labeled_reviewed_config(self):
        self.config.chmod(0o600); self.config.write_bytes(SECRET + b'# changed\n'); self.config.chmod(0o400)
        self.refused()

    def test_shared_entrypoint_profile_and_actual_args_cannot_override_db_credentials_or_config(self):
        original = copy.deepcopy(self.container)
        cases = [lambda: self.container['Config'].update(Entrypoint=['webvue-odoo']),
                 lambda: self.container['Config'].update(Cmd=['--db_user=postgres']),
                 lambda: self.container.update(Args=['/opt/webvue/shared/launch_odoo.py', '--db_user=postgres']),
                 lambda: self.container['Config']['Env'].append('WEBVUE_RELEASE_ROLE=cron'),
                 lambda: self.container['Config']['Env'].append('WEBVUE_TENANCY_MODE=dedicated')]
        for index, mutate in enumerate(cases):
            with self.subTest(index=index): self.container = copy.deepcopy(original); mutate(); self.refused()

    def test_environment_cannot_inject_code_before_the_guarded_python_launcher(self):
        for key in ('PYTHONPATH', 'PYTHONHOME', 'PYTHONUSERBASE', 'LD_PRELOAD', 'LD_LIBRARY_PATH'):
            with self.subTest(key=key):
                original = list(self.container['Config']['Env'])
                self.container['Config']['Env'].append(key + '=/tmp/unreviewed')
                self.refused(); self.container['Config']['Env'] = original

    def test_dedicated_entrypoint_allows_only_known_http_server_args(self):
        self.expected['tenancyMode'] = 'dedicated'
        self.container['Config'].update(Entrypoint=['webvue-odoo'])
        self.container['Config']['Env'] = ['WEBVUE_TENANCY_MODE=dedicated', 'WEBVUE_RELEASE_POOL_ID=blue', 'WEBVUE_RELEASE_ROLE=http', 'WEBVUE_RELEASE_DB_USER=pool_blue']
        self.container.update(Path='webvue-odoo', Args=['--max-cron-threads=0'])
        self.assertTrue(self.inspect()['ready'])
        for arguments in (['--db_user', 'postgres'], ['--db-password=private'], ['-c', '/tmp/other.conf'], ['shell'], ['--db_host=other']):
            with self.subTest(arguments=arguments):
                self.container['Config']['Cmd'] = arguments; self.container['Args'] = arguments; self.refused()

    def configure_cron(self, mode='shared', running=True):
        databases = ['webvue_scratch_a']
        self.expected['tenancyMode'] = mode
        self.container['State']['Running'] = running
        if not running:
            self.container['State']['StartedAt'] = '0001-01-01T00:00:00Z'
        self.container['Config']['Labels'].update({'webvue.runtime': 'cron', 'webvue.database': databases[0]})
        self.container['Config']['Env'] = ['WEBVUE_TENANCY_MODE=' + mode, 'WEBVUE_RELEASE_POOL_ID=blue',
                                           'WEBVUE_RELEASE_ROLE=cron', 'WEBVUE_RELEASE_DB_USER=pool_blue',
                                           'WEBVUE_RELEASE_DATABASES=' + databases[0]]
        entrypoint = ['/opt/venv/bin/python', '/opt/webvue/shared/launch_odoo.py'] if mode == 'shared' else ['webvue-odoo']
        arguments = ['--no-http', '--max-cron-threads=1', '--database=' + databases[0]]
        self.container['Config'].update(Entrypoint=entrypoint, Cmd=arguments)
        self.container.update(Path=entrypoint[0], Args=[*entrypoint[1:], *arguments])
        return databases

    def test_shared_cron_exact_database_profile_and_running_proof(self):
        databases = self.configure_cron()
        proof = self.inspect(cron_databases=databases)
        self.assertTrue(proof['running']); self.assertEqual(proof['runtimeRole'], 'cron')
        self.assertEqual(proof['bindingProof'], 'guarded-launch-and-mounted-config')

    def test_stopped_candidate_cron_checks_configuration_without_claiming_loaded_state(self):
        databases = self.configure_cron(running=False)
        proof = self.inspect(cron_databases=databases, allow_stopped=True)
        self.assertTrue(proof['ready']); self.assertFalse(proof['running'])
        self.assertEqual(proof['bindingProof'], 'configured-stopped-runtime')
        self.assertFalse(any(command[:2] == ['docker', 'exec'] for command in self.commands))
        self.refused(cron_databases=databases)

    def test_allow_stopped_does_not_accept_a_stopped_http_service(self):
        self.container['State']['Running'] = False
        self.refused(allow_stopped=True)

    def test_dedicated_cron_accepts_only_exact_database_and_guarded_server_command(self):
        databases = self.configure_cron(mode='dedicated')
        self.assertTrue(self.inspect(cron_databases=databases)['running'])
        self.container['Config']['Cmd'].insert(0, 'server'); self.container['Args'].insert(0, 'server')
        self.assertTrue(self.inspect(cron_databases=databases)['running'])
        for arguments in (['--no-http', '--max-cron-threads=1', '--database=other'],
                          ['--no-http', '--max-cron-threads=2', '--database=webvue_scratch_a'],
                          ['--max-cron-threads=1', '--database=webvue_scratch_a'],
                          ['--no-http', '--max-cron-threads=1', '--database=webvue_scratch_a', '--db_user=postgres']):
            with self.subTest(arguments=arguments):
                self.container['Config']['Cmd'] = arguments; self.container['Args'] = arguments
                self.refused(cron_databases=databases)

    def test_runtime_and_database_labels_cannot_disagree_with_cron_metadata(self):
        databases = self.configure_cron()
        original = copy.deepcopy(self.container)
        for labels in ({'webvue.runtime': 'http'}, {'webvue.database': 'other'}, {'webvue.database': None}):
            with self.subTest(labels=labels):
                self.container = copy.deepcopy(original)
                self.container['Config']['Labels'].update(labels)
                self.refused(cron_databases=databases)
        self.container = copy.deepcopy(original)
        self.container['Config']['Env'][-1] = 'WEBVUE_RELEASE_DATABASES=other'
        self.refused(cron_databases=databases)

    def test_http_label_and_absence_of_cron_database_metadata_are_enforced(self):
        original = copy.deepcopy(self.container)
        for labels in ({'webvue.runtime': 'cron'}, {'webvue.database': 'webvue_scratch_a'}):
            with self.subTest(labels=labels):
                self.container = copy.deepcopy(original)
                self.container['Config']['Labels'].update(labels)
                self.refused()
        self.container = copy.deepcopy(original)
        self.container['Config']['Env'].append('WEBVUE_RELEASE_DATABASES=webvue_scratch_a')
        self.refused()

    def test_stopped_candidate_still_rejects_wrong_config_and_unsafe_mount(self):
        databases = self.configure_cron(running=False)
        self.refused({**self.expected, 'configDigest': 'f' * 64}, cron_databases=databases, allow_stopped=True)
        self.container['Mounts'][0]['RW'] = True
        self.refused(cron_databases=databases, allow_stopped=True)

    def test_subprocess_exception_with_secret_content_is_sanitized(self):
        from .runtime_identity import RuntimeIdentityError, inspect_odoo_runtime
        def fail(*_args, **_kwargs): raise subprocess.CalledProcessError(1, 'docker', output=SECRET, stderr=SECRET)
        with self.assertRaisesRegex(RuntimeIdentityError, '^odoo_runtime_identity_rejected$') as error:
            inspect_odoo_runtime('blue-odoo', self.expected, runner=fail)
        self.assertNotIn('private', str(error.exception))
        self.assertIsNone(error.exception.__context__)


if __name__ == '__main__': unittest.main()
