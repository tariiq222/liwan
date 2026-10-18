"""Read-only Docker observation binding Odoo HTTP/cron to its runtime DB role.

This proves the guarded launch and mounted configuration at observation time. A
read-only bind does not stop a privileged host operator replacing source files;
file identity, digest and pre-start timestamps therefore form a trusted operator
invariant, not a substitute for immutable deployment storage or SQL role audits.
"""
from __future__ import annotations

import configparser
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

FIELDS = {'poolId', 'releaseId', 'image', 'dbUser', 'dbHost', 'configPath', 'configDigest', 'tenancyMode'}
NAME = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\Z')
ROLE = re.compile(r'[a-z][a-z0-9_]{0,62}\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')
IMAGE = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}\Z')
SHARED_ENTRYPOINT = ['/opt/venv/bin/python', '/opt/webvue/shared/launch_odoo.py']
CONFIG = '/etc/odoo/odoo.conf'
PROTECTED = ('/opt/venv', '/opt/odoo', '/opt/oca', '/opt/webvue/addons', '/opt/webvue/tools', '/opt/webvue/deploy', '/opt/webvue/shared', '/opt/webvue/odoo_secure.py', '/usr/local/bin/webvue-odoo')
MAX_OUTPUT = 1048576


class RuntimeIdentityError(ValueError):
    """An opaque refusal: neither inspect output, environment nor config is public evidence."""


def _bytes(value):
    if isinstance(value, str):
        value = value.encode('utf-8')
    if not isinstance(value, bytes) or len(value) > MAX_OUTPUT:
        raise ValueError()
    return value


def _run(runner, argv):
    result = runner(argv, check=True, capture_output=True, timeout=10)
    if result.returncode != 0:
        raise ValueError()
    return _bytes(result.stdout)


def _one(raw):
    value = json.loads(raw)
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        raise ValueError()
    return value[0]


def _started(value):
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)', value)
    if match is None:
        raise ValueError()
    instant = datetime.strptime(match[1], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
    return int(instant.timestamp()) * 1_000_000_000 + int((match[2] or '').ljust(9, '0'))


def _fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode, info.st_uid)


def _host_config(path, started):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path or any(item.is_symlink() for item in (path, *path.parents)):
        raise ValueError()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) not in (0o400, 0o440)
                or info.st_uid not in (0, os.geteuid()) or max(info.st_mtime_ns, info.st_ctime_ns) > started):
            raise ValueError()
        raw = source.read(MAX_OUTPUT + 1)
    return path, _bytes(raw), _fingerprint(info)


def _environment(values):
    if not isinstance(values, list):
        raise ValueError()
    result = {}
    for value in values:
        if not isinstance(value, str) or '=' not in value:
            raise ValueError()
        key, data = value.split('=', 1)
        if not key or key in result:
            raise ValueError()
        result[key] = data
    return result


def _launch(item, expected, cron_databases=None):
    config = item['Config']
    env = _environment(config['Env'])
    runtime_role = 'cron' if cron_databases is not None else 'http'
    if config['Labels'].get('webvue.runtime') != runtime_role:
        raise ValueError()
    if cron_databases is not None:
        databases = ','.join(cron_databases)
        if config['Labels'].get('webvue.database') != databases or env.get('WEBVUE_RELEASE_DATABASES') != databases:
            raise ValueError()
    elif 'webvue.database' in config['Labels'] or 'WEBVUE_RELEASE_DATABASES' in env:
        raise ValueError()
    if any(env.get(key) for key in ('PYTHONPATH', 'PYTHONHOME', 'PYTHONUSERBASE', 'LD_PRELOAD', 'LD_LIBRARY_PATH')):
        raise ValueError()
    if (env.get('WEBVUE_RELEASE_DB_USER') != expected['dbUser'] or env.get('WEBVUE_RELEASE_POOL_ID') != expected['poolId']
            or env.get('WEBVUE_RELEASE_ROLE') != runtime_role or env.get('WEBVUE_TENANCY_MODE') != expected['tenancyMode']):
        raise ValueError()
    entrypoint, arguments = config['Entrypoint'], config['Cmd']
    expected_arguments = (['--no-http', '--max-cron-threads=1', '--database=' + ','.join(cron_databases)]
                          if cron_databases is not None else ['--max-cron-threads=0'])
    if expected['tenancyMode'] == 'shared':
        if entrypoint != SHARED_ENTRYPOINT or arguments != expected_arguments:
            raise ValueError()
    else:
        if entrypoint not in (['webvue-odoo'], ['/usr/local/bin/webvue-odoo']):
            raise ValueError()
        allowed = (expected_arguments, ['server', *expected_arguments]) if cron_databases is not None else (
            [], ['server'], expected_arguments, ['server', *expected_arguments])
        if arguments not in allowed:
            raise ValueError()
        if entrypoint == ['webvue-odoo'] and 'PATH' in env:
            safe = {'/opt/venv/bin', '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'}
            if any(directory not in safe for directory in env['PATH'].split(':')):
                raise ValueError()
    if item.get('Path') != entrypoint[0] or item.get('Args') != [*entrypoint[1:], *arguments]:
        raise ValueError()


