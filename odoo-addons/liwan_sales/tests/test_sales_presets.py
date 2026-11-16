# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Sector presets: structured values, readable through the API, applied through the ordinary settings write."""
from unittest.mock import patch

from odoo.tests import tagged

from .common import BRIDGE_KEYS, MODES, LiwanSalesCase
from odoo.addons.liwan_sales.models.sales_presets import SECTOR_PRESETS
from odoo.addons.liwan_sales.serializers.settings import WRITABLE_KEYS

PRESETS = '/api/v1/sales/settings/presets'
SETTINGS = '/api/v1/sales/settings'
SECTORS = ['services', 'trading', 'contracting']


class PresetCase(LiwanSalesCase):

    def presets(self, user=None, expect=200):
        response = self.api_as(user or self.manager, 'GET', PRESETS)
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def preset(self, key, user=None):
        return next(item for item in self.presets(user)['items'] if item['key'] == key)

    def apply(self, key, user=None, expect=200):
        """Apply a preset the way the page does: its values with the revision of the settings just read."""
        user = user or self.manager
        settings = self.api_as(user, 'GET', SETTINGS).json()
        body = {**self.preset(key, user)['values'], 'revision': settings['revision']}
        response = self.api_as(user, 'PATCH', SETTINGS, body)
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()


@tagged('post_install', '-at_install', 'liwan')
class TestSalesPresets(PresetCase):

    def test_the_presets_are_the_three_sectors_with_structured_values(self):
        body = self.presets()
        self.assertEqual((body['total'], [item['key'] for item in body['items']]), (3, SECTORS))
        settings = self.api_as(self.manager, 'GET', SETTINGS).json()
        for item in body['items']:
            with self.subTest(preset=item['key']):
                self.assertEqual(set(item), {'key', 'values', 'matches'})
                self.assertFalse(item['matches'])
                # Sales' own values are all there, each a setting the tenant carries; nothing else is.
                self.assertEqual(set(WRITABLE_KEYS) - {'default_terms'}, set(item['values']) & set(WRITABLE_KEYS))
                self.assertLessEqual(set(item['values']), (set(settings) - {'can_manage', 'revision'}))
        self.assertEqual(len({str(item['values']) for item in body['items']}), 3)

    def test_each_preset_applies_through_the_ordinary_settings_write(self):
        for key in SECTORS:
            with self.subTest(preset=key):
                before = self.api_as(self.manager, 'GET', SETTINGS).json()
                applied = self.apply(key)
                self.assertEqual(applied['revision'], before['revision'] + 1)
                for setting, value in self.preset(key)['values'].items():
                    self.assertEqual(applied[setting], value, setting)
                self.assertTrue(self.preset(key)['matches'])
                self.assertEqual([item['key'] for item in self.presets()['items'] if item['matches']], [key])
                # What a preset leaves alone stays: the default terms belong to the tenant.
                self.assertEqual(applied['default_terms'], before['default_terms'])

    def test_a_changed_setting_stops_a_preset_from_matching(self):
        self.apply('services')
        revision = self.api_as(self.manager, 'GET', SETTINGS).json()['revision']
        self.assertEqual(
            self.api_as(self.manager, 'PATCH', SETTINGS, {'revision': revision, 'validity_days': 31}).status_code, 200,
        )
        self.assertFalse(self.preset('services')['matches'])

    def test_a_stale_apply_is_the_409_of_any_settings_write(self):
        values = self.preset('trading')['values']
        self.apply('services')
        stale = self.api_as(self.manager, 'PATCH', SETTINGS, {**values, 'revision': 1})
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))

    def test_who_reads_and_who_applies(self):
        reader = self.api_as(self.agent, 'GET', PRESETS)
        self.assertEqual((reader.status_code, reader.json()['code']), (403, 'forbidden'))
        outsider = self.api_as(self.outsider, 'GET', PRESETS)
        self.assertEqual((outsider.status_code, outsider.json()['code']), (403, 'forbidden'))
        settings_only = self.custom_user('sales_preset_settings', ['sales.settings.manage'])
        self.assertEqual(self.presets(settings_only)['total'], 3)
        values = self.preset('services')['values']
        refused = self.api_as(self.agent, 'PATCH', SETTINGS, {**values, 'revision': 1})
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.api_as(self.manager, 'GET', SETTINGS).json()['validity_days'], 30)

    def test_a_branch_manager_reads_the_presets_and_cannot_apply_one(self):
        branch = self.in_branch.manager
        values = self.preset('contracting', branch)['values']
        refused = self.api_as(branch, 'PATCH', SETTINGS, {**values, 'revision': 1})
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.api_as(self.manager, 'GET', SETTINGS).json()['visibility'], 'own')

    def test_the_presets_hold_in_both_commercial_modes(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.assertEqual(self.presets()['total'], 3)
                self.apply('contracting')

    def test_a_setting_the_tenant_does_not_carry_is_left_out_of_every_preset(self):
        extras = {sector: {'ghost_key': 'x'} for sector in SECTORS}
        settings = type(self.env['liwan.sales.settings'])
        with patch.object(settings, '_liwan_preset_extras', lambda self: extras):
            for item in self.presets()['items']:
                self.assertNotIn('ghost_key', item['values'])

    def test_a_setting_a_bridge_carries_joins_the_preset_and_one_it_does_not_is_left_out(self):
        settings = type(self.env['liwan.sales.settings'])
        extras = {sector: {'ghost_key': 'x'} for sector in SECTORS}
        wire = settings._liwan_wire_extras
        with (
            patch.object(settings, '_liwan_preset_extras', lambda self: extras),
            patch.object(settings, '_liwan_wire_extras', lambda self: {**wire(self), 'ghost_key': 'old'}),
        ):
            for item in self.presets()['items']:
                self.assertEqual(item['values']['ghost_key'], 'x')
                self.assertFalse(item['matches'])
        without = {key: value for key, value in self.api_as(self.manager, 'GET', SETTINGS).json().items() if key in BRIDGE_KEYS}
        with patch.object(settings, '_liwan_wire_extras', lambda self: {}):
            for item in self.presets()['items']:
                self.assertFalse(set(item['values']) & BRIDGE_KEYS, without)

    def test_the_bridge_values_in_a_preset_are_the_ones_its_settings_accept(self):
        carried = set(self.api_as(self.manager, 'GET', SETTINGS).json()) & BRIDGE_KEYS
        # Each installed bridge sets its main choice in every preset; one that is not installed adds nothing.
        main = carried & {'payment_to_confirm', 'opportunity_win', 'invoice_down_payment'}
        for key in SECTORS:
            with self.subTest(preset=key):
                values = self.preset(key)['values']
                self.assertLessEqual(set(values) & BRIDGE_KEYS, carried)
                self.assertLessEqual(main, set(values))
                self.apply(key)

    def test_the_catalog_of_presets_names_no_customer_and_only_known_settings(self):
        known = set(WRITABLE_KEYS) | BRIDGE_KEYS
        for key, values in SECTOR_PRESETS.items():
            with self.subTest(preset=key):
                self.assertLessEqual(set(values), known)
                self.assertNotIn('default_terms', values)
