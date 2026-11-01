# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .oca_common import ASSETS, LiwanFinanceOcaCase
from .write_common import INVOICES


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceInvoiceAssets(LiwanFinanceOcaCase):
    """A vendor-bill line with an asset profile becomes a draft asset when the bill is posted."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.asset_profile(cls.company)
        cls.other_profile = cls.asset_profile(cls.other_company)
        cls.asset_account = cls.account('106002')
        cls.no_assets = cls.user_with('bill_no_assets', ['finance.invoices.read', 'finance.invoices.manage', 'finance.invoices.post'])
        cls.assets_reader = cls.user_with('bill_assets_read', ['finance.invoices.read', 'finance.assets.read'])

    def capital_bill(self, **line):
        return self.bill_body(lines=[{
            'name': 'Meeting table', 'quantity': 1, 'price_unit': 12000, 'account_id': self.asset_account.id,
            'asset_profile_id': self.profile.id, **line,
        }])

    def test_posting_the_bill_creates_the_asset_and_the_line_shows_it(self):
        draft = self.create_invoice(self.capital_bill())
        self.assertEqual(draft['lines'][0]['asset_profile'], {'id': self.profile.id, 'name': self.profile.name})
        self.assertIsNone(draft['lines'][0]['asset'])
        posted = self.post_invoice(draft['id'])
        asset_ref = posted['lines'][0]['asset']
        self.assertIsNotNone(asset_ref)
        asset = self.api('GET', f'{ASSETS}/{asset_ref["id"]}').json()
        self.assertEqual((asset['profile']['id'], asset['purchase_value'], asset['state']), (self.profile.id, 12000, 'draft'))

    def test_a_sale_invoice_line_cannot_carry_a_profile(self):
        result = self.api('POST', INVOICES, json=self.invoice_body(lines=[{
            'name': 'x', 'price_unit': 10, 'asset_profile_id': self.profile.id,
        }]))
        self.assertRefused(result, 422, 'invalid')
        self.assertEqual(result.json()['field'], 'lines[0].asset_profile_id')

    def test_another_company_profile_is_refused(self):
        result = self.api('POST', INVOICES, json=self.capital_bill(asset_profile_id=self.other_profile.id))
        self.assertEqual(result.status_code, 422, result.text)

    def test_choosing_a_profile_needs_the_fixed_assets_capability(self):
        self.authenticate('bill_no_assets', 'finance_write_pass_123')
        self.assertRefused(self.api('POST', INVOICES, json=self.capital_bill()), 403, 'forbidden')

    def test_posting_a_capitalised_bill_needs_the_fixed_assets_capability(self):
        draft = self.create_invoice(self.capital_bill())
        self.authenticate('bill_no_assets', 'finance_write_pass_123')
        self.assertRefused(self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={}), 403, 'forbidden')

    def test_a_reader_without_fixed_assets_does_not_see_the_asset(self):
        posted = self.post_invoice(self.create_invoice(self.capital_bill())['id'])
        self.authenticate('bill_no_assets', 'finance_write_pass_123')
        line = self.api('GET', f'{INVOICES}/{posted["id"]}').json()['lines'][0]
        self.assertEqual((line['asset_profile'], line['asset']), (None, None))
        self.authenticate('bill_assets_read', 'finance_write_pass_123')
        line = self.api('GET', f'{INVOICES}/{posted["id"]}').json()['lines'][0]
        self.assertIsNotNone(line['asset'])
