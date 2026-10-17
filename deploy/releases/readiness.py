"""Validate a trusted, read-only runtime adapter's readiness observations.

No default network probe: the coordinator supplies an authenticated adapter that
observes image/runtime identity, stock Odoo module states and existing session
and filestore readability. The validator itself never changes runtime data.
"""
from .dedicated import validate_binding


def probe_pool(pool, tenant_binding, probe=None):
    """Return sanitized check booleans; absent/incomplete evidence fails closed.

    ``probe(pool, tenant_binding)`` must be read-only and return observations,
    not liveness booleans. No adapter exception or raw response is returned.
    """
    checks = {key: False for key in ('identity', 'images', 'modules', 'database', 'session', 'filestore', 'assets', 'ai', 'readOnly')}
    try:
        expected = pool['x-webvue-pool']
        binding = validate_binding(tenant_binding, require_commercial=False)
        if probe is None:
            return {'ready': False, 'checks': checks, 'reason': 'probe_unavailable'}
        observed = probe(pool, binding)
        if not isinstance(observed, dict):
            raise ValueError()
        checks['identity'] = all(observed.get(key) == expected[key] for key in ('poolId', 'releaseId')) and all(
            observed.get(key) == binding[key] for key in ('tenantId', 'identityRevision'))
        checks['images'] = observed.get('images') == expected['images']
        checks['modules'] = (observed.get('moduleVersions') == expected['moduleVersions']
                             and observed.get('moduleStatesReady') is True)
        checks['database'] = (observed.get('database') == binding['database'] and observed.get('databaseReady') is True
                               and binding['database'] in expected['cronDatabases'])
        checks['session'] = observed.get('sessionStore') == expected['sessionStore'] and observed.get('sessionReadable') is True
        checks['filestore'] = (observed.get('filestore') == expected['filestore'] == binding['filestore']
                                and observed.get('filestoreReadable') is True)
        checks['assets'] = observed.get('assetsId') == expected['assetsId']
        checks['ai'] = observed.get('aiStateVersion') == expected['aiStateVersion']
        checks['readOnly'] = observed.get('readOnly') is True
        ready = all(checks.values())
        return {'ready': ready, 'checks': checks, 'reason': 'ready' if ready else 'readiness_mismatch',
                'poolId': expected['poolId'], 'releaseId': expected['releaseId']}
    except Exception:
        # Runtime adapters can fail arbitrarily; their text may contain credentials.
        return {'ready': False, 'checks': checks, 'reason': 'readiness_probe_failed'}
