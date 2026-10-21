# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import io
from dataclasses import replace
from datetime import date
from decimal import Decimal

from odoo.tests import tagged

from .payroll_common import PayrollCase
from odoo.addons.webvue_hr.models.payroll_export import FORMULA_STARTS
from odoo.addons.webvue_hr.rules import WebVueHrRule

RUNS = '/api/v1/hr/payroll/runs'
PROFILES = '/api/v1/hr/payroll/bank-profiles'
MONTH = '2026-11'
IBAN_ONE = 'SA0380000000608010167519'
IBAN_TWO = 'SA4420000001234567891234'
ARABIC_NAME = 'أحمد الغامدي'
PROFILE_KEYS = {'id', 'name', 'kind', 'delimiter', 'encoding', 'include_header', 'footer', 'columns', 'shared'}
COLUMN_KEYS = {'source', 'label', 'constant_value'}
STATEMENT_KEYS = {'month', 'lines', 'totals'}
STATEMENT_LINE_KEYS = {
    'employee', 'gosi_number', 'nationality_class', 'contributory_wage', 'branches', 'employee_amount',
    'employer_amount',
}


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollFiles(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(
            cls, 'file_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'],
        )
        cls.approver = cls.payroll_user(
            cls, 'file_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'],
        )
        cls.config = cls.payroll_user(cls, 'file_config', ['hr.payroll.read', 'hr.payroll.config', 'hr.employees.read'])
        cls.no_payroll = cls.payroll_user(cls, 'file_plain', ['hr.employees.read'])
        cls.employee_one = cls.make_employee(cls, ARABIC_NAME)
        cls.employee_two = cls.make_employee(cls, 'Second Hand', country='EG')
        cls.set_compensation(
            cls, cls.employee_one, 10000, 2500, 1000, iban=IBAN_ONE, gosi_registration_date=date(2020, 1, 1),
        )
        cls.set_compensation(cls, cls.employee_two, 6000, 1500, iban=IBAN_TWO)
        cls.generic = cls.env.ref('webvue_hr.profile_generic_csv')
        cls.wps = cls.env.ref('webvue_hr.profile_mudad_wps')

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _run(self, approve=True, deduction_of=None):
        """The run of the test month; ``deduction_of`` is an employee whose whole pay is deducted (net 0)."""
        self._login(self.officer)
        run = self.api('POST', RUNS, json={'month': MONTH}).json()
        record = self.env['hr.payslip.run'].browse(run['id'])
        if deduction_of:
            slip = record.slip_ids.filtered(lambda row: row.employee_id == deduction_of)
            record._webvue_set_inputs(slip, {'WV_DEDUCTION': 5000})
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        if approve:
            self._login(self.approver)
            res = self.api('POST', f"{RUNS}/{run['id']}/approve")
            self.assertEqual(res.status_code, 200, res.text)
            self._login(self.officer)
        return run['id']

    def _rows(self, res, delimiter=','):
        return list(csv.reader(io.StringIO(res.content.decode('utf-8-sig'), newline=''), delimiter=delimiter))

    def test_bank_file_generic_csv(self):
        run_id = self._run()
        res = self.api('GET', f'{RUNS}/{run_id}/bank-file?profile_id={self.generic.id}&value_date=2026-12-01')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.headers['Content-Type'], 'text/csv; charset=utf-8')
        self.assertIn('salaries-2026-11.csv', res.headers['Content-Disposition'])
        text = res.content.decode('utf-8')
        self.assertIn('\r\n', text)
        self.assertNotIn('٫', text)
        self.assertFalse([char for char in text if '٠' <= char <= '٩'])
        rows = self._rows(res)
        self.assertEqual(rows[0], self.generic.column_ids.sorted('sequence').mapped('label'))
        by_name = {row[1]: row for row in rows[1:]}
        self.assertEqual(set(by_name), {ARABIC_NAME, 'Second Hand'})
        one = by_name[ARABIC_NAME]
        self.assertIn('12281.25', one)
        self.assertIn(IBAN_ONE, one)
        self.assertEqual(one[3:], ['10000.00', '2500.00', '1000.00', '1218.75', '12281.25', '2026-12-01'])

    def test_bank_file_refuses_employee_without_iban(self):
        nameless = self.make_employee('No Iban')
        self.set_compensation(nameless, 4000, iban=None, gosi_registration_date=date(2020, 1, 1))
        run_id = self._run()
        res = self.api('GET', f'{RUNS}/{run_id}/bank-file?profile_id={self.generic.id}')
        self.assertEqual(res.status_code, 422, res.text)
        body = res.json()
        self.assertEqual(body['code'], 'missing_iban')
        self.assertEqual(body['details'], {'employee_ids': [nameless.id]})

    def test_bank_file_skips_zero_net_line(self):
        zero = self.make_employee('Zero Net', country='EG')
        self.set_compensation(zero, 5000, iban=None)
        run_id = self._run(deduction_of=zero)
        res = self.api('GET', f'{RUNS}/{run_id}/bank-file?profile_id={self.generic.id}')
        self.assertEqual(res.status_code, 200, res.text)
        names = [row[1] for row in self._rows(res)[1:]]
        self.assertNotIn('Zero Net', names)
        self.assertEqual(len(names), 2)

    def test_wps_totals_rule_holds_for_every_line(self):
        run_id = self._run()
        res = self.api('GET', f'{RUNS}/{run_id}/wps-file?profile_id={self.wps.id}')
        self.assertEqual(res.status_code, 200, res.text)
        rows = self._rows(res)
        self.assertEqual(rows[0], self.wps.column_ids.sorted('sequence').mapped('label'))
        for row in rows[1:]:
            basic, housing, other, deductions, net = (Decimal(value) for value in row[3:])
            self.assertEqual(basic + housing + other - deductions, net, row)
        run = self.env['hr.payslip.run'].browse(run_id)
        lines = self.env['webvue.hr.payroll.export']._webvue_salary_lines(run)
        self.assertEqual(len(lines), 2)
        self.env['webvue.hr.payroll.export']._webvue_check_totals(lines)
        broken = replace(lines[0], net=lines[0].net + Decimal('0.01'))
        with self.assertRaises(WebVueHrRule) as refusal:
            self.env['webvue.hr.payroll.export']._webvue_check_totals([broken])
        self.assertEqual(refusal.exception.code, 'wps_totals_mismatch')
        self.assertEqual(refusal.exception.details, {'employee_ids': [broken.employee_id]})

    def test_wps_keeps_zero_net_line(self):
        zero = self.make_employee('Zero Net', country='EG')
        self.set_compensation(zero, 5000, iban=None)
        run_id = self._run(deduction_of=zero)
        res = self.api('GET', f'{RUNS}/{run_id}/wps-file?profile_id={self.wps.id}')
        self.assertEqual(res.status_code, 200, res.text)
        rows = {row[0]: row for row in self._rows(res)[1:]}
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows['Zero Net'][-1], '0.00')

    def test_profile_delimiter_and_bom(self):
        profile = self.env['webvue.hr.payroll.bank.profile'].create({
            'name': 'Semicolon', 'kind': 'bank', 'delimiter': ';', 'encoding': 'utf-8-sig',
            'company_id': self.env.company.id,
            'column_ids': [(0, 0, {'sequence': 1, 'source': 'name', 'label': 'Name'}),
                           (0, 0, {'sequence': 2, 'source': 'net', 'label': 'Net'})],
        })
        run_id = self._run()
        res = self.api('GET', f'{RUNS}/{run_id}/bank-file?profile_id={profile.id}')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.content.startswith('﻿'.encode()))
        self.assertEqual(self._rows(res, ';')[0], ['Name', 'Net'])
        self.assertIn(f'{ARABIC_NAME};12281.25', res.content.decode('utf-8-sig'))

    def test_formula_injection_is_neutralised_in_text_columns(self):
        hostile = self.make_employee('=HYPERLINK("http://x")', country='EG')
        self.assertTrue("\t" in FORMULA_STARTS and "\r" in FORMULA_STARTS)
        self.set_compensation(hostile, 3000, iban=IBAN_TWO)
        run_id = self._run()
        res = self.api('GET', f'{RUNS}/{run_id}/bank-file?profile_id={self.generic.id}')
        self.assertEqual(res.status_code, 200, res.text)
        names = [row[1] for row in self._rows(res)[1:]]
        self.assertIn('\'=HYPERLINK("http://x")', names)
        self.assertFalse([name for name in names if name[:1] in '=+-@'])

    def test_files_need_an_approved_run(self):
        run_id = self._run(approve=False)
        for route, profile in (('bank-file', self.generic), ('wps-file', self.wps)):
            res = self.api('GET', f'{RUNS}/{run_id}/{route}?profile_id={profile.id}')
            self.assertEqual(res.status_code, 403, res.text)
            self.assertEqual(res.json()['code'], 'transition_forbidden')
        res = self.api('GET', f'{RUNS}/{run_id}/gosi-statement')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'transition_forbidden'))

    def test_files_need_the_payroll_read_capability_and_the_right_profile_kind(self):
        run_id = self._run()
        res = self.api('GET', f'{RUNS}/{run_id}/bank-file?profile_id={self.wps.id}')
        self.assertEqual((res.status_code, res.json()['field']), (422, 'profile_id'))
        res = self.api('GET', f'{RUNS}/{run_id}/wps-file?profile_id={self.generic.id}')
        self.assertEqual((res.status_code, res.json()['field']), (422, 'profile_id'))
        self.assertEqual(self.api('GET', f'{RUNS}/{run_id}/bank-file').status_code, 200)
        self._login(self.no_payroll)
        for route in ('bank-file', 'wps-file', 'gosi-statement'):
            self.assertEqual(self.api('GET', f'{RUNS}/{run_id}/{route}').status_code, 403)

    def test_gosi_statement_totals(self):
        run_id = self._run()
        res = self.api('GET', f'{RUNS}/{run_id}/gosi-statement')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), STATEMENT_KEYS)
        self.assertEqual(body['month'], MONTH)
        self.assertEqual(body['totals'], {
            'contributory_wage': 20000.0, 'employee_amount': 1218.75, 'employer_amount': 1618.75,
        })
        lines = {line['employee']['id']: line for line in body['lines']}
        for line in lines.values():
            self.assertEqual(set(line), STATEMENT_LINE_KEYS)
        one = lines[self.employee_one.id]
        self.assertEqual(one['nationality_class'], 'saudi_before_2024')
        self.assertEqual(one['contributory_wage'], 12500.0)
        self.assertEqual(one['branches']['annuities'], {'employee': 1125.0, 'employer': 1125.0})
        self.assertEqual((one['employee_amount'], one['employer_amount']), (1218.75, 1468.75))
        two = lines[self.employee_two.id]
        self.assertEqual(two['nationality_class'], 'non_saudi')
        self.assertEqual((two['employee_amount'], two['employer_amount']), (0.0, 150.0))

    def test_gosi_statement_reports_the_capped_wage(self):
        rich = self.make_employee('Rich Hand')
        self.set_compensation(rich, 50000, 10000, iban=IBAN_TWO, gosi_registration_date=date(2020, 1, 1))
        poor = self.make_employee('Poor Hand')
        self.set_compensation(poor, 1000, iban=IBAN_TWO, gosi_registration_date=date(2020, 1, 1))
        run_id = self._run()
        lines = {line['employee']['id']: line for line in self.api('GET', f'{RUNS}/{run_id}/gosi-statement').json()['lines']}
        self.assertEqual(lines[rich.id]['contributory_wage'], 45000.0)
        self.assertEqual(lines[rich.id]['branches']['annuities']['employee'], 4050.0)
        self.assertEqual(lines[poor.id]['contributory_wage'], 1500.0)
        self.assertEqual(lines[poor.id]['branches']['annuities']['employee'], 135.0)

    def test_gosi_statement_reads_snapshots_after_approval(self):
        run_id = self._run()
        compensation = self.env['webvue.hr.compensation'].search([('employee_id', '=', self.employee_one.id)])
        compensation.write({'gosi_registration_date': False})
        self.env['webvue.hr.compensation'].search([('employee_id', '=', self.employee_two.id)]).unlink()
        res = self.api('GET', f'{RUNS}/{run_id}/gosi-statement')
        self.assertEqual(res.status_code, 200, res.text)
        classes = {line['employee']['id']: line['nationality_class'] for line in res.json()['lines']}
        self.assertEqual(classes, {self.employee_one.id: 'saudi_before_2024', self.employee_two.id: 'non_saudi'})

    def test_other_company_profile_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Other Files Co'})
        profile = self.env['webvue.hr.payroll.bank.profile'].create({
            'name': 'Theirs', 'kind': 'bank', 'company_id': other.id,
            'column_ids': [(0, 0, {'source': 'name', 'label': 'Name'})],
        })
        self.officer.company_ids |= other
        self.config.company_ids |= other
        run_id = self._run()
        res = self.api('GET', f'{RUNS}/{run_id}/bank-file?profile_id={profile.id}')
        self.assertEqual(res.status_code, 404, res.text)
        self._login(self.config)
        self.assertEqual(self.api('DELETE', f'{PROFILES}/{profile.id}').status_code, 404)

    def test_shared_profile_is_read_only(self):
        self._login(self.config)
        res = self.api('GET', PROFILES)
        self.assertEqual(res.status_code, 200, res.text)
        items = {item['id']: item for item in res.json()['items']}
        self.assertEqual(set(items[self.generic.id]), PROFILE_KEYS)
        self.assertTrue(items[self.generic.id]['shared'])
        self.assertEqual(self.api('PATCH', f'{PROFILES}/{self.generic.id}', json={'name': 'x'}).status_code, 403)
        self.assertEqual(self.api('DELETE', f'{PROFILES}/{self.generic.id}').status_code, 403)
        self.assertEqual(self.generic.name, self.env.ref('webvue_hr.profile_generic_csv').name)

    def test_profile_crud_needs_config(self):
        body = {
            'name': 'Mine', 'kind': 'bank', 'delimiter': ';', 'encoding': 'utf-8-sig', 'include_header': False,
            'footer': 'totals',
            'columns': [{'source': 'name', 'label': 'Name'}, {'source': 'constant', 'label': 'Bank', 'constant_value': 'RJHI'}],
        }
        self._login(self.officer)
        self.assertEqual(self.api('GET', PROFILES).status_code, 200)
        self.assertEqual(self.api('POST', PROFILES, json=body).status_code, 403)
        self._login(self.config)
        res = self.api('POST', PROFILES, json=body)
        self.assertEqual(res.status_code, 201, res.text)
        created = res.json()
        self.assertEqual(set(created), PROFILE_KEYS)
        self.assertFalse(created['shared'])
        self.assertEqual([set(column) for column in created['columns']], [COLUMN_KEYS, COLUMN_KEYS])
        self.assertEqual(created['columns'][1]['constant_value'], 'RJHI')
        res = self.api('PATCH', f"{PROFILES}/{created['id']}", json={'columns': [{'source': 'net', 'label': 'Net'}]})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual([column['source'] for column in res.json()['columns']], ['net'])
        res = self.api('POST', PROFILES, json={**body, 'columns': [{'source': 'constant', 'label': 'Bank'}]})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'columns'))
        res = self.api('POST', PROFILES, json={**body, 'delimiter': 'x'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'delimiter'))
        self.assertEqual(self.api('DELETE', f"{PROFILES}/{created['id']}").status_code, 204)
        self.assertEqual(self.api('DELETE', f"{PROFILES}/{created['id']}").status_code, 404)
