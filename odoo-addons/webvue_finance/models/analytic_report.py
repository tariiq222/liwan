# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PROFIT_AND_LOSS_GROUPS = ('income', 'expense')


class WebVueFinanceAnalyticReport(models.AbstractModel):
    """Income and expense per analytic account (cost center), read with ``_read_group`` in the caller's environment.

    The source is ``account.analytic.line``, the items Odoo itself creates when a journal item with an analytic
    distribution is posted (and removes when it goes back to draft). It already holds the posted share of each
    account in the company currency, with the percentages applied, so the totals match the distribution of the
    documents. Shared (company-less) accounts are left out, so every row has a working drill-down.
    Only items on income and expense accounts count: a distribution on a balance sheet account
    (a fixed asset purchase, for example) is not an operating result. Positive amounts are credits.
    """
    _name = 'webvue.finance.analytic.report'
    _description = 'WebVue finance analytic (cost center) report'

    @api.model
    def _webvue_root_plans(self, plan):
        """The root plan whose column holds the accounts of ``plan``, or every root plan when ``plan`` is empty."""
        return plan.root_id if plan else self.env['account.analytic.plan'].search([('parent_id', '=', False)])

    @api.model
    def _webvue_line_domain(self, company, date_from, date_to, groups):
        """The analytic items of the company in the period on accounts of the internal ``groups``."""
        return [
            ('company_id', '=', company.id), ('date', '>=', date_from), ('date', '<=', date_to),
            ('general_account_id.internal_group', 'in', list(groups)),
        ]

    @api.model
    def _webvue_analytic_totals(self, company, date_from, date_to, plan):
        """``{account: {'income': float, 'expense': float}}`` of ``plan`` and its sub-plans (every plan when empty).

        Income is the credit balance of the account's income items, expense the debit balance of its expense items.
        """
        Line = self.env['account.analytic.line']
        totals = {}
        for root in self._webvue_root_plans(plan):
            column = root._column_name()
            for group in PROFIT_AND_LOSS_GROUPS:
                domain = [*self._webvue_line_domain(company, date_from, date_to, [group]), (column, '!=', False)]
                sign = 1 if group == 'income' else -1
                for account, amount in Line._read_group(domain, [column], ['amount:sum']):
                    in_scope = not plan or account.plan_id.parent_path.startswith(plan.parent_path)
                    if account.company_id == company and in_scope:
                        totals.setdefault(account, {'income': 0.0, 'expense': 0.0})[group] += sign * amount
        return totals

    @api.model
    def _webvue_analytic_rows(self, company, date_from, date_to, plan):
        """``[(account, income, expense)]``: the active accounts of the company, and any account with activity."""
        totals = self._webvue_analytic_totals(company, date_from, date_to, plan)
        domain = [('company_id', '=', company.id)]
        if plan:
            domain.append(('plan_id', 'child_of', plan.id))
        accounts = (self.env['account.analytic.account'].search(domain) | self.env['account.analytic.account'].concat(*totals)).sorted(
            lambda account: (account.plan_id.id, account.name, account.id),
        )
        return [(account, totals.get(account, {}).get('income', 0.0), totals.get(account, {}).get('expense', 0.0)) for account in accounts]

    @api.model
    def _webvue_account_lines_domain(self, company, date_from, date_to, account):
        """The items behind one row of the report: same period, company and income/expense scope."""
        return [
            *self._webvue_line_domain(company, date_from, date_to, PROFIT_AND_LOSS_GROUPS),
            ('auto_account_id', '=', account.id),
        ]
