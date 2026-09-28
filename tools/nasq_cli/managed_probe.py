# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Read-only, fail-closed observations for the narrow managed-create contract.

No subprocess default is provided. The injected runner must use shell=False,
apply a hard timeout, and reject/truncate oversized output as a failure (not a
successful partial observation). Only fixed Docker list/image-inspect argv are
emitted. No database is contacted. See managed-probe-tdd.md for the deliberately
conservative JSON Compose/config contract and time-of-check limitations.
"""
from __future__ import annotations

import configparser
import copy
import errno
import hashlib
import hmac
import json
import os
import re
import socket
import stat
from pathlib import Path

from .managed_bundle import CADDYFILE

MAX_BYTES = 1024 * 1024
MAX_ROWS = 10000
IMAGE_ID = re.compile(r'sha256:[0-9a-f]{64}\Z')
REPO_DIGEST = re.compile(r'[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}\Z')
PROJECT_RE = re.compile(r'[a-z][a-z0-9-]{0,62}\Z')
DB_RE = re.compile(r'nasq_scratch_[a-z0-9_]{1,42}\Z')
SERVICES = {'db', 'odoo', 'web', 'edge'}


class ProbeError(Exception):
    """Sanitized refusal; neither messages nor codes include observed content."""

    def __init__(self, code):
        allowed = {
            'preflight_unavailable', 'probe_malformed', 'probe_unknown',
            'probe_value_invalid', 'compose_file_invalid',
            'image_identity_untrusted', 'database_absence_unverified',
        }
        self.code = code if code in allowed else 'probe_malformed'
        super().__init__(self.code)


def _refuse(code):
    raise ProbeError(code) from None


def _require(condition, code='compose_file_invalid'):
    if not condition:
        _refuse(code)


def _unique(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, 'probe_malformed')
        result[key] = value
    return result


def _json(raw):
    try:
        return json.loads(raw, object_pairs_hook=_unique)
    except (ValueError, TypeError, RecursionError):
        _refuse('probe_malformed')


def _plain_path(path):
    """Refuse symlinks in every existing component, including parent paths."""
    candidate = Path(path)
    _require(candidate.is_absolute() and '..' not in candidate.parts)
    _require(not any(part.is_symlink() for part in (candidate, *candidate.parents)))
    return candidate


def _private_read(path):
    candidate = _plain_path(path)
    try:
        info = candidate.stat()
        _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                 and not info.st_mode & 0o022 and info.st_size <= MAX_BYTES)
        with candidate.open('rb') as stream:
            raw = stream.read(MAX_BYTES + 1)
        _require(len(raw) <= MAX_BYTES)
        return raw
    except OSError:
        _refuse('preflight_unavailable')


class DockerProbe:
    """Descriptor-bound callable used by managed_runtime.preflight.

    Constructor does no observation. Each call re-reads relevant inputs; no
    negative resource observation is cached across calls. Caller validates the
    complete enrollment/digest and maps ProbeError to a pre-effect conflict.
    """

    def __init__(self, descriptor, *, catalog_path, runner):
        self.descriptor = copy.deepcopy(descriptor)
        self.catalog_path = Path(catalog_path)
        self.runner = runner
        self._capturing = None
        self._approved_snapshot = None
        try:
            self.resources = self.descriptor['resource_refs']
            self.release = self.descriptor['release_ref']
            self.project = self.resources['project']
            _require(isinstance(self.project, str) and PROJECT_RE.fullmatch(self.project), 'probe_value_invalid')
            _require(DB_RE.fullmatch(self.resources['db_name']), 'probe_value_invalid')
        except (KeyError, TypeError, ValueError):
            _refuse('probe_value_invalid')

    def __call__(self, check, value=None):
        try:
            return self._check(check, value)
        except ProbeError:
            raise
        except (OSError, UnicodeError):
            _refuse('preflight_unavailable')
        except (TypeError, ValueError, KeyError, AttributeError, RecursionError):
            _refuse('probe_malformed')

    def _input_bytes(self, path):
        raw = _private_read(path)
        if self._capturing is not None:
            self._capturing[str(Path(path))] = 'sha256:' + hashlib.sha256(raw).hexdigest()
        return raw

    def validate_runtime_inputs(self, secrets):
        """Validate secret bindings and snapshot every approved input; no Docker."""
        self._approved_snapshot = None
        self._capturing = {}
        try:
            self._compose(observe_image=False)
            options = self._validated_options
            _require(isinstance(secrets, dict), 'probe_value_invalid')
            for option, secret in [('db_password', 'db_password'), ('admin_passwd', 'admin_password')]:
                value = secrets.get(secret)
                _require(isinstance(value, str) and value, 'probe_value_invalid')
                _require(hmac.compare_digest(options[option].encode('utf-8'), value.encode('utf-8')), 'probe_value_invalid')
            snapshot = dict(self._capturing)
            self._approved_snapshot = dict(snapshot)
            self.assert_unchanged(snapshot)
            return snapshot
        except ProbeError:
            raise
        except (OSError, UnicodeError, KeyError, TypeError, ValueError, AttributeError):
            _refuse('probe_malformed')
        finally:
            self._capturing = None
            self._validated_options = None

    def assert_unchanged(self, snapshot):
        """Re-read only this instance's approved files; unknown snapshot refused."""
        _require(isinstance(snapshot, dict) and bool(snapshot)
                 and snapshot == self._approved_snapshot, 'probe_value_invalid')
        for path, digest in snapshot.items():
            raw = _private_read(path)
            _require('sha256:' + hashlib.sha256(raw).hexdigest() == digest, 'compose_file_invalid')

    def _check(self, check, value):
        expected = {
            'catalog_sha256': self.release['catalog_version'],
            'compose_file': self.resources['compose_file'],
            'database_exists': self.resources['db_name'],
            'project_exists': self.project,
            'volume_exists': self.project + '-db',
            'network_exists': self.project + '-private',
        }
        if check == 'image_identity':
            _require(value in [self.release[key] for key in ('odoo_image', 'web_image', 'proxy_image')], 'probe_value_invalid')
            return self._image(value, self.release['identity_kind'])
        if check == 'port_in_use':
            _require(type(value) is int and value in self.resources['ports'].values()
                     and 1024 <= value <= 65535, 'probe_value_invalid')
            return self._port(value)
        _require(check in expected, 'probe_unknown')
        _require(value == expected[check], 'probe_value_invalid')
        if check == 'catalog_sha256':
            return 'sha256:' + hashlib.sha256(_private_read(self.catalog_path)).hexdigest()
        if check == 'compose_file':
            self._compose()
            return True
        if check == 'database_exists':
            self._database_absent()
            return False
        if check == 'project_exists':
            return self._project_exists()
        return self._resource_exists('volume' if check == 'volume_exists' else 'network', value)

    def _run(self, argv):
        env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
        try:
            result = self.runner(argv, env=env, stdin_text=None)
        except Exception:  # noqa: BLE001 — injected runner failures must not leak output/secrets
            _refuse('preflight_unavailable')
        _require(isinstance(result, (tuple, list)) and len(result) == 3, 'probe_malformed')
        code, out, err = result
        _require(type(code) is int and isinstance(out, str) and isinstance(err, str), 'probe_malformed')
        _require(code == 0, 'preflight_unavailable')
        _require(len(out.encode('utf-8')) <= MAX_BYTES and len(err.encode('utf-8')) <= MAX_BYTES, 'probe_malformed')
        return out

    def _image(self, value, kind):
        pattern = IMAGE_ID if kind == 'image_id' else REPO_DIGEST if kind == 'repo_digest' else None
        _require(pattern is not None and isinstance(value, str) and pattern.fullmatch(value), 'image_identity_untrusted')
        obj = _json(self._run(['docker', 'image', 'inspect', '--format', '{{json .}}', value]))
        _require(isinstance(obj, dict) and isinstance(obj.get('Id'), str)
                 and IMAGE_ID.fullmatch(obj['Id']) and isinstance(obj.get('RepoDigests'), list)
                 and all(isinstance(item, str) and REPO_DIGEST.fullmatch(item) for item in obj['RepoDigests']), 'probe_malformed')
        _require(obj['Id'] == value if kind == 'image_id' else value in obj['RepoDigests'], 'image_identity_untrusted')
        return value

    def _rows(self, kind):
        argv = ['docker', kind, 'ls']
        if kind == 'container':
            argv += ['--all']
        name_field = '.Names' if kind == 'container' else '.Name'
        projection = ('{"Name":{{json ' + name_field + '}},"Project":{{json '
                      '(.Label "com.docker.compose.project")}}}')
        argv += ['--format', projection]
        lines = self._run(argv).splitlines()
        _require(len(lines) <= MAX_ROWS, 'probe_malformed')
        rows = []
        for line in lines:
            obj = _json(line)
            _require(isinstance(obj, dict) and set(obj) == {'Name', 'Project'}
                     and isinstance(obj['Name'], str) and obj['Name']
                     and (obj['Project'] is None or isinstance(obj['Project'], str)), 'probe_malformed')
            rows.append((obj['Name'], obj['Project']))
        return rows

    def _project_exists(self):
        names = re.compile(re.escape(self.project) + r'[-_](db|odoo|web|edge)[-_][1-9][0-9]*\Z')
        rows = self._rows('container')
        return any(project == self.project or names.fullmatch(name)
                   for name, project in rows)

    def _resource_exists(self, kind, name):
        rows = self._rows(kind)
        return any(resource_name == name or project == self.project
                   for resource_name, project in rows)

    @staticmethod
    def _port(value):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(('127.0.0.1', value))
        except OSError as error:
            if error.errno == errno.EADDRINUSE:
                return True
            _refuse('preflight_unavailable')
        return False

    def _database_absent(self):
        data_bind = self._compose()
        _require(not self._project_exists(), 'database_absence_unverified')
        # Query every resource family afresh; an unavailable list never means empty.
        volumes = self._rows('volume')
        names = {self.project + '-db', self.project + '-odoo'}
        _require(not any(name in names or project == self.project
                         for name, project in volumes), 'database_absence_unverified')
        _require(not self._resource_exists('network', self.project + '-private'), 'database_absence_unverified')
        if data_bind is not None and data_bind.exists():
            _require(not any(data_bind.iterdir()), 'database_absence_unverified')

    def _compose(self, *, observe_image=True):
        document = _json(self._input_bytes(self.resources['compose_file']))
        _require(isinstance(document, dict) and set(document) == {'name', 'services', 'volumes', 'networks'})
        _require(document['name'] == self.project)
        services = document['services']
        _require(isinstance(services, dict) and set(services) == SERVICES)
        network = document['networks']
        _require(network in ({'tenant_net': {'name': self.project + '-private'}},
                             {'tenant_net': {'name': self.project + '-private', 'driver': 'bridge'}}))
        for name, service in services.items():
            _require(isinstance(service, dict) and set(service) <= {'image', 'ports', 'volumes', 'networks', 'environment', 'depends_on', 'expose', 'restart'})
            _require(service.get('networks') == ['tenant_net'])
            _require(service.get('restart', 'no') in ('no', 'unless-stopped'))
            deps = service.get('depends_on', [])
            _require(isinstance(deps, list) and len(set(deps)) == len(deps)
                     and all(dep in SERVICES - {name} for dep in deps))
            allowed_expose = {'db': ['5432'], 'odoo': ['8069', '8072'], 'web': ['3000'], 'edge': ['80']}
            _require(service.get('expose', []) in ([], allowed_expose[name]))
        for name, key in [('odoo', 'odoo_image'), ('web', 'web_image'), ('edge', 'proxy_image')]:
            image = services[name].get('image')
            _require(image == self.release[key] and isinstance(image, str)
                     and (IMAGE_ID.fullmatch(image) or REPO_DIGEST.fullmatch(image)))
        db_image = services['db'].get('image')
        _require(isinstance(db_image, str) and (IMAGE_ID.fullmatch(db_image) or REPO_DIGEST.fullmatch(db_image)))
        ports = self.resources['ports']
        _require(set(ports) == {'db', 'odoo', 'web'} and len(set(ports.values())) == 3)
        for service, key, target in [('db', 'db', 5432), ('odoo', 'odoo', 8069), ('edge', 'web', 80)]:
            _require(type(ports[key]) is int and 1024 <= ports[key] <= 65535)
            _require(services[service].get('ports') == [f'127.0.0.1:{ports[key]}:{target}'])
        _require(services['web'].get('ports', []) == [])
        self._environments(services)
        data_bind = self._mounts(document)
        # Only after every static safety check may even read-only Docker run.
        if observe_image:
            self._image(db_image, 'image_id' if IMAGE_ID.fullmatch(db_image) else 'repo_digest')
        return data_bind

    def _environments(self, services):
        _require(services['db'].get('environment') == {
            'POSTGRES_DB': self.resources['db_name'], 'POSTGRES_USER': 'odoo',
            'POSTGRES_PASSWORD': '${POSTGRES_PASSWORD}',
        })
        _require(services['web'].get('environment') == {
            'NUXT_ODOO_URL': 'http://odoo:8069', 'NUXT_ODOO_DB': self.resources['db_name'],
        })
        _require(services['odoo'].get('environment') == {'NASQ_COMMERCIAL_CONFIG': '/etc/odoo/commercial.json'})
        _require(services['edge'].get('environment', {}) == {})

    def _config_bind(self, mount, target):
        _require(isinstance(mount, str) and '$' not in mount)
        bits = mount.split(':')
        _require(len(bits) == 3 and bits[1:] == [target, 'ro'])
        parent = _plain_path(self.resources['compose_file']).parent
        source = Path(bits[0])
        path = _plain_path(source if source.is_absolute() else parent / source)
        _require(path.is_relative_to(parent) and path != parent)
        return self._input_bytes(path)

    def _mounts(self, document):
        services = document['services']
        _require(services['db'].get('volumes') == ['db_data:/var/lib/postgresql/data'])
        _require(services['web'].get('volumes', []) == [])
        edge = services['edge'].get('volumes')
        _require(isinstance(edge, list) and len(edge) == 1)
        _require(self._config_bind(edge[0], '/etc/caddy/Caddyfile') == CADDYFILE.encode('utf-8'))
        mounts = services['odoo'].get('volumes')
        _require(isinstance(mounts, list) and len(mounts) == 3 and all(isinstance(m, str) for m in mounts))
        by_target = {}
        for mount in mounts:
            bits = mount.split(':')
            _require(len(bits) in (2, 3) and bits[1] not in by_target)
            by_target[bits[1]] = mount
        _require(set(by_target) == {'/var/lib/odoo', '/etc/odoo/odoo.conf', '/etc/odoo/commercial.json'})
        self._odoo_config(self._config_bind(by_target['/etc/odoo/odoo.conf'], '/etc/odoo/odoo.conf'))
        classification = _json(self._config_bind(by_target['/etc/odoo/commercial.json'], '/etc/odoo/commercial.json'))
        expected = {'schema_version': 1, 'database': self.resources['db_name'],
                    'commercial_mode': 'saas', 'entitlement_source': 'control_plane',
                    'expected_valid_until': None, 'valid_until_action': 'preserve'}
        _require(classification == expected and type(classification['schema_version']) is int)
        volumes = {'db_data': {'name': self.project + '-db'}}
        data_bind = None
        data_mount = by_target['/var/lib/odoo']
        if data_mount == 'odoo_data:/var/lib/odoo':
            volumes['odoo_data'] = {'name': self.project + '-odoo'}
        else:
            bits = data_mount.split(':')
            _require(len(bits) == 2 and '$' not in bits[0])
            root = _plain_path(self.resources['data_dir'])
            # Refuse filesystem roots, broad system directories, and home itself.
            system_roots = ('/etc', '/usr', '/bin', '/sbin', '/dev', '/proc', '/sys',
                            '/run', '/var/run', '/System', '/Library')
            _require(len(root.parts) >= 4 and root != Path.home()
                     and not any(root.is_relative_to(Path(item)) for item in system_roots))
            data_bind = _plain_path(bits[0])
            _require(data_bind.is_relative_to(root) and data_bind != root)
            _require(not data_bind.exists() or data_bind.is_dir())
        _require(document['volumes'] == volumes)
        return data_bind

    def _odoo_config(self, raw):
        parser = configparser.ConfigParser(interpolation=None, strict=True)
        try:
            parser.read_string(raw.decode('utf-8'))
        except (configparser.Error, UnicodeError):
            _refuse('compose_file_invalid')
        _require(parser.sections() == ['options'] and not parser.defaults())
        options = dict(parser['options'])
        expected = {'db_host': 'db', 'db_port': '5432', 'db_user': 'odoo',
                    'db_name': self.resources['db_name'],
                    'dbfilter': '^' + self.resources['db_name'] + '$',
                    'list_db': 'False', 'proxy_mode': 'True',
                    'workers': '2', 'max_cron_threads': '0'}
        optional = {'admin_passwd', 'db_password',
                    'http_port', 'gevent_port', 'data_dir', 'addons_path'}
        _require(set(options) <= set(expected) | optional and all(options.get(k) == v for k, v in expected.items()))
        _require(all(options.get(key) for key in ('db_password', 'admin_passwd')))
        fixed = {'http_port': '8069', 'gevent_port': '8072', 'data_dir': '/var/lib/odoo',
                 'addons_path': '/opt/odoo/addons,/opt/nasq/addons'}
        _require(all(options.get(key, value) == value for key, value in fixed.items()))
        if self._capturing is not None:
            self._validated_options = options
