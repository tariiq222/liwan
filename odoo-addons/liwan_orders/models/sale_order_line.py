# Part of Odoo. See LICENSE file for full copyright and licensing details.
from collections import defaultdict

from odoo import models


class SaleOrderLine(models.Model):
    _inherit = 'sale.order.line'

    def _compute_tax_ids(self):
        """Stock taxes first, then a line of an establishment not registered for VAT loses every tax.

        The rule sits on the stock compute, so it holds for a line an online channel made and for a line a member
        of staff typed, when the line is created without explicit taxes and whenever its product or company is
        edited. It declares no dependency of its own (plan D3): a dependency on the registration would recompute
        the lines of confirmed and invoiced orders when the registration changes. A line therefore keeps the tax it
        was issued with, and a line edited after the change follows the new answer.
        """
        super()._compute_tax_ids()
        lines_by_company = defaultdict(lambda: self.env['sale.order.line'])
        for line in self:
            if line.company_id:
                lines_by_company[line.company_id] += line
        for company, lines in lines_by_company.items():
            if not company._liwan_vat_registered():
                lines.tax_ids = False

    def copy_data(self, default=None):
        """A copied line of an establishment not registered for VAT is a new line, so it is taxed anew: with none.

        Stock copies ``tax_ids`` as an explicit value, which skips the compute and with it the rule: an order
        duplicated after the establishment stopped being registered would keep its old VAT. Removing the value for
        such a line lets the stock compute and the rule decide, also when the line is copied into an order of
        another company. A ``tax_ids`` in ``default`` is the caller's explicit choice and stays.

        A line of a registered establishment is returned exactly as stock built it: a hand-set tax and a global
        discount line carry taxes the compute cannot reproduce from the product.
        """
        copies = super().copy_data(default)
        if 'tax_ids' not in (default or {}):
            for line, values in zip(self, copies):
                # stock returns None for a record already copied in the same call
                if values is not None and line.company_id and not line.company_id._liwan_vat_registered():
                    values.pop('tax_ids', None)
        return copies
