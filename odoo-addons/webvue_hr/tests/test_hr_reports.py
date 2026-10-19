# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase

SAUDI_ROW_KEYS = {'department', 'total', 'saudi', 'non_saudi', 'unknown', 'saudi_percent'}
EXPIRING_KEYS = {'kind', 'employee', 'document', 'due_date', 'days_left'}


def _in_days(days):
    return fields.Date.to_string(fields.Date.today() + timedelta(days=days))


@tagged('post_install', '-at_install', 'webvue')
class TestHrExpiring(WebVueHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='hr_expiry_admin', password='hr_expiry_admin_pass_123',
            name='Expiry Admin', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': cls.env.company.id,
        }])
        cls.dept = cls.env['hr.department'].create({'name': 'Expiry Dept'})
        cls.soon = cls.env['hr.employee'].create({
            'name': 'Soon Employee',
            'contract_date_start': '2025-01-01',
            'contract_date_end': _in_days(30),
            'trial_date_end': _in_days(10),
            'identification_expiration_date': _in_days(45),
        })
        cls.far = cls.env['hr.employee'].create({
            'name': 'Far Employee',
            'contract_date_start': '2025-01-01',
            'contract_date_end': _in_days(200),
        })
        cls.past = cls.env['hr.employee'].create({
            'name': 'Past Employee',
            'contract_date_start': '2025-01-01',
            'trial_date_end': _in_days(-5),
            'identification_expiration_date': _in_days(-1),
        })

    def _expiring(self, query=''):
        self.authenticate('hr_expiry_admin', 'hr_expiry_admin_pass_123')
        return self.api('GET', f'/api/v1/hr/expiring{query}')

    def test_default_window_sorted_by_due_date(self):
        res = self._expiring()
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(
            [(item['kind'], item['days_left']) for item in body['items']],
            [
                ('probation_end', -5), ('identity', -1), ('probation_end', 10),
                ('contract_end', 30), ('identity', 45),
            ],
        )
        self.assertEqual(body['total'], 5)
        self.assertTrue(all(set(item) == EXPIRING_KEYS for item in body['items']))
        self.assertEqual([item['due_date'] for item in body['items']], sorted(item['due_date'] for item in body['items']))

    def test_employee_refs(self):
        items = {item['kind']: item for item in self._expiring().json()['items']}
        self.assertEqual(items['identity']['employee'], {'id': self.soon.id, 'name': 'Soon Employee'})
        self.assertIsNone(items['identity']['document'])
        self.assertEqual(items['contract_end']['due_date'], _in_days(30))

    def test_within_days_narrows_and_widens_the_window(self):
        narrow = self._expiring('?within_days=15').json()
        self.assertEqual(
            [item['days_left'] for item in narrow['items']], [-5, -1, 10],
        )
        wide = self._expiring('?within_days=365').json()
        self.assertEqual(wide['total'], 6)
        self.assertIn(self.far.id, [i['employee']['id'] for i in wide['items'] if i['employee']])

    def test_archived_employees_are_left_out(self):
        self.soon._webvue_archive()
        body = self._expiring('?within_days=365').json()
        ids = {item['employee']['id'] for item in body['items'] if item['employee']}
        self.assertNotIn(self.soon.id, ids)
        self.assertIn(self.past.id, ids)

    def test_overdue_items_come_first_with_negative_days_left(self):
        items = self._expiring().json()['items']
        overdue = [item for item in items if item['days_left'] < 0]
        self.assertEqual(items[:len(overdue)], overdue)
        expired_iqama = next(i for i in items if i['kind'] == 'identity' and i['days_left'] < 0)
        self.assertEqual(expired_iqama['employee']['id'], self.past.id)
        self.assertEqual(expired_iqama['due_date'], _in_days(-1))

    def test_ended_contract_of_an_active_employee_is_listed(self):
        ended = self.env['hr.employee'].create({
            'name': 'Ended Contract',
            'contract_date_start': '2024-01-01',
            'contract_date_end': _in_days(-3),
        })
        item = next(
            i for i in self._expiring().json()['items']
            if i['kind'] == 'contract_end' and i['employee']['id'] == ended.id
        )
        self.assertEqual(item['days_left'], -3)

    def test_window_without_upcoming_items_still_lists_overdue(self):
        body = self._expiring('?within_days=0').json()
        self.assertEqual([item['days_left'] for item in body['items']], [-5, -1])

    def test_invalid_within_days_is_422(self):
        for value in ('-1', '366', 'abc', '1.5'):
            with self.subTest(value=value):
                res = self._expiring(f'?within_days={value}')
                self.assertEqual(res.status_code, 422)
                self.assertEqual(res.json()['field'], 'within_days')

    def test_plain_employee_is_403(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/expiring')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')

    def test_other_company_records_are_not_listed(self):
        other = self.env['res.company'].create({'name': 'Expiry Other Co'})
        self.env['hr.employee'].create({
            'name': 'Foreign Employee', 'company_id': other.id,
            'contract_date_start': '2025-01-01',
            'contract_date_end': _in_days(5),
        })
        names = {
            (item['employee'] or item['document'])['name']
            for item in self._expiring().json()['items']
        }
        self.assertNotIn('Foreign Employee', names)


