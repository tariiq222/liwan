# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_hr.rules import WebVueHrRule
from odoo.addons.webvue_hr.tests.common import make_archivable


@tagged('webvue', '-at_install', 'post_install')
class TestEmployeeAccountModel(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env.ref('webvue_platform.tenant_profile')._webvue_initialize_legacy_policy(
            cls.env['webvue.feature.registry']._webvue_installed_module_ids(),
        )
        cls.company = cls.env.company
        cls.access_admin = new_test_user(
            cls.env, login='bridge_access_admin', password='bridge_access_admin_pass',
            groups='webvue_core.group_access_admin', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.service = cls.env['webvue.access.service']
        cls.hr_manager = new_test_user(
            cls.env, login='bridge_hr_manager', password='bridge_hr_manager_pass',
            groups='webvue_core.group_employee', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.service._webvue_replace_assignments(cls.hr_manager, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': cls.company.id,
        }])
        cls.admin_service = cls.service.with_user(cls.access_admin)
        cls.employee_user = new_test_user(
            cls.env, login='bridge_hr_employee', password='bridge_hr_employee_pass',
            groups='webvue_core.group_employee', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.department = cls.env['hr.department'].create({'name': 'Bridge HR'})
        cls.assignments = [{
            'role_id': cls.env.ref('webvue_core.role_employee').id,
            'company_id': cls.company.id,
        }]

    def _employee(self, name='Bridge Employee', email='bridge.employee@example.com'):
        return self.env['hr.employee'].create({
            'name': name,
            'company_id': self.company.id,
            'department_id': self.department.id,
            'work_email': email,
        })

    def _linked_user(self, login):
        return new_test_user(
            self.env, login=login, password=f'{login}_pass',
            groups='webvue_core.group_employee', company_id=self.company.id,
            company_ids=[self.company.id],
        )

    def test_account_hooks_are_narrow_and_company_scoped(self):
        employee = self._employee(email='  Person@Example.COM ')
        candidate = self.admin_service._webvue_employee_account_candidates(
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
            self.admin_service._webvue_employee_account_candidates(
                {'q': 'Person'}, limit=10, offset=0,
            )['total'],
            1,
        )
        with self.assertRaises(WebVueAccessRule) as error:
            self.admin_service._webvue_grant_employee_account(
                foreign.id, 'foreign_pass_123', self.assignments,
            )
        self.assertEqual(error.exception.code, 'not_found')
        self.assertEqual(error.exception.status, 404)

    def test_grant_links_the_same_company_employee_and_normalizes_the_login(self):
        employee = self._employee(email='  Person@Example.COM ')
        user = self.admin_service._webvue_grant_employee_account(
            employee.id, 'person_pass_123', self.assignments,
        )
        employee.invalidate_recordset(['user_id'])
        self.assertEqual(user.login, 'person@example.com')
        self.assertEqual(employee.user_id, user)
        self.assertEqual(employee.resource_id.user_id, user)
        self.assertEqual(
            self.admin_service._webvue_account_extra_fields([user.id])[user.id]['employee']['id'],
            employee.id,
        )

    def test_grant_is_forbidden_without_the_grant_capability(self):
        employee = self._employee()
        with self.assertRaises(AccessError):
            self.service.with_user(self.employee_user)._webvue_grant_employee_account(
                employee.id, 'person_pass_123', self.assignments,
            )
        employee.invalidate_recordset(['user_id'])
        self.assertFalse(employee.user_id)

    def test_archive_disables_linked_user_and_restore_keeps_login_stopped(self):
        employee = self._employee()
        user = self._linked_user('archive_model_employee')
        employee.write({'user_id': user.id})
        make_archivable(self.env, employee)
        employee.with_user(self.hr_manager)._webvue_archive()
        employee.invalidate_recordset(['active'])
        user.invalidate_recordset(['active'])
        self.assertFalse(employee.active)
        self.assertFalse(user.active)
        self.assertTrue(self.env['webvue.access.audit'].search_count([
            ('action', '=', 'employee.archived_access_disabled'),
            ('target_id', '=', user.id),
        ]))
        employee.with_user(self.hr_manager)._webvue_unarchive()
        employee.invalidate_recordset(['active'])
        user.invalidate_recordset(['active'])
        self.assertTrue(employee.active)
        self.assertFalse(user.active)

    def test_archive_of_an_already_disabled_account_writes_no_second_audit_event(self):
        employee = self._employee()
        user = self._linked_user('archive_model_disabled_employee')
        employee.write({'user_id': user.id})
        make_archivable(self.env, employee)
        user.write({'active': False})
        audit = self.env['webvue.access.audit']
        domain = [('action', '=', 'employee.archived_access_disabled'), ('target_id', '=', user.id)]
        before = audit.search_count(domain)
        employee.with_user(self.hr_manager)._webvue_archive()
        employee.invalidate_recordset(['active'])
        self.assertFalse(employee.active)
        self.assertEqual(audit.search_count(domain), before)

    def test_archive_refuses_to_disable_the_acting_account(self):
        employee = self._employee()
        employee.write({'user_id': self.hr_manager.id})
        make_archivable(self.env, employee)
        with self.assertRaises(WebVueAccessRule) as error:
            employee.with_user(self.hr_manager)._webvue_archive()
        self.assertEqual(error.exception.code, 'self_access_change')
        employee.invalidate_recordset(['active'])
        self.assertTrue(employee.active)

    def test_archive_refuses_a_vendor_protected_linked_account(self):
        employee = self._employee()
        vendor = new_test_user(
            self.env, login='archive_model_vendor', password='archive_model_vendor_pass',
            groups='webvue_core.group_vendor_support', company_id=self.company.id,
            company_ids=[self.company.id],
        )
        employee.write({'user_id': vendor.id})
        make_archivable(self.env, employee)
        with self.assertRaises(WebVueAccessRule) as error:
            employee.with_user(self.hr_manager)._webvue_archive()
        self.assertEqual((error.exception.code, error.exception.status), ('protected_user', 403))
        employee.invalidate_recordset(['active'])
        vendor.invalidate_recordset(['active'])
        self.assertTrue(employee.active)
        self.assertTrue(vendor.active)

    def test_archive_refuses_to_disable_the_last_access_admin(self):
        employee = self._employee()
        employee.write({'user_id': self.access_admin.id})
        make_archivable(self.env, employee)
        others = self.env['res.users'].search([
            ('company_id', '=', self.company.id), ('id', 'not in', (self.access_admin | self.hr_manager).ids),
        ]).filtered(lambda user: self.service._webvue_has_capability(user, 'access.users.assign_roles'))
        others.write({'active': False})
        with self.assertRaises(WebVueAccessRule) as error:
            employee.with_user(self.hr_manager)._webvue_archive()
        self.assertEqual((error.exception.code, error.exception.status), ('last_access_admin', 409))
        employee.invalidate_recordset(['active'])
        self.access_admin.invalidate_recordset(['active'])
        self.assertTrue(employee.active)
        self.assertTrue(self.access_admin.active)

    def test_candidates_need_the_grant_capability(self):
        with self.assertRaises(AccessError):
            self.service.with_user(self.employee_user)._webvue_employee_account_candidates(
                {}, limit=10, offset=0,
            )

    def test_candidate_work_email_is_normalized_or_none(self):
        self._employee(name='Mail Normal', email='  Mail.Normal@Example.COM ')
        self._employee(name='Mail Broken', email='not an email')
        items = {
            item['name']: item['work_email']
            for item in self.admin_service._webvue_employee_account_candidates(
                {'q': 'Mail '}, limit=10, offset=0,
            )['items']
        }
        self.assertEqual(items, {'Mail Normal': 'mail.normal@example.com', 'Mail Broken': None})

    def test_link_is_limited_to_the_current_company(self):
        other_company = self.env['res.company'].create({'name': 'Other Link Company'})
        foreign = self.env['hr.employee'].create({
            'name': 'Foreign Link', 'company_id': other_company.id,
        })
        with self.assertRaises(WebVueAccessRule) as error:
            self.service._webvue_link_employee(foreign.id, self.employee_user.id)
        self.assertEqual((error.exception.code, error.exception.status), ('not_found', 404))
        foreign.invalidate_recordset(['user_id'])
        self.assertFalse(foreign.user_id)
        self.assertFalse(foreign.resource_id.user_id)

    def test_hr_manager_cannot_link_account_through_generic_orm(self):
        with self.assertRaises(WebVueHrRule):
            self.env['hr.employee'].with_user(self.hr_manager).create({
                'name': 'Generic Linked Employee', 'user_id': self.employee_user.id,
            })
        employee = self._employee()
        with self.assertRaises(WebVueHrRule):
            employee.with_user(self.hr_manager).write({'user_id': self.employee_user.id})
        with self.assertRaises(AccessError):
            employee.resource_id.with_user(self.hr_manager).write({'user_id': self.employee_user.id})
        with self.assertRaises(AccessError):
            employee.resource_id.with_user(self.hr_manager).write({'active': False})
