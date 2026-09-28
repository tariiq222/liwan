# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pure renderer and injected-probe compatibility tests; never invoke Docker."""
import configparser
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from nasq_cli.managed_probe import DockerProbe

if importlib.util.find_spec('nasq_cli.managed_bundle') is None:
    bundle = None
else:
    from nasq_cli import managed_bundle as bundle

IMAGES = ['sha256:' + char * 64 for char in 'abcd']
# Synthetic test tokens only, never runtime credentials.
DB_TOKEN = 'synthetic_test_db_token_123456'
ADMIN_TOKEN = 'synthetic_test_admin_token_123456'
PROJECT = 'nasq-bundle-fixture'
DATABASE = 'nasq_scratch_bundle_fixture'


def descriptor():
    return {
        'commercial_mode': 'saas',
        'resource_refs': {
            'project': PROJECT, 'db_name': DATABASE,
            'compose_file': '/isolated/target/compose.json',
            'data_dir': '/isolated/target/data',
            'ports': {'db': 25431, 'odoo': 28061, 'web': 23001},
        },
        'release_ref': {
            'identity_kind': 'image_id', 'catalog_version': 'fixture-v1',
            'odoo_image': IMAGES[0], 'web_image': IMAGES[1], 'proxy_image': IMAGES[2],
        },
    }


class BundleCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(bundle, 'managed_bundle implementation missing (RED)')
        self.descriptor = descriptor()

    def render(self, **overrides):
        args = {'postgres_image': IMAGES[3], 'db_password': DB_TOKEN, 'admin_password': ADMIN_TOKEN}
        args.update(overrides)
        return bundle.render_bundle(self.descriptor, **args)

    def reject(self, **overrides):
        with self.assertRaises(bundle.BundleError) as caught:
            self.render(**overrides)
        self.assertIn(caught.exception.code, {'descriptor_invalid', 'image_invalid', 'secret_invalid'})
        self.assertEqual(str(caught.exception), caught.exception.code)
        self.assertNotIn(DB_TOKEN, str(caught.exception))
        self.assertNotIn(ADMIN_TOKEN, str(caught.exception))

    def test_exact_output_names_deterministic_and_input_unchanged(self):
        before = copy.deepcopy(self.descriptor)
        result = self.render()
        self.assertEqual(set(result), {'compose.json', 'odoo.conf', 'commercial.json', 'Caddyfile'})
        self.assertEqual(result, self.render())
        self.assertEqual(self.descriptor, before)
        self.assertTrue(all(type(value) is str and value.endswith('\n') for value in result.values()))

    def test_exact_compose_services_networks_named_volumes_and_ports(self):
        compose = json.loads(self.render()['compose.json'])
        self.assertEqual(set(compose), {'name', 'services', 'networks', 'volumes'})
        self.assertEqual(compose['name'], PROJECT)
        self.assertEqual(set(compose['services']), {'db', 'odoo', 'web', 'edge'})
        self.assertEqual(compose['networks'], {'tenant_net': {'name': PROJECT + '-private'}})
        self.assertEqual(compose['volumes'], {'db_data': {'name': PROJECT + '-db'},
                                              'odoo_data': {'name': PROJECT + '-odoo'}})
        services = compose['services']
        for name, image in [('db', IMAGES[3]), ('odoo', IMAGES[0]), ('web', IMAGES[1]), ('edge', IMAGES[2])]:
            self.assertEqual(services[name]['image'], image)
            self.assertEqual(services[name]['networks'], ['tenant_net'])
        self.assertEqual(services['db']['ports'], ['127.0.0.1:25431:5432'])
        self.assertEqual(services['odoo']['ports'], ['127.0.0.1:28061:8069'])
        self.assertEqual(services['edge']['ports'], ['127.0.0.1:23001:80'])
        self.assertEqual(services['web'].get('ports', []), [])
        self.assertEqual(services['db']['volumes'], ['db_data:/var/lib/postgresql/data'])
        self.assertEqual(set(services['odoo']['volumes']), {
            'odoo_data:/var/lib/odoo', './odoo.conf:/etc/odoo/odoo.conf:ro',
            './commercial.json:/etc/odoo/commercial.json:ro',
        })
        self.assertEqual(services['edge']['volumes'], ['./Caddyfile:/etc/caddy/Caddyfile:ro'])

    def test_public_branding_logo_route_reaches_odoo(self):
        caddy = self.render()['Caddyfile']
        self.assertIn('/web/binary/company_logo', caddy)
        self.assertNotIn('/web/binary/*', caddy)

    def test_exact_service_environments_do_not_embed_secrets(self):
        compose = json.loads(self.render()['compose.json'])
        services = compose['services']
        self.assertEqual(services['db']['environment'], {
            'POSTGRES_DB': DATABASE, 'POSTGRES_USER': 'odoo', 'POSTGRES_PASSWORD': '${POSTGRES_PASSWORD}',
        })
        self.assertEqual(services['odoo']['environment'], {'NASQ_COMMERCIAL_CONFIG': '/etc/odoo/commercial.json'})
        self.assertEqual(services['web']['environment'], {'NUXT_ODOO_URL': 'http://odoo:8069', 'NUXT_ODOO_DB': DATABASE})
        self.assertEqual(services['edge'].get('environment', {}), {})
        for name, content in self.render().items():
            if name != 'odoo.conf':
                self.assertNotIn(DB_TOKEN, content)
                self.assertNotIn(ADMIN_TOKEN, content)

    def test_odoo_config_has_real_credentials_and_fixed_isolation(self):
        parser = configparser.ConfigParser(interpolation=None, strict=True)
        parser.read_string(self.render()['odoo.conf'])
        self.assertEqual(parser.sections(), ['options'])
        self.assertEqual(dict(parser['options']), {
            'db_host': 'db', 'db_port': '5432', 'db_user': 'odoo',
            'db_password': DB_TOKEN, 'admin_passwd': ADMIN_TOKEN,
            'db_name': DATABASE, 'dbfilter': '^' + DATABASE + '$',
            'list_db': 'False', 'proxy_mode': 'True', 'workers': '2', 'max_cron_threads': '0',
            'http_port': '8069', 'gevent_port': '8072', 'data_dir': '/var/lib/odoo',
            'addons_path': '/opt/odoo/addons,/opt/nasq/addons',
        })

    def test_classification_matches_target_and_has_no_expiry(self):
        self.assertEqual(json.loads(self.render()['commercial.json']), {
            'schema_version': 1, 'database': DATABASE, 'commercial_mode': 'saas',
            'entitlement_source': 'control_plane', 'expected_valid_until': None,
            'valid_until_action': 'preserve',
        })

    def test_caddy_constant_routes_api_websocket_and_frontend_without_tls(self):
        text = self.render()['Caddyfile']
        self.assertEqual(text, bundle.CADDYFILE)
        for required in ['auto_https off', 'admin off', ':80 {', '/api/v1', '/api/v1/*',
                         '/web/content/*', '/websocket', '/websocket/*',
                         'reverse_proxy odoo:8069', 'reverse_proxy odoo:8072', 'reverse_proxy web:3000']:
            self.assertIn(required, text)
        for forbidden in ['tls ', 'rate_limit', 'ratelimit', 'https://', 'import ', 'localhost:', '${']:
            self.assertNotIn(forbidden, text)

    def test_compatible_with_current_probe_named_volume_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.descriptor['resource_refs']['compose_file'] = str(root / 'compose.json')
            self.descriptor['resource_refs']['data_dir'] = str(root / 'data')
            for name, content in self.render().items():
                path = root / name
                path.write_text(content)
                path.chmod(0o600 if name == 'compose.json' else 0o444)
            calls = []

            def runner(argv, env=None, stdin_text=None):
                calls.append(argv)
                self.assertEqual(argv, ['docker', 'image', 'inspect', '--format', '{{json .}}', IMAGES[3]])
                self.assertIsNone(stdin_text)
                return 0, json.dumps({'Id': IMAGES[3], 'RepoDigests': []}), ''

            probe = DockerProbe(self.descriptor, catalog_path=root / 'unused-catalog.json', runner=runner)
            self.assertIs(probe('compose_file', str(root / 'compose.json')), True)
            self.assertEqual(len(calls), 1)

    def test_render_is_pure_and_performs_no_io(self):
        with patch('builtins.open', side_effect=AssertionError('no IO')):
            with patch('subprocess.run', side_effect=AssertionError('no subprocess')):
                with patch('socket.socket', side_effect=AssertionError('no networking')):
                    self.assertEqual(set(self.render()), {'compose.json', 'odoo.conf', 'commercial.json', 'Caddyfile'})

    def test_secret_bounds_alphabet_and_ini_injection_fail_safely(self):
        for key in ['db_password', 'admin_password']:
            for value in [None, 123, '', 'x' * 23, 'x' * 257, ' x' * 24,
                          'x' * 24 + '\nworkers=8', 'x' * 24 + '\r', 'x' * 24 + ';',
                          'x' * 24 + '#', 'x' * 24 + '=', 'x' * 24 + '$', 'x' * 24 + '\\',
                          'x' * 24 + '\N{SNOWMAN}']:
                with self.subTest(key=key, kind=type(value).__name__):
                    self.reject(**{key: value})
        self.reject(admin_password=DB_TOKEN)
        self.render(db_password='A_b-0123456789012345678901', admin_password='z' * 256)

    def test_images_must_be_immutable_and_match_identity_kind(self):
        for value in ['postgres:16', 'latest', '', None, 'sha256:' + 'a' * 63,
                      'sha256:' + 'A' * 64, '--help', 'registry/x@sha256:' + 'a' * 64 + '\n']:
            self.reject(postgres_image=value)
            for key in ['odoo_image', 'web_image', 'proxy_image']:
                self.descriptor = descriptor()
                self.descriptor['release_ref'][key] = value
                self.reject()
        self.descriptor = descriptor()
        self.descriptor['release_ref']['identity_kind'] = 'repo_digest'
        self.reject()
        for key in ['odoo_image', 'web_image', 'proxy_image']:
            self.descriptor['release_ref'][key] = 'registry.invalid/nasq@' + IMAGES[0]
        outputs = self.render(postgres_image='registry.invalid/postgres@' + IMAGES[3])
        self.assertIn('registry.invalid/postgres@', outputs['compose.json'])

    def test_descriptor_shape_target_and_path_validation(self):
        for value in [None, [], {}, {'commercial_mode': 'saas'}]:
            self.descriptor = value
            self.reject()
        for mode in ['non_saas', None, True]:
            self.descriptor = descriptor()
            self.descriptor['commercial_mode'] = mode
            self.reject()
        changes = {
            'project': ['nasq-saas-control-local', 'nasq', 'production', 'x\n', '-option', None],
            'db_name': ['odoo19', 'nasq_scratch_', 'nasq_scratch_prod', 'nasq_scratch_x\n', None],
            'compose_file': ['compose.json', '/tmp/../compose.json', '/tmp/other.json', '/tmp/x\n/compose.json', None],
        }
        for field, values in changes.items():
            for value in values:
                self.descriptor = descriptor()
                self.descriptor['resource_refs'][field] = value
                self.reject()
        self.descriptor = descriptor()
        self.descriptor['release_ref']['identity_kind'] = 'tag'
        self.reject()

    def test_ports_require_distinct_safe_integers_and_no_canonical_services(self):
        for value in [True, '25431', 1023, 65536, 5432, 8069, 8072, 3000, 55432, 14179]:
            self.descriptor = descriptor()
            self.descriptor['resource_refs']['ports']['db'] = value
            self.reject()
        for ports in [None, {}, {'db': 25431, 'odoo': 25431, 'web': 23001},
                      {'db': 25431, 'odoo': 28061, 'web': 23001, 'extra': 28062}]:
            self.descriptor = descriptor()
            self.descriptor['resource_refs']['ports'] = ports
            self.reject()

    def test_safe_error_class_never_echoes_unknown_message(self):
        self.assertEqual(str(bundle.BundleError(DB_TOKEN)), 'descriptor_invalid')


if __name__ == '__main__':
    unittest.main()
