"""Pure Compose rendering from immutable release and trusted operator settings.

This creates candidate configuration only. It neither starts services nor grants
DB access. Operator-provided HTTP/cron files require the separate startup gates.
"""
import hashlib
import ipaddress
from pathlib import PurePosixPath
import re
from urllib.parse import urlsplit
from .manifest import MODULE, manifest_digest, validate_manifest

POOL = re.compile(r'^[a-z][a-z0-9-]{0,39}$')
VOLUME = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]{0,63}$')


def _name(value, pattern=VOLUME):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError('pool_config_rejected')
    return value


def _path(value):
    if (not isinstance(value, str) or not value.startswith('/') or value.startswith('//')
            or '..' in PurePosixPath(value).parts or not re.fullmatch(r'/[a-zA-Z0-9_./-]+', value)):
        raise ValueError('pool_config_rejected')
    return value


def _endpoint(value, allowed):
    """Only fixed internal DNS names/private addresses; no URL authority tricks."""
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        if (value not in allowed or parsed.scheme != 'http' or not host or parsed.username or parsed.password
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment or not parsed.port
                or parsed.port < 1 or parsed.port > 65535):
            raise ValueError()
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            if not re.fullmatch(r'[a-z][a-z0-9-]{0,62}', host):
                raise ValueError()
        else:
            if (not (address.is_private or address.is_loopback) or address.is_link_local
                    or address.is_multicast or address.is_unspecified):
                raise ValueError()
    except (TypeError, ValueError, AttributeError):
        raise ValueError('pool_endpoint_rejected') from None
    return value


