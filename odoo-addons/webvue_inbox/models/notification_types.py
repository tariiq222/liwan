# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The inbox application's notification kind in the webvue_notify registry (no sudo)."""
from odoo import api, models

from .access_service import READ
from odoo.addons.webvue_api.serializers.common import iso

KIND = 'inbox.assigned'
CONVERSATION_MODEL = 'webvue.inbox.conversation'


class WebVueInboxNotificationTypes(models.AbstractModel):
    _inherit = 'webvue.notify.registry'

    @api.model
    def _webvue_notification_types(self):
        return (
            *super()._webvue_notification_types(),
            {'kind': KIND, 'owner': 'webvue_inbox', 'model': CONVERSATION_MODEL, 'feature_key': 'inbox.enabled'},
        )

    @api.model
    def _webvue_notify_visible_domain(self):
        Conversation = self.env[CONVERSATION_MODEL]
        allowed = (
            self.env['webvue.access.service']._webvue_has_capability(self.env.user, READ)
            and Conversation.has_access('read')
        )
        ids = Conversation._search(Conversation._webvue_visible_domain()) if allowed else []
        return [
            *super()._webvue_notify_visible_domain(),
            [
                ('mail_message_id.webvue_notification_kind', '=', KIND),
                ('mail_message_id.model', '=', CONVERSATION_MODEL),
                ('mail_message_id.res_id', 'in', ids),
                ('mail_message_id.webvue_inbox_conversation_id', 'in', ids),
            ],
        ]

    @api.model
    def _webvue_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.webvue_notification_kind == KIND:
            return {
                'id': row.id,
                'kind': KIND,
                'conversation_id': message.webvue_inbox_conversation_id,
                'title': message.webvue_inbox_contact_name or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._webvue_notify_dump(row, extra)
