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
SENTINEL = 'LIWAN_SUBSCRIPTION:'
SCRIPT_ERRORS = frozenset({
    'stale_target', 'observed_mismatch', 'profile_invalid', 'target_mismatch',
    'tenant_upgrade_required', 'commercial_expiry_revision_stale',
    'branch_binding_invalid', 'branch_binding_conflict', 'branch_not_found',
    'feature_not_included', 'subscription_script_failed',
})
BRANCH_LIMIT = 'branches.extra_limit'
TRIAL_POLICY_KEYS = ('trial_ends_at', 'post_trial_features', 'post_trial_modules', 'post_trial_digest')
EXCESS_LIMITS = frozenset({'users.limit', 'storage.limit_mb', BRANCH_LIMIT})
OPTIONAL_OBSERVATION_KEYS = frozenset({'post_trial_supported', 'excess_supported', 'excess_settled', 'excess', 'storage_bytes', 'blocked_storage_bytes', *TRIAL_POLICY_KEYS})
BRANCH_ITEM_KEYS = frozenset({'branch_id', 'state', 'odoo_company_id', 'active', 'parent_is_root'})


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


def _aware_iso_datetime(value):
    """An ISO datetime with an explicit UTC offset or Z; naive and date-only strings are refused."""
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else None
    except ValueError:
        return False
    return parsed is not None and parsed.utcoffset() is not None


