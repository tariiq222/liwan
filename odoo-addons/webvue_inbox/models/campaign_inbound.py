# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What a customer's message means for marketing: a reply to a campaign, or a keyword that stops or resumes it."""
from odoo import api, models
from odoo.exceptions import ValidationError

from .constants import REPLY_ATTRIBUTION, UNSUBSCRIBE_ATTRIBUTION
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule

NOTE_STOP = 'إيقاف الرسائل الترويجية: أرسل العميل «%s»'
NOTE_START = 'استئناف الرسائل الترويجية: أرسل العميل «%s»'
KEYWORD_KINDS = ('text', 'interactive')


class WebVueInboxCampaignInbound(models.AbstractModel):
    _name = 'webvue.inbox.campaign.inbound'
    _description = 'Customer Inbox campaign inbound handling'
    _webvue_scope = 'global'

    @api.model
    def _webvue_on_inbound(self, conversation, message):
        """Attribute a reply, then apply a stop or start keyword. True when the message was such a keyword (no rule runs on it)."""
        recipient = self.env['webvue.inbox.campaign.recipient']._webvue_latest_for_conversation(conversation, message.date)
        age = message.date - recipient.message_id.date if recipient else None
        if recipient and not recipient.replied_at and age <= REPLY_ATTRIBUTION:
            recipient.replied_at = message.date
        settings = self.env['webvue.inbox.settings']._get_for_company(conversation.company_id)
        if not settings.keyword_opt_out or message.kind not in KEYWORD_KINDS:
            return False
        kind = self.env['webvue.inbox.opt.keyword']._webvue_match(conversation.company_id, message.body)
        if not kind:
            return False
        recent = recipient if recipient and age <= UNSUBSCRIBE_ATTRIBUTION else recipient.browse()
        contact, Message = conversation.contact_id, self.env['webvue.inbox.message']
        if kind == 'stop':
            contact._webvue_record_consent('opted_out', 'keyword', note=message.body, campaign=recent.campaign_id)
            recent._webvue_mark_unsubscribed(message.date)
            Message._webvue_post_system_note(conversation, NOTE_STOP % message.body)
            reply = settings.stop_reply
        else:
            contact._webvue_record_consent('opted_in', 'keyword', note=message.body)
            Message._webvue_post_system_note(conversation, NOTE_START % message.body)
            reply = settings.start_reply
        if reply:
            self._webvue_confirm(conversation, reply)
        return True

    @api.model
    def _webvue_confirm(self, conversation, reply):
        """Send the confirmation as an automated reply (it is inside the service window by definition)."""
        try:
            with self.env.cr.savepoint():
                self.env['webvue.inbox.message']._webvue_queue_automated(conversation, {'body': reply})
        except (WebVueAccessRule, ValidationError):
            return  # the monthly limit is reached, the channel is disabled or the conversation closed: no confirmation
