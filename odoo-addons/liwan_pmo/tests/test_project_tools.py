# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestProjectTools(LiwanPmoCase):
    project_tool_policies = {'planning': 'optional', 'governance': 'optional', 'finance': 'optional'}

    def test_default_tools_are_optional_and_off(self):
        settings = self.env['liwan.pmo.settings'].get()
        for key in ('planning', 'governance', 'finance'):
            self.assertEqual(settings.get(f'{key}_tool_policy'), 'optional')
            self.assertFalse(self.project._liwan_tool_enabled(key))
        self.assertFalse(settings['require_end_date_on_create'])

    def test_live_policy_matrix_preserves_preference(self):
        settings = self.env['liwan.pmo.settings']
        for key in ('planning', 'governance', 'finance'):
            field = f'liwan_{key}_enabled'
            for preference in (False, True):
                self.project.write({field: preference})
                for policy in ('enabled', 'disabled', 'optional'):
                    settings.set_values({f'{key}_tool_policy': policy})
                    self.assertEqual(self.project._liwan_tool_enabled(key), policy == 'enabled' or (policy == 'optional' and preference))
                self.assertEqual(self.project[field], preference)

    def test_incompatible_mandatory_settings_are_atomic(self):
        settings = self.env['liwan.pmo.settings']
        before = settings.get()
        with self.assertRaises(ValueError):
            settings.set_values({'require_charter_approval': True})
        self.assertEqual(settings.get(), before)
        settings.set_values({'governance_tool_policy': 'enabled', 'require_charter_approval': True})
        with self.assertRaises(ValueError):
            settings.set_values({'governance_tool_policy': 'disabled'})
        self.assertEqual(settings.get()['governance_tool_policy'], 'enabled')

    def test_company_policy_is_live_and_preferences_are_scoped(self):
        other_company = self.env['res.company'].create({'name': 'Tool company B'})
        self.env['liwan.pmo.settings'].with_company(other_company).set_values({'planning_tool_policy': 'enabled'})
        other = self.env['project.project'].with_company(other_company).create({'name': 'Other project', 'company_id': other_company.id})
        self.assertTrue(other._liwan_tool_enabled('planning'))
        self.assertFalse(self.project._liwan_tool_enabled('planning'))
        self.assertEqual(self.project._liwan_tool_policies()['planning'], 'optional')
        self.env['liwan.pmo.settings'].set_values({'planning_tool_policy': 'enabled'})
        self.assertTrue(self.project._liwan_tool_enabled('planning'))
        new = self.env['project.project'].create({'name': 'Created after policy'})
        self.assertTrue(new._liwan_tool_enabled('planning'))
        self.assertFalse(new.liwan_planning_enabled)

    def test_all_mandatory_conflicts_require_one_compatible_save(self):
        settings = self.env['liwan.pmo.settings']
        for patch in ({'change_control_mode': 'required'}, {'baseline_gate': 'required'}, {'require_charter_approval': True}):
            before = settings.get()
            with self.assertRaises(ValueError):
                settings.set_values(patch)
            self.assertEqual(settings.get(), before)
        settings.set_values({'planning_tool_policy': 'enabled', 'governance_tool_policy': 'enabled',
                             'baseline_gate': 'required', 'change_control_mode': 'required', 'require_charter_approval': True})
        before = settings.get()
        with self.assertRaises(ValueError):
            settings.set_values({'governance_tool_policy': 'optional', 'baseline_gate': 'off'})
        self.assertEqual(settings.get(), before)
        result = settings.set_values({'planning_tool_policy': 'disabled', 'governance_tool_policy': 'disabled',
                                      'baseline_gate': 'off', 'change_control_mode': 'off', 'require_charter_approval': False})
        self.assertEqual(result['governance_tool_policy'], 'disabled')
