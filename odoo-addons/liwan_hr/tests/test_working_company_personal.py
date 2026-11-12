# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A person's own employment data follows the person, not the company the session works in."""
from datetime import date, timedelta

from odoo import fields
from odoo.tests import tagged

from .common import set_hr_feature, use_hr_decision_path
from odoo.addons.liwan_api.tests.common import WorkingCompanyCase


@tagged('post_install', '-at_install', 'liwan')
class TestPersonalRoutesFollowTheHomeCompany(WorkingCompanyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        use_hr_decision_path(cls)
        cls.branch_a.country_id = cls.env.ref('base.sa')
        cls.branch_b.country_id = cls.env.ref('base.be')
        cls.worker = cls._member(
            'wc_hr_worker', cls.branch_a, [cls.branch_a, cls.branch_b],
            {cls.branch_a: cls.employee_role, cls.branch_b: cls.employee_role},
        )
        Employee = cls.env['hr.employee']
        cls.employee_a = Employee.create({'name': 'Worker at A', 'user_id': cls.worker.id, 'company_id': cls.branch_a.id})
        cls.employee_b = Employee.create({'name': 'Worker at B', 'user_id': cls.worker.id, 'company_id': cls.branch_b.id})
        cls.annual = cls.env.ref('hr_holidays.leave_type_paid_time_off')
        cls._own_rows()
        cls.env['hr.leave.allocation'].create({
            'employee_id': cls.employee_a.id, 'holiday_status_id': cls.annual.id, 'number_of_days': 21,
            'date_from': date.today().replace(month=1, day=1),
        }).action_approve()

    @classmethod
    def _own_rows(cls):
        """One real row per own-data route in each company: the home company's must come back, never B's."""
        env = cls.env
        cls.warnings_a = cls._warnings(cls.branch_a, cls.employee_a, 2)
        cls.warning_a, cls.warning_a2 = cls.warnings_a
        cls.warning_b, = cls._warnings(cls.branch_b, cls.employee_b, 1)
        cls.enrollment_a = cls._enrollment(cls.branch_a, cls.employee_a)
        cls.enrollment_b = cls._enrollment(cls.branch_b, cls.employee_b)
        cls.equipment_a = cls._equipment(cls.branch_a, cls.employee_a)
        cls.equipment_b = cls._equipment(cls.branch_b, cls.employee_b)
        cls.assignment_a = cls._assignment(cls.branch_a, cls.employee_a)
        cls.assignment_b = cls._assignment(cls.branch_b, cls.employee_b)
        category = env['hr.salary.rule.category'].create({'name': 'Own basic', 'code': 'OWN_BASIC', 'company_id': False})
        structure = env['hr.payroll.structure'].create({
            'name': 'Own structure', 'code': 'OWNSTRUCT',
            'rule_ids': [(0, 0, {
                'name': 'Basic', 'code': 'OWN_BASIC', 'sequence': 1, 'category_id': category.id,
                'amount_select': 'fix', 'amount_fix': 1000.0,
            })],
        })
        cls.employee_a.version_id.contract_date_start = date(2024, 1, 1)
        env['liwan.hr.compensation'].create({'employee_id': cls.employee_a.id, 'basic_wage': 5000})
        cls.payslip_a = env['hr.payslip'].create({
            'name': 'Own slip', 'employee_id': cls.employee_a.id, 'contract_id': cls.employee_a.version_id.id,
            'struct_id': structure.id, 'date_from': date(2026, 4, 1), 'date_to': date(2026, 4, 30),
            'company_id': cls.branch_a.id,
        })
        cls.payslip_a.with_company(cls.branch_a).compute_sheet()
        cls.payslip_a.state = 'done'

    @classmethod
    def _warnings(cls, company, employee, count):
        company._liwan_ensure_warning_types()
        kind = cls.env['liwan.hr.warning.type'].search([('company_id', '=', company.id)], limit=1)
        return cls.env['liwan.hr.warning'].create([{
            'employee_id': employee.id, 'type_id': kind.id, 'reason': f'Own warning {company.name} {index}',
            'state': 'issued', 'issued_at': fields.Datetime.now(),
        } for index in range(count)])

    @classmethod
    def _enrollment(cls, company, employee):
        env = cls.env
        provider = env['liwan.hr.insurance.provider'].create({'company_id': company.id, 'name': f'Insurer {company.name}'})
        plan = env['liwan.hr.insurance.plan'].create({
            'company_id': company.id, 'provider_id': provider.id, 'name': f'Plan {company.name}',
            'valid_from': date.today() - timedelta(days=100), 'valid_to': date.today() + timedelta(days=200),
        })
        return env['liwan.hr.insurance.enrollment'].create({
            'employee_id': employee.id, 'plan_id': plan.id, 'date_from': date.today() - timedelta(days=50),
        })

    @classmethod
    def _equipment(cls, company, employee):
        category = cls.env['maintenance.equipment.category'].create({'name': f'Laptops {company.name}', 'company_id': company.id})
        return cls.env['maintenance.equipment'].create({
            'name': f'Laptop {company.name}', 'category_id': category.id, 'company_id': company.id,
            'employee_id': employee.id,
        })

    @classmethod
    def _assignment(cls, company, employee):
        schedule = cls.env['resource.calendar'].create({
            'name': f'Shift {company.name}', 'company_id': company.id, 'tz': 'UTC',
            'attendance_ids': [(0, 0, {
                'name': '08 - 12', 'dayofweek': '0', 'day_period': 'morning', 'hour_from': 8, 'hour_to': 12,
            })],
        })
        return cls.env['hr.employee.calendar'].create({
            'employee_id': employee.id, 'calendar_id': schedule.id, 'date_start': date(2026, 1, 1),
        })

    def setUp(self):
        super().setUp()
        for feature in ('hr.enabled', 'hr.warnings', 'hr.insurance', 'hr.shifts', 'hr.assets', 'hr.payroll'):
            set_hr_feature(self, feature)
        self.sign_in('wc_hr_worker')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)

    def test_the_own_profile_is_the_home_company_employee(self):
        profile = self.api('GET', '/api/v1/hr/me')
        self.assertEqual(profile.status_code, 200, profile.text)
        self.assertEqual(profile.json()['id'], self.employee_a.id)
        self.assertEqual(self.me()['company']['id'], self.branch_b.id)

    def test_own_leave_balances_come_from_the_home_company(self):
        balances = self.api('GET', '/api/v1/hr/leave/balances')
        self.assertEqual(balances.status_code, 200, balances.text)
        self.assertEqual([item['leave_type']['id'] for item in balances.json()['items']], [self.annual.id])

    def test_a_leave_request_and_the_own_list_belong_to_the_home_company_employee(self):
        monday = date.today() + timedelta(days=14)
        monday += timedelta(days=(0 - monday.weekday()) % 7 or 7)
        created = self.api('POST', '/api/v1/hr/leave/requests', json={
            'leave_type_id': self.annual.id, 'date_from': monday.isoformat(),
            'date_to': monday.isoformat(), 'notes': 'Own leave',
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['employee']['id'], self.employee_a.id)
        mine = self.api('GET', '/api/v1/hr/leave/requests?mine=1')
        self.assertEqual(mine.status_code, 200, mine.text)
        self.assertEqual([item['id'] for item in mine.json()['items']], [created.json()['id']])
        own = self.api('GET', f"/api/v1/hr/leave/me/{created.json()['id']}")
        self.assertEqual(own.status_code, 200, own.text)

    def test_a_request_that_is_not_personal_runs_in_the_working_company_after_a_personal_one(self):
        hajj = self.env.ref('hr_holidays.l10n_sa_leave_type_hajj').id
        maternity = self.env.ref('hr_holidays.l10n_be_leave_type_maternity').id
        personal = self.api('GET', '/api/v1/hr/leave/types?mine=1')
        self.assertEqual(personal.status_code, 200, personal.text)
        personal_ids = {item['id'] for item in personal.json()['items']}
        self.assertIn(hajj, personal_ids)
        self.assertNotIn(maternity, personal_ids)
        working = self.api('GET', '/api/v1/hr/leave/types')
        self.assertEqual(working.status_code, 200, working.text)
        working_ids = {item['id'] for item in working.json()['items']}
        self.assertIn(maternity, working_ids)
        self.assertNotIn(hajj, working_ids)
        self.assertEqual(self.me()['company']['id'], self.branch_b.id)

    def _own_leave(self):
        monday = date.today() + timedelta(days=14)
        monday += timedelta(days=(0 - monday.weekday()) % 7 or 7)
        created = self.api('POST', '/api/v1/hr/leave/requests', json={
            'leave_type_id': self.annual.id, 'date_from': monday.isoformat(),
            'date_to': monday.isoformat(), 'notes': 'Own leave',
        })
        self.assertEqual(created.status_code, 201, created.text)
        return created.json()['id']

    def test_own_leave_is_opened_and_withdrawn_by_id_from_the_working_company(self):
        leave_id = self._own_leave()
        listed = self.api('GET', '/api/v1/hr/leave/requests?mine=1')
        self.assertEqual([item['id'] for item in listed.json()['items']], [leave_id])
        detail = f'/api/v1/hr/leave/requests/{leave_id}'
        opened = self.api('GET', f'{detail}?mine=1')
        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual(opened.json()['employee']['id'], self.employee_a.id)
        missing = self.api('GET', detail)
        self.assertEqual((missing.status_code, missing.json()['code']), (404, 'not_found'), missing.text)
        refused = self.api('POST', f'{detail}/cancel', {})
        self.assertEqual(refused.status_code, 404, refused.text)
        withdrawn = self.api('POST', f'{detail}/cancel?mine=1', {})
        self.assertEqual(withdrawn.status_code, 200, withdrawn.text)
        self.assertTrue(withdrawn.json()['withdrawn'])
        self.assertFalse(self.env['hr.leave'].search([('id', '=', leave_id)]))

    def test_the_personal_marker_never_reaches_another_employees_leave(self):
        manager = self._member(
            'wc_hr_leave_manager', self.branch_a, [self.branch_a, self.branch_b],
            {self.branch_a: self.env.ref('liwan_hr.role_hr_manager'), self.branch_b: self.employee_role},
        )
        self.env['hr.employee'].create({'name': 'Manager at A', 'user_id': manager.id, 'company_id': self.branch_a.id})
        colleague = self.env['hr.employee'].create({'name': 'Colleague at A', 'company_id': self.branch_a.id})
        leave = self.env['hr.leave'].create({
            'employee_id': colleague.id, 'holiday_status_id': self.env.ref('hr_holidays.l10n_sa_leave_type_hajj').id,
            'request_date_from': date.today() + timedelta(days=30), 'request_date_to': date.today() + timedelta(days=30),
        })
        detail = f'/api/v1/hr/leave/requests/{leave.id}'
        self.sign_in('wc_hr_leave_manager')
        self.assertEqual(self.api('GET', detail).status_code, 200)
        self.assertEqual(self.api('GET', f'{detail}?mine=1').status_code, 404)
        self.assertEqual(self.api('POST', f'{detail}/cancel?mine=1', {}).status_code, 404)
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        self.assertEqual(self.api('GET', f'{detail}?mine=1').status_code, 404)
        self.assertEqual(self.api('POST', f'{detail}/cancel?mine=1', {}).status_code, 404)
        self.assertTrue(leave.exists())

    def _call(self, method, path, body):
        return self.url_open(path, json=body, headers={'Content-Type': 'application/json'}, method=method)

    def test_balances_decide_from_one_mapping_when_the_query_and_the_body_disagree(self):
        # The body wins: it names no employee, so the request is personal and answers the home company's own balances.
        answer = self._call('GET', f'/api/v1/hr/leave/balances?employee_id={self.employee_b.id}', {'employee_id': ''})
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual([item['leave_type']['id'] for item in answer.json()['items']], [self.annual.id])

    def test_requests_decide_from_one_mapping_when_the_query_and_the_body_disagree(self):
        manager = self._member(
            'wc_hr_list_manager', self.branch_a, [self.branch_a, self.branch_b],
            {self.branch_a: self.env.ref('liwan_hr.role_hr_manager'), self.branch_b: self.employee_role},
        )
        self.env['hr.employee'].create({'name': 'List manager at A', 'user_id': manager.id, 'company_id': self.branch_a.id})
        colleague = self.env['hr.employee'].create({'name': 'Listed colleague at A', 'company_id': self.branch_a.id})
        self.env['hr.leave'].create({
            'employee_id': colleague.id, 'holiday_status_id': self.env.ref('hr_holidays.l10n_sa_leave_type_hajj').id,
            'request_date_from': date.today() + timedelta(days=30), 'request_date_to': date.today() + timedelta(days=30),
        })
        self.sign_in('wc_hr_list_manager')
        # The body says personal: the request runs at home and lists the caller's own leave only, none here.
        personal = self._call('GET', '/api/v1/hr/leave/requests', {'mine': '1'})
        self.assertEqual((personal.status_code, personal.json()['items']), (200, []), personal.text)
        # The body says not personal although the query says personal: the working company's list, no own filter.
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        working = self._call('GET', '/api/v1/hr/leave/requests?mine=1', {'mine': ''})
        alone = self._call('GET', '/api/v1/hr/leave/requests', {'mine': ''})
        self.assertEqual((working.status_code, working.json()), (200, alone.json()), working.text)

    def test_a_leave_request_decides_from_one_mapping_when_the_query_and_the_body_disagree(self):
        monday = date.today() + timedelta(days=14)
        monday += timedelta(days=(0 - monday.weekday()) % 7 or 7)
        # The query names an employee of the home company and the body names none: one mapping, so the request is
        # not personal, runs in B, and that employee is outside B. It must not quietly file the caller's own leave.
        refused = self._call('POST', f'/api/v1/hr/leave/requests?employee_id={self.employee_a.id}', {
            'leave_type_id': self.annual.id, 'date_from': monday.isoformat(), 'date_to': monday.isoformat(),
        })
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid'), refused.text)
        self.assertFalse(self.env['hr.leave'].search([('employee_id', 'in', (self.employee_a | self.employee_b).ids)]))

    def test_a_switch_leaves_the_employee_link_alone(self):
        def links_of_worker():
            self.env.invalidate_all()
            employees = self.env['hr.employee'].with_context(allowed_company_ids=[self.branch_a.id, self.branch_b.id]).search(
                [('user_id', '=', self.worker.id)],
            )
            return {(employee.id, employee.company_id.id) for employee in employees}

        links = links_of_worker()
        self.assertEqual(links, {(self.employee_a.id, self.branch_a.id), (self.employee_b.id, self.branch_b.id)})
        self.assertEqual(self.me()['company']['id'], self.branch_b.id)
        self.assertEqual(links_of_worker(), links)
        self.assertEqual(self.worker.company_id, self.branch_a)

    def test_a_request_for_another_employee_still_acts_in_the_working_company(self):
        other = self.env['hr.employee'].create({'name': 'Colleague at B', 'company_id': self.branch_b.id})
        refused = self.api('GET', f'/api/v1/hr/leave/balances?employee_id={other.id}')
        self.assertEqual(refused.status_code, 403, refused.text)

    def test_every_own_data_route_returns_the_home_company_rows_and_not_the_working_company_ones(self):
        ids = lambda path: {item['id'] for item in self.api('GET', path).json()['items']}  # noqa: E731
        for path, home, working in (
            ('/api/v1/hr/warnings/me', self.warnings_a, self.warning_b),
            ('/api/v1/hr/insurance/me', self.enrollment_a, self.enrollment_b),
            ('/api/v1/hr/assets/me', self.equipment_a, self.equipment_b),
            ('/api/v1/hr/shifts/me', self.assignment_a, self.assignment_b),
        ):
            with self.subTest(path=path):
                self.assertEqual(self.api('GET', path).status_code, 200)
                self.assertEqual(ids(path), set(home.ids), working.id)
        with self.subTest(path='/api/v1/hr/payroll/payslips/mine'):
            self.assertEqual(ids('/api/v1/hr/payroll/payslips/mine'), {self.payslip_a.id})
        with self.subTest(path='/api/v1/hr/shifts/me/week'):
            week = self.api('GET', '/api/v1/hr/shifts/me/week')
            self.assertEqual(week.status_code, 200, week.text)
            self.assertEqual(week.json()['employee']['id'], self.employee_a.id)

    def test_a_warning_is_acknowledged_and_contested_from_the_working_company(self):
        acknowledged = self.api('POST', f'/api/v1/hr/warnings/me/{self.warning_a.id}/acknowledge',
                                {'revision': self.warning_a.revision})
        self.assertEqual(acknowledged.status_code, 200, acknowledged.text)
        self.assertTrue(acknowledged.json()['acknowledged_at'])
        contested = self.api('POST', f'/api/v1/hr/warnings/me/{self.warning_a2.id}/contest',
                             {'revision': self.warning_a2.revision, 'note': 'I disagree'})
        self.assertEqual(contested.status_code, 200, contested.text)
        self.assertTrue(contested.json()['contested_at'])
        foreign = self.api('POST', f'/api/v1/hr/warnings/me/{self.warning_b.id}/acknowledge',
                           {'revision': self.warning_b.revision})
        self.assertEqual(foreign.status_code, 404, foreign.text)


@tagged('post_install', '-at_install', 'liwan')
class TestPersonalOnboardingStepsAndShiftSettings(WorkingCompanyCase):
    """The own onboarding steps and the shift settings the personal schedule reads act in the home company."""

    STEPS = '/api/v1/hr/self/onboarding-steps'
    SETTINGS = '/api/v1/hr/shifts/settings'

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        use_hr_decision_path(cls)
        manager_role = cls.env.ref('liwan_hr.role_hr_manager')
        cls.hr_manager = cls._member('wc_hr_steps_manager', cls.branch_a, [cls.branch_a], {cls.branch_a: manager_role})
        cls.env['hr.employee'].create({'name': 'Steps manager at A', 'user_id': cls.hr_manager.id, 'company_id': cls.branch_a.id})
        # Homed in A with an HR role there; in B the account is a plain member with no HR role.
        cls.roamer_hr = cls._member(
            'wc_hr_settings_reader', cls.branch_a, [cls.branch_a, cls.branch_b], {cls.branch_a: manager_role},
        )
        # An HR manager of A who is itself being onboarded: a plain branch employee holds no read access to plan runs.
        cls.newcomer = cls._member(
            'wc_hr_newcomer', cls.branch_a, [cls.branch_a, cls.branch_b], {cls.branch_a: manager_role},
        )
        cls.newcomer_employee = cls.env['hr.employee'].create({
            'name': 'Newcomer at A', 'user_id': cls.newcomer.id, 'company_id': cls.branch_a.id,
        })
        plan = cls.env['mail.activity.plan'].create({
            'name': 'Steps plan A', 'res_model': 'hr.employee', 'hr_purpose': 'onboarding', 'company_id': cls.branch_a.id,
        })
        cls.env['mail.activity.plan.template'].create({
            'plan_id': plan.id, 'summary': 'Sign the contract', 'activity_type_id': cls.env.ref('mail.mail_activity_data_todo').id,
            'responsible_type': 'employee', 'delay_count': 0, 'delay_unit': 'days', 'delay_from': 'before_plan_date',
        })
        cls.plan = plan
        cls.env['liwan.hr.shift.settings'].create({'company_id': cls.branch_a.id, 'day_reference': 'user'})

    def setUp(self):
        super().setUp()
        for feature in ('hr.enabled', 'hr.onboarding', 'hr.shifts'):
            set_hr_feature(self, feature)

    def _launch_run(self):
        self.sign_in('wc_hr_steps_manager')
        launched = self.api('POST', '/api/v1/hr/onboarding/runs', json={
            'employee_id': self.newcomer_employee.id, 'plan_id': self.plan.id,
        })
        self.assertEqual(launched.status_code, 201, launched.text)

    def test_the_own_onboarding_steps_are_listed_and_finished_from_the_home_company(self):
        self._launch_run()
        self.sign_in('wc_hr_newcomer')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        listed = self.api('GET', self.STEPS)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([item['summary'] for item in listed.json()['items']], ['Sign the contract'])
        done = self.api('POST', f"{self.STEPS}/{listed.json()['items'][0]['id']}/done", json={})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(self.api('GET', self.STEPS).json()['items'], [])
        self.assertEqual(self.me()['company']['id'], self.branch_b.id)

    def test_the_own_onboarding_steps_are_unchanged_in_the_home_company(self):
        self._launch_run()
        self.sign_in('wc_hr_newcomer')
        listed = self.api('GET', self.STEPS)
        self.assertEqual([item['summary'] for item in listed.json()['items']], ['Sign the contract'])
        done = self.api('POST', f"{self.STEPS}/{listed.json()['items'][0]['id']}/done", json={})
        self.assertEqual(done.status_code, 200, done.text)

    def test_the_personal_shift_settings_are_the_home_company_ones_after_a_switch(self):
        self.sign_in('wc_hr_settings_reader')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        personal = self.api('GET', f'{self.SETTINGS}?mine=1')
        self.assertEqual(personal.status_code, 200, personal.text)
        self.assertEqual(personal.json()['day_reference'], 'user')
        self.assertEqual(personal.json()['default_schedule']['id'], self.branch_a.resource_calendar_id.id)
        refused = self.api('GET', self.SETTINGS)
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertEqual(self.me()['company']['id'], self.branch_b.id)

    def test_both_shift_settings_reads_answer_the_same_at_home(self):
        self.sign_in('wc_hr_settings_reader')
        plain = self.api('GET', self.SETTINGS)
        personal = self.api('GET', f'{self.SETTINGS}?mine=1')
        self.assertEqual((plain.status_code, personal.status_code), (200, 200), plain.text)
        self.assertEqual(plain.json(), personal.json())
        self.assertEqual(plain.json()['day_reference'], 'user')

    def test_the_settings_write_stays_in_the_working_company_even_with_the_marker(self):
        self.sign_in('wc_hr_settings_reader')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        refused = self.api('PATCH', f'{self.SETTINGS}?mine=1', {'day_reference': 'company', 'revision': 0})
        self.assertEqual(refused.status_code, 403, refused.text)
