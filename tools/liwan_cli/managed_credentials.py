# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bounded fresh-create credential scripts; no execution or host secret reads.

The caller must authorize a NEW isolated create and run both scripts before
exposing services. Revision one alone does not authorize an existing-customer
password reset. Inject LIWAN_ADMIN_PASSWORD into one-shot containers only.
"""
from __future__ import annotations

import json
import re

SENTINEL = 'LIWAN_MANAGED_CREDENTIALS:'
OUTPUT_LIMIT = 65536
_DATABASE = re.compile(r'liwan_scratch_[a-z0-9_]{1,42}')
_FORBIDDEN = frozenset({'odoo19', 'production', 'prod', 'postgres', 'template0', 'template1'})


class CredentialsError(ValueError):
    """One public, secret-free failure regardless of private underlying cause."""

    code = 'credentials_unverified'

    def __init__(self):
        super().__init__(self.code)


def _database(database):
    if (type(database) is not str or not _DATABASE.fullmatch(database)
            or _FORBIDDEN.intersection(database.split('_'))):
        raise CredentialsError()


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise CredentialsError()
        result[key] = value
    return result


def _constant(_value):
    raise CredentialsError()


def parse_credentials(stdout: str, database: str, *, expected_changed: bool = True) -> dict:
    """Accept exactly one bounded, DB-bound, typed credential success sentinel."""
    _database(database)
    try:
        if (type(expected_changed) is not bool or type(stdout) is not str
                or len(stdout) > OUTPUT_LIMIT or len(stdout.encode('utf-8')) > OUTPUT_LIMIT
                or stdout.count(SENTINEL) != 1):
            raise CredentialsError()
        lines = [line for line in stdout.splitlines() if line.startswith(SENTINEL)]
        if len(lines) != 1:
            raise CredentialsError()
        value = json.loads(lines[0][len(SENTINEL):], object_pairs_hook=_unique,
                           parse_constant=_constant)
        if (type(value) is not dict or set(value) != {'database', 'changed', 'verified'}
                or value['database'] != database or value['changed'] is not expected_changed
                or value['verified'] is not True):
            raise CredentialsError()
        return value
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise CredentialsError() from None


_COMMON = '''\
import json
import os
import re

result = {'error_code': 'credentials_unverified'}
secret = os.environ.pop('LIWAN_ADMIN_PASSWORD', '')
try:
    if (env.cr.dbname != expected_database or type(env.uid) is not int
            or env.uid != 1 or env.su is not True):
        raise ValueError()
    if (not re.fullmatch(r'[A-Za-z0-9_-]{24,256}', secret)
            or len(set(secret)) < 8
            or any(token in secret.lower() for token in ('change-me', 'changeme', 'placeholder'))):
        raise ValueError()
'''

_CHECKS = '''\
    profile = env['liwan.tenant.profile'].search([], limit=2)
    if len(profile) != 1:
        raise ValueError()
    if not snapshot:
        profile = profile._liwan_lock()
    if (profile.singleton_key != 'tenant' or profile.commercial_mode != 'saas'
            or profile.entitlement_source != 'control_plane'
            or type(profile.policy_revision) is not int or profile.policy_revision != 1
            or type(profile.features) is not dict or not profile.features
            or profile.status != 'active' or profile.valid_until):
        raise ValueError()
    admin = env.ref('base.user_admin', raise_if_not_found=False)
    if (not admin or len(admin) != 1 or not admin.exists()
            or type(admin.id) is not int or admin.id == 1 or not admin.active
            or admin.login != 'admin' or admin.company_id.id != profile.root_company_id.id):
        raise ValueError()
'''

_APPLY = '''\
    admin._liwan_access_write({'password': secret}, 'access.users.reset_password')
    admin.flush_recordset(['password'])
'''

_VERIFY = '''\
    env.cr.execute('SELECT password FROM res_users WHERE id = %s', [admin.id])
    row = env.cr.fetchone()
    if not row or len(row) != 1 or not isinstance(row[0], str) or not row[0]:
        raise ValueError()
    crypt = admin._crypt_context()
    if not crypt.verify(secret, row[0]) or crypt.verify('admin', row[0]):
        raise ValueError()
    result = {'database': expected_database, 'changed': not snapshot, 'verified': True}
'''

_END = '''\
except Exception:
    result = {'error_code': 'credentials_unverified'}
    env.cr.rollback()
finally:
    secret = None
print('LIWAN_MANAGED_CREDENTIALS:' + json.dumps(result, sort_keys=True, allow_nan=False))
'''


def _build(database, *, snapshot):
    _database(database)
    prefix = 'expected_database = ' + repr(database) + '\nsnapshot = ' + repr(snapshot) + '\n'
    transaction = ("    env.cr.rollback()\n    env.cr.execute('SET TRANSACTION READ ONLY')\n"
                   "    env.invalidate_all(flush=False)\n") if snapshot else ''
    finish = '    env.cr.rollback()\n' if snapshot else '    env.cr.commit()\n'
    return prefix + _COMMON + transaction + _CHECKS + ('' if snapshot else _APPLY) + _VERIFY + finish + _END


def build_credentials_script(database: str) -> str:
    """Set and hash-verify the human admin password; one commit on success."""
    return _build(database, snapshot=False)


def build_credentials_snapshot_script(database: str) -> str:
    """Verify actual admin hash in a separate read-only transaction; never write."""
    return _build(database, snapshot=True)
