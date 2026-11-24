# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The login budget of the two-step sign-in on the one edge (`deploy/stack/Caddyfile`).

The browser security headers are set by the guard (deploy/shared/securityHeaders.mjs, pinned by
deploy/shared/securityHeaders.test.mjs); the edge sets none. The checks here run the real Caddy matchers in the built
Caddy image on container loopback, so a narrowed auth matcher or a budget keyed on anything but the client address
fails here instead of at a deployment.
"""
import unittest

from deploy.stack.render import CADDYFILE
from deploy.test_edge_rate_limit import _adapt_shared_caddyfile, _probe_shared_zones

# The two-step sign-in of this release: password, channel list, code send, verify,
# remembered device and sign-out, on both the BFF and the Odoo API prefix.
AUTH_PATHS = (
    '/api/auth/login', '/api/auth/code', '/api/auth/verify', '/api/auth/device', '/api/auth/logout',
    '/api/v1/auth/channels', '/api/v1/auth/code', '/api/v1/auth/verify', '/api/v1/auth/device',
)


class TestEdgeBudgets(unittest.TestCase):
    def test_every_two_step_endpoint_shares_the_login_budget(self):
        """Behavioral: the real matchers decide, so a missing path fails here."""
        matched = _probe_shared_zones(CADDYFILE.read_text(encoding='utf-8'), list(AUTH_PATHS))
        for path, zones in zip(AUTH_PATHS, matched):
            with self.subTest(path=path):
                self.assertEqual(zones, {'liwan_auth'})

    def test_budgets_are_per_client_address_only(self):
        """Per-account throttling belongs to Odoo, which knows the account; the edge knows the peer."""
        adapted = _adapt_shared_caddyfile(CADDYFILE.read_text(encoding='utf-8'))
        zones = {}

        def collect(obj):
            if isinstance(obj, dict):
                if obj.get('handler') == 'rate_limit':
                    zones.update(obj['rate_limits'])
                for value in obj.values():
                    collect(value)
            elif isinstance(obj, list):
                for item in obj:
                    collect(item)

        collect(adapted['apps']['http']['servers'])
        self.assertEqual(set(zones), {'liwan_auth', 'liwan_provider_hook', 'liwan_account', 'liwan_api',
                                      'liwan_public_appointments_ip', 'liwan_odoo_image', 'liwan_odoo', 'liwan_signup',
                                      'liwan_public_site', 'liwan_web', 'liwan_tiktok'})
        keys = {zone['key'] for zone in zones.values()}
        self.assertEqual(len(keys), 1, 'no account, header or cookie may key an edge budget')
        self.assertIn('client_ip', keys.pop())


if __name__ == '__main__':
    unittest.main()
