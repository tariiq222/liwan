# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('liwan', '-at_install', 'post_install')
class TestEmployeeModel(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.access_admin = new_test_user(
            cls.env, login='model_access_admin', password='model_access_admin_pass',
            groups='liwan_core.group_access_admin', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.service = cls.env['liwan.access.service']
        cls.hr_manager = new_test_user(
            cls.env, login='model_hr_manager', password='model_hr_manager_pass',
            groups='liwan_core.group_employee', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.service._liwan_replace_assignments(cls.hr_manager, [{
            'role_id': cls.env.ref('liwan_hr.role_hr_manager').id,
            'company_id': cls.company.id,
        }])
        cls.employee_user = new_test_user(
            cls.env, login='model_hr_employee', password='model_hr_employee_pass',
            groups='liwan_core.group_employee', company_id=cls.company.id,
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
            employee.with_user(self.employee_user)._liwan_write({'name': 'Nope'})
        self.assertEqual(employee.name, 'Model Employee')

    def test_legacy_account_writers_are_not_model_api(self):
        employee = self._employee()
        self.assertFalse(hasattr(employee, '_liwan_grant_access'))
        self.assertFalse(hasattr(employee, '_liwan_update_access'))
        self.assertFalse(hasattr(employee, '_liwan_revoke_access'))

    def test_access_admin_cannot_generic_write_employee(self):
        employee = self._employee()
        with self.assertRaises(AccessError):
            employee.with_user(self.access_admin).write({'active': False})

    def test_only_an_employee_resource_activity_is_reserved_to_the_hr_actions(self):
        employee = self._employee()
        with self.assertRaises(AccessError):
            employee.resource_id.with_user(self.hr_manager).write({'active': False})
        room = self.env['resource.resource'].create({'name': 'Model room', 'resource_type': 'material'})
        room.with_user(self.hr_manager).write({'active': False})
        self.assertFalse(room.active)

    def test_an_hr_writer_keeps_write_on_resources_when_another_group_rule_narrows_them(self):
        # Group rules join with OR only across groups that have one: a narrowing rule of another group the
        # HR writer also holds must not take employee resources away from HR.
        narrowed = self.env['res.groups'].create({'name': 'Material resources only'})
        self.env['ir.rule'].create({
            'name': 'material only', 'model_id': self.env.ref('resource.model_resource_resource').id,
            'groups': [(4, narrowed.id)], 'domain_force': "[('resource_type', '=', 'material')]", 'perm_read': False,
        })
        self.hr_manager.group_ids |= narrowed
        employee = self._employee()
        employee.resource_id.with_user(self.hr_manager).write({'name': 'Renamed resource'})
        self.assertEqual(employee.resource_id.name, 'Renamed resource')

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
            foreign.with_env(env_a)._liwan_archive()
        with self.assertRaises(AccessError):
            foreign_department.with_env(env_a).write({'name': 'Department takeover'})
        with self.assertRaises(AccessError):
            foreign_version.with_env(env_a).write({'job_title': 'Version takeover'})

        env_b = self.env(
            user=self.hr_manager,
            context={'allowed_company_ids': [other_company.id, self.company.id]},
        )
        self.assertFalse(env_b['liwan.access.service']._liwan_has_capability(
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
