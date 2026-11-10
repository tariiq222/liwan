# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanCrmEntitlementService(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_read_only_allowances(self):
        # Opening an opportunity logs the opening of the person who looked, which is their own bookkeeping.
        allowances = super()._liwan_read_only_allowances()
        return {**allowances, 'own': allowances['own'] | {'liwan.crm.view.log'}}
