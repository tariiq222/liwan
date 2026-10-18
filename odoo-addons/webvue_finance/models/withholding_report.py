# Part of Odoo. See LICENSE file for full copyright and licensing details.
from itertools import product

from odoo import api, models

WITHHOLDING_RETURN = 'l10n_sa.tax_report_withholding_tax'


class WebVueFinanceWithholdingReport(models.AbstractModel):
    """Per-tax withholding totals of one period, read with ``_read_group`` in the caller's environment.

    Where withholding is recorded (stock ``l10n_account_withholding_tax`` and the Saudi taxes of
    ``l10n_sa``): there is no withholding model to read. A withholding tax is an ordinary purchase tax
    whose journal entry lines carry the tax tags of the stock Saudi 'Withholding Return'
    (``l10n_sa.tax_report_withholding_tax``). The 'deducted' (D) taxes are applied by the payment
    withholding lines, so their tax lines sit in the payment's journal entry; the 'gross' (G) taxes are
    cash-basis taxes of a vendor bill, so their tagged line sits in the cash basis entry made when the
    bill is paid. The return itself is data only in Community (its ``tax_tags`` engine ships with
    Enterprise), so the lines that carry the return's tax tags are grouped by their tax instead.
    """
    _name = 'webvue.finance.withholding.report'
    _description = 'WebVue finance withholding summary'

    @api.model
    def _webvue_withholding_tags(self):
        """The tax tags the stock Withholding Return reads its 'tax' column from."""
        expressions = self.env['account.report.expression'].search([
            ('report_line_id.report_id', '=', self.env.ref(WITHHOLDING_RETURN).id),
            ('engine', '=', 'tax_tags'), ('label', '=', 'tax'),
        ])
        return expressions._get_matching_tags()

    @api.model
    def _webvue_withholding_taxes(self):
        """The taxes whose repartition lines carry those tags, archived ones included."""
        repartition = self.env['account.tax.repartition.line'].with_context(active_test=False).search([
            ('tag_ids', 'in', self._webvue_withholding_tags().ids),
        ])
        return repartition.tax_id

    @api.model
    def _webvue_withholding_totals(self, company, date_from, date_to):
        """``{tax: {'base': float, 'withheld': float}}`` of the posted entries of ``company`` in the period.

        ``withheld`` is the credit balance of the tagged tax lines (the tax owed to the tax authority),
        so reversed withholding nets out. A line's ``tax_base_amount`` carries the sign of the entry that
        made it, not of the tax, so the base is added with the direction of the withheld amount.
        """
        Line = self.env['account.move.line']
        period = [
            ('company_id', '=', company.id), ('parent_state', '=', 'posted'),
            ('date', '>=', date_from), ('date', '<=', date_to),
            ('tax_line_id', '!=', False), ('tax_tag_ids', 'in', self._webvue_withholding_tags().ids),
        ]
        totals = {}
        for (withheld_sign, balance_operator), base_operator in product(((1, '<'), (-1, '>')), ('<', '>')):
            groups = Line._read_group(
                [*period, ('balance', balance_operator, 0), ('tax_base_amount', base_operator, 0)],
                ['tax_line_id'], ['tax_base_amount:sum', 'balance:sum'],
            )
            for tax, base, balance in groups:
                row = totals.setdefault(tax, {'base': 0.0, 'withheld': 0.0})
                row['base'] += withheld_sign * abs(base)
                row['withheld'] -= balance
        return {
            tax: {key: company.currency_id.round(value) + 0.0 for key, value in amounts.items()}
            for tax, amounts in totals.items()
        }
