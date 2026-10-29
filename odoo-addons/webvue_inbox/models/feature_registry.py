# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueInboxFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'inbox.enabled',
                'type': 'boolean',
                'owner': 'webvue_inbox',
                'module': 'webvue_inbox',
            },
            {
                'key': 'inbox.whatsapp',
                'type': 'boolean',
                'owner': 'webvue_inbox',
                'module': 'webvue_inbox',
            },
            {
                'key': 'inbox.templates',
                'type': 'boolean',
                'owner': 'webvue_inbox',
                'module': 'webvue_inbox',
            },
            {
                'key': 'inbox.channels',
                'type': 'limit',
                'owner': 'webvue_inbox',
                'module': 'webvue_inbox',
            },
            {
                'key': 'inbox.messages_out',
                'type': 'limit',
                'owner': 'webvue_inbox',
                'module': 'webvue_inbox',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + (
            {'id': 'webvue_inbox'},
        )
