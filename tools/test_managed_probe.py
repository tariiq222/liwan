# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pure fixture TDD: never executes Docker, connects to DB, or binds real ports."""
import copy
import errno
import hashlib
import importlib.util
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from webvue_cli.managed_bundle import CADDYFILE

if importlib.util.find_spec('webvue_cli.managed_probe') is None:
    managed_probe = None
else:
    from webvue_cli import managed_probe


IMAGES = ['sha256:' + digit * 64 for digit in 'abcd']
PROJECT = 'webvue-probe-fixture'
DATABASE = 'webvue_scratch_probe_fixture'


class FixtureRunner:
    def __init__(self):
        self.calls = []
        self.rows = {'container': [], 'volume': [], 'network': []}
        self.result = None
        self.identities = {}

    def __call__(self, argv, env=None, stdin_text=None):
        self.calls.append((argv, env, stdin_text))
        if isinstance(self.result, Exception):
            raise self.result
        if self.result is not None:
            return self.result
        if argv[1:3] == ['image', 'inspect']:
            ref = argv[-1]
            return 0, json.dumps(self.identities.get(ref, {
                'Id': ref, 'RepoDigests': [],
            })), ''
        assert argv[1] in self.rows, argv
        return 0, '\n'.join(json.dumps({key: row[key] for key in ('Name', 'Project') if key in row})
                            for row in self.rows[argv[1]]), ''


class DockerProbeCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(managed_probe, 'managed_probe implementation missing (RED)')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.catalog = self.root / 'catalog.json'
        self.catalog.write_bytes(b'{"fixture":true}\n')
        self.compose_file = self.root / 'compose.json'
        self.config = self.root / 'odoo.conf'
        self.config.write_text(
            '[options]\ndb_host = db\ndb_port = 5432\ndb_user = odoo\n'
            f'db_name = {DATABASE}\ndbfilter = ^{DATABASE}$\n'
            'list_db = False\nproxy_mode = True\nworkers = 2\nmax_cron_threads = 0\n'
            'db_password = fixture-private\nadmin_passwd = fixture-admin\n')
        (self.root / 'Caddyfile').write_text(CADDYFILE)
        (self.root / 'classification.json').write_text(json.dumps({
            'schema_version': 1, 'database': DATABASE, 'commercial_mode': 'saas',
            'entitlement_source': 'control_plane', 'expected_valid_until': None,
            'valid_until_action': 'preserve',
        }))
        self.descriptor = {
            'resource_refs': {
                'project': PROJECT, 'db_name': DATABASE,
                'compose_file': str(self.compose_file),
                'data_dir': str(self.root / 'data'),
                'ports': {'db': 25431, 'odoo': 28061, 'web': 23001},
            },
            'release_ref': {
                'catalog_version': 'fixture-v1', 'identity_kind': 'image_id',
                'catalog_sha256': 'sha256:' + hashlib.sha256(self.catalog.read_bytes()).hexdigest(),
                'odoo_image': IMAGES[0], 'web_image': IMAGES[1], 'proxy_image': IMAGES[2],
            },
        }
        self.compose = {
            'name': PROJECT,
            'services': {
                'db': {'image': IMAGES[3], 'environment': {
                    'POSTGRES_DB': DATABASE, 'POSTGRES_USER': 'odoo',
                    'POSTGRES_PASSWORD': '${POSTGRES_PASSWORD}'},
                    'ports': ['127.0.0.1:25431:5432'],
                    'volumes': ['db_data:/var/lib/postgresql/data'], 'networks': ['tenant_net']},
                'odoo': {'image': IMAGES[0], 'ports': ['127.0.0.1:28061:8069'],
                         'volumes': ['odoo_data:/var/lib/odoo', './odoo.conf:/etc/odoo/odoo.conf:ro',
                                     './classification.json:/etc/odoo/commercial.json:ro'],
                         'environment': {'WEBVUE_COMMERCIAL_CONFIG': '/etc/odoo/commercial.json'},
                         'networks': ['tenant_net']},
                'web': {'image': IMAGES[1], 'environment': {
                    'NUXT_ODOO_URL': 'http://odoo:8069', 'NUXT_ODOO_DB': DATABASE},
                    'networks': ['tenant_net']},
                'edge': {'image': IMAGES[2], 'ports': ['127.0.0.1:23001:80'],
                         'volumes': ['./Caddyfile:/etc/caddy/Caddyfile:ro'], 'networks': ['tenant_net']},
            },
            'volumes': {'db_data': {'name': PROJECT + '-db'}, 'odoo_data': {'name': PROJECT + '-odoo'}},
            'networks': {'tenant_net': {'name': PROJECT + '-private'}},
        }
        self.runner = FixtureRunner()
        self.save()
        self.probe = managed_probe.DockerProbe(self.descriptor, catalog_path=self.catalog, runner=self.runner)

    def save(self):
        self.compose_file.write_text(json.dumps(self.compose))

    def refused(self, check, value=None, code=None):
        with self.assertRaises(managed_probe.ProbeError) as caught:
            self.probe(check, value)
        if code:
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(str(caught.exception), caught.exception.code)
        self.assertNotIn('fixture-private', str(caught.exception))

    def test_arbitrary_proxy_configuration_is_refused(self):
        (self.root / 'Caddyfile').write_text(':80 { reverse_proxy external.example:80 }')
        self.refused('compose_file', str(self.compose_file), 'compose_file_invalid')

    def test_runtime_inputs_match_secrets_and_capture_all_file_bytes_without_docker(self):
        snapshot = self.probe.validate_runtime_inputs({
            'db_password': 'fixture-private', 'admin_password': 'fixture-admin',
        })
        self.assertEqual(set(snapshot), {str(self.compose_file), str(self.config),
                                         str(self.root / 'Caddyfile'), str(self.root / 'classification.json')})
        self.assertEqual(self.runner.calls, [])
        self.assertIsNone(self.probe.assert_unchanged(snapshot))
        self.config.write_text(self.config.read_text() + '\n')
        with self.assertRaises(managed_probe.ProbeError):
            self.probe.assert_unchanged(snapshot)

    def test_runtime_input_secrets_mismatch_and_missing_snapshot_fail_closed(self):
        for secrets in [{}, {'db_password': 'wrong', 'admin_password': 'fixture-admin'},
                        {'db_password': 'fixture-private', 'admin_password': 'wrong'}]:
            with self.assertRaises(managed_probe.ProbeError) as caught:
                self.probe.validate_runtime_inputs(secrets)
            self.assertNotIn('fixture-private', str(caught.exception))
        with self.assertRaises(managed_probe.ProbeError):
            self.probe.assert_unchanged({})
        with patch.object(self.probe, '_compose', side_effect=ValueError('fixture-private')):
            with self.assertRaises(managed_probe.ProbeError):
                self.probe.validate_runtime_inputs({})
        snapshot = self.probe.validate_runtime_inputs({
            'db_password': 'fixture-private', 'admin_password': 'fixture-admin',
        })
        self.config.unlink()
        with self.assertRaises(managed_probe.ProbeError):
            self.probe.assert_unchanged(snapshot)

    def test_malformed_descriptor_and_call_exceptions_are_sanitized(self):
        for descriptor in [{}, {'resource_refs': None}, {'resource_refs': {'project': None}}]:
            with self.assertRaises(managed_probe.ProbeError):
                managed_probe.DockerProbe(descriptor, catalog_path=self.catalog, runner=self.runner)
        with patch.object(self.probe, '_check', side_effect=OSError('fixture-private')):
            self.refused('compose_file', str(self.compose_file), 'preflight_unavailable')
        with patch.object(self.probe, '_check', side_effect=TypeError('fixture-private')):
            self.refused('compose_file', str(self.compose_file), 'probe_malformed')

    def test_catalog_hash_uses_explicit_file_not_descriptor(self):
        self.assertEqual(self.probe('catalog_sha256', 'fixture-v1'), self.descriptor['release_ref']['catalog_sha256'])
        self.catalog.write_bytes(b'changed')
        self.assertEqual(self.probe('catalog_sha256', 'fixture-v1'), 'sha256:' + hashlib.sha256(b'changed').hexdigest())
        self.assertEqual(self.runner.calls, [])

    def test_catalog_unavailable_is_not_a_digest(self):
        self.catalog.unlink()
        self.refused('catalog_sha256', 'fixture-v1', 'preflight_unavailable')

    def test_exact_image_id_and_repo_digest(self):
        self.assertEqual(self.probe('image_identity', IMAGES[0]), IMAGES[0])
        ref = 'example.invalid/webvue@' + IMAGES[0]
        self.descriptor['release_ref']['identity_kind'] = 'repo_digest'
        self.descriptor['release_ref']['odoo_image'] = ref
        probe = managed_probe.DockerProbe(self.descriptor, catalog_path=self.catalog, runner=self.runner)
        self.runner.identities[ref] = {'Id': IMAGES[1], 'RepoDigests': [ref]}
        self.assertEqual(probe('image_identity', ref), ref)
        self.runner.identities[ref]['RepoDigests'] = [ref + 'extra']
        with self.assertRaises(managed_probe.ProbeError):
            probe('image_identity', ref)

    def test_image_mismatch_never_pulls(self):
        self.runner.identities[IMAGES[0]] = {'Id': IMAGES[1], 'RepoDigests': []}
        self.refused('image_identity', IMAGES[0], 'image_identity_untrusted')
        self.assertEqual(self.runner.calls[0][0], ['docker', 'image', 'inspect', '--format', '{{json .}}', IMAGES[0]])
        self.assertIsNone(self.runner.calls[0][2])

    def test_unavailable_or_malformed_observations_fail_closed(self):
        for result in [(1, '', 'fixture-private'), (0, 'not json', ''),
                       (0, '{}', ''), (0, 'null', ''), (0, '[{}]', ''),
                       OSError('fixture-private'), (0, '', ''), None]:
            with self.subTest(result=repr(result)):
                self.runner.result = result if result is not None else (0, 'x' * 1048577, '')
                self.refused('image_identity', IMAGES[0])

    def test_unknown_check_or_unenrolled_query_refused_without_runner(self):
        for check, value in [('unknown', 'private'), ('project_exists', 'other'),
                             ('database_exists', 'odoo19'), ('image_identity', '--help'),
                             ('port_in_use', 5432), ('catalog_sha256', 'wrong')]:
            with self.subTest(check=check):
                self.refused(check, value)
        self.assertEqual(self.runner.calls, [])

    def test_exact_project_label_and_stopped_container_collision(self):
        self.runner.rows['container'] = [{'Name': 'unrelated', 'Project': PROJECT + '-suffix'}]
        self.assertFalse(self.probe('project_exists', PROJECT))
        self.runner.rows['container'][0]['Project'] = PROJECT
        self.assertTrue(self.probe('project_exists', PROJECT))
        self.assertIn('--all', self.runner.calls[0][0])

    def test_exact_container_name_collision_without_labels(self):
        self.runner.rows['container'] = [{'Name': PROJECT + '-db-1', 'Project': ''}]
        self.assertTrue(self.probe('project_exists', PROJECT))

    def test_volume_network_identity_no_substring_matching(self):
        for kind, suffix in [('volume', '-db'), ('network', '-private')]:
            with self.subTest(kind=kind):
                name = PROJECT + suffix
                self.runner.rows[kind] = [{'Name': name + '-other', 'Project': ''}]
                self.assertFalse(self.probe(kind + '_exists', name))
                self.runner.rows[kind][0]['Name'] = name
                self.assertTrue(self.probe(kind + '_exists', name))

    def test_malformed_resource_listing_never_means_absent(self):
        for kind, value in [('container', PROJECT), ('volume', PROJECT + '-db'), ('network', PROJECT + '-private')]:
            for row in [{}, {'Name': 'x'}, {'Name': 'x', 'Project': 3}]:
                self.runner.rows[kind] = [row]
                self.refused('project_exists' if kind == 'container' else kind + '_exists', value)

    def test_projected_resource_rows_ignore_commas_and_irrelevant_metadata_size(self):
        for kind in ('container', 'volume', 'network'):
            with self.subTest(kind=kind):
                self.runner.rows[kind] = [{
                    'Name': 'unrelated', 'Project': '',
                    'Labels': 'mount=/etc/odoo/config.ini,/etc/odoo/private.ini,with,commas ' + 'x' * 70000,
                }]
                self.assertFalse(self.probe('project_exists' if kind == 'container' else kind + '_exists',
                                            PROJECT if kind == 'container' else PROJECT + ('-db' if kind == 'volume' else '-private')))
                argv = self.runner.calls[-1][0]
                self.assertEqual(argv[-1], '{"Name":{{json .Names}},"Project":{{json (.Label "com.docker.compose.project")}}}'
                                 if kind == 'container' else
                                 '{"Name":{{json .Name}},"Project":{{json (.Label "com.docker.compose.project")}}}')

    def test_valid_compose_and_database_absence_require_fresh_resources(self):
        self.assertIs(self.probe('compose_file', str(self.compose_file)), True)
        self.assertIs(self.probe('database_exists', DATABASE), False)
        self.assertTrue(any(argv[1] == 'volume' for argv, _, _ in self.runner.calls))
        self.runner.rows['volume'] = [{'Name': PROJECT + '-odoo', 'Project': ''}]
        self.refused('database_exists', DATABASE, 'database_absence_unverified')

    def test_database_absence_never_connects_existing_database(self):
        self.runner.rows['container'] = [{'Name': 'renamed', 'Project': PROJECT}]
        self.refused('database_exists', DATABASE, 'database_absence_unverified')
        self.assertFalse(any('exec' in argv or 'run' in argv for argv, _, _ in self.runner.calls))

    def test_unreadable_docker_cannot_establish_database_absence(self):
        self.runner.result = (1, '', 'denied fixture-private')
        self.refused('database_exists', DATABASE, 'preflight_unavailable')

    def test_malicious_compose_fields_and_identity_mismatches(self):
        mutations = [
            lambda c: c.update(name='different'),
            lambda c: c['services'].update(extra=copy.deepcopy(c['services']['web'])),
            lambda c: c['services']['odoo'].update(privileged=True),
            lambda c: c['services']['odoo'].update(network_mode='host'),
            lambda c: c['services']['odoo'].update(build='.'),
            lambda c: c['services']['odoo'].update(entrypoint=['sh']),
            lambda c: c['services']['odoo'].update(command=['odoo']),
            lambda c: c['services']['odoo'].update(env_file='.env'),
            lambda c: c['services']['odoo'].update(image=IMAGES[1]),
            lambda c: c['services']['db'].update(image='postgres:17'),
            lambda c: c['services']['edge'].update(ports=['0.0.0.0:23001:80']),
            lambda c: c['services']['web'].update(ports=['127.0.0.1:23001:3000']),
            lambda c: c['services']['db']['environment'].update(POSTGRES_DB='odoo19'),
            lambda c: c['services']['db']['environment'].update(PGDATA='/other'),
            lambda c: c['services']['web']['environment'].update(NUXT_ODOO_DB='${TARGET}'),
            lambda c: c['volumes']['db_data'].update(external=True),
            lambda c: c['volumes']['db_data'].update(driver_opts={'device': '/'}),
            lambda c: c['networks']['tenant_net'].update(external=True),
            lambda c: c['networks']['tenant_net'].update(name='shared'),
            lambda c: c['services']['edge']['volumes'].append('/var/run/docker.sock:/var/run/docker.sock'),
            lambda c: c['services']['edge'].update(volumes=['./Caddyfile:/etc/caddy/Caddyfile']),
            lambda c: c['services']['odoo']['volumes'].append('./odoo.conf:/etc/other:ro'),
        ]
        original = copy.deepcopy(self.compose)
        for mutate in mutations:
            self.compose = copy.deepcopy(original)
            mutate(self.compose)
            self.save()
            with self.subTest(compose=self.compose):
                self.refused('compose_file', str(self.compose_file))

    def test_duplicate_json_keys_and_interpolation_refused(self):
        self.compose_file.write_text('{"name":"one","name":"two"}')
        self.refused('compose_file', str(self.compose_file))

    def test_config_semantics_reject_external_db_unknown_hook_and_wrong_db(self):
        original = self.config.read_text()
        for text in [original.replace('db_host = db', 'db_host = 127.0.0.1'),
                     original.replace(DATABASE, 'odoo19'),
                     original + 'server_wide_modules = malicious\n',
                     original.replace('^' + DATABASE + '$', '.*')]:
            self.config.write_text(text)
            self.refused('compose_file', str(self.compose_file))

    def test_symlink_and_writable_config_refused(self):
        self.config.chmod(0o666)
        self.refused('compose_file', str(self.compose_file))
        self.config.chmod(0o600)
        source = self.root / 'real.conf'
        self.config.rename(source)
        self.config.symlink_to(source)
        self.refused('compose_file', str(self.compose_file))

    def test_classification_must_be_fresh_exact_saas_and_database_bound(self):
        path = self.root / 'classification.json'
        original = json.loads(path.read_text())
        for key, value in [('database', 'odoo19'), ('schema_version', True),
                           ('commercial_mode', 'non_saas'), ('valid_until_action', 'clear'),
                           ('expected_valid_until', '2030-01-01'), ('extra', 'unsafe')]:
            changed = dict(original, **{key: value})
            path.write_text(json.dumps(changed))
            self.refused('compose_file', str(self.compose_file))

    def test_private_data_bind_supported_but_existing_data_not_fresh(self):
        data = self.root / 'data' / 'odoo'
        data.mkdir(parents=True)
        self.compose['services']['odoo']['volumes'][0] = str(data) + ':/var/lib/odoo'
        del self.compose['volumes']['odoo_data']
        self.save()
        self.assertTrue(self.probe('compose_file', str(self.compose_file)))
        self.assertFalse(self.probe('database_exists', DATABASE))
        (data / 'existing').write_text('not fresh')
        self.refused('database_exists', DATABASE, 'database_absence_unverified')
        for mount in ['/etc:/var/lib/odoo', str(self.root) + ':/var/lib/odoo',
                      str(data) + ':/var/lib/odoo:rw']:
            self.compose['services']['odoo']['volumes'][0] = mount
            self.save()
            self.refused('compose_file', str(self.compose_file))

    def test_untrusted_result_types_and_json_labels_refused(self):
        for result in [(True, '', ''), (0, b'', ''), (0, '', None), (0,), None]:
            self.runner.result = result if result is not None else 'malformed'
            self.refused('project_exists', PROJECT)
        self.runner.result = None
        self.runner.rows['container'] = [{'Name': 'other', 'Project': 3}]
        self.refused('project_exists', PROJECT)

    def test_named_resource_project_labels_are_collisions(self):
        self.runner.rows['volume'] = [{'Name': 'renamed', 'Project': PROJECT}]
        self.assertTrue(self.probe('volume_exists', PROJECT + '-db'))
        self.runner.rows['volume'] = []
        self.runner.rows['network'] = [{'Name': PROJECT + '-private', 'Project': ''}]
        self.refused('database_exists', DATABASE, 'database_absence_unverified')

    def test_compose_unknown_types_and_option_variants_fail_closed(self):
        original = copy.deepcopy(self.compose)
        for value in [None, [], {}, 'compose']:
            self.compose_file.write_text(json.dumps(value))
            self.refused('compose_file', str(self.compose_file))
        self.compose = original
        self.save()
        original_config = self.config.read_text()
        for text in ['[wrong]\nx = 1', '[options]\nbroken',
                     original_config + 'http_port = 9999\n',
                     original_config + 'max_cron_threads = 100\n',
                     original_config + 'data_dir = /etc\n',
                     original_config.replace('db_password = fixture-private', 'db_password ='),
                     original_config + 'db_host = other\n']:
            self.config.write_text(text)
            self.refused('compose_file', str(self.compose_file))

    def test_config_missing_and_parent_symlink_refused(self):
        self.config.unlink()
        self.refused('compose_file', str(self.compose_file))
        self.config.write_text('irrelevant')
        linked = self.root / 'linked'
        linked.symlink_to(self.root, target_is_directory=True)
        self.compose['services']['odoo']['volumes'][1] = './linked/odoo.conf:/etc/odoo/odoo.conf:ro'
        self.save()
        self.refused('compose_file', str(self.compose_file))

    def test_port_probe_binds_loopback_and_closes_never_connects(self):
        with patch.object(socket, 'socket') as factory:
            sock = factory.return_value.__enter__.return_value
            self.assertFalse(self.probe('port_in_use', 25431))
            sock.bind.assert_called_once_with(('127.0.0.1', 25431))
            sock.connect.assert_not_called()
            sock.connect_ex.assert_not_called()
            sock.bind.side_effect = OSError(errno.EADDRINUSE, 'held but not listening')
            self.assertTrue(self.probe('port_in_use', 25431))
            sock.bind.side_effect = OSError(errno.EACCES, 'fixture-private')
            self.refused('port_in_use', 25431, 'preflight_unavailable')


if __name__ == '__main__':
    unittest.main()
