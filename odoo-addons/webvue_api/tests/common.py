# Part of Odoo. See LICENSE file for full copyright and licensing details.
import functools
import json
import os
import re
from pathlib import Path

from odoo.tests import HttpCase, new_test_user
from odoo.tests.common import HOST

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


class CompanyIsolationCase(WebVueApiCase):
    """Company matrix for request-scoped isolation: parent P, branches P1/P2,
    independent C.

    ``iso_user`` holds the built-in employee role in all four companies, so any
    visibility difference comes from the request's pinned company set, never
    from a missing assignment. Branches are linked through ``res.company.parent_id``
    (the same link ``webvue_platform`` creates for tenant branches), which is
    what ``child_of`` walks.
    """

    NOT_FOUND_ID = 999999999

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Company = cls.env['res.company'].sudo()
        cls.company_p = Company.create({'name': 'Isolation P'})
        cls.company_p1 = Company.create({'name': 'Isolation P1', 'parent_id': cls.company_p.id})
        cls.company_p2 = Company.create({'name': 'Isolation P2', 'parent_id': cls.company_p.id})
        cls.company_c = Company.create({'name': 'Isolation C'})
        # company_id pins the current company into the new set: base's
        # _check_user_company requires company_id to stay inside company_ids,
        # and the default (main) company is not part of the isolation matrix.
        cls.iso_user = new_test_user(cls.env, login='iso_emp', password='iso_emp_pass_123',
                                     name='Iso', groups='webvue_core.group_employee',
                                     company_id=cls.company_p.id)
        # Membership first: the assignment constraint requires the company to be
        # in the user's own company_ids.
        cls.iso_user.company_ids = [(6, 0, [
            cls.company_p.id, cls.company_p1.id, cls.company_p2.id, cls.company_c.id])]
        role = cls.env.ref('webvue_core.role_employee')
        Assignment = cls.env['webvue.access.assignment'].sudo()
        for company in (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c):
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': role.id, 'company_id': company.id})

    def env_in(self, company):
        """Authenticate iso_user with `company` as the server-side current company."""
        self.iso_user.company_id = company.id
        self.authenticate('iso_emp', 'iso_emp_pass_123')

    def api_forged(self, method, path, hidden_id, json=None):
        """One plain call plus the three forgery vectors for `hidden_id`.

        Returns the list of responses: plain, cids cookie, cids query and a
        body carrying allowed_company_ids naming the hidden company first.
        """
        current = self.iso_user.company_id.id
        forged = f'{hidden_id}-{current}'
        self.opener.cookies.set('cids', forged, domain=HOST, path='/')
        try:
            responses = [self.api(method, path, json=json)]
            responses.append(self.api(method, f'{path}{"&" if "?" in path else "?"}cids={hidden_id},{current}'))
            body = dict(json or {})
            body['context'] = {'allowed_company_ids': [hidden_id, current]}
            responses.append(self.api(method, path, json=body))
        finally:
            self.opener.cookies.clear(domain=HOST, path='/', name='cids')
        return responses

    def assertVisible(self, path):
        response = self.api('GET', path)
        self.assertEqual(response.status_code, 200, f'{path} must be visible: {response.text[:200]}')
        return response

    def assertHidden(self, path):
        """404 byte-identical to the route's own not-found response."""
        response = self.api('GET', path)
        stem, _, query = path.partition('?')
        missing = re.sub(r'(\d+)(?!.*\d)', str(self.NOT_FOUND_ID), stem)
        reference = self.api('GET', f'{missing}?{query}' if query else missing)
        self.assertEqual(response.status_code, 404, f'{path} must be hidden: {response.text[:200]}')
        self.assertEqual(response.content, reference.content,
                         f'{path} 404 must be byte-identical to not-found')
        return response

    def assertHiddenEveryWay(self, method, path, hidden_id, json=None):
        for response in self.api_forged(method, path, hidden_id, json=json):
            self.assertEqual(response.status_code, 404,
                             f'{path} must stay hidden under forgery: {response.text[:200]}')
        return self.assertHidden(path)


# Route-pattern registries backing the discovery test in
# test_company_isolation.py: every GET /api/v1 record route must be either
# covered by an isolation case or exempted with an explicit reason.
ISOLATION_COVERED_ROUTES: dict[str, str] = {}
ISOLATION_NOT_APPLICABLE: dict[str, str] = {}


def cover_isolation_routes(patterns, source):
    """Record that `source` exercises the company matrix on these route patterns."""
    for pattern in patterns:
        ISOLATION_COVERED_ROUTES.setdefault(pattern, source)


def exempt_isolation_route(pattern, reason):
    """Record that `pattern` has no company scope (with the reason made explicit)."""
    ISOLATION_NOT_APPLICABLE[pattern] = reason
