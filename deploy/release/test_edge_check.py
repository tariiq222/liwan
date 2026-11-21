from __future__ import annotations

import io
import json
import ssl
import unittest
from datetime import datetime, timedelta, timezone

from deploy.release import edge_check

NOW = datetime(2026, 11, 21, tzinfo=timezone.utc)
GOOD_VHOST = 'proxy_set_header Host $host;\nproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\nproxy_set_header Upgrade $http_upgrade;\n'


def run(argv, status=lambda host: 200, days=60):
    out = io.StringIO()
    code = edge_check.main(argv, out=out, status=status, expiry=lambda host: NOW + timedelta(days=days),
                           today=lambda: NOW)
    return code, out.getvalue()


class EdgeCheckTest(unittest.TestCase):
    def test_good_status_codes_pass(self):
        for code in (200, 204, 301, 302):
            self.assertEqual(run(['--host', 'a.example'], status=lambda host, code=code: code), (0, 'RESULT: edge ok\n'))

    def test_bad_status_fails(self):
        code, output = run(['--host', 'a.example'], status=lambda host: 502)
        self.assertEqual((code, output), (1, 'a.example: HTTPS answered 502\n'))

    def test_unreachable_or_untrusted_host_fails(self):
        def refuse(host):
            raise ssl.SSLCertVerificationError('self-signed')
        code, output = run(['--host', 'a.example'], status=refuse)
        self.assertEqual(code, 1)
        self.assertIn('a.example: HTTPS failed', output)

    def test_short_certificate_fails(self):
        code, output = run(['--host', 'a.example', '--min-days', '21'], days=20)
        self.assertEqual((code, output), (1, 'a.example: certificate has 20 days left, need 21\n'))

    def test_each_host_is_checked(self):
        code, output = run(['--host', 'a.example', '--host', 'b.example'], status=lambda host: 500 if host == 'b.example' else 200)
        self.assertEqual((code, output), (1, 'b.example: HTTPS answered 500\n'))

    def test_route_file(self):
        good, bad = json.dumps({'targetUrl': edge_check.DEFAULT_TARGET}), json.dumps({'targetUrl': 'http://x'})
        self.assertEqual(edge_check.check_route('r.json', edge_check.DEFAULT_TARGET, read=lambda path: good), [])
        self.assertEqual(len(edge_check.check_route('r.json', edge_check.DEFAULT_TARGET, read=lambda path: bad)), 1)
        self.assertIn('unreadable', edge_check.check_route('r.json', edge_check.DEFAULT_TARGET, read=lambda path: '{')[0])

    def test_missing_route_file_fails(self):
        code, output = run(['--route-file', '/nonexistent/x.route.json'])
        self.assertEqual(code, 1)
        self.assertIn('route file unreadable', output)

    def test_vhost_file(self):
        self.assertEqual(edge_check.check_vhost('v.conf', read=lambda path: GOOD_VHOST), [])
        for directive in edge_check.VHOST_DIRECTIVES:
            failures = edge_check.check_vhost('v.conf', read=lambda path, d=directive: GOOD_VHOST.replace(d, ''))
            self.assertEqual(failures, [f'v.conf: missing "{directive}"'])

    def test_missing_vhost_file_fails(self):
        code, output = run(['--vhost-file', '/nonexistent/v.conf'])
        self.assertEqual(code, 1)
        self.assertIn('vhost file unreadable', output)


if __name__ == '__main__':
    unittest.main()
