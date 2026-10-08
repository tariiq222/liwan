# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Apply a commercial subscription revision (reconfigure) to an existing tenant.

JSON stdin/stdout, no shell. Actions: ``reconfigure`` and ``observe``. Odoo
scripts run through an injectable runner (the Compose runner reuses the
odoo_effect execution mechanism). Modules are only ever installed, never
uninstalled; downgrades never delete data and are refused when usage exceeds
the new limits. A journal (exclusive-create, symlink-checked) makes reruns
observe first and continue without duplicating branches.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import re
import signal
import sys

from tools.shared_saas_lifecycle import odoo_effect
from tools.shared_saas_lifecycle.odoo_effect import EffectError, MAX_OUTPUT

UUID_RE = re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
DIGEST_RE = re.compile(r'[a-f0-9]{64}')
FEATURE_RE = re.compile(r'[a-z][a-z0-9_.-]{0,63}')
ORDER_RE = re.compile(r'[A-Za-z0-9_.:-]{1,128}')
HOST_RE = re.compile(r'[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?')
SENTINEL = 'NASQ_SUBSCRIPTION:'
SCRIPT_ERRORS = frozenset({
    'stale_target', 'observed_mismatch', 'profile_invalid', 'target_mismatch',
    'branch_binding_invalid', 'branch_binding_conflict', 'branch_not_found',
    'feature_not_included', 'subscription_script_failed',
})
BRANCH_LIMIT = 'branches.extra_limit'


def _uuid(value, code):
    if not isinstance(value, str) or not UUID_RE.fullmatch(value):
        raise EffectError(code)
    return value


def validate_features(value):
    if (not isinstance(value, dict) or len(value) > 256
            or not all(isinstance(k, str) and FEATURE_RE.fullmatch(k)
                       and (isinstance(v, bool) or v is None
                            or (type(v) is int and 0 <= v <= 1000000000))
                       for k, v in value.items())):
        raise EffectError('features_invalid')
    return value


def validate_tenant(value):
    if (not isinstance(value, dict) or set(value) != {'database', 'host'}
            or not isinstance(value['host'], str) or not HOST_RE.fullmatch(value['host'])):
        raise EffectError('tenant_invalid')
    odoo_effect.validate_database(value['database'])
    return value


def validate_reconfigure(request):
    for key in ('tenant', 'order_id', 'operation_id', 'previous_revision_id',
                'target_revision_id', 'entitlement', 'branches'):
        if key not in request:
            raise EffectError('input_invalid')
    validate_tenant(request['tenant'])
    if not isinstance(request['order_id'], str) or not ORDER_RE.fullmatch(request['order_id']):
        raise EffectError('order_invalid')
    _uuid(request['operation_id'], 'operation_invalid')
    _uuid(request['target_revision_id'], 'revision_invalid')
    if request['previous_revision_id'] is not None:
        _uuid(request['previous_revision_id'], 'revision_invalid')
    ent = request['entitlement']
    if (not isinstance(ent, dict) or set(ent) != {'modules', 'features', 'digest', 'compiler_version'}
            or not isinstance(ent['digest'], str) or not DIGEST_RE.fullmatch(ent['digest'])
            or not isinstance(ent['compiler_version'], (str, int)) or isinstance(ent['compiler_version'], bool)):
        raise EffectError('entitlement_invalid')
    odoo_effect.validate_modules(ent['modules'])
    validate_features(ent['features'])
    login = request.get('admin_login')
    if login is not None and (not isinstance(login, str) or not 1 <= len(login) <= 254
                              or any(ord(c) < 32 for c in login)):
        raise EffectError('input_invalid')
    branches = request['branches']
    if not isinstance(branches, dict) or set(branches) != {'apply', 'archive'}:
        raise EffectError('branches_invalid')
    apply, archive = branches['apply'], branches['archive']
    if not isinstance(apply, list) or not isinstance(archive, list) or len(apply) > 256 or len(archive) > 256:
        raise EffectError('branches_invalid')
    ids = []
    for item in apply:
        if (not isinstance(item, dict) or set(item) != {'branch_id', 'name'}
                or not isinstance(item['name'], str) or not 1 <= len(item['name']) <= 120
                or any(ord(c) < 32 for c in item['name'])):
            raise EffectError('branches_invalid')
        ids.append(_uuid(item['branch_id'], 'branches_invalid'))
    archived = [_uuid(item, 'branches_invalid') for item in archive]
    if len(set(ids)) != len(ids) or len(set(archived)) != len(archived) or set(ids) & set(archived):
        raise EffectError('branches_duplicate')
    return request


