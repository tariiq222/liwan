# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from .oca_common import ASSETS, WebVueFinanceOcaCase
from .write_common import PASSWORD


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceAssetDraftEdit(WebVueFinanceOcaCase):
    """A draft asset can be corrected or removed; once it runs, only validation, disposal and OCA's own rules apply."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.asset_profile(cls.company)
        cls.other_profile = cls.asset_profile(cls.other_company)

    def create(self, **overrides):
        body = {'profile_id': self.profile.id, 'name': 'Meeting table', 'purchase_value': 12000, 'date_start': '2024-01-01', **overrides}
        result = self.api('POST', ASSETS, json=body)
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def patch(self, asset, **body):
        return self.api('PATCH', f'{ASSETS}/{asset["id"]}', json=body)

    def acquisition_line(self, asset):
        lines = [line for line in asset['lines'] if line['type'] == 'create']
        self.assertEqual(len(lines), 1)
        return lines[0]

    def events(self, action, asset):
        return self.env['webvue.finance.audit.event'].search([('action', '=', action), ('res_id', '=', asset['id'])])

    # --- edit ------------------------------------------------------------------------------------------

    def test_editing_a_draft_moves_the_acquisition_line_and_the_board_follows(self):
        asset = self.create()
        result = self.patch(asset, purchase_value=9000, salvage_value=1000, date_start='2025-03-01', name='Boardroom table', code='BR-1', note='Moved')
        self.assertEqual(result.status_code, 200, result.text)
        edited = result.json()
        self.assertEqual(
            (edited['name'], edited['code'], edited['note'], edited['purchase_value'], edited['salvage_value'], edited['depreciation_base']),
            ('Boardroom table', 'BR-1', 'Moved', 9000, 1000, 8000),
        )
        line = self.acquisition_line(edited)
        self.assertEqual((line['amount'], line['date']), (8000, '2025-03-01'))
        validated = self.api('POST', f'{ASSETS}/{asset["id"]}/validate', json={}).json()
        board = [row for row in validated['lines'] if row['type'] == 'depreciate']
        self.assertEqual(sum(row['amount'] for row in board), 8000)
        self.assertEqual(self.acquisition_line(validated)['amount'], 8000)

    def test_a_partner_is_set_and_cleared_and_a_foreign_one_refused(self):
        asset = self.create(partner_id=self.vendor.id)
        self.assertEqual(self.patch(asset, partner_id=None).json()['partner'], None)
        self.assertEqual(self.patch(asset, partner_id=self.vendor.id).json()['partner']['id'], self.vendor.id)
        self.assertRefused(self.patch(asset, partner_id=self.foreign_partner.id), 422, 'invalid', 'partner_id')

    def test_the_profile_can_change_while_the_asset_is_a_draft(self):
        asset = self.create()
        other = self.env['account.asset.profile'].with_company(self.company).create({
            'name': 'Equipment 3 years', 'company_id': self.company.id,
            'account_asset_id': self.account('106002').id, 'account_depreciation_id': self.account('106007').id,
            'account_expense_depreciation_id': self.account('400064').id, 'journal_id': self._journal(self.company, 'general').id,
            'method': 'linear', 'method_time': 'year', 'method_number': 3, 'method_period': 'year',
        })
        edited = self.patch(asset, profile_id=other.id).json()
        self.assertEqual((edited['profile']['id'], edited['method_number']), (other.id, 3))
        self.assertRefused(self.patch(asset, profile_id=self.other_profile.id), 422, 'invalid', 'profile_id')

    def test_only_a_draft_can_be_edited_or_deleted(self):
        asset = self.create()
        self.api('POST', f'{ASSETS}/{asset["id"]}/validate', json={})
        self.assertRefused(self.patch(asset, name='Late'), 422, 'not_draft')
        self.assertRefused(self.api('DELETE', f'{ASSETS}/{asset["id"]}'), 422, 'not_draft')
        self.assertEqual(self.api('GET', f'{ASSETS}/{asset["id"]}').json()['name'], 'Meeting table')

    def test_a_bad_edit_body_is_422_invalid(self):
        asset = self.create(salvage_value=2000)
        for body, field in (
            ({}, None),
            ({'unknown': 1}, 'unknown'),
            ({'purchase_value': 0}, 'purchase_value'),
            ({'purchase_value': 1500}, 'salvage_value'),
            ({'salvage_value': 12001}, 'salvage_value'),
            ({'name': ' '}, 'name'),
            ({'code': 'x' * 33}, 'code'),
            ({'date_start': 'soon'}, 'date_start'),
            ({'profile_id': 0}, 'profile_id'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.patch(asset, **body), 422, 'invalid', field)
        self.assertEqual(self.api('GET', f'{ASSETS}/{asset["id"]}').json()['purchase_value'], 12000)

    def test_a_start_date_in_a_locked_period_is_refused(self):
        asset = self.create()
        self.company.fiscalyear_lock_date = '2024-12-31'
        self.assertRefused(self.patch(asset, date_start='2024-06-01'), 422, 'period_locked', 'date_start')
        self.assertEqual(self.patch(asset, name='Renamed').status_code, 200)
        self.assertEqual(self.patch(asset, date_start='2025-02-01').status_code, 200)

    def test_an_edit_writes_one_audit_event_with_field_names(self):
        asset = self.create()
        self.patch(asset, purchase_value=11000, name='Renamed')
        events = self.events('asset_changed', asset)
        self.assertEqual(len(events), 1)
        self.assertEqual((events.fields_written, events.outcome), ('name, purchase_value', 'draft'))
        self.assertEqual(self.events('asset_changed', asset).company_id, self.company)

    # --- delete ----------------------------------------------------------------------------------------

    def test_deleting_a_draft_removes_it_and_its_acquisition_line(self):
        asset = self.create()
        result = self.api('DELETE', f'{ASSETS}/{asset["id"]}')
        self.assertEqual(result.status_code, 204, result.text)
        self.assertRefused(self.api('GET', f'{ASSETS}/{asset["id"]}'), 404, 'not_found')
        self.assertFalse(self.env['account.asset.line'].search([('asset_id', '=', asset['id'])]))
        events = self.events('asset_deleted', asset)
        self.assertEqual((len(events), events.fields_written, events.outcome), (1, 'unlink', 'deleted'))

    def test_ocas_own_refusal_surfaces_as_422(self):
        asset = self.create()

        def refuse(records, *args, **kwargs):
            message = 'You cannot delete an asset that contains posted depreciation lines.'
            raise UserError(message)

        with patch.object(type(self.env['account.asset']), 'unlink', refuse):
            result = self.api('DELETE', f'{ASSETS}/{asset["id"]}')
        self.assertRefused(result, 422, 'invalid')
        self.assertEqual(self.api('GET', f'{ASSETS}/{asset["id"]}').status_code, 200)
        self.assertFalse(self.events('asset_deleted', asset))

    # --- access ----------------------------------------------------------------------------------------

    def test_another_company_asset_is_404_and_a_reader_is_403(self):
        foreign = self.env['account.asset'].with_company(self.other_company).create({
            'name': 'Foreign desk', 'profile_id': self.other_profile.id, 'purchase_value': 500, 'date_start': '2026-01-01',
        })
        for method in ('PATCH', 'DELETE'):
            with self.subTest(method=method):
                self.assertRefused(self.api(method, f'{ASSETS}/{foreign.id}', json={'name': 'X'}), 404, 'not_found')
        asset = self.create()
        self.user_with('assets_reader', ['finance.assets.read'])
        self.authenticate('assets_reader', PASSWORD)
        self.assertRefused(self.patch(asset, name='X'), 403, 'forbidden')
        self.assertRefused(self.api('DELETE', f'{ASSETS}/{asset["id"]}'), 403, 'forbidden')
