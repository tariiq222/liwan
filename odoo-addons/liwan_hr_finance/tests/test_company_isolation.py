# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the HR-finance bridge routes.

The bridge owns one GET record route, the posting preview of a payroll run, which the
matrix below pins. Its two other GET routes carry no record id — the current company's
payroll finance settings singleton and the current company's cost-center list — so this
file pins their list scope instead.
"""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)
from odoo.addons.liwan_hr.tests.test_company_isolation import MATRIX

EXPECTED_GET_RECORD_ROUTES = 1
PREVIEW_ROUTE = '/api/v1/hr/payroll/runs/{}/posting-preview'


@tagged('post_install', '-at_install', 'liwan')
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
        Assignment = cls.env['liwan.access.assignment'].sudo()
        for company in cls.by_tag.values():
            for xmlid in ('liwan_hr.role_payroll_manager', 'liwan_finance.role_finance_manager'):
                Assignment.create({
                    'user_id': cls.iso_user.id, 'role_id': cls.env.ref(xmlid).id, 'company_id': company.id,
                })
        cls.departments = {}
        cls.analytic = {}
        # A draft run per company: the preview refuses it with a state error, which
        # tells a run the request can see (403 transition_forbidden) from the not-found of a hidden one.
        cls.runs = {
            tag: cls.env['hr.payslip.run'].create({
                'name': f'Bridge run {tag.upper()}', 'date_start': '2026-04-01', 'date_end': '2026-04-30',
                'company_id': company.id,
            })
            for tag, company in cls.by_tag.items()
        }
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
        cls.env['liwan.hr.payroll.cost.center'].create({
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

    def test_posting_preview_follows_the_branch_matrix(self):
        """From P the run of P and its branches resolve, C's is not-found; from the branch P1 only P1's resolves."""
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for tag in visible:
                response = self.api('GET', PREVIEW_ROUTE.format(self.runs[tag].id))
                self.assertEqual(response.status_code, 403, f'{current}->{tag}: {response.text[:200]}')
                self.assertEqual(response.json()['code'], 'transition_forbidden', f'{current}->{tag} must resolve the run')
            for tag in hidden:
                self.assertHiddenEveryWay('GET', PREVIEW_ROUTE.format(self.runs[tag].id), self.by_tag[tag].id)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_hr_finance', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes(
    ('/api/v1/hr/payroll/runs/<int:run_id>/posting-preview',),
    source='liwan_hr_finance/tests/test_company_isolation.py',
)