def utc_now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ---------------------------------------------------------------- scripts
_COMMON = '''
OBS_ERRORS = %(errors)r
class Refusal(Exception):
    pass

def refuse(code):
    raise Refusal(code)

def collect(profile):
    root = profile.root_company_id
    feats = profile.features
    if type(feats) is not dict:
        refuse('profile_invalid')
    service = env['nasq.entitlement.service']
    modules = sorted(env['ir.module.module'].search([('state', '=', 'installed'), ('name', '=like', 'nasq\\\\_%%')]).mapped('name'))
    branches = []
    for b in env['nasq.tenant.branch'].with_context(active_test=False).search([]):
        c = b.company_id.with_context(active_test=False)
        branches.append({'branch_id': b.branch_uid, 'state': b.state, 'odoo_company_id': c.id,
                         'active': bool(c.active), 'parent_is_root': c.parent_id == root})
    definitions = env['nasq.feature.registry']._nasq_feature_map()
    usage, gates = {}, {}
    for key, item in sorted(definitions.items()):
        if item['type'] != 'limit':
            continue
        usage[key] = int(service._nasq_count_usage(key))
        owner = item['module']
        gates[key] = sorted(k for k, other in definitions.items()
                            if other['type'] == 'boolean' and other['module'] == owner and owner != 'nasq_platform')
    return {'database': env.cr.dbname, 'commercial_revision_id': profile.commercial_revision_id or None,
            'commercial_digest': profile.commercial_digest or None,
            'commercial_applied_at': str(profile.commercial_applied_at) if profile.commercial_applied_at else None,
            'features': feats, 'modules': modules, 'branches': branches, 'usage': usage, 'limit_gates': gates}

def read_profile():
    profile = env['nasq.tenant.profile'].search([], limit=2)
    if len(profile) != 1:
        refuse('profile_invalid')
    return profile
''' % {'errors': sorted(SCRIPT_ERRORS)}

_OBSERVE_BODY = '''
try:
    env.cr.rollback()
    env.cr.execute('SET TRANSACTION READ ONLY')
    env.invalidate_all(flush=False)
    if env.cr.dbname != values['database']:
        refuse('target_mismatch')
    result = collect(read_profile())
    env.cr.rollback()
except Refusal as exc:
    result = {'error_code': str(exc)}
    env.cr.rollback()
except Exception:
    result = {'error_code': 'subscription_script_failed'}
    env.cr.rollback()
'''

_APPLY_BODY = '''
try:
    from odoo import fields
    from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT
    if env.cr.dbname != values['database'] or not env.su:
        refuse('target_mismatch')
    profile = read_profile()._nasq_lock()
    current = profile.commercial_revision_id or None
    if current not in (None, values['previous_revision_id'], values['target_revision_id']):
        refuse('stale_target')
    if current == values['target_revision_id'] and (profile.commercial_digest or None) != values['digest']:
        refuse('observed_mismatch')
    operator = profile.with_context(**{OPERATOR_CONTEXT: True})
    not_granted = None
    if current != values['target_revision_id']:
        roles_before = env['nasq.entitlement.service']._nasq_entitled_admin_roles()
        # Every application stays installed; keys the target omits close (booleans
        # false, limits 0). Odoo still refuses a target without its platform keys.
        features = env['nasq.entitlement.service']._nasq_close_unlisted_features(values['features'])
        operator.write({'features': features, 'commercial_revision_id': values['target_revision_id'],
                        'commercial_digest': values['digest'],
                        'commercial_applied_at': fields.Datetime.now()})
        # Roles the policy newly opened go to the enrolment administrator only.
        granted = operator._nasq_grant_opened_admin_roles(values['admin_login'], roles_before)
        opened = [k for k in env['nasq.entitlement.service']._nasq_entitled_admin_roles() if k not in set(roles_before or ())]
        if opened and not granted:
            not_granted = 'no_admin_login' if not values['admin_login'] else 'admin_not_found'
    # Archive first so a swap never trips branches.extra_limit; data is kept.
    for uid in values['archive']:
        branch = env['nasq.tenant.branch'].search([('branch_uid', '=', uid)])
        if branch and branch.state == 'active':
            operator._nasq_archive_branch(values['operation_id'], uid)
    if values['apply']:
        operator._nasq_apply_branches(values['operation_id'], values['target_revision_id'], values['apply'])
    result = {'applied': True}
    if not_granted:
        result.update({'roles_not_granted': True, 'roles_not_granted_reason': not_granted})
    env.cr.commit()
except Refusal as exc:
    result = {'error_code': str(exc)}
    env.cr.rollback()
except Exception:
    result = {'error_code': 'subscription_script_failed'}
    env.cr.rollback()
'''

