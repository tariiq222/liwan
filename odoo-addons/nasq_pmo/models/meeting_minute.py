# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextvars import ContextVar

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError
from odoo.tools.mail import plaintext2html

_CALENDAR_IMPORT = ContextVar('nasq_calendar_import', default=False)
_CALENDAR_OUTBOUND = ContextVar('nasq_calendar_outbound', default=frozenset())


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
        linked = bool(self.calendar_event_id)
        complete_schedule = bool(self.start_datetime and self.end_datetime)
        if not linked and not complete_schedule:
            return
        try:
            with self.env.cr.savepoint():
                if not self.calendar_event_id:
                    self.action_schedule_calendar_event()
                event = self.calendar_event_id
                if event:
                    values = {
                        'name': self.name,
                        'location': self.location,
                        'user_id': self.organizer_id.id,
                        'videocall_location': self.meeting_url or False,
                    }
                    # A linked event still needs membership revocation when
                    # meeting dates are cleared. Keep its last valid schedule.
                    if complete_schedule:
                        values.update(start=self.start_datetime, stop=self.end_datetime)
                    changes = {key: value for key, value in values.items()
                               if (event[key].id if key == 'user_id' else event[key]) != value}
                    partner_ids = self._cyan_participant_users().mapped('partner_id').ids
                    if set(event.partner_ids.ids) != set(partner_ids):
                        changes['partner_ids'] = [(6, 0, partner_ids)]
                    if changes:
                        token = _CALENDAR_OUTBOUND.set(_CALENDAR_OUTBOUND.get() | {self.id})
                        try:
                            event.write(changes)
                        finally:
                            _CALENDAR_OUTBOUND.reset(token)
        except (AccessError, UserError):
            if linked:
                raise
            return

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for meeting in records:
            if not _CALENDAR_IMPORT.get():
                meeting._nasq_sync_calendar()
            partners = meeting._cyan_participant_users().mapped('partner_id') - meeting.env.user.partner_id
            meeting._nasq_notify_partners(partners, 'meeting_invite', meeting.name, key=f'meeting-invite:{meeting.id}')
        return records

    def write(self, vals):
        previous = {meeting.id: meeting._cyan_participant_users() for meeting in self}
        result = super().write(vals)
        if {'start_datetime', 'end_datetime', 'meeting_url', 'location', 'name', 'attendee_ids', 'secretary_id', 'organizer_id'} & set(vals):
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

    @api.private
    def _cyan_write_calendar_schedule(self, values):
        self.ensure_one()
        # Only the server-local outbound call may suppress the Cyan round-trip.
        if self.id in _CALENDAR_OUTBOUND.get():
            return True
        values = dict(values)
        if 'attendee_ids' in values and self.secretary_id:
            attendee_ids = values['attendee_ids'][0][2]
            if self.secretary_id.id in attendee_ids:
                values['attendee_ids'] = [(6, 0, [uid for uid in attendee_ids if uid != self.secretary_id.id])]
            elif self.secretary_id.id != values.get('organizer_id'):
                values['secretary_id'] = False
        return super()._cyan_write_calendar_schedule(values)


class CalendarEvent(models.Model):
    _inherit = 'calendar.event'

    def action_open_meeting_minutes(self):
        # The server-local marker is inaccessible to forged RPC context flags.
        token = _CALENDAR_IMPORT.set(True)
        try:
            return super().action_open_meeting_minutes()
        finally:
            _CALENDAR_IMPORT.reset(token)
