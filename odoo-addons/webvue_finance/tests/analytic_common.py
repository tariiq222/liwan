# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .write_common import WebVueFinanceWriteCase

PLANS = '/api/v1/finance/analytic-plans'
ACCOUNTS = '/api/v1/finance/analytic-accounts'
REPORT = '/api/v1/finance/reports/analytic'
OCTOBER = 'date_from=2026-10-01&date_to=2026-10-31'
NOT_GIVEN = object()


class AnalyticCase(WebVueFinanceWriteCase):
    """The write fixture plus two plans, cost centers in each company and a shared one.

    ``branches`` holds ``riyadh`` and ``jeddah``; ``projects`` holds ``alpha``; ``other_branch`` and
    ``shared`` belong to the second company and to no company.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Plan = cls.env['account.analytic.plan']
        Account = cls.env['account.analytic.account']
        cls.branches = Plan.create({'name': 'Branches'})
        cls.projects = Plan.create({'name': 'Projects 2026'})
        cls.riyadh = Account.create({'name': 'Riyadh', 'code': 'RYD', 'plan_id': cls.branches.id, 'company_id': cls.company.id})
        cls.jeddah = Account.create({'name': 'Jeddah', 'plan_id': cls.branches.id, 'company_id': cls.company.id})
        cls.alpha = Account.create({'name': 'Alpha', 'plan_id': cls.projects.id, 'company_id': cls.company.id})
        cls.other_branch = Account.create({'name': 'Dammam', 'plan_id': cls.branches.id, 'company_id': cls.other_company.id})
        cls.shared = Account.create({'name': 'Shared', 'plan_id': cls.branches.id, 'company_id': False})

    def split_body(self, distribution=NOT_GIVEN, **overrides):
        """The 1000 SAR sale invoice with its line split 60/40 between Riyadh and Jeddah (or ``distribution``)."""
        body = self.invoice_body(**overrides)
        body['lines'][0]['analytic_distribution'] = (
            {str(self.riyadh.id): 60, str(self.jeddah.id): 40} if distribution is NOT_GIVEN else distribution
        )
        return body

    def report(self, query=OCTOBER):
        result = self.api('GET', f'{REPORT}?{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def row(self, report, account):
        return next(row for row in report['accounts'] if row['account']['id'] == account.id)
