# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from passlib.totp import TOTP as PasslibTOTP

from odoo.exceptions import AccessDenied
from odoo.tests import get_db_name, tagged

from .common import LiwanApiCase
from odoo.addons.auth_totp.models.totp import TOTP as auth_TOTP
from odoo.addons.liwan_platform.models.entitlement_service import (
    OPERATOR_CONTEXT,
    LiwanTenantSuspended,
)


@tagged('post_install', '-at_install', 'liwan')
class TestTotp(LiwanApiCase):
    """Mirrors auth_totp's own TestTOTPMixin: enable TOTP on a test user with
    ``_totp_try_setting`` (passlib.totp.TOTP generates the secret/code), then
    stub ``TOTP.match`` for the verification call itself.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        totp = PasslibTOTP(new=True)
        secret = totp.base32_key
        code = int(totp.generate().token)
        enabled = cls.employee.with_user(cls.employee)._totp_try_setting(secret, code)
        assert enabled, "TOTP setup must succeed for the test fixture to be valid"

    def _authenticate(self, login='api_emp', password='api_emp_pass_123'):
        return self.url_open(
            '/web/session/authenticate',
            json={
                'jsonrpc': '2.0', 'method': 'call', 'id': 0,
                'params': {'db': get_db_name(), 'login': login, 'password': password},
            },
            headers={'Content-Type': 'application/json'},
        )

    def test_totp_flow(self):
        auth_res = self._authenticate()
        self.assertIsNone(auth_res.json()['result']['uid'], "MFA pending: uid must not be granted yet")

        with patch.object(auth_TOTP, 'match', return_value=999999999):
            res = self.api('POST', '/api/v1/auth/totp', {'code': '123456'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['login'], 'api_emp')

        me = self.api('GET', '/api/v1/me')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()['login'], 'api_emp')

    def test_totp_no_pending_login(self):
        res = self.api('POST', '/api/v1/auth/totp', {'code': '123456'})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'no_pending_login')

    def test_totp_invalid_code(self):
        self._authenticate()
        with patch.object(auth_TOTP, 'match', return_value=None):
            res = self.api('POST', '/api/v1/auth/totp', {'code': '000000'})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'invalid_code')

    def test_totp_invalid_code_format(self):
        self._authenticate()
        res = self.api('POST', '/api/v1/auth/totp', {'code': 'abc'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid_code_format')

    def test_totp_names_only_a_tenant_suspension(self):
        service = type(self.env['liwan.entitlement.service'])
        for refusal, code in ((LiwanTenantSuspended(), 'tenant_suspended'), (AccessDenied(), 'login_refused')):
            with self.subTest(code=code):
                self._authenticate()
                with patch.object(service, '_liwan_assert_login_allowed', side_effect=refusal):
                    res = self.api('POST', '/api/v1/auth/totp', {'code': '123456'})
                self.assertEqual(res.status_code, 403)
                self.assertEqual(res.json()['code'], code)

    def test_totp_of_a_support_account_without_support_access_is_login_refused(self):
        # ACC-67: the public environment of the route could not read the account's flags and answered
        # with Odoo's raw access error instead of login_refused.
        self.env.cr.execute(
            'INSERT INTO res_groups_users_rel (gid, uid) VALUES (%s, %s)',
            [self.env.ref('liwan_core.group_vendor_support').id, self.employee.id],
        )
        self._authenticate()
        self.env['liwan.entitlement.service']._liwan_profile().with_context(**{OPERATOR_CONTEXT: True}).write(
            {'support_access_enabled': False},
        )
        res = self.api('POST', '/api/v1/auth/totp', {'code': '123456'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'login_refused')