_TAIL = "print(%r + json.dumps(result, sort_keys=True, allow_nan=False))\n" % SENTINEL


def _prefix(values):
    return 'import json\nvalues = json.loads(' + repr(json.dumps(values, ensure_ascii=True)) + ')\nresult = {"error_code": "subscription_script_failed"}\n'


def build_observe_script(database):
    odoo_effect.validate_database(database)
    return _prefix({'database': database}) + _COMMON + _OBSERVE_BODY + _TAIL


def build_apply_script(request):
    ent, br = request['entitlement'], request['branches']
    values = {'database': request['tenant']['database'], 'operation_id': request['operation_id'],
              'previous_revision_id': request['previous_revision_id'],
              'target_revision_id': request['target_revision_id'], 'digest': ent['digest'],
              'features': ent['features'], 'apply': br['apply'], 'archive': br['archive'],
              'admin_login': request.get('admin_login')}
    return _prefix(values) + _COMMON + _APPLY_BODY + _TAIL


def parse_output(stdout):
    rows = [line[len(SENTINEL):] for line in stdout.splitlines() if line.startswith(SENTINEL)]
    if len(rows) != 1:
        raise EffectError('subscription_script_failed')
    try:
        value = json.loads(rows[0])
    except ValueError:
        raise EffectError('subscription_script_failed') from None
    if not isinstance(value, dict):
        raise EffectError('subscription_script_failed')
    if 'error_code' in value:
        code = value['error_code']
        raise EffectError(code if code in SCRIPT_ERRORS else 'subscription_script_failed')
    return value


def validate_observation(value):
    keys = {'database', 'commercial_revision_id', 'commercial_digest', 'commercial_applied_at',
            'features', 'modules', 'branches', 'usage', 'limit_gates'}
    if set(value) != keys:
        raise EffectError('observation_invalid')
    odoo_effect.validate_database(value['database'])
    validate_features(value['features'])
    for field in ('commercial_revision_id', 'commercial_digest', 'commercial_applied_at'):
        if value[field] is not None and not isinstance(value[field], str):
            raise EffectError('observation_invalid')
    if not isinstance(value['modules'], list) or not all(isinstance(m, str) for m in value['modules']):
        raise EffectError('observation_invalid')
    usage, gates = value['usage'], value['limit_gates']
    if (not isinstance(usage, dict) or not 1 <= len(usage) <= 256
            or not all(isinstance(k, str) and FEATURE_RE.fullmatch(k) and type(v) is int and v >= 0
                       for k, v in usage.items())):
        raise EffectError('observation_invalid')
    if not {'users.limit', 'storage.limit_mb', BRANCH_LIMIT} <= set(usage):
        raise EffectError('observation_invalid')
    if (not isinstance(gates, dict) or set(gates) != set(usage)
            or not all(isinstance(g, list) and all(isinstance(k, str) and FEATURE_RE.fullmatch(k) for k in g)
                       for g in gates.values())):
        raise EffectError('observation_invalid')
    if not isinstance(value['branches'], list):
        raise EffectError('observation_invalid')
    for item in value['branches']:
        if (not isinstance(item, dict)
                or set(item) != {'branch_id', 'state', 'odoo_company_id', 'active', 'parent_is_root'}
                or item['state'] not in ('active', 'archived') or type(item['odoo_company_id']) is not int
                or type(item['active']) is not bool or type(item['parent_is_root']) is not bool):
            raise EffectError('observation_invalid')
    return value


# ----------------------------------------------------------------- effect
def _same(a, b):
    return a.keys() == b.keys() and all(type(a[k]) is type(b[k]) and a[k] == b[k] for k in a)


def check_downgrade(request, observed):
    """Refuse (before any write) when a target limit sits below current usage.

    Same rule as the control plane's assertDowngradeFitsUsage. A numeric target limit is
    CHECKED when it is lowered against the current policy (absent or null = unlimited) or
    when its application reopens (closed now, open in the target). It is SKIPPED when the
    target closes its application (it has gates and every one is false; an absent gate
    key is not false). Usage equal to the limit is allowed. Platform limits have no gates.
    """
    features, usage, br = request['entitlement']['features'], observed['usage'], request['branches']
    previous, gates = observed['features'], observed['limit_gates']

    def closed(keys, values):
        return bool(keys) and all(values.get(gate) is False for gate in keys)

    for key, used in sorted(usage.items()):
        if key == BRANCH_LIMIT:
            continue
        limit = features.get(key)
        if limit is None or isinstance(limit, bool):
            continue
        keys = gates.get(key) or []
        if closed(keys, features):
            continue
        before = previous.get(key)
        lowered = before is None or (not isinstance(before, bool) and limit < before)
        reopened = closed(keys, previous) and any(features.get(gate) is True for gate in keys)
        if (lowered or reopened) and used > limit:
            raise EffectError('downgrade_below_usage')
    limit = features.get(BRANCH_LIMIT)
    if limit is not None and not isinstance(limit, bool):
        active = {b['branch_id'] for b in observed['branches'] if b['state'] == 'active'}
        projected = (active - set(br['archive'])) | {b['branch_id'] for b in br['apply']}
        if len(projected) > limit:
            raise EffectError('downgrade_below_usage')


