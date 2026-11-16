# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .sales_settings import FEATURE as CRM_FEATURE
from odoo.addons.liwan_sales.models.access_service import QUOTATIONS_MANAGE

SALES_FEATURE = 'sales.enabled'


class CrmLead(models.Model):
    _inherit = 'crm.lead'

    @api.model
    def _liwan_win_by_order(self):
        """Whether opportunities are won by an order now: Sales is included in the plan and the tenant lets a confirmed
        order win them. A tenant fact: it does not depend on what the caller may do in Sales."""
        entitlement = self.env['liwan.entitlement.service']
        return bool(
            entitlement._liwan_feature_read(SALES_FEATURE) and entitlement._liwan_feature_read(CRM_FEATURE)
            and self.env['liwan.sales.settings']._liwan_current().opportunity_win == 'order_confirmed',
        )

    @api.model
    def _liwan_can_quote(self):
        """Whether the caller holds ``sales.quotations.manage`` in the working company, the right to write what wins."""
        return QUOTATIONS_MANAGE in self.env['liwan.sales.visibility']._liwan_keys(self.env.user, self.env.company)
