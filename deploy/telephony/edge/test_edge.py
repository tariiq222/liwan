# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The shared telephony edge renderer: what it routes, what it refuses, and what it must never print.

The rendered snippet is also handed to the real Caddy in the pinned proxy image (as the other edge tests do), so the
two forwards, the 404 of every other path and the identical 404 of an unknown host are checked by Caddy itself, not
only by reading the text.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import shlex
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from deploy.telephony.edge import render_edge

ROOT = Path(__file__).resolve().parents[3]
SHARED_CADDYFILE = ROOT / 'deploy' / 'stack' / 'Caddyfile'
DOCKERFILE = ROOT / 'deploy' / 'proxy' / 'Dockerfile'
CADDY_IMAGE = 'caddy:2'
PROBE_PORT = 18290
COMPANY_HOST = 'acme.example.test'
OTHER_HOST = 'globex.example.test'
APEX_HOST = 'example.test'
DOMAIN = f'http://{APEX_HOST}, http://*.{APEX_HOST}'

SNAPSHOT = {
    'companies': {
        COMPANY_HOST: {'asterisk': '10.0.3.11:8088', 'agent': '10.0.3.11:8601'},
        OTHER_HOST: {'asterisk': '10.0.3.12:8088', 'agent': '10.0.3.12:8601'},
    },
}


def _write(path: Path, value: object) -> Path:
    path.write_text(json.dumps(value), encoding='utf-8')
    return path


def _docker(arguments: list[str], **kwargs) -> subprocess.CompletedProcess:
    options = {'capture_output': True, 'text': True, 'timeout': 600}
    options.update(kwargs)
    return subprocess.run(['docker', *arguments], check=False, **options)


def _caddy_image() -> str:
    """The proxy image by its Dockerfile digest, built once when absent (the rule of deploy/test_edge_rate_limit.py).

    The image is `deploy/proxy/Dockerfile`'s, not the stock one, because the shared Caddyfile the snippet is imported
    into uses the rate-limit module; the stock image cannot adapt it.
    """
    recipe = DOCKERFILE.read_text(encoding='utf-8')
    reads_context = 'deploy/proxy/Dockerfile reads its build context; hash those inputs too'
    if re.search(r'^\s*(ADD|COPY)(?!\s+--from=)', recipe, re.MULTILINE | re.IGNORECASE):
        raise AssertionError(reads_context)
    image = f'liwan-caddy-test:{hashlib.sha256(recipe.encode()).hexdigest()[:16]}'
    if _docker(['image', 'inspect', image], timeout=30).returncode:
        built = _docker(['build', '-t', image, '-'], stdin=recipe, timeout=1800)
        if built.returncode:
            raise unittest.SkipTest(f'cannot build the proxy image: {built.stderr.strip()[:300]}')
    return image


def _tenant_site() -> str:
    """The tenant site block of the shared Caddyfile, verbatim, so the probe exercises the lines that ship."""
    text = SHARED_CADDYFILE.read_text(encoding='utf-8')
    start = text.index('{$DOMAIN} {')
    end = text.index('\n}\n', start) + len('\n}\n')
    return text[start:end]


def _maintenance_page() -> str:
    """The shared `(maintenance_page)` snippet, verbatim: its stand-in would turn a forwarded 502 into a 503."""
    text = SHARED_CADDYFILE.read_text(encoding='utf-8')
    start = text.index('(maintenance_page) {')
    end = text.index('\n}\n', start) + len('\n}\n')
    return text[start:end]


