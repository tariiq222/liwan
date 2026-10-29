# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date
from decimal import Decimal

from psycopg2 import IntegrityError

from odoo.tests import tagged
from odoo.tools import mute_logger

from .payroll_common import PayrollCase
from odoo.addons.webvue_hr.models.payroll_math import (
    continuous_service_start,
    eos_award,
    service_years,
)

ESTIMATE_KEYS = {
    'employee', 'start_date', 'end_date', 'service_years', 'eos_wage', 'case', 'award', 'leave_days', 'leave_amount',
}
SETTLEMENT_KEYS = {
    'id', 'employee', 'state', 'departure_date', 'departure_mismatch', 'case', 'service_years', 'eos_wage', 'award',
    'leave_days', 'leave_amount', 'open_deductions', 'total',
}
CASE_KEYS = {'departure_reason', 'case', 'revision'}
EOS = '/api/v1/hr/payroll/eos'
CASES = '/api/v1/hr/payroll/eos-cases'
RUNS = '/api/v1/hr/payroll/runs'
DEPARTURE = date(2026, 11, 30)
LEAVER_IBAN = 'SA0380000000608010167519'


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollEos(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'eos_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.approver = cls.payroll_user(cls, 'eos_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'])
        cls.config = cls.payroll_user(cls, 'eos_config', ['hr.payroll.read', 'hr.payroll.config', 'hr.employees.read'])
        cls.reader = cls.payroll_user(cls, 'eos_reader', ['hr.payroll.read', 'hr.employees.read'])
        cls.offboarder = cls.payroll_user(cls, 'eos_offboarder', [])
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.offboarder, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id, 'company_id': cls.env.company.id,
        }])
        cls.resigned = cls.env.ref('hr.departure_resigned')
        cls.leaver = cls.make_employee(cls, 'Eos Leaver', start=date(2023, 12, 1))
        cls.set_compensation(
            cls, cls.leaver, 8000, 2000, 500, iban=LEAVER_IBAN, gosi_registration_date=date(2020, 1, 1),
        )
        cls.leaver.write({'departure_date': DEPARTURE, 'departure_reason_id': cls.resigned.id})
        cls.env['hr.leave.allocation'].create({
            'employee_id': cls.leaver.id,
            'holiday_status_id': cls.env.ref('hr_holidays.leave_type_paid_time_off').id,
            'number_of_days': 12.5,
            'date_from': date(2026, 1, 1),
        }).action_approve()

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _estimate(self, user, employee, query=''):
        self._login(user)
        return self.api('GET', f'{EOS}/{employee.id}/estimate{query}')

    def _put_settlement(self, user, employee, body):
        self._login(user)
        return self.api('PUT', f'{EOS}/{employee.id}/settlement', json=body)

    def _confirm(self, user, employee):
        self._login(user)
        return self.api('POST', f'{EOS}/{employee.id}/settlement/confirm')

    def _confirmed_settlement(self):
        res = self._put_settlement(self.officer, self.leaver, {'case': 'resignation', 'open_deductions': 300})
        self.assertEqual(res.status_code, 200, res.text)
        res = self._confirm(self.approver, self.leaver)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_eos_award_boundaries(self):
        wage = Decimal(10000)
        for years, case, expected in (
            ('1.99', 'resignation', '0.00'),
            ('1.99', 'termination', '9950.00'),
            ('2', 'resignation', '3333.33'),
            ('4.99', 'resignation', '8316.67'),
            ('5', 'resignation', '8333.33'),
            ('9.99', 'resignation', '49933.33'),
            ('10', 'resignation', '75000.00'),
            ('10', 'termination', '75000.00'),
            ('3', 'marriage_childbirth', '15000.00'),
            ('3', 'no_award', '0.00'),
        ):
            with self.subTest(years=years, case=case):
                self.assertEqual(eos_award(wage, Decimal(years), case), Decimal(expected))

    def test_resignation_award_at_service_anniversaries(self):
        start = date(2021, 11, 1)
        for end, expected_years, expected_award in (
            (date(2023, 10, 31), Decimal(2), '3333.33'),
            (date(2026, 10, 31), Decimal(5), '8333.33'),
            (date(2026, 11, 1), Decimal(5) + Decimal(1) / Decimal(365), '16684.93'),
            (date(2031, 10, 31), Decimal(10), '75000.00'),
        ):
            with self.subTest(end=end):
                years = service_years(start, end)
                self.assertEqual(years, expected_years)
                self.assertEqual(eos_award(Decimal(10000), years, 'resignation'), Decimal(expected_award))

    def test_service_years_is_anniversary_based(self):
        self.assertEqual(service_years(date(2024, 11, 1), date(2026, 10, 31)), Decimal(2))
        almost = service_years(date(2024, 11, 1), date(2026, 10, 30))
        self.assertEqual(almost, 1 + Decimal(364) / Decimal(365))
        self.assertEqual(eos_award(Decimal(10000), almost, 'resignation'), Decimal('0.00'))
        self.assertEqual(service_years(date(2021, 11, 1), date(2026, 10, 31)), Decimal(5))

    def test_final_settlement_amounts(self):
        res = self._estimate(self.reader, self.leaver, f'?date={DEPARTURE}&case=resignation')
        self.assertEqual(res.status_code, 200, res.text)
        estimate = res.json()
        self.assertEqual(set(estimate), ESTIMATE_KEYS)
        self.assertEqual(estimate['employee'], {'id': self.leaver.id, 'name': 'Eos Leaver'})
        self.assertEqual((estimate['start_date'], estimate['end_date']), ('2023-12-01', '2026-11-30'))
        self.assertEqual((estimate['service_years'], estimate['eos_wage']), (3, 10500))
        self.assertEqual((estimate['award'], estimate['leave_days'], estimate['leave_amount']), (5250, 12.5, 4375))

        res = self._put_settlement(self.officer, self.leaver, {'case': 'resignation', 'open_deductions': 300})
        self.assertEqual(res.status_code, 200, res.text)
        draft = res.json()
        self.assertEqual(set(draft), SETTLEMENT_KEYS)
        self.assertEqual((draft['state'], draft['case'], draft['departure_date']), ('draft', 'resignation', '2026-11-30'))
        self.assertEqual((draft['award'], draft['leave_amount'], draft['open_deductions'], draft['total']), (5250, 4375, 300, 9325))
        self.assertFalse(draft['departure_mismatch'])

        confirmed = self._confirm(self.approver, self.leaver).json()
        self.assertEqual(confirmed['state'], 'confirmed')
        self.assertEqual(confirmed['total'], 9325)
        res = self._put_settlement(self.officer, self.leaver, {'case': 'termination', 'open_deductions': 0})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'transition_forbidden'))

    def test_confirmed_settlement_stays_visible_after_the_departure_date_changes(self):
        self._confirmed_settlement()
        self.leaver.departure_date = date(2026, 12, 10)
        self._login(self.officer)
        res = self.api('GET', f'{EOS}/{self.leaver.id}/settlement')
        self.assertEqual(res.status_code, 200, res.text)
        shown = res.json()
        self.assertEqual((shown['state'], shown['departure_mismatch']), ('confirmed', True))

    def test_confirm_needs_approve_and_refuses_own_employee(self):
        self.assertEqual(self._put_settlement(self.officer, self.leaver, {'case': 'resignation'}).status_code, 200)
        res = self._confirm(self.officer, self.leaver)
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self.leaver.user_id = self.approver
        res = self._confirm(self.approver, self.leaver)
        self.assertEqual((res.status_code, res.json()['code']), (403, 'transition_forbidden'))

    def test_departure_month_payslip_carries_the_settlement(self):
        self._confirmed_settlement()
        self._login(self.officer)
        run = self.api('POST', RUNS, json={'month': '2026-11'}).json()
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        slip = self.env['hr.payslip'].search([('payslip_run_id', '=', run['id']), ('employee_id', '=', self.leaver.id)])
        lines = {line.code: line.total for line in slip.line_ids}
        self.assertEqual(lines['EOS'], 5250.00)
        self.assertEqual(lines['LEAVE_ENC'], 4375.00)
        self.assertEqual(lines['SETTLEMENT_DED'], -300.00)
        self.assertEqual(slip.webvue_paid_days, 30)

    def test_approve_refuses_leaver_without_confirmed_settlement(self):
        self._login(self.officer)
        run = self.api('POST', RUNS, json={'month': '2026-11'}).json()
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        self._login(self.approver)
        res = self.api('POST', f"{RUNS}/{run['id']}/approve")
        self.assertEqual((res.status_code, res.json()['code']), (422, 'settlement_missing'))
        self.assertEqual(res.json()['details'], {'employee_ids': [self.leaver.id]})
        self._confirmed_settlement()
        self._login(self.officer)
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        self._login(self.approver)
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/approve").status_code, 200)

    def test_unmapped_reason_needs_explicit_case(self):
        other = self.env['hr.departure.reason'].create({'name': 'Retired'})
        self.leaver.departure_reason_id = other
        res = self._estimate(self.reader, self.leaver, f'?date={DEPARTURE}')
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'eos_case_missing', 'case'))
        res = self._put_settlement(self.officer, self.leaver, {'open_deductions': 0})
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'eos_case_missing', 'case'))
        self._login(self.reader)
        listing = self.api('GET', CASES).json()
        self.assertEqual(set(listing), {'items', 'total'})
        self.assertEqual(set(listing['items'][0]), CASE_KEYS)
        self.assertIsNone(next(item for item in listing['items'] if item['departure_reason']['id'] == other.id)['case'])
        res = self.api('PUT', CASES, json={'departure_reason_id': other.id, 'case': 'termination', 'revision': 0})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self._login(self.config)
        res = self.api('PUT', CASES, json={'departure_reason_id': other.id, 'case': 'termination', 'revision': 0})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()['case'], res.json()['revision']), ('termination', 1))
        res = self._estimate(self.reader, self.leaver, f'?date={DEPARTURE}')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['case'], 'termination')
        self._login(self.config)
        res = self.api('PUT', CASES, json={'departure_reason_id': other.id, 'case': 'bogus', 'revision': 1})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'case'))

    def test_seeded_case_map(self):
        self._login(self.reader)
        cases = {item['departure_reason']['id']: item['case'] for item in self.api('GET', CASES).json()['items']}
        self.assertEqual(cases[self.env.ref('hr.departure_fired').id], 'termination')
        self.assertEqual(cases[self.resigned.id], 'resignation')

    def test_settlement_visibility(self):
        self.assertEqual(self._put_settlement(self.officer, self.leaver, {'case': 'resignation'}).status_code, 200)
        res = self._estimate(self.offboarder, self.leaver, f'?date={DEPARTURE}&case=resignation')
        self.assertEqual(res.status_code, 403, res.text)
        self._login(self.offboarder)
        self.assertEqual(self.api('GET', f'{EOS}/{self.leaver.id}/settlement').status_code, 403)
        self.assertEqual(self.api('GET', CASES).status_code, 403)
        self._login(self.reader)
        self.assertEqual(self.api('GET', f'{EOS}/{self.leaver.id}/settlement').status_code, 200)
        self.assertEqual(self.api('GET', f'{EOS}/999999/settlement').status_code, 404)

    def test_run_goes_stale_when_the_settlement_is_confirmed_after_compute(self):
        self.assertEqual(self._put_settlement(self.officer, self.leaver, {'case': 'resignation', 'open_deductions': 300}).status_code, 200)
        self._login(self.officer)
        run = self.api('POST', RUNS, json={'month': '2026-11'}).json()
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        self.assertEqual(self._confirm(self.approver, self.leaver).status_code, 200)
        self._login(self.approver)
        res = self.api('POST', f"{RUNS}/{run['id']}/approve")
        self.assertEqual((res.status_code, res.json()['code']), (422, 'run_stale'))
        self.assertEqual(res.json()['details'], {'employee_ids': [self.leaver.id]})
        self._login(self.officer)
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        self._login(self.approver)
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/approve").status_code, 200)
        slip = self.env['hr.payslip'].search([('payslip_run_id', '=', run['id']), ('employee_id', '=', self.leaver.id)])
        self.assertEqual({line.code: line.total for line in slip.line_ids}['EOS'], 5250.00)

    def test_service_counts_from_the_last_unbroken_contract(self):
        self.assertEqual(
            continuous_service_start([(date(2015, 1, 1), date(2018, 12, 31)), (date(2024, 1, 1), None)]),
            date(2024, 1, 1),
        )
        self.assertEqual(
            continuous_service_start([(date(2015, 1, 1), date(2018, 12, 31)), (date(2019, 1, 3), None)]),
            date(2015, 1, 1),
        )
        rehired = self.make_employee('Eos Rehired', start=date(2015, 1, 1))
        rehired.version_id.contract_date_end = date(2018, 12, 31)
        self.env['hr.version'].create({
            'employee_id': rehired.id, 'date_version': date(2024, 1, 1), 'contract_date_start': date(2024, 1, 1),
        })
        self.assertEqual(self.env['webvue.hr.payroll.eos.settlement']._webvue_service_start(rehired), date(2024, 1, 1))

    def test_departure_before_service_start_is_refused(self):
        res = self._estimate(self.reader, self.leaver, '?date=2023-11-30&case=resignation')
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'date'))

    def test_confirm_refuses_figures_that_changed_since_the_draft(self):
        self.assertEqual(self._put_settlement(self.officer, self.leaver, {'case': 'resignation'}).status_code, 200)
        self.env['webvue.hr.compensation'].search([('employee_id', '=', self.leaver.id)]).basic_wage = 9000
        res = self._confirm(self.approver, self.leaver)
        self.assertEqual((res.status_code, res.json()['code']), (422, 'settlement_changed'))
        details = res.json()['details']
        self.assertEqual((details['draft']['award'], details['recomputed']['award']), (5250, 5750))
        self.assertEqual(self._put_settlement(self.officer, self.leaver, {}).status_code, 200)
        self.assertEqual(self._confirm(self.approver, self.leaver).status_code, 200)

    def test_periods_sharing_a_start_date_sort_without_comparing_none_to_a_date(self):
        # Stock hr refuses such versions on one employee (its overlap check), so only the pure rule can be handed
        # this input; it must still order open and closed periods instead of raising a TypeError.
        same_start = [(date(2020, 1, 1), None), (date(2020, 1, 1), date(2026, 10, 31))]
        self.assertEqual(continuous_service_start(same_start), date(2020, 1, 1))
        self.assertEqual(continuous_service_start(same_start[::-1]), date(2020, 1, 1))

    def test_a_rehired_leaver_gets_a_new_settlement_and_keeps_the_old_one_as_history(self):
        first = self._confirmed_settlement()
        old = self.env['webvue.hr.payroll.eos.settlement'].browse(first['id'])
        self.leaver.write({'departure_date': date(2027, 6, 30), 'departure_reason_id': self.resigned.id})
        self.assertEqual(self.api('GET', f'{EOS}/{self.leaver.id}/settlement').status_code, 404)
        res = self._put_settlement(self.officer, self.leaver, {'case': 'resignation', 'open_deductions': 0})
        self.assertEqual(res.status_code, 200, res.text)
        new = res.json()
        self.assertNotEqual(new['id'], first['id'])
        self.assertEqual((new['state'], new['departure_date']), ('draft', '2027-06-30'))
        self.assertEqual((old.state, old.departure_date), ('confirmed', DEPARTURE))
        self.assertEqual(self.api('GET', f'{EOS}/{self.leaver.id}/settlement').json()['id'], new['id'])
        self.assertEqual(self._confirm(self.approver, self.leaver).json()['id'], new['id'])

    def test_a_rehired_leavers_old_settlement_does_not_block_or_pay_the_new_month(self):
        self._confirmed_settlement()
        self.leaver.write({'departure_date': date(2027, 6, 30)})
        self._login(self.officer)
        run = self.api('POST', RUNS, json={'month': '2027-06'}).json()
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        slip = self.env['hr.payslip'].search([('payslip_run_id', '=', run['id']), ('employee_id', '=', self.leaver.id)])
        self.assertEqual({line.code: line.total for line in slip.line_ids}.get('EOS', 0), 0)
        self._login(self.approver)
        res = self.api('POST', f"{RUNS}/{run['id']}/approve")
        self.assertEqual((res.status_code, res.json()['code']), (422, 'settlement_missing'))
        self.assertEqual(self._put_settlement(self.officer, self.leaver, {'case': 'resignation'}).status_code, 200)
        self.assertEqual(self._confirm(self.approver, self.leaver).status_code, 200)
        self._login(self.officer)
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        self._login(self.approver)
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/approve").status_code, 200)

    def test_the_database_allows_one_settlement_per_employee_and_departure(self):
        Settlement = self.env['webvue.hr.payroll.eos.settlement']
        values = {'employee_id': self.leaver.id, 'case': 'resignation', 'departure_date': DEPARTURE}
        Settlement.create(values)
        with self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'), self.cr.savepoint():
            Settlement.create(values)
        Settlement.create({**values, 'departure_date': date(2028, 1, 31)})
