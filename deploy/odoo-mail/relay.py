#!/usr/bin/env python3
"""The send-only SMTP relay of the shared overlay: the one way mail leaves Odoo.

Odoo submits a message here over an internal network. The relay checks it and hands it, synchronously, to the ONE
upstream smarthost the operator configured, over STARTTLS. It is not a mail server:

* It relays to a single upstream and to nowhere else. It never delivers locally, never queues to disk, and answers the
  client only after the upstream has answered, so Odoo sees a delivery failure as a failure (the account-link token
  is then marked `failed`). Delivery is all or nothing: if the upstream refuses or defers any recipient, the upstream
  transaction is reset before DATA and nobody receives the message.
* It listens only on the addresses of its internal network: every non-loopback address except the one on the interface
  that holds the default route (the routed edge). Without a default route it refuses to start rather than guess.
* It refuses a message whose envelope sender or `From` header is not the configured platform address, so one tenant
  cannot send as another domain. A mismatch is rejected, not rewritten: a rewrite would deliver a message under an
  identity the sender did not choose, and would hide the misconfiguration. The display name is NOT checked.
* The message must be strict CRLF text: a bare CR, a bare LF, a NUL byte or a terminator other than CRLF.CRLF refuses
  the message and closes the connection (SMTP smuggling). The header block is parsed by hand and must be unambiguous.
* STARTTLS to the upstream is mandatory and its certificate and host name are verified. There is no plaintext path.

Everything comes from the environment (the compose file passes it); nothing is read from or written to disk.
  ODOO_MAIL_SENDER            the platform address, for example no-reply@liwanos.com
  ODOO_MAIL_UPSTREAM_HOST     the smarthost (OCI Email Delivery in Jeddah)
  ODOO_MAIL_UPSTREAM_PORT     default 587
  ODOO_MAIL_UPSTREAM_USER, ODOO_MAIL_UPSTREAM_PASSWORD   both or neither
  ODOO_MAIL_LISTEN_PORT       default 2525
  ODOO_MAIL_MAX_BYTES, ODOO_MAIL_MAX_RECIPIENTS, ODOO_MAIL_MAX_CONNECTIONS
With the sender or the upstream host unset the relay still starts but refuses every message (554), so a missing
setting is visible in Odoo's log and never silently drops or misroutes mail.

Time budget. Odoo's SMTP client waits at most 60 s for each answer (`SMTP_TIMEOUT` in
odoo/addons/base/models/ir_mail_server.py). The whole upstream delivery therefore has a hard limit of
UPSTREAM_TOTAL_TIMEOUT (40 s, connect included), after which the upstream socket is cut and the client gets 451. If
that limit were ever raised above Odoo's, Odoo would give up on a message the upstream may still deliver, and a retry
would send a duplicate.

    python3 relay.py                 run the relay
    python3 relay.py --healthcheck   connect to its own listener and expect the 220 greeting
"""
from __future__ import annotations

import fcntl
import logging
import os
import re
import signal
import smtplib
import socket
import socketserver
import ssl
import struct
import sys
import threading
import time

LOG = logging.getLogger('odoo-mail')

GREETING_HOST = 'odoo-mail'
IDLE_TIMEOUT = 60
CONNECTION_DEADLINE = 600
DATA_DEADLINE = 120
UPSTREAM_OP_TIMEOUT = 10
UPSTREAM_TOTAL_TIMEOUT = 40
MAX_LINE = 8192
RECV_SIZE = 16384
MAX_REPLY_LINES = 50
MAX_REPLY_BYTES = 16384
MAX_HEADER_BYTES = 65536
SIOCGIFADDR = 0x8915