def validate_trial_end_keys(request):
    """Validate optional trial policy; its supported Odoo owner enforces the complete policy invariant."""
    if 'excess_settle' in request and type(request['excess_settle']) is not bool:
        raise EffectError('input_invalid')
    trial_end = request.get('trial_ends_at')
    if trial_end is not None and not _aware_iso_datetime(trial_end):
        raise EffectError('input_invalid')
    if 'post_trial_features' in request:
        validate_features(request['post_trial_features'])
    if 'post_trial_modules' in request:
        modules = request['post_trial_modules']
        # Not acted on yet: shape only, so an empty list or a module newer than this host is valid.
        if (not isinstance(modules, list) or len(modules) > 256 or len(set(map(str, modules))) != len(modules)
                or not all(isinstance(name, str) and odoo_effect.MODULE_ID.fullmatch(name) for name in modules)):
            raise EffectError('modules_invalid')
    digest = request.get('post_trial_digest')
    if 'post_trial_digest' in request and (not isinstance(digest, str) or not DIGEST_RE.fullmatch(digest)):
        raise EffectError('entitlement_invalid')


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
    if 'recoverable_predecessors' in request:
        lineage = request['recoverable_predecessors']
        if (request.get('excess_settle') is not True or 'trial_ends_at' not in request or request['trial_ends_at'] is not None
                or 'ai_push' in request or 'restore' in request or any(key in request for key in TRIAL_POLICY_KEYS[1:])
                or not isinstance(lineage, list)):
            raise EffectError('input_invalid')
        identifiers = set()
        for item in lineage:
            if (not isinstance(item, dict) or set(item) != {'revision_id', 'digest'}
                    or not isinstance(item['digest'], str) or not DIGEST_RE.fullmatch(item['digest'])):
                raise EffectError('input_invalid')
            revision_id = _uuid(item['revision_id'], 'input_invalid')
            if revision_id in identifiers or revision_id == request['target_revision_id']:
                raise EffectError('input_invalid')
            identifiers.add(revision_id)
    ai_post_digest = request.get('ai_expected_post_trial_digest')
    if 'ai_expected_post_trial_digest' in request and (
            request.get('ai_push') is not True or not isinstance(ai_post_digest, str)
            or not DIGEST_RE.fullmatch(ai_post_digest)):
        raise EffectError('input_invalid')
    if 'ai_push' in request:
        # The flag promises three AI values on the applied revision and nothing else.
        br = request['branches']
        if (request['ai_push'] is not True or not isinstance(br, dict) or br.get('apply') or br.get('archive') or br.get('restore')
                or 'commercial_valid_until' in request or 'commercial_valid_until_revision' in request
                or any(key in request for key in (*TRIAL_POLICY_KEYS, 'excess_settle'))):
            raise EffectError('input_invalid')
        ai = {key: value for key, value in ent['features'].items() if key.startswith(('ai.balance.', 'ai.allowance.'))}
        if not ai or any(type(value) is not int for value in ai.values()):
            raise EffectError('input_invalid')
    login = request.get('admin_login')
    if login is not None and (not isinstance(login, str) or not 1 <= len(login) <= 254
                              or any(ord(c) < 32 for c in login)):
        raise EffectError('input_invalid')
    commercial = request.get('commercial_valid_until')
    if commercial is not None and (not isinstance(commercial, str)
                                   or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', commercial)):
        raise EffectError('commercial_valid_until_invalid')
    revision = request.get('commercial_valid_until_revision')
    if revision is not None and (type(revision) is not int or revision < 0):
        raise EffectError('commercial_valid_until_invalid')
    validate_trial_end_keys(request)
    branches = request['branches']
    if not isinstance(branches, dict) or set(branches) not in ({'apply', 'archive'}, {'apply', 'archive', 'restore'}):
        raise EffectError('branches_invalid')
    apply, archive, restore = branches['apply'], branches['archive'], branches.get('restore', [])
    if (not isinstance(apply, list) or not isinstance(archive, list) or not isinstance(restore, list)
            or len(apply) > 256 or len(archive) > 256 or len(restore) > 256):
        raise EffectError('branches_invalid')
    ids = []
    for item in apply:
        if (not isinstance(item, dict) or set(item) != {'branch_id', 'name'}
                or not isinstance(item['name'], str) or not 1 <= len(item['name']) <= 120
                or any(ord(c) < 32 for c in item['name'])):
            raise EffectError('branches_invalid')
        ids.append(_uuid(item['branch_id'], 'branches_invalid'))
    archived = [_uuid(item, 'branches_invalid') for item in archive]
    restored = [_uuid(item, 'branches_invalid') for item in restore]
    if (len(set(ids)) != len(ids) or len(set(archived)) != len(archived) or set(ids) & set(archived)
            or len(set(restored)) != len(restored) or set(restored) & (set(ids) | set(archived))):
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

def _commercial_expiry_vals(values, profile, refuse):
    if 'commercial_valid_until' not in values:
        return {}
    current_revision = int(getattr(profile, 'commercial_valid_until_revision', 0) or 0)
    wanted_revision = int(values.get('commercial_valid_until_revision', current_revision))
    if wanted_revision < current_revision:
        refuse('commercial_expiry_revision_stale')
    expiry = values['commercial_valid_until']
    return {'commercial_valid_until': fields.Date.to_date(expiry) if expiry else False,
            'commercial_valid_until_revision': wanted_revision}


def _trial_policy_vals(values, profile, refuse):
    from datetime import datetime, timezone
    keys = ('trial_ends_at', 'post_trial_features', 'post_trial_modules', 'post_trial_digest')
    supplied = {key: values[key] for key in keys if key in values}
    if not supplied:
        return {}
    if not all(hasattr(profile, key) for key in keys):
        refuse('tenant_upgrade_required')
    if 'trial_ends_at' in supplied:
        end = supplied['trial_ends_at']
        supplied['trial_ends_at'] = (datetime.fromisoformat(end.replace('Z', '+00:00'))
                                    .astimezone(timezone.utc).replace(tzinfo=None)) if end else False
    return supplied


def collect(profile):
    root = profile.root_company_id
    service = env['liwan.entitlement.service']
    feats = service._liwan_features_payload(profile)
    if type(feats) is not dict:
        refuse('profile_invalid')
    modules = sorted(env['ir.module.module'].search([('state', '=', 'installed'), ('name', '=like', 'liwan\\\\_%%')]).mapped('name'))
    branches = []
    for b in env['liwan.tenant.branch'].with_context(active_test=False).search([]):
        c = b.company_id.with_context(active_test=False)
        item = {'branch_id': b.branch_uid, 'state': b.state, 'odoo_company_id': c.id,
                'active': bool(c.active), 'parent_is_root': c.parent_id == root}
        if 'read_only' in b._fields:
            item['read_only'] = bool(b.read_only)
        branches.append(item)
    definitions = env['liwan.feature.registry']._liwan_feature_map()
    usage, gates = {}, {}
    for key, item in sorted(definitions.items()):
        if item['type'] != 'limit':
            continue
        usage[key] = int(service._liwan_count_usage(key))
        owner = item['module']
        gates[key] = sorted(k for k, other in definitions.items()
                            if other['type'] == 'boolean' and other['module'] == owner and owner != 'liwan_platform')
    result = {'database': env.cr.dbname, 'root_company_id': root.id, 'status': profile.status, 'commercial_revision_id': profile.commercial_revision_id or None,
            'commercial_digest': profile.commercial_digest or None,
            'commercial_applied_at': str(profile.commercial_applied_at) if profile.commercial_applied_at else None,
            'commercial_valid_until': str(profile.commercial_valid_until) if getattr(profile, 'commercial_valid_until', None) else None,
            'commercial_valid_until_revision': int(getattr(profile, 'commercial_valid_until_revision', 0) or 0),
            'commercial_expiry_supported': (hasattr(profile, 'commercial_valid_until')
                                            and hasattr(profile, 'commercial_valid_until_revision')),
            'features': feats, 'modules': modules, 'branches': branches, 'usage': usage, 'limit_gates': gates}
    trial_keys = ('trial_ends_at', 'post_trial_features', 'post_trial_modules', 'post_trial_digest')
    result['post_trial_supported'] = all(key in profile._fields for key in trial_keys) and hasattr(profile, '_liwan_apply_post_trial')
    excess_keys = {'users.limit', 'storage.limit_mb', 'branches.extra_limit'}
    capabilities = service._liwan_excess_capabilities() if hasattr(service, '_liwan_excess_capabilities') else ()
    result['excess_supported'] = excess_keys <= set(capabilities) and hasattr(service, '_liwan_excess_is_settled')
    if hasattr(service, '_liwan_excess_counts'):
        result['excess'] = service._liwan_excess_counts()
    result['excess_settled'] = result['excess_supported'] and service._liwan_excess_is_settled()
    if hasattr(service, '_liwan_count_storage_bytes'):
        result['storage_bytes'] = int(service._liwan_count_storage_bytes())
    if hasattr(service, '_liwan_blocked_storage_bytes'):
        result['blocked_storage_bytes'] = int(service._liwan_blocked_storage_bytes())
    if result['post_trial_supported']:
        from odoo import fields
        result.update({key: getattr(profile, key) for key in trial_keys})
        result['trial_ends_at'] = profile.trial_ends_at.isoformat() + 'Z' if profile.trial_ends_at else None
        result['post_trial_digest'] = profile.post_trial_digest or None
        result['post_trial_features'] = profile.post_trial_features or {}
        result['post_trial_modules'] = profile.post_trial_modules or []
        if profile.trial_ends_at and fields.Datetime.now() >= profile.trial_ends_at:
            result['commercial_digest'] = profile.post_trial_digest
    return result

def read_profile():
    profile = env['liwan.tenant.profile'].search([], limit=2)
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
    from datetime import datetime, timezone
    from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
    if env.cr.dbname != values['database'] or not env.su:
        refuse('target_mismatch')
    profile = read_profile()._liwan_lock()
    current = profile.commercial_revision_id or None
    # AI delivery changes only ledger keys on the exact applied revision, including its authorized materialized policy.
    ai_digests = {values['digest']}
    if values.get('ai_expected_post_trial_digest'):
        ai_digests.add(values['ai_expected_post_trial_digest'])
    if values.get('ai_push') and (current != values['target_revision_id'] or (profile.commercial_digest or None) not in ai_digests):
        refuse('stale_target')
    recoverable = any(item['revision_id'] == current and item['digest'] == profile.commercial_digest
                      for item in values.get('recoverable_predecessors', ()))
    if current not in (None, values['previous_revision_id'], values['target_revision_id']) and not recoverable:
        refuse('stale_target')
    accepted_digests = {values['digest']}
    if values.get('ai_push'):
        accepted_digests.update(ai_digests)
    if values.get('trial_ends_at') and values.get('post_trial_digest'):
        cutoff = datetime.fromisoformat(values['trial_ends_at'].replace('Z', '+00:00'))
        if datetime.now(timezone.utc) >= cutoff:
            accepted_digests.add(values['post_trial_digest'])
    if current == values['target_revision_id'] and (profile.commercial_digest or None) not in accepted_digests:
        refuse('observed_mismatch')
    operator = profile.with_context(**{OPERATOR_CONTEXT: True})
    not_granted = None
    from contextlib import nullcontext
    batch = operator._liwan_defer_branch_reopening() if hasattr(operator, '_liwan_defer_branch_reopening') else nullcontext()
    with batch:
        expiry_vals = _commercial_expiry_vals(values, profile, refuse)
        trial_vals = _trial_policy_vals(values, profile, refuse)
        if current != values['target_revision_id']:
            roles_before = env['liwan.entitlement.service']._liwan_entitled_admin_roles()
            # Every application stays installed; keys the target omits close (booleans
            # false, limits 0). Odoo still refuses a target without its platform keys.
            features = env['liwan.entitlement.service']._liwan_close_unlisted_features(values['features'])
            write_vals = {'features': features, 'commercial_revision_id': values['target_revision_id'],
                          'commercial_digest': values['digest'],
                          'commercial_applied_at': fields.Datetime.now()}

        else:
            # The same revision is delivered again for an expiry change, a restore repair or a changed AI balance. The
            # revision and digest stay; only the derived AI keys (a ledger, not a revision) are rewritten when they differ.
            ai = dict((k, v) for k, v in values['features'].items() if k.startswith(('ai.balance.', 'ai.allowance.')))
            write_vals = {'features': dict(profile.features, **ai)} if any(profile.features.get(k) != v for k, v in ai.items()) else {}
            pending = getattr(profile, 'post_trial_features', None)
            if isinstance(pending, dict) and pending and any(pending.get(k) != v for k, v in ai.items()):
                write_vals['post_trial_features'] = dict(pending, **ai)
        write_vals.update(expiry_vals)
        write_vals.update(trial_vals)
        if write_vals:
            # Reusing the applied revision (a trial extension or a paid renewal) still moves the
            # independently versioned expiry; one write either way.
            operator.write(write_vals)
        if hasattr(operator, '_liwan_apply_post_trial'):
            operator._liwan_apply_post_trial()
        if current != values['target_revision_id']:
            # Roles the policy newly opened go to the enrolment administrator only.
            granted = operator._liwan_grant_opened_admin_roles(values['admin_login'], roles_before)
            opened = [k for k in env['liwan.entitlement.service']._liwan_entitled_admin_roles() if k not in set(roles_before or ())]
            if opened and not granted:
                admin = values['admin_login'] and env['res.users'].search(
                    [('login', '=', values['admin_login']), ('active', '=', True), ('share', '=', False)], limit=1)
                if not values['admin_login']:
                    not_granted = 'no_admin_login'
                elif not admin:
                    not_granted = 'admin_not_found'
                else:
                    not_granted = 'roles_missing'
        # Archive first so a swap never trips branches.extra_limit; data is kept.
        for uid in values['archive']:
            branch = env['liwan.tenant.branch'].search([('branch_uid', '=', uid)])
            if branch and branch.state == 'active':
                operator._liwan_archive_branch(values['operation_id'], uid)
        for uid in values['restore']:
            operator._liwan_restore_branch(values['operation_id'], uid)
        if values['apply']:
            operator._liwan_apply_branches(values['operation_id'], values['target_revision_id'], values['apply'])
        service = env['liwan.entitlement.service']
        if values.get('excess_settle'):
            if not hasattr(service, '_liwan_settle_excess'):
                refuse('tenant_upgrade_required')
            service._liwan_settle_excess()
    result = {'applied': True}
    if not_granted:
        result.update({'roles_not_granted': True, 'roles_not_granted_reason': not_granted})
    env.cr.commit()
    # odoo shell never signals cache invalidation; the running workers must drop cached groups and policy.
    env.registry.signal_changes()
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
              'features': ent['features'], 'apply': br['apply'], 'archive': br['archive'], 'restore': br.get('restore', []),
              'admin_login': request.get('admin_login')}
    if 'commercial_valid_until' in request:
        values['commercial_valid_until'] = request['commercial_valid_until']
    if 'commercial_valid_until_revision' in request:
        values['commercial_valid_until_revision'] = request['commercial_valid_until_revision']
    values.update({key: request[key] for key in (*TRIAL_POLICY_KEYS, 'excess_settle') if key in request})
    if 'recoverable_predecessors' in request:
        values['recoverable_predecessors'] = request['recoverable_predecessors']
    if request.get('ai_push') is True:
        values['ai_push'] = True
        if 'ai_expected_post_trial_digest' in request:
            values['ai_expected_post_trial_digest'] = request['ai_expected_post_trial_digest']
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
    keys = {'database', 'root_company_id', 'status', 'commercial_revision_id', 'commercial_digest', 'commercial_applied_at',
            'commercial_valid_until', 'commercial_valid_until_revision', 'commercial_expiry_supported', 'features', 'modules', 'branches', 'usage', 'limit_gates'}
    if not keys <= set(value) <= keys | OPTIONAL_OBSERVATION_KEYS:
        raise EffectError('observation_invalid')
    for flag in ('post_trial_supported', 'excess_supported', 'excess_settled'):
        if flag in value and type(value[flag]) is not bool:
            raise EffectError('observation_invalid')
    for key in ('storage_bytes', 'blocked_storage_bytes'):
        if key in value and (type(value[key]) is not int or not 0 <= value[key] <= 9007199254740991):
            raise EffectError('observation_invalid')
    trial_policy = {key: value[key] for key in TRIAL_POLICY_KEYS if key in value}
    if trial_policy:
        if trial_policy.get('post_trial_digest') is None:
            trial_policy.pop('post_trial_digest', None)
        try:
            validate_trial_end_keys(trial_policy)
        except EffectError:
            raise EffectError('observation_invalid') from None
    if 'excess' in value and (not isinstance(value['excess'], dict) or len(value['excess']) > 256
                              or not all(isinstance(k, str) and FEATURE_RE.fullmatch(k) and type(v) is int and 0 <= v <= 1000000000
                                         for k, v in value['excess'].items())):
        raise EffectError('observation_invalid')
    odoo_effect.validate_database(value['database'])
    if (type(value['root_company_id']) is not int or value['root_company_id'] < 1
            or value['status'] not in ('active', 'suspended')):
        raise EffectError('observation_invalid')
    validate_features(value['features'])
    for field in ('commercial_revision_id', 'commercial_digest', 'commercial_applied_at'):
        if value[field] is not None and not isinstance(value[field], str):
            raise EffectError('observation_invalid')
    if value['commercial_valid_until'] is not None and (not isinstance(value['commercial_valid_until'], str)
                                                       or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value['commercial_valid_until'])):
        raise EffectError('observation_invalid')
    if type(value['commercial_expiry_supported']) is not bool:
        raise EffectError('observation_invalid')
    if type(value['commercial_valid_until_revision']) is not int or value['commercial_valid_until_revision'] < 0:
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
                or not BRANCH_ITEM_KEYS <= set(item) <= BRANCH_ITEM_KEYS | {'read_only'}
                or ('read_only' in item and type(item['read_only']) is not bool)
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
    settle = request.get('excess_settle') is True
    if settle and observed.get('excess_supported') is not True:
        raise EffectError('tenant_upgrade_required')

    def closed(keys, values):
        return bool(keys) and all(values.get(gate) is False for gate in keys)

    for key, used in sorted(usage.items()):
        if key == BRANCH_LIMIT or (settle and key in EXCESS_LIMITS):
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
    if limit is not None and not isinstance(limit, bool) and not settle:
        active = {b['branch_id'] for b in observed['branches'] if b['state'] == 'active' and not b.get('read_only', False)}
        projected = (active - set(br['archive'])) | {b['branch_id'] for b in br['apply']} | set(br.get('restore', []))
        if len(projected) > limit:
            raise EffectError('downgrade_below_usage')


