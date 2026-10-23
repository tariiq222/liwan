# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Recruitment serializers and hiring retain the selected branch's authority."""
from unittest.mock import patch

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import CompanyIsolationCase


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestHrRecruitmentBranchConsumers(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.department = cls.env['hr.department'].create({
            'name': 'Branch recruitment department', 'company_id': cls.company_p1.id,
        })
        cls.job = cls.env['hr.job'].create({
            'name': 'Branch recruitment position', 'company_id': cls.company_p1.id,
            'department_id': cls.department.id,
        })
        cls.linked_employee = cls.env['hr.employee'].create({
            'name': 'Branch recruitment employee', 'company_id': cls.company_p1.id,
        })
        cls.applicant = cls.env['hr.applicant'].create({
            'partner_name': 'Branch recruitment applicant', 'company_id': cls.company_p1.id,
            'job_id': cls.job.id, 'employee_id': cls.linked_employee.id,
        })
        roles = []
        for company, suffix in ((cls.company_p, 'parent'), (cls.company_p1, 'branch')):
            roles.append(cls.env['webvue.access.role'].with_company(company).create({
                'key': f'recruitment_reference_{suffix}', 'type': 'custom',
                'name_ar': f'Recruitment reference {suffix}',
                'permission_ids': [(6, 0, cls.env['webvue.access.permission'].search([
                    ('key', 'in', ['hr.recruitment.read', 'hr.recruitment.manage']),
                ]).ids)],
            }))
        cls.parent_role, cls.branch_role = roles
        assignments = cls.env['webvue.access.assignment']
        assignments.search([('user_id', '=', cls.iso_user.id)]).unlink()
        assignments.create([
            {'user_id': cls.iso_user.id, 'company_id': company.id, 'role_id': role.id}
            for company, role in ((cls.company_p, cls.parent_role), (cls.company_p1, cls.branch_role))
        ])

    def _reference_grants(self, *, parent, branch):
        for role, enabled in ((self.parent_role, parent), (self.branch_role, branch)):
            keys = ['hr.recruitment.read', 'hr.recruitment.manage']
            if enabled:
                keys += ['hr.departments.read', 'hr.employees.read']
            role.permission_ids = [(6, 0, self.env['webvue.access.permission'].search([('key', 'in', keys)]).ids)]

    def test_reference_serialization_uses_branch_grants_for_get_and_post(self):
        for parent, branch in ((True, False), (False, True), (True, True), (False, False)):
            self._reference_grants(parent=parent, branch=branch)
            self.env_in(self.company_p)
            expected_department = {'id': self.department.id, 'name': 'Branch recruitment department'} if branch else None
            expected_employee = {'id': self.linked_employee.id, 'name': 'Branch recruitment employee'} if branch else None
            for path, collection, target_id in (
                (f'/api/v1/hr/recruitment/jobs/{self.job.id}', False, self.job.id),
                ('/api/v1/hr/recruitment/jobs', True, self.job.id),
                (f'/api/v1/hr/recruitment/applicants/{self.applicant.id}', False, self.applicant.id),
                ('/api/v1/hr/recruitment/applicants', True, self.applicant.id),
            ):
                with self.subTest(parent=parent, branch=branch, path=path):
                    response = self.api('GET', path)
                    self.assertEqual(response.status_code, 200, response.text)
                    body = response.json()
                    item = next(item for item in body['items'] if item['id'] == target_id) if collection else body
                    self.assertEqual(item['department'], expected_department)
                    if 'applicants' in path:
                        self.assertEqual(item['employee'], expected_employee)
            with self.subTest(parent=parent, branch=branch, method='POST'):
                response = self.api('POST', '/api/v1/hr/recruitment/applicants', json={
                    'partner_name': f'Branch created applicant {parent} {branch}', 'job_id': self.job.id,
                })
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json()['department'], expected_department)
                created = self.env['hr.applicant'].browse(response.json()['id'])
                self.assertEqual(created.company_id, self.company_p1)

    def _hire_grants(self, *, inherited=False, parent=True):
        manager = self.env.ref('webvue_hr.role_hr_manager')
        assignments = [{'company_id': self.company_p.id, 'role_id': manager.id}] if parent else []
        if inherited:
            self.company_p.webvue_branch_access_mode = 'inherited'
            self.env['webvue.access.branch.rule'].create({
                'company_id': self.company_p.id, 'branch_id': self.company_p1.id,
                'inherit': True, 'role_ids': [(6, 0, manager.ids)],
            })
        else:
            assignments.append({'company_id': self.company_p1.id, 'role_id': manager.id})
        Assignment = self.env['webvue.access.assignment']
        Assignment.search([('user_id', '=', self.iso_user.id)]).unlink()
        Assignment.create([{'user_id': self.iso_user.id, **assignment} for assignment in assignments])

    def _assert_branch_hire(self, *, department):
        job = self.job
        if not department:
            job = self.env['hr.job'].create({
                'name': 'Branch position without department', 'company_id': self.company_p1.id,
            })
        self.env_in(self.company_p)
        created = self.api('POST', '/api/v1/hr/recruitment/applicants', json={
            'partner_name': f'Branch hire {department}', 'job_id': job.id,
        })
        self.assertEqual(created.status_code, 201, created.text)
        response = self.api('POST', f'/api/v1/hr/recruitment/applicants/{created.json()["id"]}/hire', json={})
        self.assertFalse(self.env['hr.employee'].search([
            ('name', '=', f'Branch hire {department}'), ('company_id', '=', self.company_p.id),
        ]), response.text)
        self.assertEqual(response.status_code, 200, response.text)
        employee = self.env['hr.employee'].browse(response.json()['employee']['id'])
        self.assertEqual(employee.company_id, self.company_p1)
        self.assertEqual(employee.job_id, job)
        self.assertEqual(employee.department_id, self.department if department else self.env['hr.department'])
        applicant = self.env['hr.applicant'].browse(created.json()['id'])
        self.assertEqual(applicant.employee_id, employee)
        self.assertEqual(applicant.company_id, self.company_p1)

    def test_parent_session_hire_keeps_branch_owner_without_department(self):
        self._hire_grants()
        self._assert_branch_hire(department=False)

    def test_parent_session_hire_keeps_branch_owner_with_department(self):
        self._hire_grants()
        self._assert_branch_hire(department=True)

    def test_parent_session_hire_preserves_inherited_branch_manager_grants(self):
        self._hire_grants(inherited=True)
        self._assert_branch_hire(department=False)

    def test_parent_session_hire_uses_branch_only_manager_grants(self):
        self._hire_grants(parent=False)
        self._assert_branch_hire(department=False)

    def _hire_applicant(self, name):
        applicant = self.env['hr.applicant'].create({
            'partner_name': name, 'company_id': self.company_p1.id, 'job_id': self.job.id,
        })
        return applicant.with_user(self.iso_user).with_context(
            allowed_company_ids=[self.company_p.id, self.company_p1.id],
            webvue_capability_scope=((('hr.recruitment.manage', 'hr.employees.manage'), 'all'),),
        )

    def test_forged_context_cannot_enable_cross_company_employee_create_or_write(self):
        self._hire_grants(parent=False)
        applicant = self._hire_applicant('Forged hire context')
        employees = applicant.env['hr.employee'].with_context(**{
            'webvue_hr.native_recruitment_hire': [(self.iso_user.id, self.company_p.id, self.company_p1.id, applicant.id)],
            'webvue_hire_company_id': self.company_p1.id,
        })
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            employees.create({'name': 'Forged branch employee', 'company_id': self.company_p1.id})
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            self.linked_employee.with_env(employees.env).write({'job_title': 'Forged branch title'})
        self.assertFalse(self.env['hr.employee'].search([('name', '=', 'Forged branch employee')]))
        self.assertFalse(self.linked_employee.job_title)

    def test_native_hire_failure_rolls_back_contacts_employees_and_restores_scope(self):
        self._hire_grants()
        applicant = self._hire_applicant('Failed native branch hire')
        original = type(applicant).create_employee_from_applicant

        def fail_after_native_create(record):
            original(record)
            message = 'Reject the completed native hire'
            raise ValidationError(message)

        with patch.object(type(applicant), 'create_employee_from_applicant', fail_after_native_create):
            with self.assertRaises(ValidationError):
                applicant._webvue_hire()
        self.assertFalse(self.env['hr.employee'].search([('name', '=', 'Failed native branch hire')]))
        self.assertFalse(self.env['res.partner'].search([('name', '=', 'Failed native branch hire')]))
        self.assertFalse(applicant.employee_id)
        service = applicant.env['webvue.access.service']
        self.assertEqual(set(service._webvue_scoped_company_ids()), {self.company_p.id, self.company_p1.id})
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            applicant.env['hr.employee'].create({'name': 'Leaked hire frame', 'company_id': self.company_p1.id})

    def test_native_hire_rechecks_inherited_grant_revocation(self):
        self._hire_grants(inherited=True)
        applicant = self._hire_applicant('Revoked native branch hire')
        original = type(applicant).create_employee_from_applicant

        def revoke_before_native_create(record):
            rule = self.env['webvue.access.branch.rule'].search([
                ('company_id', '=', self.company_p.id), ('branch_id', '=', self.company_p1.id),
            ])
            rule.inherit = False
            return original(record)

        with patch.object(type(applicant), 'create_employee_from_applicant', revoke_before_native_create):
            with self.assertRaises(AccessError):
                applicant._webvue_hire()
        self.assertFalse(self.env['hr.employee'].search([('name', '=', 'Revoked native branch hire')]))
        self.assertFalse(self.env['res.partner'].search([('name', '=', 'Revoked native branch hire')]))
        self.assertFalse(applicant.employee_id)
        self.assertEqual(set(applicant.env['webvue.access.service']._webvue_scoped_company_ids()),
                         {self.company_p.id, self.company_p1.id})

    def test_nested_native_hires_restore_the_outer_operation(self):
        self._hire_grants(parent=False)
        outer = self._hire_applicant('Outer native branch hire')
        inner = self._hire_applicant('Inner native branch hire')
        original = type(outer).create_employee_from_applicant

        def hire_inner_before_outer(record):
            if record.id == outer.id:
                inner._webvue_hire()
            return original(record)

        with patch.object(type(outer), 'create_employee_from_applicant', hire_inner_before_outer):
            outer._webvue_hire()
        for applicant in (outer, inner):
            self.assertTrue(applicant.employee_id)
            self.assertEqual(applicant.employee_id.company_id, self.company_p1)
        self.assertNotEqual(outer.employee_id, inner.employee_id)
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            outer.env['hr.employee'].create({'name': 'Leaked nested frame', 'company_id': self.company_p1.id})

    def test_full_parent_manager_keeps_ordinary_current_company_create_contract(self):
        self._hire_grants()
        applicant = self._hire_applicant('Ordinary current company creation')
        employees = applicant.env['hr.employee']
        current = employees.create({'name': 'Ordinary parent employee'})
        self.assertEqual(current.company_id, self.company_p)
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            employees.create({'name': 'Outside native hire branch employee', 'company_id': self.company_p1.id})
        self.assertFalse(self.env['hr.employee'].search([('name', '=', 'Outside native hire branch employee')]))

    def test_native_hire_frame_cannot_follow_changed_actor_root_or_owner(self):
        self._hire_grants()
        other = new_test_user(
            self.env, login='other_native_hire_manager', groups='webvue_core.group_employee',
            company_id=self.company_p.id, company_ids=[self.company_p.id, self.company_p1.id],
        )
        self.env['webvue.access.assignment'].create([
            {'user_id': other.id, 'company_id': company.id,
             'role_id': self.env.ref('webvue_hr.role_hr_manager').id}
            for company in (self.company_p, self.company_p1)
        ])
        applicant = self._hire_applicant('Bound native branch hire')
        original = type(applicant).create_employee_from_applicant

        def reject_changed_authority_before_native_create(record):
            for env, company, label in (
                (record.with_user(other).env, self.company_p1, 'actor'),
                (record.with_company(self.company_p2).env, self.company_p1, 'root'),
                (record.env, self.company_p, 'owner'),
            ):
                with self.subTest(authority=label), self.assertRaises(AccessError):
                    env['hr.employee'].create({'name': f'Changed hire {label}', 'company_id': company.id})
            return original(record)

        with patch.object(type(applicant), 'create_employee_from_applicant', reject_changed_authority_before_native_create):
            employee = applicant._webvue_hire()
        self.assertEqual(employee.company_id, self.company_p1)
        self.assertFalse(self.env['hr.employee'].search([('name', 'in', [
            'Changed hire actor', 'Changed hire root', 'Changed hire owner',
        ])]))

    def test_native_hire_cannot_replace_original_operation_scope_after_revocation(self):
        self._hire_grants()
        role = self.env['webvue.access.role'].with_company(self.company_p1).create({
            'key': 'native_hire_employee_only', 'type': 'custom', 'name_ar': 'Employee management only',
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', 'in', ['hr.employees.read', 'hr.employees.manage']),
            ]).ids)],
        })
        applicant = self._hire_applicant('Changed native hire scope')
        original = type(applicant).create_employee_from_applicant

        def revoke_recruitment_and_replace_scope(record):
            assignments = self.env['webvue.access.assignment']
            assignments.search([
                ('user_id', '=', self.iso_user.id), ('company_id', '=', self.company_p1.id),
            ]).unlink()
            assignments.create({'user_id': self.iso_user.id, 'company_id': self.company_p1.id, 'role_id': role.id})
            changed = record.with_context(webvue_capability_scope=((('hr.employees.manage',), 'all'),))
            self.assertEqual(changed.env['webvue.access.service']._webvue_scoped_company_ids(), [])
            return original(changed)

        with patch.object(type(applicant), 'create_employee_from_applicant', revoke_recruitment_and_replace_scope):
            with self.assertRaises(AccessError):
                applicant._webvue_hire()
        self.assertFalse(applicant.employee_id)
        self.assertFalse(self.env['hr.employee'].search([('name', '=', 'Changed native hire scope')]))
        self.assertFalse(self.env['res.partner'].search([('name', '=', 'Changed native hire scope')]))

    def test_failed_nested_native_hire_restores_outer_authority(self):
        self._hire_grants(parent=False)
        outer = self._hire_applicant('Outer hire after inner rollback')
        inner = self._hire_applicant('Inner rolled back hire')
        original = type(outer).create_employee_from_applicant

        def fail_inner_and_continue_outer(record):
            if record.id == inner.id:
                original(record)
                message = 'Reject the inner native hire'
                raise ValidationError(message)
            with self.assertRaises(ValidationError):
                inner._webvue_hire()
            return original(record)

        with patch.object(type(outer), 'create_employee_from_applicant', fail_inner_and_continue_outer):
            employee = outer._webvue_hire()
        self.assertEqual(employee.company_id, self.company_p1)
        self.assertFalse(inner.employee_id)
        self.assertFalse(self.env['hr.employee'].search([('name', '=', 'Inner rolled back hire')]))
        self.assertFalse(self.env['res.partner'].search([('name', '=', 'Inner rolled back hire')]))
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            outer.env['hr.employee'].create({'name': 'Leaked rollback frame', 'company_id': self.company_p1.id})
