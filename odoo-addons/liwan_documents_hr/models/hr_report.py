# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models


class HrReport(models.AbstractModel):
    _inherit = 'liwan.hr.report'

    @api.model
    def _liwan_additional_expiring(self, within_days):
        items = super()._liwan_additional_expiring(within_days)
        entitlement = self.env['liwan.entitlement.service']
        documents = self.env['liwan.document']
        if not entitlement._liwan_feature_read(
            'hr.enabled',
        ) or not documents._liwan_actor_allows('read'):
            return items
        today = fields.Date.context_today(self)
        for document in documents.search(
            [
                ('expiry_date', '!=', False),
                ('expiry_date', '<=', today + timedelta(days=within_days)),
            ],
        ):
            items.append(
                {
                    'kind': 'document',
                    'employee': None,
                    'document': {'id': document.id, 'name': document.name},
                    'due_date': document.expiry_date,
                    'days_left': (document.expiry_date - today).days,
                },
            )
        return items
