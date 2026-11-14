# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID
from odoo.exceptions import ValidationError
from odoo.tests import HttpCase, get_db_name, new_test_user, tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_platform.models.read_only_guard import (
    INBOUND_EVENT_CONTEXT,
    INBOUND_EVENT_TOKEN,
    assert_writable,
)

PASSWORD = 'unpaid_emp_pass_123'


@tagged('post_install', '-at_install', 'liwan')
class TestPaymentSuspension(HttpCase):
    """A tenant suspended for non-payment signs in and reads, and nobody writes; a vendor suspension is the full lockout."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('liwan_platform.tenant_profile')
        cls.record._liwan_initialize_legacy_policy(cls.env['liwan.feature.registry']._liwan_installed_module_ids())
        cls.employee = new_test_user(cls.env, login='unpaid_emp', password=PASSWORD, groups='liwan_core.group_employee')
        cls.service = cls.env['liwan.entitlement.service']

    def _operator(self):
        return self.record.with_context(**{OPERATOR_CONTEXT: True})

    def _suspend(self, reason):
        self._operator().write({'status': 'suspended', 'suspension_reason': reason})

    def _authenticate_rpc(self):
        return self.url_open(
            '/web/session/authenticate',
            json={'jsonrpc': '2.0', 'method': 'call', 'id': 0, 'params': {'db': get_db_name(), 'login': 'unpaid_emp', 'password': PASSWORD}},
            headers={'Content-Type': 'application/json'},
        )

    def test_the_reason_is_stored_revisioned_and_cleared_on_resume(self):
        before = self.record.policy_revision
        self._suspend('non_payment')
        self.assertEqual((self.record.status, self.record.suspension_reason), ('suspended', 'non_payment'))
        self.assertGreater(self.record.policy_revision, before)
        self.assertEqual(self.service._liwan_effective_state(), 'payment_suspended')
        self._operator().write({'status': 'active'})
        self.assertEqual((self.record.status, self.record.suspension_reason), ('active', False))
        self.assertEqual(self.service._liwan_effective_state(), 'active')

    def test_a_suspension_without_a_reason_is_the_vendor_lockout(self):
        self._operator().write({'status': 'suspended'})
        self.assertEqual(self.service._liwan_effective_state(), 'suspended')

    def test_the_reason_is_validated(self):
        with self.assertRaises(ValidationError):
            self._operator().write({'status': 'suspended', 'suspension_reason': 'other'})
        with self.assertRaises(ValidationError):
            self._operator().write({'status': 'active', 'suspension_reason': 'vendor'})

    def test_non_payment_signs_in_reads_and_exposes_the_state(self):
        self._suspend('non_payment')
        self.assertNotIn('error', self._authenticate_rpc().json())
        self.authenticate('unpaid_emp', PASSWORD)
        me = self.url_open('/api/v1/me')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()['platform']['state'], 'payment_suspended')
        self.assertTrue(me.json()['platform']['read_only'])
        self.assertEqual(self.url_open('/api/v1/me').status_code, 200)

    def test_non_payment_refuses_an_api_write_without_ending_the_session(self):
        self.authenticate('unpaid_emp', PASSWORD)
        self._suspend('non_payment')
        write = self.url_open('/api/v1/me/appearance', method='PATCH', json={'mode': 'dark'}, headers={'Content-Type': 'application/json'})
        self.assertEqual(write.status_code, 403)
        self.assertEqual(write.json()['code'], 'tenant_read_only')
        self.assertEqual(self.url_open('/api/v1/me').status_code, 200)

    def test_non_payment_fences_the_orm_for_every_user_but_the_superuser(self):
        self._suspend('non_payment')
        partner = self.employee.partner_id
        for user in (self.employee, self.env.ref('base.user_admin')):
            with self.subTest(user=user.login), self.assertRaises(LiwanAccessRule) as caught:
                self.env['res.partner'].with_user(user).create({'name': 'unpaid'})
            self.assertEqual((caught.exception.code, caught.exception.status), ('tenant_read_only', 403))
            with self.assertRaises(LiwanAccessRule):
                partner.with_user(user).write({'comment': 'x'})
        # Reads stay open, the superuser (crons, the operator) is never fenced, and the user's own plumbing still works.
        self.assertTrue(partner.with_user(self.employee).name)
        self.assertTrue(self.env['res.partner'].with_user(SUPERUSER_ID).create({'name': 'cron'}).exists())
        self.employee.with_user(self.employee).write({'lang': 'en_US'})

    def test_non_payment_refuses_what_goes_outward(self):
        self._suspend('non_payment')
        with self.assertRaises(LiwanAccessRule) as caught:
            self.service.require_within_limit('users.limit', 1)
        self.assertEqual(caught.exception.code, 'tenant_read_only')
        with self.assertRaises(LiwanAccessRule):
            self.service.require('ai.enabled')
        self.assertEqual(self.service._liwan_writable_features(), ())

    def test_resume_lets_writes_back_in(self):
        self._suspend('non_payment')
        with self.assertRaises(LiwanAccessRule):
            self.env['res.partner'].with_user(self.employee).create({'name': 'unpaid'})
        self._operator().write({'status': 'active'})
        # The fence lets the write through; the user's ACLs are a separate layer.
        assert_writable(self.env['res.partner'].with_user(self.employee), 'create', vals_list=[{'name': 'paid'}])

    def test_an_inbound_event_is_recorded_as_it_is_for_an_expired_tenant(self):
        self._suspend('non_payment')
        values = [{'name': 'inbound'}]
        with self.assertRaises(LiwanAccessRule):
            assert_writable(self.env['res.partner'].with_user(self.employee), 'create', vals_list=values)
        inbound = self.env['res.partner'].with_user(self.employee).with_context(**{INBOUND_EVENT_CONTEXT: INBOUND_EVENT_TOKEN})
        assert_writable(inbound, 'create', vals_list=values)
        # Only the token lifts it: any other value of the context key is still fenced.
        forged = self.env['res.partner'].with_user(self.employee).with_context(**{INBOUND_EVENT_CONTEXT: True})
        with self.assertRaises(LiwanAccessRule):
            assert_writable(forged, 'create', vals_list=values)

    def test_only_an_active_tenant_may_act_outward(self):
        self.assertTrue(self.service._liwan_may_act_outward())
        self._suspend('non_payment')
        self.assertFalse(self.service._liwan_may_act_outward())
        self._suspend('vendor')
        self.assertFalse(self.service._liwan_may_act_outward())

    def test_vendor_suspension_stays_the_full_lockout(self):
        self._suspend('vendor')
        login = self._authenticate_rpc()
        self.assertTrue(login.json()['error']['data']['name'].endswith('.LiwanTenantSuspended'), login.text)
        self.assertEqual(self.service._liwan_effective_state(), 'suspended')
