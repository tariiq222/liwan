# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta, timezone

from odoo.tests import HttpCase, new_test_user, tagged

from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestReadOnlyTenantBell(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('liwan_platform.tenant_profile')
        cls.record._liwan_initialize_legacy_policy(
            cls.env['liwan.feature.registry']._liwan_installed_module_ids(),
        )
        new_test_user(
            cls.env, login='bell_emp', password='bell_emp_pass_123',
            groups='liwan_core.group_employee',
        )

    def _post(self, path):
        return self.url_open(path, method='POST', json={}, headers={'Content-Type': 'application/json'})

    def test_expired_tenant_still_lets_the_recipient_clear_the_bell(self):
        if self.record.commercial_mode == 'non_saas':
            self.skipTest('a non-SaaS tenant has no expiry')
        self.record.with_context(**{OPERATOR_CONTEXT: True}).write({
            'valid_until': datetime.now(timezone.utc).date() - timedelta(days=1),
        })
        self.authenticate('bell_emp', 'bell_emp_pass_123')
        read_all = self._post('/api/v1/notifications/read-all')
        self.assertEqual(read_all.status_code, 200, read_all.text)
        self.assertEqual(read_all.json(), {'updated': 0})
        one = self._post('/api/v1/notifications/999999/read')
        self.assertNotEqual(one.json().get('code'), 'tenant_read_only', one.text)
