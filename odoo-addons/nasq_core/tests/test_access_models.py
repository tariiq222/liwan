# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_core.models.access_service import SYSTEM_PERMISSIONS


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

    def _custom_role(self, name, keys):
        return self.env['nasq.access.role'].create({
            'name_ar': name, 'company_id': self.company.id,
            'permission_ids': [Command.set(
                self.env['nasq.access.permission'].search([('key', 'in', keys)]).ids,
            )],
        })

    def test_catalog_matches_the_composed_definitions_and_builtin_grants(self):
        catalog = self.service._nasq_capability_map()
        permissions = self.env['nasq.access.permission'].search([])
        self.assertEqual(set(permissions.mapped('key')), set(catalog))
        self.assertEqual(len(permissions), len(catalog))
        self.assertTrue(set(catalog) >= SYSTEM_PERMISSIONS)

        grants = self.service._nasq_builtin_role_grants()
        self.assertTrue({
            'nasq_core.role_employee', 'nasq_core.role_system_admin', 'nasq_core.role_vendor_support',
        } <= set(grants))
        for role_xmlid, keys in grants.items():
            role = self.env.ref(role_xmlid)
            self.assertEqual((role.type, role.protected), ('built_in', True), role_xmlid)
            self.assertTrue(keys <= set(role.permission_ids.mapped('key')), role_xmlid)
        vendor = self.env.ref('nasq_core.role_vendor_support')
        self.assertEqual(set(vendor.permission_ids.mapped('key')), set(catalog))
        self.assertFalse(vendor.assignable)
        system_admin = self.env.ref('nasq_core.role_system_admin')
        self.assertTrue(set(system_admin.permission_ids.mapped('key')) >= SYSTEM_PERMISSIONS)

    def test_custom_role_rejects_access_changing_permissions_and_dependencies(self):
        forbidden = self.env['nasq.access.permission'].search([
            ('key', '=', 'access.users.assign_roles'),
        ])
        with self.assertRaisesRegex(ValidationError, 'custom_role_permission_forbidden'):
            self.env['nasq.access.role'].create({
                'name_ar': 'ممنوع', 'type': 'custom',
                'permission_ids': [(6, 0, forbidden.ids)],
            })

        Permission = self.env['nasq.access.permission']
        values = {
            'domain': 'settings', 'resource': 'widgets', 'name_ar': 'اختبار',
            'description_ar': 'اختبار', 'group_xmlid': 'nasq_core.group_cap_settings_branding_manage',
        }
        read = Permission.create({**values, 'key': 'test.widgets.read', 'action': 'read'})
        manage = Permission.create({
            **values, 'key': 'test.widgets.manage', 'action': 'manage',
            'dependency_ids': [Command.set(read.ids)],
        })
        with self.assertRaisesRegex(ValidationError, 'missing_dependency'):
            self.env['nasq.access.role'].create({
                'name_ar': 'ناقص', 'type': 'custom',
                'permission_ids': [(6, 0, manage.ids)],
            })

    def test_assignments_are_additive_company_scoped_and_disabled_role_stays_effective(self):
        users_role = self._custom_role('قراءة المستخدمين', ['access.users.read'])
        branding_role = self._custom_role('إدارة الهوية', ['settings.branding.manage'])
        self.service._nasq_replace_assignments(
            self.employee,
            [{'role_id': users_role.id, 'company_id': self.company.id},
             {'role_id': branding_role.id, 'company_id': self.company.id}],
        )
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'access.users.read',
        ))
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'settings.branding.manage',
        ))

        users_role.write({'active': False})
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'access.users.read',
        ))
        employee_role = self.env.ref('nasq_core.role_employee')
        self.service._nasq_replace_assignments(
            self.employee,
            [{'role_id': users_role.id, 'company_id': self.company.id},
             {'role_id': branding_role.id, 'company_id': self.company.id},
             {'role_id': employee_role.id, 'company_id': self.company.id}],
        )
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'access.users.read',
        ))
        newcomer = new_test_user(
            self.env, login='access_models_newcomer', groups='base.group_user',
        )
        with self.assertRaisesRegex(ValidationError, 'role_disabled'):
            self.service._nasq_replace_assignments(
                newcomer,
                [{'role_id': users_role.id, 'company_id': self.company.id}],
            )

        with self.assertRaisesRegex(ValidationError, 'unsupported_scope'):
            self.service._nasq_replace_assignments(
                self.employee,
                [{'role_id': branding_role.id, 'company_id': self.company.id,
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
