"""Dedicated deployment binding and all-path maintenance policy.

Consumes a trusted local binding only; no remote registry lookup, cookie
rewriting or customer-selected upstream is part of this adapter.
"""
import re
from .manifest import MODULE, NAME
from .compose import VOLUME

HOST = re.compile(r'^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$')


def validate_binding(binding, require_commercial=True):
    """Validate a single local identity without including input values in errors."""
    try:
        required = {'tenantId', 'database', 'filestore', 'identityRevision', 'host'}
        if require_commercial:
            required.add('commercialMode')
        if not isinstance(binding, dict) or not required <= binding.keys() or set(binding) - required - {'commercialMode'}:
            raise ValueError()
        if not isinstance(binding['tenantId'], str) or not NAME.fullmatch(binding['tenantId']):
            raise ValueError()
        for key, pattern in (('database', MODULE), ('filestore', VOLUME), ('host', HOST)):
            if not isinstance(binding[key], str) or not pattern.fullmatch(binding[key]):
                raise ValueError()
        if any(not label or len(label) > 63 or label.startswith('-') or label.endswith('-') for label in binding['host'].split('.')):
            raise ValueError()
        if type(binding['identityRevision']) is not int or binding['identityRevision'] < 1:
            raise ValueError()
        if 'commercialMode' in binding and binding['commercialMode'] not in {'saas', 'non_saas'}:
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise ValueError('local_binding_rejected') from None
    return dict(binding)


def select_dedicated_route(binding, host, route, path='/'):
    """Gate every externally reachable path before dispatching to a local pool."""
    binding = validate_binding(binding)
    try:
        if host != binding['host'] or not isinstance(path, str) or not path.startswith('/') or '\\' in path:
            raise ValueError()
        if (not isinstance(route, dict) or set(route) != {'poolId', 'releaseId', 'state'}
                or route['state'] not in {'serving', 'maintenance'}
                or any(not isinstance(route[key], str) or not NAME.fullmatch(route[key]) for key in ('poolId', 'releaseId'))):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise ValueError('dedicated_route_rejected') from None
    if route['state'] == 'maintenance':
        return {'allowed': False, 'status': 503, 'reason': 'tenant_maintenance', 'cookieMode': 'odoo'}
    return {'allowed': True, 'status': 200, 'poolId': route['poolId'], 'releaseId': route['releaseId'],
            'database': binding['database'], 'filestore': binding['filestore'],
            'identityRevision': binding['identityRevision'], 'cookieMode': 'odoo'}