def _probe(snippet: str, cases: list[tuple[str, str, str, int]]) -> list[int]:
    """Serve the shared Caddyfile with this snippet imported, and request each (host, method, path, expected) on loopback.

    The expected status is the caller's to compare; the probe returns only what the request answered, in case order.

    The site is the one that ships: `_tenant_site()` copies the tenant block from `deploy/stack/Caddyfile` itself, so
    the deny route under test is the deployed text, not a paraphrase. Only `guarded_site` is a stand-in, because it
    needs the guard container; it answers a plain 200, so the probe shows whether a request reached liwan or was
    decided by the telephony route first. `maintenance_page` is the shared block verbatim, so a forwarded upstream
    failure keeps Caddy's own 502 instead of becoming the maintenance 503. `http_port` moves the site onto
    `PROBE_PORT` on container loopback. Everything runs inside the one container (`--network none`), as the other edge
    tests do, so no host port is taken.
    """
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        (directory / 'etc' / 'caddy' / 'telephony').mkdir(parents=True)
        (directory / 'etc' / 'caddy' / 'telephony' / 'telephony.caddy').write_text(snippet, encoding='utf-8')
        (directory / 'Caddyfile').write_text(
            f'{{\n\tauto_https off\n\tadmin off\n\thttp_port {PROBE_PORT}\n}}\n'
            '(guarded_site) {\n\troute {\n\t\trespond "liwan" 200\n\t}\n}\n'
            + _maintenance_page() + _tenant_site(), encoding='utf-8')
        script = (
            'set -eu\n'
            f'export DOMAIN={shlex.quote(DOMAIN)}\n'
            'caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/caddy.log 2>&1 &\n'
            'pid=$!\n'
            "trap 'kill \"$pid\" 2>/dev/null || true' EXIT\n"
            'ready=0\n'
            'for attempt in $(seq 1 100); do\n'
            f'  if curl -s --max-time 1 --noproxy "*" -o /dev/null -H {shlex.quote("Host: " + APEX_HOST)} '
            f'http://127.0.0.1:{PROBE_PORT}/; then ready=1; break; fi\n'
            '  sleep 0.1\n'
            'done\n'
            '[ "$ready" = 1 ] || { cat /tmp/caddy.log >&2; exit 1; }\n'
        )
        for host, method, path, _ in cases:
            script += (f'printf \'%s\\n\' "$(curl -s --path-as-is --max-time 5 --noproxy "*" '
                       f'-o /dev/null -w "%{{http_code}}" -X {shlex.quote(method)} '
                       f'-H {shlex.quote("Host: " + host)} '
                       f'{shlex.quote(f"http://127.0.0.1:{PROBE_PORT}{path}")})"\n')
        result = _docker(['run', '--rm', '--network', 'none',
                          '-v', f'{directory / "Caddyfile"}:/etc/caddy/Caddyfile:ro',
                          '-v', f'{directory / "etc" / "caddy" / "telephony"}:/etc/caddy/telephony:ro', _caddy_image(),
                          'sh', '-c', script], timeout=600)
        if result.returncode:
            raise AssertionError(f'probe failed: {(result.stdout + result.stderr).strip()[:600]}')
        answers = []
        for line in result.stdout.splitlines():
            if line.isdigit():
                answers.append(int(line))
        if len(answers) != len(cases):
            raise AssertionError(f'probe answered {len(answers)} of {len(cases)} cases: {result.stdout[:400]}')
        return answers


def _rendered(snapshot: object | None = SNAPSHOT) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / render_edge.SNAPSHOT_NAME
        if snapshot is not None:
            _write(path, snapshot)
        return render_edge.render(path)


def _rules(text: str) -> str:
    """The snippet without its comment lines: what Caddy reads, as opposed to what the header explains."""
    return '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#'))


class TestRender(unittest.TestCase):
    """A valid snapshot renders both routes, one host at a time."""

    def test_a_company_host_gets_its_own_asterisk_and_agent(self):
        rules = _rules(_rendered())
        self.assertIn('\t\thost acme.example.test\n\t\tpath /ws', rules)
        self.assertIn('reverse_proxy @telephony_websocket_0 10.0.3.11:8088', rules)
        self.assertIn('\t\thost acme.example.test\n\t\tmethod GET\n'
                      '\t\tpath_regexp telephony_recording_token_0 ^/pbx/recordings/[A-Za-z0-9_.-]+$', rules)
        self.assertIn('reverse_proxy @telephony_recording_0 10.0.3.11:8601', rules)
        # The other company's host is routed to its own package, never to acme's.
        self.assertIn('reverse_proxy @telephony_websocket_1 10.0.3.12:8088', rules)

    def test_the_web_socket_carries_the_real_client_address(self):
        # Asterisk keys failed SIP registrations by impersonation and address together (design 11.3).
        self.assertIn('header_up X-Forwarded-For {client_ip}', _rules(_rendered()))

    def test_the_private_edge_headers_never_cross_to_a_pbx_host(self):
        text = _rules(_rendered())
        self.assertEqual(len(re.findall(r'header_up -X-Liwan-Proxy-Token', text)), 2 * len(SNAPSHOT['companies']))

    def test_a_recording_token_is_one_path_segment(self):
        # The agent's own route takes one segment; a longer or empty one is not its route, so the edge must not send it.
        for pattern in re.findall(r'path_regexp \S+ (\S+)', _rules(_rendered())):
            self.assertTrue(pattern.endswith('/[A-Za-z0-9_.-]+$'), pattern)
            self.assertNotIn('(?:', pattern)

    def test_an_unknown_host_is_absent(self):
        text = _rules(_rendered())
        self.assertNotIn('nobody.example.test', text)
        self.assertNotIn('unknown.example.test', text)

    def test_the_ari_path_is_never_forwarded(self):
        text = _rules(_rendered())
        self.assertNotIn('/ari', text)
        self.assertEqual(sorted(re.findall(r'^\t\tpath (/\S+)$', text, re.MULTILINE)),
                         ['/ws'] * len(SNAPSHOT['companies']))

    def test_rendering_twice_gives_the_same_bytes(self):
        self.assertEqual(_rendered().encode(), _rendered().encode())

    def test_hosts_render_in_sorted_order_whatever_the_snapshot_order(self):
        forward = _rendered({'companies': {'b.example.test': SNAPSHOT['companies'][COMPANY_HOST],
                                           'a.example.test': SNAPSHOT['companies'][OTHER_HOST]}})
        reverse = _rendered({'companies': {'a.example.test': SNAPSHOT['companies'][OTHER_HOST],
                                           'b.example.test': SNAPSHOT['companies'][COMPANY_HOST]}})
        self.assertEqual(forward, reverse)
        self.assertLess(forward.index('# a.example.test'), forward.index('# b.example.test'))

    def test_an_empty_snapshot_renders_a_route_that_forwards_nothing(self):
        # Valid and idempotent: the shared edge still validates, and every company host answers the Caddyfile's 404.
        text = _rendered({'companies': {}})
        self.assertIn('route {', text)
        self.assertNotIn('reverse_proxy', text)

    def test_nothing_prints_a_value(self):
        # A refusal names the host and the field, and never the upstream it refused.
        buffer = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp:
            path = _write(Path(tmp) / render_edge.SNAPSHOT_NAME,
                          {'companies': {COMPANY_HOST: {'asterisk': '10.0.3.11:99999', 'agent': '10.0.3.11:8601'}}})
            out = Path(tmp) / 'telephony.caddy'
            with redirect_stderr(buffer):
                self.assertEqual(render_edge.main(['--snapshot', str(path), '--out', str(out)]), 1)
            self.assertFalse(out.exists())
        self.assertNotIn('10.0.3.11', buffer.getvalue())
        self.assertIn(COMPANY_HOST, buffer.getvalue())


