# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo import fields, models
from odoo.tools.image import image_data_uri


class AccountMove(models.Model):
    _inherit = 'account.move'

    # Set only by the fiscal year-end close (controllers/finance_closing.py); never editable through the API.
    # Consumers of P&L actuals (reports, budgets) leave the moves with this year set out.
    liwan_closing_year = fields.Integer(string='Year-end closing of fiscal year', readonly=True, copy=False, index=True)

    _closing_year_unique = models.UniqueIndex(
        '(company_id, liwan_closing_year) WHERE liwan_closing_year != 0',
        'A company has one year-end closing entry per fiscal year.',
    )

    def _liwan_zatca_qr_data_uri(self):
        """The ZATCA QR of a Saudi invoice as an inline PNG, so the PDF never fetches /report/barcode."""
        self.ensure_one()
        png = self.env['ir.actions.report'].barcode('QR', self.l10n_sa_qr_code_str, width=200, height=200)
        return image_data_uri(base64.b64encode(png))
