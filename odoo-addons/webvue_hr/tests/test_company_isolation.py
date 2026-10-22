# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the HR pillar's GET record routes.

Phase 1 of the isolation work: the matrix is written to the target contract —
the current company and its branches see the record, every other company gets
the route's byte-identical not-found answer under every company forgery — and
the leak cases MUST fail on current main, before the pin in api_handler lands.
"""
from odoo.tests import tagged

from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    cover_isolation_routes,
)

# (current company tag, tags visible through the pinned set, tags that must stay hidden)
MATRIX = (
    ('p', ('p', 'p1', 'p2'), ('c',)),
    ('p1', ('p1',), ('p', 'p2', 'c')),
)

# The GET record routes of the pillar and the fixture key each path reads.
RECORD_ROUTES = {
    'employee': '/api/v1/hr/employees/{}',
    'department': '/api/v1/hr/departments/{}',
    'leave': '/api/v1/hr/leave/requests/{}',
    'job': '/api/v1/hr/recruitment/jobs/{}',
    'applicant': '/api/v1/hr/recruitment/applicants/{}',
    'departure': '/api/v1/hr/offboarding/departures/{}',
    'onboarding_plan': '/api/v1/hr/onboarding/plans/{}',
    'offboarding_plan': '/api/v1/hr/offboarding/plans/{}',
    'onboarding_run': '/api/v1/hr/onboarding/runs/{}',
    'offboarding_run': '/api/v1/hr/offboarding/runs/{}',
    'payroll_run': '/api/v1/hr/payroll/runs/{}',
    'equipment': '/api/v1/hr/assets/equipment/{}',
}

# The lists the pillar serves, with the fixture key whose id must be the only one.
LISTS = (
    ('/api/v1/hr/employees', 'employee'),
    ('/api/v1/hr/departments', 'department'),
    ('/api/v1/hr/leave/requests', 'leave'),
    ('/api/v1/hr/recruitment/jobs', 'job'),
    ('/api/v1/hr/recruitment/applicants', 'applicant'),
    ('/api/v1/hr/onboarding/runs', 'onboarding_run'),
    ('/api/v1/hr/offboarding/runs', 'offboarding_run'),
    ('/api/v1/hr/payroll/runs', 'payroll_run'),
    ('/api/v1/hr/assets/equipment', 'equipment'),
)


@tagged('post_install', '-at_install', 'webvue')
class TestHrCompanyIsolation(CompanyIsolationCase):
    """The company matrix over every HR GET record route."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        # The matrix needs every area's read capability, not just the employee
        # basics the shared fixture grants: the HR manager and payroll manager
        # roles are added on top of the employee role, in every company, so a
        # visibility difference can only come from the pinned request company.
        Assignment = cls.env['webvue.access.assignment'].sudo()
        for company in cls.by_tag.values():
            for xmlid in ('webvue_hr.role_hr_manager', 'webvue_hr.role_payroll_manager'):
                Assignment.create({
                    'user_id': cls.iso_user.id, 'role_id': cls.env.ref(xmlid).id, 'company_id': company.id,
                })
        cls.recs = {}
        for tag, company in cls.by_tag.items():
            employee = cls.env['hr.employee'].create({
                'name': f'Isolation Employee {tag.upper()}', 'job_title': 'Staff', 'company_id': company.id,
            })
            employee.write({'departure_date': '2026-03-01'})
            job = cls.env['hr.job'].create({'name': f'Isolation Job {tag.upper()}', 'company_id': company.id})
            # The leave type belongs to the employee's company: a type of another
            # company is not readable for that leave.
            leave_type = cls.env['hr.leave.type'].create({
                'name': f'Isolation Leave {tag.upper()}', 'requires_allocation': False, 'company_id': company.id,
            })
            onboarding_plan = cls.env['mail.activity.plan'].create({
                'name': f'Onboarding {tag.upper()}', 'res_model': 'hr.employee',
                'hr_purpose': 'onboarding', 'company_id': company.id,
            })
            offboarding_plan = cls.env['mail.activity.plan'].create({
                'name': f'Offboarding {tag.upper()}', 'res_model': 'hr.employee',
                'hr_purpose': 'offboarding', 'company_id': company.id,
            })
            cls.recs[tag] = {
                'employee': employee,
                # The departure register is keyed by the employee id itself.
                'departure': employee,
                'department': cls.env['hr.department'].create(
                    {'name': f'Isolation Dept {tag.upper()}', 'company_id': company.id},
                ),
                'leave': cls.env['hr.leave'].create({
                    'employee_id': employee.id, 'holiday_status_id': leave_type.id,
                    'request_date_from': '2026-05-04', 'request_date_to': '2026-05-05',
                }),
                'job': job,
                'applicant': cls.env['hr.applicant'].create({
                    'partner_name': f'Applicant {tag.upper()}', 'job_id': job.id, 'company_id': company.id,
                }),
                'onboarding_plan': onboarding_plan,
                'offboarding_plan': offboarding_plan,
                'onboarding_run': cls.env['webvue.hr.plan.run'].create({
                    'employee_id': employee.id, 'plan_id': onboarding_plan.id, 'plan_date': '2026-04-01',
                }),
                'offboarding_run': cls.env['webvue.hr.plan.run'].create({
                    'employee_id': employee.id, 'plan_id': offboarding_plan.id, 'plan_date': '2026-03-15',
                }),
                'payroll_run': cls.env['hr.payslip.run'].create({
                    'name': f'Payroll {tag.upper()}', 'date_start': '2026-04-01', 'date_end': '2026-04-30',
                    'company_id': company.id,
                }),
                'equipment': cls.env['maintenance.equipment'].create(
                    {'name': f'Laptop {tag.upper()}', 'company_id': company.id},
                ),
            }

    def assert_hidden_every_way(self, path, hidden_id):
        """404 on the plain call and every company forgery.

        The HR not-found bodies name the requested model and id, so they are
        pinned by status and code instead of byte identity: the wording depends
        only on the caller's own id, which proves nothing about a record's
        existence.
        """
        for response in self.api_forged('GET', path, hidden_id):
            self.assertEqual(response.status_code, 404, f'{path} must stay hidden: {response.text[:200]}')
            self.assertEqual(response.json()['code'], 'not_found', path)

    def assert_matrix(self, kind):
        """current=P sees P/P1/P2 and hides C; current=P1 sees only P1."""
        template = RECORD_ROUTES[kind]
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for tag in visible:
                self.assertVisible(template.format(self.recs[tag][kind].id))
            for tag in hidden:
                record = self.recs[tag][kind]
                self.assert_hidden_every_way(template.format(record.id), record.id)

    # --- the record matrix, one test per GET record route ------------------------------------------

    def test_employee_record_is_company_scoped(self):
        self.assert_matrix('employee')

    def test_department_record_is_company_scoped(self):
        self.assert_matrix('department')

    def test_leave_request_record_is_company_scoped(self):
        self.assert_matrix('leave')

    def test_recruitment_job_record_is_company_scoped(self):
        self.assert_matrix('job')

    def test_recruitment_applicant_record_is_company_scoped(self):
        self.assert_matrix('applicant')

    def test_departure_record_is_company_scoped(self):
        self.assert_matrix('departure')

    def test_onboarding_plan_record_is_company_scoped(self):
        self.assert_matrix('onboarding_plan')

    def test_offboarding_plan_record_is_company_scoped(self):
        self.assert_matrix('offboarding_plan')

    def test_onboarding_run_record_is_company_scoped(self):
        self.assert_matrix('onboarding_run')

    def test_offboarding_run_record_is_company_scoped(self):
        self.assert_matrix('offboarding_run')

    def test_payroll_run_record_is_company_scoped(self):
        self.assert_matrix('payroll_run')

    def test_payroll_run_payslips_are_company_scoped(self):
        """The run's payslip list answers for the run's company, not the caller's whims."""
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for tag in visible:
                run_id = self.recs[tag]['payroll_run'].id
                self.assertVisible(f'/api/v1/hr/payroll/runs/{run_id}/payslips')
            for tag in hidden:
                run_id = self.recs[tag]['payroll_run'].id
                self.assert_hidden_every_way(f'/api/v1/hr/payroll/runs/{run_id}/payslips', run_id)

    def test_equipment_record_is_company_scoped(self):
        self.assert_matrix('equipment')

    def test_branch_p2_record_matrix(self):
        """current=P2 sees only P2: the sibling branch and the parent stay hidden."""
        self.env_in(self.company_p2)
        self.assertVisible(f'/api/v1/hr/employees/{self.recs["p2"]["employee"].id}')
        for tag in ('p', 'p1', 'c'):
            record = self.recs[tag]['employee']
            self.assert_hidden_every_way(f'/api/v1/hr/employees/{record.id}', record.id)

    # --- writes and lists ---------------------------------------------------------------------------

    def test_employee_write_of_hidden_company_is_404(self):
        """A PATCH naming another company's employee answers not-found and writes nothing."""
        self.env_in(self.company_p1)
        target = self.recs['c']['employee']
        for response in self.api_forged('PATCH', f'/api/v1/hr/employees/{target.id}', target.id,
                                        json={'job_title': 'Forged'}):
            self.assertEqual(response.status_code, 404, response.text[:200])
            self.assertEqual(response.json()['code'], 'not_found')
        # A payload company_id outside the pinned set is a not-found too, before any write.
        response = self.api('PATCH', f'/api/v1/hr/employees/{self.recs["p2"]["employee"].id}',
                            json={'company_id': self.company_c.id})
        self.assertEqual(response.status_code, 404, response.text[:200])
        self.assertEqual(response.json()['code'], 'not_found')
        self.assertEqual(target.job_title, 'Staff')
        self.assertEqual(self.recs['p2']['employee'].company_id.id, self.company_p2.id)

    def test_department_write_of_hidden_company_is_404(self):
        """A PATCH renaming another company's department answers not-found and writes nothing."""
        self.env_in(self.company_p1)
        target = self.recs['c']['department']
        for response in self.api_forged('PATCH', f'/api/v1/hr/departments/{target.id}', target.id,
                                        json={'name': 'Forged'}):
            self.assertEqual(response.status_code, 404, response.text[:200])
            self.assertEqual(response.json()['code'], 'not_found')
        self.assertEqual(target.name, 'Isolation Dept C')

    def test_create_with_foreign_company_id_is_404(self):
        """Creating an employee pinned to company C from a P1 session writes nothing."""
        self.env_in(self.company_p1)
        response = self.api('POST', '/api/v1/hr/employees',
                            json={'name': 'Foreign Employee', 'company_id': self.company_c.id})
        self.assertEqual(response.status_code, 404, response.text[:200])
        self.assertEqual(response.json()['code'], 'not_found')
        self.assertFalse(self.env['hr.employee'].search([('name', '=', 'Foreign Employee')]))

    def test_lists_are_scoped_to_the_current_company(self):
        """From P1 every HR list carries only the P1 records."""
        self.env_in(self.company_p1)
        for path, kind in LISTS:
            body = self.assertVisible(path).json()
            self.assertEqual([item['id'] for item in body['items']], [self.recs['p1'][kind].id], path)

    def test_parent_list_includes_branch_records(self):
        """From P the employee list carries P, P1 and P2, never C."""
        self.env_in(self.company_p)
        body = self.assertVisible('/api/v1/hr/employees').json()
        ids = {item['id'] for item in body['items']}
        self.assertEqual(ids, {self.recs[tag]['employee'].id for tag in ('p', 'p1', 'p2')})


cover_isolation_routes((
    '/api/v1/hr/employees/<int:employee_id>',
    '/api/v1/hr/departments/<int:department_id>',
    '/api/v1/hr/leave/requests/<int:leave_id>',
    '/api/v1/hr/recruitment/jobs/<int:job_id>',
    '/api/v1/hr/recruitment/applicants/<int:applicant_id>',
    '/api/v1/hr/offboarding/departures/<int:employee_id>',
    '/api/v1/hr/onboarding/plans/<int:plan_id>',
    '/api/v1/hr/offboarding/plans/<int:plan_id>',
    '/api/v1/hr/onboarding/runs/<int:run_id>',
    '/api/v1/hr/offboarding/runs/<int:run_id>',
    '/api/v1/hr/payroll/runs/<int:run_id>',
    '/api/v1/hr/payroll/runs/<int:run_id>/payslips',
    '/api/v1/hr/assets/equipment/<int:equipment_id>',
), source='webvue_hr/tests/test_company_isolation.py')
