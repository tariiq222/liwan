# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Static checks for the customer edge rate-limit template.

These tests do not start Docker or Caddy. They prove the template and image
definition stayed wired together.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CADDYFILE = ROOT / 'deploy' / 'Caddyfile'
DOCKERFILE = ROOT / 'deploy' / 'proxy' / 'Dockerfile'
COMPOSE = ROOT / 'deploy' / 'docker-compose.yml'

ZONES = ('nasq_auth', 'nasq_api', 'nasq_odoo', 'nasq_web')


class TestEdgeRateLimitTemplate(unittest.TestCase):
    def test_caddyfile_declares_exactly_the_four_zones(self) -> None:
        text = CADDYFILE.read_text(encoding='utf-8')
        for zone in ZONES:
            with self.subTest(zone=zone):
                self.assertEqual(text.count(f'zone {zone} {{'), 1)
        self.assertEqual(text.count('\n\t\t\t\tzone '), len(ZONES))
        self.assertIn('key {client_ip}', text)
        self.assertIn('ipv6_prefix 64', text)
        self.assertNotIn('caddy:2', COMPOSE.read_text(encoding='utf-8'))

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
        if not shutil.which('docker'):
            self.skipTest('docker unavailable')
        caddy_image = 'nasq-accept-caddy:28b6c04'
        check_img = subprocess.run(['docker', 'image', 'inspect', caddy_image], capture_output=True)
        if check_img.returncode != 0:
            self.skipTest(f'{caddy_image} image not found')

        shared_caddyfile = ROOT / 'deploy' / 'shared' / 'Caddyfile'
        res = subprocess.run(
            ['docker', 'run', '--rm', '-v', f'{shared_caddyfile}:/etc/caddy/Caddyfile:ro',
             '-e', 'DOMAIN=a.example.test', caddy_image, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile'],
            capture_output=True, text=True,
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        adapted = json.loads(res.stdout)

        def _find_handlers(obj: any, handler_name: str) -> list[dict]:
            found = []
            if isinstance(obj, dict):
                if obj.get('handler') == handler_name:
                    found.append(obj)
                for v in obj.values():
                    found.extend(_find_handlers(v, handler_name))
            elif isinstance(obj, list):
                for item in obj:
                    found.extend(_find_handlers(item, handler_name))
            return found

        rl_handlers = _find_handlers(adapted, 'rate_limit')
        self.assertEqual(len(rl_handlers), 1)
        zones = rl_handlers[0]['rate_limits']

        self.assertEqual(zones['nasq_auth']['max_events'], 20)
        self.assertEqual(zones['nasq_auth']['match'][0]['path'], ['/api/auth/*', '/api/v1/auth/*', '/web/session/*', '/web/login'])

        self.assertEqual(zones['nasq_api']['max_events'], 300)
        self.assertEqual(zones['nasq_api']['match'][0]['path'], ['/api/v1/*'])
        self.assertEqual(zones['nasq_api']['match'][0]['not'][0]['path'], ['/api/v1/auth/*'])

        self.assertEqual(zones['nasq_odoo']['max_events'], 600)
        self.assertEqual(zones['nasq_odoo']['match'][0]['path'], ['/web/*', '/odoo/*', '/jsonrpc', '/xmlrpc/*', '/report/*', '/mail/*', '/bus/*', '/discuss/*'])
        self.assertEqual(zones['nasq_odoo']['match'][0]['not'][0]['path'], ['/web/session/*', '/web/login'])

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

    def _render_shared(self, extra: dict) -> dict:
        if not shutil.which('docker') or subprocess.run(
                ['docker', 'compose', 'version'], capture_output=True).returncode:
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
                capture_output=True, text=True, cwd=ROOT, env={k: v for k, v in os.environ.items() if not k.startswith(('NASQ_', 'ODOO_', 'POSTGRES_'))},
            )
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout)

    def _render_base(self, extra: dict) -> dict:
        if not shutil.which('docker') or subprocess.run(
                ['docker', 'compose', 'version'], capture_output=True).returncode:
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
                capture_output=True, text=True, cwd=ROOT, env={k: v for k, v in os.environ.items() if not k.startswith(('NASQ_', 'ODOO_', 'POSTGRES_'))},
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
