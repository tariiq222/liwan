# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Recruitment serializers and hiring retain the selected branch's authority."""
from odoo.tests import tagged

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
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.iso_user, [
            {'company_id': company.id, 'role_id': role.id}
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

    def _hire_grants(self, *, inherited=False):
        manager = self.env.ref('webvue_hr.role_hr_manager')
        assignments = [{'company_id': self.company_p.id, 'role_id': manager.id}]
        if inherited:
            self.company_p.webvue_branch_access_mode = 'inherited'
            self.env['webvue.access.branch.rule'].create({
                'company_id': self.company_p.id, 'branch_id': self.company_p1.id,
                'inherit': True, 'role_ids': [(6, 0, manager.ids)],
            })
        else:
            assignments.append({'company_id': self.company_p1.id, 'role_id': manager.id})
        self.env['webvue.access.service']._webvue_replace_assignments(self.iso_user, assignments)

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
