# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestSettings(WebVuePmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='api_admin', password='api_admin_pass_123',
            groups='webvue_pmo.group_pmo_manager',
        )

    def setUp(self):
        super().setUp()
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('webvue_pmo.project_creators', 'managers')
        params.set_param('webvue_pmo.default_stages', False)
        self.env.company._webvue_write_pmo_settings({
            'webvue_pmo_settings_initialized': False,
            'webvue_pmo_project_creators': 'managers',
            'webvue_pmo_default_stages': False,
        })

    def _legacy_raw(self):
        params = self.env['ir.config_parameter'].sudo()
        return (
            params.get_param('webvue_pmo.project_creators'),
            params.get_param('webvue_pmo.default_stages'),
        )

    def test_employee_is_forbidden_and_legacy_pmo_manager_is_allowed(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/settings/projects').status_code, 403)
        self.assertEqual(self.api(
            'PATCH', '/api/v1/settings/projects', {'project_creators': 'employees'},
        ).status_code, 403)

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/settings/projects').status_code, 200)

    def test_require_charter_approval_policy(self):
        self.authenticate('api_admin', 'api_admin_pass_123')
        body = self.api('GET', '/api/v1/settings/projects').json()
        self.assertIs(body['require_charter_approval'], False)
        res = self.api('PATCH', '/api/v1/settings/projects', {'require_charter_approval': True})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIs(res.json()['require_charter_approval'], True)
        bad = self.api('PATCH', '/api/v1/settings/projects', {'require_charter_approval': 'yes'})
        self.assertEqual((bad.status_code, bad.json()['field']), (422, 'require_charter_approval'))

    def test_get_and_patch(self):
        self.authenticate('api_admin', 'api_admin_pass_123')
        body = self.api('GET', '/api/v1/settings/projects').json()
        self.assertGreaterEqual(set(body), {'project_creators', 'default_stages', 'require_manager_on_create', 'require_end_date_on_create', 'default_completion_approval', 'deadline_reminders_enabled', 'deadline_reminders_days_before', 'overdue_digest_enabled', 'require_charter_approval'})
        self.assertEqual(body['project_creators'], 'managers')
        self.assertEqual(len(body['default_stages']), 4)
        self.assertTrue(body['require_manager_on_create'])
        self.assertTrue(body['require_end_date_on_create'])
        self.assertEqual(body['default_completion_approval'], 'none')
        res = self.api('PATCH', '/api/v1/settings/projects', {'project_creators': 'employees', 'default_stages': [{'name': 'Only', 'fold': False}]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['project_creators'], 'employees')
        self.assertEqual(res.json()['default_stages'], [{'name': 'Only', 'fold': False}])
        res = self.api('PATCH', '/api/v1/settings/projects', {'default_stages': []})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'default_stages'))
        res = self.api('PATCH', '/api/v1/settings/projects', {'project_creators': 'x'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'project_creators'))
        self.assertEqual(self.api('PATCH', '/api/v1/settings/projects', {'other': 1}).status_code, 422)
        # the new policy is live: the employee may now create
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertTrue(self.api('GET', '/api/v1/projects').json()['can_create'])

    def test_two_companies_legacy_fallback_partial_first_write_and_noop(self):
        Settings = self.env['webvue.pmo.settings']
        company_a = self.env.company
        company_b = self.env['res.company'].create({'name': 'WebVue PMO settings B'})
        self.admin.write({'company_ids': [(4, company_b.id)]})
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('webvue_pmo.project_creators', 'employees')
        params.set_param(
            'webvue_pmo.default_stages',
            json.dumps([{'name': 'Legacy', 'fold': True}], ensure_ascii=False),
        )
        legacy_before = self._legacy_raw()
        stage_ids_before = self.project.type_ids.ids
        version_a = company_a.webvue_access_policy_version
        version_b = company_b.webvue_access_policy_version

        settings_a = Settings.with_user(self.admin).with_company(company_a)
        settings_b = Settings.with_user(self.admin).with_company(company_b)
        self.assertEqual(settings_a.get()['project_creators'], 'employees')
        self.assertEqual(settings_a.get()['default_stages'], [{'name': 'Legacy', 'fold': True}])
        self.assertEqual(settings_b.get(), settings_a.get())
        self.assertFalse(company_a.webvue_pmo_settings_initialized)
        self.assertFalse(company_b.webvue_pmo_settings_initialized)

        out = settings_a.set_values({'project_creators': 'managers'})
        company_a.invalidate_recordset([
            'webvue_pmo_settings_initialized', 'webvue_pmo_project_creators',
            'webvue_pmo_default_stages', 'webvue_access_policy_version',
        ])
        company_b.invalidate_recordset([
            'webvue_pmo_settings_initialized', 'webvue_access_policy_version',
        ])
        self.assertEqual(out['project_creators'], 'managers')
        self.assertEqual(out['default_stages'], [{'name': 'Legacy', 'fold': True}])
        self.assertTrue(company_a.webvue_pmo_settings_initialized)
        self.assertFalse(company_b.webvue_pmo_settings_initialized)
        self.assertEqual(
            settings_b.get(),
            {
                'project_creators': 'employees',
                'default_stages': [{'name': 'Legacy', 'fold': True}],
                'require_manager_on_create': True,
                'require_end_date_on_create': True,
                'default_completion_approval': 'none',
                'deadline_reminders_enabled': True,
                'deadline_reminders_days_before': 1,
                'overdue_digest_enabled': True,
                'require_charter_approval': False,
            },
        )
        self.assertEqual(self._legacy_raw(), legacy_before)
        self.assertGreater(company_a.webvue_access_policy_version, version_a)
        self.assertEqual(company_b.webvue_access_policy_version, version_b)

        bumped = company_a.webvue_access_policy_version
        repeat = settings_a.set_values({'project_creators': 'managers'})
        company_a.invalidate_recordset(['webvue_access_policy_version'])
        self.assertEqual(repeat, out)
        self.assertEqual(company_a.webvue_access_policy_version, bumped)
        self.assertEqual(self._legacy_raw(), legacy_before)
        self.assertEqual(self.project.type_ids.ids, stage_ids_before)

    def test_direct_orm_and_foreign_company_writes_are_blocked(self):
        stage_ids_before = self.project.type_ids.ids
        company_b = self.env['res.company'].create({'name': 'WebVue PMO settings foreign'})
        self.admin.write({'company_ids': [(4, company_b.id)]})
        payload = {
            'webvue_pmo_settings_initialized': True,
            'webvue_pmo_project_creators': 'employees',
            'webvue_pmo_default_stages': json.dumps(
                [{'name': 'X', 'fold': False}], ensure_ascii=False,
            ),
        }
        with self.assertRaisesRegex(AccessError, 'use_protected_webvue_access_operation'):
            self.env.company.write(payload)
        with self.assertRaisesRegex(AccessError, 'use_protected_webvue_access_operation'):
            self.env.company.with_context(
                webvue_pmo_settings_company_ids={self.env.company.id},
            ).write(payload)
        with self.assertRaises(AccessError):
            self.env.company.with_user(self.admin).write({
                'webvue_pmo_project_creators': 'employees',
            })
        with self.assertRaises(AccessError):
            company_b.with_user(self.admin).with_company(self.env.company)._webvue_write_pmo_settings(
                payload,
            )
        self.assertFalse(company_b.webvue_pmo_settings_initialized)
        self.assertFalse(self.env.company.webvue_pmo_settings_initialized)
        self.assertEqual(self.project.type_ids.ids, stage_ids_before)
