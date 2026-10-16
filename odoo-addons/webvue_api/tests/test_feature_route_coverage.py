# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

BASE_PATHS = {
    '/api/v1/me',
    '/api/v1/me/password',
    '/api/v1/me/appearance',
    '/api/v1/branding',
}
BASE_PATH_PREFIXES = (
    '/api/v1/auth/',
    '/api/v1/admin/',
)
# Mixed-owner writes keep controller-level resource checks instead of a
# single feature key. Reads still declare keys.
NOTIFICATION_WRITE_ENDPOINTS = frozenset({
    '/api/v1/notifications/<int:notification_id>/read',
    '/api/v1/notifications/read-all',
})


@tagged('post_install', '-at_install', 'webvue')
class TestFeatureRouteCoverage(TransactionCase):

    def _endpoint_attr(self, endpoint, name):
        current = endpoint
        seen = set()
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            value = getattr(current, name, None)
            if value:
                return value
            current = getattr(current, '__wrapped__', None)
        return None

    def test_non_base_json_routes_declare_feature_metadata(self):
        missing = []
        invalid = []
        for rule in self.env['ir.http'].routing_map().iter_rules():
            endpoint = rule.endpoint
            if not endpoint:
                continue
            routing = getattr(endpoint, 'routing', None) or {}
            path = routing.get('routes') or rule.rule
            if isinstance(path, (list, tuple)):
                paths = path
            else:
                paths = [path]
            methods = routing.get('methods') or []
            auth = routing.get('auth')
            for item in paths:
                if not str(item).startswith('/api/v1/'):
                    continue
                if auth != 'user':
                    continue
                if str(item) in BASE_PATHS or any(str(item).startswith(prefix) for prefix in BASE_PATH_PREFIXES):
                    continue
                if str(item) in NOTIFICATION_WRITE_ENDPOINTS:
                    continue
                keys = self._endpoint_attr(endpoint, '_webvue_feature_keys')
                operation = self._endpoint_attr(endpoint, '_webvue_feature_operation')
                if not keys:
                    missing.append(f'{methods} {item}')
                    continue
                if operation not in ('read', 'write'):
                    invalid.append(f'{methods} {item} operation={operation}')
        self.assertFalse(missing, f'routes missing requires_feature: {missing}')
        self.assertFalse(invalid, f'routes with invalid feature metadata: {invalid}')
