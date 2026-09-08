# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextvars import ContextVar
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools.mail import plaintext2html

_CALENDAR_IMPORT = ContextVar('nasq_calendar_import', default=False)
_CALENDAR_OUTBOUND = ContextVar('nasq_calendar_outbound', default=frozenset())


class CyanMeetingMinute(models.Model):
    _inherit = 'cyan.meeting.minute'

    meeting_url = fields.Char()
    series_id = fields.Many2one(
        'nasq.meeting.series', index=True, ondelete='restrict', check_company=True,
    )
    project_id = fields.Many2one('project.project', check_company=True, index=True)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            series = self.env['nasq.meeting.series'].browse(vals['series_id']) if vals.get('series_id') else self.env['nasq.meeting.series']
            if series:
                series.check_access('read')
                if series.project_id:
                    vals.setdefault('project_id', series.project_id.id)
                vals.setdefault('organizer_id', series.organizer_id.id)
                if series.secretary_id:
                    vals.setdefault('secretary_id', series.secretary_id.id)
                if series.location:
                    vals.setdefault('location', series.location)
                if series.meeting_url:
                    vals.setdefault('meeting_url', series.meeting_url)
                if 'attendee_ids' not in vals:
                    attendees = series.attendee_ids
                    if series.secretary_id:
                        attendees -= series.secretary_id
                    vals['attendee_ids'] = [(6, 0, attendees.ids)]
        records = super().create(vals_list)
        for meeting in records:
            if not _CALENDAR_IMPORT.get():
                meeting._nasq_sync_calendar()
            partners = meeting._cyan_participant_users().mapped('partner_id') - meeting.env.user.partner_id
            meeting._nasq_notify_partners(partners, 'meeting_invite', meeting.name, key=f'meeting-invite:{meeting.id}')
        return records

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
        if {'start_datetime', 'end_datetime', 'location'} & set(vals):
            for meeting in self:
                partners = meeting._cyan_participant_users().mapped('partner_id') - meeting.env.user.partner_id
                meeting._nasq_notify_partners(partners, 'meeting_changed', meeting.name)
        if vals.get('state') == 'cancelled':
            for meeting in self:
                partners = meeting._cyan_participant_users().mapped('partner_id') - meeting.env.user.partner_id
                meeting._nasq_notify_partners(
                    partners, 'meeting_cancelled', meeting.name,
                    key=f'meeting-cancel:{meeting.id}',
                )
        return result

    @api.model
    def _nasq_run_meeting_reminders(self):
        now = fields.Datetime.now()
        soon = now + timedelta(hours=24)
        for meeting in self.search([
            ('state', 'in', ('draft', 'confirmed')),
            ('start_datetime', '>=', now),
            ('start_datetime', '<=', soon),
        ]):
            meeting._nasq_notify_partners(
                meeting._cyan_participant_users().mapped('partner_id'),
                'meeting_reminder', meeting.name,
                key=f'meeting-reminder:{meeting.id}',
            )
        today = fields.Date.context_today(self)
        for resolution in self.env['cyan.meeting.resolution'].search([
            ('state', 'not in', ('done', 'cancelled')),
            ('deadline', '<', today),
        ]):
            if resolution.responsible_id:
                resolution.meeting_id._nasq_notify_partners(
                    resolution.responsible_id.partner_id,
                    'meeting_resolution_overdue',
                    resolution.name,
                    key=f'meeting-res-overdue:{resolution.id}',
                )

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

    @api.constrains('start_datetime', 'end_datetime', 'organizer_id', 'state')
    def _nasq_check_organizer_overlap(self):
        for meeting in self:
            if meeting.state == 'cancelled' or not meeting.start_datetime or not meeting.end_datetime:
                continue
            clash = self.search_count([
                ('id', '!=', meeting.id),
                ('company_id', '=', meeting.company_id.id),
                ('organizer_id', '=', meeting.organizer_id.id),
                ('state', '!=', 'cancelled'),
                ('start_datetime', '<', meeting.end_datetime),
                ('end_datetime', '>', meeting.start_datetime),
            ], limit=1)
            if clash:
                raise ValidationError(self.env._("This time overlaps another meeting for the organizer."))

    def _nasq_scope_meetings(self, scope):
        self.ensure_one()
        if scope != 'this_and_following' or not self.series_id:
            return self
        return self.series_id.meeting_ids.filtered(
            lambda meeting: meeting.meeting_date and self.meeting_date and meeting.meeting_date >= self.meeting_date,
        )

    def action_apply_schedule_scope(self, vals, scope='this'):
        self.ensure_one()
        allowed = {'name', 'location', 'start_datetime', 'end_datetime', 'meeting_url', 'meeting_date'}
        payload = {key: vals[key] for key in allowed if key in vals}
        targets = self._nasq_scope_meetings(scope)
        locked = targets.filtered(lambda meeting: meeting.state in meeting._LOCKED_STATES)
        if scope == 'this' and locked:
            raise UserError(self.env._("Reopen the meeting before changing its schedule."))
        editable = targets - locked
        if scope == 'this_and_following' and self.start_datetime and payload.get('start_datetime'):
            new_start = fields.Datetime.to_datetime(payload['start_datetime'])
            delta = new_start - self.start_datetime
            new_end = fields.Datetime.to_datetime(payload['end_datetime']) if payload.get('end_datetime') else None
            duration = (new_end - new_start) if new_end else None
            for meeting in editable:
                updates = dict(payload)
                if meeting.start_datetime:
                    updates['start_datetime'] = meeting.start_datetime + delta
                    if duration is not None:
                        updates['end_datetime'] = updates['start_datetime'] + duration
                    elif meeting.end_datetime:
                        updates['end_datetime'] = meeting.end_datetime + delta
                    updates['meeting_date'] = fields.Date.to_date(updates['start_datetime'])
                meeting.write(updates)
            return editable
        editable.write(payload)
        return editable

    def action_cancel_scope(self, scope='this'):
        self.ensure_one()
        targets = self._nasq_scope_meetings(scope).filtered(lambda meeting: meeting.state not in ('done', 'cancelled'))
        targets.action_cancel()
        return targets


class CalendarEvent(models.Model):
    _inherit = 'calendar.event'

    def action_open_meeting_minutes(self):
        # The server-local marker is inaccessible to forged RPC context flags.
        token = _CALENDAR_IMPORT.set(True)
        try:
            return super().action_open_meeting_minutes()
        finally:
            _CALENDAR_IMPORT.reset(token)
