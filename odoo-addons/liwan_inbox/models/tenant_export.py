# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import (
    REASON_LOG,
    REASON_RUNTIME,
    model_dataset,
)

APP = 'inbox'
DATASETS = (
    ('inbox_channels', 'Channels', 'liwan.inbox.channel', False),
    ('inbox_departments', 'Departments', 'liwan.inbox.department', False),
    ('inbox_tags', 'Tags', 'liwan.inbox.tag', False),
    ('inbox_canned_replies', 'Canned replies', 'liwan.inbox.canned.reply', False),
    ('inbox_contacts', 'Contacts', 'liwan.inbox.contact', False),
    ('inbox_contact_identities', 'Contact identities', 'liwan.inbox.contact.identity', False),
    ('inbox_contact_consents', 'Contact consents', 'liwan.inbox.contact.consent', False),
    ('inbox_conversations', 'Conversations', 'liwan.inbox.conversation', False),
    ('inbox_messages', 'Messages', 'liwan.inbox.message', True),
    ('inbox_message_buttons', 'Message buttons', 'liwan.inbox.message.button', False),
    ('inbox_message_options', 'Message options', 'liwan.inbox.message.option', False),
    ('inbox_message_order_lines', 'Order lines', 'liwan.inbox.message.order.line', False),
    ('inbox_templates', 'Templates', 'liwan.inbox.template', False),
    ('inbox_campaigns', 'Campaigns', 'liwan.inbox.campaign', False),
    ('inbox_campaign_recipients', 'Campaign recipients', 'liwan.inbox.campaign.recipient', False),
    ('inbox_audiences', 'Audiences', 'liwan.inbox.audience', False),
    ('inbox_hours_ranges', 'Hours ranges', 'liwan.inbox.hours.range', False),
    ('inbox_hours_holidays', 'Holidays', 'liwan.inbox.hours.holiday', False),
    ('inbox_settings', 'Settings', 'liwan.inbox.settings', False),
)


class LiwanInboxTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        return [
            *super()._liwan_export_datasets(),
            *(
                model_dataset(self.env, APP, key, title, model, attachments=files)
                for key, title, model, files in DATASETS
            ),
        ]

    @api.model
    def _liwan_export_technical_models(self):
        runtime = (
            'liwan.inbox.report.day', 'liwan.inbox.cost.day', 'liwan.inbox.template.day', 'liwan.inbox.template.click',
            'liwan.inbox.tiktok.sync', 'liwan.inbox.applied.preset',
        )
        return {
            **super()._liwan_export_technical_models(),
            **dict.fromkeys(runtime, REASON_RUNTIME),
            'liwan.inbox.event': REASON_LOG,
            'liwan.inbox.channel.alert': REASON_LOG,
            'liwan.inbox.flow.error': REASON_LOG,
        }
