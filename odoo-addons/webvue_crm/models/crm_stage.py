# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

STOCK_STAGES = ('stage_lead1', 'stage_lead2', 'stage_lead3', 'stage_lead4')


class CrmStage(models.Model):
    _inherit = 'crm.stage'

    # Stock stages cannot be archived; the settings page archives instead of deleting.
    active = fields.Boolean(default=True)

    @api.model
    def _webvue_retire_stock_stages(self):
        """Archive the stock pipeline stages, first moving their leads to the first WebVue stage."""
        stock = self.browse()
        for name in STOCK_STAGES:
            stock |= self.env.ref(f'crm.{name}', raise_if_not_found=False) or self.browse()
        leads = self.env['crm.lead'].with_context(active_test=False).search([('stage_id', 'in', stock.ids)])
        leads.write({'stage_id': self.env.ref('webvue_crm.stage_new').id})
        stock.write({'active': False})
