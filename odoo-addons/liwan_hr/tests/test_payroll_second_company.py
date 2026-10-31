# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .payroll_common import PayrollCase


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollSecondCompany(PayrollCase):
    """Every company of the database owns a copy of the Saudi payroll structure, so a second company runs
    payroll without anyone copying the structure to it."""

    def _structure_of(self, company):
        return self.env['liwan.hr.payroll.settings']._liwan_for_company(company).structure_id

    def test_a_new_company_gets_its_own_structure(self):
        shipped = self.env.ref('liwan_hr.structure_saudi')
        company = self.env['res.company'].create({'name': 'Second Payroll Co'})
        structure = self._structure_of(company)
        self.assertEqual((structure.company_id, structure.code), (company, shipped.code))
        self.assertEqual(structure.rule_ids, shipped.rule_ids)
        self.assertEqual(self._structure_of(self.env.company), shipped)

    def test_providing_the_structure_twice_adds_nothing(self):
        company = self.env['res.company'].create({'name': 'Twice Payroll Co'})
        company._liwan_ensure_payroll_structure()
        self.assertEqual(self.env['hr.payroll.structure'].search_count([('company_id', '=', company.id)]), 1)

    def test_the_second_company_creates_its_run_on_its_own_structure(self):
        company = self.env['res.company'].create({'name': 'Run Payroll Co'})
        run = self.env['hr.payslip.run'].with_company(company)._liwan_create_month(date(2026, 11, 1))
        self.assertEqual((run.company_id, run.struct_id), (company, self._structure_of(company)))
        first = self.env['hr.payslip.run'].with_company(self.env.company)._liwan_create_month(date(2026, 11, 1))
        self.assertEqual(first.struct_id, self.env.ref('liwan_hr.structure_saudi'))

    def test_a_user_of_the_second_company_reads_its_structure_and_not_the_first(self):
        company = self.env['res.company'].create({'name': 'Reader Payroll Co'})
        user = new_test_user(
            self.env, login='second_co_reader', groups='liwan_core.group_employee',
            company_id=company.id, company_ids=[company.id],
        )
        structure = self._structure_of(company)
        self.assertEqual(structure.with_user(user).name, structure.name)
        with self.assertRaises(AccessError):
            self.env.ref('liwan_hr.structure_saudi').with_user(user).name  # noqa: B018
