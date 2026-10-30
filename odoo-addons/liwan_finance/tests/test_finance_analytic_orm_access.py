# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .analytic_common import AnalyticCase


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceAnalyticOrmAccess(AnalyticCase):
    """The stock ACLs behind the capability groups, checked on the ORM without the routes."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reader = cls.user_with('orm_analytic_reader', ['finance.analytic.read'])
        cls.manager = cls.user_with('orm_analytic_manager', ['finance.analytic.read', 'finance.analytic.manage'])
        cls.invoice_only = cls.user_with('orm_invoice_only', ['finance.invoices.read', 'finance.invoices.manage'])

    def as_user(self, user, model):
        return self.env[model].with_user(user)

    def assertDenied(self, action):  # noqa: N802
        with self.assertRaises(AccessError), self.cr.savepoint():
            action()

    def test_the_read_user_reads_but_cannot_create_or_write_plans_or_accounts(self):
        plans, accounts = self.as_user(self.reader, 'account.analytic.plan'), self.as_user(self.reader, 'account.analytic.account')
        self.assertEqual(plans.browse(self.branches.id).name, 'Branches')
        self.assertEqual(accounts.browse(self.riyadh.id).name, 'Riyadh')
        self.assertDenied(lambda: plans.create({'name': 'Denied'}))
        self.assertDenied(lambda: plans.browse(self.branches.id).write({'name': 'Denied'}))
        self.assertDenied(lambda: accounts.create({'name': 'Denied', 'plan_id': self.branches.id}))
        self.assertDenied(lambda: accounts.browse(self.riyadh.id).write({'name': 'Denied'}))

    def test_the_manage_user_creates_and_writes_but_never_deletes(self):
        plans, accounts = self.as_user(self.manager, 'account.analytic.plan'), self.as_user(self.manager, 'account.analytic.account')
        account = accounts.create({'name': 'Medina', 'plan_id': self.branches.id})
        account.write({'name': 'Madinah'})
        plan = plans.create({'name': 'Sub', 'parent_id': self.branches.id})
        plan.write({'name': 'Sub two'})
        self.assertDenied(account.unlink)
        self.assertDenied(plan.unlink)

    def test_an_invoice_only_user_cannot_write_plans(self):
        plans = self.as_user(self.invoice_only, 'account.analytic.plan')
        self.assertDenied(lambda: plans.create({'name': 'Denied'}))
        self.assertDenied(lambda: plans.browse(self.branches.id).write({'name': 'Denied'}))