_ADDR = r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+'
ADDRESS = re.compile(rf'^{_ADDR}$')
HOSTNAME = re.compile(r'^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$')
MAIL_COMMAND = re.compile(r'^MAIL FROM:\s*<([^<>\s]*)>((?:\s+[A-Za-z0-9-]+(?:=\S*)?)*)\s*$', re.IGNORECASE)
RCPT_COMMAND = re.compile(r'^RCPT TO:\s*<([^<>\s,;"@]+@[^<>\s,;"@]+)>\s*$', re.IGNORECASE)
HEADER_LINE = re.compile(rb'^([!-9;-~]+):(.*)$', re.DOTALL)
# One mailbox: an optional display name (a quoted string, or plain words and encoded words) and an address in angle
# brackets, or a bare address. No comment, group, list or route is accepted.
MAILBOX = re.compile(
    rf'^\s*(?:(?:"(?:[^"\\]|\\.)*"|[A-Za-z0-9!#$%&\'*+/=?^_`{{|}}~. -]+)?\s*<({_ADDR})>|({_ADDR}))\s*$')
UPSTREAM_ERRORS = (smtplib.SMTPException, ssl.SSLError, OSError, ValueError)  # ValueError: an SSL socket the watchdog cut
IDENTITY_HEADERS = ('sender', 'resent-from', 'resent-sender', 'return-path')


class ConfigError(Exception):
    """A setting is present but unusable: the relay stops at start instead of guessing."""


class UpstreamError(Exception):
    """The upstream cannot take this message; ``code`` and ``text`` are what the client is told."""

    def __init__(self, code, text):
        super().__init__(text)
        self.code = code
        self.text = text


class BadData(Exception):
    """The DATA section is not strict CRLF text. The message is refused and the connection closed."""


class Config:
    """The relay's settings. ``ready`` is false while the sender or the upstream host is unset."""

    def __init__(self, environ):
        self.sender = (environ.get('ODOO_MAIL_SENDER') or '').strip().lower()
        self.host = (environ.get('ODOO_MAIL_UPSTREAM_HOST') or '').strip()
        self.user = environ.get('ODOO_MAIL_UPSTREAM_USER') or ''
        self.password = environ.get('ODOO_MAIL_UPSTREAM_PASSWORD') or ''
        self.port = self._number(environ, 'ODOO_MAIL_UPSTREAM_PORT', 587, 1, 65535)
        self.listen_port = self._number(environ, 'ODOO_MAIL_LISTEN_PORT', 2525, 1024, 65535)
        self.max_bytes = self._number(environ, 'ODOO_MAIL_MAX_BYTES', 10 * 1024 * 1024, 1024, 100 * 1024 * 1024)
        self.max_recipients = self._number(environ, 'ODOO_MAIL_MAX_RECIPIENTS', 50, 1, 500)
        self.max_connections = self._number(environ, 'ODOO_MAIL_MAX_CONNECTIONS', 8, 1, 64)
        if self.sender and not ADDRESS.match(self.sender):
            raise ConfigError('ODOO_MAIL_SENDER is not a plain address')
        if self.host and not HOSTNAME.match(self.host):
            raise ConfigError('ODOO_MAIL_UPSTREAM_HOST is not a host name')
        if bool(self.user) != bool(self.password):
            raise ConfigError('ODOO_MAIL_UPSTREAM_USER and ODOO_MAIL_UPSTREAM_PASSWORD are set together or not at all')

    @staticmethod
    def _number(environ, name, default, low, high):
        raw = (environ.get(name) or '').strip()
        if not raw:
            return default
        if not raw.isdigit() or not low <= int(raw) <= high:
            raise ConfigError(f'{name} must be a whole number from {low} to {high}')
        return int(raw)

    @property
    def ready(self):
        return bool(self.sender and self.host)


def default_route_interface(route_table):
    """The interface that holds the default route in the text of /proc/net/route, or None."""
    for line in route_table.splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 8 and fields[1] == '00000000' and fields[7] == '00000000':
            return fields[0]
    return None


def interface_addresses():
    """``[(interface name, IPv4 address)]`` of this container (Linux ioctl; the standard library has no getifaddrs)."""
    found = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        for _, name in socket.if_nameindex():
            try:
                packed = fcntl.ioctl(probe.fileno(), SIOCGIFADDR, struct.pack('256s', name.encode()[:15]))
            except OSError:
                continue
            found.append((name, socket.inet_ntoa(packed[20:24])))
    return found


def listen_addresses(route_table, addresses):
    """Every non-loopback address except the routed interface's own. No default route means no address: fail closed."""
    routed = default_route_interface(route_table)
    if routed is None:
        return []
    return [address for name, address in addresses if name != routed and not address.startswith('127.')]


