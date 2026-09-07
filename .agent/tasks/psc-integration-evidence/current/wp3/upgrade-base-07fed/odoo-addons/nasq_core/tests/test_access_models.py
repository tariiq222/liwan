# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

CAPABILITIES = {
    'access.users.read', 'access.users.grant', 'access.users.assign_roles',
    'access.users.disable', 'access.users.reset_password', 'access.roles.read',
    'access.roles.manage', 'access.audit.read', 'hr.employees.read',
    'hr.employees.manage', 'hr.employees.archive',
    'hr.employees.access_status.read', 'hr.departments.read',
    'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage',
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve', 'settings.branding.manage',
}


@tagged('nasq', 'nasq_access')
class TestNasqAccessModels(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.service = cls.env['nasq.access.service']
        cls.employee = new_test_user(
            cls.env, login='access_models_employee', groups='nasq_core.group_employee',
        )

    def test_catalog_and_built_in_role_boundaries(self):
        permissions = self.env['nasq.access.permission'].search([])
        self.assertEqual(set(permissions.mapped('key')), CAPABILITIES)
        self.assertEqual(len(permissions), 25)

        roles = self.env['nasq.access.role'].search([('type', '=', 'built_in')])
        by_key = {role.key: set(role.permission_ids.mapped('key')) for role in roles}
        self.assertEqual(set(by_key), {
            'employee', 'pmo_manager', 'hr_manager', 'system_admin', 'vendor_support',
        })
        self.assertIn('access.users.assign_roles', by_key['system_admin'])
        self.assertNotIn('hr.employees.manage', by_key['system_admin'])
        self.assertNotIn('pmo.projects.manage', by_key['system_admin'])
        self.assertIn('hr.employees.manage', by_key['hr_manager'])
        self.assertNotIn('access.users.assign_roles', by_key['hr_manager'])
        self.assertIn('pmo.projects.manage', by_key['pmo_manager'])
        self.assertEqual(by_key['vendor_support'], CAPABILITIES)

    def test_custom_role_rejects_access_changing_permissions_and_dependencies(self):
        forbidden = self.env['nasq.access.permission'].search([
            ('key', '=', 'access.users.assign_roles'),
        ])
        with self.assertRaisesRegex(ValidationError, 'custom_role_permission_forbidden'):
            self.env['nasq.access.role'].create({
                'name_ar': 'ممنوع', 'type': 'custom',
                'permission_ids': [(6, 0, forbidden.ids)],
            })

        manage = self.env['nasq.access.permission'].search([
            ('key', '=', 'hr.employees.manage'),
        ])
        with self.assertRaisesRegex(ValidationError, 'missing_dependency'):
            self.env['nasq.access.role'].create({
                'name_ar': 'ناقص', 'type': 'custom',
                'permission_ids': [(6, 0, manage.ids)],
            })

    def test_assignments_are_additive_company_scoped_and_disabled_role_stays_effective(self):
        hr_role = self.env.ref('nasq_core.role_hr_manager')
        pmo_role = self.env.ref('nasq_core.role_pmo_manager')
        self.service._nasq_replace_assignments(
            self.employee,
            [{'role_id': hr_role.id, 'company_id': self.company.id},
             {'role_id': pmo_role.id, 'company_id': self.company.id}],
        )
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'hr.employees.manage',
        ))
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'pmo.projects.manage',
        ))

        hr_role.write({'active': False})
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'hr.employees.manage',
        ))
        employee_role = self.env.ref('nasq_core.role_employee')
        self.service._nasq_replace_assignments(
            self.employee,
            [{'role_id': hr_role.id, 'company_id': self.company.id},
             {'role_id': pmo_role.id, 'company_id': self.company.id},
             {'role_id': employee_role.id, 'company_id': self.company.id}],
        )
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'hr.employees.manage',
        ))
        newcomer = new_test_user(
            self.env, login='access_models_newcomer', groups='base.group_user',
        )
        with self.assertRaisesRegex(ValidationError, 'role_disabled'):
            self.service._nasq_replace_assignments(
                newcomer,
                [{'role_id': hr_role.id, 'company_id': self.company.id}],
            )

        with self.assertRaisesRegex(ValidationError, 'unsupported_scope'):
            self.service._nasq_replace_assignments(
                self.employee,
                [{'role_id': pmo_role.id, 'company_id': self.company.id,
                  'scope_kind': 'project', 'scope_id': 1}],
            )

    def test_generic_sensitive_user_write_is_rejected(self):
        admin = new_test_user(
            self.env, login='access_models_admin', groups='nasq_core.group_access_admin',
        )
        with self.assertRaises(AccessError):
            self.employee.with_user(admin).write({'active': False})
        with self.assertRaises(AccessError):
            self.employee.with_user(admin).write({
                'group_ids': [(4, self.env.ref('base.group_system').id)],
            })

    def test_generic_role_mutations_are_rejected_for_access_admin(self):
        admin = new_test_user(
            self.env, login='access_models_role_admin', groups='nasq_core.group_access_admin',
        )
        Role = self.env['nasq.access.role'].with_user(admin)
        with self.assertRaises(AccessError):
            Role.create({
                'name_ar': 'تجاوز', 'type': 'built_in', 'protected': False,
                'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([]).ids)],
            })
        custom = self.env['nasq.access.role'].create({
            'name_ar': 'دور محمي', 'company_id': self.company.id,
        })
        with self.assertRaises(AccessError):
            custom.with_user(admin).write({'protected': True})
        with self.assertRaises(AccessError):
            custom.with_user(admin).unlink()

    def test_audit_rejects_sensitive_values_and_is_immutable(self):
        with self.assertRaisesRegex(ValidationError, 'sensitive_audit_key'):
            self.env['nasq.access.audit']._nasq_log(
                action='user.password_reset', target=self.employee,
                after={'password': 'never'},
            )
        event = self.env['nasq.access.audit']._nasq_log(
            action='user.password_reset', target=self.employee,
            after={'sessions_revoked': True},
        )
        with self.assertRaises(AccessError):
            event.with_user(self.employee).write({'reason': 'rewrite'})
