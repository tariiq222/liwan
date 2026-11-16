# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Support Desk features a plan carries.

``helpdesk.enabled`` installs the application and gates every route of it; ``helpdesk.merge`` gates the
routes that fold one ticket into another. Every other area (SLA policies, ratings, automatic closing, the
customer page, the email channel) registers its key with the pull request that first uses it, so the
catalog never carries a switch nothing reads.
"""
from odoo import api, models


class LiwanHelpdeskFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {
                'key': 'helpdesk.enabled',
                'type': 'boolean',
                'owner': 'liwan_helpdesk',
                'module': 'liwan_helpdesk',
            },
            {
                'key': 'helpdesk.merge',
                'type': 'boolean',
                'owner': 'liwan_helpdesk',
                'module': 'liwan_helpdesk',
            },
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + (
            {'id': 'liwan_helpdesk'},
        )
