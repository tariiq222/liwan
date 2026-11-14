# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanInboxPaymentsTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_inbox_channel_export_fields(self):
        return [
            *super()._liwan_inbox_channel_export_fields(),
            'paid_notice_enabled', 'paid_notice_text', 'commerce_cart_enabled', 'commerce_catalog_visible', 'commerce_phone',
        ]
