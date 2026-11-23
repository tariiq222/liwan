# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The commercial overlay's edge wiring: the web tier and the proxy trust the control CA, the proxy forwards exactly one
control-plane route (the payment webhook) and serves the vendor console only to an operator allowlist, both through the
Caddyfile that imports the shared snippets.

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
ADMIN_SNIPPET = ROOT / 'deploy' / 'vendor-admin' / 'Caddyfile.snippet'
WEBHOOK_TARGET = '/etc/caddy/commercial/control-webhook.caddy'
ADMIN_TARGET = '/etc/caddy/commercial/vendor-admin.caddy'
COMPOSE_FILES = ('docker-compose.yml', 'docker-compose.shared.yml', 'docker-compose.shared-commercial.yml',
                 'docker-compose.production.yml', 'docker-compose.host-link.yml')
CA_TARGET = '/etc/liwan-control/control-ca.pem'
HOOK_HOST = 'hooks.example.test'
HOOK_PATH = '/v1/commercial/payment-events/moyasar'
ADMIN_HOST = 'admin.example.test'

ENV = {
    'LIWAN_IMAGE_TAG': 'test', 'ODOO_COMMIT': 'dummy', 'LIWAN_SESSION_KEYS': 'dummy', 'LIWAN_SESSION_ACTIVE_KID': 'k1',
    'LIWAN_SHARED_PROXY_TOKEN': 'dummy', 'LIWAN_SHARED_ODOO_CONFIG': '/tmp/dummy-odoo.conf',
    'LIWAN_TENANT_REGISTRY_DIR': '/tmp', 'DB_PASSWORD': 'dummy', 'DB_ADMIN_PASSWORD': 'dummy-admin', 'LIWAN_DOMAIN': 'example.test',
    'LIWAN_EDGE_BIND': '0.0.0.0', 'LIWAN_EDGE_HTTP_PORT': '80', 'LIWAN_EDGE_HTTPS_PORT': '443',
    'LIWAN_PROSPECT_HOST': 'example.test', 'NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN': 'https://example.test',
    'NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL': 'https://control-api:4187', 'CUSTOMER_COMMERCIAL_SERVICE_KEY': 'dummy',
    'CUSTOMER_COMMERCIAL_ISSUER': 'dummy', 'LIWAN_COMMERCIAL_CONTROL_NETWORK': 'liwan-control-test',
    'LIWAN_CONTROL_PRIVATE_DIR': '/srv/control/private',
    'LIWAN_CONTROL_EDGE_NETWORK': 'liwan-control-edge-test', 'LIWAN_ADMIN_EDGE_NETWORK': 'liwan-admin-edge-test',
    # production and host-link overlays
    'LIWAN_ODOO_DB_PORT': '15433',
}


