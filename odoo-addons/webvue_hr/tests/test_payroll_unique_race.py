# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date
from unittest.mock import patch

from odoo.tests import tagged
from odoo.tools import mute_logger

from .payroll_common import PayrollCase

RUNS = '/api/v1/hr/payroll/runs'
COMPENSATION = '/api/v1/hr/payroll/compensation'
EOS = '/api/v1/hr/payroll/eos'
RATES = '/api/v1/hr/payroll/gosi-rates'
RACE_RATE = {
    'branch': 'annuities', 'nationality_class': 'gcc', 'date_from': '2031-01-01',
    'employee_rate': 9, 'employer_rate': 9, 'wage_min': 1500, 'wage_max': 45000,
}
MONTH = '2026-11'
MONTH_START = date(2026, 11, 1)
DEPARTURE = date(2026, 11, 30)
PUT_COMPENSATION = {
    'basic_wage': 10000, 'housing_allowance': 2500, 'transport_allowance': 1000, 'other_allowance': 0,
    'iban': None, 'bank_id': None, 'gosi_number': None, 'gosi_registration_date': '2024-01-01',
}


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollUniqueRace(PayrollCase):
    """A create that loses a UNIQUE race to a concurrent request answers 409 ``conflict``, not a 500.

    The race is made deterministic: the winner's row exists before the call and the loser's lookup is
    patched to miss it, so the request reaches the INSERT exactly as a concurrent loser would.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'race_officer', [
            'hr.payroll.read', 'hr.payroll.manage', 'hr.payroll.config', 'hr.employees.read',
        ])
        cls.Event = cls.env['webvue.hr.audit.event']
        cls.worker = cls.make_employee(cls, 'Race Worker')
        cls.set_compensation(cls, cls.worker, 9000, gosi_registration_date=date(2020, 1, 1))
        cls.leaver = cls.make_employee(cls, 'Race Leaver', start=date(2023, 12, 1))
        cls.set_compensation(cls, cls.leaver, 8000, 2000, 500, gosi_registration_date=date(2020, 1, 1))
        cls.leaver.write({
            'departure_date': DEPARTURE, 'departure_reason_id': cls.env.ref('hr.departure_resigned').id,
        })

    def setUp(self):
        super().setUp()
        self.authenticate(self.officer.login, f'{self.officer.login}_pass_123')

    def _events(self):
        self.env.invalidate_all()
        return self.Event.search_count([])

    def _assert_conflict(self, res):
        self.assertEqual(res.status_code, 409, res.text)
        self.assertEqual(res.json()['code'], 'conflict')

    def _missing_lookup(self, model, method, domain):
        """Patch ``model.method`` to miss the rows of ``domain``, like a request that read before the winner."""
        cls = type(self.env[model])
        original = getattr(cls, method)

        def lookup(records, search_domain, *args, **kwargs):
            if list(search_domain) == domain:
                return 0 if method == 'search_count' else records.browse()
            return original(records, search_domain, *args, **kwargs)
        return patch.object(cls, method, lookup)

    def test_sequential_duplicate_run_keeps_its_422(self):
        self.assertEqual(self.api('POST', RUNS, json={'month': MONTH}).status_code, 201)
        res = self.api('POST', RUNS, json={'month': MONTH})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual((res.json()['code'], res.json()['field']), ('duplicate', 'month'))

    def test_run_race_loser_answers_409(self):
        self.env['hr.payslip.run']._webvue_create_month(MONTH_START)
        self.env.flush_all()
        events = self._events()
        domain = [('company_id', '=', self.env.company.id), ('date_start', '=', MONTH_START)]
        with self._missing_lookup('hr.payslip.run', 'search_count', domain), mute_logger('odoo.sql_db'):
            res = self.api('POST', RUNS, json={'month': MONTH})
        self._assert_conflict(res)
        listed = self.api('GET', f'{RUNS}?year=2026')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([run['month'] for run in listed.json()['items']], [MONTH])
        self.assertEqual(self._events(), events)

    def test_compensation_race_loser_answers_409(self):
        employee = self.make_employee('Race Newcomer')
        self.set_compensation(employee, 5000)
        self.env.flush_all()
        events = self._events()
        domain = [('employee_id', '=', employee.id)]
        with self._missing_lookup('webvue.hr.compensation', 'search', domain), mute_logger('odoo.sql_db'):
            res = self.api('PUT', f'{COMPENSATION}/{employee.id}', json=PUT_COMPENSATION)
        self._assert_conflict(res)
        read = self.api('GET', f'{COMPENSATION}/{employee.id}')
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual(float(read.json()['basic_wage']), 5000)
        self.assertEqual(self._events(), events)

    def test_settlement_race_loser_answers_409(self):
        Settlement = self.env['webvue.hr.payroll.eos.settlement']
        winner = Settlement._webvue_save_draft(self.leaver, 'resignation', 0)
        self.env.flush_all()
        events = self._events()
        with patch.object(type(Settlement), '_webvue_current', lambda records, employee: records.browse()), \
                mute_logger('odoo.sql_db'):
            res = self.api('PUT', f'{EOS}/{self.leaver.id}/settlement', json={'case': 'termination', 'open_deductions': 0})
        self._assert_conflict(res)
        read = self.api('GET', f'{EOS}/{self.leaver.id}/settlement')
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual((read.json()['id'], read.json()['case']), (winner.id, 'resignation'))
        self.assertEqual(Settlement.search_count([('employee_id', '=', self.leaver.id)]), 1)
        self.assertEqual(self._events(), events)

    def test_gosi_rate_race_loser_answers_409(self):
        Rate = self.env['webvue.hr.gosi.rate']
        Rate.create({**RACE_RATE, 'company_id': self.env.company.id})
        self.env.flush_all()
        events = self._events()
        domain = [
            ('branch', '=', 'annuities'), ('nationality_class', '=', 'gcc'),
            ('date_from', '=', date(2031, 1, 1)), ('company_id', '=', self.env.company.id),
        ]
        with self._missing_lookup('webvue.hr.gosi.rate', 'search_count', domain), mute_logger('odoo.sql_db'):
            res = self.api('POST', RATES, json=RACE_RATE)
        self._assert_conflict(res)
        listed = self.api('GET', RATES)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(Rate.search_count(domain), 1)
        self.assertEqual(self._events(), events)

    def test_sequential_duplicate_gosi_rate_keeps_its_422(self):
        self.assertEqual(self.api('POST', RATES, json=RACE_RATE).status_code, 201)
        res = self.api('POST', RATES, json=RACE_RATE)
        self.assertEqual((res.status_code, res.json()['field']), (422, 'date_from'), res.text)