@tagged('post_install', '-at_install', 'webvue')
class TestHrSaudization(WebVueHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='hr_saud_admin', password='hr_saud_admin_pass_123',
            name='Saudization Admin', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': cls.env.company.id,
        }])
        cls.saudi = cls.env.ref('base.sa')
        cls.egypt = cls.env.ref('base.eg')
        cls.dept_a = cls.env['hr.department'].create({'name': 'Saud A'})
        cls.dept_b = cls.env['hr.department'].create({'name': 'Saud B'})
        Employee = cls.env['hr.employee']
        for name, dept, country in (
            ('A1', cls.dept_a, cls.saudi), ('A2', cls.dept_a, cls.saudi), ('A3', cls.dept_a, cls.egypt),
            ('B1', cls.dept_b, cls.egypt), ('B2', cls.dept_b, cls.env['res.country']),
            ('N1', cls.env['hr.department'], cls.saudi),
        ):
            Employee.create({'name': name, 'department_id': dept.id, 'country_id': country.id})
        archived = Employee.create({'name': 'Gone', 'department_id': cls.dept_a.id, 'country_id': cls.egypt.id})
        archived._webvue_archive()

    def _report(self):
        self.authenticate('hr_saud_admin', 'hr_saud_admin_pass_123')
        return self.api('GET', '/api/v1/hr/saudization')

    def test_counts_overall_and_per_department(self):
        body = self._report().json()
        rows = {row['department']['name'] if row['department'] else None: row for row in body['items']}
        self.assertEqual(body['total'], len(body['items']))
        self.assertTrue(all(set(row) == SAUDI_ROW_KEYS for row in body['items']))
        self.assertEqual(rows['Saud A']['saudi'], 2)
        self.assertEqual(rows['Saud A']['non_saudi'], 1)
        self.assertEqual(rows['Saud A']['saudi_percent'], 66.67)
        self.assertEqual(rows['Saud B']['non_saudi'], 1)
        self.assertEqual(rows['Saud B']['unknown'], 1)
        self.assertEqual(rows['Saud B']['saudi_percent'], 0.0)
        self.assertEqual(rows[None]['saudi'], 1)
        self.assertEqual(rows[None]['saudi_percent'], 100.0)
        overall = body['overall']
        self.assertEqual(overall['total'], sum(row['total'] for row in body['items']))
        self.assertEqual(overall['saudi'], sum(row['saudi'] for row in body['items']))
        self.assertGreaterEqual(overall['saudi'], 3)

    def test_departmentless_row_sorts_last(self):
        items = self._report().json()['items']
        self.assertIsNone(items[-1]['department'])

    def test_no_known_nationality_gives_null_percent(self):
        report = self.env['webvue.hr.report']
        row = report._webvue_saudization_row({'saudi': 0, 'non_saudi': 0, 'unknown': 2})
        self.assertEqual(row, {'total': 2, 'saudi': 0, 'non_saudi': 0, 'unknown': 2, 'saudi_percent': None})

    def test_other_company_is_excluded(self):
        before = self._report().json()['overall']['total']
        other = self.env['res.company'].create({'name': 'Saud Other Co'})
        self.env['hr.employee'].create({
            'name': 'Foreign', 'company_id': other.id, 'country_id': self.saudi.id,
        })
        self.assertEqual(self._report().json()['overall']['total'], before)

    def test_plain_employee_is_403(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/saudization')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')
