# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextvars import ContextVar
from datetime import date, datetime, timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

_CALENDAR_IMPORT = ContextVar('webvue_calendar_import', default=False)
_CALENDAR_OUTBOUND = ContextVar('webvue_calendar_outbound', default=frozenset())
_SCOPE_SCHEDULE_WRITE = ContextVar('webvue_scope_schedule_write', default=False)
# Set by a series while it creates its occurrences: the series sends one invite per participant.
_SERIES_GENERATION = ContextVar('webvue_series_generation', default=False)


class CyanMeetingMinute(models.Model):
    _inherit = 'cyan.meeting.minute'

    meeting_url = fields.Char()
    series_id = fields.Many2one(
        'webvue.meeting.series', index=True, ondelete='restrict', check_company=True,
    )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            series = self.env['webvue.meeting.series'].browse(vals.get('series_id')) if vals.get('series_id') else self.env['webvue.meeting.series']
            if series:
                self._webvue_check_series_link(series)
                series.check_access('read')
                for field, value in series._webvue_extra_meeting_defaults().items():
                    if value:
                        vals.setdefault(field, value)
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
                meeting._webvue_sync_calendar()
            if _SERIES_GENERATION.get():
                continue
            partners = meeting._cyan_participant_users().mapped('partner_id') - meeting.env.user.partner_id
            meeting._webvue_notify_partners(partners, 'meeting_invite', meeting.name, key=f'meeting-invite:{meeting.id}')
        return records

    def _webvue_check_series_link(self, series):
        """Require an editor for every user-controlled series association."""
        series.ensure_one()
        if series.company_id != self.env.company:
            raise AccessError(self.env._("The meeting series is outside the current company."))
        if not self.env.su and not series._webvue_is_editor():
            raise AccessError(self.env._(
                "Only the organizer, secretary or a meetings manager may link a meeting to this series.",
            ))

    def _webvue_notify_partners(self, partners, kind, body, key=None):
        self.ensure_one()
        service = self.env['webvue.notify.service']
        for partner in partners:
            # The per-recipient suffix keeps the pre-split key format, so a
            # producer that runs again after an upgrade delivers nothing new.
            service._webvue_deliver(
                self._name, self.id, kind, partner, body,
                key=f'{key}:{partner.id}' if key else None,
                values={'webvue_meeting_id': self.id},
            )

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
        if vals.get('series_id'):
            series = self.env['webvue.meeting.series'].browse(vals['series_id']).exists()
            if not series:
                raise ValidationError(self.env._("The meeting series does not exist."))
            self._webvue_check_series_link(series)
            series.check_access('read')
        previous = {meeting.id: meeting._cyan_participant_users() for meeting in self}
        previous_state = {meeting.id: meeting.state for meeting in self}
        result = super().write(vals)
        if {'start_datetime', 'end_datetime', 'meeting_url', 'location', 'name', 'attendee_ids', 'secretary_id', 'organizer_id'} & set(vals):
            for meeting in self:
                meeting._webvue_sync_calendar()
        if {'attendee_ids', 'secretary_id'} & set(vals):
            for meeting in self:
                added = meeting._cyan_participant_users() - previous[meeting.id]
                meeting._webvue_notify_partners(
                    added.mapped('partner_id'), 'meeting_invite', meeting.name,
                    key=f'meeting-invite:{meeting.id}',
                )
        if {'start_datetime', 'end_datetime', 'location'} & set(vals):
            for meeting in self:
                partners = meeting._cyan_participant_users().mapped('partner_id') - meeting.env.user.partner_id
                meeting._webvue_notify_partners(partners, 'meeting_changed', meeting.name)
        if vals.get('state') == 'cancelled':
            for meeting in self:
                if previous_state[meeting.id] == 'cancelled':
                    continue
                meeting._webvue_set_calendar_event_active(False)
                partners = meeting._cyan_participant_users().mapped('partner_id') - meeting.env.user.partner_id
                meeting._webvue_notify_partners(
                    partners, 'meeting_cancelled', meeting.name,
                )
        if vals.get('state') == 'draft':
            for meeting in self:
                if previous_state[meeting.id] == 'cancelled':
                    meeting._webvue_set_calendar_event_active(True)
        return result

    def _webvue_set_calendar_event_active(self, active):
        """A cancelled meeting leaves its attendees' calendars; a reopened one returns to them."""
        self.ensure_one()
        event = self.calendar_event_id
        if event and event.active != active:
            event.write({'active': active})

    @api.model
    def _webvue_run_meeting_reminders(self):
        now = fields.Datetime.now()
        soon = now + timedelta(hours=24)
        for meeting in self.search([
            ('state', 'in', ('draft', 'confirmed')),
            ('start_datetime', '>=', now),
            ('start_datetime', '<=', soon),
        ]):
            meeting._webvue_notify_partners(
                meeting._cyan_participant_users().mapped('partner_id'),
                'meeting_reminder', meeting.name,
                key=f'meeting-reminder:{meeting.id}:{fields.Datetime.to_string(meeting.start_datetime)}',
            )
        today = fields.Date.context_today(self)
        Resolution = self.env['cyan.meeting.resolution']
        resolutions = Resolution.search([
            ('state', 'not in', ('done', 'cancelled')),
            ('meeting_id.state', '!=', 'cancelled'),
            ('deadline', '<', today),
        ])
        # A recommendation followed on a linked record (a converted task) gets no overdue reminder.
        linked_ids = self.env['webvue.meeting.links']._webvue_linked_resolution_ids(resolutions)
        for resolution in resolutions.filtered(lambda item: item.id not in linked_ids):
            if resolution.responsible_id:
                resolution.meeting_id._webvue_notify_partners(
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
    def _webvue_check_organizer_overlap(self):
        for meeting in self:
            if _SCOPE_SCHEDULE_WRITE.get():
                continue
            if meeting.state == 'cancelled' or not meeting.start_datetime or not meeting.end_datetime:
                continue
            # Scheduling is a company-wide invariant, including meetings the
            # current editor cannot otherwise read.
            clash = self.sudo().search_count([
                ('id', '!=', meeting.id),
                ('company_id', '=', meeting.company_id.id),
                ('organizer_id', '=', meeting.organizer_id.id),
                ('state', '!=', 'cancelled'),
                ('start_datetime', '<', meeting.end_datetime),
                ('end_datetime', '>', meeting.start_datetime),
            ], limit=1)
            if clash:
                raise ValidationError(self.env._("This time overlaps another meeting for the organizer."))

    def _webvue_scope_meetings(self, scope):
        self.ensure_one()
        if scope != 'this_and_following' or not self.series_id:
            return self

        def occurrence_key(meeting):
            meeting_date = fields.Date.to_date(meeting.meeting_date) if meeting.meeting_date else date.min
            start = fields.Datetime.to_datetime(meeting.start_datetime) if meeting.start_datetime else datetime.min
            return meeting_date, start, meeting.id

        current_key = occurrence_key(self)
        return self.series_id.meeting_ids.filtered(
            lambda meeting: occurrence_key(meeting) >= current_key,
        ).sorted(key=occurrence_key)

    def action_apply_schedule_scope(self, vals, scope='this'):
        self.ensure_one()
        link_fields = self.env['webvue.meeting.links']._webvue_link_fields()
        allowed = {
            'name', 'location', 'start_datetime', 'end_datetime', 'meeting_url', 'meeting_date',
            'agenda', 'minutes', 'attendee_ids', 'secretary_id',
        } | link_fields
        payload = {key: vals[key] for key in allowed if key in vals}
        targets = self._webvue_scope_meetings(scope)
        locked = targets.filtered(lambda meeting: meeting.state in meeting._LOCKED_STATES)
        if scope == 'this' and locked:
            raise UserError(self.env._("Reopen the meeting before changing its schedule."))
        editable = targets - locked
        if scope != 'this_and_following':
            editable.write(payload)
            return editable

        schedule_fields = {'name', 'location', 'start_datetime', 'end_datetime', 'meeting_url', 'meeting_date'}
        content_fields = {'agenda', 'minutes', 'attendee_ids', 'secretary_id'} | link_fields
        schedule_payload = {key: payload[key] for key in schedule_fields if key in payload}
        content_payload = {key: payload[key] for key in content_fields if key in payload}
        if scope == 'this_and_following' and self in locked and content_payload:
            raise UserError(self.env._("Reopen the meeting before changing its content."))
        needs_schedule_rewrite = bool({'start_datetime', 'end_datetime', 'meeting_date'} & payload.keys())
        start_provided = 'start_datetime' in schedule_payload
        end_provided = 'end_datetime' in schedule_payload
        date_provided = 'meeting_date' in schedule_payload
        start_cleared = start_provided and schedule_payload['start_datetime'] is False
        end_cleared = end_provided and schedule_payload['end_datetime'] is False
        new_start = (
            fields.Datetime.to_datetime(schedule_payload['start_datetime'])
            if start_provided and not start_cleared else None
        )
        new_end = (
            fields.Datetime.to_datetime(schedule_payload['end_datetime'])
            if end_provided and not end_cleared else None
        )
        old_start = fields.Datetime.to_datetime(self.start_datetime) if self.start_datetime else None
        old_end = fields.Datetime.to_datetime(self.end_datetime) if self.end_datetime else None
        delta = new_start - old_start if new_start is not None and old_start is not None else None
        duration = new_end - new_start if new_start is not None and new_end is not None else None
        end_delta = (
            new_end - old_end
            if new_end is not None and old_end is not None and (not start_provided or start_cleared)
            else None
        )
        old_date = fields.Date.to_date(self.meeting_date) if self.meeting_date else None
        new_date = fields.Date.to_date(schedule_payload['meeting_date']) if date_provided and schedule_payload['meeting_date'] else None
        # When the API supplies a calendar day alongside a shifted start,
        # propagate that explicit day delta. Deriving from the stored UTC
        # datetime would move near-midnight occurrences to the wrong day.
        date_delta = new_date - old_date if new_date and old_date else None
        source_date = new_date or old_date

        updates_by_id = {}
        for meeting in editable:
            updates = {
                key: value for key, value in schedule_payload.items()
                if key not in {'start_datetime', 'end_datetime', 'meeting_date'}
            }
            meeting_start = fields.Datetime.to_datetime(meeting.start_datetime) if meeting.start_datetime else None
            meeting_end = fields.Datetime.to_datetime(meeting.end_datetime) if meeting.end_datetime else None
            target_date = fields.Date.to_date(meeting.meeting_date) if meeting.meeting_date else None
            if target_date and date_delta is not None:
                target_date += date_delta
            anchored_start = (
                new_start + timedelta(days=(target_date - source_date).days)
                if new_start is not None and source_date and target_date else None
            )
            anchored_end = (
                new_end + timedelta(days=(target_date - source_date).days)
                if new_end is not None and source_date and target_date else None
            )

            # Each supplied schedule field has independent semantics. A
            # clear must remain a clear even when another field shifts the
            # occurrence; omitting a field preserves its existing value.
            if start_provided:
                if start_cleared:
                    updates['start_datetime'] = False
                elif delta is not None and meeting_start:
                    updates['start_datetime'] = meeting_start + delta
                elif delta is None and date_delta is not None and meeting_start:
                    # A date-only source has no prior instant from which to
                    # derive a time delta. Preserve the timed occurrence's
                    # local clock when an explicit day shift moves it.
                    updates['start_datetime'] = meeting_start + date_delta
                elif meeting == self:
                    updates['start_datetime'] = new_start
                elif meeting_start is None and anchored_start is not None:
                    # Date-only occurrences do not have an absolute instant
                    # to shift. Preserve the source's date-to-instant
                    # relationship on each occurrence's own calendar day.
                    updates['start_datetime'] = anchored_start
            elif delta is None and date_delta is not None and meeting_start:
                updates['start_datetime'] = meeting_start + date_delta

            if end_provided:
                if end_cleared:
                    updates['end_datetime'] = False
                elif duration is not None and (delta is not None or meeting == self) and (meeting_start or meeting == self):
                    base_start = updates.get('start_datetime', meeting_start)
                    if base_start:
                        updates['end_datetime'] = base_start + duration
                elif end_delta is not None and meeting_end:
                    updates['end_datetime'] = meeting_end + end_delta
                elif delta is None and date_delta is not None and meeting_end:
                    updates['end_datetime'] = meeting_end + date_delta
                elif meeting == self:
                    updates['end_datetime'] = new_end
                elif meeting_end is None and anchored_end is not None:
                    updates['end_datetime'] = anchored_end
            elif delta is None and date_delta is not None and meeting_end:
                updates['end_datetime'] = meeting_end + date_delta

            if not end_provided and delta is not None and meeting_end:
                updates['end_datetime'] = meeting_end + delta

            if date_provided:
                if new_date is None:
                    updates['meeting_date'] = False
                elif date_delta is not None and meeting.meeting_date:
                    updates['meeting_date'] = fields.Date.to_date(meeting.meeting_date) + date_delta
                elif meeting == self or not meeting.meeting_date:
                    updates['meeting_date'] = new_date
            elif delta is not None and meeting_start:
                # A start shift without an explicit calendar day keeps the
                # existing per-occurrence day; the API already validated the
                # current occurrence's day in this case.
                updates['meeting_date'] = meeting.meeting_date

            updates_by_id[meeting.id] = updates

        with self.env.cr.savepoint():
            token = _SCOPE_SCHEDULE_WRITE.set(needs_schedule_rewrite)
            try:
                for meeting in editable:
                    updates = updates_by_id[meeting.id]
                    if meeting == self:
                        updates = {**updates, **content_payload}
                    meeting.write(updates)
            finally:
                _SCOPE_SCHEDULE_WRITE.reset(token)
            if needs_schedule_rewrite:
                editable._webvue_check_organizer_overlap()
        return editable

    def action_cancel_scope(self, scope='this'):
        self.ensure_one()
        if self.state == 'done':
            raise UserError(self.env._("Reopen the completed meeting before cancelling it."))
        targets = self._webvue_scope_meetings(scope).filtered(lambda meeting: meeting.state not in ('done', 'cancelled'))
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
