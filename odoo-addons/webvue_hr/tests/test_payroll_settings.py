# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .payroll_common import PayrollCase

SETTINGS_KEYS = {'day_divisor', 'structure', 'unpaid_leave_types', 'annual_leave_type', 'revision'}
RATE_KEYS = {
    'id', 'branch', 'nationality_class', 'date_from', 'employee_rate', 'employer_rate',
    'wage_min', 'wage_max', 'shared', 'revision',
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
        self.assertEqual((body['day_divisor'], body['revision']), (30, 0))
        unpaid = self.env.ref('hr_holidays.leave_type_unpaid')
        self.assertIn(unpaid.id, [item['id'] for item in body['unpaid_leave_types']])
        self.assertEqual(body['annual_leave_type']['id'], self.env.ref('hr_holidays.leave_type_paid_time_off').id)
        self.assertFalse(self.env['webvue.hr.payroll.settings'].search_count([]))

    def test_only_config_edits_settings_and_rates(self):
        path = '/api/v1/hr/payroll/settings'
        self._login(self.manager)
        self.assertEqual(self.api('PATCH', path, json={'day_divisor': 28, 'revision': 0}).status_code, 403)
        self.assertEqual(self.api('POST', '/api/v1/hr/payroll/gosi-rates', json=GCC_RATE).status_code, 403)
        self._login(self.config)
        revision = self.api('GET', path).json()['revision']
        res = self.api('PATCH', path, json={'day_divisor': 28, 'revision': revision})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(set(res.json()), SETTINGS_KEYS)
        self.assertEqual(res.json()['day_divisor'], 28)
        self.assertEqual(self.env['webvue.hr.payroll.settings'].search_count([('company_id', '=', self.env.company.id)]), 1)
        revision = res.json()['revision']
        res = self.api('PATCH', path, json={'day_divisor': 27, 'revision': revision})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'day_divisor'))
        res = self.api('PATCH', path, json={'structure_id': 0, 'revision': revision})
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
        self.assertEqual(created['revision'], 1)
        res = self.api('PATCH', f'{base}/{created["id"]}', json={'employer_rate': 10, 'revision': 1})
        self.assertEqual((res.status_code, res.json()['employer_rate'], res.json()['revision']), (200, 10.0, 2))
        res = self.api('PATCH', f'{base}/{created["id"]}', json={'wage_max': 100, 'revision': 2})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'wage_max'))
        res = self.api('DELETE', f'{base}/{created["id"]}', json={'revision': 2})
        self.assertEqual(res.status_code, 204, res.text)
        self.assertEqual(self.api('DELETE', f'{base}/{created["id"]}', json={'revision': 2}).status_code, 404)

    def test_shared_gosi_rate_is_read_only(self):
        base = '/api/v1/hr/payroll/gosi-rates'
        shared = self.env['webvue.hr.gosi.rate'].search([('company_id', '=', False), ('branch', '=', 'annuities')], limit=1)
        before = (shared.employee_rate, shared.employer_rate)
        self._login(self.config)
        self.assertEqual(self.api('PATCH', f'{base}/{shared.id}', json={'employee_rate': 0, 'revision': shared.revision}).status_code, 403)
        self.assertEqual(self.api('DELETE', f'{base}/{shared.id}', json={'revision': shared.revision}).status_code, 403)
        shared.invalidate_recordset()
        self.assertTrue(shared.exists())
        self.assertEqual((shared.employee_rate, shared.employer_rate), before)
        self.assertEqual(self.env.user.env['webvue.hr.gosi.rate'].browse(shared.id).exists(), shared)

    def test_a_rate_of_another_company_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Other GOSI Co'})
        foreign = self.env['webvue.hr.gosi.rate'].create({
            **{key: GCC_RATE[key] for key in ('branch', 'nationality_class', 'employee_rate', 'employer_rate', 'wage_min', 'wage_max')},
            'date_from': '2026-01-01', 'company_id': other.id,
        })
        base = '/api/v1/hr/payroll/gosi-rates'
        self._login(self.config)
        self.assertEqual(self.api('PATCH', f'{base}/{foreign.id}', json={'employer_rate': 1, 'revision': 1}).status_code, 404)
        self.assertEqual(self.api('DELETE', f'{base}/{foreign.id}', json={'revision': 1}).status_code, 404)
        self.assertTrue(foreign.exists())

    def test_the_orm_refuses_a_payroll_user_writing_a_shared_rate(self):
        shared = self.env['webvue.hr.gosi.rate'].search([('company_id', '=', False)], limit=1)
        with self.assertRaises(AccessError):
            shared.with_user(self.config).write({'employee_rate': 0})
        with self.assertRaises(AccessError):
            shared.with_user(self.config).unlink()
