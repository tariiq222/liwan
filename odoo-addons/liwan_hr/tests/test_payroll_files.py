# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import io
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged

from .common import set_hr_feature
from .payroll_common import PayrollCase
from odoo.addons.liwan_hr.models.payroll_export import FORMULA_STARTS
from odoo.addons.liwan_hr.rules import LiwanHrRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

RUNS = '/api/v1/hr/payroll/runs'
PROFILES = '/api/v1/hr/payroll/bank-profiles'
MONTH = '2026-11'
IBAN_ONE = 'SA0380000000608010167519'
IBAN_TWO = 'SA4420000001234567891234'
ARABIC_NAME = 'أحمد الغامدي'
PROFILE_KEYS = {'id', 'name', 'kind', 'delimiter', 'encoding', 'include_header', 'footer', 'columns', 'shared', 'revision'}
COLUMN_KEYS = {'source', 'label', 'constant_value'}
STATEMENT_KEYS = {'month', 'lines', 'totals'}
STATEMENT_LINE_KEYS = {
    'employee', 'gosi_number', 'nationality_class', 'contributory_wage', 'branches', 'employee_amount',
    'employer_amount',
}


@tagged('post_install', '-at_install', 'liwan')
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
        cls.generic = cls.env.ref('liwan_hr.profile_generic_csv')
        cls.wps = cls.env.ref('liwan_hr.profile_mudad_wps')

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _run(self, approve=True, deduction_of=None):
        """The run of the test month; ``deduction_of`` is an employee whose whole pay is deducted (net 0)."""
        self._login(self.officer)
        run = self.api('POST', RUNS, json={'month': MONTH}).json()
        record = self.env['hr.payslip.run'].browse(run['id'])
        if deduction_of:
            slip = record.slip_ids.filtered(lambda row: row.employee_id == deduction_of)
            record._liwan_set_inputs(slip, {'WV_DEDUCTION': 5000})
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
        res = self.api('POST', f'{RUNS}/{run_id}/bank-file', json={'profile_id': self.generic.id, 'value_date': '2026-12-01'})
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

    def test_bank_file_refuses_a_payslip_approved_without_an_iban(self):
        """A run approved before 19.0.1.12.0 may hold a positive net with no IBAN stored: its files are refused."""
        nameless = self.make_employee('No Iban')
        self.set_compensation(nameless, 4000, iban=IBAN_TWO, gosi_registration_date=date(2020, 1, 1))
        run_id = self._run()
        slip = self.env['hr.payslip.run'].browse(run_id).slip_ids.filtered(lambda row: row.employee_id == nameless)
        self.env['liwan.hr.payslip.payment'].search([('payslip_id', '=', slip.id)]).iban = False
        res = self.api('POST', f'{RUNS}/{run_id}/bank-file', json={'profile_id': self.generic.id})
        self.assertEqual(res.status_code, 422, res.text)
        body = res.json()
        self.assertEqual(body['code'], 'missing_iban')
        self.assertEqual(body['details'], {'employee_ids': [nameless.id]})

    def test_bank_file_skips_zero_net_line(self):
        zero = self.make_employee('Zero Net', country='EG')
        self.set_compensation(zero, 5000, iban=None)
        run_id = self._run(deduction_of=zero)
        res = self.api('POST', f'{RUNS}/{run_id}/bank-file', json={'profile_id': self.generic.id})
        self.assertEqual(res.status_code, 200, res.text)
        names = [row[1] for row in self._rows(res)[1:]]
        self.assertNotIn('Zero Net', names)
        self.assertEqual(len(names), 2)

    def test_a_non_employee_relationship_never_blocks_the_salary_files(self):
        self.env['liwan.hr.compensation'].search([]).write({'relationship_type': 'other_cooperation'})
        run_id = self._run()
        for route, profile in (('bank-file', self.generic), ('wps-file', self.wps)):
            with self.subTest(route=route):
                res = self.api('POST', f'{RUNS}/{run_id}/{route}', json={'profile_id': profile.id})
                self.assertEqual(res.status_code, 200, res.text)

    def test_wps_totals_rule_holds_for_every_line(self):
        run_id = self._run()
        res = self.api('POST', f'{RUNS}/{run_id}/wps-file', json={'profile_id': self.wps.id})
        self.assertEqual(res.status_code, 200, res.text)
        rows = self._rows(res)
        self.assertEqual(rows[0], self.wps.column_ids.sorted('sequence').mapped('label'))
        for row in rows[1:]:
            basic, housing, other, deductions, net = (Decimal(value) for value in row[3:])
            self.assertEqual(basic + housing + other - deductions, net, row)
        run = self.env['hr.payslip.run'].browse(run_id)
        lines = self.env['liwan.hr.payroll.export']._liwan_salary_lines(run)
        self.assertEqual(len(lines), 2)
        self.env['liwan.hr.payroll.export']._liwan_check_totals(lines)
        broken = replace(lines[0], net=lines[0].net + Decimal('0.01'))
        with self.assertRaises(LiwanHrRule) as refusal:
            self.env['liwan.hr.payroll.export']._liwan_check_totals([broken])
        self.assertEqual(refusal.exception.code, 'wps_totals_mismatch')
        self.assertEqual(refusal.exception.details, {'employee_ids': [broken.employee_id]})

    def test_wps_keeps_zero_net_line(self):
        zero = self.make_employee('Zero Net', country='EG')
        self.set_compensation(zero, 5000, iban=None)
        run_id = self._run(deduction_of=zero)
        res = self.api('POST', f'{RUNS}/{run_id}/wps-file', json={'profile_id': self.wps.id})
        self.assertEqual(res.status_code, 200, res.text)
        rows = {row[0]: row for row in self._rows(res)[1:]}
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows['Zero Net'][-1], '0.00')

    def test_profile_delimiter_and_bom(self):
        profile = self.env['liwan.hr.payroll.bank.profile'].create({
            'name': 'Semicolon', 'kind': 'bank', 'delimiter': ';', 'encoding': 'utf-8-sig',
            'company_id': self.env.company.id,
            'column_ids': [(0, 0, {'sequence': 1, 'source': 'name', 'label': 'Name'}),
                           (0, 0, {'sequence': 2, 'source': 'net', 'label': 'Net'})],
        })
        run_id = self._run()
        res = self.api('POST', f'{RUNS}/{run_id}/bank-file', json={'profile_id': profile.id})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.content.startswith('﻿'.encode()))
        self.assertEqual(self._rows(res, ';')[0], ['Name', 'Net'])
        self.assertIn(f'{ARABIC_NAME};12281.25', res.content.decode('utf-8-sig'))

    def test_formula_injection_is_neutralised_in_text_columns(self):
        hostile = self.make_employee('=HYPERLINK("http://x")', country='EG')
        self.assertTrue("\t" in FORMULA_STARTS and "\r" in FORMULA_STARTS)
        self.set_compensation(hostile, 3000, iban=IBAN_TWO)
        run_id = self._run()
        res = self.api('POST', f'{RUNS}/{run_id}/bank-file', json={'profile_id': self.generic.id})
        self.assertEqual(res.status_code, 200, res.text)
        names = [row[1] for row in self._rows(res)[1:]]
        self.assertIn('\'=HYPERLINK("http://x")', names)
        self.assertFalse([name for name in names if name[:1] in '=+-@'])

    def test_salary_files_are_never_cached_or_sniffed(self):
        run_id = self._run()
        for route, profile in (('bank-file', self.generic), ('wps-file', self.wps)):
            res = self.api('POST', f'{RUNS}/{run_id}/{route}', json={'profile_id': profile.id})
            self.assertEqual(res.status_code, 200, res.text)
            self.assertEqual(res.headers['Cache-Control'], 'private, no-store', route)
            self.assertEqual(res.headers['X-Content-Type-Options'], 'nosniff', route)

    def test_salary_files_closed_with_payroll_feature_off(self):
        run_id = self._run()
        set_hr_feature(self, 'hr.payroll', False)
        for route, profile in (('bank-file', self.generic), ('wps-file', self.wps)):
            res = self.api('POST', f'{RUNS}/{run_id}/{route}', json={'profile_id': profile.id})
            self.assertEqual((res.status_code, res.json()['code']), (403, 'feature_not_included'), route)

    # --- owner decision 2026-10-26: no salary file is generated while the tenant is read-only -------------

    def _file_routes(self):
        return (('bank-file', self.generic), ('wps-file', self.wps))

    def _kept_and_logged(self, run_id):
        files = self.env['liwan.hr.payroll.file'].search_count([('run_id', '=', run_id)])
        events = self.env['liwan.hr.audit.event'].search_count([('action', '=', 'payment_file_generated')])
        return files, events

    def _tenant(self, **values):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(values)

    def _assert_read_only_refusal(self, run_id, kept):
        """Both files answer 403 ``tenant_read_only`` at the gateway: no file is built, kept or logged."""
        export = type(self.env['liwan.hr.payroll.export'])
        built = []
        original = export._liwan_salary_lines

        def spy(records, run):
            built.append(run.id)
            return original(records, run)
        self.patch(export, '_liwan_salary_lines', spy)
        for route, profile in self._file_routes():
            res = self.api('POST', f'{RUNS}/{run_id}/{route}', json={'profile_id': profile.id})
            self.assertEqual((res.status_code, res.json()['code']), (403, 'tenant_read_only'), route)
            self.assertNotIn(IBAN_ONE, res.text, route)
        self.assertEqual(built, [])
        self.assertEqual(self._kept_and_logged(run_id), kept)

    def _expire(self):
        """Expire the tenant; an independent (non-SaaS) tenant has no expiry and refuses the date instead."""
        expiry = {'valid_until': datetime.now(timezone.utc).date() - timedelta(days=1)}
        if self.env.ref('liwan_platform.tenant_profile').commercial_mode == 'non_saas':
            with self.assertRaises(ValidationError):
                self._tenant(**expiry)
            return False
        self._tenant(**expiry)
        return True

    def test_an_expired_tenant_refuses_both_salary_files_before_keeping_anything(self):
        run_id = self._run()
        if not self._expire():
            return
        self._login(self.officer)
        self._assert_read_only_refusal(run_id, (0, 0))
        # The rest of payroll stays readable: the GOSI statement and the run itself are reads.
        self.assertEqual(self.api('GET', f'{RUNS}/{run_id}/gosi-statement').status_code, 200)
        self.assertEqual(self.api('GET', f'{RUNS}/{run_id}').status_code, 200)

    def test_a_file_kept_before_the_expiry_is_refused_as_well(self):
        """The same bytes were kept while active: the expired tenant still gets no copy, kept or regenerated."""
        run_id = self._run()
        for route, profile in self._file_routes():
            self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/{route}', json={'profile_id': profile.id}).status_code, 200)
        self.assertEqual(self._kept_and_logged(run_id), (2, 2))
        if not self._expire():
            return
        self._assert_read_only_refusal(run_id, (2, 2))

    def test_a_suspended_tenant_refuses_the_support_login_both_salary_files(self):
        """Support may sign in to a suspended tenant read-only; it generates no salary file either."""
        run_id = self._run()
        support = self.env.ref('base.user_admin')
        self.assertTrue(support.has_group('liwan_core.group_vendor_support'))
        self.env['liwan.access.assignment'].create({
            'user_id': support.id, 'role_id': self.env.ref('liwan_hr.role_payroll_manager').id,
            'company_id': self.env.company.id,
        })
        self._tenant(status='suspended', support_access_enabled=True)
        self.authenticate('admin', 'admin')
        self.assertEqual(self.api('GET', f'{RUNS}/{run_id}').status_code, 200)
        self._assert_read_only_refusal(run_id, (0, 0))

    def test_a_full_storage_quota_refuses_the_file_and_keeps_no_partial_row(self):
        run_id = self._run()
        profile = self.env.ref('liwan_platform.tenant_profile')
        self._tenant(features={**profile.features, 'storage.limit_mb': 0})
        for route, file_profile in self._file_routes():
            res = self.api('POST', f'{RUNS}/{run_id}/{route}', json={'profile_id': file_profile.id})
            self.assertEqual(res.status_code, 403, res.text)
            self.assertEqual(
                (res.json()['code'], res.json()['details']),
                ('feature_not_included', {'reason': 'limit', 'limit_key': 'storage.limit_mb'}), route,
            )
        self.assertEqual(self._kept_and_logged(run_id), (0, 0))
        attachments = self.env['ir.attachment'].search_count([('res_model', '=', 'liwan.hr.payroll.file')])
        self.assertEqual(attachments, 0)

    def test_an_active_tenant_generates_and_keeps_each_distinct_file_once(self):
        run_id = self._run()
        for _attempt in range(2):
            for route, profile in self._file_routes():
                self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/{route}', json={'profile_id': profile.id}).status_code, 200)
        self.assertEqual(self._kept_and_logged(run_id), (2, 4))

    # --- CSRF: a file download writes, so it is a POST that only a same-site JSON request may make ---------------

    def _unsafe(self, route, headers=None, **kwargs):
        """A request the way a hostile page could send it: the session cookie rides along, the headers are its own."""
        path = f'{RUNS}/{self._csrf_run}/{route}'
        return self.url_open(path, headers=headers or {}, method=kwargs.pop('method', 'POST'), **kwargs)

    def test_a_cross_site_or_empty_non_json_request_gets_the_structured_refusal(self):
        """The controller guard answers with a structured code only where the framework lets a request reach it.

        Odoo's json2 dispatcher (``Json2Dispatcher.is_compatible_with``) accepts a request when its media type is
        ``application/json`` OR its body is empty; ``_set_request_dispatcher`` rejects anything else with a
        ``415 text/html`` before any Python of ours runs. So ``unsupported_media_type`` is reachable only for an
        EMPTY body with a wrong or missing media type; nonempty payloads are covered by the next test.
        """
        self._csrf_run = self._run()
        json_type = 'application/json'
        cases = (  # (label, request headers, expected status, expected response media type, expected code)
            ('cross-site JSON', {'Content-Type': json_type, 'Sec-Fetch-Site': 'cross-site'}, 403, json_type, 'cross_site_request'),
            ('same-site JSON', {'Content-Type': json_type, 'Sec-Fetch-Site': 'same-site'}, 403, json_type, 'cross_site_request'),
            ('empty body, form type', {'Content-Type': 'application/x-www-form-urlencoded'}, 415, json_type, 'unsupported_media_type'),
            ('empty body, text type', {'Content-Type': 'text/plain'}, 415, json_type, 'unsupported_media_type'),
            ('no content type', {}, 415, json_type, 'unsupported_media_type'),
        )
        for route, _profile in self._file_routes():
            for label, headers, status, media_type, code in cases:
                res = self._unsafe(route, headers)
                self.assertEqual(
                    (res.status_code, res.headers['Content-Type'].split(';')[0], res.json()['code']),
                    (status, media_type, code), f'{route} {label}',
                )
                self.assertNotIn(IBAN_ONE, res.text)
        self.assertEqual(self._kept_and_logged(self._csrf_run), (0, 0))

    def test_a_real_non_json_payload_is_rejected_by_the_framework_and_keeps_nothing(self):
        """Nonempty urlencoded, text and multipart bodies never reach the controller.

        Measured, not promised: the framework answers ``415`` as ``text/html`` with no structured ``code``. A
        malformed JSON body is a framework ``400`` answered as ``application/json`` by ``Json2Dispatcher.handle_error``.
        Each case carries its status and response media type, both asserted on the same response. The invariant that
        matters holds on every case: no file row, no audit event, no attachment, and no IBAN in the answer.
        """
        self._csrf_run = self._run()
        boundary = 'liwanboundary'
        multipart = (f'--{boundary}\r\nContent-Disposition: form-data; name="profile_id"\r\n\r\n1\r\n--{boundary}--\r\n').encode()
        html, json_type = 'text/html', 'application/json'
        payloads = (  # (label, request headers, body, expected status, expected response media type)
            ('urlencoded', {'Content-Type': 'application/x-www-form-urlencoded'}, b'profile_id=1&value_date=2026-10-31', 415, html),
            ('text/plain', {'Content-Type': 'text/plain'}, b'profile_id=1', 415, html),
            ('multipart', {'Content-Type': f'multipart/form-data; boundary={boundary}'}, multipart, 415, html),
            ('malformed JSON', {'Content-Type': json_type}, b'{"profile_id": ', 400, json_type),
        )
        for route, _profile in self._file_routes():
            for label, headers, data, status, media_type in payloads:
                res = self._unsafe(route, headers, data=data)
                self.assertEqual(
                    (res.status_code, res.headers['Content-Type'].split(';')[0]),
                    (status, media_type), f'{route} {label}: {res.text[:200]}',
                )
                self.assertNotIn(IBAN_ONE, res.text)
        self.assertEqual(self._kept_and_logged(self._csrf_run), (0, 0))
        self.assertEqual(self.env['ir.attachment'].search_count([('res_model', '=', 'liwan.hr.payroll.file')]), 0)

    def test_a_get_request_no_longer_generates_a_file(self):
        self._csrf_run = self._run()
        for route, _profile in self._file_routes():
            self.assertEqual(self._unsafe(route, method='GET').status_code, 405, route)
        self.assertEqual(self._kept_and_logged(self._csrf_run), (0, 0))

    def test_a_same_origin_json_request_generates_and_keeps_the_file(self):
        self._csrf_run = self._run()
        for route, _profile in self._file_routes():
            res = self._unsafe(route, {'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin'}, data=b'{}')
            self.assertEqual(res.status_code, 200, f'{route}: {res.text[:200]}')
        self.assertEqual(self._kept_and_logged(self._csrf_run), (2, 2))

    def test_files_need_an_approved_run(self):
        run_id = self._run(approve=False)
        for route, profile in (('bank-file', self.generic), ('wps-file', self.wps)):
            res = self.api('POST', f'{RUNS}/{run_id}/{route}', json={'profile_id': profile.id})
            self.assertEqual(res.status_code, 403, res.text)
            self.assertEqual(res.json()['code'], 'transition_forbidden')
        res = self.api('GET', f'{RUNS}/{run_id}/gosi-statement')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'transition_forbidden'))

    def test_files_need_the_payroll_read_capability_and_the_right_profile_kind(self):
        run_id = self._run()
        res = self.api('POST', f'{RUNS}/{run_id}/bank-file', json={'profile_id': self.wps.id})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'profile_id'))
        res = self.api('POST', f'{RUNS}/{run_id}/wps-file', json={'profile_id': self.generic.id})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'profile_id'))
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/bank-file', json={}).status_code, 200)
        self._login(self.no_payroll)
        for route in ('bank-file', 'wps-file'):
            self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/{route}', json={}).status_code, 403)
        self.assertEqual(self.api('GET', f'{RUNS}/{run_id}/gosi-statement').status_code, 403)

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
        compensation = self.env['liwan.hr.compensation'].search([('employee_id', '=', self.employee_one.id)])
        compensation.write({'gosi_registration_date': False})
        self.env['liwan.hr.compensation'].search([('employee_id', '=', self.employee_two.id)]).unlink()
        res = self.api('GET', f'{RUNS}/{run_id}/gosi-statement')
        self.assertEqual(res.status_code, 200, res.text)
        classes = {line['employee']['id']: line['nationality_class'] for line in res.json()['lines']}
        self.assertEqual(classes, {self.employee_one.id: 'saudi_before_2024', self.employee_two.id: 'non_saudi'})

    def test_other_company_profile_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Other Files Co'})
        profile = self.env['liwan.hr.payroll.bank.profile'].create({
            'name': 'Theirs', 'kind': 'bank', 'company_id': other.id,
            'column_ids': [(0, 0, {'source': 'name', 'label': 'Name'})],
        })
        self.officer.company_ids |= other
        self.config.company_ids |= other
        run_id = self._run()
        res = self.api('POST', f'{RUNS}/{run_id}/bank-file', json={'profile_id': profile.id})
        self.assertEqual(res.status_code, 404, res.text)
        self._login(self.config)
        self.assertEqual(self.api('DELETE', f'{PROFILES}/{profile.id}', json={'revision': 1}).status_code, 404)

    def test_shared_profile_is_read_only(self):
        self._login(self.config)
        res = self.api('GET', PROFILES)
        self.assertEqual(res.status_code, 200, res.text)
        items = {item['id']: item for item in res.json()['items']}
        self.assertEqual(set(items[self.generic.id]), PROFILE_KEYS)
        self.assertTrue(items[self.generic.id]['shared'])
        self.assertEqual(self.api('PATCH', f'{PROFILES}/{self.generic.id}', json={'name': 'x', 'revision': 1}).status_code, 403)
        self.assertEqual(self.api('DELETE', f'{PROFILES}/{self.generic.id}', json={'revision': 1}).status_code, 403)
        self.assertEqual(self.generic.name, self.env.ref('liwan_hr.profile_generic_csv').name)

    def test_shared_profile_is_read_only_in_the_orm(self):
        """The config capability cannot reach a shared seed row through the ORM either."""
        shared = self.env.ref('liwan_hr.profile_generic_csv')
        self.assertFalse(shared.company_id)
        column = shared.column_ids[:1]
        before = (shared.name, column.label)
        with self.assertRaises(AccessError, msg='a shared profile is writable through the ORM'):
            shared.with_user(self.config).write({'name': 'Hijacked'})
        with self.assertRaises(AccessError, msg='a shared profile is removable through the ORM'):
            shared.with_user(self.config).unlink()
        with self.assertRaises(AccessError, msg='a shared profile column is writable through the ORM'):
            column.with_user(self.config).write({'label': 'Hijacked'})
        with self.assertRaises(AccessError, msg='a shared profile column is removable through the ORM'):
            column.with_user(self.config).unlink()
        self.assertEqual((shared.name, column.label), before)
        own = self.env['liwan.hr.payroll.bank.profile'].with_user(self.config).create({
            'name': 'Own layout', 'kind': 'bank', 'company_id': self.env.company.id,
            'column_ids': [(0, 0, {'source': 'name', 'label': 'Name'})],
        })
        own.with_user(self.config).write({'name': 'Own layout saved'})
        self.assertEqual(own.name, 'Own layout saved')

    def test_shared_eos_case_is_read_only_in_the_orm(self):
        """The same read-only rule on the shared end-of-service case rows (no company)."""
        shared = self.env.ref('liwan_hr.eos_case_resigned')
        self.assertFalse(shared.company_id)
        before = shared.case
        with self.assertRaises(AccessError, msg='a shared end-of-service case row is writable through the ORM'):
            shared.with_user(self.config).write({'case': 'termination'})
        with self.assertRaises(AccessError, msg='a shared end-of-service case row is removable through the ORM'):
            shared.with_user(self.config).unlink()
        self.assertEqual(shared.case, before)

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
        res = self.api('PATCH', f"{PROFILES}/{created['id']}", json={'columns': [{'source': 'net', 'label': 'Net'}], 'revision': 1})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['revision'], 2)
        self.assertEqual([column['source'] for column in res.json()['columns']], ['net'])
        res = self.api('POST', PROFILES, json={**body, 'columns': [{'source': 'constant', 'label': 'Bank'}]})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'columns'))
        res = self.api('POST', PROFILES, json={**body, 'delimiter': 'x'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'delimiter'))
        self.assertEqual(self.api('DELETE', f"{PROFILES}/{created['id']}", json={'revision': 2}).status_code, 204)
        self.assertEqual(self.api('DELETE', f"{PROFILES}/{created['id']}", json={'revision': 2}).status_code, 404)
