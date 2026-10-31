# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user

from odoo.addons.liwan_finance.tests.analytic_common import AnalyticCase
from odoo.addons.liwan_finance.tests.write_common import PASSWORD
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

PROJECT_READ = 'pmo.projects.read'
PROJECT_MANAGE = 'pmo.projects.manage'
FINANCE_FEATURE = 'finance.enabled'


class PmoFinanceCase(AnalyticCase):
    """The finance analytic fixture plus two projects of the first company and their users.

    ``project`` is linked to the cost center ``alpha`` (a custom plan) and carries every posted document of
    ``_post_documents``; ``other_project`` is linked to ``beta`` (the stock project plan); ``manual_project`` has
    no cost center. Users: ``owner`` (project manager and cost center manager), ``reader`` (project reader
    only), ``line_reader`` (project and cost center reader), ``finance_manager`` (cost center manager who does not manage the project), ``project_manager`` (project manager without
    any finance capability), ``pmo_manager`` (the PMO manager group, no finance capability), ``settings_admin`` and ``employee`` (an ordinary employee of the company).
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Project = cls.env['project.project']
        cls.project = Project.create({'name': 'Gulf Tower', 'company_id': cls.company.id})
        cls.other_project = Project.create({'name': 'Harbor Mall', 'company_id': cls.company.id})
        cls.manual_project = Project.create({'name': 'Manual Villa', 'company_id': cls.company.id})
        project_plan, _other_plans = cls.env['account.analytic.plan']._get_all_plans()
        cls.beta = cls.env['account.analytic.account'].create({
            'name': 'Beta', 'plan_id': project_plan.id, 'company_id': cls.company.id,
        })
        cls.alpha.liwan_project_id = cls.project
        cls.beta.liwan_project_id = cls.other_project
        cls.expense_account = cls.env['account.account'].search([
            ('company_ids', 'in', cls.company.id), ('account_type', '=', 'expense'),
        ], limit=1)
        cls.owner = cls.user_with('pf_owner', [PROJECT_READ, PROJECT_MANAGE, 'finance.analytic.read', 'finance.analytic.manage'])
        cls.finance_manager = cls.user_with('pf_finance_manager', [PROJECT_READ, 'finance.analytic.read', 'finance.analytic.manage'])
        cls.reader = cls.user_with('pf_reader', [PROJECT_READ])
        cls.line_reader = cls.user_with('pf_line_reader', [PROJECT_READ, 'finance.analytic.read'])
        cls.project_manager = cls.user_with('pf_project_manager', [PROJECT_READ, PROJECT_MANAGE])
        cls.settings_admin = cls.user_with('pf_settings_admin', [PROJECT_READ, 'pmo.settings.manage'])
        cls.employee = cls._company_employee('pf_employee')
        cls.pmo_manager = new_test_user(
            cls.env, login='pf_pmo_manager', password=PASSWORD, name='pf_pmo_manager',
            groups='liwan_core.group_employee,liwan_pmo.group_pmo_manager',
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls._post_documents()

    @classmethod
    def _company_employee(cls, login):
        return new_test_user(
            cls.env, login=login, password=PASSWORD, name=login, groups='liwan_core.group_employee',
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )

    @classmethod
    def _document(cls, move_type, distribution, amount, post=True, account=None):
        """A one-line document of ``amount`` on ``account`` (an expense account), split as ``distribution`` (account -> percent)."""
        move = cls.env['account.move'].with_company(cls.company).create({
            'move_type': move_type, 'partner_id': cls.vendor.id,
            'invoice_date': '2026-10-18', 'invoice_date_due': '2026-10-18',
            'invoice_line_ids': [Command.create({
                'name': 'Cost', 'quantity': 1, 'price_unit': amount, 'account_id': (account or cls.expense_account).id,
                'tax_ids': [Command.clear()],
                'analytic_distribution': {str(account.id): percent for account, percent in distribution.items()},
            })],
        })
        if post:
            move.action_post()
        return move

    @classmethod
    def _entry(cls, account, amount):
        """A posted journal entry: ``amount`` debited to an expense account, split off to ``account``."""
        other = cls.env['account.account'].search([
            ('company_ids', 'in', cls.company.id), ('account_type', '=', 'asset_current'),
        ], limit=1)
        entry = cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'entry', 'date': '2026-10-19', 'journal_id': cls._journal(cls.company, 'general').id,
            'line_ids': [
                Command.create({
                    'account_id': cls.expense_account.id, 'debit': amount, 'credit': 0,
                    'analytic_distribution': {str(account.id): 100},
                }),
                Command.create({'account_id': other.id, 'debit': 0, 'credit': amount}),
            ],
        })
        entry.action_post()
        return entry

    @classmethod
    def _post_documents(cls):
        """What ``project`` costs in total: 1000 + 1200 - 200 + 50 = 2050 over four posted expense items."""
        cls.bill = cls._document('in_invoice', {cls.alpha: 100}, 1000)
        cls.split_bill = cls._document('in_invoice', {cls.alpha: 60, cls.riyadh: 40}, 2000)
        cls.refund = cls._document('in_refund', {cls.alpha: 100}, 200)
        cls.entry = cls._entry(cls.alpha, 50)
        # Not counted: a draft document, and revenue on a project cost center.
        cls._document('in_invoice', {cls.alpha: 100}, 500, post=False)
        income = cls.env['account.account'].search([
            ('company_ids', 'in', cls.company.id), ('account_type', '=', 'income'),
        ], limit=1)
        cls.sale = cls._document('out_invoice', {cls.alpha: 100}, 700, account=income)

    def summary_url(self, project=None):
        return f'/api/v1/projects/{(project or self.project).id}/finance/summary'

    def lines_url(self, query='', project=None):
        return f'/api/v1/projects/{(project or self.project).id}/finance/actual-lines{query}'

    def account_url(self, project=None):
        return f'/api/v1/projects/{(project or self.project).id}/finance/actual-account'

    def login_as(self, user):
        self.authenticate(user.login, PASSWORD)

    def switch_finance(self, enabled, retained=False):
        """Switch ``finance.enabled``; ``retained`` keeps its reads open while it is off, like a withdrawn application."""
        profile = self.env.ref('liwan_platform.tenant_profile')
        self.assertIn(FINANCE_FEATURE, profile.features)
        kept = [key for key in (profile.retained_read_features or []) if key != FINANCE_FEATURE]
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, FINANCE_FEATURE: enabled},
            'retained_read_features': [*kept, FINANCE_FEATURE] if retained else kept,
        })

    def cost_centers_of(self, lines):
        """The accounts the items of a plain ``search`` belong to (the plan columns are the stored truth)."""
        return lines[self.alpha.plan_id._column_name()] | lines[self.riyadh.plan_id._column_name()]

    def get_ok(self, url):
        response = self.api('GET', url)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()
