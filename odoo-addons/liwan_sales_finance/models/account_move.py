# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models

from odoo.addons.liwan_sales.models.access_service import READ

SALES_FEATURE = 'sales.enabled'


class AccountMove(models.Model):
    _inherit = 'account.move'

    def _liwan_detail_extras(self):
        return {**super()._liwan_detail_extras(), 'source_order': self._liwan_source_order()}

    def _liwan_source_order(self):
        """``{id, number}`` of the sales order this document was made from, when the caller reads it in Sales now (Sales is
        in the plan, they hold ``sales.read`` in the document's company and the visibility setting shows it to them), else
        None: the number never leaves the server otherwise. A credit note names the order of the invoice it reverses."""
        self.ensure_one()
        user = self.env.user
        if not (
            self.env['liwan.entitlement.service']._liwan_feature_read(SALES_FEATURE)
            and self.env['liwan.access.service']._liwan_has_capability(user, READ, company=self.company_id)
        ):
            return None
        origin = self.reversed_entry_id or self
        Order = self.env['sale.order']
        found = Order.search(
            [('id', 'in', origin.line_ids.sale_line_ids.order_id.ids), *self.env['liwan.sales.visibility']._liwan_domain(user)],
            order='id', limit=1,
        )
        return {'id': found.id, 'number': found.name} if found else None
