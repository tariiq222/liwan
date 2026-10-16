# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Original author: Cyan (cyan_meeting_minutes 19.0.1.3.0, LGPL-3), absorbed into webvue_meetings.
# See PROVENANCE.md.
from psycopg2 import IntegrityError

from odoo import _, fields, models
from odoo.exceptions import AccessError, UserError

from .meeting_minute import _CALENDAR_IMPORT


class CalendarEvent(models.Model):
    _inherit = "calendar.event"

    def _webvue_can_create_minutes(self):
        self.ensure_one()
        if self.env.su:
            return True
        service = self.env['webvue.access.service']
        return service._webvue_has_capability(self.env.user, 'meetings.create') and (
            self.user_id == self.env.user or service._webvue_has_capability(self.env.user, 'meetings.manage'))

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

    def action_open_meeting_minutes(self):
        # The server-local marker is inaccessible to forged RPC context flags.
        token = _CALENDAR_IMPORT.set(True)
        try:
            return self._webvue_open_meeting_minutes()
        finally:
            _CALENDAR_IMPORT.reset(token)

    def _webvue_open_meeting_minutes(self):
        self.ensure_one()
        self.check_access("read")
        meeting = self.env["webvue.meeting.minute"].search([("calendar_event_id", "=", self.id)], limit=1)
        if meeting:
            meeting.check_access("read")
            return self._webvue_open_meeting_action(meeting)
        if not self._webvue_can_create_minutes():
            raise AccessError(_("You cannot create meeting minutes for this calendar event."))
        values = self._webvue_meeting_schedule_values()
        try:
            with self.env.cr.savepoint():
                meeting = self.env["webvue.meeting.minute"].create(values)
                meeting._webvue_link_calendar_event(self)
        except IntegrityError as err:
            raise AccessError(_("You cannot create meeting minutes for this calendar event.")) from err
        meeting.message_post(
            body=_("Linked to Calendar event: %s", self.name),
            subtype_xmlid="mail.mt_note",
        )
        return self._webvue_open_meeting_action(meeting)

    def _webvue_open_meeting_action(self, meeting):
        return {
            "type": "ir.actions.act_window",
            "name": _("Meeting Minutes"),
            "res_model": "webvue.meeting.minute",
            "res_id": meeting.id,
            "view_mode": "form",
            "target": "current",
        }

    def _webvue_linked_minutes(self):
        # sudo READ: whether a meeting links these events, whoever may read it; the caller re-checks access.
        return self.env["webvue.meeting.minute"].sudo().search([("calendar_event_id", "in", self.ids)])

    def write(self, vals):
        result = super().write(vals)
        schedule_fields = {"name", "start", "stop", "allday", "location", "user_id", "partner_ids"}
        if schedule_fields.intersection(vals):
            for meeting in self._webvue_linked_minutes():
                meeting.with_env(self.env)._webvue_write_calendar_schedule(
                    meeting.calendar_event_id._webvue_meeting_schedule_values(
                        company=meeting.company_id,
                        fallback_organizer=meeting.organizer_id,
                    ),
                )
        return result

    def unlink(self):
        if self._webvue_linked_minutes():
            raise UserError(_("Unlink the meeting minutes before deleting this calendar event."))
        return super().unlink()
