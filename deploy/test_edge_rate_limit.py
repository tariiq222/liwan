# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Edge template checks and shared rate-zone matcher regressions.

Matcher probes run the real Caddy matchers on container loopback only, without
publishing ports, starting compose stacks, or contacting application services.
"""
from __future__ import annotations

import functools
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CADDYFILE = ROOT / 'deploy' / 'Caddyfile'
DOCKERFILE = ROOT / 'deploy' / 'proxy' / 'Dockerfile'
COMPOSE = ROOT / 'deploy' / 'docker-compose.yml'

DEDICATED_ZONES = ('liwan_auth', 'liwan_provider_hook', 'liwan_api', 'liwan_public_appointments_ip', 'liwan_odoo',
                   'liwan_web')
ZONES = ('liwan_auth', 'liwan_provider_hook', 'liwan_api', 'liwan_public_appointments_ip', 'liwan_odoo_image',
         'liwan_odoo', 'liwan_signup', 'liwan_web', 'liwan_tiktok')
SHARED_CADDYFILE = ROOT / 'deploy' / 'shared' / 'Caddyfile'
CADDY_IMAGE_REPOSITORY = 'liwan-caddy-test'
DOCKER_UNAVAILABLE = ('cannot connect to the docker daemon', 'is the docker daemon running',
                      'error during connect', 'failed to connect to the docker api')

# Independent review observations: expected singleton sets also detect overlaps.
SHARED_ZONE_CASES = (
    ('/web/session/get_session_info', {'liwan_odoo'}),
    ('/web/session/get_session_info/', {'liwan_auth'}),
    ('/web/session/get_session_info/../authenticate', {'liwan_auth'}),
    ('//web/session/get_session_info', {'liwan_odoo'}),
    ('/web%2Fsession%2Fget_session_info', {'liwan_odoo'}),
    ('/web/session/%67et_session_info', {'liwan_odoo'}),
    ('/web/session/Get_Session_Info', {'liwan_odoo'}),
    ('/WEB/session/get_session_info', {'liwan_odoo'}),
    ('/web/session/get_session_info;x=1', {'liwan_auth'}),
    ('/web/session/get_session_info?db=x', {'liwan_odoo'}),
    ('/web/session/x/../get_session_info', {'liwan_odoo'}),
    ('/web/image/../../web/session/authenticate', {'liwan_auth'}),
    ('/web/binary/company_logo/../session/authenticate', {'liwan_odoo'}),
    ('/web/session/authenticate', {'liwan_auth'}),
    ('/api/auth/login', {'liwan_auth'}),
    ('/api/commercial/signup/start', {'liwan_signup', 'liwan_web'}),
    ('/api/commercial/payment-callback', {'liwan_web'}),
    ('/web/image/res.company/1/logo', {'liwan_odoo_image'}),
    ('/api/v1/me', {'liwan_api'}),
    ('/api/v1/inbox/hooks/whatsapp', {'liwan_provider_hook'}),
    ('/api/v1/inbox/hooks/tiktok', {'liwan_provider_hook'}),
    ('/api/v1/public/appointments/bookings/7/slots', {'liwan_api', 'liwan_public_appointments_ip'}),
    ('/', {'liwan_web'}),
)


def _find_handlers(obj: object, handler_name: str) -> list[dict]:
    found = []
    if isinstance(obj, dict):
        if obj.get('handler') == handler_name:
            found.append(obj)
        for value in obj.values():
            found.extend(_find_handlers(value, handler_name))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(_find_handlers(item, handler_name))
    return found


def _has_allowlist_matcher(route: dict) -> bool:
    """A route whose match is `not remote_ip …` — Caddy drops the matcher's name, so the shape is the identity."""
    for match in route.get('match', []):
        for negated in match.get('not', []):
            if isinstance(negated, dict) and 'remote_ip' in negated:
                return True
    return False


def _status_handlers(site: dict, _matcher_name: str = '') -> list[dict]:
    """Static responses on the allowlist route, walking Caddy's `subroute` nesting."""
    found = []
    for route in site['handle'][0]['routes']:
        if _has_allowlist_matcher(route):
            found.extend(_find_handlers(route.get('handle'), 'static_response'))
    return found


