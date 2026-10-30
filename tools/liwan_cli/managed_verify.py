# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Initial-create policy scripts; no process execution or credential handling.

Callers validate the published catalog first, install selected modules with the
trusted classification mounted, then execute the apply script and a *separate*
read-only snapshot shell. Only that separate readback is verification evidence.
These scripts are not an existing-customer subscription-update route.
"""
from __future__ import annotations

import json
import re

from .module_closure import REPO_ADDONS, ClosureError, install_closure

SENTINEL = 'LIWAN_MANAGED_POLICY:'
OUTPUT_LIMIT = 65536
POLICY_LIMIT = 16384
DATABASE_RE = re.compile(r'liwan_scratch_[a-z0-9_]{1,42}')
MODULE_RE = re.compile(r'[a-z][a-z0-9_]{0,127}')
FEATURE_RE = re.compile(r'[a-z][a-z0-9_.-]{0,63}')
BASE_MODULES = frozenset({'liwan_core', 'liwan_platform', 'liwan_api'})
SNAPSHOT_KEYS = frozenset({
    'database', 'commercial_mode', 'entitlement_source', 'status',
    'valid_until', 'features', 'policy_revision', 'modules',
})
ERROR_CODES = frozenset({
    'target_mismatch', 'profile_invalid', 'classification_conflict',
    'policy_already_initialized', 'modules_mismatch', 'features_mismatch',
    'snapshot_invalid', 'policy_script_failed',
})


class VerificationError(Exception):
    """Safe diagnostic: neither messages nor codes contain subprocess output."""

    def __init__(self, code: str):
        self.code = code if code in ERROR_CODES | {'policy_invalid', 'database_invalid'} else 'snapshot_invalid'
        super().__init__(self.code)


def _fail(code):
    raise VerificationError(code) from None


def _database(database):
    if type(database) is not str or not DATABASE_RE.fullmatch(database):
        _fail('database_invalid')


def _features(value):
    return (
        type(value) is dict and len(value) <= 256
        and all(type(key) is str and FEATURE_RE.fullmatch(key)
                and (type(item) is bool or item is None
                     or (type(item) is int and 0 <= item <= 1000000000))
                for key, item in value.items())
    )


def _features_match(actual, expected):
    # Only a migrated legacy null may extend a policy that omitted this key.
    observed = dict(actual)
    if 'branches.extra_limit' not in expected and observed.get('branches.extra_limit') is None:
        observed.pop('branches.extra_limit', None)
    return (set(observed) == set(expected)
            and all(type(value) is type(expected[key]) and value == expected[key]
                    for key, value in observed.items()))


def _modules(value):
    return (type(value) is list and len(value) <= 1024
            and all(type(item) is str and MODULE_RE.fullmatch(item) for item in value)
            and len(set(value)) == len(value))


def _policy(policy):
    if (type(policy) is not dict
            or set(policy) != {'schema_version', 'channel', 'modules', 'features'}
            or type(policy['schema_version']) is not int or policy['schema_version'] != 1
            or policy['channel'] != 'control_plane'
            or not _features(policy['features']) or not _modules(policy['modules'])
            or not BASE_MODULES.issubset(policy['modules'])
            or any(not name.startswith('liwan_') for name in policy['modules'])):
        _fail('policy_invalid')
    if len(json.dumps(policy, ensure_ascii=True).encode('utf-8')) > POLICY_LIMIT:
        _fail('policy_invalid')


def _expected_modules(policy):
    """Installation closure of the selected modules (implied dependencies included)."""
    try:
        return sorted(install_closure([REPO_ADDONS], policy['modules']))
    except ClosureError:
        _fail('policy_invalid')


def expected_modules(policy):
    """The installation closure readback compares with; managed receipts carry it so
    the control plane checks the same set (worker verifiedManagedCreate)."""
    return _expected_modules(policy)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail('snapshot_invalid')
        result[key] = value
    return result


def _constant(_value):
    _fail('snapshot_invalid')


def parse_snapshot(stdout: str, policy: dict, database: str) -> dict:
    """Validate one bounded, whitelisted readback; logs never become evidence.

    Revision zero is structurally valid; the initial-apply script separately
    requires revision zero before writing and exactly one after the write.
    The caller must not pass an apply response off as separate readback proof.
    """
    _database(database)
    _policy(policy)
    try:
        if (type(stdout) is not str or len(stdout) > OUTPUT_LIMIT
                or len(stdout.encode('utf-8')) > OUTPUT_LIMIT
                or stdout.count(SENTINEL) != 1):
            _fail('snapshot_invalid')
        lines = [line for line in stdout.splitlines() if line.startswith(SENTINEL)]
        if len(lines) != 1:
            _fail('snapshot_invalid')
        data = json.loads(lines[0][len(SENTINEL):], object_pairs_hook=_object,
                          parse_constant=_constant)
    except (ValueError, UnicodeError, RecursionError):
        _fail('snapshot_invalid')
    if type(data) is not dict:
        _fail('snapshot_invalid')
    if set(data) == {'error_code'}:
        code = data['error_code']
        raise VerificationError(code if type(code) is str and code in ERROR_CODES else 'snapshot_invalid')
    if set(data) != SNAPSHOT_KEYS:
        _fail('snapshot_invalid')
    if data['database'] != database:
        _fail('target_mismatch')
    if data['commercial_mode'] != 'saas' or data['entitlement_source'] != 'control_plane':
        _fail('classification_conflict')
    if (data['status'] != 'active' or data['valid_until'] is not None
            or type(data['policy_revision']) is not int or data['policy_revision'] < 0):
        _fail('profile_invalid')
    features = data['features']
    if not _features(features) or not _features_match(features, policy['features']):
        _fail('features_mismatch')
    modules = data['modules']
    if (not _modules(modules)
            or {name for name in modules if name.startswith('liwan_')} != set(_expected_modules(policy))):
        _fail('modules_mismatch')
    return data


# Self-contained Python for Odoo shell stdin. No import of this host-side package
# is required inside the image. Never serialize an ORM read() or exception text.
_SCRIPT_COMMON = '''\
import json
import re

class ManagedPolicyRefusal(Exception):
    pass

def refuse(code):
    raise ManagedPolicyRefusal(code)

def _features_match(actual, expected):
    # Only a migrated legacy null may extend a policy that omitted this key.
    observed = dict(actual)
    if 'branches.extra_limit' not in expected and observed.get('branches.extra_limit') is None:
        observed.pop('branches.extra_limit', None)
    return (set(observed) == set(expected)
            and all(type(value) is type(expected[key]) and value == expected[key]
                    for key, value in observed.items()))

def read_profile():
    profile = env['liwan.tenant.profile'].search([], limit=2)
    if len(profile) != 1 or profile.singleton_key != 'tenant':
        refuse('profile_invalid')
    return profile

def check_profile(profile):
    classification = load_classification(env.cr.dbname, profile.valid_until)
    if (classification['commercial_mode'] != 'saas'
            or classification['entitlement_source'] != 'control_plane'
            or profile.commercial_mode != classification['commercial_mode']
            or profile.entitlement_source != classification['entitlement_source']):
        refuse('classification_conflict')
    if (profile.status != 'active' or profile.valid_until
            or type(profile.policy_revision) is not int or profile.policy_revision < 0):
        refuse('profile_invalid')

def installed_modules():
    names = env['ir.module.module'].search([('state', '=', 'installed')], limit=1025).mapped('name')
    if (len(names) > 1024
            or any(type(name) is not str or not re.fullmatch(r'[a-z][a-z0-9_]{0,127}', name) for name in names)
            or len(set(names)) != len(names)):
        refuse('modules_mismatch')
    return sorted(names)

def check_modules(names, policy):
    if {name for name in names if name.startswith('liwan_')} != set(expected_modules):
        refuse('modules_mismatch')

def read_snapshot(profile, names):
    features = profile.features
    if (type(features) is not dict or len(features) > 256
            or any(type(key) is not str or not re.fullmatch(r'[a-z][a-z0-9_.-]{0,63}', key)
                   or not (type(value) is bool or value is None
                           or (type(value) is int and 0 <= value <= 1000000000))
                   for key, value in features.items())):
        refuse('features_mismatch')
    return {
        'database': env.cr.dbname,
        'commercial_mode': profile.commercial_mode,
        'entitlement_source': profile.entitlement_source,
        'status': profile.status,
        'valid_until': None if not profile.valid_until else str(profile.valid_until),
        'features': features,
        'policy_revision': profile.policy_revision,
        'modules': names,
    }

result = {'error_code': 'policy_script_failed'}
try:
    if env.cr.dbname != expected_database:
        refuse('target_mismatch')
    from odoo.addons.liwan_platform.commercial_config import load_classification
'''

_APPLY = '''\
    from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
    profile = read_profile()._liwan_lock()
    check_profile(profile)
    profile._liwan_require_policy_source('control_plane')
    if (type(profile.policy_revision) is not int or profile.policy_revision != 0
            or not (profile.features is False or type(profile.features) is dict and profile.features == {})):
        refuse('policy_already_initialized')
    names = installed_modules()
    check_modules(names, policy)
    profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': policy['features']})
    check_profile(profile)
    result = read_snapshot(profile, installed_modules())
    check_modules(result['modules'], policy)
    if (not _features_match(result['features'], policy['features'])
            or result['policy_revision'] != 1):
        refuse('features_mismatch')
    encoded = json.dumps(result, sort_keys=True, allow_nan=False)
    if len(encoded.encode('utf-8')) > 60000:
        refuse('snapshot_invalid')
    env.cr.commit()
'''

_SNAPSHOT = '''\
    env.cr.rollback()
    env.cr.execute('SET TRANSACTION READ ONLY')
    env.invalidate_all(flush=False)
    profile = read_profile()
    check_profile(profile)
    result = read_snapshot(profile, installed_modules())
    encoded = json.dumps(result, sort_keys=True, allow_nan=False)
    if len(encoded.encode('utf-8')) > 60000:
        refuse('snapshot_invalid')
'''

_ERRORS = '''\
except ManagedPolicyRefusal as exc:
    result = {'error_code': str(exc)}
    env.cr.rollback()
except Exception:
    result = {'error_code': 'policy_script_failed'}
    env.cr.rollback()
'''


def build_policy_script(policy: dict, database: str) -> str:
    """Build initial-only authorized policy application; commit once on success."""
    _database(database)
    _policy(policy)
    prefix = 'import json\nexpected_database = json.loads(' + repr(json.dumps(database)) + ')\n'
    prefix += 'policy = json.loads(' + repr(json.dumps(policy, ensure_ascii=True)) + ')\n'
    prefix += 'expected_modules = json.loads(' + repr(json.dumps(_expected_modules(policy))) + ')\n'
    return (prefix + _SCRIPT_COMMON + _APPLY + _ERRORS
            + "print('LIWAN_MANAGED_POLICY:' + json.dumps(result, sort_keys=True, allow_nan=False))\n")


def build_snapshot_script(database: str) -> str:
    """Build a separate read-only shell snapshot; rollback, never write/commit."""
    _database(database)
    prefix = 'import json\nexpected_database = json.loads(' + repr(json.dumps(database)) + ')\n'
    return (prefix + _SCRIPT_COMMON + _SNAPSHOT + _ERRORS
            + 'finally:\n    env.cr.rollback()\n'
            + "print('LIWAN_MANAGED_POLICY:' + json.dumps(result, sort_keys=True, allow_nan=False))\n")
