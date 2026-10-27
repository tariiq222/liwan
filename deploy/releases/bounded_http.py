"""One plain-HTTP JSON GET whose whole exchange stays inside a backup ``Deadline``.

``urllib``'s ``timeout`` only bounds each socket operation, so a peer that
trickles bytes keeps a request alive past any budget. Here the connect, every
send and every receive (status line, headers and body) first takes what is
left of the deadline as its socket timeout, the body is read in bounded chunks
up to ``MAX_BODY`` and the deadline is asked after each chunk. A spent deadline
raises ``backup_deadline_exceeded``; the socket is always closed.
"""
import http.client
import io
import json
import socket
from urllib.parse import urlsplit

MAX_BODY = 65536
CHUNK = 4096
SOCKET_CAP = 10  # the usual per-operation bound of a guard request


def _bounded(deadline, operation, *args):
    """Run one socket operation with only what is left of ``deadline``.

    A timeout shorter than the cap is the deadline itself, so it reports the overrun.
    """
    left = deadline.remaining(SOCKET_CAP)
    try:
        return operation(left, *args)
    except socket.timeout:
        if left < SOCKET_CAP: raise ValueError('backup_deadline_exceeded') from None
        raise


class _DeadlineSocket:
    """The socket ``http.client`` sees: every send and receive is bounded by the deadline."""
    def __init__(self, sock, deadline):
        self.sock, self.deadline = sock, deadline

    def _call(self, method, *args):
        def run(left, *values):
            self.sock.settimeout(left)
            return method(*values)
        return _bounded(self.deadline, run, *args)

    def sendall(self, data):
        return self._call(self.sock.sendall, data)

    def makefile(self, mode):
        if mode != 'rb': raise ValueError('http_socket_mode_rejected')
        return io.BufferedReader(_DeadlineReader(self))

    def close(self):
        # ``http.client`` closes its connection while the response still reads from
        # it; the socket is owned and always closed by ``get_json``.
        pass


class _DeadlineReader(io.RawIOBase):
    def __init__(self, owner):
        self.owner = owner

    def readable(self):
        return True

    def readinto(self, buffer):
        return self.owner._call(self.owner.sock.recv_into, buffer)


def _read_body(response, deadline):
    if response.length is not None and response.length > MAX_BODY: raise ValueError('http_body_too_large')
    body = bytearray()
    while True:
        chunk = response.read(CHUNK)
        deadline.remaining()
        if not chunk: break
        body += chunk
        if len(body) > MAX_BODY: raise ValueError('http_body_too_large')
    if response.length: raise ValueError('http_body_incomplete')
    return bytes(body)


def get_json(url, headers, deadline):
    """GET ``url`` with exactly ``headers`` (including ``Host``); only status 200 is accepted."""
    parsed = urlsplit(url)
    if parsed.scheme != 'http' or not parsed.hostname or parsed.query or parsed.fragment:
        raise ValueError('http_url_rejected')
    address = (parsed.hostname, parsed.port or 80)
    raw = _bounded(deadline, lambda left: socket.create_connection(address, timeout=left))
    try:
        connection = http.client.HTTPConnection(*address)
        connection.sock = _DeadlineSocket(raw, deadline)
        connection.putrequest('GET', parsed.path or '/', skip_host=True, skip_accept_encoding=True)
        for key, value in {**headers, 'Connection': 'close'}.items():
            connection.putheader(key, value)
        connection.endheaders()
        response = connection.getresponse()
        try:
            if response.status != 200: raise ValueError('http_status_rejected')
            body = _read_body(response, deadline)
        finally:
            response.close()
    finally:
        raw.close()
    deadline.remaining()
    return json.loads(body)
