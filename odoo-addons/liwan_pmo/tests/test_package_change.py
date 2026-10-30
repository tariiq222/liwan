# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

# What commercial-compiler/1 emitted for a plan without the projects application:
# the platform limits and the selected booleans only (inventory finding 4).
TARGET_WITHOUT_PMO = {'users.limit': None, 'storage.limit_mb': None, 'branches.extra_limit': 0}


@tagged('post_install', '-at_install', 'liwan')
class TestPackageChange(LiwanPmoCase):
    """Spec 3.6: a plan change flips keys and limits only, on a tenant with every app installed."""

    def _profile(self):
        return self.env.ref('liwan_platform.tenant_profile')

    def _write(self, features):
        self._profile().with_context(**{OPERATOR_CONTEXT: True}).write({'features': features})

    def _installed(self):
        return set(self.env['ir.module.module'].search([('state', '=', 'installed')]).mapped('name'))

    def test_downgrade_without_pmo_closes_writes_keeps_reads_and_data(self):
        service = self.env['liwan.entitlement.service']
        installed_before = self._installed()
        projects_before = self.env['project.project'].search_count([])
        tasks_before = self.env['project.task'].search_count([])

        features = service._liwan_close_unlisted_features(TARGET_WITHOUT_PMO)
        self.assertIs(features['pmo.enabled'], False)
        self.assertEqual(features['projects.max_projects'], 0)
        self.assertIs(type(features['projects.max_projects']), int)
        self.assertNotIn('pmo.enabled', TARGET_WITHOUT_PMO)  # the input is not mutated
        self._write(features)

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/projects?minimal=1').status_code, 200)
        created = self.api('POST', '/api/v1/projects', {'name': 'Closed by plan', 'date_end': '2030-12-31'})
        self.assertEqual((created.status_code, created.json()['code']), (403, 'feature_not_included'))
        with self.assertRaises(LiwanAccessRule):
            service.require('pmo.enabled')
        self.assertTrue(service._liwan_feature_read('pmo.enabled'))
        self.assertEqual(self.env['project.project'].search_count([]), projects_before)
        self.assertEqual(self.env['project.task'].search_count([]), tasks_before)
        self.assertTrue(self.project.exists())

        upgraded = service._liwan_close_unlisted_features({
            **TARGET_WITHOUT_PMO, 'pmo.enabled': True, 'projects.max_projects': None,
        })
        self._write(upgraded)
        created = self.api('POST', '/api/v1/projects', {'name': 'Open again', 'date_end': '2030-12-31'})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(self._installed(), installed_before)

    def test_incomplete_target_is_still_refused(self):
        # Ruling E2: Odoo stays strict; only the operator completes a target.
        registry = self.env['liwan.feature.registry']._liwan_feature_map()
        installed = set(self.env['liwan.feature.registry']._liwan_installed_module_ids())
        booleans_only = dict(TARGET_WITHOUT_PMO)
        for key, item in registry.items():
            if item['type'] == 'boolean' and item['module'] in installed:
                booleans_only[key] = False
        with self.assertRaisesRegex(ValidationError, r'missing required keys: .*projects\.max_projects'):
            self._write(booleans_only)

    def test_completion_never_fills_platform_keys_or_changes_listed_values(self):
        service = self.env['liwan.entitlement.service']
        completed = service._liwan_close_unlisted_features({'pmo.enabled': True})
        self.assertIs(completed['pmo.enabled'], True)
        for key in ('users.limit', 'storage.limit_mb', 'branches.extra_limit'):
            self.assertNotIn(key, completed)

    def test_administrator_roles_follow_the_entitlement(self):
        service = self.env['liwan.entitlement.service']
        self._write(service._liwan_close_unlisted_features({
            **TARGET_WITHOUT_PMO, 'pmo.enabled': True, 'projects.max_projects': None,
        }))
        opened = service._liwan_entitled_admin_roles()
        self.assertIn('system_admin', opened)
        self.assertIn('pmo_manager', opened)
        self.assertNotIn('hr_manager', opened)
        self._write(service._liwan_close_unlisted_features(TARGET_WITHOUT_PMO))
        profile = service._liwan_profile()
        self.assertIn('pmo.enabled', profile.retained_read_features)  # retained, yet not granted
        closed = service._liwan_entitled_admin_roles()
        self.assertIn('system_admin', closed)  # holds platform permissions next to meetings ones
        self.assertNotIn('pmo_manager', closed)
