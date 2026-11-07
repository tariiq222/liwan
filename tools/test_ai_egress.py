"""The AI egress gateway: an allowlist-only Squid config, and an `ai` service with no network of its own.

`deploy/ai-egress/render.sh` renders the configuration at container start from `AI_EGRESS_HOSTS`;
`deploy/ai/egress_hosts.sh` derives that value from the configured provider and embedding endpoint; the hosts of tenants' own
keys come from files the ai service writes (`AI_TENANT_EGRESS_DIR`) and render.sh turns into a guarded rule. The compose assertions render the real
Compose model with `docker compose config` and skip where no Docker client exists, so they never claim a live run.
"""
import contextlib
import json
import os
import shutil
import signal
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RENDER = ROOT / 'deploy' / 'ai-egress' / 'render.sh'
WATCH = ROOT / 'deploy' / 'ai-egress' / 'watch-tenant-hosts.sh'
ENTRYPOINT = ROOT / 'deploy' / 'ai-egress' / 'entrypoint.sh'
EGRESS_DIR = ROOT / 'deploy' / 'ai-egress'
HOSTS = ROOT / 'deploy' / 'ai' / 'egress_hosts.sh'
COMPOSE = ROOT / 'deploy' / 'docker-compose.yml'
SHARED = ROOT / 'deploy' / 'docker-compose.shared.yml'


class RenderCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.conf = Path(self.tmp.name) / 'squid.conf'

    def render(self, hosts, expect_success=True, tenant_dir=None):
        env = {'PATH': os.environ.get('PATH', ''), 'AI_EGRESS_HOSTS': hosts, 'SQUID_CONF': str(self.conf)}
        if tenant_dir is not None:
            env['AI_TENANT_EGRESS_DIR'] = str(tenant_dir)
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


class TenantHostsCase(RenderCase):
    def tenant_dir(self, **files):
        directory = Path(self.tmp.name) / 'tenants'
        directory.mkdir(exist_ok=True)
        for name, content in files.items():
            (directory / name).write_text(content, encoding='utf-8')
        return directory

    def test_without_tenant_hosts_the_configuration_is_the_static_one(self):
        _, plain = self.render('openrouter.ai')
        _, empty = self.render('openrouter.ai', tenant_dir=self.tenant_dir())
        self.assertEqual(plain, empty)
        self.assertNotIn('tenant_', plain)

    def test_tenant_hosts_are_allowed_for_connect_to_443_only_and_never_to_a_private_destination(self):
        directory = self.tenant_dir(**{
            'acme.hosts': 'llm.tenant.example\n',
            'beta.hosts': 'llm.tenant.example\napi.together.xyz\n',
        })
        _, text = self.render('openrouter.ai', tenant_dir=directory)
        # One line per host (same-name ACL lines are alternatives), sorted, each host once, exact names.
        self.assertEqual(self.lines(text, 'acl tenant_host'), [
            'acl tenant_host dstdomain api.together.xyz',
            'acl tenant_host dstdomain llm.tenant.example',
        ])
        self.assertEqual(self.lines(text, 'acl tenant_port'), ['acl tenant_port port 443'])
        private = self.lines(text, 'acl tenant_private dst')[0].split()[3:]
        for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10', '::1/128', 'fc00::/7', 'fe80::/10',
                        '2002::/16', '64:ff9b::/96', '64:ff9b:1::/48', '192.0.2.0/24', '2001:db8::/32'):
            self.assertIn(network, private)
        access = self.lines(text, 'http_access')
        deny = access.index('http_access deny tenant_host tenant_private')
        allow = access.index('http_access allow tenant_host tenant_port egress_connect')
        # The private-destination denial is evaluated before the allow, and the static rule for openrouter.ai comes first.
        self.assertLess(deny, allow)
        self.assertLess(access.index('http_access allow egress_host_1 egress_port_1 egress_connect'), deny)
        self.assertEqual(access[-1], 'http_access deny all')

    def test_invalid_tenant_lines_are_skipped_and_logged_not_fatal(self):
        directory = self.tenant_dir(**{
            'acme.hosts': 'llm.tenant.example\nEvil.Example\nbad;host\nhost:8443\n  # a comment\n\n  spaced.example  \n',
        })
        (directory / '.acme.hosts.tmp').write_text('half.written.example\n', encoding='utf-8')
        (directory / 'notes.txt').write_text('not.a.host.file\n', encoding='utf-8')
        completed, text = self.render('', tenant_dir=directory)
        self.assertEqual(self.lines(text, 'acl tenant_host'), [
            'acl tenant_host dstdomain llm.tenant.example',
            'acl tenant_host dstdomain spaced.example',
        ])
        self.assertEqual(completed.stderr.count('skipping invalid tenant host'), 3)
        self.assertNotIn('half.written.example', text)
        self.assertNotIn('not.a.host.file', text)

    def test_a_directory_of_only_invalid_hosts_leaves_no_tenant_rule(self):
        completed, text = self.render('', tenant_dir=self.tenant_dir(**{'acme.hosts': 'bad;host\n'}))
        self.assertEqual(completed.returncode, 0)
        self.assertNotIn('tenant_', text)
        self.assertEqual(self.lines(text, 'http_access'), ['http_access deny all'])

    def test_many_tenants_make_many_short_lines(self):
        directory = self.tenant_dir(**{'acme.hosts': ''.join(f'h{n}.example.com\n' for n in range(300))})
        _, text = self.render('', tenant_dir=directory)
        lines = self.lines(text, 'acl tenant_host')
        self.assertEqual(len(lines), 300)
        self.assertLess(max(len(line) for line in lines), 60)

    def test_the_watcher_does_nothing_without_a_tenant_directory(self):
        completed = subprocess.run(['sh', str(WATCH), str(self.conf)], env={'PATH': os.environ.get('PATH', '')}, capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)


