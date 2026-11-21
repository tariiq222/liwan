#!/usr/bin/env python3
"""Edge check for the development host: certificates, HTTPS answers, Openship routes and the nginx vhost headers.

  edge_check.py --host app.example.com --route-file /path/x.route.json --vhost-file /etc/nginx/conf.d/x.conf

One line per failed check and a non-zero exit; ``RESULT: edge ok`` and exit 0 when every check passes. Standalone:
release.py never calls it.
"""
from __future__ import annotations

import argparse
import json
import socket
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_TARGET = 'http://127.0.0.1:18080'
DEFAULT_MIN_DAYS = 21
TIMEOUT_SECONDS = 10
VHOST_DIRECTIVES = ('proxy_set_header Host $host', '$proxy_add_x_forwarded_for', '$http_upgrade')


def https_status(host: str) -> int:
    """The status of ``GET https://<host>/`` with certificate verification; redirects are not followed."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(f'https://{host}/', timeout=TIMEOUT_SECONDS) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def certificate_expiry(host: str) -> datetime:
    """``notAfter`` of the certificate the host presents, from a verified TLS handshake."""
    context = ssl.create_default_context()
    with socket.create_connection((host, 443), timeout=TIMEOUT_SECONDS) as sock:
        with context.wrap_socket(sock, server_hostname=host) as tls:
            not_after = tls.getpeercert()['notAfter']
    return datetime.fromtimestamp(ssl.cert_time_to_seconds(not_after), tz=timezone.utc)


def read_text(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def check_host(host: str, min_days: int, status=https_status, expiry=certificate_expiry,
               today=lambda: datetime.now(timezone.utc)) -> list[str]:
    failures = []
    try:
        code = status(host)
        if not 200 <= code < 400:
            failures.append(f'{host}: HTTPS answered {code}')
    except (OSError, ssl.SSLError, urllib.error.URLError) as error:
        failures.append(f'{host}: HTTPS failed ({error})')
    try:
        days = (expiry(host) - today()).days
        if days < min_days:
            failures.append(f'{host}: certificate has {days} days left, need {min_days}')
    except (OSError, ssl.SSLError, KeyError) as error:
        failures.append(f'{host}: certificate unreadable ({error})')
    return failures


def check_route(path: str, target: str, read=read_text) -> list[str]:
    try:
        found = json.loads(read(path)).get('targetUrl')
    except (OSError, ValueError, AttributeError) as error:
        return [f'{path}: route file unreadable ({error})']
    return [] if found == target else [f'{path}: targetUrl is {found!r}, expected {target!r}']


def check_vhost(path: str, read=read_text) -> list[str]:
    try:
        text = read(path)
    except OSError as error:
        return [f'{path}: vhost file unreadable ({error})']
    return [f'{path}: missing "{directive}"' for directive in VHOST_DIRECTIVES if directive not in text]


def parse_args(argv):
    parser = argparse.ArgumentParser(description=(__doc__ or '').split('\n', 1)[0])
    parser.add_argument('--host', action='append', default=[])
    parser.add_argument('--min-days', type=int, default=DEFAULT_MIN_DAYS)
    parser.add_argument('--route-file', action='append', default=[])
    parser.add_argument('--target', default=DEFAULT_TARGET)
    parser.add_argument('--vhost-file', action='append', default=[])
    return parser.parse_args(argv)


def main(argv=None, out=sys.stdout, **checks) -> int:
    args = parse_args(argv)
    failures = [line for host in args.host for line in check_host(host, args.min_days, **checks)]
    failures += [line for path in args.route_file for line in check_route(path, args.target)]
    failures += [line for path in args.vhost_file for line in check_vhost(path)]
    for line in failures:
        out.write(line + '\n')
    if failures:
        return 1
    out.write('RESULT: edge ok\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
