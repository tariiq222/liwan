"""The AI egress gateway: an allowlist-only Squid config, and an `ai` service with no network of its own.

`deploy/ai-egress/render.sh` renders the configuration at container start from `AI_EGRESS_HOSTS`;
`deploy/ai/egress_hosts.sh` derives that value from the configured provider. The compose assertions render the real
Compose model with `docker compose config` and skip where no Docker client exists, so they never claim a live run.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RENDER = ROOT / 'deploy' / 'ai-egress' / 'render.sh'
HOSTS = ROOT / 'deploy' / 'ai' / 'egress_hosts.sh'
COMPOSE = ROOT / 'deploy' / 'docker-compose.yml'
SHARED = ROOT / 'deploy' / 'docker-compose.shared.yml'


class RenderCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.conf = Path(self.tmp.name) / 'squid.conf'

    def render(self, hosts, expect_success=True):
        env = {'PATH': os.environ.get('PATH', ''), 'AI_EGRESS_HOSTS': hosts, 'SQUID_CONF': str(self.conf)}
        completed = subprocess.run(['sh', str(RENDER)], env=env, capture_output=True, text=True, check=False)
        if expect_success:
            self.assertEqual(completed.returncode, 0, completed.stderr)
            return completed, self.conf.read_text(encoding='utf-8')
        return completed, None

    @staticmethod
    def lines(text, keyword):
        return [line.strip() for line in text.splitlines() if line.strip().startswith(keyword)]

    def test_render_allows_only_listed_hosts(self):
        _, text = self.render('openrouter.ai')
        self.assertEqual(self.lines(text, 'acl egress_host_'), ['acl egress_host_1 dstdomain openrouter.ai'])
        # An exact name, never a leading-dot/`*.` wildcard that would also admit a subdomain.
        for acl_line in self.lines(text, 'acl egress_host_'):
            self.assertNotIn('*.', acl_line)
            self.assertNotIn('.openrouter.ai', acl_line.replace(' dstdomain openrouter.ai', ''))
        ports = [line.split()[-1] for line in self.lines(text, 'acl egress_port_')]
        self.assertEqual(ports, ['443'])
        self.assertEqual(len(self.lines(text, 'http_access allow')), 1)
        # An external provider is reached by CONNECT only.
        allow = self.lines(text, 'http_access allow')[0]
        self.assertIn('egress_connect', allow)
        self.assertIn('egress_port_1', allow)
        # The deny is the last http_access line, so nothing after it can allow a host.
        http_access = self.lines(text, 'http_access')
        self.assertEqual(http_access[-1], 'http_access deny all')
        self.assertEqual(len([line for line in http_access if line == 'http_access deny all']), 1)
        self.assertNotIn('cache_dir', text)
        self.assertIn('cache deny all', text)
        self.assertIn('http_port 3128', text)

    def test_render_allows_a_local_model_port(self):
        _, text = self.render('ollama:11434')
        self.assertEqual(self.lines(text, 'acl egress_host_'), ['acl egress_host_1 dstdomain ollama'])
        self.assertEqual([line.split()[-1] for line in self.lines(text, 'acl egress_port_')], ['11434'])
        allow = self.lines(text, 'http_access allow')
        self.assertEqual(len(allow), 1)
        # A local model server speaks plain HTTP on its own port, so CONNECT is not required there.
        self.assertNotIn('egress_connect', allow[0])
        self.assertEqual(self.lines(text, 'http_access')[-1], 'http_access deny all')

    def test_render_accepts_several_items_and_keeps_one_allow_per_item(self):
        _, text = self.render('openrouter.ai,ollama:11434')
        self.assertEqual(self.lines(text, 'acl egress_host_'), [
            'acl egress_host_1 dstdomain openrouter.ai',
            'acl egress_host_2 dstdomain ollama',
        ])
        self.assertEqual(len(self.lines(text, 'http_access allow')), 2)

    def test_render_rejects_bad_host(self):
        # Each item must be exactly host or host:port: no shell metacharacters, no wildcard, no bad port,
        # no empty item, no uppercase.
        for value in ('evil.com;x', '*.x.com', 'OpenRouter.ai', 'openrouter.ai:99999', 'openrouter.ai:0',
                      'openrouter.ai:abc', 'openrouter.ai,,api.openai.com', 'openrouter.ai,'):
            with self.subTest(value=value):
                completed, _ = self.render(value, expect_success=False)
                self.assertNotEqual(completed.returncode, 0, f'{value!r} must be refused')
                self.assertFalse(self.conf.exists(), f'{value!r} must write nothing')
                self.assertIn('ai-egress:', completed.stderr)

    def test_render_keeps_the_previous_file_when_a_new_list_is_bad(self):
        _, first = self.render('openrouter.ai')
        completed, _ = self.render('openrouter.ai,evil.com;x', expect_success=False)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual(self.conf.read_text(encoding='utf-8'), first)

    def test_empty_list_denies_all(self):
        for value in ('', '   '):
            with self.subTest(value=value):
                self.conf.unlink(missing_ok=True)
                _, text = self.render(value)
                self.assertEqual(self.lines(text, 'http_access'), ['http_access deny all'])
                self.assertEqual(self.lines(text, 'acl egress_host_'), [])
                self.assertEqual(self.lines(text, 'http_access allow'), [])


class ProviderHostsCase(unittest.TestCase):
    def hosts(self, provider, base_url=''):
        completed = subprocess.run(
            ['sh', str(HOSTS), provider, base_url],
            capture_output=True, text=True, check=False,
            env={'PATH': os.environ.get('PATH', '')},
        )
        return completed

    def assert_hosts(self, expected, provider, base_url=''):
        completed = self.hosts(provider, base_url)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), expected)

    def test_provider_default_hosts(self):
        self.assert_hosts('openrouter.ai', 'openrouter')
        self.assert_hosts('api.anthropic.com', 'anthropic')
        self.assert_hosts('api.openai.com', 'openai')
        self.assert_hosts('ollama:11434', 'ollama')

    def test_anthropic_ignores_the_base_url(self):
        # The service's anthropic provider never uses AI_BASE_URL, so the egress allowlist must not open
        # another host (a local model server included) for it.
        self.assert_hosts('api.anthropic.com', 'anthropic', 'http://ollama:11434')
        self.assert_hosts('api.anthropic.com', 'anthropic', 'https://gateway.internal:8443/v1')
        self.assert_hosts('api.anthropic.com', 'anthropic', 'https://api.anthropic.com')

    def test_provider_hosts_with_a_base_url(self):
        # A base URL replaces the provider default; the port appears whenever it is not 443.
        self.assert_hosts('openrouter.ai', 'openrouter', 'https://openrouter.ai/api/v1')
        self.assert_hosts('api.anthropic.com', 'anthropic', 'https://api.anthropic.com')
        self.assert_hosts('api.openai.com', 'openai', 'https://api.openai.com/v1')
        self.assert_hosts('ollama:11434', 'ollama', 'http://ollama:11434')
        self.assert_hosts('model.internal:8000', 'ollama', 'http://model.internal:8000/v1')
        self.assert_hosts('model.internal:80', 'ollama', 'http://model.internal')
        self.assert_hosts('openrouter.ai:8443', 'openrouter', 'https://openrouter.ai:8443/api/v1')
        self.assert_hosts('model.internal', 'openai', 'https://model.internal/v1')

    def test_unknown_provider_is_refused(self):
        completed = self.hosts('gemini')
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn('gemini', completed.stderr)

    def test_malformed_base_url_is_refused(self):
        for base_url in ('https://', 'https://Model.Internal', 'https://model internal'):
            with self.subTest(base_url=base_url):
                self.assertNotEqual(self.hosts('openai', base_url).returncode, 0)


def compose_available():
    try:
        if not shutil.which('docker'):
            return False
        return subprocess.run(['docker', 'compose', 'version'], capture_output=True, timeout=60).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


@unittest.skipUnless(compose_available(), 'docker compose is required to render the compose model')
class ComposeNetworksCase(unittest.TestCase):
    REQUIRED = {
        'COMPOSE_PROFILES': 'ai', 'AI_SERVICE_TOKEN': 'synthetic-not-a-real-token', 'DB_NAME': 'synthetic',
        'DB_PASSWORD': 'synthetic-not-secret', 'LIWAN_IMAGE_TAG': 'synthetic', 'ODOO_COMMIT': 'synthetic',
        'DOMAIN': 'tenant.invalid',
    }

    def render(self, shared):
        values = dict(self.REQUIRED)
        files = [str(COMPOSE)]
        if shared:
            files.append(str(SHARED))
            values.update({
                'LIWAN_TENANT_REGISTRY_DIR': tempfile.gettempdir(),
                'LIWAN_SHARED_PROXY_TOKEN': 'synthetic-not-a-real-token',
                'LIWAN_SESSION_KEYS': '{}', 'LIWAN_SESSION_ACTIVE_KID': 'test',
                'LIWAN_SHARED_ODOO_CONFIG': '/synthetic/odoo.conf',
                'LIWAN_TIKTOK_CLIENT_KEY': 'synthetic-not-a-key',
                'LIWAN_TIKTOK_CLIENT_SECRET': 'synthetic-not-a-secret',
                'LIWAN_TIKTOK_RELAY_HOST': 'tiktok.synthetic.invalid',
            })
        argv = ['docker', 'compose']
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / 'synthetic.env'
            env_file.write_text(''.join(f'{key}={value}\n' for key, value in values.items()), encoding='utf-8')
            argv += ['--env-file', str(env_file)]
            for path in files:
                argv += ['-f', path]
            argv += ['config', '--format', 'json']
            env = {key: value for key, value in os.environ.items()
                   if not key.startswith(('LIWAN_', 'ODOO_', 'AI_', 'POSTGRES_', 'COMPOSE_'))}
            completed = subprocess.run(argv, capture_output=True, text=True, timeout=120, cwd=ROOT, env=env)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def assert_ai_is_internal_only(self, model, shared):
        networks = model['services']['ai']['networks']
        self.assertTrue(networks, 'ai must be attached to at least one network')
        for name in networks:
            with self.subTest(shared=shared, network=name):
                self.assertTrue(model['networks'][name].get('internal'), f'{name} must be internal')
        if shared:
            self.assertEqual(sorted(networks), ['ai_internal', 'database', 'guard_web'])
        else:
            self.assertEqual(list(networks), ['ai_internal'])

    def test_ai_is_on_internal_networks_only(self):
        self.assert_ai_is_internal_only(self.render(shared=False), shared=False)

    def test_ai_is_on_internal_networks_only_in_the_shared_overlay(self):
        self.assert_ai_is_internal_only(self.render(shared=True), shared=True)

    def test_ai_egress_is_the_only_service_on_a_routed_network_for_ai(self):
        for shared in (False, True):
            with self.subTest(shared=shared):
                model = self.render(shared=shared)
                egress = model['services']['ai-egress']
                routed = [name for name in egress['networks'] if not model['networks'][name].get('internal')]
                # Exactly one network leaves the host, and it is the proxy's own egress path.
                self.assertEqual(len(routed), 1, egress['networks'])
                self.assertEqual(model['services']['ai']['depends_on']['ai-egress']['condition'], 'service_started')
                self.assertEqual(model['services']['ai']['environment']['HTTPS_PROXY'], 'http://ai-egress:3128')
                self.assertEqual(model['services']['ai']['environment']['HTTP_PROXY'], 'http://ai-egress:3128')
                self.assertEqual(model['services']['ai']['environment']['NO_PROXY'], 'db,web,localhost,127.0.0.1')
                self.assertEqual(egress['profiles'], ['ai'])
                self.assertIn('ALL', egress['cap_drop'])
                self.assertTrue(egress['read_only'])


if __name__ == '__main__':
    unittest.main()
