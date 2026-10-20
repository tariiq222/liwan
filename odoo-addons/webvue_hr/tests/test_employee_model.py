# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('webvue', '-at_install', 'post_install')
class TestEmployeeModel(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.access_admin = new_test_user(
            cls.env, login='model_access_admin', password='model_access_admin_pass',
            groups='webvue_core.group_access_admin', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.service = cls.env['webvue.access.service']
        cls.hr_manager = new_test_user(
            cls.env, login='model_hr_manager', password='model_hr_manager_pass',
            groups='webvue_core.group_employee', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.service._webvue_replace_assignments(cls.hr_manager, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': cls.company.id,
        }])
        cls.employee_user = new_test_user(
            cls.env, login='model_hr_employee', password='model_hr_employee_pass',
            groups='webvue_core.group_employee', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.department = cls.env['hr.department'].create({'name': 'Model HR'})

    def _employee(self, name='Model Employee', email='model.employee@example.com'):
        return self.env['hr.employee'].create({
            'name': name,
            'company_id': self.company.id,
            'department_id': self.department.id,
            'work_email': email,
        })

    def test_non_manager_is_forbidden_before_mutation(self):
        employee = self._employee()
        with self.assertRaises(AccessError):
            employee.with_user(self.employee_user)._webvue_write({'name': 'Nope'})
        self.assertEqual(employee.name, 'Model Employee')

    def test_legacy_account_writers_are_not_model_api(self):
        employee = self._employee()
        self.assertFalse(hasattr(employee, '_webvue_grant_access'))
        self.assertFalse(hasattr(employee, '_webvue_update_access'))
        self.assertFalse(hasattr(employee, '_webvue_revoke_access'))

    def test_access_admin_cannot_generic_write_employee(self):
        employee = self._employee()
        with self.assertRaises(AccessError):
            employee.with_user(self.access_admin).write({'active': False})

    def test_current_company_capability_cannot_read_or_mutate_an_enabled_company(self):
        other_company = self.env['res.company'].create({'name': 'HR scope company B'})
        self.hr_manager.write({
            'company_ids': [(6, 0, [self.company.id, other_company.id])],
        })
        foreign = self.env['hr.employee'].create({
            'name': 'Foreign scoped employee', 'company_id': other_company.id,
        })
        foreign_department = self.env['hr.department'].create({
            'name': 'Foreign scoped department', 'company_id': other_company.id,
        })
        foreign_version = foreign.current_version_id
        env_a = self.env(
            user=self.hr_manager,
            context={'allowed_company_ids': [self.company.id, other_company.id]},
        )
        self.assertNotIn(foreign, env_a['hr.employee'].search([]))
        self.assertNotIn(foreign_department, env_a['hr.department'].search([]))
        self.assertNotIn(foreign_version, env_a['hr.version'].search([]))
        with self.assertRaises(AccessError):
            foreign.with_env(env_a).write({'name': 'Cross-company takeover'})
        with self.assertRaises(AccessError):
            foreign.with_env(env_a)._webvue_archive()
        with self.assertRaises(AccessError):
            foreign_department.with_env(env_a).write({'name': 'Department takeover'})
        with self.assertRaises(AccessError):
            foreign_version.with_env(env_a).write({'job_title': 'Version takeover'})

        env_b = self.env(
            user=self.hr_manager,
            context={'allowed_company_ids': [other_company.id, self.company.id]},
        )
        self.assertFalse(env_b['webvue.access.service']._webvue_has_capability(
            self.hr_manager.with_env(env_b), 'hr.employees.read',
        ))
        with self.assertRaises(AccessError):
            env_b['hr.employee'].search([])
        with self.assertRaises(AccessError):
            env_b['hr.department'].search([])
        with self.assertRaises(AccessError):
            env_b['hr.version'].search([])
        with self.assertRaises(AccessError):
            self.env['hr.version'].with_user(self.employee_user).search([])