def _refuses_restore_before_proxying(site: dict) -> bool:
    """The allowlist route is evaluated, and mutually exclusive with, the guarded route that follows it.

    `handle` becomes one `group`, so the two branches cannot both run; the guard's route must come second.
    """
    routes = site['handle'][0]['routes']
    if len(routes) != 2:
        return False
    refusal, guarded = routes
    return (
        refusal.get('group') is not None
        and refusal.get('group') == guarded.get('group')
        and _has_allowlist_matcher(refusal)
        and not _has_allowlist_matcher(guarded)
        and bool(_proxy_handlers(guarded, 'guard:8080'))
    )


def _docker(args: list[str], *, stdin: str | None = None, timeout: int) -> subprocess.CompletedProcess:
    if not shutil.which('docker'):
        raise unittest.SkipTest('docker executable unavailable')
    result = subprocess.run(['docker', *args], input=stdin, capture_output=True, text=True, timeout=timeout)
    if result.returncode and any(reason in result.stderr.lower() for reason in DOCKER_UNAVAILABLE):
        raise unittest.SkipTest(f'docker daemon unavailable: {result.stderr.strip()}')
    return result


@functools.cache
def _caddy_image() -> str:
    """Tag the proxy image by its Dockerfile digest and build it when absent.

    The Dockerfile copies nothing from a build context, so it is built from stdin
    and its content alone determines the image.
    """
    recipe = DOCKERFILE.read_text(encoding='utf-8')
    if re.search(r'^\s*(ADD|COPY)(?!\s+--from=)', recipe, re.MULTILINE | re.IGNORECASE):
        raise AssertionError('deploy/proxy/Dockerfile reads its build context; hash those inputs too')
    image = f'{CADDY_IMAGE_REPOSITORY}:{hashlib.sha256(recipe.encode()).hexdigest()[:16]}'
    if _docker(['image', 'inspect', image], timeout=30).returncode:
        built = _docker(['build', '-t', image, '-'], stdin=recipe, timeout=1800)
        if built.returncode:
            raise AssertionError(f'Caddy image build exit {built.returncode}: {built.stderr}')
    return image


def _caddy_container(script: str) -> subprocess.CompletedProcess:
    result = _docker(['run', '--rm', '-i', _caddy_image(), 'sh', '-s'], stdin=script, timeout=60)
    if result.returncode:
        # Invalid configuration and probe failures are not skips.
        raise AssertionError(f'Caddy container exit {result.returncode}: {result.stderr}')
    return result


def _adapt_shared_caddyfile(text: str, *, restore_allow: str | None = None, domain: str = 'a.example.test') -> dict:
    allow = '' if restore_allow is None else f'export LIWAN_RESTORE_ALLOW="{restore_allow}"\n'
    result = _caddy_container(
        "set -eu\nexport DOMAIN='" + domain + "'\nexport LIWAN_TIKTOK_RELAY_HOST=hooks.example.test\n"
        + allow
        + "cat > /tmp/source.Caddyfile <<'LIWAN_CADDY_SOURCE'\n"
        + text + "\nLIWAN_CADDY_SOURCE\n"
        + 'caddy adapt --config /tmp/source.Caddyfile --adapter caddyfile\n'
    )
    return json.loads(result.stdout)


def _tenant_rate_limits(adapted: dict) -> dict:
    """The rate limits of the guarded sites (the hooks host has its own handler).

    The shared Caddyfile serves the tenant site and the restore site from one snippet, so every guarded site must
    carry identical limits: a restore host is throttled exactly like a tenant host.
    """
    handlers = [handler for handler in _find_handlers(adapted, 'rate_limit') if 'liwan_auth' in handler['rate_limits']]
    if not handlers:
        raise AssertionError('expected a tenant rate_limit handler, got none')
    if any(handler['rate_limits'] != handlers[0]['rate_limits'] for handler in handlers):
        raise AssertionError('every guarded site must share one set of rate limits')
    return handlers[0]['rate_limits']


def _proxy_handlers(obj: object, dial: str, inherited: tuple[str, ...] = ()) -> list[dict]:
    """Every reverse_proxy handler for `dial`, with the path matchers enclosing it."""
    found: list[dict] = []
    if isinstance(obj, dict):
        paths = list(inherited)
        for match in obj.get('match', []):
            paths.extend(match.get('path', []))
        if obj.get('handler') == 'reverse_proxy' and any(
                upstream.get('dial') == dial for upstream in obj.get('upstreams', [])):
            found.append({'paths': set(paths), 'handler': obj})
        for value in obj.values():
            found.extend(_proxy_handlers(value, dial, tuple(paths)))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(_proxy_handlers(item, dial, inherited))
    return found