class TestRefusals(unittest.TestCase):
    """An invalid snapshot is refused and the last good snippet is left in place."""

    def _refused(self, snapshot: object) -> None:
        with self.assertRaises(render_edge.SnapshotError):
            _rendered(snapshot)

    def test_a_malformed_snapshot_is_refused(self):
        for snapshot in ({'companies': 'nope'}, {'companies': []}, {}, {'sites': {}},
                         {'companies': {COMPANY_HOST: {'asterisk': '10.0.3.11:8088'}}},
                         {'companies': {COMPANY_HOST: {'asterisk': '10.0.3.11:8088', 'agent': 'x', 'extra': 1}}}):
            with self.subTest(snapshot=snapshot):
                self._refused(snapshot)

    def test_an_upstream_that_is_not_host_and_port_is_refused(self):
        for upstream in ('10.0.3.11', '10.0.3.11:', 'acme:0', 'acme:65536', 'acme:80/../x', 'ACME.test:8088',
                         'acme test:8088', 'acme.test:8o88', ' acme.test:8088'):
            with self.subTest(upstream=upstream):
                self._refused({'companies': {COMPANY_HOST: {'asterisk': upstream, 'agent': '10.0.3.11:8601'}}})

    def test_a_host_that_is_not_a_lowercase_name_is_refused(self):
        for host in ('Acme.example.test', 'acme', '-acme.example.test', 'acme..example.test', ''):
            with self.subTest(host=host):
                self._refused({'companies': {
                    host: {'asterisk': '10.0.3.11:8088', 'agent': '10.0.3.11:8601'}}})

    def test_a_repeated_key_is_refused(self):
        # json keeps the last silently, which would drop a company's route without a word.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / render_edge.SNAPSHOT_NAME
            path.write_text('{"companies": {"a.example.test": {"asterisk": "1.1.1.1:1", "agent": "1.1.1.1:2"},'
                            ' "a.example.test": {"asterisk": "1.1.1.1:3", "agent": "1.1.1.1:4"}}}', encoding='utf-8')
            with self.assertRaises(render_edge.SnapshotError):
                render_edge.render(path)

    def test_a_missing_snapshot_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(render_edge.SnapshotError):
                render_edge.render(Path(tmp) / render_edge.SNAPSHOT_NAME)

    def test_an_interrupted_publication_is_refused(self):
        # The barrier of apps/web/server/utils/tenantRegistry.ts: the marker means the snapshot is being replaced.
        with tempfile.TemporaryDirectory() as tmp:
            path = _write(Path(tmp) / render_edge.SNAPSHOT_NAME, SNAPSHOT)
            Path(str(path) + render_edge.PENDING_SUFFIX).write_text('', encoding='utf-8')
            with self.assertRaises(render_edge.SnapshotError):
                render_edge.render(path)

    def test_a_refused_run_leaves_the_last_good_snippet_in_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'telephony.caddy'
            good = _write(Path(tmp) / 'good.json', SNAPSHOT)
            self.assertEqual(render_edge.main(['--snapshot', str(good), '--out', str(out)]), 0)
            before = out.read_bytes()
            bad = _write(Path(tmp) / 'bad.json', {'companies': {'nope': {}}})
            with redirect_stderr(io.StringIO()):
                self.assertEqual(render_edge.main(['--snapshot', str(bad), '--out', str(out)]), 1)
            self.assertEqual(out.read_bytes(), before)

    def test_usage_is_refused_without_a_path(self):
        with redirect_stderr(io.StringIO()):
            self.assertEqual(render_edge.main([]), render_edge.EXIT_USAGE)
            self.assertEqual(render_edge.main(['--snapshot', 'x']), render_edge.EXIT_USAGE)


