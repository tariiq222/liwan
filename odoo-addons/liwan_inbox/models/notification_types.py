# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The inbox application's notification kind in the liwan_notify registry (no sudo)."""
from odoo import api, models

from .access_service import MANAGE_CHANNELS, READ
from .health_constants import HEALTH_KIND
from odoo.addons.liwan_api.serializers.common import iso

KIND = 'inbox.assigned'
FIRST_RESPONSE_KIND = 'inbox.first_response'
KINDS = (KIND, FIRST_RESPONSE_KIND)
CONVERSATION_MODEL = 'liwan.inbox.conversation'
CHANNEL_MODEL = 'liwan.inbox.channel'


class LiwanInboxNotificationTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            *(
                {'kind': kind, 'owner': 'liwan_inbox', 'model': CONVERSATION_MODEL, 'feature_key': 'inbox.enabled'}
                for kind in KINDS
            ),
            {'kind': HEALTH_KIND, 'owner': 'liwan_inbox', 'model': CHANNEL_MODEL, 'feature_key': 'inbox.enabled'},
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        Conversation = self.env[CONVERSATION_MODEL]
        allowed = (
            self.env['liwan.access.service']._liwan_has_capability(self.env.user, READ)
            and Conversation.has_access('read')
        )
        ids = Conversation._search(Conversation._liwan_visible_domain()) if allowed else []
        Channel = self.env[CHANNEL_MODEL]
        companies = self.env['liwan.access.service']._liwan_capability_company_ids((MANAGE_CHANNELS,))
        channel_ids = Channel._search([('owner_company_id', 'in', companies)]) if companies and Channel.has_access('read') else []
        return [
            *super()._liwan_notify_visible_domain(),
            [
                ('mail_message_id.liwan_notification_kind', '=', HEALTH_KIND),
                ('mail_message_id.model', '=', CHANNEL_MODEL),
                ('mail_message_id.res_id', 'in', channel_ids),
                ('mail_message_id.liwan_inbox_channel_id', 'in', channel_ids),
            ],
            [
                ('mail_message_id.liwan_notification_kind', 'in', KINDS),
                ('mail_message_id.model', '=', CONVERSATION_MODEL),
                ('mail_message_id.res_id', 'in', ids),
                ('mail_message_id.liwan_inbox_conversation_id', 'in', ids),
            ],
        ]

    @api.model
    def _liwan_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.liwan_notification_kind in KINDS:
            return {
                'id': row.id,
                'kind': message.liwan_notification_kind,
                'conversation_id': message.liwan_inbox_conversation_id,
                'title': message.liwan_inbox_contact_name or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        if message.liwan_notification_kind == HEALTH_KIND:
            return {
                'id': row.id,
                'kind': HEALTH_KIND,
                'channel_id': message.liwan_inbox_channel_id,
                'title': message.liwan_inbox_channel_name or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._liwan_notify_dump(row, extra)
