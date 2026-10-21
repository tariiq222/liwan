# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.addons.webvue_finance.tests.analytic_common import AnalyticCase

RUNS = '/api/v1/hr/payroll/runs'
VALID_IBAN = 'SA0380000000608010167519'
SETTINGS = '/api/v1/hr/payroll/finance-settings'
COST_CENTERS = '/api/v1/hr/payroll/cost-centers'
PAYROLL_PASSWORD = 'finance_write_pass_123'
ACCOUNT_ROLES = {
    'basic_expense': 'expense', 'allowance_expense': 'expense', 'variable_expense': 'expense',
    'gosi_expense': 'expense', 'eos_expense': 'expense',
    'gosi_payable': 'liability_current', 'eos_provision': 'liability_current', 'deduction': 'liability_current',
    'salaries_payable': 'liability_payable', 'advance': 'asset_receivable',
}


class PayrollFinanceCase(AnalyticCase):
    """The analytic fixture plus payroll users, an approved-run builder and the company chart accounts.

    ``accounts`` maps every payroll account role of the settings to a distinct account of the first
    company's chart (``ACCOUNT_ROLES`` gives the type each role takes); ``foreign_account`` belongs to the second.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.accounts = {}
        taken = cls.env['account.account']
        for role, account_type in ACCOUNT_ROLES.items():
            account = cls.env['account.account'].search([
                ('company_ids', 'in', cls.company.ids), ('account_type', '=', account_type), ('id', 'not in', taken.ids),
            ], limit=1)
            cls.accounts[role] = account
            taken |= account
        cls.foreign_account = cls.env['account.account'].search([
            ('company_ids', 'in', cls.other_company.ids), ('account_type', '=', 'expense'),
        ], limit=1)
        cls.general_journal = cls._journal(cls.company, 'general')
        cls._payroll_structure()
        cls.payroll_officer = cls.user_with('pf_officer', [
            'hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read', 'hr.departments.read',
        ])
        cls.payroll_approver = cls.user_with('pf_approver', [
            'hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read', 'hr.departments.read',
        ])

    @classmethod
    def _payroll_structure(cls):
        """The Saudi structure of the main company, copied to the first company and set in its payroll settings."""
        structure = cls.env.ref('webvue_hr.structure_saudi').copy({'company_id': cls.company.id})
        cls.env['webvue.hr.payroll.settings']._webvue_save(cls.company, {'structure_id': structure.id})

    @classmethod
    def make_employee(cls, name, department=None):
        employee = cls.env['hr.employee'].with_company(cls.company).create({
            'name': name, 'company_id': cls.company.id, 'department_id': department.id if department else False,
        })
        employee.version_id.write({
            'contract_date_start': date(2024, 1, 1),
            'country_id': cls.env.ref('base.sa').id,
        })
        cls.env['webvue.hr.compensation'].create({
            'employee_id': employee.id, 'basic_wage': 10000, 'housing_allowance': 2500,
            'transport_allowance': 1000, 'iban': VALID_IBAN, 'gosi_registration_date': date(2020, 1, 1),
        })
        return employee

    @classmethod
    def make_department(cls, name, company=None):
        return cls.env['hr.department'].create({'name': name, 'company_id': (company or cls.company).id})

    def login_as(self, user):
        self.authenticate(user.login, PAYROLL_PASSWORD)

    def _approved_run(self, employees, month):
        """The run of ``month`` ('YYYY-MM') over ``employees``: computed by the officer, approved by the approver.

        A run covers every employee of the company that has compensation, so ``employees`` is the set the
        caller expects it to hold; the builder refuses to go on when the run differs.
        """
        self.login_as(self.payroll_officer)
        created = self.api('POST', RUNS, json={'month': month})
        self.assertEqual(created.status_code, 201, created.text)
        run_id = created.json()['id']
        self.assertEqual(created.json()['employee_count'], len(employees), created.text)
        computed = self.api('POST', f'{RUNS}/{run_id}/compute')
        self.assertEqual(computed.status_code, 200, computed.text)
        self.login_as(self.payroll_approver)
        approved = self.api('POST', f'{RUNS}/{run_id}/approve')
        self.assertEqual(approved.status_code, 200, approved.text)
        return approved.json()

    def account_ids(self, **overrides):
        """The ``accounts`` body of the settings route with every role set (``overrides`` replace ids)."""
        return {**{role: account.id for role, account in self.accounts.items()}, **overrides}

    def full_settings(self):
        """A stored settings record with every account, as the finance manager would save it."""
        return self.env['webvue.hr.payroll.finance.settings'].create({
            'company_id': self.company.id, 'journal_id': self.general_journal.id,
            **{f'{role}_account_id': account.id for role, account in self.accounts.items()},
            'default_analytic_account_id': self.riyadh.id,
        })
