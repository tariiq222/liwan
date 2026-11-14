# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.tests.tenant_export_support import (
    assert_contribution,
    column,
    rows_of,
)

KEYS = (
    'crm_leads', 'crm_stages', 'crm_phonecalls', 'crm_call_outcomes',
    'crm_settings', 'crm_sources',
)


@tagged('post_install', '-at_install', 'liwan')
class TestCrmTenantExport(TransactionCase):

    def test_leads_of_every_company_are_exported(self):
        branch = self.env['res.company'].create({'name': 'Export CRM branch'})
        lead = self.env['crm.lead'].create({'name': 'Export lead', 'company_id': branch.id})
        datasets = assert_contribution(self, KEYS, {'crm_leads': ('id', 'name', 'stage_id', 'partner_id', 'company_id')})
        leads = datasets['crm_leads']
        self.assertIn(lead.id, column(leads, rows_of(leads), 'id'))
        self.assertTrue(leads['attachments'])

    def test_view_logs_are_named_as_not_exported(self):
        technical = self.env['liwan.tenant.export.hooks']._liwan_export_technical_models()
        self.assertEqual(technical['liwan.crm.view.log'], 'log')