def current_listen_addresses():
    with open('/proc/net/route', encoding='ascii') as table:
        return listen_addresses(table.read(), interface_addresses())


def has_high_bytes(data):
    return any(byte > 127 for byte in data)


def split_headers(data):
    """The header block as ``[(lower-case name, value bytes)]``, or ValueError when the block is ambiguous."""
    block = data.split(b'\r\n\r\n', 1)[0]
    if block.endswith(b'\r\n'):
        block = block[:-2]
    if len(block) > MAX_HEADER_BYTES:
        raise ValueError('the header block is too large')
    headers = []
    for line in block.split(b'\r\n'):
        if line[:1] in (b' ', b'\t'):
            if not headers:
                raise ValueError('the header block starts with a continuation line')
            headers[-1][1] += line
            continue
        match = HEADER_LINE.match(line)
        if not match:
            raise ValueError('a header line is not "Name: value"')
        headers.append([match.group(1).decode('ascii').lower(), match.group(2)])
    return headers


def mailbox_address(value):
    """The one address of a single-mailbox field value (bytes), lower-cased, or None for anything else."""
    try:
        text = value.decode('ascii')
    except UnicodeDecodeError:
        return None
    match = MAILBOX.match(text) if len(text) <= 1000 else None
    return (match.group(1) or match.group(2)).lower() if match else None


def check_message(data, sender):
    """Return ``None`` when the message names the platform address as its only author, else the reason."""
    try:
        headers = split_headers(data)
    except ValueError as error:
        return str(error)
    authors = [value for name, value in headers if name == 'from']
    if len(authors) != 1:
        return 'exactly one From header is required'
    if mailbox_address(authors[0]) != sender:
        return 'the From header is not the platform address'
    for name, value in headers:
        if name == 'return-path' and not value.strip():
            continue  # stock mail.mail writes an empty one when no bounce address is set; it names nobody
        if name in IDENTITY_HEADERS and mailbox_address(value) != sender:
            return f'the {name} header is not the platform address'
    return None


def abort_connection(box):
    """Cut the upstream socket from the watchdog thread: shutdown wakes a blocked read, close frees it."""
    for upstream in box:
        sock = upstream.sock
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()


class _ReplyReader:
    """The upstream's reply stream, with a cap on the lines and bytes of one reply (smtplib has none)."""

    def __init__(self, stream):
        self.stream, self.lines, self.size = stream, 0, 0

    def begin(self):
        self.lines = self.size = 0

    def readline(self, limit=-1):
        line = self.stream.readline(limit)
        self.lines += 1
        self.size += len(line)
        if self.lines > MAX_REPLY_LINES or self.size > MAX_REPLY_BYTES:
            raise OSError('upstream reply too long')
        return line

    def close(self):
        self.stream.close()


class _WatchedSMTP(smtplib.SMTP):
    """An SMTP client on the watchdog's list before it connects (so even the banner read can be cut), with capped replies."""

    def __init__(self, box, *args, **kwargs):
        box.append(self)
        super().__init__(*args, **kwargs)

    def getreply(self):
        if self.file is None:
            self.file = _ReplyReader(self.sock.makefile('rb'))
        self.file.begin()
        return super().getreply()


def _refusal(code, text):
    """The answer the client gets for an upstream reply code: 4xx (or an unparsable reply) defers, anything else rejects."""
    if code < 0 or 400 <= code < 500:
        return UpstreamError(451, f'4.4.1 {text} (deferred)')
    return UpstreamError(554, f'5.7.1 {text}')


def _bound(upstream, deadline):
    """Give the upstream socket (plain or wrapped) at most the time left as its timeout, so a handshake cannot outlive it."""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise OSError('upstream deadline')
    upstream.sock.settimeout(min(UPSTREAM_OP_TIMEOUT, remaining))


