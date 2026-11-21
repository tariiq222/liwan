#!/usr/bin/env python3
"""Edge check for the development host: certificates, HTTPS answers (``GET /favicon.ico``, answered through guard and web), Openship routes and the nginx vhost headers.

  edge_check.py --host app.example.com --route-file /path/x.route.json --vhost-file /etc/nginx/conf.d/x.conf \
                --cert-file /srv/liwan-development/control/private/control-tls.crt

One line per failed check and a non-zero exit; ``RESULT: edge ok`` and exit 0 when every check passes. At least one
``--host``, ``--route-file``, ``--vhost-file`` or ``--cert-file`` is required. Standalone: release.py never calls it.
"""
from __future__ import annotations

import argparse
import http.client
import json
import socket
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_TARGET = 'http://127.0.0.1:18080'
DEFAULT_MIN_DAYS = 21
TIMEOUT_SECONDS = 10
# Every way a check can fail without a verdict: network and TLS (OSError covers DNS, refused, reset, TLS and URL errors), a
# malformed HTTP answer, an unparsable date or JSON or text encoding, a missing certificate field, an `openssl` failure.
CHECK_ERRORS = (OSError, ValueError, KeyError, http.client.HTTPException, subprocess.SubprocessError)
# The host check GETs this path: a static file the web container serves, which the guard allows on a host with no tenant
# (prospectRoutes in deploy/shared/guard.mjs) as on a tenant host. `/` is refused there with 403 forbidden_route.
HTTPS_PROBE_PATH = '/favicon.ico'
VHOST_DIRECTIVES = ('proxy_set_header Host $host', '$proxy_add_x_forwarded_for', '$http_upgrade')


def https_status(host: str) -> int:
    """The status of ``GET https://<host>`` + ``HTTPS_PROBE_PATH`` with certificate verification; redirects are not followed."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(f'https://{host}{HTTPS_PROBE_PATH}', timeout=TIMEOUT_SECONDS) as response:
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


def file_certificate_expiry(path: str) -> datetime:
    """``notAfter`` of a PEM certificate file, read with ``openssl x509`` (the standard library has no public PEM reader)."""
    result = subprocess.run(['openssl', 'x509', '-enddate', '-noout', '-in', path], capture_output=True, text=True,
                            timeout=TIMEOUT_SECONDS, check=True)
    not_after = result.stdout.strip().removeprefix('notAfter=')
    return datetime.fromtimestamp(ssl.cert_time_to_seconds(not_after), tz=timezone.utc)


def read_text(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def check_expiry(name: str, expiry, min_days: int, today) -> list[str]:
    try:
        days = (expiry(name) - today()).days
    except CHECK_ERRORS as error:
        return [f'{name}: certificate unreadable ({error})']
    return [f'{name}: certificate has {days} days left, need {min_days}'] if days < min_days else []


def check_host(host: str, min_days: int, status=https_status, expiry=certificate_expiry, today=utc_now) -> list[str]:
    failures = []
    try:
        code = status(host)
        if not 200 <= code < 400:
            failures.append(f'{host}: HTTPS answered {code}')
    except CHECK_ERRORS as error:
        failures.append(f'{host}: HTTPS failed ({error})')
    return failures + check_expiry(host, expiry, min_days, today)


def check_route(path: str, target: str, read=read_text) -> list[str]:
    try:
        found = json.loads(read(path)).get('targetUrl')
    except (*CHECK_ERRORS, AttributeError) as error:
        return [f'{path}: route file unreadable ({error})']
    return [] if found == target else [f'{path}: targetUrl is {found!r}, expected {target!r}']


def check_vhost(path: str, read=read_text) -> list[str]:
    try:
        text = read(path)
    except CHECK_ERRORS as error:
        return [f'{path}: vhost file unreadable ({error})']
    return [f'{path}: missing "{directive}"' for directive in VHOST_DIRECTIVES if directive not in text]


def parse_args(argv):
    parser = argparse.ArgumentParser(description=(__doc__ or '').split('\n', 1)[0])
    parser.add_argument('--host', action='append', default=[])
    parser.add_argument('--min-days', type=int, default=DEFAULT_MIN_DAYS)
    parser.add_argument('--route-file', action='append', default=[])
    parser.add_argument('--target', default=DEFAULT_TARGET)
    parser.add_argument('--vhost-file', action='append', default=[])
    parser.add_argument('--cert-file', action='append', default=[], help='PEM certificate that needs --min-days left')
    args = parser.parse_args(argv)
    if not (args.host or args.route_file or args.vhost_file or args.cert_file):
        parser.error('nothing to check: pass --host, --route-file, --vhost-file or --cert-file')
    return args


def main(argv=None, out=sys.stdout, status=https_status, expiry=certificate_expiry, file_expiry=file_certificate_expiry,
         today=utc_now) -> int:
    args = parse_args(argv)
    failures = [line for host in args.host for line in check_host(host, args.min_days, status, expiry, today)]
    failures += [line for path in args.cert_file for line in check_expiry(path, file_expiry, args.min_days, today)]
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
