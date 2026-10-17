"""Verify the effective existing Compose helper target under a release lease.

Pool metadata is trusted local operator input; request/ENV pool labels alone do
not establish executable identity. Only `compose config` is run, never a service.
"""
import configparser
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from .manifest import IMAGE

_FIELDS = {'projectName', 'composeFile', 'envFile', 'composeSha256', 'envSha256',
           'odooImage', 'odooConfig', 'odooConfigSha256', 'dbUser'}


def _file(value, limit=2 * 1024 * 1024):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or path.resolve() != path:
        raise ValueError()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit: raise ValueError()
        data = source.read(limit + 1)
    if len(data) > limit: raise ValueError()
    return data


def _json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError()
            result[key] = value
        return result
    result = json.loads(data, object_pairs_hook=unique)
    if not isinstance(result, dict): raise ValueError()
    return result


def _checked_files(metadata):
    contents = {}
    for field, digest_field in [('composeFile', 'composeSha256'), ('envFile', 'envSha256'), ('odooConfig', 'odooConfigSha256')]:
        digest = metadata[digest_field]
        if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest): raise ValueError()
        content = _file(metadata[field])
        if hashlib.sha256(content).hexdigest() != digest: raise ValueError()
        contents[field] = content
    return contents


def verify_helper_runtime(config, lease, helper_pool, *, runner=None):
    """Return sanitized prospective helper identity or reject before invocation.

    pools.json -> pools[pool].helperConfig contains projectName/composeFile/envFile,
    composeSha256/envSha256/odooImage/odooConfig/odooConfigSha256/dbUser. Existing
    helper code uses the fixed `odoo` Compose service and explicit secure
    entrypoint. Metadata must describe that actual view of the selected pool.
    """
    try:
        if not isinstance(config, dict) or not isinstance(lease, dict): raise ValueError()
        if not isinstance(helper_pool, str) or not re.fullmatch('[a-z][a-z0-9-]{0,39}', helper_pool): raise ValueError()
        if lease.get('poolId') == 'pending':
            if lease.get('operation') not in {'provision', 'provision_observe'} or lease.get('routeRevision') != 0 or lease.get('fence') != 0:
                raise ValueError()
        elif (lease.get('poolId') != helper_pool or any(type(lease.get(field)) is not int or lease[field] < 1 for field in ('routeRevision', 'fence'))):
            raise ValueError()
        root = Path(os.environ['WEBVUE_RELEASE_ROUTES_DIR'])
        if not root.is_absolute() or root.resolve() != root or not root.is_dir(): raise ValueError()
        pools = _json(_file(root / 'pools.json'))
        pool = pools['pools'][helper_pool]
        if pools.get('schemaVersion') != 1 or pool.get('poolId') != helper_pool: raise ValueError()
        metadata = pool['helperConfig']
        if not isinstance(metadata, dict) or set(metadata) != _FIELDS: raise ValueError()
        if not re.fullmatch(r'webvue-(?:saas|shared)-[a-z0-9-]{3,48}', metadata['projectName']): raise ValueError()
        if any(config.get(field) != metadata[field] for field in ('projectName', 'composeFile', 'envFile')): raise ValueError()
        image, role = metadata['odooImage'], metadata['dbUser']
        if not isinstance(image, str) or not IMAGE.fullmatch(image) or not isinstance(role, str) or not re.fullmatch('[a-z][a-z0-9_]{0,62}', role):
            raise ValueError()
        if image != pool.get('images',{}).get('odoo') or role != pool.get('dbUser'):
            raise ValueError()
        contents = _checked_files(metadata)
        parsed = configparser.ConfigParser(interpolation=None, strict=True)
        parsed.read_string(contents['odooConfig'].decode('utf-8'))
        if parsed.defaults() or parsed.sections() != ['options'] or parsed['options'].get('db_user') != role:
            raise ValueError()
        command = ['docker', 'compose', '--project-name', metadata['projectName'], '--env-file', metadata['envFile'],
                   '--file', metadata['composeFile'], 'config', '--format', 'json']
        done = (runner or subprocess.run)(command, shell=False, check=False, capture_output=True, text=True, timeout=30)
        if done.returncode != 0 or not isinstance(done.stdout, str) or len(done.stdout) > 2 * 1024 * 1024: raise ValueError()
        rendered = _json(done.stdout)
        service = rendered['services']['odoo']
        if service.get('image') != image: raise ValueError()
        volumes = service.get('volumes')
        if not isinstance(volumes, list) or any(not isinstance(volume, dict) for volume in volumes): raise ValueError()
        mounts = [volume for volume in volumes if volume.get('target') == '/etc/odoo/odoo.conf']
        if len(mounts) != 1: raise ValueError()
        mount = mounts[0]
        if mount.get('type') != 'bind' or mount.get('source') != metadata['odooConfig'] or mount.get('read_only') is not True:
            raise ValueError()
        # An overlapping parent or code mount would defeat the checked image/config.
        for volume in volumes:
            target = volume.get('target', '')
            if target in {'/', '/etc', '/etc/odoo'} or any(target == prefix or target.startswith(prefix + '/') for prefix in ('/opt', '/usr', '/bin', '/sbin')):
                raise ValueError()
        _checked_files(metadata)  # Detect files changed while Docker rendered the view.
        if _json(_file(root / 'pools.json')) != pools: raise ValueError()
        return {'verified': True, 'poolId': helper_pool, 'odooImage': image,
                'odooConfigSha256': metadata['odooConfigSha256'], 'dbUser': role}
    except Exception:
        # Compose renders environment secrets; never forward any output or exception text.
        raise ValueError('helper_runtime_rejected') from None