def _transaction(config, upstream, sender, recipients, data, context, deadline):
    eight_bit = has_high_bytes(data)
    upstream.ehlo()
    if not upstream.has_extn('starttls'):
        raise UpstreamError(454, '4.7.0 upstream does not offer STARTTLS')
    _bound(upstream, deadline)
    upstream.starttls(context=context or ssl.create_default_context())
    _bound(upstream, deadline)
    upstream.ehlo()
    if config.user:
        upstream.login(config.user, config.password)
    if eight_bit and not upstream.has_extn('8bitmime'):
        raise UpstreamError(554, '5.6.1 upstream does not accept 8-bit text')
    code, _ = upstream.mail(sender, ['BODY=8BITMIME'] if eight_bit else [])
    if code != 250:
        raise _refusal(code, 'upstream refused the sender')
    refused = [code for code in (upstream.rcpt(item)[0] for item in recipients) if code not in (250, 251)]
    if refused:
        upstream.rset()
        raise _refusal(max(450 if code < 0 else code for code in refused), 'upstream refused a recipient')
    code, _ = upstream.data(data)
    if code != 250:
        raise _refusal(code, 'upstream rejected the message')


def deliver_upstream(config, sender, recipients, data, context=None):
    """Hand one message to the upstream over verified STARTTLS, to all recipients or to none.

    ``data`` is unstuffed CRLF text; smtplib dot-stuffs it once on the way out. The whole call is cut after
    UPSTREAM_TOTAL_TIMEOUT. Every failure is an UpstreamError with a fixed text; no address or reply text leaks.
    """
    box = []
    deadline = time.monotonic() + UPSTREAM_TOTAL_TIMEOUT
    timer = threading.Timer(UPSTREAM_TOTAL_TIMEOUT, abort_connection, [box])
    timer.daemon = True
    timer.start()
    try:
        upstream = _WatchedSMTP(box, config.host, config.port, timeout=UPSTREAM_OP_TIMEOUT)
        try:
            _transaction(config, upstream, sender, recipients, data, context, deadline)
        finally:
            try:
                upstream.quit()
            except UPSTREAM_ERRORS:
                pass
            try:
                upstream.close()
            except UPSTREAM_ERRORS:
                pass
    except UpstreamError:
        raise
    except smtplib.SMTPAuthenticationError:
        raise UpstreamError(454, '4.7.0 upstream refused the relay credentials') from None
    except smtplib.SMTPNotSupportedError:
        raise UpstreamError(454, '4.7.0 upstream does not offer authentication') from None
    except smtplib.SMTPResponseException as error:
        LOG.warning('upstream answered %s', error.smtp_code)
        raise _refusal(error.smtp_code, 'upstream rejected the message') from None
    except UPSTREAM_ERRORS as error:
        LOG.warning('upstream unavailable: %s', type(error).__name__)
        raise UpstreamError(451, '4.4.1 upstream unavailable') from None
    except Exception as error:  # noqa: BLE001 - whatever happens maps to one fixed answer, never a traceback
        LOG.warning('unexpected failure: %s', type(error).__name__)
        raise UpstreamError(451, '4.3.0 internal error') from None
    finally:
        timer.cancel()