def _clean_environment() -> dict:
    """The shell environment wins over `--env-file`, so drop the variables the env file sets before running compose."""
    return {k: v for k, v in os.environ.items() if not k.startswith(('LIWAN_', 'ODOO_', 'POSTGRES_'))}


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
            env=_clean_environment())
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
        # The edge reaches the control API and the vendor console on networks of its own, never on the web tier's one.
        self.assertEqual(set(proxy['networks']), set(plain['networks']) | {'control_edge', 'admin_edge'})
        self.assertNotIn('commercial_control', proxy['networks'])
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
        """Run `compose create` on a copy of the overlay with one source absent. Compose versions differ in whether `config`
        prints `create_host_path: false`, so only the behavior is asserted: the create fails and no path appears.
        Each case gets a fresh directory: a source deleted after a successful create can stay visible to the Docker file share."""
        image = _caddy_image()
        sources = {'private/control-ca.pem': ('web', 'proxy'), 'control-plane/Caddyfile.snippet': ('proxy',),
                   'vendor-admin/Caddyfile.snippet': ('proxy',)}

        def create(services: tuple[str, ...], absent: str | None) -> tuple[subprocess.CompletedProcess, bool]:
            with tempfile.TemporaryDirectory() as tmp:
                project = Path(tmp)
                for source in sources:
                    if source != absent:
                        (project / source).parent.mkdir(parents=True, exist_ok=True)
                        (project / source).write_text('x\n', encoding='utf-8')
                (project / 'private').mkdir(exist_ok=True)
                shutil.copy(DEPLOY / 'docker-compose.shared-commercial.yml', project)
                (project / 'base.yml').write_text('services:\n' + ''.join(
                    f'  {name}:\n    image: {image}\n    entrypoint: ["true"]\n' for name in ('guard', 'web', 'proxy')), encoding='utf-8')
                # The overlay's external networks are not what is under test; drop them so `create` reaches the mounts.
                (project / 'no-networks.yml').write_text(
                    'services:\n  web:\n    networks: !reset null\n  proxy:\n    networks: !reset null\nnetworks: !reset null\n', encoding='utf-8')
                envfile = project / 'dummy.env'
                envfile.write_text(''.join(f'{k}={v}\n' for k, v in
                                           {**ENV, 'LIWAN_CONTROL_PRIVATE_DIR': str(project / 'private')}.items()), encoding='utf-8')
                files = [a for f in ('base.yml', 'docker-compose.shared-commercial.yml', 'no-networks.yml') for a in ('-f', str(project / f))]
                base = ['compose', '--env-file', str(envfile), '-p', f'liwan-edge-mounts-{os.getpid()}', *files]
                def run(*args: str) -> subprocess.CompletedProcess:
                    return subprocess.run(['docker', *base, *args], capture_output=True, text=True, timeout=120, env=_clean_environment())

                try:
                    result = run('create', *services)
                finally:
                    run('down', '--remove-orphans')
                return result, bool(absent) and (project / absent).exists()

        present, _ = create(('web', 'proxy'), None)
        self.assertEqual(present.returncode, 0, f'every source present must create: {present.stderr}')
        for source, services in sources.items():
            for service in services:
                result, appeared = create((service,), source)
                self.assertNotEqual(result.returncode, 0, f'{service} created with {source} missing')
                self.assertFalse(appeared, f'{service} created a host path at {source}')

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

    def test_the_console_host_is_reserved_and_the_allowlist_empty_until_set(self) -> None:
        environment = render(COMPOSE_FILES)['services']['proxy']['environment']
        self.assertEqual(environment['ADMIN_DOMAIN'], 'vendor-admin.invalid')
        self.assertEqual(environment['LIWAN_ADMIN_ALLOW'], '')
        environment = render(COMPOSE_FILES, {'ADMIN_DOMAIN': ADMIN_HOST, 'LIWAN_ADMIN_ALLOW': '203.0.113.0/24'})['services']['proxy']['environment']
        self.assertEqual((environment['ADMIN_DOMAIN'], environment['LIWAN_ADMIN_ALLOW']), (ADMIN_HOST, '203.0.113.0/24'))

    def test_the_edge_and_the_web_tier_share_no_network_so_the_guard_stays_between_them(self) -> None:
        """The base files give `proxy` only `edge` and `web` only `guard_web`; the guard joins both and is the tenant boundary.
        The overlay adds a network of its own for the control API and one for the console, and none of them is the web tier's."""
        config = render(COMPOSE_FILES)
        services = config['services']
        self.assertEqual(set(services['proxy']['networks']) & set(services['web']['networks']), set())
        self.assertEqual(set(services['proxy']['networks']), {'edge', 'control_edge', 'admin_edge'})
        self.assertEqual(set(services['web']['networks']), {'guard_web', 'commercial_control'})
        self.assertLessEqual({'edge', 'guard_web'}, set(services['guard']['networks']))
        names = {key: config['networks'][key]['name'] for key in ('commercial_control', 'control_edge', 'admin_edge')}
        self.assertEqual(names, {'commercial_control': ENV['LIWAN_COMMERCIAL_CONTROL_NETWORK'],
                                 'control_edge': ENV['LIWAN_CONTROL_EDGE_NETWORK'],
                                 'admin_edge': ENV['LIWAN_ADMIN_EDGE_NETWORK']})
        self.assertEqual(len(set(names.values())), 3)
        for key in names:
            self.assertIs(config['networks'][key].get('external'), True, key)

    def test_the_stack_without_the_overlay_has_no_control_wiring(self) -> None:
        services = render(COMPOSE_FILES[:2] + COMPOSE_FILES[3:])['services']
        self.assertNotIn(CA_TARGET, mounts(services['web']))
        self.assertNotIn(CA_TARGET, mounts(services['proxy']))
        self.assertNotIn('commercial_control', services['proxy']['networks'])
        self.assertNotIn(WEBHOOK_TARGET, mounts(services['proxy']))
        self.assertNotIn(ADMIN_TARGET, mounts(services['proxy']))

    def test_the_snippets_are_mounted_where_the_caddyfile_imports_them(self) -> None:
        proxy = render(COMPOSE_FILES)['services']['proxy']
        self.assertEqual(mounts(proxy)[WEBHOOK_TARGET]['source'], str(SNIPPET))
        self.assertEqual(mounts(proxy)[ADMIN_TARGET]['source'], str(ADMIN_SNIPPET))
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
        for name, source in (('control-webhook.caddy', SNIPPET), ('vendor-admin.caddy', ADMIN_SNIPPET)):
            setup += f"cat > /tmp/commercial/{name} <<'LIWAN_SNIPPET'\n{relocate(source.read_text(encoding='utf-8'))}\nLIWAN_SNIPPET\n"
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

    def test_the_overlay_validates_with_the_hosts_unset_or_set(self) -> None:
        self._validate({}, snippet=True, ca=True)
        self._validate({'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST, 'ADMIN_DOMAIN': ADMIN_HOST}, snippet=True, ca=True)
        self._validate({'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST, 'ADMIN_DOMAIN': ADMIN_HOST, 'LIWAN_ADMIN_ALLOW': '203.0.113.0/24',
                        'LIWAN_SITE_SCHEME': 'http://', 'LIWAN_AUTO_HTTPS': 'off'}, snippet=True, ca=True)

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
              client_headers: tuple[str, ...] = (), domain_var: str = 'CONTROL_WEBHOOK_DOMAIN',
              dial: str = 'control-api:4187', asset_probe: bool = False) -> tuple[list[list[str]], int, list[dict]]:
    """Run the adapted site (the webhook by default; `domain_var` and `dial` pick another snippet's) in the pinned Caddy with its upstream replaced by a logging stub on loopback.

    Only the dial address changes: the transport (TLS, trust pool, server name) is kept as the snippet declares it. The stub
    speaks HTTPS with `upstream_tls` (certificate and key text) or plain HTTP without it. Returns one [status, body] per target
    the number of requests the stub received and its access-log records (each with the request headers it got).
    `request_host` is the Host header sent (default `host`); `client_headers` are extra headers the client sends.
    """
    env = {domain_var: host, **(env or {})}
    ca = ca or _test_ca()
    adapted = _adapt(env)
    server = next(s for s in adapted['apps']['http']['servers'].values() if host in json.dumps(s))
    adapted['apps']['http']['servers'] = {'edge': server}
    server['listen'] = ['127.0.0.1:8080']
    upstreams = []

    def redirect(value):
        if isinstance(value, dict):
            if value.get('handler') == 'reverse_proxy' and any(u.get('dial') == dial for u in value['upstreams']):
                if upstream_tls is None:
                    value.pop('transport', None)
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
        raise AssertionError(f'exactly one route reaches {dial}')
    stub_body = 'stub-upstream:{http.request.method}:{http.request.uri}'
    # An upstream value of its own, so a test can prove the edge replaces it rather than passing it through.
    upstream_cache = {'Cache-Control': ['public, max-age=60']} if asset_probe else {}
    stub = {'listen': ['127.0.0.1:8081'], 'logs': {}, 'routes': [{'handle': [
        {'handler': 'static_response', 'body': stub_body, 'headers': upstream_cache}]}]}
    if asset_probe:
        # A revalidation answer and a missing file from the upstream, so the edge's treatment of both is observable.
        stub['routes'][:0] = [
            {'match': [{'query': {'revalidate': ['1']}}], 'handle': [
                {'handler': 'static_response', 'status_code': 304, 'headers': upstream_cache}]},
            {'match': [{'path': ['/_nuxt/gone-*']}], 'handle': [
                {'handler': 'static_response', 'status_code': 404, 'headers': upstream_cache}]},
        ]
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
        # `asset_probe` also keeps the response headers of each case (lowercased name, one line per value).
        dump = "-D /tmp/h" if asset_probe else ''
        script += (f"printf 'LIWAN_CASE {i} '\ncurl --silent --max-time 5 --noproxy '*' --path-as-is {dump} -X {method} "
                   f"-H {shlex.quote('Host: ' + (request_host or host))} -H 'X-Liwan-Proxy-Token: x' "
                   f"{''.join('-H ' + shlex.quote(h) + ' ' for h in client_headers)}-o /tmp/b -w '%{{http_code}}' "
                   f"--request-target {shlex.quote(target)} http://127.0.0.1:8080/ ; printf ' '; cat /tmp/b; printf '\\n'\n")
        if asset_probe:
            script += (f"printf 'LIWAN_HEADERS {i} '\n"
                       "sed -e '1d' -e '/^\\r*$/d' /tmp/h | tr -d '\\r' | tr 'A-Z' 'a-z' | "
                       "grep '^cache-control:' | cut -d' ' -f2- | paste -sd'|' -; printf '\\n'\n")
    script += ('sleep 0.3\nprintf "LIWAN_HITS %s\\n" "$(grep -c request /tmp/stub.log 2>/dev/null || true)"\n'
               'grep request /tmp/stub.log 2>/dev/null | sed \'s/^/LIWAN_LOG /\' || true\n')
    out = _caddy_container(script).stdout
    results = [line.split(' ', 3)[2:] for line in out.splitlines() if line.startswith('LIWAN_CASE ')]
    hits = int(next(line for line in out.splitlines() if line.startswith('LIWAN_HITS ')).split()[1] or 0)
    records = [json.loads(line[len('LIWAN_LOG '):]) for line in out.splitlines() if line.startswith('LIWAN_LOG ')]
    if asset_probe:
        headers = [line.split(' ', 2)[2] if len(line.split(' ', 2)) > 2 else ''
                   for line in out.splitlines() if line.startswith('LIWAN_HEADERS ')]
        return results, hits, records, headers
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


ADMIN_DIAL = 'vendor-console:3100'
ADMIN_RESERVED = 'vendor-admin.invalid'
LOOPBACK = '127.0.0.1/32'  # the address the harness's own curl connects from
OUTSIDE = '203.0.113.9'


def _admin_run(targets=(('GET', '/'),), *, allow: str | None = LOOPBACK, host: str = ADMIN_HOST, trusted: str | None = None,
               request_host: str = '', client_headers: tuple[str, ...] = (), domain: str | None = None,
               asset_probe: bool = False):
    """The adapted vendor console site with its upstream replaced by the logging stub. `allow` and `trusted` are the values of
    LIWAN_ADMIN_ALLOW and LIWAN_TRUSTED_PROXIES (None leaves the variable unset). `asset_probe` adds the response's
    Cache-Control values (one line per header) as a fourth return value."""
    env = {'LIWAN_ADMIN_ALLOW': allow, 'LIWAN_TRUSTED_PROXIES': trusted, 'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST}
    return _edge_run(host if domain is None else domain, targets, env=env, request_host=request_host,
                     client_headers=client_headers, domain_var='ADMIN_DOMAIN', dial=ADMIN_DIAL,
                     asset_probe=asset_probe)


class CaddyAdminBehavior(unittest.TestCase):
    """The vendor console is served on its own host, to the operator allowlist only, before anything reaches the upstream."""

    def test_an_allowed_address_reaches_the_console_and_the_console_receives_that_address(self) -> None:
        results, hits, records = _admin_run()
        self.assertEqual(results[0][0], '200')
        self.assertEqual(hits, 1)
        self.assertEqual(records[0]['request']['headers']['X-Forwarded-For'], ['127.0.0.1'])

    def test_an_address_outside_the_allowlist_gets_404_and_never_reaches_the_console(self) -> None:
        results, hits, _ = _admin_run(allow='203.0.113.0/24 198.51.100.7')
        self.assertEqual([r[0] for r in results], ['404'])
        self.assertEqual(hits, 0)

    def test_an_empty_or_unset_allowlist_closes_the_console_even_to_loopback(self) -> None:
        for allow in ('', None):
            results, hits, _ = _admin_run(allow=allow)
            self.assertEqual([r[0] for r in results], ['404'], allow)
            self.assertEqual(hits, 0, allow)

    def test_a_forwarded_header_from_an_untrusted_peer_cannot_claim_an_allowed_address(self) -> None:
        """No trusted proxy (the default): the client is the socket peer, so naming the operator in X-Forwarded-For is no key."""
        for header in (f'X-Forwarded-For: {OUTSIDE}', f'Forwarded: for={OUTSIDE}', f'X-Real-Ip: {OUTSIDE}'):
            results, hits, _ = _admin_run(allow=f'{OUTSIDE}/32', client_headers=(header,))
            self.assertEqual([r[0] for r in results], ['404'], header)
            self.assertEqual(hits, 0, header)

    def test_behind_a_trusted_outer_edge_the_forwarded_client_is_matched_and_passed_on(self) -> None:
        """The outer edge (a trusted peer) names the real client: only an allowed one passes, and the console receives it."""
        results, hits, records = _admin_run(allow=f'{OUTSIDE}/32', trusted=LOOPBACK, client_headers=(f'X-Forwarded-For: {OUTSIDE}',))
        self.assertEqual((results[0][0], hits), ('200', 1))
        self.assertEqual(records[0]['request']['headers']['X-Forwarded-For'], [OUTSIDE])
        results, hits, _ = _admin_run(allow=f'{OUTSIDE}/32', trusted=LOOPBACK, client_headers=('X-Forwarded-For: 198.51.100.7',))
        self.assertEqual(([r[0] for r in results], hits), (['404'], 0))
        # A client that prepends the allowed address to what the outer edge appends is still the address the edge saw.
        results, hits, _ = _admin_run(allow=f'{OUTSIDE}/32', trusted=LOOPBACK,
                                      client_headers=(f'X-Forwarded-For: {OUTSIDE}, 198.51.100.7',))
        self.assertEqual(([r[0] for r in results], hits), (['404'], 0))

    def test_the_peer_the_outer_edge_connects_from_passes_only_when_it_forwards_no_client(self) -> None:
        """An `ssh -L` tunnel to a port the proxy publishes on loopback arrives from the edge network's gateway, the address
        LIWAN_TRUSTED_PROXIES names. With that peer in the allowlist a request that names no client (the tunnel) is the peer
        itself and passes, while a request the outer edge forwards for a real client is matched on that client and does not."""
        results, hits, records = _admin_run(allow=LOOPBACK, trusted=LOOPBACK)
        self.assertEqual((results[0][0], hits), ('200', 1))
        self.assertEqual(records[0]['request']['headers']['X-Forwarded-For'], ['127.0.0.1'])
        results, hits, _ = _admin_run(allow=LOOPBACK, trusted=LOOPBACK, client_headers=(f'X-Forwarded-For: {OUTSIDE}',))
        self.assertEqual(([r[0] for r in results], hits), (['404'], 0))

    def test_a_host_other_than_the_configured_one_never_reaches_the_console_and_the_configured_one_ignores_case(self) -> None:
        # A Host that names no site is Caddy's empty 200 in this one-server harness (see the webhook test); it must not reach the stub.
        for request_host in ('other.example.test', ADMIN_RESERVED, ADMIN_HOST + '.evil.test'):
            results, hits, _ = _admin_run(request_host=request_host)
            self.assertEqual(hits, 0, request_host)
            self.assertNotIn('stub-upstream', ' '.join(results[0]), request_host)
        results, hits, _ = _admin_run(request_host=ADMIN_HOST.upper())
        self.assertEqual((results[0][0], hits), ('200', 1))

    def test_an_unset_console_host_serves_no_real_host_even_to_an_allowed_address(self) -> None:
        """Compose passes the reserved name when the variable is unset; bare Caddy gets it unset. Both refuse, as do real hosts."""
        for env_domain in (ADMIN_RESERVED, None):
            for request_host in (ADMIN_RESERVED, 'Vendor-Admin.Invalid', ADMIN_HOST):
                results, hits, _ = _edge_run(
                    ADMIN_RESERVED, [('GET', '/')], env={'ADMIN_DOMAIN': env_domain, 'LIWAN_ADMIN_ALLOW': LOOPBACK,
                                                         'CONTROL_WEBHOOK_DOMAIN': HOOK_HOST},
                    request_host=request_host, domain_var='ADMIN_DOMAIN', dial=ADMIN_DIAL)
                self.assertEqual(hits, 0, (env_domain, request_host))
                self.assertNotIn('stub-upstream', ' '.join(results[0]), (env_domain, request_host))
                if request_host != ADMIN_HOST:
                    self.assertEqual(results[0][0], '404', (env_domain, request_host))

    def test_an_empty_console_host_refuses_every_host(self) -> None:
        for request_host in ('anything.example.test', ADMIN_RESERVED):
            results, hits, _ = _admin_run(domain='', request_host=request_host)
            self.assertEqual(([r[0] for r in results], hits), (['404'], 0), request_host)

    def test_the_console_receives_the_client_address_and_none_of_the_stripped_headers(self) -> None:
        headers = tuple(f'{h}: spoofed' for h in STRIPPED_HEADERS if h != 'X-Forwarded-For')
        _, hits, records = _admin_run(client_headers=(*headers, 'X-Forwarded-For: spoofed'))
        self.assertEqual(hits, 1)
        received = {name.lower(): value for name, value in records[0]['request']['headers'].items()}
        for header in STRIPPED_HEADERS:
            if header != 'X-Forwarded-For':
                self.assertNotIn(header.lower(), received, header)
        self.assertEqual(received['x-forwarded-for'], ['127.0.0.1'])

    def test_the_host_and_the_allowlist_are_decided_in_order_before_the_limits_and_the_proxy(self) -> None:
        adapted = _adapt({'ADMIN_DOMAIN': ADMIN_HOST, 'LIWAN_ADMIN_ALLOW': LOOPBACK})
        (site,) = [r for s in adapted['apps']['http']['servers'].values() for r in s['routes']
                   if any(m.get('host') == [ADMIN_HOST] for m in r.get('match', []))]
        routes = site['handle'][0]['routes']
        refuse_host, refuse_client, allowed = routes[-3:]
        for refusal in (refuse_host, refuse_client):
            self.assertEqual(refusal['handle'][0]['routes'][0]['handle'][0]['status_code'], 404)
        self.assertIn('expression', refuse_host['match'][0])
        self.assertIn('client_ip', json.dumps(refuse_client['match']))
        self.assertNotIn('match', allowed)
        inner = allowed['handle'][0]['routes'][0]['handle']
        self.assertEqual([h['handler'] for h in inner], ['rate_limit', 'reverse_proxy'])
        self.assertEqual({zone['key'] for zone in inner[0]['rate_limits'].values()}, {'{http.vars.client_ip}'})

    def test_only_the_hashed_build_assets_are_stored(self) -> None:
        """Behavioral: the real edge decides every case, with an upstream that sends its own Cache-Control.

        A hashed asset and a revalidation answer are stored for a year; the document, the API and Nuxt's build metadata
        keep `no-store`, and the edge replaces the upstream's value instead of passing it through. This is what a text
        assertion cannot prove: the matcher, the exclusion and the deferred replacement have to compose.
        """
        results, _, _, headers = _admin_run(
            [('GET', '/_nuxt/app-abc123.js'), ('GET', '/_nuxt/app-abc123.js?revalidate=1'),
             ('GET', '/login'), ('GET', '/api/v1/me'), ('GET', '/_nuxt/builds/latest.json'),
             ('GET', '/_nuxt/gone-abc123.js')],
            asset_probe=True)
        stored = 'private, max-age=31536000, immutable'
        self.assertEqual(results[0][0], '200')
        self.assertEqual(headers[0], stored, 'a hashed asset is stored, and with one header only')
        # A revalidation answer must not be blanked out with `no-store`: that would discard the copy it proved valid.
        self.assertEqual(results[1][0], '304', results[1])
        self.assertEqual(headers[1], stored, 'the 304 keeps the caching value')
        for index in (2, 3, 4):
            self.assertEqual(results[index][0], '200', results[index])
            self.assertEqual(headers[index], 'no-store', f'case {index} must not be stored')
        # A chunk missing after a release must not be kept for a year as immutable.
        self.assertEqual(results[5][0], '404', results[5])
        self.assertEqual(headers[5], 'no-store', 'a missing asset is never stored')


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
