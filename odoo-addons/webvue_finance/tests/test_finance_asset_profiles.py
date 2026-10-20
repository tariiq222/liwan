# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .oca_common import ASSETS, WebVueFinanceOcaCase
from .write_common import PASSWORD

PROFILES = '/api/v1/finance/asset-profiles'
PROFILE_KEYS = {
    'id', 'name', 'method', 'method_time', 'method_number', 'method_period', 'prorata', 'asset_account',
    'depreciation_account', 'expense_account', 'journal', 'plus_value_account', 'min_value_account', 'active',
}


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceAssetProfiles(WebVueFinanceOcaCase):

    def body(self, **overrides):
        return {
            'name': 'Vehicles 4 years', 'asset_account_id': self.account('106002').id, 'depreciation_account_id': self.account('106007').id,
            'expense_account_id': self.account('400064').id, 'journal_id': self._journal(self.company, 'general').id,
            'method': 'linear', 'method_time': 'year', 'method_number': 4, 'method_period': 'year', **overrides,
        }

    def create(self, **overrides):
        result = self.api('POST', PROFILES, json=self.body(**overrides))
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_a_profile_is_created_read_and_used_by_a_new_asset(self):
        profile = self.create(prorata=True)
        self.assertEqual(set(profile), PROFILE_KEYS)
        self.assertEqual((profile['method_number'], profile['prorata'], profile['active']), (4, True, True))
        self.assertEqual(self.api('GET', f'{PROFILES}/{profile["id"]}').json(), profile)
        asset = self.api('POST', ASSETS, json={'profile_id': profile['id'], 'name': 'Van', 'purchase_value': 40000, 'date_start': '2026-01-01'})
        self.assertEqual(asset.status_code, 201, asset.text)
        validated = self.api('POST', f'{ASSETS}/{asset.json()["id"]}/validate', json={})
        self.assertEqual(validated.status_code, 200, validated.text)
        self.assertEqual(len(validated.json()['lines']) - 1, 4)

    def test_an_unused_profile_changes_freely_and_a_used_one_is_fixed(self):
        profile = self.create()
        edited = self.api('PATCH', f'{PROFILES}/{profile["id"]}', json={'method_number': 6, 'name': 'Vehicles 6 years'})
        self.assertEqual((edited.status_code, edited.json()['method_number']), (200, 6))
        asset = self.api('POST', ASSETS, json={'profile_id': profile['id'], 'name': 'Van', 'purchase_value': 100, 'date_start': '2026-01-01'})
        self.assertEqual(asset.status_code, 201)
        locked = self.api('PATCH', f'{PROFILES}/{profile["id"]}', json={'method_number': 3})
        self.assertRefused(locked, 422, 'profile_in_use', 'method_number')
        self.assertEqual(self.api('PATCH', f'{PROFILES}/{profile["id"]}', json={'method_number': 6, 'name': 'Renamed'}).status_code, 200)
        gain = self.account('106002').id
        self.assertEqual(self.api('PATCH', f'{PROFILES}/{profile["id"]}', json={'plus_value_account_id': gain}).status_code, 200)

    def test_archive_hides_a_profile_from_the_list(self):
        profile = self.create()
        self.assertFalse(self.api('POST', f'{PROFILES}/{profile["id"]}/archive').json()['active'])
        self.assertNotIn(profile['id'], [item['id'] for item in self.api('GET', PROFILES).json()['items']])
        self.assertIn(profile['id'], [item['id'] for item in self.api('GET', f'{PROFILES}?archived=true').json()['items']])
        self.assertTrue(self.api('POST', f'{PROFILES}/{profile["id"]}/unarchive').json()['active'])

    def test_refusals(self):
        revenue = self.account('500001').id
        for change, field in (
            ({'name': ' '}, 'name'), ({'method': 'random'}, 'method'), ({'method_number': 0}, 'method_number'),
            ({'method_number': 2.5}, 'method_number'), ({'method_period': 'week'}, 'method_period'), ({'prorata': 'yes'}, 'prorata'),
            ({'asset_account_id': revenue}, 'asset_account_id'), ({'expense_account_id': revenue}, 'expense_account_id'),
            ({'depreciation_account_id': 999999}, 'depreciation_account_id'), ({'journal_id': self.bank.id}, 'journal_id'),
            ({'asset_account_id': self.account('106002', self.other_company).id}, 'asset_account_id'), ({'colour': 1}, 'colour'),
        ):
            with self.subTest(change=change):
                self.assertRefused(self.api('POST', PROFILES, json=self.body(**change)), 422, 'invalid', field)
        body = self.body()
        del body['journal_id']
        self.assertRefused(self.api('POST', PROFILES, json=body), 422, 'invalid', 'journal_id')
        self.assertRefused(self.api('PATCH', f'{PROFILES}/{self.create()["id"]}', json={}), 422, 'invalid')
        self.assertRefused(self.api('GET', f'{PROFILES}/999999'), 404, 'not_found')

    def test_another_company_profile_audit_and_capability(self):
        foreign = self.asset_profile(self.other_company)
        self.assertRefused(self.api('GET', f'{PROFILES}/{foreign.id}'), 404, 'not_found')
        self.assertRefused(self.api('PATCH', f'{PROFILES}/{foreign.id}', json={'name': 'x'}), 404, 'not_found')
        profile = self.create()
        self.api('PATCH', f'{PROFILES}/{profile["id"]}', json={'name': 'Audited'})
        events = self.env['webvue.finance.audit.event'].search([('res_model', '=', 'account.asset.profile'), ('res_id', '=', profile['id'])])
        self.assertEqual(set(events.mapped('action')), {'asset_profile_created', 'asset_profile_changed'})
        self.user_with('assets_reader', ['finance.assets.read'])
        self.authenticate('assets_reader', PASSWORD)
        self.assertEqual(self.api('GET', PROFILES).status_code, 200)
        self.assertRefused(self.api('POST', PROFILES, json=self.body(name='x')), 403, 'forbidden')
        self.assertRefused(self.api('PATCH', f'{PROFILES}/{profile["id"]}', json={'name': 'x'}), 403, 'forbidden')
