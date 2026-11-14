# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Tenant drop effect: name guards, plan digest, identity, each stage, and a real PostgreSQL drop.

The real-database tests start their own throwaway cluster in a temporary directory (a unix socket, no TCP
port) and create databases named `liwan_drop_test_<random>` and `liwan_scratch_<32 hex>` inside it. They
never connect to any other server. Everything is removed in `tearDownClass`.
"""
import glob
import io
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import uuid

from tools.shared_saas_lifecycle import tenant_drop_effect as effect
from tools.shared_saas_lifecycle import tenant_drop_files as files
from tools.shared_saas_lifecycle.odoo_effect import EffectError

CONTROL_TENANT = '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b'
CUSTOMER = 'شركة الأمل للتجارة'
CONTROL_DATABASE = 'liwan_control'


def postgres_binary(name):
    found = shutil.which(name)
    if found:
        return found
    for pattern in ('/usr/lib/postgresql/*/bin/', '/opt/homebrew/opt/postgresql@*/bin/', '/usr/local/opt/postgresql@*/bin/'):
        for directory in sorted(glob.glob(pattern), reverse=True):
            if os.access(directory + name, os.X_OK):
                return directory + name
    return None


POSTGRES = {name: postgres_binary(name) for name in ('initdb', 'pg_ctl', 'psql')}
POSTGRES_AVAILABLE = all(POSTGRES.values())


def seal(plan):
    return {'plan': plan, 'planDigest': effect.canonical_plan_digest(plan)}


def make_plan(database='liwan_drop_test_ab12cd34', **override):
    plan = {
        'schemaVersion': 1, 'requestId': str(uuid.uuid4()), 'controlTenantId': CONTROL_TENANT, 'tenantId': 'acme',
        'database': database, 'filestore': database, 'host': 'tacme.example.test', 'customerName': CUSTOMER,
        'controlPlaneDatabase': CONTROL_DATABASE, 'restoreCopies': [], 'backupIds': [],
    }
    plan.update(override)
    return plan


def make_request(root, stage, plan, *, dry_run=False, digest=None, **config):
    sealed = seal(plan)
    return {
        'action': stage, 'dryRun': dry_run, 'plan': sealed['plan'], 'planDigest': digest or sealed['planDigest'],
        'config': {'schemaVersion': 1, 'projectName': 'liwan-shared-droptest', 'composeFile': str(root / 'compose.yml'),
                   'envFile': str(root / 'runtime.env'), 'stateDir': str(root / 'state'), 'domainSuffix': 'example.test', **config},
    }


class RecordingBackend(effect.Backend):
    """Fails every call: validation must refuse before the runtime is touched."""

    def __init__(self):
        self.calls = []

    def psql(self, service, database, sql):
        self.calls.append(('psql', service, database))
        raise AssertionError('the runtime must not be reached')

    def filestore(self, service, payload):
        self.calls.append(('filestore', service))
        raise AssertionError('the runtime must not be reached')


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='liwan-drop-guard-')).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)

    def refuse(self, code, **override):
        plan = make_plan(**override)
        backend = RecordingBackend()
        with self.assertRaisesRegex(EffectError, '^' + code + '$'):
            effect.execute(make_request(self.root, 'drop_database', plan), backend, lambda stage: self.fail('permit asked'))
        self.assertEqual(backend.calls, [])

    def test_a_tenant_database_name_must_be_a_plain_identifier(self):
        for name in ('', 'Upper', '1starts_with_digit', 'has-dash', 'has space', 'x' * 64, 'quote"d', "q'uote", 'a;drop', '../x', 'a/b'):
            with self.subTest(name=name):
                self.refuse('database_name_invalid', database=name, filestore=name)

    def test_database_and_filestore_must_be_the_same_name(self):
        self.refuse('database_filestore_mismatch', filestore='liwan_drop_test_other')

    def test_the_live_and_shared_databases_are_never_a_target(self):
        for name in ('postgres', 'template0', 'template1', 'odoo19', 'production', 'liwan_dev', 'liwan_ai',
                     'acme_production_copy', 'copy_of_odoo19', 'prod_x', 'x_postgres_y'):
            with self.subTest(name=name):
                self.refuse('database_blocklisted', database=name, filestore=name)

    def test_the_control_plane_database_is_never_a_target(self):
        for name in (CONTROL_DATABASE, CONTROL_DATABASE + '_scratch', 'old_' + CONTROL_DATABASE, 'a_' + CONTROL_DATABASE + '_b'):
            with self.subTest(name=name):
                self.refuse('database_is_control_plane', database=name, filestore=name)

    def test_a_tenant_drop_refuses_a_restore_copy_name_and_a_restore_removal_refuses_a_tenant_name(self):
        copy = 'liwan_scratch_' + 'a' * 32
        self.refuse('database_is_scratch_copy', database=copy, filestore=copy)
        for name in ('liwan_drop_test_ab12cd34', 'acme', 'liwan_scratch_' + 'A' * 32, 'liwan_scratch_' + 'a' * 31,
                     'liwan_scratch_' + 'a' * 33, 'liwan_scratch_' + 'a' * 32 + '_x', 'x_liwan_scratch_' + 'a' * 32, 'liwan_scratch_zz'):
            with self.subTest(name=name):
                with self.assertRaisesRegex(EffectError, '^restore_target_invalid$'):
                    effect.validate_restore_copy(name)
                self.refuse('restore_target_invalid', restoreCopies=[name])
        self.assertEqual(effect.validate_restore_copy(copy), copy)

    def test_a_backup_id_must_be_a_uuid(self):
        for value in ('../x', 'abc', str(uuid.uuid4()).upper(), '', 'a/b'):
            with self.subTest(value=value):
                self.refuse('backup_id_invalid', backupIds=[value])

    def test_the_host_must_belong_to_this_runtime(self):
        for host in ('Tacme.example.test', 'tacme.other.test', 'example.test', 'https://tacme.example.test', ''):
            with self.subTest(host=host):
                self.refuse('host_invalid', host=host)

    def test_a_plan_whose_digest_does_not_match_is_refused_before_any_runtime_call(self):
        for stage in effect.STAGES:
            plan = make_plan()
            request = make_request(self.root, stage, plan)
            request['plan']['customerName'] = 'Another customer'
            backend = RecordingBackend()
            with self.subTest(stage=stage), self.assertRaisesRegex(EffectError, '^plan_digest_mismatch$'):
                effect.execute(request, backend, lambda s: self.fail('permit asked'))
            self.assertEqual(backend.calls, [])

    def test_a_malformed_or_extended_plan_is_refused(self):
        plan = make_plan()
        bad_digest = make_request(self.root, 'verify', plan, digest='nothex')
        extended = make_request(self.root, 'verify', {**plan, 'extra': 'x'})
        short = make_request(self.root, 'verify', {key: value for key, value in plan.items() if key != 'host'})
        floating = make_request(self.root, 'verify', {**plan, 'schemaVersion': 1.5})
        for request in (bad_digest, extended, short, floating):
            with self.assertRaisesRegex(EffectError, '^plan_invalid$'):
                effect.execute(request, RecordingBackend(), lambda s: self.fail('permit asked'))

    def test_an_unknown_stage_or_runtime_config_is_refused(self):
        plan = make_plan()
        with self.assertRaisesRegex(EffectError, '^operation_unavailable$'):
            effect.execute({**make_request(self.root, 'verify', plan), 'action': 'drop_everything'}, RecordingBackend())
        for bad in ({'projectName': 'other'}, {'stateDir': 'relative'}, {'unexpected': 1}):
            with self.subTest(bad=bad), self.assertRaisesRegex(EffectError, '^runtime_invalid$'):
                effect.execute(make_request(self.root, 'verify', plan, **bad), RecordingBackend())

    def test_main_reports_only_an_allowlisted_code(self):
        plan = make_plan()
        request = make_request(self.root, 'verify', plan, digest='0' * 64)
        out = io.StringIO()
        self.assertEqual(effect.main(io.StringIO(json.dumps(request) + '\n'), out), 1)
        self.assertEqual(json.loads(out.getvalue()), {'error_code': 'plan_digest_mismatch'})
        out = io.StringIO()
        with mock.patch.object(effect, 'execute', side_effect=RuntimeError('private-detail /secret/path')):
            self.assertEqual(effect.main(io.StringIO(json.dumps(request) + '\n'), out), 1)
        self.assertEqual(json.loads(out.getvalue()), {'error_code': 'tenant_drop_failed'})
        out = io.StringIO()
        self.assertEqual(effect.main(io.StringIO('not json\n'), out), 1)
        self.assertEqual(json.loads(out.getvalue()), {'error_code': 'tenant_drop_failed'})

    def test_the_compose_backend_runs_sql_by_service_and_ships_the_files_source_to_the_container(self):
        config = make_request(self.root, 'verify', make_plan())['config']
        backend = effect.ComposeBackend(config)
        with mock.patch.object(effect, '_run', return_value='1\n') as run:
            self.assertEqual(backend.psql('restore-db', 'postgres', 'SELECT 1'), '1\n')
        args, stdin = run.call_args.args[0], run.call_args.args[1]
        self.assertEqual(args[:5], ['docker', 'compose', '--project-name', 'liwan-shared-droptest', '--env-file'])
        self.assertIn('--profile', args)
        self.assertEqual(args[args.index('exec'):args.index('psql')], ['exec', '-T', '-e', 'PGCLIENTENCODING=UTF8', 'restore-db'])
        self.assertEqual(stdin, 'SELECT 1')
        payload = files.filestore_payload(backend.data_dir('restore-odoo'), 'x', 'r', True)
        with mock.patch.object(effect, '_run', return_value=json.dumps({'state': 'absent'})) as run:
            self.assertEqual(backend.filestore('restore-odoo', payload), {'state': 'absent'})
        args = run.call_args.args[0]
        self.assertEqual(args[args.index('exec'):args.index('exec') + 3], ['exec', '-T', 'restore-odoo'])
        self.assertEqual(args[-2], '-c')
        self.assertEqual(args[-1], Path(files.__file__).read_text(encoding='utf-8'))
        self.assertEqual(json.loads(run.call_args.args[1]), payload)
        with mock.patch.object(effect, '_run', return_value=json.dumps({'refused': 'path_symlink'})), \
                self.assertRaisesRegex(EffectError, '^path_symlink$'):
            backend.filestore('odoo', payload)

    def test_the_container_data_directory_is_the_one_the_shared_odoo_config_enforces(self):
        config = make_request(self.root, 'verify', make_plan())['config']
        self.assertEqual(files.CONTAINER_DATA_DIR, '/var/lib/odoo')
        for service in ('odoo', 'restore-odoo'):
            self.assertEqual(effect.ComposeBackend(config).data_dir(service), '/var/lib/odoo')
        validator = (Path(__file__).resolve().parents[2] / 'deploy' / 'shared' / 'validate_odoo_config.py').read_text(encoding='utf-8')
        self.assertIn('"data_dir": "' + files.CONTAINER_DATA_DIR + '"', validator)

    def test_the_compose_path_ships_a_payload_the_files_module_accepts_and_both_sides_share_one_key_set(self):
        """Run the files module on exactly what the Compose backend sends: a mocked transport that executes it."""
        data = self.root / 'odoo-data'
        store = data / 'filestore' / 'liwan_drop_test_ab12cd34'
        (store / 'ab').mkdir(parents=True)
        (store / 'ab' / ('e' * 40)).write_bytes(b'x')
        plan = make_plan()
        request = make_request(self.root, 'remove_filestore', plan)
        shipped = []

        def container(args, stdin, timeout, error_code):
            if 'psql' in args:
                return ''  # the database is already absent
            payload = json.loads(stdin)
            shipped.append(payload)
            return json.dumps(files.run(payload))

        config = request['config']
        for dry in (True, False):
            request['dryRun'] = dry
            with mock.patch.object(effect, '_run', side_effect=container):
                result = effect.execute(request, effect.ComposeBackend(config, data_dir=str(data)), lambda stage: None)
            self.assertEqual(result['state'], 'would_remove' if dry else 'removed')
        self.assertTrue(shipped and all(set(payload) == files.PAYLOAD_KEYS for payload in shipped))
        self.assertTrue(all(payload['dataDir'] == str(data) for payload in shipped))
        self.assertFalse(store.exists())
        local = effect.LocalBackend({}, {'odoo': data})
        self.assertEqual(set(files.filestore_payload(local.data_dir('odoo'), 'n', 'r', True)), files.PAYLOAD_KEYS)

    def test_a_compose_dry_run_resolves_the_path_inside_the_container_and_refuses_a_missing_data_directory(self):
        request = make_request(self.root, 'remove_filestore', make_plan(), dry_run=True)

        def container(args, stdin, timeout, error_code):
            return '' if 'psql' in args else json.dumps(files.run(json.loads(stdin)))

        with mock.patch.object(effect, '_run', side_effect=container), self.assertRaisesRegex(EffectError, '^path_invalid$'):
            effect.execute(request, effect.ComposeBackend(request['config'], data_dir=str(self.root / 'missing')), lambda stage: None)


class FilesModuleTests(unittest.TestCase):
    REQUEST = str(uuid.uuid4())

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='liwan-drop-files-')).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.data = self.root / 'data'
        (self.data / 'filestore').mkdir(parents=True)

    def populate(self, name):
        store = self.data / 'filestore' / name
        (store / 'ab').mkdir(parents=True)
        (store / 'ab' / ('c' * 40)).write_bytes(b'12345')
        (store / 'tenant_exports').mkdir()
        (store / 'tenant_exports' / 'export.zip').write_bytes(b'archive')
        return store

    def operation(self, name, dry_run=False, data=None):
        return files.run(files.filestore_payload(data or self.data, name, self.REQUEST, dry_run))

    def test_removes_a_filestore_and_counts_what_it_held(self):
        store = self.populate('liwan_drop_test_a')
        seen = self.operation('liwan_drop_test_a', dry_run=True)
        self.assertEqual((seen['state'], seen['files'], seen['exportFiles']), ('would_remove', 2, 1))
        self.assertTrue(store.is_dir())
        done = self.operation('liwan_drop_test_a')
        self.assertEqual((done['state'], done['files'], done['bytes']), ('removed', 2, 12))
        self.assertEqual(list((self.data / 'filestore').iterdir()), [])
        self.assertEqual(self.operation('liwan_drop_test_a')['state'], 'absent')

    def test_a_missing_filestore_root_is_done(self):
        shutil.rmtree(self.data / 'filestore')
        self.assertEqual(self.operation('liwan_drop_test_a')['state'], 'absent')

    def test_a_crash_between_rename_and_remove_is_finished_on_resume(self):
        store = self.populate('liwan_drop_test_a')
        with mock.patch.object(files, '_remove_tree', side_effect=files.FileRefused('remove_failed')):
            self.assertEqual(self.operation('liwan_drop_test_a'), {'refused': 'remove_failed'})
        twin = self.data / 'filestore' / ('liwan_drop_test_a.deleting-' + self.REQUEST)
        self.assertFalse(store.exists())
        self.assertTrue(twin.is_dir())
        self.assertEqual(self.operation('liwan_drop_test_a', dry_run=True)['state'], 'would_remove')
        self.assertEqual(self.operation('liwan_drop_test_a')['state'], 'resumed')
        self.assertEqual(list((self.data / 'filestore').iterdir()), [])

    def test_a_target_and_its_renamed_twin_together_are_refused(self):
        self.populate('liwan_drop_test_a')
        (self.data / 'filestore' / ('liwan_drop_test_a.deleting-' + self.REQUEST)).mkdir()
        self.assertEqual(self.operation('liwan_drop_test_a'), {'refused': 'filestore_ambiguous'})
        self.assertTrue((self.data / 'filestore' / 'liwan_drop_test_a').is_dir())

    def test_names_that_could_leave_the_filestore_are_refused(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'keep').write_text('x')
        for name in ('', '..', '../outside', '/etc', str(outside), 'a/b', 'A', 'a b', None, 7):
            with self.subTest(name=name):
                self.assertEqual(self.operation(name), {'refused': 'name_invalid'})
        self.assertTrue((outside / 'keep').exists())

    def test_a_symbolic_link_is_never_followed(self):
        outside = self.root / 'outside'
        (outside / 'inner').mkdir(parents=True)
        (outside / 'inner' / 'keep').write_text('x')
        (self.data / 'filestore' / 'liwan_drop_test_a').symlink_to(outside)
        self.assertEqual(self.operation('liwan_drop_test_a'), {'refused': 'path_symlink'})
        self.assertEqual(self.operation('liwan_drop_test_a', dry_run=True), {'refused': 'path_symlink'})
        self.assertTrue((outside / 'inner' / 'keep').exists())
        link_to_data = self.root / 'data-link'
        link_to_data.symlink_to(self.data)
        self.assertEqual(self.operation('liwan_drop_test_a', data=link_to_data), {'refused': 'path_invalid'})
        link_in_data = self.root / 'real' / 'data'
        link_in_data.mkdir(parents=True)
        (link_in_data / 'filestore').symlink_to(self.data / 'filestore')
        self.assertIn(self.operation('liwan_drop_test_a', data=link_in_data)['refused'], ('path_symlink', 'path_invalid'))
        self.assertTrue((outside / 'inner' / 'keep').exists())

    def test_a_link_inside_the_filestore_is_removed_without_touching_its_target(self):
        store = self.populate('liwan_drop_test_a')
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'keep').write_text('x')
        (store / 'link').symlink_to(outside)
        self.assertEqual(self.operation('liwan_drop_test_a')['state'], 'removed')
        self.assertTrue((outside / 'keep').exists())

    def test_a_relative_data_directory_and_a_bad_request_id_are_refused(self):
        self.assertEqual(files.run(files.filestore_payload('data', 'a', self.REQUEST, False)), {'refused': 'path_invalid'})
        self.assertEqual(files.run(files.filestore_payload(self.data, 'a', '../x', False)), {'refused': 'name_invalid'})
        good = files.filestore_payload(self.data, 'a', self.REQUEST, False)
        for key in files.PAYLOAD_KEYS - {'op'}:
            self.assertEqual(files.run({k: v for k, v in good.items() if k != key}), {'refused': 'operation_unavailable'})
        self.assertEqual(files.run({**good, 'extra': 1}), {'refused': 'operation_unavailable'})
        self.assertEqual(files.run({'op': 'other'}), {'refused': 'operation_unavailable'})
        self.assertEqual(files.run('not a dict'), {'refused': 'operation_unavailable'})

    def test_the_module_is_self_contained_for_the_container(self):
        self.populate('liwan_drop_test_a')
        source = Path(files.__file__).read_text(encoding='utf-8')
        payload = files.filestore_payload(self.data, 'liwan_drop_test_a', self.REQUEST, False)
        done = subprocess.run([sys.executable, '-I', '-c', source], input=json.dumps(payload).encode(), capture_output=True, check=True, cwd=self.root)
        self.assertEqual(json.loads(done.stdout)['state'], 'removed')

    def test_remove_file_takes_one_exact_name(self):
        directory = self.root / 'state' / 'credentials'
        directory.mkdir(parents=True)
        (directory / 'acme.json').write_text('{}')
        (directory / 'other.json').write_text('{}')
        self.assertEqual(files.remove_file(directory, 'acme.json', True), {'state': 'would_remove'})
        self.assertEqual(files.remove_file(directory, 'acme.json', False), {'state': 'removed'})
        self.assertEqual(files.remove_file(directory, 'acme.json', False), {'state': 'absent'})
        self.assertTrue((directory / 'other.json').exists())
        for name in ('../acme.json', 'acme.txt', 'ACME.json', '', 'a/b.json'):
            with self.assertRaises(files.FileRefused):
                files.remove_file(directory, name, False)
        (directory / 'link.json').symlink_to(directory / 'other.json')
        with self.assertRaises(files.FileRefused):
            files.remove_file(directory, 'link.json', False)
        self.assertTrue((directory / 'other.json').exists())


class PostgresCluster:
    """A throwaway server on a unix socket in a temporary directory; nothing else is ever contacted."""

    def __init__(self):
        # A short path: a unix socket path is limited to about 100 bytes, which the default temporary directory can exceed.
        self.root = Path(tempfile.mkdtemp(prefix='ldp-', dir='/tmp'))
        self.socket = self.root / 'sock'
        self.socket.mkdir()
        self.port = str(random.randint(20000, 60000))
        data = self.root / 'data'
        # macOS refuses to start a multithreaded postmaster under an unusual locale: pin the plain one.
        environment = {**os.environ, 'LC_ALL': 'C', 'LANG': 'C'}
        try:
            self._start(data, environment)
        except BaseException:
            self.stop()
            raise

    def _start(self, data, environment):
        subprocess.run([POSTGRES['initdb'], '-D', str(data), '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C'],
                       check=True, capture_output=True, env=environment)
        options = f"-c listen_addresses='' -c unix_socket_directories='{self.socket}' -p {self.port} -c fsync=off"
        subprocess.run([POSTGRES['pg_ctl'], '-D', str(data), '-o', options, '-w', '-l', str(self.root / 'log'), 'start'],
                       check=True, capture_output=True, env=environment)
        self.argv = [POSTGRES['psql'], '-h', str(self.socket), '-p', self.port, '-U', 'postgres']
        self.sql('postgres', 'CREATE ROLE odoo LOGIN')

    def sql(self, database, statement):
        done = subprocess.run(self.argv + ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database], input=statement.encode(),
                              capture_output=True, check=True)
        return done.stdout.decode().strip()

    def exists(self, database):
        return self.sql('postgres', f"SELECT count(*) FROM pg_database WHERE datname = '{database}'") == '1'

    def stop(self):
        subprocess.run([POSTGRES['pg_ctl'], '-D', str(self.root / 'data'), '-m', 'immediate', '-w', 'stop'], capture_output=True, check=False)
        shutil.rmtree(self.root, ignore_errors=True)


def tenant_schema_sql(plan, **change):
    values = {'url': 'https://' + plan['host'], 'frozen': 'True', 'marker': plan['controlTenantId'], 'mode': 'saas',
              'source': 'control_plane', 'company': plan['customerName'], 'profiles': 1}
    values.update(change)
    statements = [
        'CREATE TABLE ir_config_parameter (key text PRIMARY KEY, value text)',
        'CREATE TABLE res_company (id integer PRIMARY KEY, name text)',
        'CREATE TABLE liwan_tenant_profile (id serial PRIMARY KEY, commercial_mode text, entitlement_source text, root_company_id integer)',
        "INSERT INTO res_company VALUES (1, '" + (values['company'] or '').replace("'", "''") + "')",
    ]
    for key, name in (('web.base.url', 'url'), ('web.base.url.freeze', 'frozen'), ('liwan.control.tenant_id', 'marker')):
        if values[name] is not None:
            statements.append(f"INSERT INTO ir_config_parameter VALUES ('{key}', '{values[name]}')")
    statements += [f"INSERT INTO liwan_tenant_profile (commercial_mode, entitlement_source, root_company_id) VALUES ('{values['mode']}', '{values['source']}', 1)"
                   for _ in range(values['profiles'])]
    return ';\n'.join(statements)


@unittest.skipUnless(POSTGRES_AVAILABLE, 'initdb, pg_ctl and psql are required for the real PostgreSQL tests')
class RealDropTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cluster = PostgresCluster()

    @classmethod
    def tearDownClass(cls):
        cls.cluster.stop()

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='liwan-drop-real-')).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.state = self.root / 'state'
        for name in ('reservations', 'credentials', 'classifications', 'restore-effects', 'backups'):
            (self.state / name).mkdir(parents=True)
        (self.root / 'data' / 'filestore').mkdir(parents=True)
        (self.root / 'restore-data' / 'filestore').mkdir(parents=True)
        self.egress = self.root / 'egress'
        self.egress.mkdir()
        self.backend = effect.LocalBackend(
            {'db': self.cluster.argv, 'restore-db': self.cluster.argv},
            {'odoo': self.root / 'data', 'restore-odoo': self.root / 'restore-data'})
        self.permits = []
        self.database = 'liwan_drop_test_' + uuid.uuid4().hex[:12]
        self.plan = make_plan(self.database)

    def tearDown(self):
        for name in self.cluster.sql('postgres', "SELECT datname FROM pg_database WHERE datname LIKE 'liwan\\_drop\\_test\\_%' OR datname LIKE 'liwan\\_scratch\\_%'").split():
            self.cluster.sql('postgres', f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')

    # ---- fixtures -------------------------------------------------------------------------------------

    def create_tenant(self, **change):
        self.cluster.sql('postgres', f'CREATE DATABASE "{self.database}"')
        self.cluster.sql(self.database, tenant_schema_sql(self.plan, **change))

    def create_copy(self, name, marker=CONTROL_TENANT):
        """A restore copy: a database that carries the marker of the tenant it was restored from."""
        self.cluster.sql('postgres', f'CREATE DATABASE "{name}"')
        self.cluster.sql(name, 'CREATE TABLE ir_config_parameter (key text PRIMARY KEY, value text)'
                         + ('' if marker is None else f"; INSERT INTO ir_config_parameter VALUES ('liwan.control.tenant_id', '{marker}')"))

    def create_filestore(self, root='data', name=None):
        store = self.root / root / 'filestore' / (name or self.database)
        (store / 'ab').mkdir(parents=True)
        (store / 'ab' / ('d' * 40)).write_bytes(b'attachment')
        (store / 'tenant_exports').mkdir()
        (store / 'tenant_exports' / 'export.zip').write_bytes(b'archive')
        return store

    def create_side_files(self, name=None):
        name = name or self.database
        written = {
            'reservation': self.state / 'reservations' / (name + '.json'),
            'complete': self.state / 'reservations' / (name + '.complete'),
            'credentials': self.state / 'credentials' / (name + '.json'),
            'classification': self.state / 'classifications' / (name + '.json'),
            'egress': self.egress / (name + '.hosts'),
        }
        for path in written.values():
            path.write_text('{}')
        return written

    def run_stage(self, stage, *, dry_run=False, plan=None, **config):
        request = make_request(self.root, stage, plan or self.plan, dry_run=dry_run, aiEgressDir=str(self.egress), **config)
        return effect.execute(request, self.backend, self.permits.append)

    # ---- identity -------------------------------------------------------------------------------------

    def test_verify_accepts_the_matching_database_and_reports_checks_only(self):
        self.create_tenant()
        result = self.run_stage('verify')
        self.assertEqual((result['verdict'], result['fenced']), ('ok', False))
        self.assertEqual(result['checks'], {'baseUrl': True, 'baseUrlFrozen': True, 'profileCount': 1, 'profile': True, 'company': True, 'marker': 'match'})
        self.assertNotIn(CUSTOMER, json.dumps(result, ensure_ascii=False))
        self.assertEqual(self.permits, [])

    def test_verify_of_an_absent_database_is_absent_not_an_error(self):
        self.assertEqual(self.run_stage('verify'), {'stage': 'verify', 'dryRun': False, 'database': self.database, 'verdict': 'absent'})

    def test_the_company_name_is_compared_after_unicode_normalisation(self):
        self.create_tenant(company='Áhmed Co')
        plan = {**self.plan, 'customerName': 'Áhmed Co'}
        result = self.run_stage('verify', plan=plan)
        self.assertEqual((result['verdict'], result['checks']['company']), ('ok', True))

    def test_a_renamed_company_is_reported_but_does_not_block_a_matching_marker(self):
        self.create_tenant(company='Renamed inside the tenant')
        result = self.run_stage('verify')
        self.assertEqual((result['verdict'], result['checks']['company'], result['checks']['marker']), ('ok', False, 'match'))
        self.assertEqual(self.run_stage('drop_database')['state'], 'dropped')

    def test_every_identity_mismatch_refuses_and_changes_nothing(self):
        cases = [
            ({'url': 'https://other.example.test'}, 'identity_base_url_mismatch'),
            ({'url': 'http://tacme.example.test'}, 'identity_base_url_mismatch'),
            ({'url': None}, 'identity_base_url_mismatch'),
            ({'frozen': 'False'}, 'identity_base_url_not_frozen'),
            ({'frozen': None}, 'identity_base_url_not_frozen'),
            ({'profiles': 2}, 'identity_profile_count'),
            ({'profiles': 0}, 'identity_profile_count'),
            ({'mode': 'non_saas'}, 'identity_profile_mode'),
            ({'source': 'local_policy'}, 'identity_profile_mode'),
            ({'marker': None}, 'identity_marker_missing'),
            ({'marker': '00000000-0000-4000-8000-000000000000'}, 'identity_marker_mismatch'),
            ({'marker': ''}, 'identity_marker_mismatch'),
        ]
        for change, code in cases:
            with self.subTest(change=change):
                self.create_tenant(**change)
                store = self.create_filestore()
                side = self.create_side_files()
                for dry_run in (False, True):
                    verdict = self.run_stage('verify', dry_run=dry_run)
                    self.assertEqual((verdict['verdict'], verdict['code']), ('refused', code))
                    self.assertIn('checks', verdict)
                    with self.assertRaisesRegex(EffectError, '^' + code + '$'):
                        self.run_stage('drop_database', dry_run=dry_run)
                self.assertTrue(self.cluster.exists(self.database))
                self.assertTrue(store.is_dir())
                self.assertTrue(all(path.exists() for path in side.values()))
                self.assertEqual(self.permits, [])
                self.cluster.sql('postgres', f'DROP DATABASE "{self.database}"')
                shutil.rmtree(store)

    def test_a_database_without_the_expected_tables_is_an_identity_failure(self):
        self.cluster.sql('postgres', f'CREATE DATABASE "{self.database}"')
        with self.assertRaisesRegex(EffectError, '^identity_query_failed$'):
            self.run_stage('drop_database')
        self.assertTrue(self.cluster.exists(self.database))

    # ---- drop -----------------------------------------------------------------------------------------

    def test_dry_run_changes_nothing_in_any_stage(self):
        copy = 'liwan_scratch_' + 'c' * 32
        backup_id = str(uuid.uuid4())
        plan = {**self.plan, 'restoreCopies': [copy], 'backupIds': [backup_id]}
        self.create_tenant()
        self.create_copy(copy)
        store = self.create_filestore()
        copy_store = self.create_filestore('restore-data', copy)
        side = self.create_side_files()
        copy_side = [self.state / 'restore-effects' / (copy + '.json'), self.state / 'classifications' / (copy + '.json')]
        for path in copy_side:
            path.write_text('{}')
        backup = self.state / 'backups' / backup_id
        backup.mkdir()
        (backup / 'manifest.json').write_text('{}')
        results = {stage: self.run_stage(stage, dry_run=True, plan=plan) for stage in effect.STAGES}
        self.assertEqual(results['drop_database']['state'], 'would_drop')
        self.assertEqual(results['remove_filestore']['state'], 'would_remove')
        self.assertEqual(results['remove_filestore']['blockedBy'], 'database_still_present')
        self.assertEqual(results['remove_restore_copies']['copies'][0]['database']['state'], 'would_drop')
        self.assertEqual(results['purge_local_backups']['backups'][0]['state'], 'would_remove')
        self.assertEqual({key: value['state'] for key, value in results['remove_side_files'].items() if isinstance(value, dict)},
                         {'credentials': 'would_remove', 'classification': 'would_remove', 'aiEgress': 'would_remove'})
        self.assertTrue(self.cluster.exists(self.database) and self.cluster.exists(copy))
        self.assertTrue(store.is_dir() and copy_store.is_dir() and backup.is_dir())
        self.assertTrue(all(path.exists() for path in [*side.values(), *copy_side]))
        self.assertEqual(self.permits, [])
        self.assertEqual(len(list((self.root / 'data' / 'filestore').iterdir())), 1)

    def test_the_real_drop_removes_the_database_after_a_permit_and_keeps_the_filestore_for_its_own_stage(self):
        self.create_tenant()
        store = self.create_filestore()
        result = self.run_stage('drop_database')
        self.assertEqual((result['state'], result['sessionsTerminated']), ('dropped', 0))
        self.assertFalse(self.cluster.exists(self.database))
        self.assertTrue(store.is_dir())
        self.assertEqual(self.permits, ['drop-database'])

    def test_the_drop_ends_an_open_session_with_force(self):
        self.create_tenant()
        holder = subprocess.Popen(self.cluster.argv + ['-X', '-q', '-d', self.database, '-c', 'SELECT pg_sleep(120)'],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(holder.kill)
        for _ in range(100):
            if self.cluster.sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname = '{self.database}' AND state = 'active'") != '0':
                break
            subprocess.run(['sleep', '0.1'], check=True)
        else:
            self.fail('the session never opened')
        result = self.run_stage('drop_database')
        self.assertEqual(result['state'], 'dropped')
        self.assertGreaterEqual(result['sessionsTerminated'], 1)
        self.assertFalse(self.cluster.exists(self.database))
        holder.wait(timeout=10)

    def test_a_refused_permit_leaves_the_database_alone(self):
        self.create_tenant()

        def refuse(_stage):
            raise EffectError('authority_lost')

        with self.assertRaisesRegex(EffectError, '^authority_lost$'):
            effect.execute(make_request(self.root, 'drop_database', self.plan), self.backend, refuse)
        self.assertTrue(self.cluster.exists(self.database))

    def test_the_identity_is_read_again_after_the_permit(self):
        self.create_tenant()

        def change_marker(_stage):
            self.cluster.sql(self.database, "UPDATE ir_config_parameter SET value = 'changed' WHERE key = 'liwan.control.tenant_id'")

        with self.assertRaisesRegex(EffectError, '^identity_marker_mismatch$'):
            effect.execute(make_request(self.root, 'drop_database', self.plan), self.backend, change_marker)
        self.assertTrue(self.cluster.exists(self.database))

    # ---- filestore, side files, backups, restore copies ---------------------------------------------------

    def test_the_filestore_stage_refuses_while_the_database_exists(self):
        self.create_tenant()
        store = self.create_filestore()
        with self.assertRaisesRegex(EffectError, '^database_still_present$'):
            self.run_stage('remove_filestore')
        self.assertTrue(store.is_dir())
        self.assertEqual(self.permits, [])

    def test_the_filestore_stage_removes_the_tenant_files_and_the_export_archive_inside_them(self):
        store = self.create_filestore()
        other = self.create_filestore(name='liwan_drop_test_other')
        result = self.run_stage('remove_filestore')
        self.assertEqual((result['state'], result['files'], result['exportFiles']), ('removed', 2, 1))
        self.assertFalse(store.exists())
        self.assertTrue(other.is_dir())
        self.assertEqual(self.permits, ['remove-filestore'])

    def test_a_filestore_that_is_a_link_is_refused_and_its_target_survives(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'keep').write_text('x')
        (self.root / 'data' / 'filestore' / self.database).symlink_to(outside)
        with self.assertRaisesRegex(EffectError, '^path_symlink$'):
            self.run_stage('remove_filestore')
        self.assertTrue((outside / 'keep').exists())

    def test_side_files_go_but_the_reservation_tombstone_stays(self):
        side = self.create_side_files()
        other = self.create_side_files('liwan_drop_test_other')
        result = self.run_stage('remove_side_files')
        self.assertEqual({key: result[key]['state'] for key in ('credentials', 'classification', 'aiEgress')},
                         {'credentials': 'removed', 'classification': 'removed', 'aiEgress': 'removed'})
        self.assertTrue(side['reservation'].exists() and side['complete'].exists())
        self.assertFalse(side['credentials'].exists() or side['classification'].exists() or side['egress'].exists())
        self.assertTrue(all(path.exists() for path in other.values()))

    def test_the_egress_hosts_file_is_skipped_when_no_directory_is_configured(self):
        request = make_request(self.root, 'remove_side_files', self.plan)
        result = effect.execute(request, self.backend, self.permits.append)
        self.assertEqual(result['aiEgress'], {'state': 'not_configured'})

    def test_only_the_listed_backup_ids_are_removed(self):
        listed, unlisted = str(uuid.uuid4()), str(uuid.uuid4())
        for backup_id in (listed, unlisted):
            (self.state / 'backups' / backup_id).mkdir()
            (self.state / 'backups' / backup_id / 'manifest.json').write_text('{}')
        plan = {**self.plan, 'backupIds': [listed]}
        result = self.run_stage('purge_local_backups', plan=plan)
        self.assertEqual([(entry['id'], entry['state']) for entry in result['backups']], [(listed, 'removed')])
        self.assertFalse((self.state / 'backups' / listed).exists())
        self.assertTrue((self.state / 'backups' / unlisted / 'manifest.json').exists())

    def test_a_backup_entry_that_is_a_link_is_refused(self):
        backup_id = str(uuid.uuid4())
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'keep').write_text('x')
        (self.state / 'backups' / backup_id).symlink_to(outside)
        with self.assertRaisesRegex(EffectError, '^path_symlink$'):
            self.run_stage('purge_local_backups', plan={**self.plan, 'backupIds': [backup_id]})
        self.assertTrue((outside / 'keep').exists())

    def test_restore_copies_outside_the_plan_are_untouched(self):
        listed, unlisted = 'liwan_scratch_' + 'a' * 32, 'liwan_scratch_' + 'b' * 32
        for name in (listed, unlisted):
            self.create_copy(name)
            self.create_filestore('restore-data', name)
            (self.state / 'restore-effects' / (name + '.json')).write_text('{}')
            (self.state / 'classifications' / (name + '.json')).write_text('{}')
        self.create_tenant()
        plan = {**self.plan, 'restoreCopies': [listed]}
        result = self.run_stage('remove_restore_copies', plan=plan)
        copy = result['copies'][0]
        self.assertEqual((copy['database']['state'], copy['filestore']['state'], copy['restoreEffect']['state'], copy['classification']['state']),
                         ('dropped', 'removed', 'removed', 'removed'))
        self.assertFalse(self.cluster.exists(listed))
        self.assertFalse((self.root / 'restore-data' / 'filestore' / listed).exists())
        self.assertTrue(self.cluster.exists(unlisted) and self.cluster.exists(self.database))
        self.assertTrue((self.root / 'restore-data' / 'filestore' / unlisted).is_dir())
        self.assertTrue((self.state / 'restore-effects' / (unlisted + '.json')).exists())
        self.assertTrue((self.state / 'classifications' / (unlisted + '.json')).exists())
        self.assertEqual(self.permits, ['remove-restore-copies'])

    # ---- resume after the fence ---------------------------------------------------------------------------

    def fail_the_drop_once(self):
        """A backend whose first DROP DATABASE dies, as a kill between the fence and the drop would."""
        real, state = self.backend.psql, {'failed': False}

        def psql(service, database, sql):
            if sql.startswith('DROP DATABASE') and not state['failed']:
                state['failed'] = True
                raise EffectError('database_command_failed')
            return real(service, database, sql)

        flaky = effect.LocalBackend(self.backend.psql_argv, self.backend.data_dirs)
        flaky.psql = psql
        return flaky

    def fenced_state(self):
        return self.cluster.sql('postgres', f"SELECT datallowconn::text || '|' || COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '{self.database}'")

    def test_a_drop_that_dies_after_the_fence_resumes_without_connecting_to_the_database(self):
        self.create_tenant()
        request = make_request(self.root, 'drop_database', self.plan)
        with self.assertRaisesRegex(EffectError, '^database_drop_failed$'):
            effect.execute(request, self.fail_the_drop_once(), self.permits.append)
        allow, _, stamp = self.fenced_state().partition('|')
        self.assertEqual(allow, 'false')
        self.assertEqual(stamp, f"liwan-drop {self.plan['requestId']} {request['planDigest']}")
        self.assertTrue(self.cluster.exists(self.database))
        # The fence refuses every connection, so the verify of a fresh run could not read the identity: it relies on the stamp.
        verdict = effect.execute({**request, 'action': 'verify'}, self.backend, self.permits.append)
        self.assertEqual((verdict['verdict'], verdict['fenced']), ('ok', True))
        self.assertEqual(effect.execute({**request, 'dryRun': True}, self.backend, self.permits.append)['state'], 'would_drop')
        self.assertTrue(self.cluster.exists(self.database))
        result = effect.execute(request, self.backend, self.permits.append)
        self.assertEqual(result['state'], 'dropped')
        self.assertFalse(self.cluster.exists(self.database))

    def test_a_fenced_database_with_a_missing_or_different_stamp_is_refused(self):
        self.create_tenant()
        self.cluster.sql('postgres', f'ALTER DATABASE "{self.database}" WITH ALLOW_CONNECTIONS false')
        for comment in (None, 'liwan-drop ' + str(uuid.uuid4()) + ' ' + '0' * 64, 'something else'):
            with self.subTest(comment=comment):
                self.cluster.sql('postgres', f'COMMENT ON DATABASE "{self.database}" IS ' + ('NULL' if comment is None else f"'{comment}'"))
                verdict = self.run_stage('verify')
                self.assertEqual((verdict['verdict'], verdict['code']), ('refused', 'database_fence_unproven'))
                for dry_run in (False, True):
                    with self.assertRaisesRegex(EffectError, '^database_fence_unproven$'):
                        self.run_stage('drop_database', dry_run=dry_run)
                self.assertTrue(self.cluster.exists(self.database))
        self.assertEqual(self.permits, [])

    def test_a_stamp_on_a_database_that_is_not_fenced_does_not_bypass_the_identity_check(self):
        self.create_tenant(marker='00000000-0000-4000-8000-000000000000')
        request = make_request(self.root, 'drop_database', self.plan)
        self.cluster.sql('postgres', f"COMMENT ON DATABASE \"{self.database}\" IS 'liwan-drop {self.plan['requestId']} {request['planDigest']}'")
        with self.assertRaisesRegex(EffectError, '^identity_marker_mismatch$'):
            effect.execute(request, self.backend, self.permits.append)
        self.assertTrue(self.cluster.exists(self.database))

    def test_the_stamp_is_written_only_after_a_successful_identity_check(self):
        self.create_tenant(marker=None)
        with self.assertRaisesRegex(EffectError, '^identity_marker_missing$'):
            self.run_stage('drop_database')
        self.assertEqual(self.fenced_state(), 'true|')

    # ---- the marker of a tenant provisioned before markers existed --------------------------------------------

    def test_stamp_marker_backfills_once_after_the_other_checks_and_never_overwrites(self):
        self.create_tenant(marker=None)
        verdict = self.run_stage('verify')
        self.assertEqual((verdict['verdict'], verdict['code'], verdict['checks']['marker']), ('refused', 'identity_marker_missing', 'missing'))
        self.assertEqual(self.run_stage('stamp_marker', dry_run=True)['state'], 'would_stamp')
        self.assertEqual(self.cluster.sql(self.database, "SELECT count(*) FROM ir_config_parameter WHERE key = 'liwan.control.tenant_id'"), '0')
        self.assertEqual(self.permits, [])
        stamped = self.run_stage('stamp_marker')
        self.assertEqual((stamped['state'], stamped['checks']['marker']), ('stamped', 'match'))
        self.assertEqual(self.permits, ['stamp-marker'])
        again = self.run_stage('stamp_marker')
        self.assertEqual(again['state'], 'present')
        self.assertEqual(self.permits, ['stamp-marker'])
        self.assertEqual(self.run_stage('verify')['verdict'], 'ok')

    def test_stamp_marker_refuses_a_different_marker_and_every_other_identity_failure(self):
        cases = [({'marker': '00000000-0000-4000-8000-000000000000'}, 'identity_marker_mismatch'),
                 ({'marker': None, 'company': 'Another customer'}, 'identity_company_mismatch'),
                 ({'marker': None, 'url': 'https://other.example.test'}, 'identity_base_url_mismatch'),
                 ({'marker': None, 'frozen': None}, 'identity_base_url_not_frozen'),
                 ({'marker': None, 'profiles': 2}, 'identity_profile_count'),
                 ({'marker': None, 'mode': 'non_saas'}, 'identity_profile_mode'),
                 ({'marker': None, 'source': 'local_policy'}, 'identity_profile_mode')]
        for change, code in cases:
            with self.subTest(code=code, change=change):
                self.create_tenant(**change)
                for dry_run in (True, False):
                    with self.assertRaisesRegex(EffectError, '^' + code + '$'):
                        self.run_stage('stamp_marker', dry_run=dry_run)
                self.assertNotEqual(self.cluster.sql(self.database, "SELECT coalesce(max(value), '') FROM ir_config_parameter WHERE key = 'liwan.control.tenant_id'"), CONTROL_TENANT)
                self.cluster.sql('postgres', f'DROP DATABASE "{self.database}"')
        self.assertEqual(self.permits, [])

    def test_stamp_marker_needs_an_existing_unfenced_database(self):
        with self.assertRaisesRegex(EffectError, '^database_missing$'):
            self.run_stage('stamp_marker')
        self.create_tenant(marker=None)
        self.cluster.sql('postgres', f'ALTER DATABASE "{self.database}" WITH ALLOW_CONNECTIONS false')
        with self.assertRaisesRegex(EffectError, '^database_fence_unproven$'):
            self.run_stage('stamp_marker')

    # ---- restore copies prove they belong to this tenant ----------------------------------------------------

    def test_a_restore_copy_with_the_tenant_marker_is_dropped_one_of_another_tenant_or_without_a_marker_is_refused(self):
        other, bare, mine = ('liwan_scratch_' + c * 32 for c in 'abc')
        self.create_copy(other, marker='00000000-0000-4000-8000-000000000000')
        self.create_copy(bare, marker=None)
        self.create_copy(mine)
        for name, code in ((other, 'restore_copy_marker_mismatch'), (bare, 'restore_copy_marker_missing')):
            store = self.create_filestore('restore-data', name)
            for dry_run in (True, False):
                with self.subTest(name=name, dry_run=dry_run), self.assertRaisesRegex(EffectError, '^' + code + '$'):
                    self.run_stage('remove_restore_copies', dry_run=dry_run, plan={**self.plan, 'restoreCopies': [name]})
            self.assertTrue(self.cluster.exists(name) and store.is_dir())
        self.assertEqual(self.permits, [])
        self.assertEqual(self.run_stage('remove_restore_copies', plan={**self.plan, 'restoreCopies': [mine]})['copies'][0]['database']['state'], 'dropped')
        self.assertTrue(self.cluster.exists(other) and self.cluster.exists(bare))

    def test_a_restore_copy_that_does_not_accept_connections_or_has_no_table_is_unreadable(self):
        fenced, empty = 'liwan_scratch_' + 'd' * 32, 'liwan_scratch_' + 'e' * 32
        self.create_copy(fenced)
        self.cluster.sql('postgres', f'ALTER DATABASE "{fenced}" WITH ALLOW_CONNECTIONS false')
        self.cluster.sql('postgres', f'CREATE DATABASE "{empty}"')
        for name in (fenced, empty):
            with self.subTest(name=name), self.assertRaisesRegex(EffectError, '^restore_copy_unreadable$'):
                self.run_stage('remove_restore_copies', plan={**self.plan, 'restoreCopies': [name]})
            self.assertTrue(self.cluster.exists(name))

    # ---- idempotence -------------------------------------------------------------------------------------

    def test_every_stage_treats_an_absent_target_as_done_without_a_permit(self):
        plan = {**self.plan, 'restoreCopies': ['liwan_scratch_' + 'd' * 32], 'backupIds': [str(uuid.uuid4())]}
        # `stamp_marker` is the one stage that needs the database: its absence is `database_missing`, tested apart.
        results = {stage: self.run_stage(stage, plan=plan) for stage in effect.STAGES if stage != 'stamp_marker'}
        self.assertEqual(results['verify']['verdict'], 'absent')
        self.assertEqual(results['drop_database']['state'], 'absent')
        self.assertEqual(results['remove_filestore']['state'], 'absent')
        copy = results['remove_restore_copies']['copies'][0]
        self.assertEqual({copy[key]['state'] for key in ('database', 'filestore', 'restoreEffect', 'classification')}, {'absent'})
        self.assertEqual(results['purge_local_backups']['backups'][0]['state'], 'absent')
        self.assertEqual({results['remove_side_files'][key]['state'] for key in ('credentials', 'classification', 'aiEgress')}, {'absent'})
        self.assertEqual(self.permits, [])

    def test_a_second_full_run_is_a_no_op(self):
        copy = 'liwan_scratch_' + 'e' * 32
        backup_id = str(uuid.uuid4())
        plan = {**self.plan, 'restoreCopies': [copy], 'backupIds': [backup_id]}
        self.create_tenant()
        self.create_copy(copy)
        self.create_filestore()
        self.create_filestore('restore-data', copy)
        side = self.create_side_files()
        (self.state / 'backups' / backup_id).mkdir()
        order = ('verify', 'drop_database', 'remove_filestore', 'remove_restore_copies', 'purge_local_backups', 'remove_side_files')
        first = [self.run_stage(stage, plan=plan) for stage in order]
        self.assertEqual(self.permits, ['drop-database', 'remove-filestore', 'remove-restore-copies', 'purge-local-backups', 'remove-side-files'])
        self.assertEqual(first[0]['verdict'], 'ok')
        self.assertEqual([self.cluster.exists(self.database), self.cluster.exists(copy)], [False, False])
        self.permits.clear()
        second = [self.run_stage(stage, plan=plan) for stage in order]
        self.assertEqual(self.permits, [])
        self.assertEqual(second[0]['verdict'], 'absent')
        self.assertEqual(second[1]['state'], 'absent')
        self.assertEqual(second[2]['state'], 'absent')
        self.assertTrue(side['reservation'].exists() and side['complete'].exists())

    def test_the_stage_result_carries_no_secret_or_file_name(self):
        self.create_tenant()
        self.create_filestore()
        self.create_side_files()
        text = json.dumps([self.run_stage('verify'), self.run_stage('drop_database'), self.run_stage('remove_filestore'), self.run_stage('remove_side_files')], ensure_ascii=False)
        for forbidden in (CUSTOMER, CONTROL_TENANT, 'export.zip', 'attachment', str(self.root)):
            self.assertNotIn(forbidden, text)


if __name__ == '__main__':
    unittest.main()
