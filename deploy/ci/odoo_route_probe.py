# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Call the parameterless GET /api/v1 routes of some modules on a scratch database; run inside `odoo-bin shell`.

    WEBVUE_PROBE_ANSWER=webvue_hr [WEBVUE_PROBE_ALSO_ANSWER=webvue_documents_hr] [WEBVUE_PROBE_OFF=webvue_documents] \
      [WEBVUE_PROBE_CALM=webvue_documents_hr] \
      odoo-bin shell -d <scratch db> ... < deploy/ci/odoo_route_probe.py

Every boolean feature of the installed modules is switched on (reads and writes), then every feature owned
by WEBVUE_PROBE_OFF is switched off with no retained read. A probe user holding every assignable role of the
company calls, through the real HTTP dispatch (ir.http guard, feature and capability gates):

- the routes of WEBVUE_PROBE_ANSWER and WEBVUE_PROBE_ALSO_ANSWER modules, which must answer 2xx (or 400/422 for a
  missing query input);
- the routes of WEBVUE_PROBE_OFF, which must own at least one boolean feature and must refuse with 403 ``feature_not_included`` (nothing leaks);
- the routes of WEBVUE_PROBE_CALM modules, which may refuse but must not fail with a 5xx.

With WEBVUE_PROBE_ACCOUNTS=1 (the foundation-alone run) the probe user also creates an account with the
foundation contract (name, login, password, assignments: no HR employee), disables and reactivates it; each
step must answer 2xx.

