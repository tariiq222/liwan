# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hermetic credential-stage tests; never import Odoo or contact a database."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

if importlib.util.find_spec('webvue_cli.managed_credentials'):
    from webvue_cli import managed_credentials as credentials
else:
    credentials = None

DB = 'webvue_scratch_credentials'
SECRET = 'synthetic_credential_secret_0123456789'


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Cursor:
    def __init__(self):
        self.dbname = DB
        self.stored = digest('admin')
        self.pending = None
        self.commits = 0
        self.rollbacks = 0
        self.queries = []
        self.fail_commit = False

    def execute(self, sql, params=None):
        self.queries.append((sql, params))

    def fetchone(self):
        return (self.pending or self.stored,)

    def commit(self):
        if self.fail_commit:
            raise RuntimeError(SECRET)
        self.stored = self.pending or self.stored
        self.pending = None
        self.commits += 1

    def rollback(self):
        self.pending = None
        self.rollbacks += 1


class Profile:
    singleton_key = 'tenant'
    commercial_mode = 'saas'
    entitlement_source = 'control_plane'
    policy_revision = 1
    features = {'users.limit': None}
    status = 'active'
    valid_until = False
    root_company_id = SimpleNamespace(id=3)

    def __len__(self):
        return 1

    def _webvue_lock(self):
        return self


class Admin:
    id = 2
    login = 'admin'
    active = True
    company_id = SimpleNamespace(id=3)

    def __init__(self, cursor):
        self.cursor = cursor
        self.writes = []
        self.bad_hash = False
        self.accept_default = False

    def __len__(self):
        return 1

    def exists(self):
        return self

    def _webvue_access_write(self, values, capability):
        self.writes.append((values, capability))
        self.cursor.pending = digest('wrong' if self.bad_hash else values['password'])

    def flush_recordset(self, fields):
        assert fields == ['password']

    def _crypt_context(self):
        # Test double only: production uses Odoo's real passlib CryptContext.
        return SimpleNamespace(verify=lambda value, hashed: (
            self.accept_default or digest(value) == hashed))


class Environment:
    uid = 1
    su = True

    def __init__(self):
        self.cr = Cursor()
        self.profile = Profile()
        self.admin = Admin(self.cr)
        self.refs = []

    def __getitem__(self, name):
        assert name == 'webvue.tenant.profile'
        return SimpleNamespace(search=lambda domain, limit: self.profile)

    def ref(self, name, raise_if_not_found=False):
        self.refs.append(name)
        assert name == 'base.user_admin'
        return self.admin

    def invalidate_all(self, flush=False):
        assert flush is False


class CredentialsCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(credentials, 'managed_credentials missing: intended RED')
        self.env = Environment()

    def run_script(self, *, snapshot=False, secret=SECRET):
        build = (credentials.build_credentials_snapshot_script if snapshot
                 else credentials.build_credentials_script)
        script = build(DB)
        self.assertNotIn(SECRET, script)
        output = io.StringIO()
        with patch.dict(os.environ, {}, clear=True):
            if secret is not None:
                os.environ['WEBVUE_ADMIN_PASSWORD'] = secret
            with contextlib.redirect_stdout(output):
                exec(compile(script, '<credentials-test>', 'exec'), {'env': self.env})
            self.assertNotIn('WEBVUE_ADMIN_PASSWORD', os.environ)
        self.assertNotIn(SECRET, output.getvalue())
        return output.getvalue()

    def assert_refused(self, **kwargs):
        output = self.run_script(**kwargs)
        self.assertEqual(output.strip(), 'WEBVUE_MANAGED_CREDENTIALS:{"error_code": "credentials_unverified"}')
        with self.assertRaises(credentials.CredentialsError):
            credentials.parse_credentials(output, DB)
        self.assertEqual(self.env.cr.commits, 0)
        self.assertGreater(self.env.cr.rollbacks, 0)

    def test_apply_and_separate_readonly_snapshot(self):
        result = credentials.parse_credentials(self.run_script(), DB)
        self.assertEqual(result, {'database': DB, 'changed': True, 'verified': True})
        self.assertEqual(self.env.cr.commits, 1)
        self.assertEqual(self.env.cr.stored, digest(SECRET))
        self.assertEqual(self.env.admin.writes, [({'password': SECRET}, 'access.users.reset_password')])
        self.assertEqual(self.env.refs, ['base.user_admin'])
        snapshot = self.run_script(snapshot=True)
        result = credentials.parse_credentials(snapshot, DB, expected_changed=False)
        self.assertIs(result['changed'], False)
        self.assertEqual(self.env.cr.commits, 1)
        self.assertEqual(len(self.env.admin.writes), 1)
        self.assertIn(('SET TRANSACTION READ ONLY', None), self.env.cr.queries)
        self.assertTrue(any(params == [2] for _, params in self.env.cr.queries))

    def test_root_required(self):
        for uid, su in [(2, True), (1, False), (True, True)]:
            with self.subTest(uid=uid, su=su):
                self.env = Environment()
                self.env.uid, self.env.su = uid, su
                self.assert_refused()
                self.assertFalse(self.env.admin.writes)

    def test_database_and_fresh_profile_guards(self):
        for field, value in [('commercial_mode', 'non_saas'), ('entitlement_source', 'local_policy'),
                             ('policy_revision', 0), ('policy_revision', 2), ('policy_revision', True),
                             ('features', {}), ('features', []), ('status', 'suspended'),
                             ('valid_until', '2030-01-01'), ('singleton_key', 'other')]:
            with self.subTest(field=field):
                self.env = Environment()
                setattr(self.env.profile, field, value)
                self.assert_refused()
                self.assertFalse(self.env.admin.writes)
        self.env = Environment()
        self.env.cr.dbname = 'odoo19'
        self.assert_refused()

    def test_only_exact_active_human_admin(self):
        for field, value in [('id', 1), ('active', False), ('login', 'someone'),
                             ('company_id', SimpleNamespace(id=9))]:
            with self.subTest(field=field):
                self.env = Environment()
                setattr(self.env.admin, field, value)
                self.assert_refused()
                self.assertFalse(self.env.admin.writes)

    def test_secret_sanity(self):
        for secret in [None, '', 'admin', 'a' * 23, 'a' * 257, ' ' + SECRET,
                       SECRET + '\n', 'x' * 24, 'change-me-change-me-change-me']:
            with self.subTest(secret_length=len(secret or '')):
                self.env = Environment()
                self.assert_refused(secret=secret)
                self.assertFalse(self.env.admin.writes)

    def test_hash_and_default_password_verification_fail_closed(self):
        for field in ['bad_hash', 'accept_default']:
            self.env = Environment()
            setattr(self.env.admin, field, True)
            self.assert_refused()
            self.assertEqual(self.env.cr.stored, digest('admin'))

    def test_snapshot_mismatch_never_writes(self):
        self.assert_refused(snapshot=True)
        self.assertFalse(self.env.admin.writes)

    def test_exception_and_commit_failure_are_generic(self):
        self.env.cr.fail_commit = True
        self.assert_refused()
        self.env = Environment()
        with patch.object(self.env.admin, '_webvue_access_write', side_effect=RuntimeError(SECRET)):
            self.assert_refused()

    def test_missing_profile_admin_or_hash_are_refused(self):
        self.env.profile = []
        self.assert_refused()
        self.env = Environment()
        self.env.admin = None
        self.assert_refused()
        for row in [None, (), ('',), (None,), ('one', 'two')]:
            self.env = Environment()
            with patch.object(self.env.cr, 'fetchone', return_value=row):
                self.assert_refused()
        self.env = Environment()
        with patch.object(self.env.admin, '_crypt_context', side_effect=ValueError(SECRET)):
            self.assert_refused()

    def test_parser_strict_bounds_types_and_json(self):
        valid = 'WEBVUE_MANAGED_CREDENTIALS:' + json.dumps({'database': DB, 'changed': True, 'verified': True})
        for output in ['WEBVUE_MANAGED_CREDENTIALS:[]', 'WEBVUE_MANAGED_CREDENTIALS:{',
                       '\ud800' + valid, 'ع' * 33000 + '\n' + valid,
                       'WEBVUE_MANAGED_CREDENTIALS:' + '[' * 1100]:
            with self.assertRaises(credentials.CredentialsError):
                credentials.parse_credentials(output, DB)
        with self.assertRaises(credentials.CredentialsError):
            credentials.parse_credentials(valid, DB, expected_changed=1)

    def test_invalid_database_input(self):
        for database in ['odoo19', 'webvue_scratch_prod', 'webvue_scratch_postgres',
                         'webvue_scratch_a\n', "webvue_scratch_a';print(1)", None, True]:
            with self.subTest(database=database), self.assertRaises(credentials.CredentialsError):
                credentials.build_credentials_script(database)

    def test_parser_rejects_non_authoritative_output(self):
        valid = 'WEBVUE_MANAGED_CREDENTIALS:' + json.dumps({'database': DB, 'changed': True, 'verified': True})
        bad = ['', valid + '\n' + valid, 'x' + valid, valid.replace(DB, 'odoo19'),
               valid.replace('true', '1'), valid.replace('true', 'false'),
               valid.replace('}', ', "secret": "hidden"}'),
               valid.replace('}', ', "verified": true}'),
               valid.replace('true', 'NaN'), 'x' * 65537, None]
        for output in bad:
            with self.subTest(output_type=type(output).__name__), self.assertRaises(credentials.CredentialsError):
                credentials.parse_credentials(output, DB)
        with self.assertRaises(credentials.CredentialsError):
            credentials.parse_credentials(valid, DB, expected_changed=False)
        self.assertEqual(credentials.parse_credentials('ordinary log\n' + valid, DB)['database'], DB)


if __name__ == '__main__':
    unittest.main()
