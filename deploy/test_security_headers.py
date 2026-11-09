# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Dedicated-edge security headers and the login budget of the two-step sign-in.

The structural checks read the real adapted JSON, and the behavioral ones run the
built Caddy image on container loopback with stub upstreams, so a removed header or
a narrowed auth matcher fails here instead of at a deployment.
"""
import json
import shlex
import unittest

from deploy.test_edge_rate_limit import CADDYFILE, _adapt_shared_caddyfile, _caddy_container, _probe_shared_zones

WEB_DIAL = 'web:3000'
ODOO_DIALS = ('odoo:8069', 'odoo:8072')

HEADER_VALUES = {
    'Content-Security-Policy': (
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https:; connect-src 'self' wss:; object-src 'none'; "
        "frame-src 'none'; base-uri 'self'; form-action 'self' https:; frame-ancestors 'none'"
    ),
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), display-capture=(), geolocation=(self), fullscreen=(self)',
}

# The two-step sign-in of this release: password, channel list, code send, verify,
# remembered device and sign-out, on both the BFF and the Odoo API prefix.
AUTH_PATHS = (
    '/api/auth/login', '/api/auth/code', '/api/auth/verify', '/api/auth/device', '/api/auth/logout',
    '/api/v1/auth/channels', '/api/v1/auth/code', '/api/v1/auth/verify', '/api/v1/auth/device',
)


def _adapted(text=None):
    return _adapt_shared_caddyfile(text if text is not None else CADDYFILE.read_text(encoding='utf-8'))


def _proxy_routes(obj, dials):
    """Routes whose handle list proxies to one of DIALS, with their header handlers."""
    found = []
    if isinstance(obj, dict):
        handle = obj.get('handle')
        if isinstance(handle, list):
            upstreams = {
                upstream.get('dial')
                for item in handle if item.get('handler') == 'reverse_proxy'
                for upstream in item.get('upstreams', [])
            }
            if upstreams & set(dials):
                found.append({'headers': [item for item in handle if item.get('handler') == 'headers'],
                              'handle': handle})
        for value in obj.values():
            found.extend(_proxy_routes(value, dials))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(_proxy_routes(item, dials))
    return found


def _response_headers(route):
    """Each header a route sets, with its value, its mode and whether it is deferred."""
    sent = {}
    for handler in route['headers']:
        response = handler['response']
        # `?Name value` is a default: it applies only when the upstream sent nothing.
        mode = 'default' if 'require' in response else 'set'
        for name, values in response.get('set', {}).items():
            sent[name] = (values[0], mode, bool(response.get('deferred')))
    return sent


def _edge_headers(requests):
    """Real edge responses: the headers each request receives, with its status."""
    config = _adapted(CADDYFILE.read_text(encoding='utf-8').replace('{$DOMAIN}', 'http://127.0.0.1:8080'))
    config['admin'] = {'disabled': True}

    def redirect_upstreams(value):
        if isinstance(value, dict):
            if value.get('dial') == WEB_DIAL:
                value['dial'] = '127.0.0.1:8081'
            elif value.get('dial') in ODOO_DIALS:
                value['dial'] = '127.0.0.1:8082'
            for child in value.values():
                redirect_upstreams(child)
        elif isinstance(value, list):
            for child in value:
                redirect_upstreams(child)

    redirect_upstreams(config)
    # The stub web backend carries a token page that already sent a stricter referrer
    # policy; the Odoo stub answers a document too, so a leaked header would be caught.
    config['apps']['http']['servers']['stub_web'] = {
        'listen': ['127.0.0.1:8081'],
        'routes': [
            {'match': [{'path': ['/pay/token']}],
             'handle': [{'handler': 'static_response', 'headers': {'Referrer-Policy': ['no-referrer']},
                         'body': 'web'}]},
            {'handle': [{'handler': 'static_response', 'body': 'web'}]},
        ],
    }
    config['apps']['http']['servers']['stub_odoo'] = {
        'listen': ['127.0.0.1:8082'],
        'routes': [{'handle': [{'handler': 'static_response', 'body': 'odoo'}]}],
    }
    script = (
        "set -eu\ncat > /tmp/p2-headers.json <<'LIWAN_P2_HEADERS'\n" + json.dumps(config)
        + "\nLIWAN_P2_HEADERS\ncaddy run --config /tmp/p2-headers.json >/tmp/caddy.log 2>&1 &\n"
        + "pid=$!\ntrap 'kill \"$pid\" 2>/dev/null || true' EXIT\n"
        + "ready=0\nfor attempt in $(seq 1 50); do\n"
        + "  if curl -sf --max-time 1 http://127.0.0.1:8081/ >/dev/null; then ready=1; break; fi\n"
        + "  sleep 0.1\ndone\n[ \"$ready\" = 1 ] || { cat /tmp/caddy.log >&2; exit 1; }\n"
    )
    for index, path in enumerate(requests):
        script += f"printf 'LIWAN_P2_CASE {index}\\n'\n"
        script += ('curl --silent --show-error --max-time 3 --noproxy "*" --path-as-is '
                   '--interface 127.0.0.2 --request-target ' + shlex.quote(path)
                   + ' --dump-header - --output /dev/null http://127.0.0.1:8080/\n')
    records = _caddy_container(script).stdout.split('LIWAN_P2_CASE ')[1:]
    if len(records) != len(requests):
        raise AssertionError(f'expected {len(requests)} edge responses, got {len(records)}')
    responses = []
    for index, record in enumerate(records):
        lines = record.splitlines()
        if lines[0] != str(index):
            raise AssertionError('edge response ordering mismatch')
        status = int(lines[1].split()[1])
        headers = {}
        for line in lines[2:]:
            name, separator, value = line.partition(':')
            if separator:
                headers[name.strip().lower()] = value.strip()
        responses.append((status, headers))
    return responses


class TestWebSecurityHeaders(unittest.TestCase):
    def test_headers_are_set_on_the_nuxt_route_only(self):
        """The edited JSON, not the Caddyfile text: every value and its deferral mode."""
        adapted = _adapted()
        web = _proxy_routes(adapted, [WEB_DIAL])
        self.assertEqual(len(web), 1, 'expected one reverse_proxy to the Nuxt upstream')
        sent = _response_headers(web[0])
        self.assertEqual({name: (value, mode) for name, (value, mode, _) in sent.items()},
                         {name: (value, 'default' if name == 'Referrer-Policy' else 'set')
                          for name, value in HEADER_VALUES.items()})
        # Every fixed header must be deferred: an upstream value may not survive it.
        for name, (_, mode, deferred) in sent.items():
            with self.subTest(header=name):
                self.assertEqual(deferred, name != 'Referrer-Policy', 'only a fixed header is deferred')

        for route in _proxy_routes(adapted, ODOO_DIALS):
            with self.subTest(handle=route['handle']):
                self.assertEqual(_response_headers(route), {},
                                 'the report/barcode/download answers must carry no document headers')

    def test_browser_receives_the_headers_and_keeps_a_stricter_referrer(self):
        """Behavioral: the real edge response, including the `?` default losing to the app."""
        (web_status, web), (token_status, token), (odoo_status, odoo) = _edge_headers(
            ['/projects', '/pay/token', '/web/health'])
        self.assertEqual((web_status, token_status, odoo_status), (200, 200, 200))
        for name, value in HEADER_VALUES.items():
            if name == 'Referrer-Policy':
                continue
            with self.subTest(header=name):
                self.assertEqual(web.get(name.lower()), value)
                self.assertEqual(token.get(name.lower()), value)
        self.assertEqual(web['referrer-policy'], 'strict-origin-when-cross-origin')
        self.assertEqual(token['referrer-policy'], 'no-referrer',
                         'the page that carries a document token keeps its own policy')
        for name in HEADER_VALUES:
            with self.subTest(header=name):
                self.assertNotIn(name.lower(), odoo, 'Odoo answers carry no browser document headers')

    def test_every_two_step_endpoint_shares_the_login_budget(self):
        """Behavioral: the real matchers decide, so a missing path fails here."""
        matched = _probe_shared_zones(CADDYFILE.read_text(encoding='utf-8'), list(AUTH_PATHS))
        for path, zones in zip(AUTH_PATHS, matched):
            with self.subTest(path=path):
                self.assertEqual(zones, {'liwan_auth'})

    def test_budgets_are_per_client_address_only(self):
        """Per-account throttling belongs to Odoo, which knows the account; the edge knows the peer."""
        adapted = _adapted()
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
        self.assertEqual(set(zones), {'liwan_auth', 'liwan_provider_hook', 'liwan_api',
                                      'liwan_public_appointments_ip', 'liwan_odoo', 'liwan_web'})
        for name, zone in zones.items():
            with self.subTest(zone=name):
                self.assertEqual(zone['key'], '{http.request.remote.host}',
                                 'no account, header or cookie may key an edge budget')


if __name__ == '__main__':
    unittest.main()
