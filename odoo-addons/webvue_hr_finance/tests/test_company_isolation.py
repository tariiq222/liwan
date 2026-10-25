# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the HR-finance bridge routes.

The bridge owns no GET record route: its only ``<int:...>`` route is the POST
run posting, which the run's own company scopes. Its two GET routes carry no
record id — the current company's payroll finance settings singleton and the
current company's cost-center list — so this file pins their list scope instead.
"""
from odoo.tests import tagged

from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    exempt_isolation_route,
)


@tagged('post_install', '-at_install', 'webvue')
class TestHrFinanceCompanyIsolation(CompanyIsolationCase):
    """The bridge's GET routes and PATCH settings remain company-scoped."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        # The list route reads hr.department (the HR manager's read capability)
        # and requires the payroll or finance-analytic read capability; both
        # roles are added on top of the employee role, in every company, so a
        # visibility difference can only come from the pinned request company.
        Assignment = cls.env['webvue.access.assignment'].sudo()
        for company in cls.by_tag.values():
            for xmlid in ('webvue_hr.role_payroll_manager', 'webvue_finance.role_finance_manager'):
                Assignment.create({
                    'user_id': cls.iso_user.id, 'role_id': cls.env.ref(xmlid).id, 'company_id': company.id,
                })
        cls.departments = {}
        cls.analytic = {}
        for tag, company in cls.by_tag.items():
            cls.departments[tag] = cls.env['hr.department'].create(
                {'name': f'Bridge Dept {tag.upper()}', 'company_id': company.id},
            )
        # Only P1 carries a cost center, so the P1 answer shows the mapping and
        # the P2 answer shows an unmapped department of its own company.
        # Analytic plans are database-wide in Odoo 19; the account carries the company.
        plan = cls.env['account.analytic.plan'].create({'name': 'Bridge Plan'})
        cls.analytic['p1'] = cls.env['account.analytic.account'].create({
            'name': 'Bridge Center P1', 'plan_id': plan.id, 'company_id': cls.company_p1.id,
        })
        cls.env['webvue.hr.payroll.cost.center'].create({
            'company_id': cls.company_p1.id,
            'department_id': cls.departments['p1'].id,
            'analytic_account_id': cls.analytic['p1'].id,
        })

    def test_cost_centers_list_is_scoped_to_the_current_company(self):
        """From P1 the bridge lists only P1's department with its cost center; from P2
        only P2's, and the settings P1 saved never answer for P2."""
        self.env_in(self.company_p1)
        body = self.assertVisible('/api/v1/hr/payroll/cost-centers').json()
        self.assertEqual([item['department']['id'] for item in body['items']], [self.departments['p1'].id])
        self.assertEqual(body['items'][0]['analytic_account']['id'], self.analytic['p1'].id)
        saved = self.api('PATCH', '/api/v1/hr/payroll/finance-settings',
                         json={'default_analytic_account_id': self.analytic['p1'].id})
        self.assertEqual(saved.status_code, 200, saved.text[:200])
        self.env_in(self.company_p2)
        body = self.assertVisible('/api/v1/hr/payroll/cost-centers').json()
        self.assertEqual([item['department']['id'] for item in body['items']], [self.departments['p2'].id])
        self.assertIsNone(body['items'][0]['analytic_account'])
        settings = self.assertVisible('/api/v1/hr/payroll/finance-settings').json()
        self.assertIsNone(settings['default_analytic_account'])
        saved = self.api('PATCH', '/api/v1/hr/payroll/finance-settings',
                         json={'default_analytic_account_id': self.analytic['p1'].id})
        self.assertEqual(saved.status_code, 422, saved.text[:200])
        self.env_in(self.company_p1)
        settings = self.assertVisible('/api/v1/hr/payroll/finance-settings').json()
        self.assertEqual(settings['default_analytic_account']['id'], self.analytic['p1'].id)


exempt_isolation_route(
    '/api/v1/hr/payroll/finance-settings',
    'no record id: the current company payroll finance settings singleton',
)
exempt_isolation_route(
    '/api/v1/hr/payroll/cost-centers',
    'no record id: the cost-center list of the current company departments',
)