def _mounts(item, expected):
    mounts = item['Mounts']
    if not isinstance(mounts, list):
        raise ValueError()
    bindings = [mount for mount in mounts if mount.get('Destination') == CONFIG]
    if len(bindings) != 1 or any(bindings[0].get(key) != value for key, value in
                                 {'Type': 'bind', 'Source': expected['configPath'], 'RW': False}.items()):
        raise ValueError()
    for mount in mounts:
        destination = mount['Destination'].rstrip('/') or '/'
        if destination == CONFIG:
            continue
        if any(destination == protected or protected.startswith(destination.rstrip('/') + '/')
               or destination.startswith(protected + '/') for protected in PROTECTED):
            raise ValueError()


def inspect_odoo_runtime(container, expected, runner=subprocess.run, *, cron_databases=None, allow_stopped=False):
    """Inspect only: Docker inspect/image inspect and captured `exec <id> cat`.

    Stopped cron candidates prove only configured launch/config/image identity,
    without exec or any claim that these bytes were loaded by a running process.
    Success returns safe identity facts. Every failure raises one fixed exception;
    subprocess/config/environment output and raw exception text never escape.
    """
    try:
        if (not isinstance(expected, dict) or set(expected) != FIELDS or not isinstance(container, str) or not NAME.fullmatch(container)
                or any(not isinstance(expected[key], str) for key in FIELDS)
                or any(not NAME.fullmatch(expected[key]) for key in ('poolId', 'releaseId'))
                or not ROLE.fullmatch(expected['dbUser']) or not re.fullmatch(r'[a-zA-Z0-9_.:-]+', expected['dbHost'])
                or not IMAGE.fullmatch(expected['image']) or not SHA.fullmatch(expected['configDigest'])
                or expected['tenancyMode'] not in ('shared', 'dedicated') or type(allow_stopped) is not bool):
            raise ValueError()
        if cron_databases is not None and (not isinstance(cron_databases,(list,tuple)) or not cron_databases or list(cron_databases)!=sorted(set(cron_databases)) or any(not ROLE.fullmatch(db) for db in cron_databases)):
            raise ValueError()
        expected = dict(expected)
        item = _one(_run(runner, ['docker', 'inspect', container]))
        if (not isinstance(item['State']['Running'],bool) or (not item['State']['Running'] and not (allow_stopped and cron_databases)) or not re.fullmatch(r'[a-f0-9]{64}', item['Id'])
                or not re.fullmatch(r'sha256:[a-f0-9]{64}', item['Image'])):
            raise ValueError()
        labels = item['Config']['Labels']
        for key, value in {'webvue.pool': expected['poolId'], 'webvue.release': expected['releaseId'],
                           'webvue.db-config-sha256': expected['configDigest']}.items():
            if labels.get(key) != value:
                raise ValueError()
        _launch(item, expected, cron_databases)
        _mounts(item, expected)
        observed_ns = _started(item['State']['StartedAt']) if item['State']['Running'] else time.time_ns()
        path, host_raw, fingerprint = _host_config(expected['configPath'], observed_ns)
        if hashlib.sha256(host_raw).hexdigest() != expected['configDigest']:
            raise ValueError()
        image = _one(_run(runner, ['docker', 'image', 'inspect', item['Image']]))
        if image.get('Id') != item['Image'] or expected['image'] not in image.get('RepoDigests', []):
            raise ValueError()
        mounted = _run(runner, ['docker', 'exec', item['Id'], 'cat', CONFIG]) if item['State']['Running'] else host_raw
        if hashlib.sha256(mounted).hexdigest() != expected['configDigest'] or mounted != host_raw:
            raise ValueError()
        parser = configparser.ConfigParser(interpolation=None, strict=True)
        parser.read_string(mounted.decode('utf-8'))
        if parser.sections() != ['options'] or parser.defaults():
            raise ValueError()
        if any(parser['options'].get(key, '').strip() != expected[field] for key, field in (('db_user', 'dbUser'), ('db_host', 'dbHost'))):
            raise ValueError()
        if path.resolve() != path or _fingerprint(path.lstat()) != fingerprint:
            raise ValueError()
        return {'ready': True, 'poolId': expected['poolId'], 'releaseId': expected['releaseId'], 'image': expected['image'],
                'imageId': item['Image'], 'dbUser': expected['dbUser'], 'dbHost': expected['dbHost'],
                'configDigest': expected['configDigest'], 'containerId': item['Id'],
                'running': item['State']['Running'], 'runtimeRole': 'cron' if cron_databases is not None else 'http',
                'bindingProof': 'guarded-launch-and-mounted-config' if item['State']['Running'] else 'configured-stopped-runtime'}
    except Exception:
        raise RuntimeIdentityError('odoo_runtime_identity_rejected') from None
