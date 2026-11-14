# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A tenant suspended for non-payment keeps CRM reads and the export, and refuses every CRM write."""
from odoo.tests import tagged

from .common import LiwanCrmCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

URL = '/api/v1/crm/opportunities'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmPaymentSuspension(LiwanCrmCase):

    def _suspend(self, reason):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'status': 'suspended', 'suspension_reason': reason})

    def test_non_payment_keeps_reads_and_export_but_refuses_writes(self):
        lead = self.make_lead(self.agent)
        self._suspend('non_payment')
        manager = self.as_manager()
        self.assertEqual(manager.api('GET', URL).status_code, 200)
        self.assertEqual(manager.api('GET', f'{URL}/{lead.id}').status_code, 200)
        self.assertEqual(manager.api('GET', '/api/v1/crm/export').status_code, 200)
        refused = manager.api('POST', f'{URL}/{lead.id}/won', json={})
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertEqual(refused.json()['code'], 'tenant_read_only')
        created = manager.api('POST', URL, json={})
        self.assertEqual(created.status_code, 403, created.text)
        self.assertEqual(created.json()['code'], 'tenant_read_only')

    def test_non_payment_refuses_a_crm_write_below_the_api(self):
        lead = self.make_lead(self.agent)
        self._suspend('non_payment')
        with self.assertRaises(LiwanAccessRule) as caught:
            lead.with_user(self.manager).write({'name': 'renamed'})
        self.assertEqual(caught.exception.code, 'tenant_read_only')

    def test_the_writes_return_after_the_status_is_active_again(self):
        lead = self.make_lead(self.agent)
        self._suspend('non_payment')
        self.env.ref('liwan_platform.tenant_profile').with_context(**{OPERATOR_CONTEXT: True}).write({'status': 'active'})
        lead.with_user(self.manager).write({'name': 'renamed'})
        self.assertEqual(lead.name, 'renamed')
