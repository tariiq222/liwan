# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Health evidence tests use only injected Docker and HTTP observations."""
import copy
import importlib.util
import json
import unittest
import urllib.error
from unittest.mock import patch

if importlib.util.find_spec('webvue_cli.managed_health') is None:
    managed_health = None
else:
    from webvue_cli import managed_health

PROJECT = 'webvue-health-fixture'
IMAGES = {service: 'sha256:' + letter * 64 for service, letter in zip(['db', 'odoo', 'web', 'edge'], 'abcd')}
IDS = {service: letter * 64 for service, letter in zip(['db', 'odoo', 'web', 'edge'], '1234')}
BRANDING = {
    'name': 'Fixture institution', 'logo_url': '/web/binary/company_logo?company=1&v=20260923112233445566-012345abcdef',
    'primary_color': '#18181b', 'font': 'IBM_Plex_Sans_Arabic',
}
LOGIN = b'<html><body><div id="__nuxt"><main class="webvue-login-page"><form><input id="login" autocomplete="username"><input id="password" type="password"></form></main></div></body></html>'


def descriptor():
    return {
        'commercial_mode': 'saas',
        'resource_refs': {'project': PROJECT, 'compose_file': '/private/target/compose.json',
                          'db_name': 'webvue_scratch_health_fixture',
                          'ports': {'db': 25431, 'odoo': 28061, 'web': 23001}},
        'release_ref': {'identity_kind': 'image_id', 'odoo_image': IMAGES['odoo'],
                        'web_image': IMAGES['web'], 'proxy_image': IMAGES['edge']},
    }


class Runner:
    def __init__(self):
        self.calls = []
        self.ps = [{'ID': IDS[name], 'Service': name, 'State': 'running'} for name in IDS]
        self.containers = [{
            'Id': IDS[name], 'Image': IMAGES[name],
            'Config': {'Image': IMAGES[name], 'Labels': {
                'com.docker.compose.project': PROJECT, 'com.docker.compose.service': name,
            }},
            'State': {'Running': True, 'Status': 'running'},
            'NetworkSettings': {'Ports': {
                'db': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '25431'}]},
                'odoo': {'8069/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '28061'}], '8072/tcp': None},
                'edge': {'80/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '23001'}]},
                'web': {'3000/tcp': None},
            }[name]},
        } for name in IDS]
        self.image_rows = {ref: {'Id': ref, 'RepoDigests': []} for ref in IMAGES.values()}
        self.override = None
        self.ps_array = False

    def __call__(self, argv, env=None, stdin_text=None):
        self.calls.append((argv, env, stdin_text))
        assert stdin_text is None
        if self.override is not None:
            if isinstance(self.override, Exception):
                raise self.override
            return self.override
        if argv[:2] == ['docker', 'compose']:
            assert argv == ['docker', 'compose', '-p', PROJECT, '-f', '/private/target/compose.json',
                            'ps', '--all', '--no-trunc', '--format', 'json']
            return 0, json.dumps(self.ps) if self.ps_array else '\n'.join(json.dumps(row) for row in self.ps), ''
        if argv[:3] == ['docker', 'container', 'inspect']:
            assert set(argv[3:]) == set(IDS.values())
            return 0, json.dumps(self.containers), ''
        assert argv[:5] == ['docker', 'image', 'inspect', '--format', '{{json .}}']
        return 0, json.dumps(self.image_rows[argv[-1]]), ''