def _probe_shared_zones(text: str, paths: list[str]) -> list[set[str]]:
    adapted = _adapt_shared_caddyfile(text)
    zones = _tenant_rate_limits(adapted)
    # Each adapted matcher set (including OR and NOT) is transplanted unchanged
    # into a nonterminal marker route. Do not hand-copy or reimplement path rules.
    routes = [
        {'match': zone['match'], 'handle': [
            {'handler': 'headers', 'response': {'set': {f'X-Liwan-Zone-{name}': ['matched']}}}
        ]}
        for name, zone in zones.items()
    ]
    routes.append({'handle': [{'handler': 'static_response', 'body': 'zone_probe'}]})
    config = {'admin': {'disabled': True}, 'apps': {'http': {'servers': {'probe': {
        'listen': ['127.0.0.1:8080'], 'routes': routes,
    }}}}}
    script = (
        "set -eu\ncat > /tmp/probe.json <<'LIWAN_ZONE_PROBE'\n"
        + json.dumps(config) + '\nLIWAN_ZONE_PROBE\n'
        + 'caddy run --config /tmp/probe.json >/tmp/caddy.log 2>&1 &\n'
        + 'pid=$!\ntrap \'kill "$pid" 2>/dev/null || true\' EXIT\n'
        + 'ready=0\nfor attempt in $(seq 1 50); do\n'
        + '  if curl --silent --fail --max-time 1 http://127.0.0.1:8080/ >/dev/null; then ready=1; break; fi\n'
        + '  sleep 0.1\ndone\n'
        + 'if [ "$ready" != 1 ]; then cat /tmp/caddy.log >&2; exit 1; fi\n'
    )
    for index, path in enumerate(paths):
        script += f"printf 'LIWAN_PROBE {index}\\n'\n"
        # request-target prevents the HTTP client from cleaning ../ or // aliases.
        script += ('curl --silent --show-error --fail --max-time 2 --noproxy "*" '
                   '--path-as-is --request-target ' + shlex.quote(path)
                   + ' --dump-header - --output /dev/null http://127.0.0.1:8080/\n')
    output = _caddy_container(script).stdout
    records = output.split('LIWAN_PROBE ')[1:]
    if len(records) != len(paths):
        raise AssertionError(f'expected {len(paths)} probe responses, got {len(records)}')
    matched = []
    for index, record in enumerate(records):
        lines = record.splitlines()
        if lines[0] != str(index) or not lines[1].startswith('HTTP/1.1 200 '):
            raise AssertionError(f'invalid probe response: {record}')
        names = set()
        for line in lines[2:]:
            name, separator, value = line.partition(':')
            if separator and name.lower().startswith('x-liwan-zone-'):
                if value.strip() != 'matched':
                    raise AssertionError(f'invalid zone marker: {line}')
                names.add(name.lower().removeprefix('x-liwan-zone-'))
        matched.append(names)
    return matched


