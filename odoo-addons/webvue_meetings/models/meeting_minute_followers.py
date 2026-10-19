# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Who may follow, be notified of, or post on a meeting."""
from odoo import _, models
from odoo.exceptions import AccessError


class WebVueMeetingMinuteFollowers(models.Model):
    _inherit = 'webvue.meeting.minute'

    def _webvue_allowed_follower_partners(self):
        self.ensure_one()
        service = self.env['webvue.access.service']
        # sudo READ: meeting-manager group members, narrowed by actual company grants; no meeting fields.
        candidates = self.env.ref('webvue_meetings.group_cap_meetings_manage').sudo().user_ids
        managers = candidates.filtered(lambda user: user.active and not user.share
            and self.company_id in user.company_ids
            and service._webvue_has_capability(user, 'meetings.manage', company=self.company_id))
        return (self._webvue_participant_users() | managers).mapped('partner_id')

    def _webvue_follower_partners(self):
        return self._webvue_allowed_follower_partners()

    def message_subscribe(self, partner_ids=None, subtype_ids=None):
        if partner_ids and not self.env.su:
            allowed = set()
            for record in self:
                allowed.update(record._webvue_allowed_follower_partners().ids)
            if set(partner_ids) - allowed:
                raise AccessError(_('You cannot add followers who cannot access this record.'))
        return super().message_subscribe(partner_ids=partner_ids, subtype_ids=subtype_ids)

    def _webvue_assert_mail_post_kwargs(self, kwargs):
        if self.env.su:
            return
        allowed_docs = {(self._name, record.id) for record in self}
        attachment_ids = kwargs.get('attachment_ids') or []
        if attachment_ids:
            attachments = self.env['ir.attachment'].browse(attachment_ids).exists()
            attachments.check_access('read')
            allowed_unbound = {False, '', 'mail.compose.message', 'mail.scheduled.message'}
            for attachment in attachments:
                bound = (attachment.res_model, attachment.res_id) in allowed_docs
                own_unbound = (
                    not attachment.res_id
                    and attachment.create_uid == self.env.user
                    and (attachment.res_model or False) in allowed_unbound
                )
                if not bound and not own_unbound:
                    raise AccessError(_('You cannot attach files from another record.'))
        parent_id = kwargs.get('parent_id')
        if parent_id:
            parent = self.env['mail.message'].browse(parent_id)
            if parent.exists() and (parent.model, parent.res_id) not in allowed_docs:
                raise AccessError(_('You cannot reply to a message from another record.'))
        kwargs.pop('author_id', None)

    def message_post(self, **kwargs):
        partner_ids = kwargs.get('partner_ids') or []
        if partner_ids and not self.env.su:
            allowed = set()
            for record in self:
                allowed.update(record._webvue_allowed_follower_partners().ids)
            if set(partner_ids) - allowed:
                raise AccessError(_('You cannot notify partners who cannot access this record.'))
        self._webvue_assert_mail_post_kwargs(kwargs)
        return super().message_post(**kwargs)

    def _notify_get_recipients(self, message, msg_vals=False, **kwargs):
        recipients = super()._notify_get_recipients(message, msg_vals=msg_vals, **kwargs)
        allowed = set()
        for record in self:
            allowed.update(record._webvue_allowed_follower_partners().ids)
        return [recipient for recipient in recipients if recipient.get('id') in allowed]

    def _webvue_sync_followers(self, previous=None):
        previous = previous or {}
        for meeting in self:
            allowed = meeting._webvue_follower_partners()
            extra = meeting.message_partner_ids - allowed
            extra = extra.filtered(lambda partner: partner.user_ids)
            if extra:
                meeting.message_unsubscribe(partner_ids=extra.ids)
            stale = previous.get(meeting.id)
            if stale:
                removed = stale - allowed
                if removed:
                    meeting.message_unsubscribe(partner_ids=removed.ids)