class Session(socketserver.BaseRequestHandler):
    """One SMTP conversation: EHLO, then any number of MAIL, RCPT, DATA transactions.

    Reading is done here, not by a file object, so the remaining connection and DATA time is applied to every recv:
    a client that sends one byte at a time is cut at the deadline.
    """

    def setup(self):
        self.buffer = bytearray()
        self.position = 0

    def handle(self):
        self.deadline = time.monotonic() + CONNECTION_DEADLINE
        try:
            self.converse()
        except OSError:
            pass
        except Exception as error:  # noqa: BLE001 - one fixed answer, then the connection closes
            LOG.warning('session failed: %s', type(error).__name__)
            try:
                self.reply(451, '4.3.0 internal error')
            except OSError:
                pass

    def reply(self, code, text, more=False):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise ConnectionError('deadline')
        self.request.settimeout(min(IDLE_TIMEOUT, remaining))
        self.request.sendall(f'{code}{"-" if more else " "}{text}\r\n'.encode('ascii'))

    def reset(self):
        self.mail_from = None
        self.recipients = []

    def take(self, end):
        line = bytes(self.buffer[self.position:end])
        self.position = end
        if self.position == len(self.buffer):
            self.buffer.clear()
            self.position = 0
        elif self.position > RECV_SIZE * 4:
            del self.buffer[:self.position]
            self.position = 0
        return line

    def read_line(self, deadline):
        limit = min(deadline, self.deadline)
        while True:
            end = self.buffer.find(b'\n', self.position)
            if end >= 0:
                if end + 1 - self.position > MAX_LINE + 1:
                    self.reply(500, '5.5.2 line too long')
                    raise ConnectionError('line too long')
                return self.take(end + 1)
            if len(self.buffer) - self.position > MAX_LINE:
                self.reply(500, '5.5.2 line too long')
                raise ConnectionError('line too long')
            remaining = limit - time.monotonic()
            if remaining <= 0:
                raise ConnectionError('deadline')
            self.request.settimeout(min(IDLE_TIMEOUT, remaining))
            chunk = self.request.recv(RECV_SIZE)
            if not chunk:
                return self.take(len(self.buffer))
            self.buffer += chunk

    def converse(self):
        self.greeted = False
        self.reset()
        self.reply(220, f'{GREETING_HOST} ESMTP send-only relay')
        while True:
            raw = self.read_line(self.deadline)
            if not raw:
                return
            if any(byte < 0x20 or byte > 0x7e for byte in raw.rstrip(b'\r\n')):
                self.reply(501, '5.5.2 printable ASCII only')
                continue
            command = raw.decode('ascii').strip()
            verb = command.split(' ', 1)[0].upper()
            if verb in ('EHLO', 'HELO'):
                self.greeted = True
                self.reset()
                self.reply(250, GREETING_HOST, more=verb == 'EHLO')
                if verb == 'EHLO':
                    self.reply(250, f'SIZE {self.server.config.max_bytes}', more=True)
                    self.reply(250, '8BITMIME')
            elif verb == 'MAIL':
                self.on_mail(command)
            elif verb == 'RCPT':
                self.on_rcpt(command)
            elif verb == 'DATA':
                if self.on_data():
                    return
            elif verb == 'RSET':
                self.reset()
                self.reply(250, '2.0.0 ok')
            elif verb == 'NOOP':
                self.reply(250, '2.0.0 ok')
            elif verb == 'QUIT':
                self.reply(221, '2.0.0 bye')
                return
            else:
                self.reply(502, '5.5.1 command not implemented')

    def on_mail(self, command):
        config = self.server.config
        if not self.greeted:
            return self.reply(503, '5.5.1 say EHLO first')
        if self.mail_from is not None:
            return self.reply(503, '5.5.1 a transaction is already open')
        if not config.ready:
            return self.reply(554, '5.3.2 the mail relay is not configured')
        match = MAIL_COMMAND.match(command)
        if not match:
            return self.reply(501, '5.5.4 syntax: MAIL FROM:<address>')
        if match.group(1).lower() != config.sender:
            return self.reply(553, '5.7.1 sender address not permitted')
        size = 0
        for parameter in match.group(2).split():
            name, _, value = parameter.partition('=')
            name = name.upper()
            if name == 'SIZE':
                if not (value.isdigit() and len(value) <= 10):
                    return self.reply(501, '5.5.4 SIZE is a decimal number')
                size = int(value)
            elif not (name == 'BODY' and value.upper() in ('7BIT', '8BITMIME')):
                return self.reply(555, '5.5.4 parameter not supported')
        if size > config.max_bytes:
            return self.reply(552, '5.3.4 message too large')
        self.mail_from = config.sender
        self.reply(250, '2.1.0 ok')

    def on_rcpt(self, command):
        if self.mail_from is None:
            return self.reply(503, '5.5.1 need MAIL first')
        match = RCPT_COMMAND.match(command)
        if not match:
            return self.reply(501, '5.5.4 syntax: RCPT TO:<address>')
        if len(self.recipients) >= self.server.config.max_recipients:
            return self.reply(452, '4.5.3 too many recipients')
        self.recipients.append(match.group(1))
        self.reply(250, '2.1.5 ok')

    def read_data(self):
        """The message, strict CRLF, dot-stuffing removed once; None when it passed the size limit (rest discarded).

        The lines are appended to one bytearray as they are validated, so a message of millions of tiny lines costs
        about its own size, not one object per line.
        """
        limit = self.server.config.max_bytes
        deadline = time.monotonic() + DATA_DEADLINE
        body, total, over = bytearray(), 0, False
        while True:
            line = self.read_line(deadline)
            if not line:
                raise ConnectionError('closed inside DATA')
            if not line.endswith(b'\r\n') or b'\r' in line[:-2] or b'\x00' in line:
                raise BadData
            if line == b'.\r\n':
                return None if over else bytes(body)
            if line.startswith(b'.'):
                line = line[1:]
            total += len(line)
            if total > 4 * limit:
                raise ConnectionError('too much data')
            if total > limit:
                over = True
                body.clear()
            elif not over:
                body += line

    def on_data(self):
        """Take one message. Returns true when the connection must close."""
        if not self.recipients:
            self.reply(503, '5.5.1 need RCPT first')
            return False
        self.reply(354, 'end data with <CR><LF>.<CR><LF>')
        try:
            data = self.read_data()
        except BadData:
            LOG.warning('refused a message: not strict CRLF text')
            self.reply(554, '5.6.0 the message is not strict CRLF text')
            return True
        sender, recipients = self.mail_from, self.recipients
        self.reset()
        if data is None:
            self.reply(552, '5.3.4 message too large')
            return False
        problem = check_message(data, sender)
        if problem:
            LOG.warning('refused a message: %s', problem)
            self.reply(554, f'5.7.1 {problem}')
            return False
        try:
            self.server.deliver(self.server.config, sender, recipients, data)
        except UpstreamError as error:
            LOG.warning('not delivered: %s', error.text)
            self.reply(error.code, error.text)
            return False
        LOG.info('delivered %d bytes to %d recipients', len(data), len(recipients))
        self.reply(250, '2.0.0 accepted')
        return False


