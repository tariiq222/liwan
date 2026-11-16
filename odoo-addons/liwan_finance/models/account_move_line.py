# Part of Odoo. See LICENSE file for full copyright and licensing details.
from collections import defaultdict

from odoo import models


class AccountMoveLine(models.Model):
    _inherit = 'account.move.line'

    def _compute_tax_ids(self):
        """Stock taxes first, then a product line of a sale document of an establishment not registered for VAT
        loses every tax (plan D20).

        The rule is the one ``liwan_orders`` applies to a sale order line: ``res.company._liwan_vat_registered``
        decides, and it sits on the stock compute, so it holds whenever the line is created without explicit taxes or
        its product or account is edited. A line keeps the tax it was issued with when the registration changes. A
        line without a product, and every purchase line, keeps what stock computed.
        """
        super()._compute_tax_ids()
        lines_by_company = defaultdict(lambda: self.env['account.move.line'])
        for line in self:
            if line.product_id and line.move_id.is_sale_document(include_receipts=True):
                lines_by_company[line.company_id] += line
        for company, lines in lines_by_company.items():
            if not company._liwan_vat_registered():
                lines.tax_ids = False
