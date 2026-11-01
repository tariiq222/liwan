# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the HR pillar's GET record routes.

Phase 1 of the isolation work: the matrix is written to the target contract —
the current company and its branches see the record, every other company gets
the route's byte-identical not-found answer under every company forgery — and
the leak cases MUST fail on current main, before the pin in api_handler lands.
"""
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
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
    'allocation': '/api/v1/hr/leave/allocations/{}',
    # Keyed by the employee id: the compensation record is the employee's own single row.
    'compensated': '/api/v1/hr/payroll/compensation/{}',
    'warning': '/api/v1/hr/warnings/{}',
}

# The shifts and warning-standing routes read only the current company (never its branches or parent), so they have their own matrix.
CURRENT_COMPANY_ROUTES = {
    'schedule': '/api/v1/hr/shifts/schedules/{}',
    'assignment': '/api/v1/hr/shifts/assignments/{}',
    # Keyed by the employee id: the figure counts that employee's warnings in the current company only.
    'standing': '/api/v1/hr/warnings/standing/{}',
    # Insurance is private to the current company: a branch or a parent never reads it.
    'insurance_plan': '/api/v1/hr/insurance/plans/{}',
    'insurance_enrollment': '/api/v1/hr/insurance/enrollments/{}',
}

# Every GET /api/v1 record, export or file route of liwan_hr, counted by the discovery test.
EXPECTED_GET_RECORD_ROUTES = 27

# The lists the pillar serves, with the fixture key whose id must be the only one.
LISTS = (
    ('/api/v1/hr/employees', 'employee'),
    ('/api/v1/hr/departments', 'department'),
    ('/api/v1/hr/leave/requests', 'leave'),
    ('/api/v1/hr/recruitment/jobs', 'job'),
    ('/api/v1/hr/recruitment/applicants', 'applicant'),
    ('/api/v1/hr/onboarding/runs', 'onboarding_run'),
    ('/api/v1/hr/payroll/runs', 'payroll_run'),
    ('/api/v1/hr/assets/equipment', 'equipment'),
)


@tagged('post_install', '-at_install', 'liwan')
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
        Assignment = cls.env['liwan.access.assignment'].sudo()
        for company in cls.by_tag.values():
            for xmlid in ('liwan_hr.role_hr_manager', 'liwan_hr.role_payroll_manager'):
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
            allocation_type = cls.env['hr.leave.type'].create({
                'name': f'Isolation Allocated {tag.upper()}', 'requires_allocation': True, 'company_id': company.id,
            })
            cls.env['liwan.hr.compensation'].create({'employee_id': employee.id, 'basic_wage': 5000})
            schedule = cls.env['resource.calendar'].create({
                'name': f'Isolation Shift {tag.upper()}', 'company_id': company.id, 'tz': 'UTC',
                'attendance_ids': [(0, 0, {
                    'name': '08 - 12', 'dayofweek': '0', 'day_period': 'morning', 'hour_from': 8, 'hour_to': 12,
                })],
            })
            insurance_provider = cls.env['liwan.hr.insurance.provider'].create({
                'company_id': company.id, 'name': f'Isolation Insurer {tag.upper()}',
            })
            insurance_plan = cls.env['liwan.hr.insurance.plan'].create({
                'company_id': company.id, 'provider_id': insurance_provider.id, 'name': f'Isolation Plan {tag.upper()}',
                'valid_from': '2026-01-01', 'valid_to': '2026-12-31',
            })
            cls.recs[tag] = {
                'employee': employee,
                'insurance_plan': insurance_plan,
                'insurance_enrollment': cls.env['liwan.hr.insurance.enrollment'].create({
                    'employee_id': employee.id, 'plan_id': insurance_plan.id, 'date_from': '2026-02-01',
                }),
                'compensated': employee,
                'standing': employee,
                'warning': cls.env['liwan.hr.warning'].create({
                    'employee_id': employee.id, 'reason': 'Isolation', 'state': 'issued',
                    'issued_at': '2026-05-01 08:00:00',
                    'type_id': cls.env['liwan.hr.warning.type'].search([('company_id', '=', company.id)], limit=1).id,
                }),
                'allocation': cls.env['hr.leave.allocation'].create({
                    'employee_id': employee.id, 'holiday_status_id': allocation_type.id,
                    'number_of_days': 5, 'date_from': '2026-01-01',
                }),
                'schedule': schedule,
                'assignment': cls.env['hr.employee.calendar'].create({
                    'employee_id': employee.id, 'calendar_id': schedule.id, 'date_start': '2026-11-01',
                }),
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
                'onboarding_run': cls.env['liwan.hr.plan.run'].create({
                    'employee_id': employee.id, 'plan_id': onboarding_plan.id, 'plan_date': '2026-04-01',
                }),
                'offboarding_run': cls.env['liwan.hr.plan.run'].create({
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

    def test_child_only_read_never_exposes_parent_or_private_records(self):
        assignments = self.env['liwan.access.assignment']
        assignments.search([('user_id', '=', self.iso_user.id)]).unlink()
        permissions = self.env['liwan.access.permission'].search([
            ('key', 'in', ['hr.employees.read', 'hr.departments.read']),
        ])
        role = self.env['liwan.access.role'].with_company(self.company_p1).create({
            'key': 'branch_only_hr_reader', 'type': 'custom', 'company_id': self.company_p1.id,
            'name_ar': 'Branch reader', 'permission_ids': [(6, 0, permissions.ids)],
        })
        assignments.create({'user_id': self.iso_user.id, 'company_id': self.company_p1.id, 'role_id': role.id})
        private = self.env['hr.employee'].create({'name': 'Private branch employee', 'company_id': self.company_p1.id})
        self.env['ir.rule'].create([
            {'name': 'Private branch employee probe', 'model_id': self.env['ir.model']._get_id(model),
             'domain_force': repr([('id', '!=', private.id)])}
            for model in ('hr.employee', 'hr.employee.public')
        ])
        self.env_in(self.company_p)
        for path, kind in (('/api/v1/hr/employees', 'employee'), ('/api/v1/hr/departments', 'department')):
            body = self.assertVisible(path).json()
            self.assertEqual([item['id'] for item in body['items']], [self.recs['p1'][kind].id])
            self.assertVisible(f"{path}/{self.recs['p1'][kind].id}")
            for tag in ('p', 'p2', 'c'):
                self.assert_hidden_every_way(f"{path}/{self.recs[tag][kind].id}", self.by_tag[tag].id)
        self.assert_hidden_every_way(f'/api/v1/hr/employees/{private.id}', self.company_p1.id)
        write = self.api('PATCH', f"/api/v1/hr/employees/{self.recs['p1']['employee'].id}", json={'job_title': 'Denied'})
        self.assertEqual(write.status_code, 403, write.text)
        # A contextual read's current baseline must not turn a child-only role into parent HR access.
        context = {'allowed_company_ids': [self.company_p.id, self.company_p1.id],
                   'liwan_capability_scope': ((('hr.employees.read',), 'all', 'contextual_read'),)}
        records = self.env['hr.employee.public'].with_user(self.iso_user).with_context(**context).search([])
        self.assertIn(self.recs['p1']['employee'].id, records.ids)
        self.assertNotIn(self.recs['p']['employee'].id, records.ids)

    def test_parent_manager_cannot_lend_sensitive_fields_to_branch_reader(self):
        # Keep the employee grant in P1, but its manage/status/version grants belong only to P.
        self.env['liwan.access.assignment'].search([
            ('user_id', '=', self.iso_user.id), ('company_id', '=', self.company_p1.id),
            ('role_id', '!=', self.env.ref('liwan_core.role_employee').id),
        ]).unlink()
        linked = new_test_user(self.env, login='branch_sensitive_employee', groups='liwan_core.group_employee',
                               company_id=self.company_p1.id, company_ids=[self.company_p1.id])
        employee = self.recs['p1']['employee']
        employee.write({'user_id': linked.id, 'contract_date_start': '2026-01-01', 'notice_period_days': 45})
        self.env_in(self.company_p)
        detail = self.assertVisible(f'/api/v1/hr/employees/{employee.id}').json()
        self.assertEqual(detail['id'], employee.id)
        self.assertIsNone(detail['access'])
        self.assertIsNone(detail['contract'])
        rows = self.assertVisible('/api/v1/hr/employees').json()['items']
        row = next(row for row in rows if row['id'] == employee.id)
        self.assertIsNone(row['access'])
        self.assertIsNone(row['contract'])
        own = self.assertVisible(f"/api/v1/hr/employees/{self.recs['p']['employee'].id}").json()
        self.assertIsNotNone(own['contract'])

    def _branch_privacy_role(self, keys):
        assignments = self.env['liwan.access.assignment']
        assignments.search([('user_id', '=', self.iso_user.id), ('company_id', '=', self.company_p1.id)]).unlink()
        permissions = self.env['liwan.access.permission'].search([('key', 'in', keys)])
        role = self.env['liwan.access.role'].with_company(self.company_p1).create({
            'key': 'branch_privacy_reader', 'type': 'custom', 'name_ar': 'Branch reader',
            'permission_ids': [(6, 0, permissions.ids)],
        })
        assignments.create({'user_id': self.iso_user.id, 'company_id': self.company_p1.id, 'role_id': role.id})

    def test_branch_status_read_does_not_borrow_parent_contract_permission(self):
        self._branch_privacy_role(['hr.employees.read', 'hr.employees.access_status.read'])
        linked = new_test_user(self.env, login='branch_status_employee', groups='liwan_core.group_employee',
                               company_id=self.company_p1.id, company_ids=[self.company_p1.id])
        employee = self.recs['p1']['employee']
        employee.write({'user_id': linked.id, 'contract_date_start': '2026-01-01', 'notice_period_days': 45})
        self.env_in(self.company_p)
        detail = self.assertVisible(f'/api/v1/hr/employees/{employee.id}').json()
        self.assertIsNotNone(detail['access'])
        self.assertIsNone(detail['contract'])
        row = next(row for row in self.assertVisible('/api/v1/hr/employees').json()['items'] if row['id'] == employee.id)
        self.assertIsNotNone(row['access'])
        self.assertIsNone(row['contract'])
        version = employee.version_id.with_user(self.iso_user).with_context(
            allowed_company_ids=[self.company_p.id, self.company_p1.id],
            liwan_capability_scope=((('hr.employees.read',), 'all'),),
        )
        with self.assertRaises(AccessError):
            version.read(['notice_period_days', 'contract_date_start'])
        self.company_p.liwan_branch_access_mode = 'inherited'
        inheritance = self.env['liwan.access.branch.rule'].create({
            'company_id': self.company_p.id, 'branch_id': self.company_p1.id, 'inherit': True,
            'role_ids': [(6, 0, [self.env.ref('liwan_hr.role_hr_manager').id])],
        })
        self.assertEqual(version.read(['notice_period_days'])[0]['notice_period_days'], 45)
        inheritance.inherit = False
        with self.assertRaises(AccessError):
            version.read(['notice_period_days'])

    def test_branch_status_native_version_and_attachment_access_requires_version_grant(self):
        self._branch_privacy_role(['hr.employees.read', 'hr.employees.access_status.read'])
        employee = self.recs['p1']['employee']
        attachment = self.env['ir.attachment'].create({
            'name': 'Private branch contract file', 'raw': b'private contract', 'type': 'binary',
            'res_model': 'hr.version', 'res_id': employee.version_id.id,
            'company_id': self.company_p1.id,
        })
        context = {
            'allowed_company_ids': [self.company_p.id, self.company_p1.id],
            'liwan_capability_scope': ((('hr.employees.read',), 'all'),),
        }
        version = employee.version_id.with_user(self.iso_user).with_context(**context)
        file = attachment.with_env(version.env)
        files = version.env['ir.attachment']
        target = [('res_model', '=', 'hr.version'), ('res_id', '=', version.id)]
        for label, check in (
            ('version has_access', lambda: version.has_access('read')),
            ('version filtered_access', lambda: bool(version._filtered_access('read'))),
            ('file has_access', lambda: file.has_access('read')),
            ('file search', lambda: bool(files.search(target))),
            ('file count', lambda: files.search_count(target)),
        ):
            with self.subTest(label=label):
                self.assertFalse(check(), label)
        with self.assertRaises(AccessError):
            file.read(['raw'])

        self.company_p.liwan_branch_access_mode = 'inherited'
        inheritance = self.env['liwan.access.branch.rule'].create({
            'company_id': self.company_p.id, 'branch_id': self.company_p1.id, 'inherit': True,
            'role_ids': [(6, 0, [self.env.ref('liwan_hr.role_hr_manager').id])],
        })
        self.assertTrue(version.has_access('read'))
        self.assertEqual(version._filtered_access('read'), version)
        self.assertTrue(file.has_access('read'))
        self.assertEqual(files.search(target), file)
        self.assertEqual(files.search_count(target), 1)
        inheritance.inherit = False
        self.assertFalse(version.has_access('read'))
        self.assertFalse(version._filtered_access('read'))
        self.assertFalse(file.has_access('read'))
        self.assertFalse(files.search(target))
        self.assertEqual(files.search_count(target), 0)
        # The established payroll/offboarding reader pairs still open versions,
        # but each pair must be held together in the owning branch.
        role = self.env['liwan.access.role'].with_company(self.company_p1).search([
            ('key', '=', 'branch_privacy_reader'),
        ], limit=1)
        for key in ('hr.offboarding.read', 'hr.payroll.read'):
            permissions = self.env['liwan.access.permission'].search([
                ('key', 'in', ['hr.employees.read', 'hr.employees.access_status.read', key]),
            ])
            role.permission_ids = [(6, 0, permissions.ids)]
            self.assertTrue(version.has_access('read'), key)
            self.assertEqual(version._filtered_access('read'), version, key)
            self.assertTrue(file.has_access('read'), key)
            self.assertEqual(files.search(target), file, key)
            self.assertEqual(files.search_count(target), 1, key)

    def test_parent_leave_staff_cannot_read_other_branch_employees_requests(self):
        self._branch_privacy_role(['hr.leave.read', 'hr.employees.read', 'hr.employees.access_status.read'])
        own_employee = self.env['hr.employee'].create({
            'name': 'Branch own leave employee', 'company_id': self.company_p1.id, 'user_id': self.iso_user.id,
        })
        own_leave = self.env['hr.leave'].create({
            'employee_id': own_employee.id, 'holiday_status_id': self.recs['p1']['leave'].holiday_status_id.id,
            'request_date_from': '2026-06-01', 'request_date_to': '2026-06-02',
        })
        self.env_in(self.company_p)
        target = self.recs['p1']['leave']
        allocation_type = self.env['hr.leave.type'].create({
            'name': 'Branch private allocation', 'requires_allocation': True,
            'company_id': self.company_p1.id,
        })
        allocation = self.env['hr.leave.allocation'].create({
            'employee_id': target.employee_id.id, 'holiday_status_id': allocation_type.id,
            'number_of_days': 2, 'date_from': '2026-01-01',
        })
        own_allocation = self.env['hr.leave.allocation'].create({
            'employee_id': own_employee.id, 'holiday_status_id': allocation_type.id,
            'number_of_days': 2, 'date_from': '2026-01-01',
        })
        self.assert_hidden_every_way(f'/api/v1/hr/leave/requests/{target.id}', self.company_p1.id)
        scoped = target.with_user(self.iso_user).with_context(
            allowed_company_ids=[self.company_p.id, self.company_p1.id],
            liwan_capability_scope=((('hr.leave.read',), 'all'),),
        )
        self.assertFalse(scoped.has_access('read'), 'parent staff rights cannot expose branch private leave in ORM')
        self.assertFalse(scoped.search([('id', '=', target.id)]))
        scoped_allocation = allocation.with_env(scoped.env)
        self.assertFalse(scoped_allocation.has_access('read'))
        self.assertFalse(scoped_allocation.search([('id', '=', allocation.id)]))
        self.assertTrue(own_allocation.with_env(scoped.env).has_access('read'))
        foreign_employee = self.env['hr.employee'].create({
            'name': 'Foreign own allocation employee', 'company_id': self.company_c.id,
            'user_id': self.iso_user.id,
        })
        foreign_type = self.env['hr.leave.type'].create({
            'name': 'Foreign private allocation', 'requires_allocation': True,
            'company_id': self.company_c.id,
        })
        foreign_allocation = self.env['hr.leave.allocation'].create({
            'employee_id': foreign_employee.id, 'holiday_status_id': foreign_type.id,
            'number_of_days': 2, 'date_from': '2026-01-01',
        }).with_env(scoped.env)
        self.assertFalse(foreign_allocation.has_access('read'), 'own employee cannot bypass the company scope')
        self.assertFalse(foreign_allocation.search([('id', '=', foreign_allocation.id)]))
        self.assertVisible(f'/api/v1/hr/leave/requests/{own_leave.id}')
        rows = self.assertVisible('/api/v1/hr/leave/requests').json()['items']
        self.assertNotIn(target.id, [row['id'] for row in rows])
        self.assertIn(own_leave.id, [row['id'] for row in rows])
        staff_grant = self.env['liwan.access.assignment'].create({
            'user_id': self.iso_user.id, 'company_id': self.company_p1.id,
            'role_id': self.env.ref('liwan_hr.role_hr_manager').id,
        })
        self.assertVisible(f'/api/v1/hr/leave/requests/{target.id}')
        self.assertTrue(scoped.has_access('read'))
        self.assertTrue(scoped_allocation.has_access('read'))
        rows = self.assertVisible('/api/v1/hr/leave/requests').json()['items']
        self.assertIn(target.id, [row['id'] for row in rows])
        staff_grant.unlink()
        self.assertFalse(scoped.has_access('read'), 'revoking staff retains private leave protection')
        self.assertFalse(scoped_allocation.has_access('read'))
        self.company_p.liwan_branch_access_mode = 'inherited'
        inheritance = self.env['liwan.access.branch.rule'].create({
            'company_id': self.company_p.id, 'branch_id': self.company_p1.id, 'inherit': True,
            'role_ids': [(6, 0, [self.env.ref('liwan_hr.role_hr_manager').id])],
        })
        self.assertTrue(scoped.has_access('read'))
        self.assertTrue(scoped.search([('id', '=', target.id)]))
        self.assertTrue(scoped_allocation.has_access('read'))
        self.assertTrue(scoped_allocation.search([('id', '=', allocation.id)]))
        inheritance.inherit = False
        self.assertFalse(scoped.has_access('read'), 'warm native staff rule cannot retain revoked inheritance')
        self.assertFalse(scoped_allocation.has_access('read'))
        self.assertFalse(scoped_allocation.search([('id', '=', allocation.id)]))
        self.assertFalse(scoped.search([('id', '=', target.id)]))

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

    def test_allocation_matrix(self):
        self.assert_matrix('allocation')

    def test_warning_matrix(self):
        self.assert_matrix('warning')

    def test_compensation_matrix(self):
        self.assert_matrix('compensated')

    def test_current_company_only_records_hide_branches_and_parents(self):
        """Shift schedules, planning rows, the warning figure and insurance records belong to one company: a branch or parent is hidden too."""
        for current in self.by_tag:
            self.env_in(self.by_tag[current])
            for kind, template in CURRENT_COMPANY_ROUTES.items():
                self.assertVisible(template.format(self.recs[current][kind].id))
                for tag in self.by_tag:
                    if tag != current:
                        record = self.recs[tag][kind]
                        self.assert_hidden_every_way(template.format(record.id), self.by_tag[tag].id)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_hr', EXPECTED_GET_RECORD_ROUTES)

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
    '/api/v1/hr/leave/allocations/<int:allocation_id>',
    '/api/v1/hr/payroll/compensation/<int:employee_id>',
    '/api/v1/hr/shifts/schedules/<int:schedule_id>',
    '/api/v1/hr/shifts/assignments/<int:assignment_id>',
    '/api/v1/hr/warnings/<int:warning_id>',
    '/api/v1/hr/warnings/standing/<int:employee_id>',
    '/api/v1/hr/insurance/plans/<int:plan_id>',
    '/api/v1/hr/insurance/enrollments/<int:enrollment_id>',
), source='liwan_hr/tests/test_company_isolation.py')
