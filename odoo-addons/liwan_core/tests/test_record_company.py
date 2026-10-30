# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('at_install', 'liwan', 'liwan_access')
class TestRecordCompany(TransactionCase):
    """Core resolves a record's company only from company_id and fails closed otherwise."""

    def test_record_with_company_id_returns_that_company(self):
        company = self.env.company
        partner = self.env['res.partner'].create({'name': 'Scoped', 'company_id': company.id})
        self.assertIn('company_id', partner._fields)
        self.assertEqual(self.env['liwan.access.service']._liwan_record_company(partner), company)

    def test_record_without_company_id_is_rejected(self):
        category = self.env['res.partner.category'].create({'name': 'Unscoped'})
        self.assertNotIn('company_id', category._fields)
        with self.assertRaisesRegex(ValidationError, 'record_company_unknown'):
            self.env['liwan.access.service']._liwan_record_company(category)
