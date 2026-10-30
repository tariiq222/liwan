# Part of Odoo. See LICENSE file for full copyright and licensing details.
from calendar import monthrange
from datetime import date

from odoo import api, models

# A human label only; the server-set ``liwan_closing_year`` field identifies the entry.
CLOSING_REF = 'FYC/{year}'


class LiwanFinanceClosing(models.AbstractModel):
    """The fiscal-year dates and the year-end closing entries of a company, read in the caller's environment."""
    _name = 'liwan.finance.closing'
    _description = 'LiwanOS finance fiscal year closing'

    @api.model
    def _liwan_year_dates(self, company, year):
        """The fiscal year that ends in calendar ``year`` (the convention of the OCA year closing)."""
        month = int(company.fiscalyear_last_month)
        end = date(year, month, min(company.fiscalyear_last_day, monthrange(year, month)[1]))
        return company.compute_fiscalyear_dates(end)

    @api.model
    def _liwan_closing_moves(self, company, year=None):
        """The posted year-end entries of ``company`` (of fiscal ``year`` when given), by their server-set year."""
        year_domain = [('liwan_closing_year', '=', year)] if year else [('liwan_closing_year', '!=', 0)]
        return self.env['account.move'].search([
            ('company_id', '=', company.id), ('state', '=', 'posted'), *year_domain,
        ])
