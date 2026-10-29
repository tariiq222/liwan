# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pure policy regression: real service methods, not an Odoo/ACL integration test.

No Odoo runtime, database, checkout service or vendor endpoint is started.
The minimal import shims deliberately do not emulate ORM authorization.
"""
import importlib.util
import os
import socket
import types
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class PolicyError(Exception):
    def __init__(self, code, message, **kwargs):
        super().__init__(message)
        self.code = code
        self.status = kwargs.get('status')


def load_service():
    odoo = types.ModuleType('odoo')
    odoo.SUPERUSER_ID = 1
    odoo.api = types.SimpleNamespace(model=lambda method: method)
    odoo.models = types.SimpleNamespace(AbstractModel=object)
    exceptions = types.ModuleType('odoo.exceptions')
    for name in ('AccessDenied', 'AccessError', 'UserError', 'ValidationError'):
        setattr(exceptions, name, type(name, (Exception,), {}))
    http = types.ModuleType('odoo.http')
    http.request = None
    access = types.ModuleType('odoo.addons.webvue_core.models.access_service')
    access.WebVueAccessRule = PolicyError
    spec = importlib.util.spec_from_file_location(
        '_non_saas_entitlement_under_test',
        ROOT / 'odoo-addons/webvue_platform/models/entitlement_service.py',
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict('sys.modules', {
        'odoo': odoo, 'odoo.exceptions': exceptions, 'odoo.http': http,
        'odoo.addons.webvue_core.models.access_service': access,
    }):
        spec.loader.exec_module(module)
    return module


service_module = load_service()


class TestNonSaasPolicy(unittest.TestCase):
    def setUp(self):
        # DB invariants enforce this pair and forbid a non-SaaS cutoff.
        self.profile = types.SimpleNamespace(
            commercial_mode='non_saas', entitlement_source='local_policy',
            status='active', valid_until=False, support_access_enabled=False,
            features={'pmo.enabled': True, 'hr.enabled': False, 'users.limit': 2},
            retained_read_features=['hr.enabled'],
        )
        self.service = service_module.WebVueEntitlementService()
        self.service._webvue_profile = lambda: self.profile
        self.service._webvue_installed_modules = lambda: ('webvue_pmo', 'webvue_hr')
        definitions = {
            'pmo.enabled': {'type': 'boolean', 'module': 'webvue_pmo'},
            'hr.enabled': {'type': 'boolean', 'module': 'webvue_hr'},
            'users.limit': {'type': 'limit', 'module': 'webvue_platform'},
        }
        self.service._webvue_registry = lambda: types.SimpleNamespace(
            _webvue_feature_map=lambda: definitions,
        )
        self.service._webvue_is_support_user = lambda user=None: False
        self.service._webvue_support_login_allowed = lambda user=None: False
        self.service.env = types.SimpleNamespace(
            su=False, context={}, user=types.SimpleNamespace(_is_public=lambda: False),
            _=lambda text: text,
        )
        # Runtime policy must not reload classification or call any vendor service.
        for target in ('builtins.open', 'socket.socket', 'socket.create_connection',
                       'socket.getaddrinfo'):
            blocker = patch(target, side_effect=AssertionError('external dependency: ' + target))
            blocker.start()
            self.addCleanup(blocker.stop)
        env = patch.dict(os.environ, {}, clear=True)
        env.start()
        self.addCleanup(env.stop)

    def assert_policy_error(self, code, call):
        with self.assertRaises(PolicyError) as caught:
            call()
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(caught.exception.status, 403)

    def test_local_policy_remains_writable_without_checkout_or_heartbeat(self):
        for today in (date(2020, 1, 1), date(2099, 12, 31)):
            with self.subTest(today=today):
                self.service._webvue_utc_today = lambda: today
                self.assertEqual(self.service._webvue_effective_state(), 'active')
                self.assertTrue(self.service.require('pmo.enabled'))
                self.assertTrue(self.service.require_within_limit('users.limit', 2))
                self.assertTrue(self.service._webvue_assert_login_allowed(self.service.env.user))
                self.assertFalse(self.service._webvue_session_forbidden())

    def test_offline_tripwire_is_active(self):
        with self.assertRaises(AssertionError):
            socket.create_connection(('vendor.invalid', 443))

    def test_local_policy_does_not_enable_disabled_or_unknown_features(self):
        for key in ('hr.enabled', 'unknown.enabled'):
            with self.subTest(key=key):
                self.assert_policy_error('feature_not_included', lambda: self.service.require(key))
        self.assertTrue(self.service.require_read('hr.enabled'))

    def test_local_policy_requires_installed_feature_owner(self):
        self.service._webvue_installed_modules = lambda: ()
        self.assert_policy_error('feature_not_included', lambda: self.service.require('pmo.enabled'))
        self.assert_policy_error('feature_not_included', lambda: self.service.require_read('pmo.enabled'))

    def test_local_policy_preserves_quota(self):
        self.assert_policy_error(
            'feature_not_included', lambda: self.service.require_within_limit('users.limit', 3),
        )

    def test_local_administrative_suspension_is_not_bypassed(self):
        self.profile.status = 'suspended'
        self.assert_policy_error('tenant_suspended', lambda: self.service.require('pmo.enabled'))
        self.assert_policy_error('tenant_suspended', lambda: self.service.require_read('pmo.enabled'))
        with self.assertRaises(service_module.AccessDenied):
            self.service._webvue_assert_login_allowed(self.service.env.user)
        self.assertTrue(self.service._webvue_session_forbidden())

    def test_saas_cutoff_still_expires_and_today_is_inclusive(self):
        self.profile.commercial_mode = 'saas'
        self.profile.entitlement_source = 'control_plane'
        self.profile.valid_until = date(2026, 1, 1)
        self.service._webvue_utc_today = lambda: date(2026, 1, 1)
        self.assertTrue(self.service.require('pmo.enabled'))
        self.service._webvue_utc_today = lambda: date(2026, 1, 2)
        self.assertEqual(self.service._webvue_effective_state(), 'expired')
        self.assertTrue(self.service.require_read('pmo.enabled'))
        self.assert_policy_error('tenant_read_only', lambda: self.service.require('pmo.enabled'))
        self.assert_policy_error(
            'tenant_read_only', lambda: self.service.require_within_limit('users.limit', 1),
        )
        self.profile.status = 'suspended'
        self.assertEqual(self.service._webvue_effective_state(), 'suspended')

    def test_operator_context_alone_never_grants_authority(self):
        for su, context, allowed in (
            (False, {}, False),
            (False, {service_module.OPERATOR_CONTEXT: True}, False),
            (True, {}, False),
            (True, {service_module.OPERATOR_CONTEXT: True}, True),
        ):
            with self.subTest(su=su, context=context):
                self.service.env.su = su
                self.service.env.context = context
                if allowed:
                    self.assertTrue(self.service._webvue_assert_operator())
                else:
                    with self.assertRaises(service_module.AccessError):
                        self.service._webvue_assert_operator()


if __name__ == '__main__':
    unittest.main()