def verify(request, observed):
    """True when the observation proves the target; raises nothing."""
    ent, br = request['entitlement'], request['branches']
    if observed['commercial_revision_id'] != request['target_revision_id'] or observed['commercial_digest'] != ent['digest']:
        return False
    if not all(k in observed['features'] and type(observed['features'][k]) is type(v)
               and observed['features'][k] == v for k, v in ent['features'].items()):
        return False
    by_id = {b['branch_id']: b for b in observed['branches']}
    for item in br['apply']:
        b = by_id.get(item['branch_id'])
        if not b or b['state'] != 'active' or not b['active'] or not b['parent_is_root']:
            return False
    for uid in br['archive']:
        if uid in by_id and by_id[uid]['state'] != 'archived':
            return False
    return True


class Journal:
    def __init__(self, directory, database, operation_id, target):
        self.dir = odoo_effect.no_symlink(directory)
        self.path = self.dir / (database + '.' + operation_id + '.json')
        self.record = {'operation_id': operation_id, 'target_revision_id': target, 'database': database}

    def begin(self):
        self.dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        odoo_effect.no_symlink(self.dir)
        try:
            odoo_effect.reserve(self.path, self.record)
            return False
        except EffectError:
            odoo_effect.no_symlink(self.path)
            if json.loads(self.path.read_text()) != self.record:
                raise EffectError('journal_conflict') from None
            return True  # resuming the same operation

    def done(self):
        try:
            odoo_effect.reserve(self.path.with_suffix('.done'), self.record)
        except EffectError:
            pass


class SubscriptionEffect:
    """runner: database_exists()->bool, run_script(script, stage, mutate=False)->str,
    install_modules(names)."""

    def __init__(self, runner, journal_dir, clock=utc_now):
        self.runner, self.journal_dir, self.clock = runner, journal_dir, clock

    def _observe(self, database):
        if self.runner.database_exists() is not True:
            raise EffectError('database_missing')
        return validate_observation(parse_output(
            self.runner.run_script(build_observe_script(database), 'observe')))

    def observe(self, request):
        database = validate_tenant(request['tenant'])['database']
        observed = self._observe(database)
        return {**observed, 'observed_at': self.clock()}

    def receipt(self, request, observed, installed, not_granted=None):
        by_id = {b['branch_id']: b for b in observed['branches']}
        extra = {'roles_not_granted': True, 'roles_not_granted_reason': not_granted} if not_granted else {}
        return {**extra, 'order_id': request['order_id'], 'database': observed['database'],
                'tenant_id': observed['database'],
                'target_revision_id': request['target_revision_id'],
                'observed_entitlement_digest': observed['commercial_digest'],
                'observed_at': self.clock(),
                'branch_bindings': [{'branch_id': b['branch_id'], 'odoo_company_id': by_id[b['branch_id']]['odoo_company_id']}
                                    for b in request['branches']['apply']],
                'modules_installed': installed}

    def reconfigure(self, request):
        validate_reconfigure(request)
        database, target = request['tenant']['database'], request['target_revision_id']
        observed = self._observe(database)
        current = observed['commercial_revision_id']
        if current not in (None, request['previous_revision_id'], target):
            raise EffectError('stale_target')
        if current == target and observed['commercial_digest'] != request['entitlement']['digest']:
            raise EffectError('observed_mismatch')
        journal = Journal(self.journal_dir, database, request['operation_id'], target)
        if verify(request, observed):
            journal.begin()
            journal.done()
            return self.receipt(request, observed, [])
        if current != target:
            check_downgrade(request, observed)
        journal.begin()
        missing = [m for m in request['entitlement']['modules'] if m not in observed['modules']]
        if missing:
            self.runner.install_modules(missing)
        applied = parse_output(self.runner.run_script(build_apply_script(request), 'apply', mutate=True))
        not_granted = applied.get('roles_not_granted_reason') if applied.get('roles_not_granted') is True else None
        after = self._observe(database)
        if not verify(request, after):
            raise EffectError('observed_mismatch')
        journal.done()
        return self.receipt(request, after, missing, not_granted if not_granted in ('no_admin_login', 'admin_not_found') else None)


