# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company isolation of the eight HR routes that earlier matrices left open (assessment F2/F3).

Same matrix as ``test_company_isolation.py``: from P the records of P, P1 and P2 are visible and C is not;
from P1 only P1 is. A hidden record answers 404 ``not_found`` plainly and under every company forgery.
Bank and WPS files export IBANs and salaries, so their hidden case also proves no file was kept.
"""
from datetime import date

from odoo.tests import tagged

from .test_company_isolation import MATRIX
from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    cover_isolation_routes,
)

RUN = '/api/v1/hr/payroll/runs/{}'
EOS = '/api/v1/hr/payroll/eos/{}'


@tagged('post_install', '-at_install', 'webvue')
class TestHrPayrollCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        Assignment = cls.env['webvue.access.assignment'].sudo()
        for company in cls.by_tag.values():
            for xmlid in ('webvue_hr.role_hr_manager', 'webvue_hr.role_payroll_manager'):
                Assignment.create({
                    'user_id': cls.iso_user.id, 'role_id': cls.env.ref(xmlid).id, 'company_id': company.id,
                })
        category = cls.env['hr.salary.rule.category'].create({'name': 'Iso basic', 'code': 'ISO_BASIC', 'company_id': False})
        cls.structure = cls.env['hr.payroll.structure'].create({
            'name': 'Iso structure', 'code': 'ISOSTRUCT',
            'rule_ids': [(0, 0, {
                'name': 'Basic', 'code': 'ISO_BASIC', 'sequence': 1, 'category_id': category.id,
                'amount_select': 'fix', 'amount_fix': 1000.0,
            })],
        })
        leave_model = cls.env['hr.leave']
        cls.recs = {}
        for tag, company in cls.by_tag.items():
            employee = cls.env['hr.employee'].create({
                'name': f'Iso Pay {tag.upper()}', 'company_id': company.id, 'user_id': cls.iso_user.id,
                'departure_date': '2026-03-01',
            })
            employee.version_id.contract_date_start = date(2024, 1, 1)
            cls.env['webvue.hr.compensation'].create({'employee_id': employee.id, 'basic_wage': 5000})
            leave_type = cls.env['hr.leave.type'].create({
                'name': f'Iso Leave {tag.upper()}', 'requires_allocation': False, 'company_id': company.id,
            })
            run = cls.env['hr.payslip.run'].create({
                'name': f'Iso run {tag.upper()}', 'date_start': '2026-04-01', 'date_end': '2026-04-30',
                'company_id': company.id,
            })
            run.webvue_state = 'approved'
            slip = cls.env['hr.payslip'].create({
                'name': f'Iso slip {tag.upper()}', 'employee_id': employee.id, 'contract_id': employee.version_id.id,
                'struct_id': cls.structure.id, 'date_from': date(2026, 4, 1), 'date_to': date(2026, 4, 30),
                'company_id': company.id, 'payslip_run_id': run.id,
            })
            slip.with_company(company).compute_sheet()
            slip.state = 'done'
            cls.env['webvue.hr.payroll.eos.settlement'].create({
                'employee_id': employee.id, 'departure_date': '2026-03-01', 'case': 'no_award',
                'award': 0, 'total': 0, 'state': 'confirmed',
            })
            cls.recs[tag] = {
                'employee': employee, 'run': run, 'slip': slip,
                'leave': leave_model.create({
                    'employee_id': employee.id, 'holiday_status_id': leave_type.id,
                    'request_date_from': '2026-05-04', 'request_date_to': '2026-05-05',
                }),
            }

    def assert_hidden_every_way(self, path, hidden_company, method='GET'):
        # api_forged names the hidden COMPANY in cids (cookie, query) and the body context, never a record id.
        self.assertNotEqual(hidden_company.id, self.iso_user.company_id.id, 'forgery must name another company')
        for response in self.api_forged(method, path, hidden_company.id, json={} if method == 'POST' else None):
            self.assertEqual(response.status_code, 404, f'{path} must stay hidden: {response.text[:200]}')
            self.assertEqual(response.json()['code'], 'not_found', path)

    def assert_matrix(self, template, own_company_only=False):
        """``template`` builds a path from a fixture row; visible tags answer 200, hidden ones 404 under forgery.

        ``own_company_only`` is for the self-service routes, which read the caller's own record of exactly the
        current company: a branch of the current company is hidden there too.
        """
        for current, visible, hidden in MATRIX:
            if own_company_only:
                visible = (current,)
                hidden = tuple(tag for tag in self.by_tag if tag != current)
            self.env_in(self.by_tag[current])
            for tag in visible:
                self.assertVisible(template(self.recs[tag]))
            for tag in hidden:
                self.assert_hidden_every_way(template(self.recs[tag]), self.by_tag[tag])

    def test_own_leave_request_is_company_scoped(self):
        # leave/me/<id>: the caller owns an employee (and a leave) in every company; only the current one answers.
        self.assert_matrix(lambda recs: f'/api/v1/hr/leave/me/{recs["leave"].id}', own_company_only=True)

    def test_own_payslip_is_company_scoped(self):
        self.assert_matrix(lambda recs: f'/api/v1/hr/payroll/payslips/mine/{recs["slip"].id}', own_company_only=True)

    def test_run_payslip_detail_is_company_scoped(self):
        self.assert_matrix(
            lambda recs: f'{RUN.format(recs["run"].id)}/payslips/{recs["slip"].id}',
        )

    def test_gosi_statement_is_company_scoped(self):
        self.assert_matrix(lambda recs: f'{RUN.format(recs["run"].id)}/gosi-statement')

    def test_eos_settlement_is_company_scoped(self):
        self.assert_matrix(lambda recs: f'{EOS.format(recs["employee"].id)}/settlement')

    def test_eos_estimate_is_company_scoped(self):
        self.assert_matrix(lambda recs: f'{EOS.format(recs["employee"].id)}/estimate?case=no_award')

    def test_salary_files_of_a_hidden_company_are_not_found_and_keep_nothing(self):
        File = self.env['webvue.hr.payroll.file']
        self.env_in(self.company_p1)
        for kind in ('bank-file', 'wps-file'):
            for tag in ('p', 'p2', 'c'):
                run = self.recs[tag]['run']
                before = File.search_count([])
                self.assert_hidden_every_way(f'{RUN.format(run.id)}/{kind}', self.by_tag[tag], method='POST')
                self.assertEqual(File.search_count([]), before, f'{kind} of {tag} must keep no file')

    def test_salary_files_of_the_current_company_are_served(self):
        self.env_in(self.company_p1)
        run = self.recs['p1']['run']
        for kind in ('bank-file', 'wps-file'):
            response = self.api('POST', f'{RUN.format(run.id)}/{kind}', json={})
            self.assertEqual(response.status_code, 200, f'{kind}: {response.text[:200]}')
            self.assertIn('text/csv', response.headers['Content-Type'])


cover_isolation_routes((
    '/api/v1/hr/leave/me/<int:leave_id>',
    '/api/v1/hr/payroll/payslips/mine/<int:payslip_id>',
    '/api/v1/hr/payroll/runs/<int:run_id>/payslips/<int:payslip_id>',
    '/api/v1/hr/payroll/runs/<int:run_id>/gosi-statement',
    '/api/v1/hr/payroll/eos/<int:employee_id>/settlement',
    '/api/v1/hr/payroll/eos/<int:employee_id>/estimate',
), source='webvue_hr/tests/test_company_isolation_payroll.py')