A WEBVUE_PROBE_ANSWER module without a single parameterless GET route, or with none answering 2xx, fails the
probe, since it would prove nothing; WEBVUE_PROBE_ALSO_ANSWER is for a bridge, which may serve no route of its own. The last
line is ``ROUTE_PROBE_OK`` only when every call met its expectation; the calling stage requires it.
"""
import os
import sys

from werkzeug.test import Client

from odoo import http
from odoo.service import security

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

PROBE_LOGIN = 'webvue_ci_route_probe'
ACCOUNT_LOGIN = 'webvue-ci-account@example.invalid'
ACCOUNT_PASSWORD = 'ci-account-pass-1'  # a disposable scratch database account
NEEDS_INPUT = (400, 422)


def modules_from(name):
    return [module for module in os.environ.get(name, '').split(',') if module]


def endpoint_module(endpoint):
    """The addon whose controller code serves the route, following decorator wrappers."""
    current, seen = endpoint, set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        module = getattr(current, '__module__', '') or ''
        if module.startswith('odoo.addons.'):
            return module.split('.')[2]
        current = getattr(current, '__wrapped__', None) or getattr(current, '__func__', None)
    return None


def probed_routes(env, modules):
    """Sorted (module, path) of the parameterless GET /api/v1 routes the modules serve."""
    routes = set()
    for rule in env['ir.http'].routing_map().iter_rules():
        if rule.arguments or not rule.rule.startswith('/api/v1/'):
            continue
        routing = getattr(rule.endpoint, 'routing', None) or {}
        methods = routing.get('methods')
        if methods and 'GET' not in methods:
            continue
        module = endpoint_module(rule.endpoint)
        if module in modules:
            routes.add((module, rule.rule))
    return sorted(routes)


def set_features(env, off_module):
    """All installed boolean features on, the ones off_module owns off and not retained."""
    profile = env.ref('webvue_platform.tenant_profile')
    registry = env['webvue.feature.registry']
    installed = registry._webvue_installed_module_ids()
    profile._webvue_initialize_legacy_policy(installed)
    features = dict(profile.features or {})
    switched_off = []
    for key, definition in registry._webvue_feature_map().items():
        if definition['type'] != 'boolean' or definition['module'] not in installed:
            continue
        features[key] = definition['module'] != off_module
        if not features[key]:
            switched_off.append(key)
    retained = sorted(key for key, value in features.items() if value is True)
    profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
        'features': features, 'retained_read_features': retained,
    })
    return sorted(switched_off)


def probe_user(env):
    """A company user holding every active assignable role of the company."""
    company = env.company
    user = env['res.users'].with_context(active_test=False).search([('login', '=', PROBE_LOGIN)])
    if not user:
        user = env['res.users'].with_context(no_reset_password=True).create({
            'name': 'CI route probe', 'login': PROBE_LOGIN,
            'company_id': company.id, 'company_ids': [(6, 0, company.ids)],
            'group_ids': [(4, env.ref('webvue_core.group_employee').id)],
        })
    roles = env['webvue.access.role'].search([
        ('active', '=', True), ('assignable', '=', True), ('company_id', 'in', (False, company.id)),
    ])
    held = env['webvue.access.assignment'].search([('user_id', '=', user.id)]).role_id
    env['webvue.access.assignment'].create([
        {'user_id': user.id, 'role_id': role.id, 'company_id': company.id} for role in roles - held
    ])
    return user, roles


def session_cookie(env, user):
    store = http.root.session_store
    session = store.new()
    session.update(http.get_default_session(), db=env.cr.dbname)
    session.uid = user.id
    session.login = user.login
    session.session_token = security.compute_session_token(session, env(user=user.id))
    session.context = dict(env['res.users'].with_user(user).context_get())
    store.save(session)
    return f'session_id={session.sid}'


def verdict(expectation, status, body):
    refused = 'feature_not_included' in body
    if status >= 500:
        return f'server error {status}'
    # 400/422 is a route that needs a query input the probe does not invent; its own validation answered.
    if expectation == 'answer' and not (200 <= status < 300 or status in NEEDS_INPUT):
        return f'did not answer ({status}{", feature_not_included" if refused else ""})'
    if expectation == 'closed' and not (status == 403 and refused):
        return f'not closed by its switched-off feature ({status})'
    return None


def account_lifecycle(env, client, cookie):
    """Create, disable and reactivate an account through /api/v1/admin/users; the failures, if any."""
    role = env['webvue.access.role'].search([('key', '=', 'employee')], limit=1)
    create = {
        'name': 'CI account', 'login': ACCOUNT_LOGIN, 'password': ACCOUNT_PASSWORD,
        'assignments': [{'role_id': role.id, 'scope': {'kind': 'company', 'id': env.company.id}}],
    }
    steps = [('create', '/api/v1/admin/users', lambda account: create),
             ('disable', '/api/v1/admin/users/{id}/disable', lambda account: {'expected_version': account['version']}),
             ('reactivate', '/api/v1/admin/users/{id}/reactivate',
              lambda account: {'expected_version': account['version'], 'password': ACCOUNT_PASSWORD})]
    account = {}
    for action, route, payload in steps:
        path = route.format(id=account.get('id'))
        response = client.post(path, json=payload(account), headers={'Cookie': cookie})
        print(f'account {response.status_code} POST {path}')
        if not 200 <= response.status_code < 300:
            body = response.get_data(as_text=True)
            return [f'account {action} without HR: POST {path} {response.status_code}: {body[:300]}']
        account = response.get_json()
    return []


def run(env):
    off = os.environ.get('WEBVUE_PROBE_OFF', '')
    switched_off = set_features(env, off)
    user, roles = probe_user(env)
    env.cr.commit()
    print(f'probe user holds {len(roles)} roles; features switched off for {off or "nothing"}: {switched_off or "none"}')
    cookie = session_cookie(env, user)
    client = Client(http.root, use_cookies=False)
    me = client.get('/api/v1/me', headers={'Cookie': cookie})
    if me.status_code != 200:
        print('ROUTE_PROBE_FAILED', f'the probe session is not accepted: GET /api/v1/me {me.status_code}', sep='\n')
        sys.exit(1)
    required = modules_from('WEBVUE_PROBE_ANSWER')
    plan = [
        ('answer', required + modules_from('WEBVUE_PROBE_ALSO_ANSWER')),
        ('closed', [off] if switched_off else []),
        ('calm', modules_from('WEBVUE_PROBE_CALM')),
    ]
    failures = [f'{off}: owns no boolean feature, so switching it off proves nothing'] if off and not switched_off else []
    answered = set()
    for expectation, modules in plan:
        routes = probed_routes(env, set(modules))
        served = {owner for owner, _path in routes}
        failures += [f'{module}: no parameterless GET /api/v1 route to probe' for module in required
                     if expectation == 'answer' and module not in served]
        for module, path in routes:
            response = client.get(path, headers={'Cookie': cookie, 'Accept': 'application/json'})
            body = response.get_data(as_text=True)
            problem = verdict(expectation, response.status_code, body)
            print(f'{expectation:6} {response.status_code} {module} GET {path}' + (f'  <- {problem}' if problem else ''))
            if problem:
                failures.append(f'{module} GET {path}: {problem}: {body[:300]}')
            elif expectation == 'answer' and 200 <= response.status_code < 300:
                answered.add(module)
    failures += [f'{module}: no route answered 2xx (only input errors)' for module in required if module not in answered]
    if os.environ.get('WEBVUE_PROBE_ACCOUNTS') == '1':
        failures += account_lifecycle(env, client, cookie)
    if failures:
        print('ROUTE_PROBE_FAILED', *failures, sep='\n')
        sys.exit(1)
    print('ROUTE_PROBE_OK')


run(env)  # noqa: F821 - `env` is provided by odoo-bin shell
