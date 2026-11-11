# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Read-only target/process/routing evidence; not policy or authentication proof.

The parent must provide a deadline/output-bounded runner pinned to the approved
local Docker daemon and retain its validated immutable Compose/config snapshot.
This helper performs no database access and never returns raw observation text.
"""
from __future__ import annotations

import json
import math
import os
import re
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import PurePosixPath

OUTPUT_LIMIT = 65536
BODY_LIMIT = 1048576
SERVICES = frozenset({'db', 'odoo', 'web', 'edge'})
IMAGE_ID = re.compile(r'sha256:[0-9a-f]{64}')
REPO_DIGEST = re.compile(r'[a-z0-9][a-z0-9./:_-]{0,440}@sha256:[0-9a-f]{64}')
CONTAINER_ID = re.compile(r'[0-9a-f]{64}')


def _require(condition):
    if not condition:
        message = 'health_unverified'
        raise ValueError(message)


def _unique(pairs):
    value = {}
    for key, item in pairs:
        _require(key not in value)
        value[key] = item
    return value


def _constant(_value):
    _require(False)


def _json(raw):
    return json.loads(raw, object_pairs_hook=_unique, parse_constant=_constant)


def _immutable(value):
    return type(value) is str and bool(IMAGE_ID.fullmatch(value) or REPO_DIGEST.fullmatch(value))


def _validate(descriptor, attempts, delay):
    _require(type(attempts) is int and 1 <= attempts <= 30)
    _require(type(delay) in (int, float) and math.isfinite(delay) and 0 <= delay <= 2)
    _require(type(descriptor) is dict and descriptor.get('commercial_mode') == 'saas')
    resources, release = descriptor['resource_refs'], descriptor['release_ref']
    _require(type(resources) is dict and type(release) is dict)
    project, database = resources['project'], resources['db_name']
    _require(type(project) is str and re.fullmatch(r'[a-z][a-z0-9-]{0,62}', project))
    _require(type(database) is str and re.fullmatch(r'liwan_scratch_[a-z0-9_]{1,42}', database))
    path = resources['compose_file']
    _require(type(path) is str and len(path) <= 4096 and not any(ord(char) < 32 for char in path))
    _require(PurePosixPath(path).is_absolute() and '..' not in PurePosixPath(path).parts)
    ports = resources['ports']
    _require(type(ports) is dict and set(ports) == {'db', 'odoo', 'web'})
    _require(all(type(port) is int and 1024 <= port <= 65535 for port in ports.values()))
    _require(len(set(ports.values())) == 3)
    kind = release['identity_kind']
    _require(kind in ('image_id', 'repo_digest'))
    for key in ('odoo_image', 'web_image', 'proxy_image'):
        _require(_immutable(release[key]))
        _require(bool(IMAGE_ID.fullmatch(release[key])) if kind == 'image_id'
                 else bool(REPO_DIGEST.fullmatch(release[key])))
    return resources, release


def _run(runner, argv):
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
    result = runner(argv, env=env, stdin_text=None)
    _require(type(result) in (tuple, list) and len(result) == 3)
    code, out, err = result
    _require(type(code) is int and code == 0 and type(out) is str and type(err) is str)
    _require(len(out) <= OUTPUT_LIMIT and len(err) <= OUTPUT_LIMIT)
    _require(len(out.encode('utf-8')) <= OUTPUT_LIMIT and len(err.encode('utf-8')) <= OUTPUT_LIMIT)
    return out


def _ports_match(service, ports, actual):
    _require(type(actual) is dict)
    published = {key: value for key, value in actual.items() if value is not None and value != []}
    expected = {
        'db': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(ports['db'])}]},
        'odoo': {'8069/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(ports['odoo'])}]},
        'edge': {'80/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(ports['web'])}]},
        'web': {},
    }
    _require(published == expected[service])


def _containers(resources, release, runner):
    raw = _run(runner, ['docker', 'compose', '-p', resources['project'], '-f', resources['compose_file'],
                        'ps', '--all', '--no-trunc', '--format', 'json'])
    rows = _json(raw) if raw.lstrip().startswith('[') else [_json(line) for line in raw.splitlines() if line.strip()]
    _require(type(rows) is list and len(rows) == 4)
    by_id = {}
    for row in rows:
        _require(type(row) is dict and row.get('Service') in SERVICES and row.get('State') == 'running')
        identifier = row.get('ID')
        _require(type(identifier) is str and CONTAINER_ID.fullmatch(identifier) and identifier not in by_id)
        by_id[identifier] = row['Service']
    _require(set(by_id.values()) == SERVICES)
    inspected = _json(_run(runner, ['docker', 'container', 'inspect', *sorted(by_id)]))
    _require(type(inspected) is list and len(inspected) == 4)
    seen = set()
    expected_images = {'odoo': release['odoo_image'], 'web': release['web_image'], 'edge': release['proxy_image']}
    for row in inspected:
        identifier = row['Id']
        _require(identifier in by_id and identifier not in seen)
        seen.add(identifier)
        service = by_id[identifier]
        _require(row['State']['Running'] is True and row['State']['Status'] == 'running')
        labels = row['Config']['Labels']
        _require(labels['com.docker.compose.project'] == resources['project']
                 and labels['com.docker.compose.service'] == service)
        reference = row['Config']['Image']
        _require(_immutable(reference) and type(row['Image']) is str and IMAGE_ID.fullmatch(row['Image']))
        _require(service == 'db' or reference == expected_images[service])
        image = _json(_run(runner, ['docker', 'image', 'inspect', '--format', '{{json .}}', reference]))
        _require(type(image) is dict and image.get('Id') == row['Image'])
        _require(type(image.get('RepoDigests')) is list
                 and all(type(item) is str and REPO_DIGEST.fullmatch(item) for item in image['RepoDigests']))
        _require(image['Id'] == reference if IMAGE_ID.fullmatch(reference) else reference in image['RepoDigests'])
        _ports_match(service, resources['ports'], row['NetworkSettings']['Ports'])


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _body(opener, url, content_type):
    with opener.open(url, timeout=2) as response:
        _require(response.status == 200 and response.geturl() == url)
        _require(response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() == content_type)
        body = response.read(BODY_LIMIT + 1)
        _require(type(body) is bytes and len(body) <= BODY_LIMIT)
        return body.decode('utf-8')


def _branding(raw):
    value = _json(raw)
    required = {'name', 'logo_url', 'primary_color', 'font'}
    _require(type(value) is dict and set(value) in (required, required | {'secondary_color'}))
    _require(type(value['name']) is str and 1 <= len(value['name'].strip()) <= 1024)
    _require(type(value['font']) is str and 1 <= len(value['font'].strip()) <= 128)
    for key in ('primary_color', 'secondary_color'):
        if key in value:
            _require(type(value[key]) is str and re.fullmatch(r'#[0-9a-fA-F]{6}', value[key]))
    # null when the tenant has no logo of its own (Odoo's stock logo is never exposed).
    _require(value['logo_url'] is None or (type(value['logo_url']) is str and re.fullmatch(
        r'/web/binary/company_logo\?company=[1-9][0-9]{0,18}&v=(?:0|[0-9]{20})-[0-9a-f]{12}', value['logo_url'])))
    return value


class _Login(HTMLParser):
    """Recognize source-owned SSR login elements, not text inside script/comments."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.html = self.root = self.page = self.login = self.password = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        self.html |= tag == 'html'
        self.root |= tag == 'div' and values.get('id') == '__nuxt'
        self.page |= tag == 'main' and 'liwan-login-page' in values.get('class', '').split()
        self.login |= tag == 'input' and values.get('id') == 'login' and values.get('autocomplete') == 'username'
        self.password |= tag == 'input' and values.get('id') == 'password' and values.get('type') == 'password'


