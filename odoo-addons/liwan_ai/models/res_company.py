# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanAiResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, vals_list):
        companies = super().create(vals_list)
        # Only an Odoo system administrator creates a company (liwan_core), so the write below is theirs to make.
        self.env['liwan.ai.knowledge.indexer']._liwan_sync_companies()
        return companies
