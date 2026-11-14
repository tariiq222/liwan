# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import (
    REASON_LOG,
    REASON_RUNTIME,
    model_dataset,
)

APP = 'inbox'
# Channels and settings are explicit allowlists: a new field is not exported until someone decides it belongs in the export.
# An addon that extends the model adds its own fields through the two hook methods below.
# The provider's free-text error fields (last_error, analytics_error) are left out on purpose.
CHANNEL_FIELDS = (
    'id',
    'name',
    'kind',
    'state',
    'owner_company_id',
    'department_id',
    'phone_number_id',
    'business_account_id',
    'app_id',
    'display_phone_number',
    'verified_name',
    'requested_name',
    'name_status',
    'quality_rating',
    'messaging_limit',
    'throughput_level',
    'account_state',
    'account_restricted_until',
    'last_event_at',
    'welcome_enabled',
    'welcome_idle_days',
    'away_enabled',
    'away_repeat_hours',
    'csat_enabled',
    'csat_question',
    'csat_good',
    'csat_neutral',
    'csat_bad',
    'currency_code',
    'tiktok_bound',
    'tiktok_business_id',
    'tiktok_username',
    'tiktok_prompts_enabled',
    'tiktok_questions_enabled',
    'create_date',
    'write_date',
)
SETTINGS_FIELDS = (
    'id',
    'assignment_policy',
    'auto_close_hours',
    'company_id',
    'consent_policy',
    'create_date',
    'default_country_code',
    'default_daily_cap',
    'first_response_alert_minutes',
    'hours_timezone',
    'keyword_opt_out',
    'report_retention_months',
    'reports_built_timezone',
    'retention_months',
    'round_robin_user_id',
    'start_reply',
    'stop_reply',
    'visibility_policy',
    'write_date',
)
DATASETS = (
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
)


class LiwanInboxTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_inbox_channel_export_fields(self):
        """The channel columns of the export; an addon that adds a stored channel field extends this through ``super()``."""
        return list(CHANNEL_FIELDS)

    @api.model
    def _liwan_inbox_settings_export_fields(self):
        """The settings columns of the export; an addon that adds a stored settings field extends this through ``super()``."""
        return list(SETTINGS_FIELDS)

    @api.model
    def _liwan_export_datasets(self):
        return [
            *super()._liwan_export_datasets(),
            model_dataset(
                self.env, APP, 'inbox_channels', 'Channels', 'liwan.inbox.channel', fields=self._liwan_inbox_channel_export_fields(),
            ),
            model_dataset(
                self.env, APP, 'inbox_settings', 'Settings', 'liwan.inbox.settings', fields=self._liwan_inbox_settings_export_fields(),
            ),
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
