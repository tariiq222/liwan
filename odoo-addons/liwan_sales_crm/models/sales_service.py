# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_sales.models.sales_service import QUIET


class LiwanSalesService(models.AbstractModel):
    _inherit = 'liwan.sales.service'

    @api.model
    def _liwan_create_from_opportunity(self, lead):
        """A draft staff quotation of the caller for ``lead``, an opportunity the caller reads in the working company.

        The link is a write on the opportunity (the win that follows runs elevated), so the caller must be its agent or hold
        ``crm.leads.assign``: the same 403 CRM gives for any write. The customer is the opportunity's linked customer, and the
        quotation starts with no line. 422 when the opportunity is lost or archived, or has no customer the caller sees. The
        caller's Sales rules still judge the rest, as a quotation written by hand.
        """
        lead._liwan_visibility()._liwan_check_write(lead, self.env.user)
        if lead.company_id != self.env.company:
            code = 'invalid'
            raise LiwanAccessRule(code, 'the opportunity belongs to another company', status=422)
        if not lead.active or lead.won_status == 'lost':
            code = 'invalid'
            raise LiwanAccessRule(
                code, 'a lost or archived opportunity takes no new quotation', status=422,
                details={'reason': 'crm_opportunity_closed'},
            )
        customer = lead._liwan_linked_customer()
        if not customer:
            code = 'invalid'
            raise LiwanAccessRule(
                code, 'link the opportunity to a customer before writing its quotation', field='customer_id', status=422,
                details={'reason': 'crm_opportunity_without_customer'},
            )
        order = self._liwan_create({'customer_id': customer.id, 'lines': []})
        order.with_context(**QUIET).write({'liwan_lead_id': lead.id})
        return order