def _instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None


def _effective_entitlement(request, now=None):
    """A delayed trial apply cannot reopen the trial after its authoritative cutoff."""
    end = request.get('trial_ends_at')
    if end and _instant(now or utc_now()) >= _instant(end) and all(key in request for key in TRIAL_POLICY_KEYS[1:]):
        return {'features': request['post_trial_features'], 'modules': request['post_trial_modules'],
                'digest': request['post_trial_digest']}, True
    return request['entitlement'], False


def _complete_trial_policy(request, observed):
    """A date-only extension may reuse the exact applied revision's already-delivered fallback."""
    if not request.get('trial_ends_at'):
        return request
    policy = dict(request)
    for key in TRIAL_POLICY_KEYS[1:]:
        if key not in policy and observed['commercial_revision_id'] == request['target_revision_id']:
            policy[key] = observed.get(key)
    if (not isinstance(policy.get('post_trial_features'), dict)
            or not isinstance(policy.get('post_trial_modules'), list)
            or not isinstance(policy.get('post_trial_digest'), str)):
        raise EffectError('input_invalid')
    validate_trial_end_keys(policy)
    return policy


def verify(request, observed, now=None):
    """True when the observation proves the target; raises nothing."""
    ent, expired = _effective_entitlement(request, now)
    br = request['branches']
    if request.get('ai_push') is True:
        digests = {ent['digest']}
        if 'ai_expected_post_trial_digest' in request:
            digests.add(request['ai_expected_post_trial_digest'])
        if observed['commercial_revision_id'] != request['target_revision_id'] or observed['commercial_digest'] not in digests:
            return False
        ai = {key: value for key, value in ent['features'].items() if key.startswith(('ai.balance.', 'ai.allowance.'))}
        targets = [observed['features']]
        if observed.get('post_trial_features'):
            targets.append(observed['post_trial_features'])
        return all(all(key in target and type(target[key]) is type(value) and target[key] == value
                       for key, value in ai.items()) for target in targets)
    if not set(ent['modules']) <= set(observed['modules']):
        return False
    if expired and observed.get('trial_ends_at') is not None:
        return False  # effective reads alone do not prove that seat/storage flags were settled
    if expired or request.get('excess_settle') is True:
        if observed.get('excess_supported') is not True or observed.get('excess_settled') is not True or 'excess' not in observed:
            return False
        for key in ('users.limit', BRANCH_LIMIT):
            limit = ent['features'].get(key)
            if key == 'users.limit' and type(limit) is int and limit == 0:
                limit = 1  # the authoritative settlement proof protects exactly the last full HQ administrator
            if type(limit) is int and observed['usage'].get(key, limit + 1) > limit:
                return False
        if any('read_only' not in branch for branch in observed['branches'] if branch['state'] == 'active'):
            return False
        limit = ent['features'].get(BRANCH_LIMIT)
        if type(limit) is int and sum(branch['state'] == 'active' and not branch.get('read_only')
                                      for branch in observed['branches']) > limit:
            return False
    if observed['commercial_revision_id'] != request['target_revision_id'] or observed['commercial_digest'] != ent['digest']:
        return False
    if 'commercial_valid_until' in request and observed.get('commercial_valid_until') != request['commercial_valid_until']:
        return False
    if 'commercial_valid_until_revision' in request and observed.get('commercial_valid_until_revision') != request['commercial_valid_until_revision']:
        return False
    for key in TRIAL_POLICY_KEYS:
        if key not in request:
            continue
        if key == 'trial_ends_at':
            actual = observed.get(key)
            if expired and actual is None:
                continue  # materialized atomically by Odoo
            if _instant(actual) != _instant(request[key]):
                return False
        elif not expired and observed.get(key) != request[key]:
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
    for uid in br.get('restore', []):
        b = by_id.get(uid)
        if not b or b['state'] != 'active' or not b['active'] or not b['parent_is_root']:
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
        with odoo_effect.effect_operation(request, 'observe'):
            return self._observe_operation(request)

    def _observe_operation(self, request):
        database = validate_tenant(request['tenant'])['database']
        observed = self._observe(database)
        return {**observed, 'observed_at': self.clock()}

    def receipt(self, request, observed, installed, not_granted=None):
        by_id = {b['branch_id']: b for b in observed['branches']}
        extra = {'roles_not_granted': True, 'roles_not_granted_reason': not_granted} if not_granted else {}
        extra.update({key: observed[key] for key in ('post_trial_supported', 'excess_supported', 'excess', 'storage_bytes', 'blocked_storage_bytes') if key in observed})
        if observed.get('excess_supported') is True:
            extra['branch_read_only'] = [{'branch_id': branch['branch_id'], 'read_only': branch['read_only']}
                                       for branch in observed['branches'] if 'read_only' in branch]
        return {**extra, 'commercial_expiry_supported': observed.get('commercial_expiry_supported', False),
                'order_id': request['order_id'], 'database': observed['database'],
                'tenant_id': observed['database'], 'root_company_id': observed['root_company_id'],
                'target_revision_id': request['target_revision_id'],
                'observed_entitlement_digest': observed['commercial_digest'],
                'observed_at': self.clock(),
                'branch_bindings': [{'branch_id': b['branch_id'], 'odoo_company_id': by_id[b['branch_id']]['odoo_company_id']}
                                    for b in request['branches']['apply']]
                                   + [{'branch_id': uid, 'odoo_company_id': by_id[uid]['odoo_company_id']}
                                      for uid in request['branches'].get('restore', [])],
                'modules_installed': installed}

    def reconfigure(self, request):
        with odoo_effect.effect_operation(request, 'reconfigure'):
            return self._reconfigure_operation(request)

    def _reconfigure_operation(self, request):
        validate_reconfigure(request)
        database, target = request['tenant']['database'], request['target_revision_id']
        observed = self._observe(database)
        request = _complete_trial_policy(request, observed)
        if any(key in request for key in TRIAL_POLICY_KEYS) and observed.get('post_trial_supported') is not True:
            if request.get('trial_ends_at') is not None or any(key in request for key in TRIAL_POLICY_KEYS[1:]):
                raise EffectError('tenant_upgrade_required')
            request = {key: value for key, value in request.items() if key != 'trial_ends_at'}
        if request.get('excess_settle') is True and observed.get('excess_supported') is not True:
            raise EffectError('tenant_upgrade_required')
        if ('commercial_valid_until_revision' in request
                and request['commercial_valid_until_revision'] < observed['commercial_valid_until_revision']):
            raise EffectError('commercial_expiry_revision_stale')
        if not observed.get('commercial_expiry_supported'):
            if request.get('commercial_valid_until') is not None:
                raise EffectError('tenant_upgrade_required')
            # Clearing an expiry that cannot exist on an old tenant is a no-op, not a failed order.
            request = {key: value for key, value in request.items()
                       if key not in ('commercial_valid_until', 'commercial_valid_until_revision')}
        current = observed['commercial_revision_id']
        ai_digests = {request['entitlement']['digest']}
        if 'ai_expected_post_trial_digest' in request:
            ai_digests.add(request['ai_expected_post_trial_digest'])
        if request.get('ai_push') and (current != target or observed['commercial_digest'] not in ai_digests):
            raise EffectError('stale_target')
        recoverable = any(item['revision_id'] == current and item['digest'] == observed['commercial_digest']
                          for item in request.get('recoverable_predecessors', ()))
        if current not in (None, request['previous_revision_id'], target) and not recoverable:
            raise EffectError('stale_target')
        effective, expired = _effective_entitlement(request, self.clock())
        accepted_digests = {request['entitlement']['digest'], effective['digest']}
        if request.get('ai_push') is True:
            accepted_digests.update(ai_digests)
        if current == target and observed['commercial_digest'] not in accepted_digests:
            raise EffectError('observed_mismatch')
        journal = Journal(self.journal_dir, database, request['operation_id'], target)
        if verify(request, observed, now=self.clock()):
            journal.begin()
            journal.done()
            return self.receipt(request, observed, [])
        if current != target or expired:
            checked = {**request, 'entitlement': effective}
            if expired:
                checked['excess_settle'] = True
            check_downgrade(checked, observed)
        journal.begin()
        missing = [] if request.get('ai_push') is True else [m for m in effective['modules'] if m not in observed['modules']]
        if missing:
            self.runner.install_modules(missing)
        applied = parse_output(self.runner.run_script(build_apply_script(request), 'apply', mutate=True))
        not_granted = applied.get('roles_not_granted_reason') if applied.get('roles_not_granted') is True else None
        after = self._observe(database)
        if not verify(request, after, now=self.clock()):
            raise EffectError('observed_mismatch')
        journal.done()
        return self.receipt(request, after, missing, not_granted if not_granted in ('no_admin_login', 'admin_not_found', 'roles_missing') else None)


