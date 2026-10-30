# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .oca_common import ASSETS, LiwanFinanceOcaCase
from .write_common import PASSWORD


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceAssetDisposal(LiwanFinanceOcaCase):
    """A 12000 asset bought on 2024-01-01 and depreciated 2400 a year: 4800 depreciated at 2025-12-31, 7200 residual.

    Removing it on 2026-01-01 first posts one more day of depreciation (OCA early removal): 6.56.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.asset_profile(cls.company)
        Account = cls.env['account.account'].with_company(cls.company)
        cls.gain = Account.create({'code': '420900', 'name': 'Gain on asset sale', 'account_type': 'income_other', 'company_ids': [(6, 0, cls.company.ids)]})
        cls.loss = Account.create({'code': '580900', 'name': 'Loss on asset sale', 'account_type': 'expense_other', 'company_ids': [(6, 0, cls.company.ids)]})
        cls.proceeds = cls.account('101001')

    def running_asset(self):
        asset = self.api('POST', ASSETS, json={'profile_id': self.profile.id, 'name': 'Meeting table', 'purchase_value': 12000, 'date_start': '2024-01-01'}).json()
        self.api('POST', f'{ASSETS}/{asset["id"]}/validate', json={})
        self.api('POST', f'{ASSETS}/compute-depreciation', json={'date': '2025-12-31'})
        return self.api('GET', f'{ASSETS}/{asset["id"]}').json()

    def removal_entry(self, asset):
        line = self.env['account.asset'].browse(asset['id']).depreciation_line_ids.filtered(lambda item: item.type == 'remove')
        return line.move_id

    def balances(self, move):
        return {line.account_id.with_company(self.company).code: round(line.balance, 2) for line in move.line_ids}

    def test_a_sale_above_book_value_books_a_gain(self):
        asset = self.running_asset()
        self.assertEqual(asset['value_residual'], 7200)
        sold = self.api('POST', f'{ASSETS}/{asset["id"]}/dispose', json={
            'date_remove': '2026-01-01', 'sale_value': 8000, 'sale_account_id': self.proceeds.id, 'plus_account_id': self.gain.id,
            'min_account_id': self.loss.id, 'note': 'Sold to staff',
        })
        self.assertEqual(sold.status_code, 200, sold.text)
        self.assertEqual((sold.json()['state'], sold.json()['date_remove']), ('removed', '2026-01-01'))
        move = self.removal_entry(asset)
        self.assertEqual(move.state, 'posted')
        balances = self.balances(move)
        self.assertEqual(balances['106002'], -12000)
        self.assertEqual(balances['106007'], 4806.56)
        self.assertEqual(balances['101001'], 8000)
        self.assertEqual(balances['420900'], -806.56)
        self.assertAlmostEqual(sum(balances.values()), 0, places=2)

    def test_scrapping_an_asset_books_the_residual_as_a_loss(self):
        asset = self.running_asset()
        scrapped = self.api('POST', f'{ASSETS}/{asset["id"]}/dispose', json={'date_remove': '2026-01-01', 'min_account_id': self.loss.id})
        self.assertEqual(scrapped.status_code, 200, scrapped.text)
        balances = self.balances(self.removal_entry(asset))
        self.assertEqual((balances['106002'], balances['106007'], balances['580900']), (-12000, 4806.56, 7193.44))

    def test_the_profile_accounts_are_the_default(self):
        self.profile.write({'account_plus_value_id': self.gain.id, 'account_min_value_id': self.loss.id})
        asset = self.running_asset()
        sold = self.api('POST', f'{ASSETS}/{asset["id"]}/dispose', json={'date_remove': '2026-01-01', 'sale_value': 5000, 'sale_account_id': self.proceeds.id})
        self.assertEqual(sold.status_code, 200, sold.text)
        self.assertEqual(self.balances(self.removal_entry(asset))['580900'], 2193.44)

    def test_refusals(self):
        asset = self.running_asset()
        route = f'{ASSETS}/{asset["id"]}/dispose'
        for body, field in (
            ({}, 'date_remove'),
            ({'date_remove': '2026-01-01'}, 'min_account_id'),
            ({'date_remove': '2026-01-01', 'sale_value': 10, 'min_account_id': self.loss.id}, 'sale_account_id'),
            ({'date_remove': '2026-01-01', 'sale_value': -1, 'min_account_id': self.loss.id}, 'sale_value'),
            ({'date_remove': '2026-01-01', 'min_account_id': 999999}, 'min_account_id'),
            ({'date_remove': '2026-01-01', 'min_account_id': self.loss.id, 'colour': 1}, 'colour'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', route, json=body), 422, 'invalid', field)
        # the removal cannot be dated before the last posted depreciation
        self.assertEqual(self.api('POST', route, json={'date_remove': '2025-06-30', 'min_account_id': self.loss.id}).status_code, 422)
        self.assertEqual(self.api('GET', f'{ASSETS}/{asset["id"]}').json()['state'], 'open')

    def test_a_draft_or_removed_asset_cannot_be_disposed_of(self):
        draft = self.api('POST', ASSETS, json={'profile_id': self.profile.id, 'name': 'Draft', 'purchase_value': 100, 'date_start': '2026-01-01'}).json()
        self.assertRefused(self.api('POST', f'{ASSETS}/{draft["id"]}/dispose', json={'date_remove': '2026-01-01', 'min_account_id': self.loss.id}), 422, 'invalid_state')
        asset = self.running_asset()
        body = {'date_remove': '2026-01-01', 'min_account_id': self.loss.id}
        self.assertEqual(self.api('POST', f'{ASSETS}/{asset["id"]}/dispose', json=body).status_code, 200)
        self.assertRefused(self.api('POST', f'{ASSETS}/{asset["id"]}/dispose', json=body), 422, 'invalid_state')

    def test_a_locked_period_refuses_and_leaves_the_asset_running(self):
        asset = self.running_asset()
        self.company.fiscalyear_lock_date = '2026-01-31'
        refused = self.api('POST', f'{ASSETS}/{asset["id"]}/dispose', json={'date_remove': '2026-01-01', 'min_account_id': self.loss.id})
        self.assertRefused(refused, 422, 'period_locked', 'date_remove')
        self.assertEqual(self.api('GET', f'{ASSETS}/{asset["id"]}').json()['state'], 'open')

    def test_other_company_asset_audit_and_capability(self):
        other_profile = self.asset_profile(self.other_company)
        foreign = self.env['account.asset'].with_company(self.other_company).create({'name': 'Foreign', 'profile_id': other_profile.id, 'purchase_value': 500, 'date_start': '2026-01-01'})
        self.assertRefused(self.api('POST', f'{ASSETS}/{foreign.id}/dispose', json={'date_remove': '2026-01-01'}), 404, 'not_found')
        asset = self.running_asset()
        self.api('POST', f'{ASSETS}/{asset["id"]}/dispose', json={'date_remove': '2026-01-01', 'min_account_id': self.loss.id})
        events = self.env['liwan.finance.audit.event'].search([('action', '=', 'asset_disposed'), ('res_id', '=', asset['id'])])
        self.assertEqual(len(events), 1)
        self.user_with('assets_reader', ['finance.assets.read'])
        self.authenticate('assets_reader', PASSWORD)
        self.assertRefused(self.api('POST', f'{ASSETS}/{asset["id"]}/dispose', json={'date_remove': '2026-01-01'}), 403, 'forbidden')
