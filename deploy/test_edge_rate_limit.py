# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Static checks for the customer edge rate-limit template.

These tests do not start Docker or Caddy. They prove the template and image
definition stayed wired together.
"""
from __future__ import annotations

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
        self.assertIn('github.com/mholt/caddy-ratelimit@v0.2.0', text)
        self.assertIn("grep -q 'http.handlers.rate_limit'", text)
        self.assertIn('deploy/proxy/Dockerfile', COMPOSE.read_text(encoding='utf-8'))

    def test_auth_zone_is_tighter_than_the_api_zone(self) -> None:
        text = CADDYFILE.read_text(encoding='utf-8')
        auth = text.split('zone nasq_auth {', 1)[1].split('zone nasq_api {', 1)[0]
        api = text.split('zone nasq_api {', 1)[1].split('zone nasq_odoo {', 1)[0]
        self.assertIn('events 20', auth)
        self.assertIn('events 300', api)
        self.assertIn('not path /api/v1/auth/*', api)


if __name__ == '__main__':
    unittest.main()
