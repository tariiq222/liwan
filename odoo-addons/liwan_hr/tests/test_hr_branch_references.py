# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Related HR records keep the selected record's owner in a parent session."""
from datetime import date, timedelta

from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import CompanyIsolationCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestHrBranchReferences(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company_p.country_id = cls.env.ref('base.sa')
        cls.company_p1.country_id = cls.env.ref('base.be')
        cls.manager_assignments = cls.env['liwan.access.assignment'].create([
            {'user_id': cls.iso_user.id, 'company_id': company.id,
             'role_id': cls.env.ref('liwan_hr.role_hr_manager').id}
            for company in (cls.company_p, cls.company_p1)
        ])
        cls.companies = (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c)
        cls.jobs = {}
        cls.employees = {}
        cls.request_types = {}
        cls.allocation_types = {}
        for company in cls.companies:
            cls.jobs[company.id] = cls.env['hr.job'].create({
                'name': f'Reference job {company.name}', 'company_id': company.id,
            })
            cls.employees[company.id] = cls.env['hr.employee'].create({
                'name': f'Reference employee {company.name}', 'company_id': company.id,
            })
            for requires_allocation, destination in (
                (False, cls.request_types), (True, cls.allocation_types),
            ):
                destination[company.id] = cls.env['hr.leave.type'].create({
                    'name': f'Reference leave {company.name} {requires_allocation}',
                    'company_id': company.id, 'requires_allocation': requires_allocation,
                })
        cls.shared_request_type, cls.shared_allocation_type = cls.env['hr.leave.type'].create([
            {'name': 'Shared reference request', 'company_id': False, 'country_id': False,
             'requires_allocation': False},
            {'name': 'Shared reference allocation', 'company_id': False, 'country_id': False,
             'requires_allocation': True},
        ])
        start = date.today() + timedelta(days=28)
        cls.monday = start + timedelta(days=(7 - start.weekday()) % 7)

    def _request_payload(self, leave_type, *, employee=None, offset=0):
        day = (self.monday + timedelta(days=offset)).isoformat()
        return {
            'employee_id': (employee or self.employees[self.company_p1.id]).id,
            'leave_type_id': leave_type.id, 'date_from': day, 'date_to': day,
        }

    def _allocation_payload(self, leave_type, *, employee=None):
        return {
            'employee_id': (employee or self.employees[self.company_p1.id]).id,
            'leave_type_id': leave_type.id, 'number_of_days': 3,
            'date_from': date.today().replace(month=1, day=1).isoformat(),
        }

    def _assert_created_leave(self, response, *, allocation=False, leave_type=None):
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body['employee']['id'], self.employees[self.company_p1.id].id)
        self.assertEqual(body['leave_type']['id'], leave_type.id)
        model = 'hr.leave.allocation' if allocation else 'hr.leave'
        record = self.env[model].browse(body['id'])
        self.assertEqual(record.employee_id.company_id, self.company_p1)
        self.assertEqual(record.holiday_status_id, leave_type)
        if allocation:
            self.assertEqual(record.state, 'validate')
        else:
            self.assertEqual(record.company_id, self.company_p1)

    def test_parent_session_applicant_uses_selected_branch_job_owner(self):
        self.env_in(self.company_p)
        job = self.jobs[self.company_p1.id]
        response = self.api('POST', '/api/v1/hr/recruitment/applicants', json={
            'partner_name': 'Branch applicant', 'job_id': job.id,
        })
        self.assertEqual(response.status_code, 201, response.text)
        applicant = self.env['hr.applicant'].browse(response.json()['id'])
        self.assertEqual(applicant.job_id, job)
        self.assertEqual(applicant.company_id, self.company_p1)
        detail = self.assertVisible(f'/api/v1/hr/recruitment/applicants/{applicant.id}').json()
        self.assertEqual(detail['job']['id'], job.id)

    def test_parent_session_current_company_applicant_keeps_owner(self):
        self.env_in(self.company_p)
        response = self.api('POST', '/api/v1/hr/recruitment/applicants', json={
            'partner_name': 'Parent applicant', 'job_id': self.jobs[self.company_p.id].id,
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.env['hr.applicant'].browse(response.json()['id']).company_id, self.company_p)

    def test_applicant_rejects_member_only_and_foreign_jobs(self):
        self.env_in(self.company_p)
        for company in (self.company_p2, self.company_c):
            with self.subTest(company=company.name):
                response = self.api('POST', '/api/v1/hr/recruitment/applicants', json={
                    'partner_name': 'Denied applicant', 'job_id': self.jobs[company.id].id,
                })
                self.assertEqual((response.status_code, response.json()['field']), (422, 'job_id'))

    def test_applicant_respects_native_job_visibility(self):
        job = self.jobs[self.company_p1.id]
        self.env['ir.rule'].create({
            'name': 'Hide reference branch job', 'model_id': self.env['ir.model']._get_id('hr.job'),
            'domain_force': repr([('id', '!=', job.id)]),
        })
        self.env_in(self.company_p)
        response = self.api('POST', '/api/v1/hr/recruitment/applicants', json={
            'partner_name': 'Private job applicant', 'job_id': job.id,
        })
        self.assertEqual((response.status_code, response.json()['field']), (422, 'job_id'))

    def test_job_patch_accepts_own_branch_department_and_rejects_parent_department(self):
        departments = self.env['hr.department'].create([
            {'name': 'Reference branch department', 'company_id': self.company_p1.id},
            {'name': 'Reference parent department', 'company_id': self.company_p.id},
        ])
        job = self.jobs[self.company_p1.id]
        self.env_in(self.company_p)
        response = self.api('PATCH', f'/api/v1/hr/recruitment/jobs/{job.id}', json={
            'department_id': departments[0].id,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(job.department_id, departments[0])
        response = self.api('PATCH', f'/api/v1/hr/recruitment/jobs/{job.id}', json={
            'department_id': departments[1].id,
        })
        self.assertEqual((response.status_code, response.json().get('field')), (422, 'department_id'), response.text)
        self.assertEqual(job.department_id, departments[0])

    def test_job_create_keeps_current_company_and_rejects_branch_department(self):
        department = self.env['hr.department'].create({
            'name': 'Reference branch create department', 'company_id': self.company_p1.id,
        })
        self.env_in(self.company_p)
        response = self.api('POST', '/api/v1/hr/recruitment/jobs', json={'name': 'Parent reference job'})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.env['hr.job'].browse(response.json()['id']).company_id, self.company_p)
        response = self.api('POST', '/api/v1/hr/recruitment/jobs', json={
            'name': 'Wrong owner reference job', 'department_id': department.id,
        })
        self.assertEqual((response.status_code, response.json().get('field')), (422, 'department_id'), response.text)

    def test_parent_session_request_uses_branch_type_and_country(self):
        leave_type = self.request_types[self.company_p1.id]
        self.assertEqual(leave_type.country_id, self.env.ref('base.be'))
        self.env_in(self.company_p)
        response = self.api('POST', '/api/v1/hr/leave/requests', json=self._request_payload(leave_type))
        self._assert_created_leave(response, leave_type=leave_type)

    def test_parent_session_allocation_uses_branch_type_and_country(self):
        leave_type = self.allocation_types[self.company_p1.id]
        self.env_in(self.company_p)
        response = self.api('POST', '/api/v1/hr/leave/allocations', json=self._allocation_payload(leave_type))
        self._assert_created_leave(response, allocation=True, leave_type=leave_type)

    def test_parent_session_balances_use_selected_employee_company(self):
        leave_type = self.allocation_types[self.company_p1.id]
        self.env['hr.leave.allocation'].create({
            'employee_id': self.employees[self.company_p1.id].id,
            'holiday_status_id': leave_type.id, 'number_of_days': 3,
            'date_from': date.today().replace(month=1, day=1),
        }).action_approve()
        self.env_in(self.company_p)
        response = self.api('GET', f'/api/v1/hr/leave/balances?employee_id={self.employees[self.company_p1.id].id}')
        self.assertEqual(response.status_code, 200, response.text)
        balance = next((item for item in response.json()['items'] if item['leave_type']['id'] == leave_type.id), None)
        self.assertIsNotNone(balance, response.text)
        self.assertEqual(balance['allocated'], 3)
        self.assertEqual(balance['remaining'], 3)

    def test_branch_employee_accepts_shared_leave_types(self):
        self.env_in(self.company_p)
        response = self.api('POST', '/api/v1/hr/leave/requests', json=self._request_payload(self.shared_request_type))
        self._assert_created_leave(response, leave_type=self.shared_request_type)
        response = self.api('POST', '/api/v1/hr/leave/allocations',
                            json=self._allocation_payload(self.shared_allocation_type))
        self._assert_created_leave(response, allocation=True, leave_type=self.shared_allocation_type)

    def test_branch_employee_rejects_wrong_owner_and_foreign_types(self):
        self.env_in(self.company_p)
        for company in (self.company_p, self.company_p2, self.company_c):
            for endpoint, payload in (
                ('requests', self._request_payload(self.request_types[company.id])),
                ('allocations', self._allocation_payload(self.allocation_types[company.id])),
            ):
                with self.subTest(company=company.name, endpoint=endpoint):
                    response = self.api('POST', f'/api/v1/hr/leave/{endpoint}', json=payload)
                    self.assertEqual((response.status_code, response.json().get('field')), (422, 'leave_type_id'),
                                     response.text)

    def test_branch_employee_rejects_native_invisible_types(self):
        types = self.request_types[self.company_p1.id] | self.allocation_types[self.company_p1.id]
        self.env['ir.rule'].create({
            'name': 'Hide reference branch leave types',
            'model_id': self.env['ir.model']._get_id('hr.leave.type'),
            'domain_force': repr([('id', 'not in', types.ids)]),
        })
        self.env_in(self.company_p)
        for endpoint, payload in (
            ('requests', self._request_payload(self.request_types[self.company_p1.id])),
            ('allocations', self._allocation_payload(self.allocation_types[self.company_p1.id])),
        ):
            response = self.api('POST', f'/api/v1/hr/leave/{endpoint}', json=payload)
            self.assertEqual((response.status_code, response.json()['field']), (422, 'leave_type_id'))

    def test_parent_manage_grant_does_not_manage_branch_after_warm_revocation(self):
        self.env_in(self.company_p)
        response = self.api('POST', '/api/v1/hr/leave/requests', json=self._request_payload(self.shared_request_type))
        self._assert_created_leave(response, leave_type=self.shared_request_type)
        response = self.api('POST', '/api/v1/hr/leave/allocations',
                            json=self._allocation_payload(self.shared_allocation_type))
        self._assert_created_leave(response, allocation=True, leave_type=self.shared_allocation_type)
        self.manager_assignments.filtered(lambda assignment: assignment.company_id == self.company_p1).unlink()
        for endpoint, payload in (
            ('requests', self._request_payload(self.shared_request_type, offset=7)),
            ('allocations', self._allocation_payload(self.shared_allocation_type)),
        ):
            response = self.api('POST', f'/api/v1/hr/leave/{endpoint}', json=payload)
            self.assertIn(response.status_code, (403, 422), response.text)
        self.assertEqual(self.env['hr.leave'].search_count([
            ('employee_id', '=', self.employees[self.company_p1.id].id),
        ]), 1)
        self.assertEqual(self.env['hr.leave.allocation'].search_count([
            ('employee_id', '=', self.employees[self.company_p1.id].id),
        ]), 1)
