# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta, timezone

from odoo.exceptions import ValidationError
from odoo.tests import HttpCase, get_db_name, new_test_user, tagged

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestTenantLifecycle(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('webvue_platform.tenant_profile')
        cls.record._webvue_initialize_legacy_policy(
            cls.env['webvue.feature.registry']._webvue_installed_module_ids(),
        )
        cls.employee = new_test_user(
            cls.env, login='lifecycle_emp', password='lifecycle_emp_pass_123',
            groups='webvue_core.group_employee',
        )

    def _operator(self):
        return self.record.with_context(**{OPERATOR_CONTEXT: True})

    def _authenticate(self, login, password):
        return self.url_open(
            '/web/session/authenticate',
            json={
                'jsonrpc': '2.0', 'method': 'call', 'id': 0,
                'params': {'db': get_db_name(), 'login': login, 'password': password},
            },
            headers={'Content-Type': 'application/json'},
        )

    def test_suspended_customer_cannot_login_or_keep_session(self):
        self.authenticate('lifecycle_emp', 'lifecycle_emp_pass_123')
        self.assertEqual(self.url_open('/api/v1/me').status_code, 200)
        self._operator().write({'status': 'suspended'})
        blocked = self.url_open('/api/v1/me')
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()['code'], 'tenant_suspended')
        login = self._authenticate('lifecycle_emp', 'lifecycle_emp_pass_123')
        self.assertTrue(login.json()['error']['data']['name'].endswith('.WebVueTenantSuspended'), login.text)
        wrong = self._authenticate('lifecycle_emp', 'not-the-password')
        self.assertFalse(wrong.json()['error']['data']['name'].endswith('.WebVueTenantSuspended'), wrong.text)

    def test_expired_tenant_allows_login_and_password_but_not_appearance(self):
        expiry = {'valid_until': datetime.now(timezone.utc).date() - timedelta(days=1)}
        independent = self.record.commercial_mode == 'non_saas'
        if independent:
            with self.assertRaises(ValidationError):
                self._operator().write(expiry)
        else:
            self._operator().write(expiry)
        self.authenticate('lifecycle_emp', 'lifecycle_emp_pass_123')
        me = self.url_open('/api/v1/me')
        self.assertEqual(me.status_code, 200)
        appearance = self.url_open(
            '/api/v1/me/appearance', method='PATCH',
            json={'mode': 'dark'},
            headers={'Content-Type': 'application/json'},
        )
        self.assertEqual(appearance.status_code, 200 if independent else 403)
        if not independent:
            self.assertEqual(appearance.json()['code'], 'tenant_read_only')
        password = self.url_open(
            '/api/v1/me/password', method='POST',
            json={'current': 'lifecycle_emp_pass_123', 'new': 'lifecycle_emp_pass_456'},
            headers={'Content-Type': 'application/json'},
        )
        self.assertEqual(password.status_code, 200)

    def test_support_can_login_while_suspended_until_disabled(self):
        self._operator().write({'status': 'suspended'})
        self.authenticate('admin', 'admin')
        me = self.url_open('/api/v1/me')
        self.assertEqual(me.status_code, 200, me.text)
        self._operator().write({'support_access_enabled': False})
        denied = self._authenticate('admin', 'admin')
        body = denied.json()
        self.assertTrue(body.get('error') or body.get('result', {}).get('uid') in (False, None), denied.text)
        # A refused support user gets the plain refusal, never the tenant-suspended name.
        self.assertFalse(body['error']['data']['name'].endswith('.WebVueTenantSuspended'), denied.text)
