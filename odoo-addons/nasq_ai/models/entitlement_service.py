# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqAiEntitlementService(models.AbstractModel):
    _inherit = 'nasq.entitlement.service'

    @api.model
    def _nasq_count_usage(self, limit_key):
        if limit_key == 'ai.messages.monthly':
            return self.env['nasq.ai.audit']._nasq_ai_count_messages()
        return super()._nasq_count_usage(limit_key)
