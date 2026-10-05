# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_core.models.access_service import NasqAccessRule
from odoo.addons.nasq_hr.rules import NasqHrRule


@tagged('nasq', '-at_install', 'post_install')
class TestEmployeeModel(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.access_admin = new_test_user(
            cls.env, login='model_access_admin', password='model_access_admin_pass',
            groups='nasq_core.group_access_admin', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.service = cls.env['nasq.access.service']
        cls.hr_manager = new_test_user(
            cls.env, login='model_hr_manager', password='model_hr_manager_pass',
            groups='nasq_core.group_employee', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.service._nasq_replace_assignments(cls.hr_manager, [{
            'role_id': cls.env.ref('nasq_hr.role_hr_manager').id,
            'company_id': cls.company.id,
        }])
        cls.hook_service = cls.env['nasq.access.service'].with_user(cls.access_admin)
        cls.employee_user = new_test_user(
            cls.env, login='model_hr_employee', password='model_hr_employee_pass',
            groups='nasq_core.group_employee', company_id=cls.company.id,
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
            employee.with_user(self.employee_user)._nasq_write({'name': 'Nope'})
        self.assertEqual(employee.name, 'Model Employee')

    def test_account_hooks_are_narrow_and_company_scoped(self):
        employee = self._employee(email='  Person@Example.COM ')
        prepared = self.hook_service._nasq_hr_prepare_account(employee.id, 'grant')
        self.assertEqual(set(prepared), {
            'employee_id', 'company_id', 'name', 'login', 'partner_id',
            'existing_user_id', 'employee_active',
        })
        self.assertEqual(prepared['login'], 'person@example.com')
        self.assertFalse(prepared['existing_user_id'])

        candidate = self.hook_service._nasq_hr_account_candidates(
            {'q': 'Person'}, limit=10, offset=0,
        )
        self.assertEqual(candidate['total'], 1)
        self.assertEqual(set(candidate['items'][0]), {
            'id', 'name', 'department', 'work_email', 'active', 'user_id',
            'access_active',
        })
        self.assertEqual(candidate['items'][0]['id'], employee.id)

        other_company = self.env['res.company'].create({'name': 'Other HR Company'})
        foreign = self.env['hr.employee'].create({
            'name': 'Person Foreign', 'company_id': other_company.id,
            'work_email': 'foreign.person@example.com',
        })
        self.assertEqual(
            self.hook_service._nasq_hr_account_candidates(
                {'q': 'Person'}, limit=10, offset=0,
            )['total'],
            1,
        )
        with self.assertRaises(NasqAccessRule) as error:
            self.hook_service._nasq_hr_prepare_account(foreign.id, 'grant')
        self.assertEqual(error.exception.code, 'not_found')
        self.assertEqual(error.exception.status, 404)

    def test_link_hook_links_same_company_employee(self):
        employee = self._employee()
        user = new_test_user(
            self.env, login='linked_model_employee', password='linked_model_pass',
            groups='nasq_core.group_employee', company_id=self.company.id,
            company_ids=[self.company.id],
        )
        self.hook_service._nasq_hr_link_account(employee.id, user.id)
        employee.invalidate_recordset(['user_id'])
        self.assertEqual(employee.user_id, user)
        self.assertEqual(
            self.hook_service._nasq_hr_employee_refs([user.id])[user.id]['id'],
            employee.id,
        )

    def test_archive_disables_linked_user_and_restore_keeps_login_stopped(self):
        employee = self._employee()
        user = new_test_user(
            self.env, login='archive_model_employee', password='archive_model_pass',
            groups='nasq_core.group_employee', company_id=self.company.id,
            company_ids=[self.company.id],
        )
        employee.write({'user_id': user.id})
        employee.with_user(self.hr_manager)._nasq_archive()
        employee.invalidate_recordset(['active'])
        user.invalidate_recordset(['active'])
        self.assertFalse(employee.active)
        self.assertFalse(user.active)
        employee.with_user(self.hr_manager)._nasq_unarchive()
        employee.invalidate_recordset(['active'])
        user.invalidate_recordset(['active'])
        self.assertTrue(employee.active)
        self.assertFalse(user.active)

    def test_legacy_account_writers_are_not_model_api(self):
        employee = self._employee()
        self.assertFalse(hasattr(employee, '_nasq_grant_access'))
        self.assertFalse(hasattr(employee, '_nasq_update_access'))
        self.assertFalse(hasattr(employee, '_nasq_revoke_access'))

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
        foreign_document = self.env['nasq.hr.document'].create({
            'name': 'Foreign scoped document',
            'company_id': other_company.id,
            'department_id': foreign_department.id,
        })
        foreign_version = foreign.current_version_id
        env_a = self.env(
            user=self.hr_manager,
            context={'allowed_company_ids': [self.company.id, other_company.id]},
        )
        self.assertNotIn(foreign, env_a['hr.employee'].search([]))
        self.assertNotIn(foreign_department, env_a['hr.department'].search([]))
        self.assertNotIn(foreign_document, env_a['nasq.hr.document'].search([]))
        self.assertNotIn(foreign_version, env_a['hr.version'].search([]))
        with self.assertRaises(AccessError):
            foreign.with_env(env_a).write({'name': 'Cross-company takeover'})
        with self.assertRaises(AccessError):
            foreign.with_env(env_a)._nasq_archive()
        with self.assertRaises(AccessError):
            foreign_department.with_env(env_a).write({'name': 'Department takeover'})
        with self.assertRaises(AccessError):
            foreign_document.with_env(env_a).write({'name': 'Document takeover'})
        with self.assertRaises(AccessError):
            foreign_version.with_env(env_a).write({'job_title': 'Version takeover'})

        env_b = self.env(
            user=self.hr_manager,
            context={'allowed_company_ids': [other_company.id, self.company.id]},
        )
        self.assertFalse(env_b['nasq.access.service']._nasq_has_capability(
            self.hr_manager.with_env(env_b), 'hr.employees.read',
        ))
        with self.assertRaises(AccessError):
            env_b['hr.employee'].search([])
        with self.assertRaises(AccessError):
            env_b['hr.department'].search([])
        with self.assertRaises(AccessError):
            env_b['nasq.hr.document'].search([])
        with self.assertRaises(AccessError):
            env_b['hr.version'].search([])
        with self.assertRaises(AccessError):
            self.env['hr.version'].with_user(self.employee_user).search([])

    def test_hr_manager_cannot_link_account_through_generic_orm(self):
        with self.assertRaises(NasqHrRule):
            self.env['hr.employee'].with_user(self.hr_manager).create({
                'name': 'Generic Linked Employee', 'user_id': self.employee_user.id,
            })
        employee = self._employee()
        with self.assertRaises(NasqHrRule):
            employee.with_user(self.hr_manager).write({'user_id': self.employee_user.id})
        with self.assertRaises(AccessError):
            employee.resource_id.with_user(self.hr_manager).write({'user_id': self.employee_user.id})
        with self.assertRaises(AccessError):
            employee.resource_id.with_user(self.hr_manager).write({'active': False})
