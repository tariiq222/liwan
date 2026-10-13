# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqChatEntitlementService(models.AbstractModel):
    _inherit = 'nasq.entitlement.service'

    @api.model
    def _nasq_terminology_keys(self):
        return super()._nasq_terminology_keys() | frozenset({
            'nav.chat',
            'chat.title',
        })
