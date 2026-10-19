# Part of Odoo. See LICENSE file for full copyright and licensing details.
import functools
import json
import os
import re
from pathlib import Path

from odoo.tests import HttpCase, new_test_user

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

# A test-only boolean feature for shared-service tests that must not depend on
# an application being installed. webvue_platform owns it, so it counts as
# installed wherever the test runs.
PROBE_FEATURE = 'test_probe.enabled'


def register_probe_feature(case, key=PROBE_FEATURE):
    """Add ``key`` to the feature registry for the length of one test."""
    env = case.env
    profile = env.ref('webvue_platform.tenant_profile')
    # Initialise the tenant before the registry grows: the one-shot legacy
    # policy validates the complete feature set and does not know the probe.
    profile._webvue_initialize_legacy_policy(env['webvue.feature.registry']._webvue_installed_module_ids())
    registry = type(env['webvue.feature.registry'])
    definitions = registry._webvue_feature_definitions
    probe = {'key': key, 'type': 'boolean', 'owner': 'webvue_platform', 'module': 'webvue_platform'}
    case.patch(registry, '_webvue_feature_definitions', lambda model: (*definitions(model), probe))


def set_probe_feature(case, key=PROBE_FEATURE, enabled=True, retained=False):
    """Switch a registered probe feature; ``retained`` keeps its reads open while it is off."""
    profile = case.env.ref('webvue_platform.tenant_profile')
    kept = [item for item in (profile.retained_read_features or []) if item != key]
    profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
        'features': {**(profile.features or {}), key: enabled},
        'retained_read_features': [*kept, key] if retained else kept,
    })


FIXTURE_DIR_ENV = 'WEBVUE_CONTRACT_FIXTURES'
FIXTURE_MANIFEST = Path(__file__).resolve().parents[3] / 'packages' / 'contracts' / 'fixtures' / 'manifest.json'
DATETIME_PREFIX = re.compile(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}')
ROUTE_PLACEHOLDER = re.compile(r'\\\{\w+\\\}')  # an escaped {name} in a manifest route
_recorded_sizes = {}


def _normalize_fixture(body):
    """Renumber positive ids by first appearance and pin the digits of timestamps.

    Separators and suffixes are kept as they are, so a malformed timestamp still fails its schema.
    """
    ids = {}

    def walk(value, key=None):
        if isinstance(value, dict):
            return {k: walk(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [walk(v, key) for v in value]
        if key == 'id' and isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return ids.setdefault(value, len(ids) + 1)
        if isinstance(value, str) and DATETIME_PREFIX.match(value):
            return '2026-01-01' + value[10] + '00:00:00' + value[19:]
        return value

    return walk(body)


@functools.lru_cache(maxsize=1)
def _fixture_routes():
    """The manifest entries as (method, status, compiled route pattern, name)."""
    entries = json.loads(FIXTURE_MANIFEST.read_text())['fixtures']
    return tuple(
        (entry['method'], entry['status'], re.compile('^' + ROUTE_PLACEHOLDER.sub(r'\\d+', re.escape(entry['route'])) + '$'), entry['name'])
        for entry in entries
    )


def _fixture_name(method, path, status):
    """Manifest fixture name for a response, or None when no manifest entry matches it."""
    route = path.split('?')[0]
    for entry_method, entry_status, pattern, name in _fixture_routes():
        if entry_method == method and entry_status == status and pattern.match(route):
            return name
    return None


def record_contract_fixture(method, path, response):
    """Opt-in recorder (``WEBVUE_CONTRACT_FIXTURES=<dir>``): keep the richest response per manifest fixture."""
    directory = os.environ.get(FIXTURE_DIR_ENV)
    name = directory and _fixture_name(method, path, response.status_code)
    if not name:
        return
    body = _normalize_fixture(response.json())
    size = len(json.dumps(body))
    key = (directory, name)
    if size <= _recorded_sizes.get(key, 0):
        return
    _recorded_sizes[key] = size
    target = Path(directory) / f'{name}.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(body, indent=2, sort_keys=True, ensure_ascii=False) + '\n')


class WebVueApiCase(HttpCase):
    """Shared HTTP fixture: the base webvue employee role plus a JSON ``api()`` helper.

    Holds nothing pillar-specific — a pillar addon subclasses this and adds
    its own records (see ``webvue_pmo/tests/common.py``) so the pillars never
    write to this file.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('webvue_platform.tenant_profile', raise_if_not_found=False)
        if profile:
            profile._webvue_initialize_legacy_policy(
                cls.env['webvue.feature.registry']._webvue_installed_module_ids(),
            )
        cls.employee = new_test_user(cls.env, login='api_emp', password='api_emp_pass_123',
                                     name='Sara', groups='webvue_core.group_employee')

    def api(self, method, path, json=None, timeout=None):
        headers = {'Content-Type': 'application/json'}
        kwargs = {} if timeout is None else {'timeout': timeout}
        response = self.url_open(path, json=json, headers=headers, method=method, **kwargs)
        record_contract_fixture(method, path, response)
        return response