class TestWiring(unittest.TestCase):
    """The shared Caddyfile imports the snippet once, in the existing style, inside the tenant site."""

    def test_the_caddyfile_imports_the_telephony_glob(self):
        text = SHARED_CADDYFILE.read_text(encoding='utf-8')
        self.assertEqual(text.count('import /etc/caddy/telephony/*.caddy'), 1)

    def test_the_import_sits_inside_the_tenant_site_above_the_guard(self):
        # A site of its own for a company host would shadow the tenant site (Caddy's host route is terminal), and the
        # employee's liwan would stop being served from that host (design 12.8 decision 2).
        text = SHARED_CADDYFILE.read_text(encoding='utf-8')
        site = text[text.index('{$DOMAIN} {'):]
        site = site[:site.index('\n}\n')]
        self.assertIn('import /etc/caddy/telephony/*.caddy', site)
        self.assertLess(site.index('import /etc/caddy/telephony/*.caddy'), site.index('import guarded_site'))

    def test_the_caddyfile_routes_no_path_into_the_telephony_namespace(self):
        # Comments explain `/ari`; no route may forward it. A directive line is what Caddy reads.
        directives = [line for line in _rules(SHARED_CADDYFILE.read_text(encoding='utf-8')).splitlines()
                      if 'reverse_proxy' in line or 'handle ' in line]
        self.assertEqual([line for line in directives if '/ari' in line], [])


@unittest.skipIf(subprocess.run(['which', 'docker'], capture_output=True, check=False).returncode,
                 'docker CLI not installed')
class TestCaddy(unittest.TestCase):
    """Caddy itself decides the routing: two forwards, everything else 404, and the same 404 for an unknown host."""

    CASES = [
        (COMPANY_HOST, 'GET', '/ws', 502),
        (COMPANY_HOST, 'GET', '/ari', 404),
        (COMPANY_HOST, 'GET', '/ari/applications', 404),
        (COMPANY_HOST, 'GET', '/ARI', 404),
        (COMPANY_HOST, 'GET', '/%61ri', 404),
        (COMPANY_HOST, 'GET', '/pbx/recordings/token.abc', 502),
        (COMPANY_HOST, 'POST', '/pbx/recordings/token.abc', 404),
        (COMPANY_HOST, 'GET', '/pbx/recordings/token.abc/wav', 404),
        (COMPANY_HOST, 'GET', '/pbx/health', 404),
        (COMPANY_HOST, 'GET', '/pbx', 404),
        (COMPANY_HOST, 'GET', '/ws/x', 404),
        (COMPANY_HOST, 'GET', '/ws%00', 404),
        (COMPANY_HOST, 'GET', '/websocket', 200),
        (COMPANY_HOST, 'GET', '/api/v1/me', 200),
    ]
    UNKNOWN = [(OTHER_HOST, 'GET', '/ws', 404),
               (OTHER_HOST, 'GET', '/ari', 404),
               (OTHER_HOST, 'GET', '/pbx/recordings/token.abc', 404)]

    def test_the_two_paths_forward_and_every_other_path_answers_404(self):
        # The upstream is a reserved TEST-NET address: a forwarded request answers Caddy's own 502, which is the proof
        # the request was handed to that company's package and not answered locally.
        answers = _probe(_rendered({'companies': {COMPANY_HOST: SNAPSHOT['companies'][COMPANY_HOST]}}), self.CASES)
        for (host, method, path, expected), status in zip(self.CASES, answers):
            with self.subTest(case=f'{host} {method} {path}'):
                self.assertEqual(status, expected)

    def test_an_unknown_host_answers_the_same_404_as_the_absent_path(self):
        answers = _probe(_rendered({'companies': {COMPANY_HOST: SNAPSHOT['companies'][COMPANY_HOST]}}), self.UNKNOWN)
        for (host, method, path, expected), status in zip(self.UNKNOWN, answers):
            with self.subTest(case=f'{host} {method} {path}'):
                self.assertEqual(status, expected)
        # And it is the same 404 the Caddyfile gives an absent snapshot: no upstream and no local answer differ.
        absent = _probe('', self.UNKNOWN)
        self.assertEqual(absent, [expected for *_, expected in self.UNKNOWN])


if __name__ == '__main__':
    unittest.main()
