# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Original author: Cyan (cyan_meeting_minutes 19.0.1.3.0, LGPL-3), absorbed into webvue_meetings.
# See PROVENANCE.md.
# SPDX-License-Identifier: LGPL-3

from odoo import _, fields, models
from odoo.exceptions import UserError


class CalendarEvent(models.Model):
    _inherit = "calendar.event"

    def _webvue_internal_attendees(self, company, organizer):
        self.ensure_one()
        users = self.partner_ids.mapped("user_ids").filtered(
            lambda user: user.active and not user.share and company in user.company_ids,
        )
        return users - organizer

    def _webvue_meeting_schedule_values(self, company=None, fallback_organizer=None):
        self.ensure_one()
        company = company or (
            self.user_id.company_id
            if self.user_id and self.user_id.company_id in self.env.companies
            else self.env.company
        )
        organizer = self.user_id
        if not organizer or company not in organizer.company_ids:
            organizer = fallback_organizer or self.env.user
        if company not in organizer.company_ids:
            raise UserError(_("The Calendar organizer must have access to the Meeting Minutes company."))
        start_in_organizer_tz = fields.Datetime.context_timestamp(
            self.with_context(tz=organizer.tz), self.start,
        )
        return {
            "name": self.name,
            "company_id": company.id,
            "meeting_date": self.start_date if self.allday else start_in_organizer_tz.date(),
            "start_datetime": self.start,
            "end_datetime": self.stop,
            "location": self.location,
            "organizer_id": organizer.id,
            "attendee_ids": [(6, 0, self._webvue_internal_attendees(company, organizer).ids)],
        }

    def _webvue_linked_minutes(self):
        # sudo READ: whether a meeting links these events, whoever may read it; the caller re-checks access.
        return self.env["webvue.meeting.minute"].sudo().search([("calendar_event_id", "in", self.ids)])

    def write(self, vals):
        result = super().write(vals)
        schedule_fields = {"name", "start", "stop", "allday", "location", "user_id", "partner_ids"}
        if schedule_fields.intersection(vals):
            linked = {meeting.calendar_event_id.id: meeting for meeting in self._webvue_linked_minutes()}
            for event in self.filtered(lambda event: event.id in linked):
                meeting = linked[event.id]
                # The schedule comes from the caller's event; only the meeting lookup was elevated.
                meeting.with_env(self.env)._webvue_write_calendar_schedule(
                    event._webvue_meeting_schedule_values(
                        company=meeting.company_id,
                        fallback_organizer=meeting.organizer_id,
                    ),
                )
        return result

    def unlink(self):
        if self._webvue_linked_minutes():
            raise UserError(_("Unlink the meeting minutes before deleting this calendar event."))
        return super().unlink()