# -------------------------------------------------------- default runner
class ComposeRunner(odoo_effect.Runner):
    """Reuses odoo_effect's compose command/shell mechanism for existing tenants."""

    def __init__(self, request, permit=None):
        config = request['config']
        if (set(config) - {'releaseBackupConfig'} != {'schemaVersion', 'projectName', 'composeFile', 'envFile', 'stateDir', 'domainSuffix'}
                or config['schemaVersion'] != 1
                or not re.fullmatch(r'liwan-(?:saas|shared)-[a-z0-9-]{3,48}', config['projectName'])):
            raise EffectError('runtime_invalid')
        for key in ('composeFile', 'envFile', 'stateDir'):
            odoo_effect.no_symlink(config[key])
        if config.get('releaseBackupConfig'):
            odoo_effect.no_symlink(config['releaseBackupConfig'])
        self.request, self.config = request, config
        self.database = odoo_effect.validate_database(request['tenant']['database'])
        self.restore = 'restore' in request
        self.root = odoo_effect.Path(config['stateDir'])
        self.base = ['docker', 'compose', '--project-name', config['projectName'], '--env-file',
                     config['envFile'], '--file', config['composeFile']]
        self.current_container = None
        self.child = None
        self.permit = permit or odoo_effect.permit
        if self.restore:
            self._bind_restore(request['restore'])

    def _bind_restore(self, binding):
        # The existing release verifier only attests the source helper. Until it
        # can attest the restore topology, refuse before any Compose invocation.
        if odoo_effect.release_routes_enabled():
            raise EffectError('release_operation_blocked')
        if not isinstance(binding, dict) or set(binding) != {'requestId', 'approvalId', 'backupId', 'digest', 'manifestSha256'}:
            raise EffectError('restore_target_unverified')
        for key in ('requestId', 'approvalId', 'backupId'):
            _uuid(binding[key], 'restore_target_unverified')
        for key in ('digest', 'manifestSha256'):
            if not isinstance(binding[key], str) or not DIGEST_RE.fullmatch(binding[key]):
                raise EffectError('restore_target_unverified')
        completion = self.root / 'restore-effects' / (binding['requestId'] + '.complete')
        self.classification = self.root / 'classifications' / (self.database + '.json')
        for file in (completion, self.classification):
            odoo_effect.no_symlink(file)
            if not file.is_file() or file.stat().st_size > MAX_OUTPUT:
                raise EffectError('restore_target_unverified')
        proof = json.loads(completion.read_text())
        expected = {key: binding[key] for key in ('approvalId', 'backupId', 'digest', 'manifestSha256')}
        expected['targetDatabase'] = self.database
        if any(proof.get(key) != value for key, value in expected.items()):
            raise EffectError('restore_target_unverified')
        self.base += ['--profile', 'restore']

    def database_exists(self):
        if not self.restore:
            return self.exists()
        sql = "SELECT count(*) FROM pg_database WHERE datname='" + self.database + "'"
        result = self.command(self.base + ['exec', '-T', 'restore-db', 'psql', '-U', 'odoo',
                                          '-d', 'postgres', '-At', '-c', sql]).strip()
        if result not in ('0', '1'):
            raise EffectError('database_observation_invalid')
        return result == '1'

    def _odoo_args(self, subcommand):
        args = self.base + ['run', '--rm', '--no-deps', '-T', '--name', self.current_container]
        if self.restore:
            args += ['-v', str(self.classification) + ':/run/liwan/classification.json:ro',
                     '-e', 'LIWAN_COMMERCIAL_CONFIG=/run/liwan/classification.json',
                     '--entrypoint', '/usr/local/bin/liwan-odoo', 'restore-odoo', subcommand,
                     '--db_host=restore-db', '--max-cron-threads=0']
        else:
            args += ['-e', 'LIWAN_COMMERCIAL_CONFIG=/run/liwan-runtime/classifications/' + self.database + '.json',
                     '--entrypoint', '/usr/local/bin/liwan-odoo', 'odoo', subcommand]
        return args + ['-d', self.database, '--no-http']

    def run_script(self, script, stage, mutate=False):
        if mutate:
            self.permit(stage)
        attempt = self.request.get('attemptId')
        if not isinstance(attempt, str) or not re.fullmatch(r'[a-f0-9-]{36}', attempt):
            raise EffectError('attempt_invalid')
        suffix = stage if mutate else stage + '-' + odoo_effect.secrets.token_hex(4)
        self.current_container = self.config['projectName'] + '-effect-' + attempt[:8] + '-' + suffix
        try:
            return self.command(self._odoo_args('shell'), stdin=script, timeout=180)
        finally:
            self.current_container = None

    def install_modules(self, names):
        odoo_effect.validate_modules(names)
        self.permit('modules')
        attempt = self.request['attemptId']
        self.current_container = self.config['projectName'] + '-effect-' + attempt[:8] + '-modules'
        try:
            self.command(self._odoo_args('server') + ['-i', ','.join(names), '--stop-after-init'], timeout=1500)
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
