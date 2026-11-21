from __future__ import annotations

import contextlib
import http.client
import io
import json
import shutil
import socket
import ssl
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from deploy.release import edge_check

NOW = datetime(2026, 11, 21, tzinfo=timezone.utc)
GOOD_VHOST = 'proxy_set_header Host $host;\nproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\nproxy_set_header Upgrade $http_upgrade;\n'


def run(argv, status=lambda host: 200, days=60, file_expiry=None):
    out = io.StringIO()
    def expiry(name):
        return NOW + timedelta(days=days)

    code = edge_check.main(argv, out=out, status=status, expiry=expiry, file_expiry=file_expiry or expiry,
                           today=lambda: NOW)
    return code, out.getvalue()


def raising(error):
    def fail(*args):
        raise error
    return fail


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

    def test_nothing_to_check_is_a_usage_error(self):
        with self.assertRaises(SystemExit) as raised, contextlib.redirect_stderr(io.StringIO()) as stderr:
            edge_check.main([], out=io.StringIO())
        self.assertEqual(raised.exception.code, 2)
        self.assertIn('nothing to check', stderr.getvalue())

    def test_every_kind_of_network_or_tls_error_is_one_failed_line_per_check(self):
        errors = (socket.gaierror(8, 'no such host'), ConnectionResetError('reset'), ssl.SSLError('handshake'),
                  http.client.BadStatusLine('x'), ValueError('bad date'), KeyError('notAfter'), TimeoutError('slow'))
        for error in errors:
            code, output = run(['--host', 'a.example', '--host', 'b.example'], status=raising(error))
            self.assertEqual(code, 1, error)
            self.assertEqual([line.split(' (')[0] for line in output.splitlines()],
                             ['a.example: HTTPS failed', 'b.example: HTTPS failed'], error)

    def test_an_unreadable_certificate_is_one_failed_line_and_the_other_hosts_are_still_checked(self):
        out = io.StringIO()
        expiry = raising(ValueError('time data'))
        code = edge_check.main(['--host', 'a.example', '--host', 'b.example'], out=out, status=lambda host: 200,
                               expiry=expiry, today=lambda: NOW)
        self.assertEqual(code, 1)
        self.assertEqual([line.split(' (')[0] for line in out.getvalue().splitlines()],
                         ['a.example: certificate unreadable', 'b.example: certificate unreadable'])

    def test_a_route_file_that_is_not_an_object_or_not_json_or_not_text_fails_one_line(self):
        for text in ('[]', '{', '"x"'):
            failures = edge_check.check_route('r.json', edge_check.DEFAULT_TARGET, read=lambda path, text=text: text)
            self.assertEqual(len(failures), 1, text)
            self.assertIn('route file unreadable', failures[0])
        undecodable = raising(UnicodeDecodeError('utf-8', b'\xff', 0, 1, 'invalid start byte'))
        self.assertIn('route file unreadable', edge_check.check_route('r.json', edge_check.DEFAULT_TARGET, read=undecodable)[0])
        self.assertIn('vhost file unreadable', edge_check.check_vhost('v.conf', read=undecodable)[0])

    def test_certificate_files_need_min_days(self):
        self.assertEqual(run(['--cert-file', 'a.crt', '--cert-file', 'b.crt'], days=60), (0, 'RESULT: edge ok\n'))
        code, output = run(['--cert-file', 'a.crt', '--min-days', '21'], days=5)
        self.assertEqual((code, output), (1, 'a.crt: certificate has 5 days left, need 21\n'))

    def test_a_certificate_file_that_openssl_cannot_read_is_one_failed_line(self):
        for error in (FileNotFoundError('openssl'), subprocess.CalledProcessError(1, 'openssl'),
                      subprocess.TimeoutExpired('openssl', 10), ValueError('time data')):
            code, output = run(['--cert-file', 'a.crt'], file_expiry=raising(error))
            self.assertEqual(code, 1, error)
            self.assertTrue(output.startswith('a.crt: certificate unreadable'), error)

    @unittest.skipIf(shutil.which('openssl') is None, 'openssl not installed')
    def test_openssl_reads_the_expiry_of_a_real_pem(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f'{tmp}/k.pem',
                            '-out', f'{tmp}/c.pem', '-days', '30', '-subj', '/CN=x'], check=True, capture_output=True)
            days = (edge_check.file_certificate_expiry(f'{tmp}/c.pem') - datetime.now(timezone.utc)).days
        self.assertIn(days, (29, 30))
        with self.assertRaises(subprocess.CalledProcessError):
            edge_check.file_certificate_expiry('/nonexistent/c.pem')


if __name__ == '__main__':
    unittest.main()