def _http(resources, opener):
    ports = resources['ports']
    direct = _branding(_body(opener, f"http://127.0.0.1:{ports['odoo']}/api/v1/branding", 'application/json'))
    edge = _branding(_body(opener, f"http://127.0.0.1:{ports['web']}/api/v1/branding", 'application/json'))
    _require(direct == edge)
    parser = _Login()
    parser.feed(_body(opener, f"http://127.0.0.1:{ports['web']}/login", 'text/html'))
    parser.close()
    _require(parser.html and parser.root and parser.page and parser.login and parser.password)


def health(descriptor: dict, *, runner, opener=None, attempts=15, delay=.5) -> bool:
    """Require running pinned containers, loopback bindings and matching HTTP routes.

    Every retry rechecks container identity before HTTP. The caller's independent
    committed policy readback is still required: public branding is not a unique
    database identity, and this check does not prove login/auth or websocket use.
    """
    try:
        resources, release = _validate(descriptor, attempts, delay)
        if opener is None:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    except Exception:  # noqa: BLE001 - observational failure returns no private diagnostics
        return False
    for attempt in range(attempts):
        try:
            _containers(resources, release, runner)
            _http(resources, opener)
            return True
        except Exception:  # noqa: BLE001 - injected/runtime failures never leak raw content
            if attempt + 1 < attempts:
                time.sleep(delay)
    return False
