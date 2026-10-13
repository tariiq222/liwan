# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Behavioral dedicated-edge regressions using real Caddy and two socket peers.

Runs entirely inside a disposable container, with no published host ports.
The echo backends expose only the headers received after reverse_proxy.
"""
import json
import shlex
import unittest

from test_edge_rate_limit import CADDYFILE, _adapt_shared_caddyfile, _caddy_container


def edge_requests(cases):
    config = _adapt_shared_caddyfile(CADDYFILE.read_text().replace('{$DOMAIN}', 'http://127.0.0.1:8080'))
    config['admin'] = {'disabled': True}

    def redirect_upstreams(value):
        if isinstance(value, dict):
            if value.get('dial') in ('web:3000', 'odoo:8069', 'odoo:8072'):
                value['dial'] = '127.0.0.1:8081'
            for child in value.values():
                redirect_upstreams(child)
        elif isinstance(value, list):
            for child in value:
                redirect_upstreams(child)

    redirect_upstreams(config)
    config['apps']['http']['servers']['echo'] = {
        'listen': ['127.0.0.1:8081'],
        'routes': [{'handle': [{'handler': 'static_response', 'body': json.dumps({
            'ip': '{http.request.header.X-Nasq-Client-IP}',
            'host': '{http.request.header.X-Nasq-Client-Host}',
            'proto': '{http.request.header.X-Nasq-Client-Proto}',
            'xff': '{http.request.header.X-Forwarded-For}',
        })}]}],
    }
    script = (
        "set -eu\ncat > /tmp/edge.json <<'NASQ_AUTH_EDGE'\n" + json.dumps(config)
        + "\nNASQ_AUTH_EDGE\ncaddy run --config /tmp/edge.json >/tmp/caddy.log 2>&1 &\n"
        + "pid=$!\ntrap 'kill \"$pid\" 2>/dev/null || true' EXIT\n"
        + "ready=0\nfor attempt in $(seq 1 50); do\n"
        + " if curl -sf --max-time 1 http://127.0.0.1:8081/ >/dev/null; then ready=1; break; fi\n"
        + " sleep 0.1\ndone\n[ \"$ready\" = 1 ] || { cat /tmp/caddy.log >&2; exit 1; }\n"
    )
    for i, case in enumerate(cases):
        script += f"printf 'NASQ_AUTH_CASE {i}\\n'\n"
        script += 'curl --silent --show-error --max-time 3 --noproxy "*" --path-as-is '
        script += '--interface ' + shlex.quote(case.get('peer', '127.0.0.2'))
        script += ' --request-target ' + shlex.quote(case['path'])
        for name, value in case.get('headers', {}).items():
            script += ' -H ' + shlex.quote(f'{name}: {value}')
        script += ' -o /tmp/body -w "%{http_code}\\n" http://127.0.0.1:8080/\ncat /tmp/body\nprintf "\\n"\n'
    records = _caddy_container(script).stdout.split('NASQ_AUTH_CASE ')[1:]
    if len(records) != len(cases):
        raise AssertionError('missing real edge response')
    results = []
    for i, record in enumerate(records):
        index, status, body = record.split('\n', 2)
        if index != str(i):
            raise AssertionError('edge response ordering mismatch')
        results.append((int(status), json.loads(body) if status == '200' else None))
    return results


class TestDedicatedAuthEdge(unittest.TestCase):
    def test_edge_overwrites_spoofed_identity_after_connection_stripping(self):
        rows = edge_requests([
            {'path': '/api/auth/login', 'peer': ip, 'headers': {
                'X-Forwarded-For': '198.51.100.99', 'Forwarded': 'for=198.51.100.98',
                'X-Nasq-Client-IP': '192.0.2.99', 'X-Nasq-Client-Host': 'evil.example.test',
                'X-Nasq-Client-Proto': 'ftp',
                'Connection': 'X-Nasq-Client-IP, X-Nasq-Client-Host, X-Nasq-Client-Proto',
            }} for ip in ('127.0.0.2', '127.0.0.3')
        ])
        self.assertEqual(rows, [(200, {'ip': ip, 'host': '127.0.0.1:8080', 'proto': 'http', 'xff': ip})
                                for ip in ('127.0.0.2', '127.0.0.3')])

    def test_rotating_headers_does_not_reset_socket_peer_budget(self):
        rows = edge_requests([
            {'path': '/api/auth/login', 'headers': {'X-Forwarded-For': f'198.51.100.{i + 1}',
                                                 'X-Nasq-Client-IP': f'192.0.2.{i + 1}'}}
            for i in range(21)
        ] + [{'path': '/api/auth/login', 'peer': '127.0.0.3'}])
        self.assertEqual([status for status, _ in rows], [200] * 20 + [429, 200])

    def test_one_auth_budget_across_backends_and_credential_aliases(self):
        rows = edge_requests(
            [{'path': '/api/auth/login'} for _ in range(10)]
            + [{'path': '/web/login'} for _ in range(10)]
            + [{'path': path} for path in (
                '/api/auth/totp', '/api/v1/auth/totp', '/web/session/authenticate',
                '/api/auth/login/', '/api/auth/%6cogin', '/API/AUTH/LOGIN',
                '/web/login/totp', '/web/login/',
            )]
            + [{'path': path} for path in ('/login', '/web/health', '/web/session/get_session_info')]
        )
        self.assertEqual([status for status, _ in rows], [200] * 20 + [429] * 8 + [200] * 3)


if __name__ == '__main__':
    unittest.main()