class TestEdgeRateLimitTemplate(unittest.TestCase):
    def test_caddyfile_declares_exactly_the_declared_zones(self) -> None:
        text = CADDYFILE.read_text(encoding='utf-8')
        declared = re.findall(r'^\s*zone\s+(\S+)\s*\{', text, re.MULTILINE)
        self.assertEqual(len(declared), len(DEDICATED_ZONES))
        for zone in DEDICATED_ZONES:
            with self.subTest(zone=zone):
                self.assertEqual(declared.count(zone), 1)
        self.assertIn('key {remote_host}', text)
        self.assertIn('ipv6_prefix 64', text)
        self.assertNotIn('caddy:2', COMPOSE.read_text(encoding='utf-8'))

    def test_shared_caddyfile_gives_every_server_block_an_address(self) -> None:
        """A block keyed by a bare variable adapts to nothing, and Caddy refuses it.

        Caddy answers "server block without any key" when the address expands to an empty string. The
        TikTok block is keyed by LIWAN_TIKTOK_RELAY_HOST, which a deployment that runs no TikTok app
        leaves empty, so that block must carry a fallback address of its own. DOMAIN is always
        required of every deployment (the compose files interpolate it), so it is not at risk.
        """
        text = SHARED_CADDYFILE.read_text(encoding='utf-8')
        self.assertIn('{$LIWAN_TIKTOK_RELAY_HOST:invalid.invalid} {', text)
        bare_optional = [name for name in re.findall(r'^\{(\$[A-Z_]+)\}\s*\{', text, re.MULTILINE)
                         if name != '$DOMAIN']
        self.assertEqual(bare_optional, [], 'an optional variable keyed without a fallback adapts to nothing')

    def test_shared_caddyfile_declares_exactly_the_declared_zones(self) -> None:
        text = SHARED_CADDYFILE.read_text(encoding='utf-8')
        declared = re.findall(r'^\s*zone\s+(\S+)\s*\{', text, re.MULTILINE)
        self.assertEqual(len(declared), len(ZONES))
        for zone in ZONES:
            with self.subTest(zone=zone):
                self.assertEqual(declared.count(zone), 1)

    def test_image_builds_the_rate_limit_module(self) -> None:
        text = DOCKERFILE.read_text(encoding='utf-8')
        self.assertIn('github.com/mholt/caddy-ratelimit@v0.1.0', text)
        self.assertIn("grep -q 'http.handlers.rate_limit'", text)
        self.assertIn('deploy/proxy/Dockerfile', COMPOSE.read_text(encoding='utf-8'))

    def test_shared_overlay_resolved_published_ports(self) -> None:
        """Behavioral: resolve base + shared overlay and inspect published ports."""
        rendered = self._render_shared({})
        proxy = rendered['services']['proxy'].get('ports', [])
        self.assertEqual(
            sorted((p['host_ip'], str(p['published']), p['target']) for p in proxy),
            [('0.0.0.0', '443', 443), ('0.0.0.0', '80', 80)],
        )
        # The relay belongs to the `tiktok` profile, so a stack without the app renders no relay.
        self.assertNotIn('tiktok-relay', rendered['services'])
        for name in ('guard', 'odoo', 'db', 'web'):
            with self.subTest(service=name):
                self.assertFalse(rendered['services'][name].get('ports'))

        rendered = self._render_shared(
            {'LIWAN_EDGE_BIND': '127.0.0.1', 'LIWAN_EDGE_HTTPS_PORT': '8443', 'LIWAN_EDGE_HTTP_PORT': '8080'}
        )
        proxy = rendered['services']['proxy'].get('ports', [])
        self.assertEqual(
            sorted((p['host_ip'], str(p['published']), p['target']) for p in proxy),
            [('127.0.0.1', '8080', 80), ('127.0.0.1', '8443', 443)],
        )

    def test_shared_overlay_supplies_proxy_host_when_relay_host_is_empty(self) -> None:
        for configured, expected in (('', 'invalid.invalid'), ('hooks.example.test', 'hooks.example.test')):
            with self.subTest(configured=configured):
                services = self._render_shared({'LIWAN_TIKTOK_RELAY_HOST': configured})['services']
                self.assertEqual(services['proxy']['environment']['LIWAN_TIKTOK_RELAY_HOST'], expected)
                redirect = f'https://{configured}/tiktok/oauth/callback' if configured else ''
                self.assertEqual(services['odoo']['environment']['LIWAN_TIKTOK_REDIRECT_URI'], redirect)

    def test_healthchecks_probe_http_readiness_not_a_tcp_port(self) -> None:
        """Behavioral (AUDIT-058): every Odoo, web and relay probe makes an HTTP request; Odoo's also checks PostgreSQL."""
        shared = self._render_shared({}, profiles=('tiktok', 'restore'))['services']
        base = self._render_base({})['services']
        probes = {
            ('shared', 'odoo'): shared['odoo'], ('shared', 'web'): shared['web'],
            ('shared', 'restore-odoo'): shared['restore-odoo'], ('shared', 'tiktok-relay'): shared['tiktok-relay'],
            ('base', 'odoo'): base['odoo'], ('base', 'web'): base['web'],
        }
        for (overlay, name), service in probes.items():
            with self.subTest(overlay=overlay, service=name):
                hc = service['healthcheck']
                test = ' '.join(hc['test'])
                self.assertNotIn('socket', test)
                self.assertNotIn('net\').connect', test)
                self.assertTrue('urlopen(' in test or 'fetch(' in test, test)
                if name.endswith('odoo'):
                    self.assertIn('/web/health?db_server_status=1', test)
                # Rendered timings: unhealthy after about 30s of failures once started, never 20 retries.
                self.assertLessEqual(int(hc['retries']), 3)
                self.assertTrue(hc.get('start_period'), hc)
        # The shared web probe reads a public static file: no proxy token, no upstream call.
        self.assertIn('/favicon.ico', ' '.join(shared['web']['healthcheck']['test']))
        self.assertIn('/healthz', ' '.join(shared['tiktok-relay']['healthcheck']['test']))

    def test_shared_caddyfile_rate_limit_exempts_static_assets(self) -> None:
        """Behavioral: caddy adapt in built image verifies static asset exemptions in liwan_web."""
        adapted = _adapt_shared_caddyfile(SHARED_CADDYFILE.read_text(encoding='utf-8'))

        zones = _tenant_rate_limits(adapted)

        signup = zones['liwan_signup']
        self.assertEqual(signup['max_events'], 30)
        self.assertEqual(signup['window'], 60000000000)
        self.assertEqual(signup['key'], '{http.vars.client_ip}')
        self.assertEqual(signup['match'], [{'path': ['/api/commercial/signup/*']}])

        self.assertEqual(zones['liwan_auth']['max_events'], 20)
        self.assertEqual(zones['liwan_auth']['match'][0]['path'], ['/api/auth/*', '/api/v1/auth/*', '/web/session/*', '/web/login'])

        self.assertEqual(zones['liwan_api']['max_events'], 300)
        self.assertEqual(zones['liwan_api']['match'][0]['path'], ['/api/v1/*'])
        self.assertEqual(zones['liwan_api']['match'][0]['not'][0]['path'], ['/api/v1/auth/*', '/api/v1/inbox/hooks/*'])

        # A9-F12: a provider webhook has its own budget, kept out of the UI's 300 a minute.
        hook = zones['liwan_provider_hook']
        self.assertEqual(hook['max_events'], 1200)
        self.assertEqual(hook['match'][0]['path'], ['/api/v1/inbox/hooks/*'])
        self.assertNotIn('not', hook['match'][0])

        # F5: get_session_info is a non-credential call and moves from the 20/min
        # auth bucket to the Odoo bucket; every other /web/session/* stays in auth.
        auth_match = zones['liwan_auth']['match']
        self.assertEqual(len(auth_match), 1)
        self.assertEqual(auth_match[0]['not'][0]['path'], ['/web/session/get_session_info'])
        self.assertEqual(zones['liwan_auth']['window'], 60000000000)
        self.assertNotIn('/web/image/*', zones['liwan_auth']['match'][0]['path'])

        # F5: image traffic has its own (ACL-checked, still limited) budget.
        img = zones['liwan_odoo_image']
        self.assertEqual(img['max_events'], 1200)
        self.assertEqual(len(img['match']), 1)
        self.assertEqual(img['match'][0]['path'], ['/web/image/*', '/web/binary/company_logo'])
        self.assertNotIn('not', img['match'][0])

        odoo = zones['liwan_odoo']
        self.assertEqual(odoo['max_events'], 600)
        self.assertEqual(odoo['match'][0]['path'], ['/web/*', '/odoo/*', '/jsonrpc', '/xmlrpc/*', '/report/*', '/mail/*', '/bus/*', '/discuss/*'])
        self.assertEqual(odoo['match'][0]['not'][0]['path'], ['/web/session/*', '/web/login', '/web/image/*', '/web/binary/company_logo'])
        self.assertEqual(odoo['match'][1]['path'], ['/web/session/get_session_info'])
        self.assertNotIn('not', odoo['match'][1])
        # No Odoo asset/attachment prefix is exempted anywhere: /web/content,
        # /web/assets and /web/static stay inside liwan_odoo (none is served through this
        # edge; attachments download from /api/v1/.../attachments/<id>/download).
        for zname in ('liwan_odoo', 'liwan_web'):
            for m in zones[zname]['match']:
                for neg in m.get('not', []):
                    for p in neg['path']:
                        self.assertFalse(p.startswith(('/web/content', '/web/assets', '/web/static')), p)
        # Nothing is exempt from all zones: the web zone still treats /web/* as Odoo-owned.
        self.assertIn('/web/*', zones['liwan_web']['match'][0]['not'][0]['path'])

        web_match = zones['liwan_web']['match'][0]
        self.assertIn('not', web_match)
        excluded_paths = web_match['not'][0]['path']

        for p in ['/api/auth/*', '/api/v1/*', '/web/*', '/odoo/*', '/jsonrpc', '/xmlrpc/*', '/report/*', '/mail/*', '/bus/*', '/discuss/*', '/websocket']:
            self.assertIn(p, excluded_paths)

        # The built web image serves only /_nuxt/*, /_i18n/* (Nitro route
        # /_i18n/:hash/:locale/messages.json), /fonts/*, /favicon.ico, /robots.txt.
        # There is no /i18n/* route, so it must NOT be exempted (r2 verification).
        required_asset_paths = ['/_nuxt/*', '/_i18n/*', '/fonts/*', '/favicon.ico', '/robots.txt']
        for p in required_asset_paths:
            self.assertIn(p, excluded_paths)
        self.assertNotIn('/i18n/*', excluded_paths)

        for p in excluded_paths:
            self.assertFalse(p.startswith('*'), f'broad extension glob {p} is forbidden')

    def test_shared_zone_matchers_for_reviewed_path_variants(self) -> None:
        paths = [path for path, _ in SHARED_ZONE_CASES]
        actual = _probe_shared_zones(SHARED_CADDYFILE.read_text(encoding='utf-8'), paths)
        for (path, expected), matched in zip(SHARED_ZONE_CASES, actual):
            with self.subTest(path=path):
                self.assertEqual(matched, expected)

    def test_shared_zone_probe_detects_removed_auth_exemption(self) -> None:
        # Mutation is an in-memory COPY only; never write the shared Caddyfile.
        text = SHARED_CADDYFILE.read_text(encoding='utf-8')
        exemption = '\t\t\t\t\tnot path /web/session/get_session_info\n'
        self.assertEqual(text.count(exemption), 1)
        mutated = text.replace(exemption, '', 1)
        paths = [path for path, _ in SHARED_ZONE_CASES]
        actual = _probe_shared_zones(mutated, paths)
        self.assertEqual(actual[0], {'liwan_auth', 'liwan_odoo'})
        # The SAME full-matrix assertion must fail, not just a string assertion.
        with self.assertRaises(AssertionError):
            self.assertEqual(actual, [expected for _, expected in SHARED_ZONE_CASES])

    def _render_shared(self, extra: dict, profiles: tuple = ()) -> dict:
        if not shutil.which('docker') or subprocess.run(
                ['docker', 'compose', 'version'], capture_output=True, timeout=60).returncode:
            self.skipTest('docker compose unavailable')
        env = {
            'LIWAN_IMAGE_TAG': 'test', 'ODOO_COMMIT': 'dummy', 'LIWAN_SESSION_KEYS': 'dummy',
            'LIWAN_TIKTOK_RELAY_HOST': 'hooks.example.test',
            'LIWAN_TIKTOK_CLIENT_KEY': 'test-only-client-key',
            'LIWAN_TIKTOK_CLIENT_SECRET': 'test-only-client-secret',
            'LIWAN_SESSION_ACTIVE_KID': 'k1', 'LIWAN_SHARED_PROXY_TOKEN': 'dummy',
            'LIWAN_SHARED_ODOO_CONFIG': '/tmp/dummy-odoo.conf', 'LIWAN_TENANT_REGISTRY_DIR': '/tmp',
            'POSTGRES_PASSWORD': 'dummy', 'LIWAN_DOMAIN': 'example.test', **extra,
        }
        with tempfile.TemporaryDirectory() as tmp:
            envfile = Path(tmp) / 'dummy.env'
            envfile.write_text(''.join(f'{k}={v}\n' for k, v in env.items()), encoding='utf-8')
            res = subprocess.run(
                ['docker', 'compose', '--env-file', str(envfile),
                 *[arg for profile in profiles for arg in ('--profile', profile)],
                 '-f', str(COMPOSE), '-f', str(ROOT / 'deploy' / 'docker-compose.shared.yml'),
                 'config', '--format', 'json'],
                capture_output=True, text=True, timeout=60, cwd=ROOT, env={k: v for k, v in os.environ.items() if not k.startswith(('LIWAN_', 'ODOO_', 'POSTGRES_'))},
            )
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout)

    def _render_base(self, extra: dict) -> dict:
        if not shutil.which('docker') or subprocess.run(
                ['docker', 'compose', 'version'], capture_output=True, timeout=60).returncode:
            self.skipTest('docker compose unavailable')
        env = {
            'LIWAN_IMAGE_TAG': 'test', 'ODOO_COMMIT': 'dummy',
            'DB_PASSWORD': 'dummy', 'DOMAIN': 'example.test', **extra,
        }
        with tempfile.TemporaryDirectory() as tmp:
            envfile = Path(tmp) / 'dummy.env'
            envfile.write_text(''.join(f'{k}={v}\n' for k, v in env.items()), encoding='utf-8')
            res = subprocess.run(
                ['docker', 'compose', '--env-file', str(envfile),
                 '-f', str(COMPOSE),
                 'config', '--format', 'json'],
                capture_output=True, text=True, timeout=60, cwd=ROOT, env={k: v for k, v in os.environ.items() if not k.startswith(('LIWAN_', 'ODOO_', 'POSTGRES_'))},
            )
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout)


    def test_shared_overlay_runs_the_tiktok_relay_isolated(self) -> None:
        """Behavioral: the relay service owns its registry mount, bindings volume and networks."""
        rendered = self._render_shared({}, profiles=('tiktok',))
        relay = rendered['services']['tiktok-relay']
        self.assertEqual(relay['command'], ['node', 'deploy/shared/tiktok-relay.mjs'])
        self.assertEqual(relay['read_only'], True)
        self.assertEqual(relay.get('cap_drop'), ['ALL'])
        mounts = {mount['target']: mount for mount in relay['volumes']}
        self.assertTrue(mounts['/etc/liwan'].get('read_only'))
        self.assertIn('tiktok_bindings', mounts['/var/lib/liwan']['source'])
        self.assertIn('relay_odoo', relay['networks'])
        self.assertIn('relay_odoo', rendered['services']['odoo']['networks'])
        self.assertEqual(relay['environment']['LIWAN_TIKTOK_RELAY_PORT'], '8090')
        self.assertEqual(relay['environment']['LIWAN_TIKTOK_BINDINGS_PATH'], '/var/lib/liwan/tiktok-bindings.json')
        self.assertTrue(relay['environment']['LIWAN_SHARED_PROXY_TOKEN'])

    def test_hooks_host_forwards_only_tiktok_to_the_relay(self) -> None:
        """Behavioral: the hooks site proxies /tiktok/* to the relay with its own bounded budget."""
        adapted = _adapt_shared_caddyfile(SHARED_CADDYFILE.read_text(encoding='utf-8'))
        hooks = [handler for handler in _find_handlers(adapted, 'rate_limit') if 'liwan_tiktok' in handler['rate_limits']]
        self.assertEqual(len(hooks), 1)
        zone = hooks[0]['rate_limits']['liwan_tiktok']
        self.assertEqual(zone['max_events'], 120)
        self.assertEqual(zone['match'][0]['path'], ['/tiktok/*'])
        forwarded = _proxy_handlers(adapted, 'tiktok-relay:8090')
        self.assertEqual([handler['paths'] for handler in forwarded], [{'/tiktok/*'}])
        self.assertIn('X-Liwan-Proxy-Token', forwarded[0]['handler']['headers']['request']['delete'])
        dials = {
            upstream['dial']
            for handler in _find_handlers(adapted, 'reverse_proxy')
            for upstream in handler.get('upstreams', [])
        }
        self.assertEqual(dials, {'guard:8080', 'tiktok-relay:8090'})

    def test_restore_hosts_get_the_tenant_edge_on_their_own_wildcard_site(self) -> None:
        """Behavioral: `*.restore.<domain>` is its own site with the identical guarded handlers.

        The restore host format is the control plane's `realRestoreHost`: one label under `restore.<domain>`.
        """
        adapted = _adapt_shared_caddyfile(SHARED_CADDYFILE.read_text(encoding='utf-8'))
        sites = {tuple(route['match'][0]['host']): route for route in adapted['apps']['http']['servers']['srv0']['routes']}
        self.assertEqual(set(sites), {('a.example.test',), ('*.restore.invalid.invalid',), ('hooks.example.test',)})
        self.assertTrue(_refuses_restore_before_proxying(sites[('*.restore.invalid.invalid',)]),
                        'the restore site must decide the allowlist before it reaches the guarded snippet')
        self.assertEqual(len([h for h in _find_handlers(adapted, 'rate_limit') if 'liwan_auth' in h['rate_limits']]), 2)
        forwarded = _proxy_handlers(sites[('*.restore.invalid.invalid',)], 'guard:8080')
        self.assertEqual(len(forwarded), 1)
        deleted = forwarded[0]['handler']['headers']['request']['delete']
        for header in ('X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'Forwarded', 'X-Liwan-Proxy-Token', 'X-Liwan-Tenant-Revision'):
            self.assertIn(header, deleted)

    def test_the_restore_suffix_is_independent_of_the_tenant_address_list(self) -> None:
        """Behavioral: a multi-host `DOMAIN` must not produce a restore wildcard no restore host matches.

        The shared acceptance stack sets `DOMAIN="a.accept.test b.accept.test"` for the tenant site, while the control
        plane publishes `r<hex>.restore.<domainSuffix>`. Deriving the restore wildcard from `DOMAIN` would yield
        `*.restore.a.accept.test`, which matches no published restore.
        """
        adapted = _adapt_shared_caddyfile(SHARED_CADDYFILE.read_text(encoding='utf-8'),
                                          domain='a.accept.test b.accept.test')
        sites = {tuple(route['match'][0]['host']) for route in adapted['apps']['http']['servers']['srv0']['routes']}
        self.assertIn(('a.accept.test', 'b.accept.test'), sites)
        self.assertIn(('*.restore.invalid.invalid',), sites)
        self.assertNotIn(('*.restore.a.accept.test',), sites)



        """Behavioral: the restore site answers 404 outside `LIWAN_RESTORE_ALLOW`, and 404 for everyone when unset.

        A restored database holds the credentials its backup held, so the edge — not the restored app — is the
        access boundary. The tenant site must not carry the same restriction.
        """
        text = SHARED_CADDYFILE.read_text(encoding='utf-8')
        for allow in (None, '', '203.0.113.0/24 10.0.0.5'):
            with self.subTest(allow=allow):
                adapted = _adapt_shared_caddyfile(text, restore_allow=allow)
                sites = {tuple(route['match'][0]['host']): route
                         for route in adapted['apps']['http']['servers']['srv0']['routes']}
                restore = sites[('*.restore.invalid.invalid',)]
                tenant = sites[('a.example.test',)]
                refusals = _status_handlers(restore, 'notOperator')
                self.assertEqual(len(refusals), 1, 'the restore site must answer 404 for a non-allowlisted client')
                self.assertEqual(refusals[0]['status_code'], 404)
                self.assertTrue(_refuses_restore_before_proxying(restore),
                                'the refusal must be mutually exclusive with, and precede, the guarded route')
                self.assertEqual(_status_handlers(tenant, 'notOperator'), [],
                                 'the tenant site must not gain the restore allowlist')
                # The allowlist is read from the socket peer: a client header must never select it.
                self.assertNotIn('trusted_proxies', json.dumps(restore))

    def test_auth_zone_is_tighter_than_the_api_zone(self) -> None:
        text = CADDYFILE.read_text(encoding='utf-8')
        auth = text.split('zone liwan_auth {', 1)[1].split('zone liwan_provider_hook {', 1)[0]
        api = text.split('zone liwan_api {', 1)[1].split('zone liwan_public_appointments_ip {', 1)[0]
        hook = text.split('zone liwan_provider_hook {', 1)[1].split('zone liwan_api {', 1)[0]
        self.assertIn('events 20', auth)
        self.assertIn('events 300', api)
        self.assertIn('not path /api/v1/auth/* /api/v1/public/appointments/* /api/v1/inbox/hooks/*', api)
        # The provider webhook budget is the larger one and holds the hook paths alone.
        self.assertIn('events 1200', hook)
        self.assertIn('path /api/v1/inbox/hooks/*', hook)

    def test_the_dedicated_edge_keeps_hooks_out_of_the_api_budget(self) -> None:
        text = CADDYFILE.read_text(encoding='utf-8')
        hook = text.split('zone liwan_provider_hook {', 1)[1].split('zone liwan_api {', 1)[0]
        api = text.split('zone liwan_api {', 1)[1].split('zone liwan_public_appointments_ip {', 1)[0]
        self.assertIn('path /api/v1/inbox/hooks/*', hook)
        self.assertIn('/api/v1/inbox/hooks/*', api.split('not path', 1)[1].split('}', 1)[0])


if __name__ == '__main__':
    unittest.main()