class Response:
    def __init__(self, url, body, content_type, status=200):
        self.url, self.body, self.status = url, body, status
        self.headers = {'Content-Type': content_type}
        self.read_limits = []

    def geturl(self):
        return self.url

    def read(self, limit):
        self.read_limits.append(limit)
        return self.body[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class Opener:
    def __init__(self):
        self.calls = []
        self.responses = {
            'http://127.0.0.1:28061/api/v1/branding': Response('http://127.0.0.1:28061/api/v1/branding', json.dumps(BRANDING).encode(), 'application/json'),
            'http://127.0.0.1:23001/api/v1/branding': Response('http://127.0.0.1:23001/api/v1/branding', json.dumps(BRANDING).encode(), 'application/json; charset=utf-8'),
            'http://127.0.0.1:23001/login': Response('http://127.0.0.1:23001/login', LOGIN, 'text/html; charset=utf-8'),
        }

    def open(self, request, timeout):
        url = request if isinstance(request, str) else request.full_url
        self.calls.append(url)
        assert 0 < timeout <= 2
        value = self.responses[url]
        if isinstance(value, Exception):
            raise value
        return value


class HealthCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(managed_health, 'managed_health implementation missing (RED)')
        self.runner, self.opener, self.descriptor = Runner(), Opener(), descriptor()

    def health(self, **options):
        return managed_health.health(self.descriptor, runner=self.runner, opener=self.opener,
                                     **{'attempts': 1, 'delay': 0, **options})

    def test_running_four_services_matching_identity_and_branding_proves_health(self):
        before = copy.deepcopy(self.descriptor)
        self.assertIs(self.health(), True)
        self.assertEqual(self.descriptor, before)
        self.assertEqual(len(self.opener.calls), 3)
        self.assertEqual(len(self.runner.calls), 6)
        for argv, env, stdin in self.runner.calls:
            self.assertIsNone(stdin)
            self.assertNotIn('POSTGRES_PASSWORD', env)
            self.assertFalse(any(word in argv for word in ['up', 'run', 'exec', 'pull', 'down']))

    def test_compose_array_format_and_repo_digest_id_resolution_supported(self):
        self.runner.ps_array = True
        self.descriptor['release_ref']['identity_kind'] = 'repo_digest'
        for name, key in [('odoo', 'odoo_image'), ('web', 'web_image'), ('edge', 'proxy_image')]:
            reference = 'registry.invalid/webvue@' + IMAGES[name]
            self.descriptor['release_ref'][key] = reference
            next(row for row in self.runner.containers if row['Id'] == IDS[name])['Config']['Image'] = reference
            self.runner.image_rows[reference] = {'Id': IMAGES[name], 'RepoDigests': [reference]}
        self.assertTrue(self.health())

    def test_missing_duplicate_stopped_and_extra_services_fail_before_http(self):
        for rows in [self.runner.ps[:-1], self.runner.ps + [self.runner.ps[0]],
                     [{**row, 'State': 'exited'} for row in self.runner.ps],
                     [{**self.runner.ps[0], 'Service': 'unrelated'}, *self.runner.ps[1:]],
                     [{**self.runner.ps[0], 'ID': '--help'}, *self.runner.ps[1:]],
                     [{**self.runner.ps[0], 'ID': 'short'}, *self.runner.ps[1:]]]:
            self.runner.ps = rows
            self.assertFalse(self.health())
        self.assertEqual(self.opener.calls, [])

    def test_foreign_project_service_or_container_identity_fails(self):
        original = copy.deepcopy(self.runner.containers)
        mutations = [lambda row: row['Config']['Labels'].update({'com.docker.compose.project': 'foreign'}),
                     lambda row: row['Config']['Labels'].update({'com.docker.compose.service': 'web'}),
                     lambda row: row.update(Id='f' * 64),
                     lambda row: row['State'].update(Running=False),
                     lambda row: row['State'].update(Status='restarting'),
                     lambda row: row['Config'].update(Image='postgres:latest'),
                     lambda row: row.update(Image=IMAGES['web'])]
        for mutate in mutations:
            self.runner.containers = copy.deepcopy(original)
            mutate(self.runner.containers[0])
            self.assertFalse(self.health())
        self.assertEqual(self.opener.calls, [])

    def test_pinned_image_inspect_mismatch_and_wrong_config_ref_fail(self):
        self.runner.containers[1]['Config']['Image'] = IMAGES['edge']
        self.assertFalse(self.health())
        self.runner = Runner()
        self.runner.image_rows[IMAGES['odoo']]['Id'] = IMAGES['edge']
        self.assertFalse(self.health())
        self.assertEqual(self.opener.calls, [])

    def test_actual_published_ports_must_match_loopback_enrollment(self):
        for mapping in [{'5432/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '25431'}]},
                        {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '5432'}]},
                        {'5432/tcp': None}, {},
                        {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '25431'}],
                         '9000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '25432'}]}]:
            self.runner.containers[0]['NetworkSettings']['Ports'] = mapping
            self.assertFalse(self.health())
        self.assertEqual(self.opener.calls, [])

    def test_unavailable_malformed_or_oversized_docker_output_fails_safely(self):
        for result in [(1, '', 'private-error'), (0, '{broken', ''), (0, '[]', ''),
                       (0, '{}', ''), (0, 'x' * 65537, ''), (0, '\ud800', ''),
                       TimeoutError('private-error'), (0, b'bytes', ''), (True, '', ''), (0, '', '')]:
            self.runner.override = result
            self.assertFalse(self.health())
        self.assertEqual(self.opener.calls, [])

    def test_branding_schema_rejects_empty_extra_wrong_type_and_malformed_logo(self):
        for payload in [{}, {**BRANDING, 'name': ''}, {**BRANDING, 'name': 1},
                        {**BRANDING, 'secret': 'private-value'}, {**BRANDING, 'font': False},
                        {**BRANDING, 'primary_color': 'red'}, {**BRANDING, 'secondary_color': None},
                        {**BRANDING, 'logo_url': 'https://foreign.invalid/logo'},
                        {**BRANDING, 'logo_url': '/web/binary/company_logo?company=x&v=0-012345abcdef'}]:
            self.opener.responses['http://127.0.0.1:28061/api/v1/branding'].body = json.dumps(payload).encode()
            self.assertFalse(self.health())

    def test_direct_and_edge_branding_must_match_exactly(self):
        self.opener.responses['http://127.0.0.1:23001/api/v1/branding'].body = json.dumps({**BRANDING, 'name': 'Different institution'}).encode()
        self.assertFalse(self.health())

    def test_optional_secondary_color_and_zero_logo_timestamp_valid(self):
        value = {**BRANDING, 'secondary_color': '#aAbB01', 'logo_url': '/web/binary/company_logo?company=2&v=0-012345abcdef'}
        for url, response in self.opener.responses.items():
            if url.endswith('/branding'):
                response.body = json.dumps(value).encode()
        self.assertTrue(self.health())

    def test_null_logo_url_is_valid_for_a_tenant_without_its_own_logo(self):
        value = {**BRANDING, 'logo_url': None}
        for url, response in self.opener.responses.items():
            if url.endswith('/branding'):
                response.body = json.dumps(value).encode()
        self.assertTrue(self.health())

    def test_json_duplicates_and_nonfinite_values_fail(self):
        response = self.opener.responses['http://127.0.0.1:28061/api/v1/branding']
        for raw in [b'{"name":"x","name":"x"}', b'{"name":NaN}', b'\xff']:
            response.body = raw
            self.assertFalse(self.health())

    def test_login_requires_real_nuxt_root_and_source_login_elements(self):
        response = self.opener.responses['http://127.0.0.1:23001/login']
        for body in [b'<html>unrelated</html>', LOGIN.replace(b'__nuxt', b'other'),
                     LOGIN.replace(b'webvue-login-page', b'other'), LOGIN.replace(b'id="password"', b'id="other"'),
                     b'<html><!--' + LOGIN + b'--></html>', b'<html><script>' + LOGIN + b'</script></html>']:
            response.body = body
            self.assertFalse(self.health())

    def test_http_timeout_redirect_wrong_type_status_and_body_bound_fail(self):
        url = 'http://127.0.0.1:28061/api/v1/branding'
        for response in [TimeoutError('private'), urllib.error.URLError('private'),
                         Response(url, b'{}', 'application/json', 302),
                         Response('http://foreign.invalid/', json.dumps(BRANDING).encode(), 'application/json'),
                         Response(url, json.dumps(BRANDING).encode(), 'text/html'),
                         Response(url, b'x' * 1048577, 'application/json')]:
            self.opener.responses[url] = response
            self.assertFalse(self.health())

    def test_default_opener_disables_proxies_and_redirects_without_network(self):
        with patch('urllib.request.build_opener', return_value=self.opener) as build:
            self.assertTrue(managed_health.health(self.descriptor, runner=self.runner, attempts=1, delay=0))
        handlers = build.call_args.args
        proxy = next(handler for handler in handlers if hasattr(handler, 'proxies'))
        self.assertEqual(proxy.proxies, {})
        redirect = next(handler for handler in handlers if hasattr(handler, 'redirect_request'))
        self.assertIsNone(redirect.redirect_request(None, None, 302, '', {}, 'http://foreign.invalid'))

    def test_retry_budget_is_bounded_and_reobserves_container_identity(self):
        self.runner.override = (1, '', '')
        with patch('webvue_cli.managed_health.time.sleep') as sleep:
            self.assertFalse(self.health(attempts=3, delay=.5))
        self.assertEqual(len(self.runner.calls), 3)
        self.assertEqual(sleep.call_count, 2)

    def test_invalid_descriptors_and_budgets_do_not_observe_world(self):
        for invalid in [None, {}, {'resource_refs': []}]:
            self.descriptor = invalid
            self.assertFalse(self.health())
        for section, field, value in [('resource_refs', 'project', '--help'),
                                      ('resource_refs', 'compose_file', '../compose.json'),
                                      ('resource_refs', 'db_name', 'odoo19'),
                                      ('release_ref', 'odoo_image', 'latest')]:
            self.descriptor = descriptor()
            self.descriptor[section][field] = value
            self.assertFalse(self.health())
        self.descriptor = descriptor()
        for options in [{'attempts': True}, {'attempts': 0}, {'attempts': 31},
                        {'delay': -1}, {'delay': float('nan')}, {'delay': 3}]:
            self.assertFalse(self.health(**options))
        self.assertEqual(self.runner.calls, [])
        self.assertEqual(self.opener.calls, [])


if __name__ == '__main__':
    unittest.main()
