# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .payroll_common import PayrollCase

SETTINGS_KEYS = {'day_divisor', 'structure', 'unpaid_leave_types', 'annual_leave_type'}
RATE_KEYS = {
    'id', 'branch', 'nationality_class', 'date_from', 'employee_rate', 'employer_rate',
    'wage_min', 'wage_max', 'shared',
}
GCC_RATE = {
    'branch': 'annuities', 'nationality_class': 'gcc', 'date_from': '2026-01-01',
    'employee_rate': 9, 'employer_rate': 9, 'wage_min': 1500, 'wage_max': 45000,
}


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollSettings(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reader = cls.payroll_user(cls, 'set_reader', ['hr.payroll.read', 'hr.employees.read'])
        cls.manager = cls.payroll_user(cls, 'set_manager', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.config = cls.payroll_user(cls, 'set_config', ['hr.payroll.read', 'hr.payroll.config', 'hr.employees.read'])

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def test_settings_defaults_without_record(self):
        self.env['webvue.hr.payroll.settings'].search([]).unlink()
        self._login(self.reader)
        res = self.api('GET', '/api/v1/hr/payroll/settings')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), SETTINGS_KEYS)
        self.assertEqual(body['day_divisor'], 30)
        unpaid = self.env.ref('hr_holidays.leave_type_unpaid')
        self.assertIn(unpaid.id, [item['id'] for item in body['unpaid_leave_types']])
        self.assertEqual(body['annual_leave_type']['id'], self.env.ref('hr_holidays.leave_type_paid_time_off').id)
        self.assertFalse(self.env['webvue.hr.payroll.settings'].search_count([]))

    def test_only_config_edits_settings_and_rates(self):
        path = '/api/v1/hr/payroll/settings'
        self._login(self.manager)
        self.assertEqual(self.api('PATCH', path, json={'day_divisor': 28}).status_code, 403)
        self.assertEqual(self.api('POST', '/api/v1/hr/payroll/gosi-rates', json=GCC_RATE).status_code, 403)
        self._login(self.config)
        res = self.api('PATCH', path, json={'day_divisor': 28})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(set(res.json()), SETTINGS_KEYS)
        self.assertEqual(res.json()['day_divisor'], 28)
        self.assertEqual(self.env['webvue.hr.payroll.settings'].search_count([('company_id', '=', self.env.company.id)]), 1)
        res = self.api('PATCH', path, json={'day_divisor': 27})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'day_divisor'))
        res = self.api('PATCH', path, json={'structure_id': 0})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'structure_id'))

    def test_gosi_rates_list_envelope_and_crud(self):
        base = '/api/v1/hr/payroll/gosi-rates'
        self._login(self.reader)
        res = self.api('GET', base)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertEqual(body['total'], len(body['items']))
        self.assertTrue(body['items'] and all(set(item) == RATE_KEYS and item['shared'] for item in body['items']))
        self._login(self.config)
        res = self.api('POST', base, json=GCC_RATE)
        self.assertEqual(res.status_code, 201, res.text)
        created = res.json()
        self.assertEqual(set(created), RATE_KEYS)
        self.assertFalse(created['shared'])
        res = self.api('POST', base, json=GCC_RATE)
        self.assertEqual((res.status_code, res.json()['field']), (422, 'date_from'))
        res = self.api('PATCH', f'{base}/{created["id"]}', json={'employer_rate': 10})
        self.assertEqual((res.status_code, res.json()['employer_rate']), (200, 10.0))
        res = self.api('PATCH', f'{base}/{created["id"]}', json={'wage_max': 100})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'wage_max'))
        res = self.api('DELETE', f'{base}/{created["id"]}')
        self.assertEqual(res.status_code, 204, res.text)
        self.assertEqual(self.api('DELETE', f'{base}/{created["id"]}').status_code, 404)
