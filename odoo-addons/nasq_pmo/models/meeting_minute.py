# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError
from odoo.tools.mail import plaintext2html


class CyanMeetingMinute(models.Model):
    _inherit = 'cyan.meeting.minute'

    meeting_url = fields.Char()

    def _nasq_notify_partners(self, partners, kind, body, key=None):
        self.ensure_one()
        Message = self.env['mail.message'].sudo()
        for partner in partners:
            if not partner:
                continue
            full_key = f'{key}:{partner.id}' if key else False
            if full_key and Message.search_count([('nasq_notification_key', '=', full_key)]):
                continue
            values = {
                'model': self._name,
                'res_id': self.id,
                'nasq_meeting_id': self.id,
                'nasq_notification': True,
                'nasq_notification_kind': kind,
                'nasq_notification_key': full_key,
                'message_type': 'notification',
                'is_internal': True,
                'author_id': self.env.user.partner_id.id,
                'subtype_id': self.env.ref('mail.mt_note').id,
                'body': plaintext2html(body),
                'partner_ids': [(4, partner.id)],
            }
            message = Message.create(values)
            self.env['mail.notification'].sudo().create({
                'author_id': message.author_id.id,
                'mail_message_id': message.id,
                'notification_status': 'sent',
                'notification_type': 'inbox',
                'res_partner_id': partner.id,
            })

    def _nasq_sync_calendar(self):
        self.ensure_one()
        if not (self.start_datetime and self.end_datetime):
            return
        try:
            with self.env.cr.savepoint():
                if not self.calendar_event_id:
                    self.action_schedule_calendar_event()
                event = self.calendar_event_id
                if event:
                    values = {
                        'name': self.name,
                        'start': self.start_datetime,
                        'stop': self.end_datetime,
                        'location': self.location,
                        'videocall_location': self.meeting_url or False,
                    }
                    changes = {key: value for key, value in values.items() if event[key] != value}
                    if changes:
                        event.write(changes)
        except (AccessError, UserError):
            return

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for meeting in records:
            if not self.env.context.get('nasq_calendar_import'):
                meeting._nasq_sync_calendar()
            partners = meeting._cyan_participant_users().mapped('partner_id') - meeting.env.user.partner_id
            meeting._nasq_notify_partners(partners, 'meeting_invite', meeting.name, key=f'meeting-invite:{meeting.id}')
        return records

    def write(self, vals):
        previous = {meeting.id: meeting._cyan_participant_users() for meeting in self}
        result = super().write(vals)
        if {'start_datetime', 'end_datetime', 'meeting_url', 'location', 'name'} & set(vals):
            for meeting in self:
                meeting._nasq_sync_calendar()
        if {'attendee_ids', 'secretary_id'} & set(vals):
            for meeting in self:
                added = meeting._cyan_participant_users() - previous[meeting.id]
                meeting._nasq_notify_partners(
                    added.mapped('partner_id'), 'meeting_invite', meeting.name,
                    key=f'meeting-invite:{meeting.id}',
                )
        return result


class CalendarEvent(models.Model):
    _inherit = 'calendar.event'

    def action_open_meeting_minutes(self):
        # Cyan links the existing event after create. Suppress only Nasq's
        # optional auto-scheduling to avoid creating an orphan second event.
        # This flag carries no authorization and bypasses no Cyan ACL checks.
        return super(CalendarEvent, self.with_context(nasq_calendar_import=True)).action_open_meeting_minutes()
