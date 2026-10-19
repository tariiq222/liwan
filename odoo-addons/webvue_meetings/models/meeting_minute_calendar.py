# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Calendar event link and two-way sync of a meeting.

The two private writes below call the model's base `write` on purpose: they run after their own guards and must
not go through the human-write checks of `WebVueMeetingMinute.write`.
"""
from odoo import _, api, models
from odoo.exceptions import AccessError, UserError

from .meeting_context import _CALENDAR_OUTBOUND
from .meeting_minute import WebVueMeetingMinute


class WebVueMeetingMinuteCalendar(models.Model):
    _inherit = 'webvue.meeting.minute'

    @api.private
    def _webvue_link_calendar_event(self, event):
        self.ensure_one()
        if not self.env.su:
            if self.state in self._LOCKED_STATES:
                raise UserError(_('Completed and cancelled meetings are immutable.'))
            if not self._webvue_is_editor() and not self._webvue_is_manager():
                raise AccessError(_('Only the organizer, secretary or a Meeting Manager may link a calendar event.'))
            event.check_access('read')
        return super(WebVueMeetingMinute, self).write({'calendar_event_id': event.id})

    @api.private
    def _webvue_write_calendar_schedule(self, values):
        self.ensure_one()
        # Only the server-local outbound call may suppress the calendar round-trip.
        if self.id in _CALENDAR_OUTBOUND.get():
            return True
        values = dict(values)
        if 'attendee_ids' in values and self.secretary_id:
            attendee_ids = values['attendee_ids'][0][2]
            if self.secretary_id.id in attendee_ids:
                values['attendee_ids'] = [(6, 0, [uid for uid in attendee_ids if uid != self.secretary_id.id])]
            elif self.secretary_id.id != values.get('organizer_id'):
                values['secretary_id'] = False
        if self.state in self._LOCKED_STATES:
            raise UserError(_('Completed and cancelled meetings are immutable.'))
        if not self._webvue_is_manager() and not self._webvue_is_editor():
            raise AccessError(_('Updating the calendar event cannot change meeting minutes you cannot edit.'))
        previous = {self.id: self._webvue_follower_partners()}
        result = super(WebVueMeetingMinute, self).write(values)
        self._webvue_sync_followers(previous)
        return result

    def action_open_calendar_event(self):
        self.ensure_one()
        if not self.calendar_event_id:
            raise UserError(_('This meeting is not linked to a Calendar Event.'))
        self.calendar_event_id.check_access('read')
        return {
            'type': 'ir.actions.act_window',
            'name': _('Calendar Event'),
            'res_model': 'calendar.event',
            'res_id': self.calendar_event_id.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_schedule_calendar_event(self):
        self.ensure_one()
        if self.calendar_event_id:
            return self.action_open_calendar_event()
        if self.state in self._LOCKED_STATES:
            raise UserError(_('Completed and cancelled meetings are immutable.'))
        if not self._webvue_is_editor() and not self._webvue_is_manager():
            raise AccessError(_('Only the organizer, secretary or a Meeting Manager may schedule this meeting.'))
        if not self.start_datetime or not self.end_datetime:
            raise UserError(_('Set Start and End before scheduling this meeting in Calendar.'))
        partners = self._webvue_participant_users().mapped('partner_id')
        event = self.env['calendar.event'].create({
            'name': self.name,
            'start': self.start_datetime,
            'stop': self.end_datetime,
            'location': self.location,
            'user_id': self.organizer_id.id,
            'partner_ids': [(6, 0, partners.ids)],
            'privacy': 'confidential',
        })
        self._webvue_link_calendar_event(event)
        self.message_post(
            body=_('Linked to Calendar event: %s', event.name),
            subtype_xmlid='mail.mt_note',
        )
        return self.action_open_calendar_event()

    def _webvue_sync_calendar(self):
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
                    partner_ids = self._webvue_participant_users().mapped('partner_id').ids
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

    def _webvue_set_calendar_event_active(self, active):
        """A cancelled meeting leaves its attendees' calendars; a reopened one returns to them."""
        self.ensure_one()
        event = self.calendar_event_id
        if event and event.active != active:
            event.write({'active': active})
