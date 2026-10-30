# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_hr.rules import LiwanHrRule


@tagged('liwan', '-at_install', 'post_install')
class TestDepartmentModel(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.admin = new_test_user(
            cls.env, login='model_dept_admin', password='model_dept_admin_pass',
            groups='liwan_core.group_employee', company_id=cls.company.id,
            company_ids=[cls.company.id],
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('liwan_hr.role_hr_manager').id,
            'company_id': cls.company.id,
        }])

    def test_usage_counts_archived_employees_children_and_documents(self):
        department = self.env['hr.department'].create({'name': 'Usage Department'})
        child = self.env['hr.department'].create({'name': 'Child', 'parent_id': department.id})
        self.env['hr.employee'].create({'name': 'Active', 'department_id': department.id})
        archived = self.env['hr.employee'].create({'name': 'Archived', 'department_id': department.id})
        archived.write({'active': False})
        self.assertEqual({key: department._liwan_usage()[key] for key in ('employees', 'children')}, {'employees': 2, 'children': 1})
        self.assertEqual({key: child._liwan_usage()[key] for key in ('employees', 'children')}, {'employees': 0, 'children': 0})

    def test_delete_reports_all_references_and_deletes_when_empty(self):
        department = self.env['hr.department'].create({'name': 'In Use'})
        self.env['hr.department'].create({'name': 'Child', 'parent_id': department.id})
        self.env['hr.employee'].create({'name': 'Worker', 'department_id': department.id})
        with self.assertRaises(LiwanHrRule) as error:
            department.with_user(self.admin)._liwan_delete()
        self.assertEqual(error.exception.code, 'department_in_use')
        self.assertEqual({key: error.exception.details[key] for key in ('employees', 'children')}, {'employees': 1, 'children': 1})

        empty = self.env['hr.department'].create({'name': 'Empty'})
        empty.with_user(self.admin)._liwan_delete()
        self.assertFalse(empty.exists())

    def test_parent_cycle_is_rejected(self):
        parent = self.env['hr.department'].create({'name': 'Parent'})
        child = self.env['hr.department'].create({'name': 'Child', 'parent_id': parent.id})
        with self.assertRaises(UserError):
            parent.with_user(self.admin)._liwan_write({'parent_id': child.id})
        parent.invalidate_recordset(['parent_id'])
        self.assertFalse(parent.parent_id)
