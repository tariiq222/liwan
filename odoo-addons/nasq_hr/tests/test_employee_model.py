# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from ..rules import NasqHrRule


@tagged('nasq', '-at_install', 'post_install')
class TestEmployeeModel(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.admin = new_test_user(
            cls.env, login='model_hr_admin', password='model_hr_admin_pass',
            groups='nasq_core.group_customer_admin',
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.employee_user = new_test_user(
            cls.env, login='model_hr_employee', password='model_hr_employee_pass',
            groups='nasq_core.group_employee',
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.department = cls.env['hr.department'].create({'name': 'Model HR'})

    def _employee(self, name='Model Employee', email='model.employee@example.com'):
        return self.env['hr.employee'].create({
            'name': name,
            'company_id': self.company.id,
            'department_id': self.department.id,
            'work_email': email,
        })

    def test_non_admin_is_forbidden_before_mutation(self):
        employee = self._employee()
        with self.assertRaises(AccessError):
            employee.with_user(self.employee_user)._nasq_write({'name': 'Nope'})
        self.assertEqual(employee.name, 'Model Employee')

    def test_grant_normalizes_email_and_rejects_invalid_inputs(self):
        employee = self._employee(email='  Person@Example.COM ')
        employee = employee.with_user(self.admin)
        employee._nasq_grant_access('valid pass', 'employee')
        self.assertEqual(employee.user_id.login, 'person@example.com')
        self.assertTrue(employee.user_id.active)
        self.assertTrue(employee.user_id.has_group('nasq_core.group_employee'))

        missing_email = self._employee(name='Missing Email', email=False).with_user(self.admin)
        with self.assertRaises(NasqHrRule) as error:
            missing_email._nasq_grant_access('valid pass', 'employee')
        self.assertEqual(error.exception.code, 'email_required')
        with self.assertRaises(NasqHrRule) as error:
            self._employee(name='Weak Password').with_user(self.admin)._nasq_grant_access('  short ', 'employee')
        self.assertEqual(error.exception.code, 'weak_password')
        with self.assertRaises(NasqHrRule) as error:
            self._employee(name='Bad Role').with_user(self.admin)._nasq_grant_access('valid pass', 'vendor')
        self.assertEqual(error.exception.code, 'invalid_role')

    def test_grant_rejects_duplicate_email_and_archived_employee(self):
        first = self._employee(email='duplicate@example.com').with_user(self.admin)
        first._nasq_grant_access('valid pass', 'employee')
        second = self._employee(name='Second', email=' DUPLICATE@example.com ').with_user(self.admin)
        with self.assertRaises(NasqHrRule) as error:
            second._nasq_grant_access('valid pass', 'employee')
        self.assertEqual(error.exception.code, 'login_taken')

        archived = self._employee(name='Archived').with_user(self.admin)
        archived._nasq_archive()
        with self.assertRaises(NasqHrRule) as error:
            archived._nasq_grant_access('valid pass', 'employee')
        self.assertEqual(error.exception.code, 'employee_archived')

    def test_regrant_reactivates_same_inactive_user(self):
        employee = self._employee().with_user(self.admin)
        employee._nasq_grant_access('valid pass', 'employee')
        user_id = employee.user_id.id
        employee._nasq_revoke_access()
        self.assertFalse(employee.user_id.active)
        employee._nasq_grant_access('valid pass', 'employee')
        self.assertEqual(employee.user_id.id, user_id)
        self.assertTrue(employee.user_id.active)

    def test_role_changes_preserve_unrelated_groups(self):
        employee = self._employee().with_user(self.admin)
        employee._nasq_grant_access('valid pass', 'employee')
        user = employee.user_id
        unrelated = self.env.ref('base.group_allow_export')
        user.write({'group_ids': [(4, unrelated.id)]})
        employee._nasq_update_access(role='admin')
        self.assertTrue(user.has_group('nasq_core.group_customer_admin'))
        self.assertNotIn(self.env.ref('nasq_core.group_employee'), user.group_ids)
        self.assertIn(unrelated, user.group_ids)
        employee._nasq_update_access(role='employee')
        self.assertTrue(user.has_group('nasq_core.group_employee'))
        self.assertFalse(user.has_group('nasq_core.group_customer_admin'))
        self.assertIn(unrelated, user.group_ids)

    def test_password_only_and_noop_access_patches(self):
        employee = self._employee().with_user(self.admin)
        employee._nasq_grant_access('initial pass', 'employee')
        user = employee.user_id
        employee._nasq_update_access()
        employee._nasq_update_access(password='reset pass')
        self.assertTrue(self.env['res.users'].authenticate(
            {'login': user.login, 'password': 'reset pass', 'type': 'password'},
            {'interactive': False},
        ))

    def test_self_vendor_and_role_conflict_guards(self):
        own_employee = self.env['hr.employee'].search([('user_id', '=', self.admin.id)], limit=1)
        if not own_employee:
            own_employee = self._employee(name='Admin Employee')
            own_employee.write({'user_id': self.admin.id})
        with self.assertRaises(NasqHrRule) as error:
            own_employee.with_user(self.admin)._nasq_revoke_access()
        self.assertEqual(error.exception.code, 'self_deactivate')

        vendor = new_test_user(
            self.env, login='model_hr_vendor', password='model_hr_vendor_pass',
            groups='nasq_core.group_vendor_support', company_id=self.company.id,
            company_ids=[self.company.id],
        )
        vendor_employee = self._employee(name='Vendor Employee').with_user(self.admin)
        vendor_employee.write({'user_id': vendor.id})
        with self.assertRaises(NasqHrRule) as error:
            vendor_employee._nasq_update_access(role='admin')
        self.assertEqual(error.exception.code, 'vendor_protected')

    def test_archive_unarchive_and_work_email_do_not_change_login(self):
        employee = self._employee().with_user(self.admin)
        employee._nasq_grant_access('valid pass', 'employee')
        login = employee.user_id.login
        employee._nasq_write({'work_email': 'new-address@example.com'})
        self.assertEqual(employee.user_id.login, login)
        employee._nasq_archive()
        self.assertFalse(employee.active)
        self.assertFalse(employee.user_id.active)
        employee._nasq_unarchive()
        self.assertTrue(employee.active)
        self.assertFalse(employee.user_id.active)

    def test_rejected_multi_record_mutations_are_atomic(self):
        valid = self._employee(email='atomic.valid@example.com').with_user(self.admin)
        invalid = self._employee(name='Atomic Missing', email=False).with_user(self.admin)
        with self.assertRaises(NasqHrRule):
            (valid | invalid)._nasq_grant_access('valid pass', 'employee')
        self.assertFalse(valid.user_id)
        self.assertFalse(invalid.user_id)

        valid._nasq_grant_access('original pass', 'employee')
        vendor = new_test_user(
            self.env, login='model_atomic_vendor', password='model_atomic_vendor_pass',
            groups='nasq_core.group_vendor_support', company_id=self.company.id,
            company_ids=[self.company.id],
        )
        protected = self._employee(name='Atomic Vendor').with_user(self.admin)
        protected.write({'user_id': vendor.id})
        old_hash = valid.user_id.password
        with self.assertRaises(NasqHrRule):
            (valid | protected)._nasq_update_access(password='replacement pass')
        self.assertEqual(valid.user_id.password, old_hash)
        self.assertTrue(valid.user_id.active)
        self.assertTrue(protected.active)

    def test_partner_rights_follow_employee_company_and_do_not_bypass_search(self):
        employee = self._employee(email='rights@example.com')
        partner = employee.work_contact_id
        with self.assertRaises(AccessError):
            self.env['res.partner'].with_user(self.employee_user).create({
                'name': 'Employee Contact', 'company_id': self.company.id,
            })
        with self.assertRaises(AccessError):
            partner.with_user(self.employee_user).write({'name': 'No Write'})

        other_company = self.env['res.company'].create({'name': 'Other Rights Co'})
        foreign_partner = self.env['res.partner'].create({
            'name': 'Foreign Contact', 'company_id': other_company.id,
        })
        with self.assertRaises(AccessError):
            self.env['res.partner'].with_user(self.admin).create({
                'name': 'Foreign Create', 'company_id': other_company.id,
            })
        with self.assertRaises(AccessError):
            foreign_partner.with_user(self.admin).write({'name': 'Foreign Write'})

        # The stock global partner rule admits every internal-user partner,
        # even outside the caller's companies. The nasq customer-admin rule
        # must still reject that write.
        foreign_internal = new_test_user(
            self.env, login='model_foreign_internal', password='model_foreign_internal_pass',
            groups='nasq_core.group_employee', company_id=other_company.id,
            company_ids=[other_company.id],
        )
        with self.assertRaises(AccessError):
            foreign_internal.partner_id.with_user(self.admin).write({'name': 'Foreign Internal Write'})

        # Companyless contacts are also visible through the stock global rule;
        # customer admins may write them only when they are linked to an
        # in-scope user.
        unrelated_shared = self.env['res.partner'].create({
            'name': 'Unrelated Shared Contact', 'company_id': False,
        })
        with self.assertRaises(AccessError):
            unrelated_shared.with_user(self.admin).write({'name': 'Unrelated Shared Write'})
        self.assertFalse(self.env['res.partner'].with_user(self.employee_user).search([
            ('id', '=', foreign_partner.id),
        ]))

        foreign = self.env['hr.employee'].create({
            'name': 'Foreign Employee', 'company_id': other_company.id,
            'work_email': 'foreign.rights@example.com',
        })
        with self.assertRaises(AccessError):
            foreign.with_user(self.admin)._nasq_grant_access('valid pass', 'employee')
        self.assertFalse(foreign.user_id)