# -------------------------------------------------------- default runner
class ComposeRunner(odoo_effect.Runner):
    """Reuses odoo_effect's compose command/shell mechanism for existing tenants."""

    def __init__(self, request, permit=None):
        config = request['config']
        if (set(config) != {'schemaVersion', 'projectName', 'composeFile', 'envFile', 'stateDir', 'domainSuffix'}
                or config['schemaVersion'] != 1
                or not re.fullmatch(r'nasq-(?:saas|shared)-[a-z0-9-]{3,48}', config['projectName'])):
            raise EffectError('runtime_invalid')
        for key in ('composeFile', 'envFile', 'stateDir'):
            odoo_effect.no_symlink(config[key])
        self.request, self.config = request, config
        self.database = odoo_effect.validate_database(request['tenant']['database'])
        self.root = odoo_effect.Path(config['stateDir'])
        self.base = ['docker', 'compose', '--project-name', config['projectName'], '--env-file',
                     config['envFile'], '--file', config['composeFile']]
        self.current_container = None
        self.child = None
        self.permit = permit or odoo_effect.permit

    def database_exists(self):
        return self.exists()

    def run_script(self, script, stage, mutate=False):
        if mutate:
            self.permit(stage)
        attempt = self.request.get('attemptId')
        if not isinstance(attempt, str) or not re.fullmatch(r'[a-f0-9-]{36}', attempt):
            raise EffectError('attempt_invalid')
        suffix = stage if mutate else stage + '-' + odoo_effect.secrets.token_hex(4)
        self.current_container = self.config['projectName'] + '-effect-' + attempt[:8] + '-' + suffix
        args = self.base + ['run', '--rm', '--no-deps', '-T', '--name', self.current_container,
            '-e', 'NASQ_COMMERCIAL_CONFIG=/run/nasq-runtime/classifications/' + self.database + '.json',
            '--entrypoint', '/usr/local/bin/nasq-odoo', 'odoo', 'shell', '-c', '/etc/odoo/odoo.conf',
            '-d', self.database, '--no-http']
        try:
            return self.command(args, stdin=script, timeout=180)
        finally:
            self.current_container = None

    def install_modules(self, names):
        odoo_effect.validate_modules(names)
        self.permit('modules')
        attempt = self.request['attemptId']
        self.current_container = self.config['projectName'] + '-effect-' + attempt[:8] + '-modules'
        try:
            self.command(self.base + ['run', '--rm', '--no-deps', '-T', '--name', self.current_container,
                '-e', 'NASQ_COMMERCIAL_CONFIG=/run/nasq-runtime/classifications/' + self.database + '.json',
                '--entrypoint', '/usr/local/bin/nasq-odoo', 'odoo', '-c', '/etc/odoo/odoo.conf', '-d', self.database,
                '-i', ','.join(names), '--stop-after-init', '--no-http'], timeout=1500)
        finally:
            self.current_container = None


def main(stdin=None, stdout=None):
    out = stdout or sys.stdout

    def emit(value):
        print(json.dumps(value, separators=(',', ':')), file=out, flush=True)
    try:
        raw = (stdin or sys.stdin).readline(MAX_OUTPUT + 1)
        if len(raw) > MAX_OUTPUT:
            raise EffectError('input_invalid')
        request = json.loads(raw)
        action = request.get('action')
        if action not in ('reconfigure', 'observe'):
            raise EffectError('operation_unavailable')
        validate_tenant(request['tenant'])
        runner = ComposeRunner(request)

        def terminate(_signum, _frame):
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            # Kill the per-attempt effect container, not only the compose client.
            runner.cancel()
            raise EffectError('authority_lost')
        signal.signal(signal.SIGTERM, terminate)
        signal.signal(signal.SIGINT, terminate)
        if not isinstance(request.get('fence'), (int, str)) or not request.get('attemptId'):
            raise EffectError('input_invalid')
        effect = SubscriptionEffect(runner, odoo_effect.Path(request['config']['stateDir']) / 'reconfigure')
        emit({'result': effect.observe(request) if action == 'observe' else effect.reconfigure(request)})
    except EffectError as exc:
        emit({'error_code': str(exc)})
        return 1
    except Exception:
        emit({'error_code': 'shared_effect_unverified'})
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