class EntrypointCase(unittest.TestCase):
    """entrypoint.sh with a stand-in `squid`: `-k parse` rejects any configuration with tenant hosts when `reject` is set;
    started plainly it reports how many tenant lines it was given. The background watcher is held off by a long interval."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.bin = root / 'bin'
        self.bin.mkdir()
        self.conf = root / 'squid.conf'
        self.tenants = root / 'tenants'
        self.tenants.mkdir()

    def stub_squid(self, reject):
        (self.bin / 'squid').write_text(
            '#!/bin/sh\n'
            'conf=""; parse=no\n'
            'while [ $# -gt 0 ]; do case "$1" in -f) conf="$2" ;; parse) parse=yes ;; esac; shift; done\n'
            'if [ "$parse" = yes ]; then\n'
            f'  [ "{reject}" = yes ] && grep -q tenant_host "$conf" && exit 1\n'
            '  exit 0\n'
            'fi\n'
            'echo "started with $(grep -c "^acl tenant_host" "$conf") tenant lines"\n',
            encoding='utf-8',
        )
        (self.bin / 'squid').chmod(0o755)

    def run_entrypoint(self, hosts='openrouter.ai', tenant_dir=True):
        env = {'PATH': f'{self.bin}:{os.environ.get("PATH", "")}', 'AI_EGRESS_HOSTS': hosts, 'SQUID_CONF': str(self.conf),
               'AI_EGRESS_WATCH_SECONDS': '1000'}
        if tenant_dir:
            env['AI_TENANT_EGRESS_DIR'] = str(self.tenants)
        # The entrypoint leaves its watcher running in the background, holding any pipe open: collect through files and
        # stop the whole process group afterwards.
        out, err = Path(self.tmp.name, 'out'), Path(self.tmp.name, 'err')
        with out.open('w') as out_file, err.open('w') as err_file:
            process = subprocess.Popen(['sh', str(ENTRYPOINT)], env=env, stdout=out_file, stderr=err_file, start_new_session=True)
            try:
                returncode = process.wait(timeout=60)
            finally:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
        return subprocess.CompletedProcess(process.args, returncode, out.read_text(encoding='utf-8'), err.read_text(encoding='utf-8'))

    def test_a_tenant_file_squid_rejects_never_stops_the_start(self):
        self.stub_squid(reject='yes')
        (self.tenants / 'acme.hosts').write_text('llm.tenant.example\n', encoding='utf-8')
        completed = self.run_entrypoint()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('starting with the static hosts only', completed.stderr)
        text = self.conf.read_text(encoding='utf-8')
        self.assertNotIn('tenant_host', text)
        self.assertIn('dstdomain openrouter.ai', text)
        self.assertIn('started with 0 tenant lines', completed.stdout)

    def test_a_valid_start_keeps_the_tenant_hosts(self):
        self.stub_squid(reject='no')
        (self.tenants / 'acme.hosts').write_text('llm.tenant.example\n', encoding='utf-8')
        completed = self.run_entrypoint()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertNotIn('static hosts only', completed.stderr)
        self.assertIn('started with 1 tenant lines', completed.stdout)

    def test_a_bad_static_list_still_stops_the_start(self):
        self.stub_squid(reject='no')
        completed = self.run_entrypoint(hosts='evil.com;x', tenant_dir=False)
        self.assertNotEqual(completed.returncode, 0)
        self.assertFalse(self.conf.exists())


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

    def test_the_generic_provider_takes_its_host_from_the_base_url(self):
        self.assert_hosts('llm.example.com', 'openai_compatible', 'https://llm.example.com/v1')
        self.assert_hosts('llm.internal:8080', 'openai_compatible', 'http://llm.internal:8080/v1')
        completed = self.hosts('openai_compatible')
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn('base URL', completed.stderr)

    def embedding_hosts(self, provider, base_url, embedding_provider, embedding_base_url):
        completed = subprocess.run(
            ['sh', str(HOSTS), provider, base_url, embedding_provider, embedding_base_url],
            capture_output=True, text=True, check=False, env={'PATH': os.environ.get('PATH', '')},
        )
        return completed

    def test_the_embedding_host_joins_the_list_once(self):
        cases = [
            (('anthropic', '', '', ''), 'api.anthropic.com'),  # no embedding provider: the chat host alone
            (('anthropic', '', 'openai', ''), 'api.anthropic.com,api.openai.com'),
            (('openai', '', 'openai', ''), 'api.openai.com'),  # the same host is named once
            (('openrouter', '', 'openai', 'https://embed.example.com/v1'), 'openrouter.ai,embed.example.com'),
            (('openrouter', '', 'ollama', 'http://models:11434'), 'openrouter.ai,models:11434'),
            (('ollama', 'http://ollama:11434', 'ollama', ''), 'ollama:11434'),
        ]
        for args, expected in cases:
            with self.subTest(args=args):
                completed = self.embedding_hosts(*args)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                self.assertEqual(completed.stdout.strip(), expected)

    def test_an_unknown_embedding_provider_is_refused(self):
        completed = self.embedding_hosts('openai', '', 'gemini', '')
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn('gemini', completed.stderr)

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


# Building the image is slow and needs the network, so it runs only where asked: the CI image stage sets the variable.
@unittest.skipUnless(os.environ.get('LIWAN_AI_EGRESS_IMAGE_TEST') == '1' and compose_available(),
                     'set LIWAN_AI_EGRESS_IMAGE_TEST=1 with docker available to build the ai-egress image')
class SquidParseCase(unittest.TestCase):
    """The real image: squid itself accepts the configuration rendered with tenant hosts, and refuses nothing it should keep."""

    @classmethod
    def setUpClass(cls):
        cls.image = 'liwan-ai-egress-parse-test'
        build = subprocess.run(['docker', 'build', '-q', '-t', cls.image, str(EGRESS_DIR)], capture_output=True, text=True, timeout=900, check=False)
        if build.returncode != 0:
            raise AssertionError(f'the ai-egress image did not build: {build.stderr[-500:]}')

    @classmethod
    def tearDownClass(cls):
        subprocess.run(['docker', 'rmi', '-f', cls.image], capture_output=True, check=False)

    def test_squid_parses_the_configuration_with_static_and_tenant_hosts(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'acme.hosts').write_text('llm.tenant.example\napi.together.xyz\n', encoding='utf-8')
            os.chmod(tmp, 0o755)
            os.chmod(Path(tmp, 'acme.hosts'), 0o644)
            script = 'sh /usr/local/lib/ai-egress/render.sh /run/squid/squid.conf && squid -k parse -f /run/squid/squid.conf'
            completed = subprocess.run(
                ['docker', 'run', '--rm', '--pull', 'never', '--user', 'proxy', '--tmpfs', '/run:uid=13,gid=13,mode=0750', '--entrypoint', 'sh',
                 '-e', 'AI_EGRESS_HOSTS=openrouter.ai,ollama:11434', '-e', 'AI_TENANT_EGRESS_DIR=/egress', '-v', f'{tmp}:/egress:ro',
                 self.image, '-c', script],
                capture_output=True, text=True, timeout=120, check=False,
            )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertNotIn('WARNING', completed.stderr)  # an overlapping range would be reported here
        self.assertNotIn('ERROR', completed.stderr)


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
                'LIWAN_AI_PLATFORM_DIR': tempfile.gettempdir(),
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

    def test_the_tenant_host_volume_is_written_by_ai_and_read_only_in_the_proxy(self):
        for shared in (False, True):
            with self.subTest(shared=shared):
                model = self.render(shared=shared)
                mounts = {name: {v['target']: v for v in model['services'][name]['volumes']} for name in ('ai', 'ai-egress')}
                self.assertFalse(mounts['ai']['/egress'].get('read_only', False))
                self.assertTrue(mounts['ai-egress']['/egress']['read_only'])
                for name in ('ai', 'ai-egress'):
                    self.assertEqual(mounts[name]['/egress']['source'], 'ai_tenant_hosts')
                    self.assertEqual(model['services'][name]['environment']['AI_TENANT_EGRESS_DIR'], '/egress')

    def test_the_platform_provider_is_read_from_a_read_only_directory_and_never_from_the_environment(self):
        for shared in (False, True):
            with self.subTest(shared=shared):
                service = self.render(shared=shared)['services']['ai']
                mounts = {v['target']: v for v in service['volumes']}
                self.assertTrue(mounts['/etc/liwan-ai']['read_only'])
                self.assertEqual(mounts['/etc/liwan-ai']['type'], 'bind')
                if shared:  # the operator points it at the directory the control plane writes
                    self.assertEqual(mounts['/etc/liwan-ai']['source'], tempfile.gettempdir())
                self.assertEqual(service['environment']['AI_PLATFORM_PROVIDER_FILE'], '/etc/liwan-ai/platform-provider.json')
                for name in ('AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY', 'AI_BASE_URL'):
                    self.assertNotIn(name, service['environment'])


if __name__ == '__main__':
    unittest.main()
