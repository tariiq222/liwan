# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pure, single-target local acceptance renderer; no I/O or provisioning.

The parent validates enrollment and image identities, supplies random credentials,
then exclusively persists these sensitive outputs under a private target root.
POSTGRES_PASSWORD must be supplied by the parent to Compose with the exact same
value as db_password. admin_password sets Odoo's database-manager password only;
it does NOT initialize the application administrator's login password.
"""
from __future__ import annotations

import json
import re
from pathlib import PurePosixPath

CADDYFILE = '''\
{
    auto_https off
    admin off
}

:80 {
    @odoo path /api/v1 /api/v1/* /web/content /web/content/* /web/binary/company_logo
    handle @odoo {
        reverse_proxy odoo:8069
    }
    @websocket path /websocket /websocket/*
    handle @websocket {
        reverse_proxy odoo:8072
    }
    handle {
        reverse_proxy web:3000
    }
}
'''

_IMAGE_ID = re.compile(r'sha256:[0-9a-f]{64}')
_REPO_DIGEST = re.compile(r'[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}')
_PROJECT = re.compile(r'[a-z][a-z0-9-]{0,62}')
_DATABASE = re.compile(r'nasq_scratch_[a-z0-9_]{1,42}')
_SECRET = re.compile(r'[A-Za-z0-9_-]{24,256}')
_RESERVED = frozenset({'nasq', 'odoo19', 'production', 'prod', 'postgres', 'template0', 'template1',
                       'canonical', 'nasq-saas-control-local'})
_FORBIDDEN_PORTS = frozenset({80, 443, 3000, 5432, 8069, 8072, 55432, 14179})


class BundleError(Exception):
    """Stable code-only failure, never include input/configuration/secret values."""

    def __init__(self, code):
        allowed = {'descriptor_invalid', 'image_invalid', 'secret_invalid'}
        self.code = code if type(code) is str and code in allowed else 'descriptor_invalid'
        super().__init__(self.code)


def _require(condition, code='descriptor_invalid'):
    if not condition:
        raise BundleError(code) from None


def _image(value, kind=None):
    _require(type(value) is str and len(value) <= 512, 'image_invalid')
    pattern = {'image_id': _IMAGE_ID, 'repo_digest': _REPO_DIGEST}.get(kind)
    _require(bool(pattern.fullmatch(value)) if pattern else bool(
        _IMAGE_ID.fullmatch(value) or _REPO_DIGEST.fullmatch(value)), 'image_invalid')
    return value


def _inputs(descriptor, postgres_image, db_password, admin_password):
    for secret in (db_password, admin_password):
        _require(type(secret) is str and _SECRET.fullmatch(secret), 'secret_invalid')
    _require(db_password != admin_password, 'secret_invalid')
    _require(type(descriptor) is dict and descriptor.get('commercial_mode') == 'saas')
    resources, release = descriptor.get('resource_refs'), descriptor.get('release_ref')
    _require(type(resources) is dict and type(release) is dict)
    project, database = resources.get('project'), resources.get('db_name')
    _require(type(project) is str and _PROJECT.fullmatch(project) and project not in _RESERVED)
    _require(type(database) is str and _DATABASE.fullmatch(database)
             and not set(database.removeprefix('nasq_scratch_').split('_')) & _RESERVED)
    compose_file = resources.get('compose_file')
    _require(type(compose_file) is str and 0 < len(compose_file) <= 4096
             and not any(ord(char) < 32 or ord(char) == 127 for char in compose_file)
             and not any(char in compose_file for char in ':$\\'))
    path = PurePosixPath(compose_file)
    _require(path.is_absolute() and '..' not in path.parts and path.name == 'compose.json'
             and len(path.parts) >= 4)
    ports = resources.get('ports')
    _require(type(ports) is dict and set(ports) == {'db', 'odoo', 'web'})
    _require(all(type(value) is int and 1024 <= value <= 65535 and value not in _FORBIDDEN_PORTS
                 for value in ports.values()) and len(set(ports.values())) == 3)
    kind = release.get('identity_kind')
    _require(type(kind) is str and kind in ('image_id', 'repo_digest'), 'image_invalid')
    images = {name: _image(release.get(key), kind) for name, key in (
        ('odoo', 'odoo_image'), ('web', 'web_image'), ('edge', 'proxy_image'))}
    images['db'] = _image(postgres_image)
    return project, database, ports, images


def render_bundle(descriptor: dict, *, postgres_image: str,
                  db_password: str, admin_password: str) -> dict[str, str]:
    """Return four bounded files, including a sensitive Odoo configuration.

    Rendering does not authorize existing resources or validate descriptor digest,
    private-directory ownership, filesystem symlinks, port availability or image
    existence. Those remain caller/probe responsibilities. No input is mutated.
    """
    project, database, ports, images = _inputs(descriptor, postgres_image, db_password, admin_password)
    compose = {
        'name': project,
        'services': {
            'db': {
                'image': images['db'], 'networks': ['tenant_net'],
                'ports': [f"127.0.0.1:{ports['db']}:5432"],
                'volumes': ['db_data:/var/lib/postgresql/data'],
                'environment': {'POSTGRES_DB': database, 'POSTGRES_USER': 'odoo',
                                'POSTGRES_PASSWORD': '${POSTGRES_PASSWORD}'},
            },
            'odoo': {
                'image': images['odoo'], 'networks': ['tenant_net'], 'depends_on': ['db'],
                'ports': [f"127.0.0.1:{ports['odoo']}:8069"], 'expose': ['8069', '8072'],
                'environment': {'NASQ_COMMERCIAL_CONFIG': '/etc/odoo/commercial.json'},
                'volumes': ['odoo_data:/var/lib/odoo', './odoo.conf:/etc/odoo/odoo.conf:ro',
                            './commercial.json:/etc/odoo/commercial.json:ro'],
            },
            'web': {
                'image': images['web'], 'networks': ['tenant_net'], 'expose': ['3000'],
                'environment': {'NUXT_ODOO_URL': 'http://odoo:8069', 'NUXT_ODOO_DB': database},
            },
            'edge': {
                'image': images['edge'], 'networks': ['tenant_net'], 'depends_on': ['odoo', 'web'],
                'ports': [f"127.0.0.1:{ports['web']}:80"],
                'volumes': ['./Caddyfile:/etc/caddy/Caddyfile:ro'],
            },
        },
        'volumes': {'db_data': {'name': project + '-db'}, 'odoo_data': {'name': project + '-odoo'}},
        'networks': {'tenant_net': {'name': project + '-private'}},
    }
    options = {
        'db_host': 'db', 'db_port': '5432', 'db_user': 'odoo',
        'db_password': db_password, 'admin_passwd': admin_password,
        'db_name': database, 'dbfilter': '^' + database + '$',
        'list_db': 'False', 'proxy_mode': 'True', 'workers': '2', 'max_cron_threads': '0',
        'http_port': '8069', 'gevent_port': '8072', 'data_dir': '/var/lib/odoo',
        'addons_path': '/opt/odoo/addons,/opt/nasq/addons',
    }
    classification = {
        'schema_version': 1, 'database': database, 'commercial_mode': 'saas',
        'entitlement_source': 'control_plane', 'expected_valid_until': None,
        'valid_until_action': 'preserve',
    }
    return {
        'compose.json': json.dumps(compose, sort_keys=True, indent=2) + '\n',
        'odoo.conf': '[options]\n' + ''.join(f'{key} = {value}\n' for key, value in options.items()),
        'commercial.json': json.dumps(classification, sort_keys=True, indent=2) + '\n',
        'Caddyfile': CADDYFILE,
    }
