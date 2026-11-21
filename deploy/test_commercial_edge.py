# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The commercial overlay's edge wiring: the web tier and the proxy trust the control CA, and the proxy forwards
exactly one control-plane route (the payment webhook) through the Caddyfile that imports the shared snippet.

Compose rendering needs the docker CLI; the Caddy checks run in the pinned proxy image, like the other edge tests.
"""
from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from deploy.test_edge_rate_limit import ROOT, SHARED_CADDYFILE, _caddy_container, _caddy_image, _docker

DEPLOY = ROOT / 'deploy'
SNIPPET = ROOT / 'deploy' / 'control-plane' / 'Caddyfile.snippet'
COMPOSE_FILES = ('docker-compose.yml', 'docker-compose.shared.yml', 'docker-compose.shared-commercial.yml',
                 'docker-compose.production.yml', 'docker-compose.host-link.yml')
CA_TARGET = '/etc/liwan-control/control-ca.pem'
HOOK_HOST = 'hooks.example.test'
HOOK_PATH = '/v1/commercial/payment-events/moyasar'

ENV = {
    'LIWAN_IMAGE_TAG': 'test', 'ODOO_COMMIT': 'dummy', 'LIWAN_SESSION_KEYS': 'dummy', 'LIWAN_SESSION_ACTIVE_KID': 'k1',
    'LIWAN_SHARED_PROXY_TOKEN': 'dummy', 'LIWAN_SHARED_ODOO_CONFIG': '/tmp/dummy-odoo.conf',
    'LIWAN_TENANT_REGISTRY_DIR': '/tmp', 'POSTGRES_PASSWORD': 'dummy', 'LIWAN_DOMAIN': 'example.test',
    'LIWAN_EDGE_BIND': '0.0.0.0', 'LIWAN_EDGE_HTTP_PORT': '80', 'LIWAN_EDGE_HTTPS_PORT': '443',
    'LIWAN_PROSPECT_HOST': 'example.test', 'NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN': 'https://example.test',
    'NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL': 'https://control-api:4187', 'CUSTOMER_COMMERCIAL_SERVICE_KEY': 'dummy',
    'CUSTOMER_COMMERCIAL_ISSUER': 'dummy', 'LIWAN_COMMERCIAL_CONTROL_NETWORK': 'liwan-control-test',
    'LIWAN_CONTROL_PRIVATE_DIR': '/srv/control/private',
    # production and host-link overlays
    'LIWAN_ODOO_DB_PORT': '15433',
}


def render(files: tuple[str, ...], extra: dict | None = None) -> dict:
    if not shutil.which('docker') or subprocess.run(['docker', 'compose', 'version'], capture_output=True, timeout=60).returncode:
        raise unittest.SkipTest('docker compose unavailable')
    env = {**ENV, **(extra or {})}
    with tempfile.TemporaryDirectory() as tmp:
        envfile = Path(tmp) / 'dummy.env'
        envfile.write_text(''.join(f'{k}={v}\n' for k, v in env.items()), encoding='utf-8')
        result = subprocess.run(
            ['docker', 'compose', '--env-file', str(envfile), *[a for f in files for a in ('-f', str(DEPLOY / f))],
             'config', '--format', 'json'],
            capture_output=True, text=True, timeout=60, cwd=ROOT,
            env={k: v for k, v in os.environ.items() if not k.startswith(('LIWAN_', 'ODOO_', 'POSTGRES_'))})
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def mounts(service: dict) -> dict:
    return {m['target']: m for m in service.get('volumes', [])}


class ComposeWiring(unittest.TestCase):
    def test_web_and_proxy_trust_the_control_ca_and_the_proxy_keeps_its_networks(self) -> None:
        plain = render(COMPOSE_FILES[:2] + COMPOSE_FILES[3:], {})['services']['proxy']
        services = render(COMPOSE_FILES, {'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST})['services']
        web, proxy = services['web'], services['proxy']
        for service in (web, proxy):
            ca = mounts(service)[CA_TARGET]
            self.assertEqual(ca['source'], '/srv/control/private/control-ca.pem')
            self.assertTrue(ca.get('read_only'))
        self.assertEqual(web['environment']['NODE_EXTRA_CA_CERTS'], CA_TARGET)
        self.assertEqual(proxy['environment']['CONTROL_WEBHOOK_DOMAIN'], HOOK_HOST)
        self.assertEqual(set(proxy['networks']), set(plain['networks']) | {'commercial_control'})
        self.assertIn('commercial_control', web['networks'])
        # The web mounts the overlay did not add stay (registry directories), and no CA target sits inside another mount.
        self.assertIn('/etc/liwan', mounts(web))
        self.assertTrue(CA_TARGET.startswith('/etc/liwan-control/'))

    def test_no_mount_target_lies_inside_a_read_only_mount(self) -> None:
        services = render(COMPOSE_FILES, {'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST})['services']
        for name in ('web', 'proxy'):
            targets = mounts(services[name])
            for target in targets:
                for parent, mount in targets.items():
                    inside = target != parent and target.startswith(parent.rstrip('/') + '/')
                    self.assertFalse(inside and mount.get('read_only'), f'{name}: {target} is inside read-only {parent}')

    def test_a_missing_source_stops_compose_instead_of_creating_a_host_directory(self) -> None:
        services = render(COMPOSE_FILES, {'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST})['services']
        for name, target in (('web', CA_TARGET), ('proxy', CA_TARGET),
                             ('proxy', '/etc/caddy/commercial/control-webhook.caddy')):
            bind = mounts(services[name])[target].get('bind', {})
            self.assertIs(bind.get('create_host_path'), False, f'{name} {target}')

    def test_web_and_proxy_start_with_the_rendered_mounts(self) -> None:
        """Create real containers (read-only root, the rendered mounts, sources made real) so a mount that the runtime refuses fails here."""
        image = _caddy_image()
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            for d in ('registry', 'restore', 'private', 'maint'):
                (tmp / d).mkdir()
            (tmp / 'private' / 'control-ca.pem').write_text(_test_ca(), encoding='utf-8')
            extra = {'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST, 'LIWAN_TENANT_REGISTRY_DIR': str(tmp / 'registry'),
                     'LIWAN_RESTORE_REGISTRY_DIR': str(tmp / 'restore'), 'LIWAN_CONTROL_PRIVATE_DIR': str(tmp / 'private'),
                     'LIWAN_MAINTENANCE_DIR': str(tmp / 'maint')}
            services = render(COMPOSE_FILES, extra)['services']
            for name in ('web', 'proxy'):
                args = ['run', '--rm', '--read-only', '--entrypoint', 'true']
                for m in services[name].get('volumes', []):
                    if m['type'] == 'bind':
                        args += ['--mount', f"type=bind,source={m['source']},target={m['target']}"
                                 + (',readonly' if m.get('read_only') else '')]
                    elif m['type'] == 'volume':
                        args += ['--tmpfs', m['target']]
                result = _docker([*args, image], timeout=120)
                self.assertEqual(result.returncode, 0, f'{name}: {result.stderr}')

    def test_an_unset_webhook_host_renders_the_reserved_name(self) -> None:
        proxy = render(COMPOSE_FILES)['services']['proxy']
        self.assertEqual(proxy['environment']['CONTROL_WEBHOOK_DOMAIN'], 'control-webhook.invalid')

    def test_the_stack_without_the_overlay_has_no_control_wiring(self) -> None:
        services = render(COMPOSE_FILES[:2] + COMPOSE_FILES[3:])['services']
        self.assertNotIn(CA_TARGET, mounts(services['web']))
        self.assertNotIn(CA_TARGET, mounts(services['proxy']))
        self.assertNotIn('commercial_control', services['proxy']['networks'])
        self.assertNotIn('/etc/caddy/commercial/control-webhook.caddy', mounts(services['proxy']))

    def test_the_snippet_is_mounted_where_the_caddyfile_imports_it(self) -> None:
        proxy = render(COMPOSE_FILES)['services']['proxy']
        self.assertEqual(mounts(proxy)['/etc/caddy/commercial/control-webhook.caddy']['source'], str(SNIPPET))
        self.assertIn('import /etc/caddy/commercial/*.caddy', SHARED_CADDYFILE.read_text(encoding='utf-8'))


def _test_ca() -> str:
    """A throwaway PEM certificate: Caddy only parses the trust pool; the behavior test never connects over TLS."""
    if not shutil.which('openssl'):
        raise unittest.SkipTest('openssl unavailable to make a test CA')
    return subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', '/dev/null', '-days', '2',
                           '-subj', '/CN=test-ca'], capture_output=True, text=True, check=True).stdout


def _caddy_step(script_body: str, env: dict[str, str], *, snippet: bool, ca: str = '') -> subprocess.CompletedProcess:
    """Lay out the proxy's files as the overlay mounts them, then run `script_body` in the pinned Caddy image.

    The image runs as a non-root user that cannot write under /etc, so the two mount targets move to /tmp in the
    copies the container sees; the repository files themselves are used otherwise unchanged.
    """
    def relocate(text: str) -> str:
        return text.replace('/etc/caddy/commercial', '/tmp/commercial').replace(CA_TARGET, '/tmp/control-ca.pem')

    setup = 'set -eu\nmkdir -p /tmp/commercial\n'
    setup += f"cat > /tmp/Caddyfile <<'LIWAN_SRC'\n{relocate(SHARED_CADDYFILE.read_text(encoding='utf-8'))}\nLIWAN_SRC\n"
    if snippet:
        setup += f"cat > /tmp/commercial/control-webhook.caddy <<'LIWAN_SNIPPET'\n{relocate(SNIPPET.read_text(encoding='utf-8'))}\nLIWAN_SNIPPET\n"
    if ca:
        setup += f"cat > /tmp/control-ca.pem <<'LIWAN_CA'\n{ca}LIWAN_CA\n"
    exports = ''.join(f'export {k}={shlex.quote(v)}\n' for k, v in env.items())
    return _caddy_container(setup + exports + script_body)


class CaddyValidation(unittest.TestCase):
    """`caddy validate` provisions every module, so a missing CA file or an ambiguous site address fails it."""

    def _validate(self, env: dict[str, str], *, snippet: bool, ca: bool) -> None:
        _caddy_step('caddy validate --config /tmp/Caddyfile --adapter caddyfile\n', {'DOMAIN': 'a.example.test', **env},
                    snippet=snippet, ca=_test_ca() if ca else '')

    def test_a_stack_without_the_overlay_validates_with_no_snippet_and_no_ca(self) -> None:
        self._validate({}, snippet=False, ca=False)

    def test_the_overlay_validates_with_the_webhook_host_unset_or_set(self) -> None:
        self._validate({}, snippet=True, ca=True)
        self._validate({'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST}, snippet=True, ca=True)
        self._validate({'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST, 'LIWAN_SITE_SCHEME': 'http://', 'LIWAN_AUTO_HTTPS': 'off'},
                       snippet=True, ca=True)

    def test_the_overlay_fails_loudly_without_the_ca_file(self) -> None:
        with self.assertRaises(AssertionError):
            self._validate({}, snippet=True, ca=False)


# Every spelling Caddy's `path` matcher accepts (decoded, cleaned, slash-merged, case-folded) but reverse_proxy would forward raw.
CANONICAL = ('POST', HOOK_PATH)
REFUSED_TARGETS = (
    ('GET', HOOK_PATH), ('POST', '/v1/commercial/admin'), ('POST', HOOK_PATH + '/x'), ('POST', '/'),
    ('POST', '/v1/admin/auth/login%2f..%2f..%2f..%2f..%2fv1/commercial/payment-events/moyasar'),
    ('POST', '/v1/customer/signup/start%2f..%2f..%2f..%2f..%2fv1/commercial/payment-events/moyasar'),
    ('POST', '/v1/commercial/payment-events/simulator%2f..%2fmoyasar'),
    ('POST', '/V1/COMMERCIAL/PAYMENT-EVENTS/MOYASAR'),
    ('POST', '//v1/commercial/payment-events/moyasar'),
    ('POST', HOOK_PATH + '?x=1'), ('POST', HOOK_PATH + '/'), ('POST', HOOK_PATH + ';x'),
    ('POST', '/v1/commercial%2Fpayment-events%2Fmoyasar'), ('POST', '/v1/commercial/payment-events%2Fmoyasar'),
    ('POST', '/v1/commercial/payment-events/./moyasar'), ('POST', '/v1/commercial/payment-events/%6doyasar'),
)


def _pki(tmp: Path, name: str, *, ca_name: str = '') -> dict[str, Path]:
    """A throwaway CA (or, with `ca_name`, a leaf for SAN control-api signed by that CA), written under `tmp`."""
    if not shutil.which('openssl'):
        raise unittest.SkipTest('openssl unavailable to make test certificates')
    files = {'key': tmp / f'{name}.key', 'crt': tmp / f'{name}.crt'}
    if not ca_name:
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(files['key']), '-out',
                        str(files['crt']), '-days', '2', '-subj', f'/CN={name}', '-addext', 'basicConstraints=critical,CA:TRUE'],
                       capture_output=True, check=True)
        return files
    ext = tmp / f'{name}.ext'
    ext.write_text('subjectAltName=DNS:control-api\n', encoding='utf-8')
    csr = tmp / f'{name}.csr'
    subprocess.run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(files['key']), '-out', str(csr),
                    '-subj', '/CN=control-api'], capture_output=True, check=True)
    subprocess.run(['openssl', 'x509', '-req', '-in', str(csr), '-CA', str(tmp / f'{ca_name}.crt'), '-CAkey',
                    str(tmp / f'{ca_name}.key'), '-CAcreateserial', '-days', '2', '-extfile', str(ext), '-out',
                    str(files['crt'])], capture_output=True, check=True)
    return files


def _heredoc(path: str, text: str, tag: str) -> str:
    return f"cat > {path} <<'{tag}'\n{text.rstrip(chr(10))}\n{tag}\n"


STRIPPED_HEADERS = ('X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'Forwarded', 'X-Liwan-Proxy-Token',
                    'X-Liwan-Tenant-Revision', 'X-Liwan-Client-Ip', 'X-Liwan-Signup-Client')
RESERVED_HOST = 'control-webhook.invalid'


def _adapt(env: dict[str, str]) -> dict:
    """The shared Caddyfile with the snippet imported, adapted to JSON by the pinned Caddy; a None value leaves the variable unset."""
    env = {'DOMAIN': 'http://a.example.test', 'LIWAN_SITE_SCHEME': 'http://', 'LIWAN_AUTO_HTTPS': 'off', **env}
    return json.loads(_caddy_step('caddy adapt --config /tmp/Caddyfile --adapter caddyfile\n',
                                  {k: v for k, v in env.items() if v is not None}, snippet=True, ca=_test_ca()).stdout)


def _webhook_route(adapted: dict, host: str) -> dict:
    """The inner route list (subroute) of the site whose host matcher is `host`."""
    sites = [r for s in adapted['apps']['http']['servers'].values() for r in s['routes']
             if any(m.get('host') == [host] for m in r.get('match', []))]
    if len(sites) != 1:
        raise AssertionError(f'expected one site for host {host}, found {len(sites)}')
    return next(h for h in sites[0]['handle'][0]['routes'][0]['handle'] if h['handler'] == 'subroute')


def _edge_run(host: str, targets, *, env: dict[str, str | None] | None = None, ca: str = '',
              upstream_tls: tuple[str, str] | None = None, request_host: str = '',
              client_headers: tuple[str, ...] = ()) -> tuple[list[list[str]], int, list[dict]]:
    """Run the adapted webhook site in the pinned Caddy with its upstream replaced by a logging stub on loopback.

    Only the dial address changes: the transport (TLS, trust pool, server name) is kept as the snippet declares it. The stub
    speaks HTTPS with `upstream_tls` (certificate and key text) or plain HTTP without it. Returns one [status, body] per target
    the number of requests the stub received and its access-log records (each with the request headers it got).
    `request_host` is the Host header sent (default `host`); `client_headers` are extra headers the client sends.
    """
    env = {'CONTROL_WEBHOOK_DOMAIN': host, **(env or {})}
    ca = ca or _test_ca()
    adapted = _adapt(env)
    server = next(s for s in adapted['apps']['http']['servers'].values() if host in json.dumps(s))
    adapted['apps']['http']['servers'] = {'edge': server}
    server['listen'] = ['127.0.0.1:8080']
    upstreams = []

    def redirect(value):
        if isinstance(value, dict):
            if value.get('handler') == 'reverse_proxy' and any(u.get('dial') == 'control-api:4187' for u in value['upstreams']):
                if upstream_tls is None:
                    value.pop('transport')
                for u in value['upstreams']:
                    u['dial'] = '127.0.0.1:8081'
                upstreams.append(value)
            for child in list(value.values()):
                redirect(child)
        elif isinstance(value, list):
            for child in value:
                redirect(child)

    redirect(adapted)
    if len(upstreams) != 1:
        raise AssertionError('the webhook is the only route that reaches control-api')
    stub = {'listen': ['127.0.0.1:8081'], 'logs': {}, 'routes': [{'handle': [
        {'handler': 'static_response', 'body': 'stub-upstream:{http.request.method}:{http.request.uri}'}]}]}
    adapted['admin'] = {'disabled': True}
    adapted['logging'] = {'logs': {'stub': {'writer': {'output': 'file', 'filename': '/tmp/stub.log'},
                                            'include': ['http.log.access']}}}
    if upstream_tls:
        stub['tls_connection_policies'] = [{}]
        stub['automatic_https'] = {'disable': True}
        adapted['apps'].setdefault('tls', {})['certificates'] = {
            'load_files': [{'certificate': '/tmp/up.crt', 'key': '/tmp/up.key'}]}
    adapted['apps']['http']['servers']['stub'] = stub
    script = _heredoc('/tmp/edge.json', json.dumps(adapted), 'LIWAN_EDGE') + _heredoc('/tmp/control-ca.pem', ca, 'LIWAN_CA')
    if upstream_tls:
        script += _heredoc('/tmp/up.crt', upstream_tls[0], 'LIWAN_UPCRT') + _heredoc('/tmp/up.key', upstream_tls[1], 'LIWAN_UPKEY')
    script += ('caddy run --config /tmp/edge.json >/tmp/caddy.log 2>&1 &\npid=$!\ntrap \'kill "$pid" 2>/dev/null || true\' EXIT\n'
               'ready=0\nfor a in $(seq 1 80); do curl -s --max-time 1 --noproxy \'*\' http://127.0.0.1:8080/ -o /dev/null && '
               '{ ready=1; break; }; sleep 0.1; done\n'
               '[ "$ready" = 1 ] || { cat /tmp/caddy.log >&2; exit 1; }\n'
               ': > /tmp/stub.log\n')
    for i, (method, target) in enumerate(targets):
        script += (f"printf 'LIWAN_CASE {i} '\ncurl --silent --max-time 5 --noproxy '*' --path-as-is -X {method} "
                   f"-H {shlex.quote('Host: ' + (request_host or host))} -H 'X-Liwan-Proxy-Token: x' "
                   f"{''.join('-H ' + shlex.quote(h) + ' ' for h in client_headers)}-o /tmp/b -w '%{{http_code}}' "
                   f"--request-target {shlex.quote(target)} http://127.0.0.1:8080/ ; printf ' '; cat /tmp/b; printf '\\n'\n")
    script += ('sleep 0.3\nprintf "LIWAN_HITS %s\\n" "$(grep -c request /tmp/stub.log 2>/dev/null || true)"\n'
               'grep request /tmp/stub.log 2>/dev/null | sed \'s/^/LIWAN_LOG /\' || true\n')
    out = _caddy_container(script).stdout
    results = [line.split(' ', 3)[2:] for line in out.splitlines() if line.startswith('LIWAN_CASE ')]
    hits = int(next(line for line in out.splitlines() if line.startswith('LIWAN_HITS ')).split()[1] or 0)
    records = [json.loads(line[len('LIWAN_LOG '):]) for line in out.splitlines() if line.startswith('LIWAN_LOG ')]
    return results, hits, records


class CaddyBehavior(unittest.TestCase):
    """The adapted production route, with only its dial address replaced, forwards exactly one request shape."""

    def test_only_the_canonical_post_is_forwarded_and_every_path_variant_is_refused_at_the_edge(self) -> None:
        results, hits, _ = _edge_run(HOOK_HOST, [CANONICAL, *REFUSED_TARGETS])
        self.assertEqual(results[0], ['200', f'stub-upstream:POST:{HOOK_PATH}'])
        for target, status_and_body in zip(REFUSED_TARGETS, results[1:]):
            self.assertEqual(status_and_body[0], '404', (target, status_and_body))
            self.assertNotIn('stub-upstream', ' '.join(status_and_body))
        self.assertEqual(hits, 1, 'the upstream received only the canonical request')

    def test_the_reserved_webhook_host_answers_404_to_everything_however_the_variable_arrives(self) -> None:
        """Compose always passes the reserved name when the variable is unset or empty; Caddy gets it set or (bare) unset."""
        for env in ({'CONTROL_WEBHOOK_DOMAIN': RESERVED_HOST}, {'CONTROL_WEBHOOK_DOMAIN': None}):
            adapted = _adapt({'CONTROL_WEBHOOK_DOMAIN': env['CONTROL_WEBHOOK_DOMAIN']})
            _webhook_route(adapted, RESERVED_HOST)
            for request_host in (RESERVED_HOST, 'Control-Webhook.Invalid', RESERVED_HOST + '.'):
                results, hits, _ = _edge_run(RESERVED_HOST, [CANONICAL, ('GET', '/')], env=env, request_host=request_host)
                self.assertEqual(hits, 0, (env, request_host))
                self.assertFalse(any('stub-upstream' in ' '.join(r) for r in results), (env, request_host, results))
                if not request_host.endswith('.'):
                    self.assertEqual([r[0] for r in results], ['404', '404'], (env, request_host, results))
                # A trailing-dot Host matches no site at all (Caddy's host matcher does not strip the dot), so it never
                # reaches this site; the harness keeps one server, where an unmatched request is Caddy's empty 200.

    def test_an_empty_webhook_host_refuses_every_host(self) -> None:
        """Compose never passes an empty value, but handed one directly the site matches every host and must still refuse them."""
        for request_host in ('anything.example.test', RESERVED_HOST):
            results, hits, _ = _edge_run('', [CANONICAL, ('GET', '/')], request_host=request_host)
            self.assertEqual([r[0] for r in results], ['404', '404'], (request_host, results))
            self.assertEqual(hits, 0, request_host)

    def test_the_configured_host_matches_without_regard_to_case(self) -> None:
        results, hits, _ = _edge_run(HOOK_HOST, [CANONICAL], request_host=HOOK_HOST.upper())
        self.assertEqual(results[0][0], '200')
        self.assertEqual(hits, 1)

    def test_every_stripped_header_is_removed_before_the_upstream_sees_it(self) -> None:
        _, hits, records = _edge_run(HOOK_HOST, [CANONICAL], client_headers=tuple(f'{h}: spoofed' for h in STRIPPED_HEADERS))
        self.assertEqual((hits, len(records)), (1, 1))
        received = {name.lower() for name in records[0]['request']['headers']}
        for header in STRIPPED_HEADERS:
            self.assertNotIn(header.lower(), received, header)

    def test_the_rate_limit_zone_is_keyed_on_the_client_ip_and_runs_before_the_proxy(self) -> None:
        route = _webhook_route(_adapt({'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST}), HOOK_HOST)
        handlers = [h['handler'] for r in route['routes'] for h in r['handle']]
        self.assertIn('rate_limit', handlers)
        self.assertLess(handlers.index('rate_limit'), handlers.index('reverse_proxy'))
        limit = next(h for r in route['routes'] for h in r['handle'] if h['handler'] == 'rate_limit')
        self.assertEqual(limit['rate_limits']['liwan_payment_events']['key'], '{http.vars.client_ip}')


class CaddyUpstreamTls(unittest.TestCase):
    """The real transport (TLS, private CA trust pool, SAN control-api) is kept; only the dial address is local."""

    def _post(self, upstream_ca: str) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            trusted, other = _pki(tmp, 'trusted-ca'), _pki(tmp, 'other-ca')
            leaf = _pki(tmp, 'leaf', ca_name=upstream_ca)
            results, hits, _ = _edge_run(HOOK_HOST, [CANONICAL], ca=trusted['crt'].read_text(encoding='utf-8'),
                                      upstream_tls=(leaf['crt'].read_text(encoding='utf-8'), leaf['key'].read_text(encoding='utf-8')))
            return results[0][0] + f':{hits}'

    def test_an_upstream_certificate_from_the_trusted_ca_is_accepted(self) -> None:
        self.assertEqual(self._post('trusted-ca'), '200:1')

    def test_an_upstream_certificate_from_another_ca_is_refused(self) -> None:
        self.assertEqual(self._post('other-ca'), '502:0')


if __name__ == '__main__':
    unittest.main()
