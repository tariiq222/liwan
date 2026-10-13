# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Edge template checks and shared rate-zone matcher regressions.

Matcher probes run the real Caddy matchers on container loopback only, without
publishing ports, starting compose stacks, or contacting application services.
"""
from __future__ import annotations

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

DEDICATED_ZONES = ('nasq_auth', 'nasq_api', 'nasq_odoo', 'nasq_web')
ZONES = ('nasq_auth', 'nasq_api', 'nasq_odoo_image', 'nasq_odoo', 'nasq_web')
SHARED_CADDYFILE = ROOT / 'deploy' / 'shared' / 'Caddyfile'
CADDY_IMAGE = 'nasq-accept-caddy:28b6c04-r2'

# Independent review observations: expected singleton sets also detect overlaps.
SHARED_ZONE_CASES = (
    ('/web/session/get_session_info', {'nasq_odoo'}),
    ('/web/session/get_session_info/', {'nasq_auth'}),
    ('/web/session/get_session_info/../authenticate', {'nasq_auth'}),
    ('//web/session/get_session_info', {'nasq_odoo'}),
    ('/web%2Fsession%2Fget_session_info', {'nasq_odoo'}),
    ('/web/session/%67et_session_info', {'nasq_odoo'}),
    ('/web/session/Get_Session_Info', {'nasq_odoo'}),
    ('/WEB/session/get_session_info', {'nasq_odoo'}),
    ('/web/session/get_session_info;x=1', {'nasq_auth'}),
    ('/web/session/get_session_info?db=x', {'nasq_odoo'}),
    ('/web/session/x/../get_session_info', {'nasq_odoo'}),
    ('/web/image/../../web/session/authenticate', {'nasq_auth'}),
    ('/web/binary/company_logo/../session/authenticate', {'nasq_odoo'}),
    ('/web/session/authenticate', {'nasq_auth'}),
    ('/api/auth/login', {'nasq_auth'}),
    ('/web/image/res.company/1/logo', {'nasq_odoo_image'}),
    ('/api/v1/me', {'nasq_api'}),
    ('/', {'nasq_web'}),
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


def _caddy_container(script: str) -> subprocess.CompletedProcess:
    if not shutil.which('docker'):
        raise unittest.SkipTest('docker executable unavailable')
    result = subprocess.run(
        ['docker', 'run', '--rm', '-i', CADDY_IMAGE, 'sh', '-s'],
        input=script, capture_output=True, text=True, timeout=60,
    )
    if result.returncode:
        # Missing image/module, invalid configuration and probe failures are not skips.
        unavailable = ('cannot connect to the docker daemon', 'is the docker daemon running',
                       'error during connect', 'failed to connect to the docker api')
        if any(reason in result.stderr.lower() for reason in unavailable):
            raise unittest.SkipTest(f'docker daemon unavailable: {result.stderr.strip()}')
        raise AssertionError(f'Caddy container exit {result.returncode}: {result.stderr}')
    return result


def _adapt_shared_caddyfile(text: str) -> dict:
    result = _caddy_container(
        "set -eu\nexport DOMAIN=a.example.test\n"
        "cat > /tmp/source.Caddyfile <<'NASQ_CADDY_SOURCE'\n"
        + text + "\nNASQ_CADDY_SOURCE\n"
        + 'caddy adapt --config /tmp/source.Caddyfile --adapter caddyfile\n'
    )
    return json.loads(result.stdout)


def _probe_shared_zones(text: str, paths: list[str]) -> list[set[str]]:
    adapted = _adapt_shared_caddyfile(text)
    handlers = _find_handlers(adapted, 'rate_limit')
    if len(handlers) != 1:
        raise AssertionError(f'expected one shared rate_limit handler, got {len(handlers)}')
    zones = handlers[0]['rate_limits']
    # Each adapted matcher set (including OR and NOT) is transplanted unchanged
    # into a nonterminal marker route. Do not hand-copy or reimplement path rules.
    routes = [
        {'match': zone['match'], 'handle': [
            {'handler': 'headers', 'response': {'set': {f'X-Nasq-Zone-{name}': ['matched']}}}
        ]}
        for name, zone in zones.items()
    ]
    routes.append({'handle': [{'handler': 'static_response', 'body': 'zone_probe'}]})
    config = {'admin': {'disabled': True}, 'apps': {'http': {'servers': {'probe': {
        'listen': ['127.0.0.1:8080'], 'routes': routes,
    }}}}}
    script = (
        "set -eu\ncat > /tmp/probe.json <<'NASQ_ZONE_PROBE'\n"
        + json.dumps(config) + '\nNASQ_ZONE_PROBE\n'
        + 'caddy run --config /tmp/probe.json >/tmp/caddy.log 2>&1 &\n'
        + 'pid=$!\ntrap \'kill "$pid" 2>/dev/null || true\' EXIT\n'
        + 'ready=0\nfor attempt in $(seq 1 50); do\n'
        + '  if curl --silent --fail --max-time 1 http://127.0.0.1:8080/ >/dev/null; then ready=1; break; fi\n'
        + '  sleep 0.1\ndone\n'
        + 'if [ "$ready" != 1 ]; then cat /tmp/caddy.log >&2; exit 1; fi\n'
    )
    for index, path in enumerate(paths):
        script += f"printf 'NASQ_PROBE {index}\\n'\n"
        # request-target prevents the HTTP client from cleaning ../ or // aliases.
        script += ('curl --silent --show-error --fail --max-time 2 --noproxy "*" '
                   '--path-as-is --request-target ' + shlex.quote(path)
                   + ' --dump-header - --output /dev/null http://127.0.0.1:8080/\n')
    output = _caddy_container(script).stdout
    records = output.split('NASQ_PROBE ')[1:]
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
            if separator and name.lower().startswith('x-nasq-zone-'):
                if value.strip() != 'matched':
                    raise AssertionError(f'invalid zone marker: {line}')
                names.add(name.lower().removeprefix('x-nasq-zone-'))
        matched.append(names)
    return matched


class TestEdgeRateLimitTemplate(unittest.TestCase):
    def test_caddyfile_declares_exactly_the_four_zones(self) -> None:
        text = CADDYFILE.read_text(encoding='utf-8')
        declared = re.findall(r'^\s*zone\s+(\S+)\s*\{', text, re.MULTILINE)
        self.assertEqual(len(declared), len(DEDICATED_ZONES))
        for zone in DEDICATED_ZONES:
            with self.subTest(zone=zone):
                self.assertEqual(declared.count(zone), 1)
        self.assertIn('key {remote_host}', text)
        self.assertIn('ipv6_prefix 64', text)
        self.assertNotIn('caddy:2', COMPOSE.read_text(encoding='utf-8'))

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
        for name in ('guard', 'odoo', 'db', 'web'):
            with self.subTest(service=name):
                self.assertFalse(rendered['services'][name].get('ports'))

        rendered = self._render_shared(
            {'NASQ_EDGE_BIND': '127.0.0.1', 'NASQ_EDGE_HTTPS_PORT': '8443', 'NASQ_EDGE_HTTP_PORT': '8080'}
        )
        proxy = rendered['services']['proxy'].get('ports', [])
        self.assertEqual(
            sorted((p['host_ip'], str(p['published']), p['target']) for p in proxy),
            [('127.0.0.1', '8080', 80), ('127.0.0.1', '8443', 443)],
        )

    def test_shared_overlay_odoo_healthcheck(self) -> None:
        """Behavioral: shared overlay replaces /web/health with a TCP listener probe; base remains /web/health."""
        shared = self._render_shared({})
        shared_hc = shared['services']['odoo'].get('healthcheck', {})
        shared_test = ' '.join(shared_hc.get('test', []))
        self.assertNotIn('/web/health', shared_test)
        self.assertIn('8069', shared_test)
        self.assertIn('socket', shared_test)
        self.assertIn('/opt/venv/bin/python', shared_test)

        base = self._render_base({})
        base_hc = base['services']['odoo'].get('healthcheck', {})
        base_test = ' '.join(base_hc.get('test', []))
        self.assertIn('/web/health', base_test)
        self.assertNotIn('socket', base_test)

    def test_shared_caddyfile_rate_limit_exempts_static_assets(self) -> None:
        """Behavioral: caddy adapt in built image verifies static asset exemptions in nasq_web."""
        adapted = _adapt_shared_caddyfile(SHARED_CADDYFILE.read_text(encoding='utf-8'))

        rl_handlers = _find_handlers(adapted, 'rate_limit')
        self.assertEqual(len(rl_handlers), 1)
        zones = rl_handlers[0]['rate_limits']

        self.assertEqual(zones['nasq_auth']['max_events'], 20)
        self.assertEqual(zones['nasq_auth']['match'][0]['path'], ['/api/auth/*', '/api/v1/auth/*', '/web/session/*', '/web/login'])

        self.assertEqual(zones['nasq_api']['max_events'], 300)
        self.assertEqual(zones['nasq_api']['match'][0]['path'], ['/api/v1/*'])
        self.assertEqual(zones['nasq_api']['match'][0]['not'][0]['path'], ['/api/v1/auth/*'])

        # F5: get_session_info is a non-credential call and moves from the 20/min
        # auth bucket to the Odoo bucket; every other /web/session/* stays in auth.
        auth_match = zones['nasq_auth']['match']
        self.assertEqual(len(auth_match), 1)
        self.assertEqual(auth_match[0]['not'][0]['path'], ['/web/session/get_session_info'])
        self.assertEqual(zones['nasq_auth']['window'], 60000000000)
        self.assertNotIn('/web/image/*', zones['nasq_auth']['match'][0]['path'])

        # F5: image traffic has its own (ACL-checked, still limited) budget.
        img = zones['nasq_odoo_image']
        self.assertEqual(img['max_events'], 1200)
        self.assertEqual(len(img['match']), 1)
        self.assertEqual(img['match'][0]['path'], ['/web/image/*', '/web/binary/company_logo'])
        self.assertNotIn('not', img['match'][0])

        odoo = zones['nasq_odoo']
        self.assertEqual(odoo['max_events'], 600)
        self.assertEqual(odoo['match'][0]['path'], ['/web/*', '/odoo/*', '/jsonrpc', '/xmlrpc/*', '/report/*', '/mail/*', '/bus/*', '/discuss/*'])
        self.assertEqual(odoo['match'][0]['not'][0]['path'], ['/web/session/*', '/web/login', '/web/image/*', '/web/binary/company_logo'])
        self.assertEqual(odoo['match'][1]['path'], ['/web/session/get_session_info'])
        self.assertNotIn('not', odoo['match'][1])
        # No Odoo asset/attachment prefix is exempted anywhere: /web/content,
        # /web/assets and /web/static stay inside nasq_odoo (not served via this edge
        # for assets; /web/content is ACL-checked).
        for zname in ('nasq_odoo', 'nasq_web'):
            for m in zones[zname]['match']:
                for neg in m.get('not', []):
                    for p in neg['path']:
                        self.assertFalse(p.startswith(('/web/content', '/web/assets', '/web/static')), p)
        # Nothing is exempt from all zones: the web zone still treats /web/* as Odoo-owned.
        self.assertIn('/web/*', zones['nasq_web']['match'][0]['not'][0]['path'])

        web_match = zones['nasq_web']['match'][0]
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
        self.assertEqual(actual[0], {'nasq_auth', 'nasq_odoo'})
        # The SAME full-matrix assertion must fail, not just a string assertion.
        with self.assertRaises(AssertionError):
            self.assertEqual(actual, [expected for _, expected in SHARED_ZONE_CASES])

    def _render_shared(self, extra: dict) -> dict:
        if not shutil.which('docker') or subprocess.run(
                ['docker', 'compose', 'version'], capture_output=True, timeout=60).returncode:
            self.skipTest('docker compose unavailable')
        env = {
            'NASQ_IMAGE_TAG': 'test', 'ODOO_COMMIT': 'dummy', 'NASQ_SESSION_KEYS': 'dummy',
            'NASQ_SESSION_ACTIVE_KID': 'k1', 'NASQ_SHARED_PROXY_TOKEN': 'dummy',
            'NASQ_SHARED_ODOO_CONFIG': '/tmp/dummy-odoo.conf', 'NASQ_TENANT_REGISTRY_DIR': '/tmp',
            'POSTGRES_PASSWORD': 'dummy', 'NASQ_DOMAIN': 'example.test', **extra,
        }
        with tempfile.TemporaryDirectory() as tmp:
            envfile = Path(tmp) / 'dummy.env'
            envfile.write_text(''.join(f'{k}={v}\n' for k, v in env.items()), encoding='utf-8')
            res = subprocess.run(
                ['docker', 'compose', '--env-file', str(envfile),
                 '-f', str(COMPOSE), '-f', str(ROOT / 'deploy' / 'docker-compose.shared.yml'),
                 'config', '--format', 'json'],
                capture_output=True, text=True, timeout=60, cwd=ROOT, env={k: v for k, v in os.environ.items() if not k.startswith(('NASQ_', 'ODOO_', 'POSTGRES_'))},
            )
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout)

    def _render_base(self, extra: dict) -> dict:
        if not shutil.which('docker') or subprocess.run(
                ['docker', 'compose', 'version'], capture_output=True, timeout=60).returncode:
            self.skipTest('docker compose unavailable')
        env = {
            'NASQ_IMAGE_TAG': 'test', 'ODOO_COMMIT': 'dummy',
            'DB_PASSWORD': 'dummy', 'DOMAIN': 'example.test', **extra,
        }
        with tempfile.TemporaryDirectory() as tmp:
            envfile = Path(tmp) / 'dummy.env'
            envfile.write_text(''.join(f'{k}={v}\n' for k, v in env.items()), encoding='utf-8')
            res = subprocess.run(
                ['docker', 'compose', '--env-file', str(envfile),
                 '-f', str(COMPOSE),
                 'config', '--format', 'json'],
                capture_output=True, text=True, timeout=60, cwd=ROOT, env={k: v for k, v in os.environ.items() if not k.startswith(('NASQ_', 'ODOO_', 'POSTGRES_'))},
            )
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout)

    def test_auth_zone_is_tighter_than_the_api_zone(self) -> None:
        text = CADDYFILE.read_text(encoding='utf-8')
        auth = text.split('zone nasq_auth {', 1)[1].split('zone nasq_api {', 1)[0]
        api = text.split('zone nasq_api {', 1)[1].split('zone nasq_odoo {', 1)[0]
        self.assertIn('events 20', auth)
        self.assertIn('events 300', api)
        self.assertIn('not path /api/v1/auth/*', api)


if __name__ == '__main__':
    unittest.main()
