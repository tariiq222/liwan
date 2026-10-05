# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestSettings(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='api_admin', password='api_admin_pass_123',
            groups='nasq_pmo.group_pmo_manager',
        )

    def setUp(self):
        super().setUp()
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('nasq_pmo.project_creators', 'managers')
        params.set_param('nasq_pmo.default_stages', False)
        self.env.company._nasq_write_pmo_settings({
            'nasq_pmo_settings_initialized': False,
            'nasq_pmo_project_creators': 'managers',
            'nasq_pmo_default_stages': False,
        })

    def _legacy_raw(self):
        params = self.env['ir.config_parameter'].sudo()
        return (
            params.get_param('nasq_pmo.project_creators'),
            params.get_param('nasq_pmo.default_stages'),
        )

    def test_employee_is_forbidden_and_legacy_pmo_manager_is_allowed(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/settings/projects').status_code, 403)
        self.assertEqual(self.api(
            'PATCH', '/api/v1/settings/projects', {'project_creators': 'employees'},
        ).status_code, 403)

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/settings/projects').status_code, 200)

    def test_get_and_patch(self):
        self.authenticate('api_admin', 'api_admin_pass_123')
        body = self.api('GET', '/api/v1/settings/projects').json()
        self.assertGreaterEqual(set(body), {'project_creators', 'default_stages', 'require_manager_on_create', 'require_end_date_on_create', 'default_completion_approval', 'deadline_reminders_enabled', 'deadline_reminders_days_before', 'overdue_digest_enabled'})
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
        Settings = self.env['nasq.pmo.settings']
        company_a = self.env.company
        company_b = self.env['res.company'].create({'name': 'Nasq PMO settings B'})
        self.admin.write({'company_ids': [(4, company_b.id)]})
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('nasq_pmo.project_creators', 'employees')
        params.set_param(
            'nasq_pmo.default_stages',
            json.dumps([{'name': 'Legacy', 'fold': True}], ensure_ascii=False),
        )
        legacy_before = self._legacy_raw()
        stage_ids_before = self.project.type_ids.ids
        version_a = company_a.nasq_access_policy_version
        version_b = company_b.nasq_access_policy_version

        settings_a = Settings.with_user(self.admin).with_company(company_a)
        settings_b = Settings.with_user(self.admin).with_company(company_b)
        self.assertEqual(settings_a.get()['project_creators'], 'employees')
        self.assertEqual(settings_a.get()['default_stages'], [{'name': 'Legacy', 'fold': True}])
        self.assertEqual(settings_b.get(), settings_a.get())
        self.assertFalse(company_a.nasq_pmo_settings_initialized)
        self.assertFalse(company_b.nasq_pmo_settings_initialized)

        out = settings_a.set_values({'project_creators': 'managers'})
        company_a.invalidate_recordset([
            'nasq_pmo_settings_initialized', 'nasq_pmo_project_creators',
            'nasq_pmo_default_stages', 'nasq_access_policy_version',
        ])
        company_b.invalidate_recordset([
            'nasq_pmo_settings_initialized', 'nasq_access_policy_version',
        ])
        self.assertEqual(out['project_creators'], 'managers')
        self.assertEqual(out['default_stages'], [{'name': 'Legacy', 'fold': True}])
        self.assertTrue(company_a.nasq_pmo_settings_initialized)
        self.assertFalse(company_b.nasq_pmo_settings_initialized)
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
            },
        )
        self.assertEqual(self._legacy_raw(), legacy_before)
        self.assertGreater(company_a.nasq_access_policy_version, version_a)
        self.assertEqual(company_b.nasq_access_policy_version, version_b)

        bumped = company_a.nasq_access_policy_version
        repeat = settings_a.set_values({'project_creators': 'managers'})
        company_a.invalidate_recordset(['nasq_access_policy_version'])
        self.assertEqual(repeat, out)
        self.assertEqual(company_a.nasq_access_policy_version, bumped)
        self.assertEqual(self._legacy_raw(), legacy_before)
        self.assertEqual(self.project.type_ids.ids, stage_ids_before)

    def test_direct_orm_and_foreign_company_writes_are_blocked(self):
        stage_ids_before = self.project.type_ids.ids
        company_b = self.env['res.company'].create({'name': 'Nasq PMO settings foreign'})
        self.admin.write({'company_ids': [(4, company_b.id)]})
        payload = {
            'nasq_pmo_settings_initialized': True,
            'nasq_pmo_project_creators': 'employees',
            'nasq_pmo_default_stages': json.dumps(
                [{'name': 'X', 'fold': False}], ensure_ascii=False,
            ),
        }
        with self.assertRaisesRegex(AccessError, 'use_protected_nasq_access_operation'):
            self.env.company.write(payload)
        with self.assertRaisesRegex(AccessError, 'use_protected_nasq_access_operation'):
            self.env.company.with_context(
                nasq_pmo_settings_company_ids={self.env.company.id},
            ).write(payload)
        with self.assertRaises(AccessError):
            self.env.company.with_user(self.admin).write({
                'nasq_pmo_project_creators': 'employees',
            })
        with self.assertRaises(AccessError):
            company_b.with_user(self.admin).with_company(self.env.company)._nasq_write_pmo_settings(
                payload,
            )
        self.assertFalse(company_b.nasq_pmo_settings_initialized)
        self.assertFalse(self.env.company.nasq_pmo_settings_initialized)
        self.assertEqual(self.project.type_ids.ids, stage_ids_before)
