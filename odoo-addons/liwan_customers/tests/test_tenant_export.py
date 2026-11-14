# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.tests.tenant_export_support import (
    assert_contribution,
    column,
    rows_of,
)

KEYS = ('customers', 'customer_bank_accounts', 'customer_tags', 'customer_settings')


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersTenantExport(TransactionCase):

    def test_customers_of_every_company_are_exported_and_a_plain_contact_is_not(self):
        branch = self.env['res.company'].create({'name': 'Export branch'})
        party = self.env['res.partner'].create({'name': 'Export party', 'liwan_party': True, 'company_id': branch.id})
        plain = self.env['res.partner'].create({'name': 'Export plain contact'})
        bank = self.env['res.partner.bank'].create({'partner_id': party.id, 'acc_number': 'SA0380000000608010167519'})
        datasets = assert_contribution(self, KEYS, {'customers': ('id', 'name', 'phone', 'email', 'company_id')})
        customers = datasets['customers']
        rows = rows_of(customers)
        self.assertIn(party.id, column(customers, rows, 'id'))
        self.assertNotIn(plain.id, column(customers, rows, 'id'))
        banks = datasets['customer_bank_accounts']
        self.assertIn(bank.id, column(banks, rows_of(banks), 'id'))

    def test_attachments_of_a_customer_are_files_of_the_dataset(self):
        party = self.env['res.partner'].create({'name': 'Export file party', 'liwan_party': True})
        attachment = self.env['ir.attachment'].create({
            'name': 'contract.txt', 'raw': b'x', 'res_model': 'res.partner', 'res_id': party.id,
        })
        dataset = assert_contribution(self, KEYS)['customers']
        pairs = [pair for batch in dataset['attachments']() for pair in batch]
        self.assertIn((party.id, attachment), pairs)

    def test_the_privacy_log_and_tokens_are_named_as_not_exported(self):
        technical = self.env['liwan.tenant.export.hooks']._liwan_export_technical_models()
        self.assertEqual(technical['liwan.customers.privacy.token'], 'credentials')
        self.assertEqual(technical['liwan.customers.privacy.request'], 'log')
