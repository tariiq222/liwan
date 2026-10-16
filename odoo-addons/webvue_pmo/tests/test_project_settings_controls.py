# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError
from odoo.tests import new_test_user, tagged

from .common import WebVuePmoCase
from odoo.addons.project.models.project_project import (
    ProjectProject as StockProjectProject,
)


@tagged('post_install', '-at_install', 'webvue')
class TestProjectSettingsControls(WebVuePmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='psc_admin', password='psc_admin_pass_123',
            groups='webvue_pmo.group_pmo_manager',
        )
        cls.company_b = cls.env['res.company'].create({'name': 'PSC company B'})

    def _set_company_params(self, **values):
        params = self.env['webvue.pmo.settings']
        params.set_values(values)

    def test_create_toggle_combos_and_atomic_422(self):
        self.authenticate('psc_admin', 'psc_admin_pass_123')
        self._set_company_params(require_manager_on_create=True, require_end_date_on_create=True)
        before = self.env['project.project'].search_count([])
        res = self.api('POST', '/api/v1/projects', {'name': 'No date'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'date_end'))
        self.assertEqual(self.env['project.project'].search_count([]), before)
        res = self.api('POST', '/api/v1/projects', {'name': 'Both', 'date_end': '2031-01-15', 'user_id': self.manager.id})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()['manager']['id'], self.manager.id)
        self.assertEqual(res.json()['date_end'], '2031-01-15')

        self._set_company_params(require_manager_on_create=True, require_end_date_on_create=False)
        res = self.api('POST', '/api/v1/projects', {'name': 'Manager only'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()['manager']['id'], self.admin.id)
        self.assertIsNone(res.json()['date_end'])

        self._set_company_params(require_manager_on_create=False, require_end_date_on_create=True)
        res = self.api('POST', '/api/v1/projects', {'name': 'Date only', 'user_id': None})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'date_end'))
        res = self.api('POST', '/api/v1/projects', {'name': 'Date only', 'user_id': None, 'date_end': '2031-02-01'})
        self.assertEqual(res.status_code, 201)
        self.assertIsNone(res.json()['manager'])

        self._set_company_params(require_manager_on_create=False, require_end_date_on_create=False)
        res = self.api('POST', '/api/v1/projects', {'name': 'Neither', 'extra': 1})
        self.assertEqual(res.status_code, 422)
        res = self.api('POST', '/api/v1/projects', {'name': 'Neither'})
        self.assertEqual(res.status_code, 201)

    def test_creator_defaults_are_gated_and_settings_stay_admin_only(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/settings/projects').status_code, 403)
        self.assertEqual(self.api('GET', '/api/v1/settings/projects/create-defaults').status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        defaults = self.api('GET', '/api/v1/settings/projects/create-defaults')
        self.assertEqual(defaults.status_code, 200)
        self.assertEqual(set(defaults.json()), {'require_manager_on_create', 'require_end_date_on_create', 'default_manager_id'})
        self.assertEqual(defaults.json()['default_manager_id'], self.manager.id)
        self.assertNotIn('default_stages', defaults.json())

    def test_per_company_defaults_are_isolated(self):
        self.authenticate('psc_admin', 'psc_admin_pass_123')
        self._set_company_params(require_end_date_on_create=False, default_completion_approval='project_manager')
        other = self.env['webvue.pmo.settings'].with_company(self.company_b)
        values = other.get()
        self.assertTrue(values['require_end_date_on_create'])
        self.assertEqual(values['default_completion_approval'], 'none')

    def test_legacy_incomplete_projects_remain_editable(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertIsNone(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['date_end'])
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'name': 'Still editable'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['name'], 'Still editable')

    def test_new_projects_snapshot_approval_default(self):
        self.authenticate('psc_admin', 'psc_admin_pass_123')
        self._set_company_params(
            require_end_date_on_create=False,
            default_completion_approval='project_manager',
        )
        created = self.api('POST', '/api/v1/projects', {'name': 'Snap'}).json()
        self.assertEqual(created['completion_approval'], 'project_manager')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['completion_approval'], 'none')

    def test_mixed_invalid_settings_payload_is_atomic(self):
        self.authenticate('psc_admin', 'psc_admin_pass_123')
        before = self.api('GET', '/api/v1/settings/projects').json()
        res = self.api('PATCH', '/api/v1/settings/projects', {
            'require_manager_on_create': False,
            'deadline_reminders_days_before': 99,
        })
        self.assertEqual(res.status_code, 422)
        after = self.api('GET', '/api/v1/settings/projects').json()
        self.assertEqual(after, before)

    def test_foreign_company_manager_is_rejected(self):
        self.authenticate('psc_admin', 'psc_admin_pass_123')
        self._set_company_params(require_end_date_on_create=False, require_manager_on_create=True)
        foreign = new_test_user(
            self.env, login='psc_foreign', password='psc_foreign_pass_123',
            groups='webvue_core.group_employee', company_id=self.company_b.id,
        )
        foreign.write({'company_ids': [(6, 0, [self.company_b.id])]})
        res = self.api('POST', '/api/v1/projects', {'name': 'Foreign mgr', 'user_id': foreign.id})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'user_id')

    def test_ordinary_orm_create_enforces_toggles_and_eligibility(self):
        self.env['webvue.pmo.settings'].set_values({
            'require_manager_on_create': True,
            'require_end_date_on_create': True,
            'default_completion_approval': 'project_manager',
        })
        Project = self.env['project.project'].with_user(self.manager)
        with self.assertRaises(UserError):
            Project.create({'name': 'No date', 'user_id': self.manager.id})
        created = Project.create({
            'name': 'Has date', 'user_id': self.manager.id, 'date': '2031-03-01',
        })
        self.assertEqual(created.webvue_completion_approval, 'project_manager')
        self.assertEqual(created.user_id, self.manager)
        self.env['webvue.pmo.settings'].set_values({
            'require_manager_on_create': False,
            'require_end_date_on_create': False,
            'default_completion_approval': 'none',
        })
        none_mgr = Project.create({'name': 'No manager', 'user_id': False})
        self.assertFalse(none_mgr.user_id)
        self.assertEqual(none_mgr.webvue_completion_approval, 'none')
        with self.assertRaises(UserError):
            Project.create({
                'name': 'Bad reviewer',
                'user_id': self.manager.id,
                'webvue_completion_approval': 'specific_user',
                'webvue_completion_approver_id': self.employee.id,
            })
        with self.assertRaises(UserError):
            Project.with_context(default_webvue_completion_approval='specific_user').create({
                'name': 'Ctx specific', 'user_id': self.manager.id,
            })
        system_admin = new_test_user(
            self.env, login='psc_group_system', password='psc_group_system_pass',
            groups='base.group_system,webvue_core.group_employee',
        )
        self.env['webvue.pmo.settings'].set_values({
            'require_end_date_on_create': True,
            'require_manager_on_create': True,
        })
        with self.assertRaises(UserError):
            self.env['project.project'].with_user(system_admin).create({
                'name': 'System business', 'user_id': system_admin.id,
            })
        # Bootstrap/superuser fixtures remain compatible.
        legacy = self.env['project.project'].create({'name': 'Legacy fixture'})
        self.assertTrue(legacy.id)
        self.env['webvue.pmo.settings'].set_values({
            'project_creators': 'employees',
            'require_end_date_on_create': True,
        })
        with self.assertRaises(UserError):
            self.env['project.project'].with_user(self.employee)._webvue_create_from_policy('Elevated still checked')

    def test_lone_end_date_patch_updates_without_inventing_start(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.env['webvue.pmo.settings'].set_values({'require_end_date_on_create': True})
        created = self.api('POST', '/api/v1/projects', {'name': 'Lone end', 'date_end': '2030-12-31'})
        self.assertEqual(created.status_code, 201)
        project_id = created.json()['id']
        self.assertIsNone(created.json()['date_start'])
        self.assertEqual(created.json()['date_end'], '2030-12-31')
        patched = self.api('PATCH', f'/api/v1/projects/{project_id}', {'date': '2031-06-30'})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(patched.json()['date_end'], '2031-06-30')
        self.assertIsNone(patched.json()['date_start'])
        cleared = self.api('PATCH', f'/api/v1/projects/{project_id}', {'date': None})
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.json()['date_end'])
        paired = self.api('PATCH', f'/api/v1/projects/{project_id}', {
            'date_start': '2030-01-01', 'date': '2031-01-01',
        })
        self.assertEqual(paired.status_code, 200)
        self.assertEqual((paired.json()['date_start'], paired.json()['date_end']), ('2030-01-01', '2031-01-01'))
        self.assertIn(StockProjectProject, type(self.env['project.project']).__mro__)
