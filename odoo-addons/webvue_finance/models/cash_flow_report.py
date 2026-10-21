# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

CASH_TYPES = ('asset_cash',)
OPERATING_TYPES = (
    'asset_receivable', 'asset_current', 'asset_prepayments', 'liability_payable', 'liability_credit_card', 'liability_current',
)
INVESTING_TYPES = ('asset_fixed', 'asset_non_current')
FINANCING_TYPES = ('equity', 'liability_non_current')
DEPRECIATION_TYPE = 'expense_depreciation'


class WebVueFinanceCashFlow(models.AbstractModel):
    """The statement of cash flows by the indirect method, read from the posted journal items in the caller's environment.

    Every figure is a change of the balances of the accounts of one kind, so a line can be opened down to its accounts and
    their entries. The result must close: net income, the adjustments and the changes of every non-cash balance sheet
    account add up to the change of the cash accounts. ``difference`` is that check (zero when every account kind is
    classified); an account kind outside the three sections would show up there instead of being hidden.

    Year-end closing entries are left out of every figure: they only move the result to equity. The statement is a
    management and audit aid built from the books; it is not a filed statutory statement.
    """
    _name = 'webvue.finance.cash.flow'
    _description = 'WebVue finance cash flow statement'

    @api.model
    def _webvue_balances(self, company, domain):
        """``{account: balance}`` of the posted items of ``company`` matching ``domain``, closing entries excluded."""
        closing = self.env['webvue.finance.closing']._webvue_closing_moves(company).ids
        groups = self.env['account.move.line']._read_group(
            [('company_id', '=', company.id), ('parent_state', '=', 'posted'), ('move_id', 'not in', closing), *domain],
            ['account_id'], ['balance:sum'],
        )
        return dict(groups)

    @api.model
    def _webvue_position(self, company, day, types):
        """``{account: balance}`` of the accounts of ``types`` up to and including ``day`` (``None`` day: nothing yet)."""
        if day is None:
            return {}
        return self._webvue_balances(company, [('date', '<=', day), ('account_id.account_type', 'in', types)])

    @api.model
    def _webvue_changes(self, company, date_from, date_to, types):
        """``[(account, cash effect)]`` of the balance changes of the accounts of ``types``: an increase of an asset uses
        cash, an increase of a liability or of equity brings it. Accounts that did not change are left out."""
        before = self._webvue_position(company, date_from.fromordinal(date_from.toordinal() - 1), types)
        after = self._webvue_position(company, date_to, types)
        rows = []
        for account in (before.keys() | after.keys()):
            effect = company.currency_id.round(-(after.get(account, 0.0) - before.get(account, 0.0)))
            if effect:
                rows.append((account, effect))
        return sorted(rows, key=lambda row: row[0].with_company(company).code or '')

    @api.model
    def _webvue_cash_flow(self, company, date_from, date_to):
        """``dict`` of the statement for the period; amounts are in the company currency and positive when cash comes in."""
        currency = company.currency_id
        day_before = date_from.fromordinal(date_from.toordinal() - 1)
        opening = sum(self._webvue_position(company, day_before, CASH_TYPES).values())
        closing = sum(self._webvue_position(company, date_to, CASH_TYPES).values())
        profit = self._webvue_balances(company, [
            ('date', '>=', date_from), ('date', '<=', date_to), ('account_id.internal_group', 'in', ('income', 'expense')),
        ])
        net_income = currency.round(-sum(profit.values()))
        depreciation = currency.round(sum(
            balance for account, balance in profit.items() if account.account_type == DEPRECIATION_TYPE
        ))
        operating = self._webvue_changes(company, date_from, date_to, OPERATING_TYPES)
        investing = self._webvue_changes(company, date_from, date_to, INVESTING_TYPES)
        financing = self._webvue_changes(company, date_from, date_to, FINANCING_TYPES)
        # The accumulated depreciation sits in the fixed asset accounts, so its increase shows in their change: it is added
        # back in operating and taken out of investing, which leaves only purchases and sales of assets.
        adjustments = [('depreciation', depreciation)] if depreciation else []
        investing_total = currency.round(sum(amount for _account, amount in investing) - depreciation)
        operating_total = currency.round(
            net_income + depreciation + sum(amount for _account, amount in operating),
        )
        financing_total = currency.round(sum(amount for _account, amount in financing))
        total_change = currency.round(operating_total + investing_total + financing_total)
        net_change = currency.round(closing - opening)
        return {
            'currency': currency.name,
            'opening_cash': currency.round(opening),
            'closing_cash': currency.round(closing),
            'net_change': net_change,
            'net_income': net_income,
            'adjustments': adjustments,
            'operating': operating,
            'investing': investing,
            'financing': financing,
            'operating_total': operating_total,
            'investing_adjustment': -depreciation,
            'investing_total': investing_total,
            'financing_total': financing_total,
            'total_change': total_change,
            'difference': currency.round(net_change - total_change),
        }
