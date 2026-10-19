# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class AccountMove(models.Model):
    _inherit = 'account.move'

    # Set only by the fiscal year-end close (controllers/finance_closing.py); never editable through the API.
    # Consumers of P&L actuals (reports, budgets) leave the moves with this year set out.
    webvue_closing_year = fields.Integer(string='Year-end closing of fiscal year', readonly=True, copy=False, index=True)

    _closing_year_unique = models.UniqueIndex(
        '(company_id, webvue_closing_year) WHERE webvue_closing_year != 0',
        'A company has one year-end closing entry per fiscal year.',
    )
