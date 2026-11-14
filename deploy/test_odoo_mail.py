# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Odoo outbound mail route of the shared overlay: a send-only relay, nothing wider.

Static checks over the overlay text and the Dockerfile, plus protocol tests that run the real relay in-process on
127.0.0.1 with the upstream replaced by a recording function. No container, no network beyond loopback.
"""
import importlib.util
import re
import shutil
import smtplib
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import tracemalloc
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / 'deploy' / 'docker-compose.shared.yml'
BASE = ROOT / 'deploy' / 'docker-compose.yml'
DOCKERFILE = ROOT / 'deploy' / 'odoo-mail' / 'Dockerfile'
RELAY_PATH = ROOT / 'deploy' / 'odoo-mail' / 'relay.py'
SPEC = importlib.util.spec_from_file_location('odoo_mail_relay', RELAY_PATH)
relay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(relay)

SENDER = 'no-reply@liwanos.com'


def service_block(name):
    lines = SHARED.read_text(encoding='utf-8').splitlines()
    start = lines.index(f'  {name}:')
    block = []
    for line in lines[start + 1:]:
        if re.match(r'^ {0,2}\S', line):
            break
        block.append(line)
    return block


def environment(block):
    return {m.group(1): m.group(2) for m in (re.match(r'^ {6}([A-Z_]+):\s*"?(.*?)"?\s*$', line) for line in block) if m}


class OverlayCase(unittest.TestCase):
    def setUp(self):
        self.mail = service_block('odoo-mail')
        self.text = '\n'.join(self.mail)
        self.odoo = service_block('odoo')

    def test_only_odoo_and_the_relay_share_the_internal_network_and_odoo_gains_no_routed_one(self):
        self.assertIn('    networks: [odoo_mail, edge]', self.mail)
        members = [name for name in re.findall(r'^  ([\w-]+):\s*$', SHARED.read_text(encoding='utf-8'), re.M)
                   if re.search(r'\bodoo_mail\b', '\n'.join(service_block(name))) and name != 'odoo_mail']
        self.assertEqual(sorted(members), ['odoo', 'odoo-mail'])
        self.assertRegex(SHARED.read_text(encoding='utf-8'), r'\n  odoo_mail: \{ internal: true \}')
        listed = [line.strip()[2:] for line in self.odoo if re.match(r'^ {6}- \w+$', line)]
        self.assertEqual(listed, ['guard_odoo', 'database', 'relay_odoo', 'odoo_egress', 'odoo_mail'])
        self.assertNotIn('edge', listed)

    def test_the_relay_is_hardened(self):
        for required in ('user: "10002:10002"', 'cap_drop: [ALL]', 'read_only: true', 'no-new-privileges:true'):
            self.assertIn(required, self.text)
        self.assertNotIn('ports:', self.text)
        self.assertRegex(self.text, r'(?m)^    mem_limit: \d+m$')
        self.assertNotIn('profiles:', self.text)
        self.assertNotIn('cap_add', self.text)
        self.assertIn('odoo-mail: { condition: service_started }', '\n'.join(self.odoo))

    def test_the_relay_has_no_credentials_in_files(self):
        values = environment(self.mail)
        for name in ('ODOO_MAIL_SENDER', 'ODOO_MAIL_UPSTREAM_HOST', 'ODOO_MAIL_UPSTREAM_USER', 'ODOO_MAIL_UPSTREAM_PASSWORD'):
            self.assertRegex(values[name], rf'^\$\{{{name}:-\}}$')
        self.assertEqual(values['ODOO_MAIL_UPSTREAM_PORT'], '${ODOO_MAIL_UPSTREAM_PORT:-587}')
        for path in (DOCKERFILE, RELAY_PATH, ROOT / 'deploy' / '.env.example'):
            text = path.read_text(encoding='utf-8')
            self.assertNotRegex(text, r'(?m)^\s*ODOO_MAIL_UPSTREAM_(USER|PASSWORD)=\S')

    def test_odoo_carries_the_server_wide_smtp_options(self):
        values = environment(self.odoo)
        self.assertEqual(values['ODOO_SMTP_SERVER'], 'odoo-mail')
        self.assertEqual(values['ODOO_SMTP_PORT'], '2525')
        self.assertEqual(values['ODOO_EMAIL_FROM'], '${ODOO_MAIL_SENDER:-}')
        for name in values:
            self.assertNotIn('SMTP_USER', name)
            self.assertNotIn('SMTP_PASSWORD', name)
        # The same sender feeds Odoo and the relay, so the two cannot disagree.
        self.assertEqual(environment(self.mail)['ODOO_MAIL_SENDER'], '${ODOO_MAIL_SENDER:-}')

    def test_the_restore_odoo_and_the_dedicated_template_are_untouched(self):
        self.assertNotIn('odoo-mail', '\n'.join(service_block('restore-odoo')))
        self.assertNotIn('odoo-mail', BASE.read_text(encoding='utf-8'))

    def test_the_image_is_pinned_unprivileged_and_installs_nothing(self):
        text = DOCKERFILE.read_text(encoding='utf-8')
        self.assertRegex(text, r'(?m)^FROM python:3\.12-slim-bookworm@sha256:[0-9a-f]{64}$')
        ai_egress = (ROOT / 'deploy' / 'ai-egress' / 'Dockerfile').read_text(encoding='utf-8')
        self.assertEqual(re.search(r'@sha256:[0-9a-f]{64}', text).group(), re.search(r'@sha256:[0-9a-f]{64}', ai_egress).group())
        self.assertRegex(text, r'(?m)^USER 10002:10002$')
        self.assertNotRegex(text, r'apt-get|pip install')

    def test_the_relay_imports_only_the_standard_library_and_runs_no_local_delivery(self):
        source = RELAY_PATH.read_text(encoding='utf-8')
        for module in re.findall(r'(?m)^(?:import|from) (\w+)', source):
            self.assertIn(module, sys_stdlib(), module)
        for forbidden in ('subprocess', 'os.system', 'open(\'/var'):
            self.assertNotIn(forbidden, source)


def sys_stdlib():
    import sys
    return set(sys.stdlib_module_names) if hasattr(sys, 'stdlib_module_names') else {
        '__future__', 'email', 'fcntl', 'logging', 'os', 're', 'smtplib', 'socket', 'signal', 'socketserver', 'ssl', 'struct', 'sys', 'threading', 'time'}




class ConfigCase(unittest.TestCase):
    def test_a_complete_setting_is_ready_and_an_empty_one_is_not(self):
        ready = relay.Config({'ODOO_MAIL_SENDER': SENDER, 'ODOO_MAIL_UPSTREAM_HOST': 'smtp.example.com'})
        self.assertTrue(ready.ready)
        self.assertEqual((ready.port, ready.listen_port), (587, 2525))
        self.assertFalse(relay.Config({}).ready)
        self.assertFalse(hasattr(ready, 'listen'))

    def test_unusable_values_stop_the_start(self):
        for bad in ({'ODOO_MAIL_SENDER': 'not-an-address'}, {'ODOO_MAIL_UPSTREAM_HOST': 'bad host'},
                    {'ODOO_MAIL_UPSTREAM_PORT': 'x'}, {'ODOO_MAIL_UPSTREAM_USER': 'u'},
                    {'ODOO_MAIL_UPSTREAM_PASSWORD': 'p'}, {'ODOO_MAIL_LISTEN_PORT': '25'}):
            with self.subTest(bad=bad), self.assertRaises(relay.ConfigError):
                relay.Config(bad)

    def test_it_listens_only_on_non_routed_interfaces_and_never_without_a_default_route(self):
        routes = ('Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\n'
                  'eth1\t00000000\t010011AC\t0003\t0\t0\t0\t00000000\n'
                  'eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\n')
        addresses = [('lo', '127.0.0.1'), ('eth0', '172.18.0.2'), ('eth1', '172.17.0.2')]
        self.assertEqual(relay.default_route_interface(routes), 'eth1')
        self.assertEqual(relay.listen_addresses(routes, addresses), ['172.18.0.2'])
        self.assertEqual(relay.listen_addresses('Iface\n', addresses), [])
        self.assertEqual(relay.listen_addresses(routes, [('eth1', '172.17.0.2')]), [])

    def test_serve_refuses_to_start_without_an_address(self):
        original = relay.current_listen_addresses
        relay.current_listen_addresses = lambda: []
        self.addCleanup(lambda: setattr(relay, 'current_listen_addresses', original))
        with self.assertRaises(relay.ConfigError):
            relay.serve(relay.Config({}))
        self.assertEqual(relay.healthcheck(relay.Config({})), 1)


class ProtocolCase(unittest.TestCase):
    """The real relay on loopback; the upstream is a recording function."""

    def start(self, deliver=None, **settings):
        values = {'ODOO_MAIL_SENDER': SENDER, 'ODOO_MAIL_UPSTREAM_HOST': 'smtp.example.com', 'ODOO_MAIL_MAX_BYTES': '2048',
                  'ODOO_MAIL_MAX_CONNECTIONS': '64'}
        values.update(settings)
        self.sent = []

        def record(config, sender, recipients, data):
            self.sent.append((sender, recipients, data))

        server = relay.RelayServer(('127.0.0.1', 0), relay.Config(values), deliver or record)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        return server.server_address[1]

    @staticmethod
    def message(header=None, extra='', body='\r\n'):
        header = f'From: {SENDER}' if header is None else header
        return f'{header}\r\nTo: a@example.org\r\nSubject: hi\r\n{extra}\r\n\u0645\u0631\u062d\u0628\u0627\r\n{body}'.encode()

    def client(self, port):
        smtp = smtplib.SMTP('127.0.0.1', port, timeout=5)
        self.addCleanup(smtp.close)
        return smtp

    def raw(self, port, *steps):
        """Send each step, read what comes back after each; returns all replies as text."""
        connection = socket.create_connection(('127.0.0.1', port), timeout=3)
        self.addCleanup(connection.close)
        text = b''
        for step in (None, *steps):
            if step is not None:
                connection.sendall(step)
            connection.settimeout(0.15)
            try:
                while True:
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    text += chunk
            except socket.timeout:
                pass
        return text.decode('latin-1')

    def refused(self, port, message, code=554):
        smtp = self.client(port)
        with self.assertRaises(smtplib.SMTPDataError) as raised:
            smtp.sendmail(SENDER, ['a@example.org'], message)
        self.assertEqual(raised.exception.smtp_code, code)

    # relaying and the sender rule
    def test_a_message_from_the_platform_address_is_relayed_upstream_unchanged(self):
        smtp = self.client(self.start())
        self.assertEqual(smtp.sendmail(SENDER, ['a@example.org'], self.message()), {})
        sender, recipients, data = self.sent[0]
        self.assertEqual((sender, recipients), (SENDER, ['a@example.org']))
        self.assertIn('\u0645\u0631\u062d\u0628\u0627'.encode(), data)

    def test_another_envelope_sender_is_refused_and_nothing_is_sent(self):
        smtp = self.client(self.start())
        with self.assertRaises(smtplib.SMTPSenderRefused) as raised:
            smtp.sendmail('boss@other.example', ['a@example.org'], self.message())
        self.assertEqual(raised.exception.smtp_code, 553)
        self.assertEqual(self.sent, [])

    def test_an_oversized_message_is_refused_when_declared_and_when_not(self):
        port = self.start()
        big = self.message(extra='X-Pad: ' + 'a' * 4000 + '\r\n')
        with self.assertRaises(smtplib.SMTPSenderRefused) as raised:
            self.client(port).sendmail(SENDER, ['a@example.org'], big)
        self.assertEqual(raised.exception.smtp_code, 552)
        replies = self.raw(port, b'EHLO x\r\n', f'MAIL FROM:<{SENDER}>\r\n'.encode(), b'RCPT TO:<a@example.org>\r\n', b'DATA\r\n',
                           big + b'.\r\n')
        self.assertIn('552 5.3.4', replies)
        self.assertEqual(self.sent, [])

    def test_too_many_recipients_are_refused(self):
        smtp = self.client(self.start(ODOO_MAIL_MAX_RECIPIENTS='2'))
        smtp.ehlo()
        smtp.mail(SENDER)
        self.assertEqual(smtp.rcpt('a@example.org')[0], 250)
        self.assertEqual(smtp.rcpt('b@example.org')[0], 250)
        self.assertEqual(smtp.rcpt('c@example.org')[0], 452)

    def test_there_is_no_auth_no_starttls_and_no_vrfy(self):
        smtp = self.client(self.start())
        smtp.ehlo()
        self.assertFalse(smtp.has_extn('auth'))
        self.assertFalse(smtp.has_extn('starttls'))
        self.assertEqual(smtp.docmd('VRFY', 'root')[0], 502)
        self.assertEqual(smtp.docmd('AUTH', 'PLAIN')[0], 502)

    def test_commands_out_of_order_are_refused(self):
        smtp = self.client(self.start())
        self.assertEqual(smtp.docmd('MAIL', f'FROM:<{SENDER}>')[0], 503)
        smtp.ehlo()
        self.assertEqual(smtp.docmd('RCPT', 'TO:<a@example.org>')[0], 503)
        self.assertEqual(smtp.docmd('DATA')[0], 503)

    def test_a_malformed_recipient_is_refused(self):
        smtp = self.client(self.start())
        smtp.ehlo()
        smtp.mail(SENDER)
        for bad in ('<a@b@c>', '<a@example.org,b@example.org>', '<>', 'a@example.org'):
            self.assertEqual(smtp.docmd('RCPT', f'TO:{bad}')[0], 501, bad)

    def test_an_unconfigured_relay_refuses_every_message(self):
        smtp = self.client(self.start(ODOO_MAIL_SENDER='', ODOO_MAIL_UPSTREAM_HOST=''))
        smtp.ehlo()
        self.assertEqual(smtp.docmd('MAIL', f'FROM:<{SENDER}>')[0], 554)

    def test_one_connection_can_send_two_messages(self):
        smtp = self.client(self.start())
        smtp.sendmail(SENDER, ['a@example.org'], self.message())
        smtp.sendmail(SENDER, ['b@example.org'], self.message())
        self.assertEqual([item[1] for item in self.sent], [['a@example.org'], ['b@example.org']])

    def test_an_upstream_failure_reaches_the_client_as_a_failure(self):
        def fail(*_):
            raise relay.UpstreamError(451, '4.4.1 upstream unavailable')
        self.refused(self.start(fail), self.message(), 451)

    # the header block
    def test_the_header_block_must_be_unambiguous_and_name_the_platform_address(self):
        mime_without_from = ('To: a@example.org\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n'
                             f'--b\r\nFrom: {SENDER}\r\n\r\nx\r\n--b--\r\n').encode()
        mime_with_evil_from = mime_without_from.replace(b'To:', b'From: evil@other.example\r\nTo:', 1)
        cases = {
            'bare CR hides a header': b'X: a\r\r\nFrom: evil@other.example\r\n\r\nb\r\n',
            'space before the colon': b'From : evil@other.example\r\nFrom: ' + SENDER.encode() + b'\r\n\r\nb\r\n',
            'the second line folds into From': f'From: evil@other.example\r\n From: {SENDER}\r\n\r\nb\r\n'.encode(),
            'two From headers': f'From: {SENDER}\r\nFrom: {SENDER}\r\n\r\nb\r\n'.encode(),
            'no From, one inside a MIME part': mime_without_from,
            'wrong From, the right one inside a MIME part': mime_with_evil_from,
            'an address list': f'From: {SENDER}, boss@other.example\r\n\r\nb\r\n'.encode(),
            'group syntax': f'From: team: {SENDER};\r\n\r\nb\r\n'.encode(),
            'an address in the display name': f'From: boss@other.example <{SENDER}>\r\n\r\nb\r\n'.encode(),
            'a comment': f'From: {SENDER} (boss@other.example)\r\n\r\nb\r\n'.encode(),
            'another Sender': f'From: {SENDER}\r\nSender: boss@other.example\r\n\r\nb\r\n'.encode(),
            'another Return-Path': f'Return-Path: <boss@other.example>\r\nFrom: {SENDER}\r\n\r\nb\r\n'.encode(),
            'another Resent-From': f'From: {SENDER}\r\nResent-From: boss@other.example\r\n\r\nb\r\n'.encode(),
            'a null Return-Path': f'Return-Path: <>\r\nFrom: {SENDER}\r\n\r\nb\r\n'.encode(),
            'a header line without a colon': f'From: {SENDER}\r\nnonsense\r\n\r\nb\r\n'.encode(),
            'a leading continuation line': f' x\r\nFrom: {SENDER}\r\n\r\nb\r\n'.encode(),
            'non-ASCII in From': f'From: {SENDER} \u00e9\r\n\r\nb\r\n'.encode(),
            'an empty header block': b'\r\nbody\r\n',
        }
        port = self.start()
        for name, message in cases.items():
            with self.subTest(name):
                self.refused(port, message)
        self.assertEqual(self.sent, [])

    def test_ordinary_headers_are_accepted(self):
        port = self.start()
        good = [
            f'From: {SENDER}',
            f'From: <{SENDER}>',
            f'From: Platform\r\n <{SENDER}>',
            f'From: =?utf-8?b?2YXYsdit2KjYpw==?= <{SENDER}>',
            f'From: "Doe, John" <{SENDER}>',
            f'From: "boss@other.example" <{SENDER}>',
            f'From: {SENDER.upper()}',
        ]
        for header in good:
            with self.subTest(header=header):
                self.client(port).sendmail(SENDER, ['a@example.org'], self.message(header))
        self.client(port).sendmail(SENDER, ['a@example.org'], self.message(extra=f'Return-Path: <{SENDER}>\r\nSender: {SENDER}\r\n'))
        # Stock Odoo mail.mail writes an empty Return-Path header when no bounce address is configured.
        self.client(port).sendmail(SENDER, ['a@example.org'], self.message(extra='Return-Path: \r\n'))
        self.assertEqual(len(self.sent), len(good) + 2)

    # strict CRLF and smuggling
    def test_a_non_strict_data_section_is_refused_and_the_connection_closed(self):
        port = self.start()
        head = b'EHLO x\r\n', f'MAIL FROM:<{SENDER}>\r\n'.encode(), b'RCPT TO:<a@example.org>\r\n', b'DATA\r\n'
        prefix = f'From: {SENDER}\r\n\r\nhello\r\n'.encode()
        smuggled = b'MAIL FROM:<boss@other.example>\r\nRCPT TO:<c@example.org>\r\nDATA\r\nFrom: x\r\n\r\nevil\r\n.\r\n'
        payloads = {
            'bare LF terminator': prefix + b'.\n' + smuggled,
            'LF dot CR terminator': prefix + b'\n.\r' + smuggled,
            'bare LF inside a line': prefix + b'a\nb\r\n.\r\n',
            'bare CR inside a line': prefix + b'a\rb\r\n.\r\n',
            'CR CR LF': prefix + b'a\r\r\n.\r\n',
            'NUL byte': prefix + b'a\x00b\r\n.\r\n',
        }
        for name, payload in payloads.items():
            with self.subTest(name):
                replies = self.raw(port, *head, payload)
                self.assertIn('554 5.6.0', replies)
                self.assertNotIn('250 2.0.0 accepted', replies)
        self.assertEqual(self.sent, [])

    def test_the_dot_terminator_is_the_only_end_and_what_follows_it_is_a_new_command(self):
        port = self.start()
        replies = self.raw(port, b'EHLO x\r\n', f'MAIL FROM:<{SENDER}>\r\n'.encode(), b'RCPT TO:<a@example.org>\r\n', b'DATA\r\n',
                           f'From: {SENDER}\r\n\r\nhi\r\n.\r\nMAIL FROM:<boss@other.example>\r\n'.encode())
        self.assertIn('250 2.0.0 accepted', replies)
        self.assertIn('553 5.7.1', replies)
        self.assertEqual(len(self.sent), 1)

    # robustness
    def test_non_ascii_in_a_command_is_refused_and_the_session_goes_on(self):
        port = self.start()
        replies = self.raw(port, b'EHLO x\r\n', f'MAIL FROM:<{SENDER}>\r\n'.encode(), 'RCPT TO:<caf\u00e9@example.org>\r\n'.encode(), b'NOOP\r\n')
        self.assertIn('501 5.5.2 printable ASCII only', replies)
        self.assertTrue(replies.rstrip().endswith('250 2.0.0 ok'))

    def test_an_unexpected_exception_is_a_fixed_451_and_the_slot_is_released(self):
        def explode(*_):
            raise RuntimeError('secret detail a@example.org')
        port = self.start(explode, ODOO_MAIL_MAX_CONNECTIONS='1')
        smtp = self.client(port)
        with self.assertRaises(smtplib.SMTPDataError) as raised:
            smtp.sendmail(SENDER, ['a@example.org'], self.message())
        self.assertEqual(raised.exception.smtp_code, 451)
        self.assertNotIn(b'secret', raised.exception.smtp_error)
        for _ in range(20):
            if '220' in self.raw(port):
                break
            time.sleep(0.1)
        else:
            self.fail('the connection slot was not released')

    def test_a_connection_beyond_the_limit_is_answered_421_without_a_new_thread(self):
        port = self.start(ODOO_MAIL_MAX_CONNECTIONS='2')
        holders = [socket.create_connection(('127.0.0.1', port), timeout=3) for _ in range(2)]
        self.addCleanup(lambda: [holder.close() for holder in holders])
        for holder in holders:
            self.assertTrue(holder.recv(100).startswith(b'220'))
        before = threading.active_count()
        for _ in range(5):
            self.assertTrue(self.raw(port).startswith('421 4.3.2'))
        self.assertLessEqual(threading.active_count(), before)

    def test_a_connection_and_a_data_phase_have_a_deadline(self):
        for name, value in (('CONNECTION_DEADLINE', 1), ('DATA_DEADLINE', 1)):
            original = getattr(relay, name)
            setattr(relay, name, value)
            self.addCleanup(lambda name=name, original=original: setattr(relay, name, original))
        port = self.start()
        idle = socket.create_connection(('127.0.0.1', port), timeout=5)
        self.addCleanup(idle.close)
        self.assertTrue(idle.recv(100).startswith(b'220'))
        started = time.monotonic()
        self.assertEqual(idle.recv(100), b'')
        self.assertLess(time.monotonic() - started, 4)
        relay.CONNECTION_DEADLINE = 600
        stalled = socket.create_connection(('127.0.0.1', port), timeout=5)
        self.addCleanup(stalled.close)
        stalled.recv(100)
        stalled.sendall(b'EHLO x\r\n' + f'MAIL FROM:<{SENDER}>\r\n'.encode() + b'RCPT TO:<a@example.org>\r\nDATA\r\n')
        started = time.monotonic()
        received = b''
        while True:
            chunk = stalled.recv(100)
            if not chunk:
                break
            received += chunk
        self.assertIn(b'354', received)
        self.assertLess(time.monotonic() - started, 4)

    # deadlines, memory, edge cases (second review)
    def set_constant(self, name, value):
        original = getattr(relay, name)
        setattr(relay, name, value)
        self.addCleanup(lambda: setattr(relay, name, original))

    def trickle(self, connection, payload, seconds):
        """Send the payload one byte at a time; returns when the relay closed the connection or time ran out."""
        started = time.monotonic()
        for byte in payload:
            if time.monotonic() - started > seconds:
                break
            try:
                connection.sendall(bytes([byte]))
                connection.settimeout(0.3)
                if connection.recv(100) == b'':
                    break
            except socket.timeout:
                continue
            except OSError:
                break
        return time.monotonic() - started

    def assert_slot_free(self, port):
        for _ in range(30):
            probe = socket.create_connection(('127.0.0.1', port), timeout=3)
            greeting = probe.recv(100)
            probe.close()
            if greeting.startswith(b'220'):
                return
            time.sleep(0.1)
        self.fail('the connection slot was not released')

    def test_a_client_that_sends_one_byte_at_a_time_is_cut_at_the_connection_deadline(self):
        self.set_constant('CONNECTION_DEADLINE', 2)
        port = self.start(ODOO_MAIL_MAX_CONNECTIONS='1')
        connection = socket.create_connection(('127.0.0.1', port), timeout=3)
        self.addCleanup(connection.close)
        self.assertTrue(connection.recv(100).startswith(b'220'))
        elapsed = self.trickle(connection, b'NOOP' * 100, 8)
        self.assertLess(elapsed, 4)
        self.assert_slot_free(port)

    def test_a_trickle_inside_data_is_cut_at_the_data_deadline(self):
        self.set_constant('DATA_DEADLINE', 1)
        port = self.start(ODOO_MAIL_MAX_CONNECTIONS='1')
        connection = socket.create_connection(('127.0.0.1', port), timeout=3)
        self.addCleanup(connection.close)
        connection.recv(100)
        connection.sendall(b'EHLO x\r\n' + f'MAIL FROM:<{SENDER}>\r\n'.encode() + b'RCPT TO:<a@example.org>\r\nDATA\r\n')
        time.sleep(0.3)
        connection.recv(1000)
        elapsed = self.trickle(connection, b'x' * 200, 8)
        self.assertLess(elapsed, 3.5)
        self.assert_slot_free(port)

    def test_millions_of_tiny_lines_cost_about_the_size_of_the_message(self):
        port = self.start(ODOO_MAIL_MAX_BYTES='524288')
        lines = 200000
        message = f'From: {SENDER}\r\n\r\n'.encode() + b'\r\n' * lines
        smtp = self.client(port)
        smtp.ehlo()
        smtp.mail(SENDER)
        smtp.rcpt('a@example.org')
        self.assertEqual(smtp.docmd('DATA')[0], 354)
        tracemalloc.start()
        self.addCleanup(tracemalloc.stop)
        tracemalloc.reset_peak()
        base = tracemalloc.get_traced_memory()[0]
        smtp.send(message + b'.\r\n')
        self.assertEqual(smtp.getreply()[0], 250)
        peak = tracemalloc.get_traced_memory()[1] - base
        # One object per line would be about 40 bytes each (8 MB here); one buffer is about the payload.
        self.assertLess(peak, 3 * len(message), peak)
        self.assertEqual(len(self.sent[0][2]), len(message))

    def test_a_size_parameter_that_is_not_a_short_number_is_501(self):
        port = self.start()
        for value in ('abc', '-1', '99999999999999', ''):
            replies = self.raw(port, b'EHLO x\r\n', f'MAIL FROM:<{SENDER}> SIZE={value}\r\n'.encode())
            self.assertIn('501 5.5.4 SIZE', replies, value)

    def test_header_edge_cases(self):
        port = self.start(ODOO_MAIL_MAX_BYTES='1000000')
        accepted = [
            f'From: "a, <x@y.example>" <{SENDER}>',
            f'From: NO-REPLY@LIWANOS.COM',
        ]
        refused = [
            'From: "a" <evil@other.example>',
            f'From: <{SENDER}> trailing',
            'From: "no-reply"@liwanos.com',
            'From: no-reply@liwanos.com.',
            f'From: "x" <evil@other.example>, <{SENDER}>',
            f'From: <{SENDER}>, <evil@other.example>',
        ]
        for header in accepted:
            with self.subTest(accepted=header):
                self.client(port).sendmail(SENDER, ['a@example.org'], self.message(header))
        for header in refused:
            with self.subTest(refused=header):
                self.refused(port, self.message(header))
        many = ''.join(f'X-N{index}: v\r\n' for index in range(5000))
        self.client(port).sendmail(SENDER, ['a@example.org'], self.message(extra=many))
        too_big = ''.join(f'X-Header-Number-{index}: 1234567890\r\n' for index in range(3000))
        self.assertGreater(len(too_big), relay.MAX_HEADER_BYTES)
        self.refused(port, self.message(extra=too_big))
        self.assertEqual(len(self.sent), len(accepted) + 1)


CERT_CONFIG = """[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = localhost
[v3]
subjectAltName = DNS:localhost
"""


class FakeUpstream:
    """A real SMTP server on loopback with STARTTLS (self-signed certificate); it records what it was sent."""

    def __init__(self, cert, key, starttls=True, rcpt_codes=None, data_reply='250 queued', mail_reply='250 ok',
                 trickle_tls=False, banner_lines=0):
        self.starttls, self.rcpt_codes = starttls, rcpt_codes or {}
        self.data_reply, self.mail_reply = data_reply, mail_reply
        self.trickle_tls, self.banner_lines = trickle_tls, banner_lines
        self.events, self.wire = [], []
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.load_cert_chain(cert, key)
        self.listener = socket.socket()
        self.listener.bind(('127.0.0.1', 0))
        self.listener.listen(4)
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self.accept, daemon=True).start()

    def close(self):
        self.listener.close()

    def accept(self):
        while True:
            try:
                connection, _ = self.listener.accept()
            except OSError:
                return
            try:
                self.serve(connection)
            except (OSError, ssl.SSLError):
                pass

    def serve(self, connection):
        self.wrapped = None
        try:
            self.converse(connection)
        finally:
            connection.close()
            if self.wrapped:
                self.wrapped.close()

    def converse(self, connection):
        tls = False
        reader = connection.makefile('rb')

        def send(text):
            connection.sendall(text.encode() + b'\r\n')

        for _ in range(self.banner_lines):
            send('220-padding')
        send('220 fake ESMTP')
        while True:
            line = reader.readline()
            if not line:
                return
            command = line.decode().strip()
            verb = command.split(' ')[0].upper()
            if verb == 'EHLO':
                extensions = (['STARTTLS'] if self.starttls and not tls else []) + (['AUTH PLAIN LOGIN'] if tls else []) + ['8BITMIME']
                send('250-localhost')
                for extension in extensions[:-1]:
                    send('250-' + extension)
                send('250 ' + extensions[-1])
            elif verb == 'STARTTLS':
                send('220 go')
                if self.trickle_tls:
                    # A TLS record header promising 64 bytes, then one byte at a time: a handshake that never ends.
                    connection.sendall(b'\x16\x03\x03\x00\x40')
                    while True:
                        time.sleep(0.2)
                        connection.sendall(b'\x00')
                connection = self.context.wrap_socket(connection, server_side=True)
                self.wrapped = connection
                reader = connection.makefile('rb')
                tls = True
                self.events.append('starttls')
            elif verb == 'AUTH':
                self.events.append(('auth', tls))
                send('235 ok')
            elif verb == 'MAIL':
                self.events.append(('mail', tls))
                send(self.mail_reply)
            elif verb == 'RCPT':
                address = command.split('<', 1)[1].split('>', 1)[0]
                self.events.append(('rcpt', address))
                send(self.rcpt_codes.get(address, '250 ok'))
            elif verb == 'RSET':
                self.events.append('rset')
                send('250 ok')
            elif verb == 'DATA':
                send('354 go')
                wire = b''
                while not wire.endswith(b'\r\n.\r\n'):
                    wire += reader.readline()
                self.wire.append(wire)
                self.events.append('data')
                send(self.data_reply)
            elif verb == 'QUIT':
                send('221 bye')
                return
            else:
                send('250 ok')

    def mail_events(self):
        return [event for event in self.events if event == 'data' or (isinstance(event, tuple) and event[0] in ('mail', 'rcpt'))]


class UpstreamCase(unittest.TestCase):
    """``deliver_upstream`` against a real local SMTP server with a self-signed certificate and a test-only trust store."""

    @classmethod
    def setUpClass(cls):
        if not shutil.which('openssl'):
            raise unittest.SkipTest('openssl is needed to make the test certificate')
        cls.directory = tempfile.TemporaryDirectory()
        base = Path(cls.directory.name)
        (base / 'openssl.cnf').write_text(CERT_CONFIG)
        cls.cert, cls.key = str(base / 'cert.pem'), str(base / 'key.pem')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cls.key, '-out', cls.cert,
                        '-days', '2', '-config', str(base / 'openssl.cnf')], check=True, capture_output=True)
        cls.trust = ssl.create_default_context(cafile=cls.cert)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def upstream(self, **options):
        fake = FakeUpstream(self.cert, self.key, **options)
        self.addCleanup(fake.close)
        return fake

    @staticmethod
    def config(fake, host='localhost', **extra):
        values = {'ODOO_MAIL_SENDER': SENDER, 'ODOO_MAIL_UPSTREAM_HOST': host, 'ODOO_MAIL_UPSTREAM_PORT': str(fake.port)}
        values.update(extra)
        return relay.Config(values)

    def deliver(self, fake, recipients=('a@example.org',), context=None, **extra):
        data = b'From: ' + SENDER.encode() + b'\r\nSubject: hi\r\n\r\nbody\r\n'
        return relay.deliver_upstream(self.config(fake, **extra), SENDER, list(recipients), data, context or self.trust)

    def test_a_message_goes_over_tls_and_credentials_only_after_it(self):
        fake = self.upstream()
        self.deliver(fake, ODOO_MAIL_UPSTREAM_USER='user', ODOO_MAIL_UPSTREAM_PASSWORD='secret')
        self.assertLess(fake.events.index('starttls'), fake.events.index(('auth', True)))
        self.assertNotIn(('auth', False), fake.events)
        self.assertEqual(fake.mail_events(), [('mail', True), ('rcpt', 'a@example.org'), 'data'])

    def test_no_starttls_offered_fails_and_nothing_is_sent(self):
        fake = self.upstream(starttls=False)
        with self.assertRaises(relay.UpstreamError) as raised:
            self.deliver(fake, ODOO_MAIL_UPSTREAM_USER='user', ODOO_MAIL_UPSTREAM_PASSWORD='secret')
        self.assertEqual(raised.exception.code, 454)
        self.assertEqual(fake.events, [])

    def test_a_certificate_for_another_host_name_fails_before_any_command(self):
        fake = self.upstream()
        with self.assertRaises(relay.UpstreamError) as raised:
            self.deliver(fake, host='127.0.0.1', ODOO_MAIL_UPSTREAM_USER='user', ODOO_MAIL_UPSTREAM_PASSWORD='secret')
        self.assertEqual(raised.exception.code, 451)
        self.assertEqual([event for event in fake.events if event != 'starttls'], [])

    def test_the_default_trust_store_does_not_accept_a_self_signed_certificate(self):
        fake = self.upstream()
        with self.assertRaises(relay.UpstreamError):
            relay.deliver_upstream(self.config(fake), SENDER, ['a@example.org'], b'From: ' + SENDER.encode() + b'\r\n\r\nx\r\n')
        self.assertEqual(fake.mail_events(), [])

    def test_a_4xx_at_data_is_451_and_a_5xx_is_554(self):
        for reply, code in (('451 try later', 451), ('554 no', 554)):
            with self.subTest(reply=reply):
                fake = self.upstream(data_reply=reply)
                with self.assertRaises(relay.UpstreamError) as raised:
                    self.deliver(fake)
                self.assertEqual(raised.exception.code, code)

    def test_one_refused_recipient_resets_the_transaction_before_data(self):
        for refusal, code in (('550 no such user', 554), ('451 try later', 451)):
            with self.subTest(refusal=refusal):
                fake = self.upstream(rcpt_codes={'b@example.org': refusal})
                with self.assertRaises(relay.UpstreamError) as raised:
                    self.deliver(fake, recipients=('a@example.org', 'b@example.org'))
                self.assertEqual(raised.exception.code, code)
                self.assertNotIn('data', fake.events)
                self.assertIn('rset', fake.events)
                self.assertEqual(fake.wire, [])

    def test_a_refused_sender_is_refused_before_any_recipient(self):
        fake = self.upstream(mail_reply='550 not approved')
        with self.assertRaises(relay.UpstreamError) as raised:
            self.deliver(fake)
        self.assertEqual(raised.exception.code, 554)
        self.assertNotIn(('rcpt', 'a@example.org'), fake.events)

    def test_an_unexpected_exception_becomes_a_fixed_451(self):
        fake = self.upstream()
        with self.assertRaises(relay.UpstreamError) as raised:
            relay.deliver_upstream(self.config(fake), SENDER, ['a@example.org'], None, self.trust)
        self.assertEqual((raised.exception.code, raised.exception.text), (451, '4.3.0 internal error'))

    def test_the_total_time_is_cut_below_odoos_client_timeout(self):
        self.assertLess(relay.UPSTREAM_TOTAL_TIMEOUT, 60)  # odoo/addons/base/models/ir_mail_server.py SMTP_TIMEOUT
        silent = socket.socket()
        silent.bind(('127.0.0.1', 0))
        silent.listen(1)
        self.addCleanup(silent.close)
        config = relay.Config({'ODOO_MAIL_SENDER': SENDER, 'ODOO_MAIL_UPSTREAM_HOST': 'localhost',
                               'ODOO_MAIL_UPSTREAM_PORT': str(silent.getsockname()[1])})
        original = (relay.UPSTREAM_TOTAL_TIMEOUT, relay.UPSTREAM_OP_TIMEOUT)
        relay.UPSTREAM_TOTAL_TIMEOUT, relay.UPSTREAM_OP_TIMEOUT = 1, 30
        self.addCleanup(lambda: setattr(relay, 'UPSTREAM_TOTAL_TIMEOUT', original[0]))
        self.addCleanup(lambda: setattr(relay, 'UPSTREAM_OP_TIMEOUT', original[1]))
        started = time.monotonic()
        with self.assertRaises(relay.UpstreamError) as raised:
            relay.deliver_upstream(config, SENDER, ['a@example.org'], b'From: x\r\n\r\n')
        self.assertEqual(raised.exception.code, 451)
        self.assertLess(time.monotonic() - started, 10)

    def test_a_handshake_that_trickles_is_cut_at_the_total_time(self):
        fake = self.upstream(trickle_tls=True)
        for name, value in (('UPSTREAM_OP_TIMEOUT', 30), ('UPSTREAM_TOTAL_TIMEOUT', 2)):
            original = getattr(relay, name)
            setattr(relay, name, value)
            self.addCleanup(lambda name=name, original=original: setattr(relay, name, original))
        started = time.monotonic()
        with self.assertRaises(relay.UpstreamError) as raised:
            self.deliver(fake)
        self.assertEqual(raised.exception.code, 451)
        self.assertLess(time.monotonic() - started, 6)

    def test_an_unparsable_upstream_reply_is_a_deferral(self):
        for options in ({'data_reply': 'garbage here'}, {'rcpt_codes': {'b@example.org': 'garbage here'}},
                        {'mail_reply': 'garbage here'}):
            with self.subTest(options=options):
                fake = self.upstream(**options)
                with self.assertRaises(relay.UpstreamError) as raised:
                    self.deliver(fake, recipients=('a@example.org', 'b@example.org'))
                self.assertEqual(raised.exception.code, 451)

    def test_a_value_error_from_a_cut_ssl_socket_is_the_same_451_as_any_upstream_failure(self):
        fake = self.upstream()
        with mock.patch.object(smtplib.SMTP, 'ehlo', side_effect=ValueError('Read on closed or unwrapped SSL socket.')):
            with self.assertRaises(relay.UpstreamError) as raised:
                self.deliver(fake)
        self.assertEqual((raised.exception.code, raised.exception.text), (451, '4.4.1 upstream unavailable'))

    def test_a_failing_quit_does_not_skip_close(self):
        fake = self.upstream()
        closed = []
        original = relay._WatchedSMTP.close

        def spy(connection):
            closed.append(True)
            original(connection)

        with mock.patch.object(smtplib.SMTP, 'quit', side_effect=ValueError('Read on closed or unwrapped SSL socket.')), \
                mock.patch.object(relay._WatchedSMTP, 'close', spy):
            self.deliver(fake)
        self.assertTrue(closed)

    def test_an_endless_upstream_reply_is_cut(self):
        fake = self.upstream(banner_lines=500)
        with self.assertRaises(relay.UpstreamError) as raised:
            self.deliver(fake)
        self.assertEqual(raised.exception.code, 451)
        self.assertEqual(fake.events, [])


class WireCase(unittest.TestCase):
    """Client -> real relay -> real TLS upstream: what the upstream receives on the wire."""

    @classmethod
    def setUpClass(cls):
        UpstreamCase.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def start(self, **fake_options):
        fake = FakeUpstream(self.cert, self.key, **fake_options)
        self.addCleanup(fake.close)
        config = relay.Config({'ODOO_MAIL_SENDER': SENDER, 'ODOO_MAIL_UPSTREAM_HOST': 'localhost',
                               'ODOO_MAIL_UPSTREAM_PORT': str(fake.port)})

        def deliver(cfg, sender, recipients, data):
            return relay.deliver_upstream(cfg, sender, recipients, data, self.trust)

        server = relay.RelayServer(('127.0.0.1', 0), config, deliver)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        return fake, server.server_address[1]

    def test_dots_are_unstuffed_once_on_receipt_and_stuffed_once_on_the_way_out(self):
        fake, port = self.start()
        body = f'From: {SENDER}\r\n\r\n.one\r\n..two\r\n...three\r\nplain\r\n'.encode()
        smtp = smtplib.SMTP('127.0.0.1', port, timeout=5)
        self.addCleanup(smtp.close)
        smtp.sendmail(SENDER, ['a@example.org'], body)
        expected = f'From: {SENDER}\r\n\r\n..one\r\n...two\r\n....three\r\nplain\r\n.\r\n'.encode()
        self.assertEqual(fake.wire, [expected])

    def test_a_refused_second_recipient_means_nothing_is_delivered_and_the_client_is_told(self):
        for refusal, code in (('550 no', 554), ('451 later', 451)):
            with self.subTest(refusal=refusal):
                fake, port = self.start(rcpt_codes={'b@example.org': refusal})
                smtp = smtplib.SMTP('127.0.0.1', port, timeout=5)
                self.addCleanup(smtp.close)
                with self.assertRaises(smtplib.SMTPDataError) as raised:
                    smtp.sendmail(SENDER, ['a@example.org', 'b@example.org'], f'From: {SENDER}\r\n\r\nx\r\n'.encode())
                self.assertEqual(raised.exception.smtp_code, code)
                self.assertEqual(fake.wire, [])