class RelayServer(socketserver.TCPServer):
    """A TCP server with at most ``max_connections`` handler threads; a connection beyond that is answered 421 inline."""

    allow_reuse_address = True

    def __init__(self, address, config, deliver=deliver_upstream):
        super().__init__(address, Session)
        self.config = config
        self.deliver = deliver
        self.slots = threading.BoundedSemaphore(config.max_connections)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.refuse(request)
            return
        threading.Thread(target=self.run_session, args=(request, client_address), daemon=True).start()

    def run_session(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception as error:  # noqa: BLE001 - a thread must not die with a traceback, whatever the cause
            LOG.warning('connection failed: %s', type(error).__name__)
        finally:
            self.shutdown_request(request)
            self.slots.release()

    def refuse(self, request):
        try:
            request.settimeout(2)
            request.sendall(b'421 4.3.2 too many connections\r\n')
        except OSError:
            pass
        finally:
            self.shutdown_request(request)


def healthcheck(config):
    addresses = current_listen_addresses()
    if not addresses:
        return 1
    try:
        with socket.create_connection((addresses[0], config.listen_port), timeout=3) as probe:
            return 0 if probe.recv(3) == b'220' else 1
    except OSError:
        return 1


def serve(config):
    addresses = current_listen_addresses()
    if not addresses:
        raise ConfigError('no default route or no internal interface to listen on')
    servers = [RelayServer((address, config.listen_port), config) for address in addresses]
    stop = threading.Event()
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    if config.ready:
        LOG.info('relaying to %s:%d as %s, listening on %s', config.host, config.port, config.sender, ', '.join(addresses))
    else:
        LOG.error('ODOO_MAIL_SENDER or ODOO_MAIL_UPSTREAM_HOST is not set: every message is refused until it is')
    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, lambda *_: stop.set())
    stop.wait()
    for server in servers:
        server.shutdown()
        server.server_close()


def main(argv):
    logging.basicConfig(level=logging.INFO, format='%(asctime)s odoo-mail %(levelname)s %(message)s')
    try:
        config = Config(os.environ)
        if argv == ['--healthcheck']:
            return healthcheck(config)
        if argv:
            sys.stderr.write('usage: relay.py [--healthcheck]\n')
            return 2
        serve(config)
    except ConfigError as error:
        sys.stderr.write(f'odoo-mail: {error}\n')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
