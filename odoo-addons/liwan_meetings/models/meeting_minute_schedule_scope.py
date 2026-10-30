# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Schedule scope of a meeting: apply a change or a cancellation to one occurrence or to the following ones."""
from datetime import timedelta

from odoo import fields, models
from odoo.exceptions import UserError

from .meeting_context import _SCOPE_SCHEDULE_WRITE, _occurrence_key


class LiwanMeetingMinuteScheduleScope(models.Model):
    _inherit = 'liwan.meeting.minute'

    def _liwan_scope_meetings(self, scope):
        self.ensure_one()
        if scope != 'this_and_following' or not self.series_id:
            return self

        current_key = _occurrence_key(self)
        return self.series_id.meeting_ids.filtered(
            lambda meeting: _occurrence_key(meeting) >= current_key,
        ).sorted(key=_occurrence_key)

    def action_apply_schedule_scope(self, vals, scope='this'):
        self.ensure_one()
        link_fields = self.env['liwan.meeting.links']._liwan_link_fields()
        allowed = {
            'name', 'location', 'start_datetime', 'end_datetime', 'meeting_url', 'meeting_date',
            'agenda', 'minutes', 'attendee_ids', 'secretary_id',
        } | link_fields
        payload = {key: vals[key] for key in allowed if key in vals}
        targets = self._liwan_scope_meetings(scope)
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
                editable._liwan_check_organizer_overlap()
        return editable

    def action_cancel_scope(self, scope='this'):
        self.ensure_one()
        if self.state == 'done':
            raise UserError(self.env._("Reopen the completed meeting before cancelling it."))
        targets = self._liwan_scope_meetings(scope).filtered(lambda meeting: meeting.state not in ('done', 'cancelled'))
        targets.action_cancel()
        return targets