def render_pool(manifest, operator_config):
    """Render isolated service names and external persistent storage references.

    ``upstreams`` are operator-owned fixed ``odoo/web/ws[/ai]`` URLs and every
    URL (including shared ``guardUrl``) must occur in ``allowedUpstreams``.
    Config paths contain runtime secrets; secret values are never accepted.
    """
    manifest = validate_manifest(manifest)
    try:
        config = operator_config
        required = {'poolId', 'tenancyMode', 'upstreams', 'allowedUpstreams', 'sessionStore',
                    'filestore', 'assetsStore', 'httpConfig', 'cronConfig', 'cronDatabases', 'runtimeSecret','runtimeDbUser','runtimeUid','httpConfigDigest','cronConfigDigest',
                    'guardWebNetwork','guardOdooNetwork','databaseNetwork','releaseRoutesDir'}
        if not isinstance(config, dict) or not required <= config.keys() or set(config) - required - {'ai', 'guardUrl', 'database'}:
            raise ValueError()
        if type(config['runtimeUid']) is not int or not 1 <= config['runtimeUid'] <= 2147483647:raise ValueError()
        _name(config['runtimeDbUser'],MODULE)
        for key in ('httpConfigDigest','cronConfigDigest'):
            if not isinstance(config[key],str) or not re.fullmatch('[a-f0-9]{64}',config[key]):raise ValueError()
        for key in ('guardWebNetwork','guardOdooNetwork','databaseNetwork'):_name(config[key])
        for key in ('releaseRoutesDir',):_path(config[key])
        pool_id = _name(config['poolId'], POOL)
        if config['tenancyMode'] not in {'shared', 'dedicated'}:
            raise ValueError()
        allowed = config['allowedUpstreams']
        if not isinstance(allowed, (tuple, list)) or not allowed or any(not isinstance(item, str) for item in allowed):
            raise ValueError()
        upstreams = config['upstreams']
        if not isinstance(upstreams, dict) or not {'odoo', 'web', 'ws'} <= upstreams.keys() or set(upstreams) - {'odoo', 'web', 'ws', 'ai'}:
            raise ValueError()
        upstreams = {key: _endpoint(value, allowed) for key, value in upstreams.items()}
        for role, suffix, port in [('odoo', 'odoo', 8069), ('web', 'web', 3000), ('ws', 'odoo', 8072)]:
            parsed = urlsplit(upstreams[role])
            if parsed.hostname != f'{pool_id}-{suffix}' or parsed.port != port:
                raise ValueError()
        if config['tenancyMode'] == 'shared':
            odoo_url = _endpoint(config.get('guardUrl'), allowed)
            if 'database' in config:
                raise ValueError()
        else:
            odoo_url = _endpoint(config.get('guardUrl'), allowed)
            _name(config['database'], MODULE)
        for key in ('sessionStore', 'filestore', 'assetsStore'):
            _name(config[key])
        for key in ('httpConfig', 'cronConfig', 'runtimeSecret'):
            _path(config[key])
        if len({config[key] for key in ('sessionStore', 'filestore', 'assetsStore')}) != 3:
            raise ValueError()
        if len({config[key] for key in ('httpConfig', 'cronConfig', 'runtimeSecret')}) != 3:
            raise ValueError()
        databases = config['cronDatabases']
        if (not isinstance(databases, (list, tuple)) or not databases or len(set(databases)) != len(databases)
                or any(not isinstance(db, str) or not MODULE.fullmatch(db) for db in databases)):
            raise ValueError()
        if config['tenancyMode'] == 'dedicated' and list(databases) != [config['database']]:
            raise ValueError()
        labels = {'liwan.pool': pool_id, 'liwan.release': manifest['releaseId']}
        volumes = {config[key]: {'external': True} for key in ('sessionStore', 'filestore', 'assetsStore')}
        mount = lambda source, target, read_only=False, kind='volume': {
            'type': kind, 'source': source, 'target': target, 'read_only': read_only}
        odoo_mounts = [mount(config['sessionStore'], '/var/lib/odoo/sessions'),
                       mount(config['filestore'], '/var/lib/odoo/filestore')]
        route_mounts=[mount(config['releaseRoutesDir'],'/run/liwan/releases',True,'bind'),
            mount(config['releaseRoutesDir']+'/leases','/run/liwan/releases/leases',False,'bind')]
        def odoo_service(config_key, command, database=None):
            return {'image': manifest['images']['odoo'], 'restart': 'unless-stopped',
                    'labels': {**labels,'liwan.runtime':'http' if config_key=='httpConfig' else 'cron','liwan.db-config-sha256':config['httpConfigDigest' if config_key=='httpConfig' else 'cronConfigDigest']}, 'command': command,
                    'user':str(config['runtimeUid']),
                    **({'entrypoint':['/opt/venv/bin/python','/opt/liwan/shared/launch_odoo.py']} if config['tenancyMode']=='shared' else {}),
                    'environment': {'LIWAN_TENANCY_MODE': config['tenancyMode'], 'LIWAN_RELEASE_POOL_ID': pool_id,
                        'LIWAN_RELEASE_DB_USER':config['runtimeDbUser'],
                        'LIWAN_RELEASE_ROLE': 'http' if config_key == 'httpConfig' else 'cron',
                        **({'LIWAN_RELEASE_DATABASES': database} if config_key == 'cronConfig' else {})},
                    'volumes': [*odoo_mounts, mount(config[config_key], '/etc/odoo/odoo.conf', True, 'bind')],
                    'networks': [f'{pool_id}-internal',config['databaseNetwork'],config['guardOdooNetwork']]}
        services = {
            f'{pool_id}-odoo': odoo_service('httpConfig', ['--max-cron-threads=0']),
            f'{pool_id}-web': {'image': manifest['images']['web'], 'restart': 'unless-stopped',
                'labels': dict(labels), 'user':str(config['runtimeUid']),'networks': [f'{pool_id}-internal',config['guardWebNetwork']],
                'environment': {'NUXT_ODOO_URL': odoo_url,
                    'NUXT_ODOO_DB': config.get('database', ''),
                    'LIWAN_TENANCY_MODE': 'shared' if config['tenancyMode'] == 'shared' else 'dedicated',
                    'LIWAN_RELEASE_ID': manifest['releaseId'], 'LIWAN_RELEASE_POOL_ID': pool_id,
                    'LIWAN_ASSETS_ID': manifest['assetsId'],'LIWAN_RELEASE_ROUTES_DIR':'/run/liwan/releases'},
                'env_file': [config['runtimeSecret']],
                'volumes': [mount(config['assetsStore'], '/opt/liwan/release-assets', True),*route_mounts]},
        }
        for database in sorted(databases):
            cron=odoo_service('cronConfig',['--no-http','--max-cron-threads=1','--database='+database],database)
            cron['profiles']=['release-cron'];cron['labels']['liwan.database']=database
            services[f'{pool_id}-cron-{database}']=cron
        services[f'{pool_id}-odoo']['expose'] = ['8069', '8072']
        services[f'{pool_id}-web']['expose'] = ['3000']
        ai = config.get('ai')
        if ai is None and ('ai' in manifest['images'] or 'ai' in upstreams):
            raise ValueError()
        if ai is not None:
            if not isinstance(ai, dict) or ai.get('mode') not in {'pool', 'stable'} or 'ai' not in upstreams:
                raise ValueError()
            services[f'{pool_id}-web']['environment']['NUXT_AI_SERVICE_URL'] = upstreams['ai']
            if ai['mode'] == 'pool':
                if set(ai) != {'mode', 'stateStore', 'config'} or 'ai' not in manifest['images']:
                    raise ValueError()
                if urlsplit(upstreams['ai']).hostname != f'{pool_id}-ai':
                    raise ValueError()
                volumes[_name(ai['stateStore'])] = {'external': True}
                services[f'{pool_id}-ai'] = {'image': manifest['images']['ai'], 'labels': dict(labels),
                    'restart': 'unless-stopped', 'networks': [f'{pool_id}-internal',config['databaseNetwork']],
                    'environment':{'AI_GENERATION_ID':'generation_'+hashlib.sha256((pool_id+':'+manifest_digest(manifest)).encode()).hexdigest()[:40],'AI_STATE_VERSION':manifest['aiStateVersion']},
                    'env_file': [_path(ai['config'])],
                    'volumes': [mount(ai['stateStore'], '/var/lib/liwan-ai')]}
            elif set(ai) != {'mode', 'url'} or _endpoint(ai['url'], allowed) != upstreams['ai']:
                raise ValueError()
        metadata = {'poolId': pool_id, 'releaseId': manifest['releaseId'], 'images': dict(manifest['images']),
                    'assetsId': manifest['assetsId'], 'moduleVersions': dict(manifest['moduleVersions']),
                    'aiStateVersion': manifest['aiStateVersion'], 'upstreams': upstreams,
                    'sessionStore': config['sessionStore'], 'filestore': config['filestore'],
                    'cronDatabases': sorted(databases), 'tenancyMode': config['tenancyMode']}
        return {'services': services, 'volumes': volumes,
                'networks': {f'{pool_id}-internal': {'internal': True},**{config[key]:{'external':True} for key in ('guardWebNetwork','guardOdooNetwork','databaseNetwork')}}, 'x-liwan-pool': metadata}
    except (ValueError, TypeError, KeyError):
        raise ValueError('pool_config_rejected') from None
