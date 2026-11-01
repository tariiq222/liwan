# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import LiwanHrCase
from odoo.addons.liwan_hr.models.hr_department import DEPARTMENT_SCOPE_ERROR
from odoo.addons.liwan_hr.serializers.hr_department import (
    dump_department,
    dump_departments,
)

DEPT_KEYS = {'id', 'name', 'parent_id', 'manager', 'child_ids', 'employee_count'}


@tagged('post_install', '-at_install', 'liwan')
class TestHrDepartments(LiwanHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='hr_dept_admin', password='hr_dept_admin_pass_123',
            name='Dept Admin', groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('liwan_hr.role_hr_manager').id,
            'company_id': cls.env.company.id,
        }])
        cls.dept_a = cls.env['hr.department'].create({'name': 'Engineering'})
        cls.dept_b = cls.env['hr.department'].create({'name': 'Finance'})
        cls.hr_emp = cls.env['hr.employee'].search([('user_id', '=', cls.employee.id)], limit=1)
        if not cls.hr_emp:
            cls.hr_emp = cls.env['hr.employee'].create({
                'name': cls.employee.name, 'user_id': cls.employee.id,
            })
        cls.dept_a.write({'manager_id': cls.hr_emp.id})
        cls.dept_child = cls.env['hr.department'].create({
            'name': 'QA', 'parent_id': cls.dept_a.id,
        })

    def test_employee_can_list_and_get(self):
        self.env['hr.employee'].create({'name': 'Counted Employee', 'department_id': self.dept_a.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/departments')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn('items', body)
        self.assertGreaterEqual(body['total'], 3)
        ids = {d['id'] for d in body['items']}
        self.assertIn(self.dept_a.id, ids)
        item = next(d for d in body['items'] if d['id'] == self.dept_a.id)
        self.assertEqual(set(item), DEPT_KEYS)
        self.assertEqual(item['name'], 'Engineering')
        self.assertIsNone(item['parent_id'])
        self.assertEqual(item['manager'], {'id': self.hr_emp.id, 'name': self.hr_emp.name})
        self.assertIn(self.dept_child.id, item['child_ids'])
        self.assertEqual(item['employee_count'], 1)
        detail = self.api('GET', f'/api/v1/hr/departments/{self.dept_child.id}').json()
        self.assertEqual(detail['parent_id'], self.dept_a.id)
        self.assertEqual(set(detail), DEPT_KEYS)

    def test_department_pagination_keeps_server_total(self):
        expected_total = self.env['hr.department'].search_count([
            ('company_id', '=', self.env.company.id),
        ]) + 3
        for index in range(3):
            self.env['hr.department'].create({'name': f'Pagination Department {index}'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/hr/departments?limit=1&offset=1').json()
        self.assertEqual(len(body['items']), 1)
        self.assertEqual(body['total'], expected_total)

    def test_employee_count_includes_archived_employee(self):
        self.env['hr.employee'].create({
            'name': 'Active Department Employee', 'department_id': self.dept_a.id,
        })
        archived = self.env['hr.employee'].create({
            'name': 'Archived Department Employee', 'department_id': self.dept_a.id,
            'active': False,
        })
        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        body = self.api('GET', f'/api/v1/hr/departments/{self.dept_a.id}').json()
        self.assertEqual(body['employee_count'], 2)
        self.assertFalse(archived.active)

    def test_employee_write_is_403(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/hr/departments', {'name': 'Legal'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')
        res = self.api('PATCH', f'/api/v1/hr/departments/{self.dept_a.id}', {'name': 'Eng 2'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')
        res = self.api('DELETE', '/api/v1/hr/departments/999999')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))

    def test_admin_create_and_patch(self):
        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        res = self.api('POST', '/api/v1/hr/departments', {
            'name': 'Legal', 'parent_id': self.dept_a.id, 'manager_id': self.hr_emp.id,
        })
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(set(body), DEPT_KEYS)
        self.assertEqual(body['name'], 'Legal')
        self.assertEqual(body['parent_id'], self.dept_a.id)
        self.assertEqual(body['manager']['id'], self.hr_emp.id)
        res = self.api('PATCH', f'/api/v1/hr/departments/{body["id"]}', {'name': 'Legal Affairs'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['name'], 'Legal Affairs')

    def test_a_parent_or_manager_of_another_company_is_a_422_on_its_field(self):
        other = self.env['res.company'].create({'name': 'Link Foreign Co'})
        foreign_dept = self.env['hr.department'].create({'name': 'Foreign Parent', 'company_id': other.id})
        foreign_employee = self.env['hr.employee'].create({'name': 'Foreign Head', 'company_id': other.id})
        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        for field, value in (('parent_id', foreign_dept.id), ('manager_id', foreign_employee.id), ('parent_id', 999999)):
            created = self.api('POST', '/api/v1/hr/departments', {'name': 'Cross link', field: value})
            self.assertEqual((created.status_code, created.json()['code'], created.json()['field']), (422, 'invalid', field), (field, value))
            patched = self.api('PATCH', f'/api/v1/hr/departments/{self.dept_a.id}', {field: value})
            self.assertEqual((patched.status_code, patched.json()['field']), (422, field), (field, value))

    def test_patch_parent_cycle_rolls_back(self):
        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        res = self.api(
            'PATCH', f'/api/v1/hr/departments/{self.dept_a.id}',
            {'parent_id': self.dept_child.id},
        )
        self.assertEqual((res.status_code, res.json()['code']), (422, 'invalid'))
        self.dept_a.invalidate_recordset(['parent_id'])
        self.assertFalse(self.dept_a.parent_id)

    def test_get_unknown_is_404(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/departments/999999')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')

    def test_create_empty_name_is_422(self):
        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        res = self.api('POST', '/api/v1/hr/departments', {'name': '   '})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'name')

        res = self.api('POST', '/api/v1/hr/departments', {})
        self.assertEqual(res.status_code, 422)
        self.assertEqual((res.json()['code'], res.json()['field']), ('invalid', 'name'))

    def test_relation_ids_reject_booleans_and_zero(self):
        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        for payload, field in (
            ({'name': 'Boolean Parent', 'parent_id': True}, 'parent_id'),
            ({'name': 'Float Parent', 'parent_id': 1.9}, 'parent_id'),
            ({'name': 'Zero Manager', 'manager_id': 0}, 'manager_id'),
        ):
            res = self.api('POST', '/api/v1/hr/departments', payload)
            self.assertEqual(res.status_code, 422, (payload, res.text))
            self.assertEqual((res.json()['code'], res.json()['field']), ('invalid', field))

    def test_delete_empty_department_returns_204(self):
        empty = self.env['hr.department'].create({'name': 'Delete Empty'})
        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        res = self.api('DELETE', f'/api/v1/hr/departments/{empty.id}')
        self.assertEqual(res.status_code, 204, res.text)
        self.assertFalse(empty.exists())

    def test_delete_reports_each_blocking_reference_including_archived_employee(self):
        employee_department = self.env['hr.department'].create({'name': 'Employee Blocked'})
        self.env['hr.employee'].create({
            'name': 'Archived Blocker',
            'department_id': employee_department.id,
            'active': False,
        })
        child_department = self.env['hr.department'].create({'name': 'Child Blocked'})
        self.env['hr.department'].create({'name': 'Blocking Child', 'parent_id': child_department.id})

        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        cases = (
            (employee_department, {'employees': 1, 'children': 0, 'documents': 0}),
            (child_department, {'employees': 0, 'children': 1, 'documents': 0}),
        )
        for department, details in cases:
            res = self.api('DELETE', f'/api/v1/hr/departments/{department.id}')
            self.assertEqual(res.status_code, 422, (department.name, res.text))
            self.assertEqual(res.json()['code'], 'department_in_use')
            self.assertEqual({key: res.json()['details'][key] for key in ('employees', 'children')},
                             {key: details[key] for key in ('employees', 'children')})
            self.assertTrue(department.exists())

    def test_batch_dump_matches_singleton_for_all_fields(self):
        self.env['hr.employee'].create({
            'name': 'Batch Counted Employee', 'department_id': self.dept_a.id,
        })
        departments = self.dept_a | self.dept_b | self.dept_child
        batched = dump_departments(departments)
        singles = [dump_department(department) for department in departments]
        self.assertEqual(batched, singles)
        self.assertEqual(len(batched), 3)
        for item in batched:
            self.assertEqual(set(item), DEPT_KEYS)
        engineering = next(item for item in batched if item['id'] == self.dept_a.id)
        self.assertEqual(engineering['name'], 'Engineering')
        self.assertIsNone(engineering['parent_id'])
        self.assertEqual(engineering['manager'], {'id': self.hr_emp.id, 'name': self.hr_emp.name})
        self.assertEqual(engineering['child_ids'], [self.dept_child.id])
        self.assertEqual(engineering['employee_count'], 1)
        qa = next(item for item in batched if item['id'] == self.dept_child.id)
        self.assertEqual(qa['parent_id'], self.dept_a.id)
        self.assertEqual(dump_departments(self.env['hr.department']), [])

    def test_batch_serialization_hides_foreign_company(self):
        other = self.env['res.company'].create({'name': 'Foreign HR Co'})
        foreign_dept = self.env['hr.department'].create({
            'name': 'Foreign Engineering', 'company_id': other.id,
        })
        foreign_child = self.env['hr.department'].create({
            'name': 'Foreign Child', 'company_id': other.id, 'parent_id': foreign_dept.id,
        })
        self.env['hr.employee'].create({
            'name': 'Foreign Employee',
            'company_id': other.id,
            'department_id': foreign_dept.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/hr/departments?limit=200').json()
        ids = {item['id'] for item in body['items']}
        self.assertNotIn(foreign_dept.id, ids)
        self.assertNotIn(foreign_child.id, ids)
        for item in body['items']:
            self.assertEqual(set(item), DEPT_KEYS)
            self.assertNotIn(foreign_dept.id, item['child_ids'])
            self.assertNotIn(foreign_child.id, item['child_ids'])
            self.assertNotEqual(item['parent_id'], foreign_dept.id)
            self.assertNotEqual(item['parent_id'], foreign_child.id)
        local = self.dept_a | self.dept_b | self.dept_child
        payload = local._liwan_serialized_relations_map()
        for refs in payload.values():
            self.assertNotIn(foreign_dept.id, refs['child_ids'])
            self.assertNotIn(foreign_child.id, refs['child_ids'])
            self.assertNotEqual(refs['parent_id'], foreign_dept.id)
        mixed = local | foreign_dept
        with self.assertRaises(AccessError) as error:
            mixed._liwan_serialized_relations_map()
        self.assertIn(DEPARTMENT_SCOPE_ERROR, str(error.exception))

    def test_employee_count_excludes_archived_without_archive_capability(self):
        self.env['hr.employee'].create({
            'name': 'Active Finance Employee', 'department_id': self.dept_b.id,
        })
        archived = self.env['hr.employee'].create({
            'name': 'Archived Finance Employee',
            'department_id': self.dept_b.id,
            'active': False,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/hr/departments/{self.dept_b.id}').json()
        self.assertEqual(body['employee_count'], 1)
        self.assertFalse(archived.active)

    def test_child_ids_include_archived_department(self):
        archived_child = self.env['hr.department'].create({
            'name': 'Archived QA', 'parent_id': self.dept_a.id, 'active': False,
        })
        refs = self.dept_a._liwan_serialized_relations()
        self.assertIn(self.dept_child.id, refs['child_ids'])
        self.assertIn(archived_child.id, refs['child_ids'])
        self.assertLess(
            refs['child_ids'].index(self.dept_child.id),
            refs['child_ids'].index(archived_child.id),
        )

    def test_batch_relation_query_count_does_not_grow_with_recordset(self):
        extras = self.env['hr.department'].create([
            {'name': f'Batch Dept {index}'} for index in range(6)
        ])
        small = self.dept_a | self.dept_b
        large = small | self.dept_child | extras
        self.env.flush_all()

        def relation_query_count(recordset):
            counted = []
            real_execute = recordset.env.cr.execute

            def wrapped(query, params=None, log_exceptions=True):
                sql = query.code if hasattr(query, 'code') else str(query)
                if (
                    'LEFT JOIN hr_employee manager ON manager.id = department.manager_id' in sql
                    or ('parent_id = ANY' in sql and 'FROM hr_department' in sql)
                    or 'version.id = employee.current_version_id' in sql
                ):
                    counted.append(sql)
                return real_execute(query, params, log_exceptions)

            with patch.object(recordset.env.cr, 'execute', wrapped):
                recordset._liwan_serialized_relations_map()
            return len(counted)

        # Source-derived bound (not a runtime profiler measurement):
        # before: 3 relation queries per department; after: 3 per recordset.
        small_count = relation_query_count(small)
        large_count = relation_query_count(large)
        self.assertEqual(small_count, 3)
        self.assertEqual(large_count, small_count)
