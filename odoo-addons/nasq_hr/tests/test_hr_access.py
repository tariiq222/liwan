# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import NasqHrCase


@tagged('post_install', '-at_install', 'nasq')
class TestHrAccessSeparation(NasqHrCase):
    def test_registers_its_terminology_keys(self):
        owned = frozenset({
            'nav.organization',
            'nav.employees',
            'nav.departments',
            'nav.documents',
            'hr.directory.title',
            'hr.depts.title',
            'hr.docs.title',
        })
        registered = self.env['nasq.entitlement.service']._nasq_terminology_keys()
        self.assertLessEqual(owned, registered)

    """HR owns employee records; account mutations stay behind core access."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.department = cls.env['hr.department'].create({'name': 'HR Separation'})
        cls.hr_manager = new_test_user(
            cls.env,
            login='separation_hr_manager',
            password='separation_hr_manager_pass_123',
            name='HR Manager Without Access Admin',
            groups='nasq_core.group_employee',
        )
        cls._assign_role(cls.hr_manager, 'hr_manager')

    @classmethod
    def _assign_role(cls, user, key):
        role = cls.env.ref(f'nasq_hr.role_{key}', raise_if_not_found=False)
        if not role:
            raise AssertionError(f'fixture role {key!r} must be installed')
        cls.env['nasq.access.service']._nasq_replace_assignments(
            user, [{'role_id': role.id, 'company_id': cls.company.id}],
        )

    def _employee(self, name='Separation Employee', email='separation.employee@example.com'):
        return self.env['hr.employee'].create({
            'name': name,
            'work_email': email,
            'department_id': self.department.id,
            'company_id': self.company.id,
        })

    def test_hr_manager_can_manage_hr_without_access_admin(self):
        employee = self._employee()
        self.assertFalse(self.hr_manager.has_group('nasq_core.group_customer_admin'))
        self.authenticate('separation_hr_manager', 'separation_hr_manager_pass_123')

        result = self.api('GET', '/api/v1/hr/employees')
        self.assertEqual(result.status_code, 200)
        self.assertIn('items', result.json())
        self.assertIn('total', result.json())

        result = self.api('POST', '/api/v1/hr/employees', {
            'name': 'Created By HR Manager',
            'work_email': 'created.by.hr@example.com',
            'department_id': self.department.id,
        })
        self.assertEqual(result.status_code, 201)
        created_id = result.json()['id']

        result = self.api('PATCH', f'/api/v1/hr/employees/{created_id}', {'job_title': 'Coordinator'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['job_title'], 'Coordinator')

        result = self.api('POST', f'/api/v1/hr/employees/{created_id}/archive', {})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()['active'])
        self.assertNotEqual(employee.id, created_id)

        # HR capability does not imply the system account-management surface.
        result = self.api('GET', '/api/v1/admin/users')
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_access_status_is_hidden_without_the_hr_access_status_capability(self):
        linked_user = new_test_user(
            self.env,
            login='status_visibility_user',
            password='status_visibility_pass_123',
            name='Status Visibility User',
            groups='nasq_core.group_employee',
        )
        employee = self._employee(email='status.visibility@example.com')
        employee.write({'user_id': linked_user.id})

        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', f'/api/v1/hr/employees/{employee.id}')
        self.assertEqual(result.status_code, 200)
        self.assertIsNone(result.json()['access'])

        self.authenticate('separation_hr_manager', 'separation_hr_manager_pass_123')
        result = self.api('GET', f'/api/v1/hr/employees/{employee.id}')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['access']['user_id'], linked_user.id)
        self.assertEqual(result.json()['access']['active'], linked_user.active)

    def test_archive_delegates_linked_user_disable_to_the_core_hook_atomically(self):
        linked_user = new_test_user(
            self.env,
            login='atomic_archive_user',
            password='atomic_archive_pass_123',
            name='Atomic Archive User',
            groups='nasq_core.group_employee',
        )
        employee = self._employee(email='atomic.archive@example.com')
        employee.write({'user_id': linked_user.id})
        self.authenticate('separation_hr_manager', 'separation_hr_manager_pass_123')

        result = self.api('POST', f'/api/v1/hr/employees/{employee.id}/archive', {})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()['active'])
        employee.invalidate_recordset(['active', 'user_id'])
        linked_user.invalidate_recordset(['active'])
        self.assertFalse(employee.active)
        self.assertFalse(linked_user.active)

        audit = self.env['nasq.access.audit'].search(
            [('action', '=', 'employee.archived_access_disabled')],
            order='id desc',
            limit=1,
        )
        self.assertTrue(audit)

    def test_archive_self_vendor_and_last_access_admin_guards_are_core_errors(self):
        own_employee = self._employee(
            name='HR Manager Employee', email='separation_hr_manager@example.com',
        )
        own_employee.write({'user_id': self.hr_manager.id})
        self.authenticate('separation_hr_manager', 'separation_hr_manager_pass_123')
        result = self.api('POST', f'/api/v1/hr/employees/{own_employee.id}/archive', {})
        self.assertEqual((result.status_code, result.json()['code']), (422, 'self_access_change'))

        vendor = new_test_user(
            self.env,
            login='separation_vendor',
            password='separation_vendor_pass_123',
            name='Protected Vendor',
            groups='nasq_core.group_vendor_support',
        )
        vendor_employee = self._employee(name='Vendor Employee', email='vendor.employee@example.com')
        vendor_employee.write({'user_id': vendor.id})
        result = self.api('POST', f'/api/v1/hr/employees/{vendor_employee.id}/archive', {})
        self.assertEqual((result.status_code, result.json()['code']), (403, 'protected_user'))

        isolated_company = self.env['res.company'].create({
            'name': 'Isolated HR last-admin company',
        })
        isolated_hr_manager = new_test_user(
            self.env,
            login='isolated_hr_manager',
            password='isolated_hr_manager_pass_123',
            name='Isolated HR Manager',
            groups='nasq_core.group_employee',
            company_id=isolated_company.id,
        )
        hr_role = self.env.ref('nasq_hr.role_hr_manager')
        self.env['nasq.access.service']._nasq_replace_assignments(
            isolated_hr_manager, [{
                'role_id': hr_role.id,
                'company_id': isolated_company.id,
            }],
        )
        access_admin = new_test_user(
            self.env,
            login='isolated_last_access_admin',
            password='last_access_admin_pass_123',
            name='Last Access Admin',
            groups='nasq_core.group_employee',
            company_id=isolated_company.id,
        )
        system_role = self.env.ref('nasq_core.role_system_admin')
        self.env['nasq.access.service']._nasq_replace_assignments(
            access_admin, [{
                'role_id': system_role.id,
                'company_id': isolated_company.id,
            }],
        )
        department = self.env['hr.department'].create({
            'name': 'Isolated HR department',
            'company_id': isolated_company.id,
        })
        access_admin_employee = self.env['hr.employee'].create({
            'name': 'Last Access Admin Employee',
            'work_email': 'last.access.admin@example.com',
            'department_id': department.id,
            'company_id': isolated_company.id,
        })
        access_admin_employee.write({'user_id': access_admin.id})
        self.authenticate('isolated_hr_manager', 'isolated_hr_manager_pass_123')
        result = self.api('POST', f'/api/v1/hr/employees/{access_admin_employee.id}/archive', {})
        self.assertEqual((result.status_code, result.json()['code']), (409, 'last_access_admin'))

    def test_restore_keeps_the_linked_login_stopped(self):
        linked_user = new_test_user(
            self.env,
            login='restore_stopped_user',
            password='restore_stopped_pass_123',
            name='Restore Stopped User',
            groups='nasq_core.group_employee',
        )
        employee = self._employee(email='restore.stopped@example.com')
        employee.write({'user_id': linked_user.id})
        self.authenticate('separation_hr_manager', 'separation_hr_manager_pass_123')

        result = self.api('POST', f'/api/v1/hr/employees/{employee.id}/archive', {})
        self.assertEqual(result.status_code, 200)
        result = self.api('POST', f'/api/v1/hr/employees/{employee.id}/unarchive', {})
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()['active'])
        self.assertFalse(result.json()['access']['active'])
        linked_user.invalidate_recordset(['active'])
        self.assertFalse(linked_user.active)

    def test_legacy_hr_access_writes_are_removed_and_do_not_mutate_accounts(self):
        employee = self._employee(email='legacy.route@example.com')
        self.authenticate('separation_hr_manager', 'separation_hr_manager_pass_123')
        for method, body in (
            ('POST', {'password': 'legacy pass', 'role': 'employee'}),
            ('PATCH', {'role': 'employee'}),
            ('DELETE', None),
        ):
            result = self.api(method, f'/api/v1/hr/employees/{employee.id}/access', body)
            self.assertEqual(result.status_code, 404, (method, result.status_code, result.text))
        employee.invalidate_recordset(['user_id'])
        self.assertFalse(employee.user_id)
