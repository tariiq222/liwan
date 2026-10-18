# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .oca_common import ASSETS, WebVueFinanceOcaCase

PROFILES = '/api/v1/finance/asset-profiles'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceAssets(WebVueFinanceOcaCase):
    """Fixed assets over OCA account_asset_management: a 12000 asset depreciated linearly over five years."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.asset_profile(cls.company)
        cls.other_profile = cls.asset_profile(cls.other_company)
        cls.other_asset = cls.env['account.asset'].with_company(cls.other_company).create({
            'name': 'Foreign desk', 'profile_id': cls.other_profile.id, 'purchase_value': 500, 'date_start': '2026-01-01',
        })

    def body(self, **overrides):
        return {'profile_id': self.profile.id, 'name': 'Meeting table', 'purchase_value': 12000, 'date_start': '2024-01-01', **overrides}

    def create(self, **overrides):
        result = self.api('POST', ASSETS, json=self.body(**overrides))
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def validated(self, **overrides):
        asset = self.create(**overrides)
        result = self.api('POST', f'{ASSETS}/{asset["id"]}/validate', json={})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def compute(self, day):
        result = self.api('POST', f'{ASSETS}/compute-depreciation', json={'date': day})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    # --- profiles and creation -------------------------------------------------------------------------

    def test_the_profiles_list_shows_the_depreciation_method(self):
        result = self.api('GET', PROFILES)
        self.assertEqual(result.status_code, 200)
        body = result.json()
        self.assertEqual(body['total'], 1)
        profile = body['items'][0]
        self.assertEqual(profile['id'], self.profile.id)
        self.assertEqual(
            (profile['method'], profile['method_time'], profile['method_number'], profile['method_period']),
            ('linear', 'year', 5, 'year'),
        )
        self.assertEqual(profile['asset_account']['id'], self.account('106002').id)
        self.assertEqual(profile['journal']['id'], self._journal(self.company, 'general').id)

    def test_a_new_asset_is_a_draft_on_the_profile_method(self):
        asset = self.create(code='FUR-1', salvage_value=2000, note='Boardroom', partner_id=self.vendor.id)
        self.assertEqual((asset['state'], asset['code'], asset['note']), ('draft', 'FUR-1', 'Boardroom'))
        self.assertEqual(asset['profile'], {'id': self.profile.id, 'name': 'Furniture 5 years'})
        self.assertEqual(asset['partner']['id'], self.vendor.id)
        self.assertEqual(
            (asset['purchase_value'], asset['salvage_value'], asset['depreciation_base'], asset['value_residual']),
            (12000, 2000, 10000, 10000),
        )
        self.assertEqual((asset['method'], asset['method_number'], asset['currency']), ('linear', 5, 'SAR'))
        self.assertEqual([line['type'] for line in asset['lines']], ['create'])

    # --- validation and the depreciation board ---------------------------------------------------------

    def test_validating_computes_the_yearly_depreciation_board(self):
        asset = self.validated()
        self.assertEqual(asset['state'], 'open')
        board = [line for line in asset['lines'] if line['type'] == 'depreciate']
        self.assertEqual([line['date'] for line in board], ['2024-12-31', '2025-12-31', '2026-12-31', '2027-12-31', '2028-12-31'])
        self.assertEqual({line['amount'] for line in board}, {2400})
        self.assertEqual([line['remaining_value'] for line in board], [9600, 7200, 4800, 2400, 0])
        self.assertFalse(any(line['posted'] for line in board))
        self.assertEqual((asset['value_depreciated'], asset['value_residual']), (0, 12000))

    def test_only_a_draft_can_be_validated(self):
        asset = self.validated()
        result = self.api('POST', f'{ASSETS}/{asset["id"]}/validate', json={})
        self.assertRefused(result, 422, 'not_draft')

    def test_computing_depreciation_posts_the_due_lines_once(self):
        asset = self.validated()
        done = self.compute('2024-12-31')
        self.assertEqual(done['date'], '2024-12-31')
        self.assertEqual(len(done['entries']), 1)
        move = self.env['account.move'].browse(done['entries'][0]['id'])
        self.assertEqual(
            sorted((line.account_id.id, line.debit, line.credit) for line in move.line_ids),
            sorted([(self.account('106007').id, 0, 2400), (self.account('400064').id, 2400, 0)]),
        )
        self.assertEqual((move.state, move.date.isoformat()), ('posted', '2024-12-31'))
        detail = self.api('GET', f'{ASSETS}/{asset["id"]}').json()
        self.assertEqual((detail['value_depreciated'], detail['value_residual']), (2400, 9600))
        self.assertEqual([line['posted'] for line in detail['lines'] if line['type'] == 'depreciate'], [True, False, False, False, False])
        self.assertEqual(self.compute('2024-12-31')['entries'], [])
        self.assertEqual(len(self.compute('2025-12-31')['entries']), 1)

    def test_computing_depreciation_ignores_drafts_and_other_companies(self):
        self.create()
        self.env['account.asset'].with_company(self.other_company).browse(self.other_asset.id).validate()
        self.assertEqual(self.compute('2026-01-01')['entries'], [])

    def test_computing_depreciation_refuses_a_future_date(self):
        self.validated()
        result = self.api('POST', f'{ASSETS}/compute-depreciation', json={'date': '2999-01-01'})
        self.assertRefused(result, 422, 'invalid', 'date')

    # --- reads -----------------------------------------------------------------------------------------

    def test_the_list_filters_by_state_profile_and_text(self):
        draft = self.create(name='Draft chair', code='CH-1')
        running = self.validated(name='Running table')
        listing = self.api('GET', ASSETS).json()
        self.assertEqual((listing['total'], {item['id'] for item in listing['items']}), (2, {draft['id'], running['id']}))
        self.assertEqual({item['state'] for item in self.api('GET', ASSETS + '?state=open').json()['items']}, {'open'})
        self.assertEqual([item['id'] for item in self.api('GET', ASSETS + '?q=ch-1').json()['items']], [draft['id']])
        self.assertEqual(self.api('GET', ASSETS + f'?profile_id={self.profile.id}').json()['total'], 2)
        self.assertEqual(self.api('GET', ASSETS + f'?profile_id={self.other_profile.id}').json()['total'], 0)
        self.assertRefused(self.api('GET', ASSETS + '?state=lost'), 422, 'invalid', 'state')

    def test_an_asset_of_another_company_is_404_everywhere(self):
        for method, path, body in (
            ('GET', f'{ASSETS}/{self.other_asset.id}', None),
            ('POST', f'{ASSETS}/{self.other_asset.id}/validate', {}),
        ):
            with self.subTest(path=path):
                result = self.api(method, path, json=body)
                self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))
        self.assertNotIn(self.other_asset.id, [item['id'] for item in self.api('GET', ASSETS).json()['items']])

    # --- refusals --------------------------------------------------------------------------------------

    def test_a_bad_body_is_422_invalid(self):
        for overrides, field in (
            ({'unknown': 1}, 'unknown'),
            ({'purchase_value': 0}, 'purchase_value'),
            ({'purchase_value': '12000'}, 'purchase_value'),
            ({'salvage_value': -1}, 'salvage_value'),
            ({'salvage_value': 12001}, 'salvage_value'),
            ({'name': ' '}, 'name'),
            ({'code': 'x' * 33}, 'code'),
            ({'date_start': '01/01/2026'}, 'date_start'),
            ({'profile_id': self.other_profile.id}, 'profile_id'),
            ({'profile_id': 0}, 'profile_id'),
            ({'partner_id': self.foreign_partner.id}, 'partner_id'),
        ):
            with self.subTest(overrides=overrides):
                self.assertRefused(self.api('POST', ASSETS, json=self.body(**overrides)), 422, 'invalid', field)
        body = self.body()
        del body['date_start']
        self.assertRefused(self.api('POST', ASSETS, json=body), 422, 'invalid', 'date_start')

    def test_a_bad_compute_body_is_422_invalid(self):
        for body, field in (({}, 'date'), ({'date': 'soon'}, 'date'), ({'date': '2026-12-31', 'all': True}, 'all')):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', f'{ASSETS}/compute-depreciation', json=body), 422, 'invalid', field)
