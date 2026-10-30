# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

VAT_TAX_SCOPES = ('sale', 'purchase')


class LiwanFinanceVatReport(models.AbstractModel):
    """Per-tax VAT totals of one period, read with ``_read_group`` in the caller's environment.

    The Saudi 'VAT Return' (``l10n_sa.tax_report_vat_filing``) is only data in Community:
    the ``account.report`` engine that evaluates its ``tax_tags`` expressions ships with
    Enterprise (``account_reports``), so the totals are grouped from the posted journal items.
    """
    _name = 'liwan.finance.vat.report'
    _description = 'LiwanOS finance VAT summary'

    @api.model
    def _liwan_vat_totals(self, company, date_from, date_to):
        """``{tax: {'base': float, 'tax': float}}`` for sale and purchase taxes, signed as a return reads.

        Sales are credit balances, so their sign is flipped; purchases keep the debit sign.
        A reverse-charge tax therefore shows its base and a net tax of zero.
        Withholding taxes (those of the Saudi 'Withholding Return') are not VAT and never appear.
        A group tax is reported through its individual child taxes (its lines carry the children),
        cash-basis taxes count at the invoice date, and only the given company is read, not its branches.
        """
        Line = self.env['account.move.line']
        period = [
            ('company_id', '=', company.id), ('parent_state', '=', 'posted'),
            ('date', '>=', date_from), ('date', '<=', date_to),
        ]
        bases = Line._read_group(
            [*period, ('display_type', '=', 'product'), ('tax_ids', '!=', False)],
            ['tax_ids'], ['balance:sum'],
        )
        taxes = Line._read_group([*period, ('tax_line_id', '!=', False)], ['tax_line_id'], ['balance:sum'])
        withholding = self.env['liwan.finance.withholding.report']._liwan_withholding_taxes()
        totals = {}
        for field, groups in (('base', bases), ('tax', taxes)):
            for tax, balance in groups:
                if tax.type_tax_use in VAT_TAX_SCOPES and tax not in withholding:
                    sign = -1 if tax.type_tax_use == 'sale' else 1
                    totals.setdefault(tax, {'base': 0.0, 'tax': 0.0})[field] = company.currency_id.round(sign * balance) + 0.0
        return totals
