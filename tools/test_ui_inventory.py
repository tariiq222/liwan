# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from ui_inventory import legacy_wrappers


class LegacyWrappersTest(unittest.TestCase):
    def test_only_exact_legacy_classes_are_reported(self):
        source = '<div class="liwan-panel liwan-panel-header liwan-panel-row liwan-panel-loading-row">'
        self.assertEqual(legacy_wrappers('page.vue', source), ['liwan-panel', 'liwan-panel-header'])

    def test_settings_navigation_has_one_owner(self):
        source = '<nav class="liwan-settings-nav">'
        self.assertEqual(legacy_wrappers('packages/ui/app/components/shared/layout/SettingsPage.vue', source), [])
        self.assertEqual(legacy_wrappers('page.vue', source), ['liwan-settings-nav'])
