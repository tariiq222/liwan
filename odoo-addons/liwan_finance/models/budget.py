# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

CREDIT_NATURE_GROUPS = ('income', 'liability', 'equity')


class LiwanFinanceBudget(models.AbstractModel):
    """Budget lines and budget versus actual over OCA ``mis.budget.by.account``.

    A budget line is a ``mis.budget.by.account.item``; the amounts the API shows are in the natural direction of
    the account (a credit for income, liability and equity accounts, a debit for the others), so a budget of 10000
    on an expense account is 10000 and a posted expense of 7500 is an actual of 7500.

    The budget of a line up to a day is its amount prorated over the days elapsed, with the engine's own
    ``_intersect_days`` (the pro rata mis_builder_budget applies). The actual is read in one ``_read_group`` per
    distinct (period, analytic account): from the posted journal items, or, for a line limited to an analytic
    account, from the analytic lines of that account (so a 50% share of a journal item counts for 50%).
    """
    _name = 'liwan.finance.budget'
    _description = 'LiwanOS finance budget evaluation'

    @api.model
    def _liwan_nature(self, account):
        return 'credit' if account.internal_group in CREDIT_NATURE_GROUPS else 'debit'

    @api.model
    def _liwan_sign(self, account):
        return -1 if self._liwan_nature(account) == 'credit' else 1

    @api.model
    def _liwan_amount_values(self, account, amount):
        """The ``debit``/``credit`` of an item that budgets ``amount`` (natural direction) on ``account``."""
        if self._liwan_sign(account) == 1:
            return {'debit': amount, 'credit': 0.0}
        return {'debit': 0.0, 'credit': amount}

    @api.model
    def _liwan_line_amount(self, item):
        return item.balance * self._liwan_sign(item.account_id)

    @api.model
    def _liwan_analytic_account_id(self, item):
        """The single analytic account a line is limited to, or 0 (the API writes at most one, at 100%)."""
        return int(next(iter(item.analytic_distribution), 0)) if item.analytic_distribution else 0

    @api.model
    def _liwan_analytic_accounts(self, items):
        """``{item id: analytic account record}`` (empty record when none), fetched in one query."""
        ids = {item.id: self._liwan_analytic_account_id(item) for item in items}
        accounts = self.env['account.analytic.account'].browse(set(ids.values())).exists()
        return {item_id: accounts.filtered(lambda account: account.id == account_id) for item_id, account_id in ids.items()}

    @api.model
    def _liwan_actuals(self, period, analytic, accounts):
        """``{account id: natural-sign-free balance}`` of ``accounts`` over ``period`` (journal item balance).

        Without ``analytic`` it is the balance of the posted journal items; with it, the negated amount of the
        analytic lines of that account (an analytic amount is credit minus debit), both in the company currency.
        Year-end closing entries (``liwan_closing_year`` set) are excluded: they zero the income and expense
        accounts and are not activity the budget is compared with.
        """
        date_from, date_to = period
        company = self.env.company
        if analytic:
            column = analytic.plan_id._column_name()
            domain = [
                (column, '=', analytic.id), ('general_account_id', 'in', accounts.ids),
                ('move_line_id.move_id.liwan_closing_year', '=', False),
            ]
            groups = self.env['account.analytic.line']._read_group(
                domain + [('company_id', '=', company.id), ('date', '>=', date_from), ('date', '<=', date_to)],
                ['general_account_id'], ['amount:sum'],
            )
            return {account.id: -total for account, total in groups}
        groups = self.env['account.move.line']._read_group(
            [
                ('account_id', 'in', accounts.ids), ('company_id', '=', company.id), ('parent_state', '=', 'posted'),
                ('move_id.liwan_closing_year', '=', False), ('date', '>=', date_from), ('date', '<=', date_to),
            ],
            ['account_id'], ['balance:sum'],
        )
        return {account.id: total for account, total in groups}

    @api.model
    def _liwan_line_figures(self, items, date_to):
        """``{item: (budget, actual)}`` up to ``date_to``, natural direction, rounded to the company currency.

        Each line counts over ``[item.date_from, min(item.date_to, date_to)]``; a line that starts after ``date_to``
        is ``(0, 0)``.
        """
        currency = self.env.company.currency_id
        analytics = self._liwan_analytic_accounts(items)
        accounts_of = {}  # (date_from, end, analytic id) -> (analytic account, accounts)
        key_of = {}
        for item in items:
            end = min(item.date_to, date_to)
            if end < item.date_from:
                continue
            analytic = analytics[item.id]
            key = (item.date_from, end, analytic.id)
            key_of[item] = key
            _analytic, accounts = accounts_of.get(key, (analytic, self.env['account.account']))
            accounts_of[key] = (analytic, accounts | item.account_id)
        balances = {
            key: self._liwan_actuals((key[0], key[1]), analytic, accounts)
            for key, (analytic, accounts) in accounts_of.items()
        }
        figures = {}
        for item in items:
            if item not in key_of:
                figures[item] = (0.0, 0.0)
                continue
            key = key_of[item]
            sign = self._liwan_sign(item.account_id)
            elapsed, total = self.env['mis.budget.by.account.item']._intersect_days(item.date_from, item.date_to, key[0], key[1])
            budget = self._liwan_line_amount(item) * elapsed / total
            actual = sign * balances[key].get(item.account_id.id, 0.0)
            figures[item] = (currency.round(budget), currency.round(actual))
        return figures
