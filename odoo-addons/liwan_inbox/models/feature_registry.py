# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanInboxFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {
                'key': 'inbox.enabled',
                'type': 'boolean',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
            {
                'key': 'inbox.whatsapp',
                'type': 'boolean',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
            {
                'key': 'inbox.templates',
                'type': 'boolean',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
            {
                'key': 'inbox.automation',
                'type': 'boolean',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
            {
                'key': 'inbox.flows',
                'type': 'boolean',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
            {
                'key': 'inbox.reports',
                'type': 'boolean',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
            {
                'key': 'inbox.campaigns',
                'type': 'boolean',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
            {
                'key': 'inbox.channels',
                'type': 'limit',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
            {
                'key': 'inbox.messages_out',
                'type': 'limit',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
            {
                'key': 'inbox.campaign_recipients',
                'type': 'limit',
                'owner': 'liwan_inbox',
                'module': 'liwan_inbox',
            },
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + (
            {'id': 'liwan_inbox'},
        )
