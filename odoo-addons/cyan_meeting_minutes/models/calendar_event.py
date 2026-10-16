# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Original author: Cyan (vendor 19.0.1.3.0). WebVue hardening 19.0.1.3.1.
# SPDX-License-Identifier: LGPL-3
from collections import defaultdict

from psycopg2 import IntegrityError

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError


class CalendarEvent(models.Model):
    _inherit = "calendar.event"

    meeting_minute_count = fields.Integer(compute="_compute_meeting_minute_count")
    cyan_can_create_minutes = fields.Boolean(compute="_compute_meeting_minute_count")

    @api.depends_context("uid", "allowed_company_ids")
    def _compute_meeting_minute_count(self):
        Meeting = self.env["cyan.meeting.minute"]
        if not Meeting.has_access("read"):
            for event in self:
                event.meeting_minute_count = 0
                event.cyan_can_create_minutes = False
            return
        meetings = Meeting.search([("calendar_event_id", "in", self.ids)])
        counts = defaultdict(int)
        for meeting in meetings:
            counts[meeting.calendar_event_id.id] += 1
        for event in self:
            count = counts[event.id]
            event.meeting_minute_count = count
            event.cyan_can_create_minutes = not count and event._cyan_can_create_minutes()

    def _cyan_can_create_minutes(self):
        self.ensure_one()
        if not self.env.user.has_group("cyan_meeting_minutes.group_meeting_user"):
            return False
        return bool(
            self.env.su
            or self.env.user.has_group("cyan_meeting_minutes.group_meeting_manager")
            or self.user_id == self.env.user,
        )

    def _cyan_internal_attendees(self, company, organizer):
        self.ensure_one()
        users = self.partner_ids.mapped("user_ids").filtered(
            lambda user: user.active and not user.share and company in user.company_ids,
        )
        return users - organizer

    def _cyan_meeting_schedule_values(self, company=None, fallback_organizer=None):
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
            "attendee_ids": [(6, 0, self._cyan_internal_attendees(company, organizer).ids)],
        }

    def action_open_meeting_minutes(self):
        self.ensure_one()
        self.check_access("read")
        meeting = self.env["cyan.meeting.minute"].search([("calendar_event_id", "=", self.id)], limit=1)
        if meeting:
            meeting.check_access("read")
            return self._cyan_open_meeting_action(meeting)
        if not self._cyan_can_create_minutes():
            raise AccessError(_("You cannot create meeting minutes for this calendar event."))
        values = self._cyan_meeting_schedule_values()
        try:
            with self.env.cr.savepoint():
                meeting = self.env["cyan.meeting.minute"].create(values)
                meeting._cyan_link_calendar_event(self)
        except IntegrityError as err:
            raise AccessError(_("You cannot create meeting minutes for this calendar event.")) from err
        meeting.message_post(
            body=_("Linked to Calendar event: %s", self.name),
            subtype_xmlid="mail.mt_note",
        )
        return self._cyan_open_meeting_action(meeting)

    def _cyan_open_meeting_action(self, meeting):
        return {
            "type": "ir.actions.act_window",
            "name": _("Meeting Minutes"),
            "res_model": "cyan.meeting.minute",
            "res_id": meeting.id,
            "view_mode": "form",
            "target": "current",
        }

    def write(self, vals):
        result = super().write(vals)
        schedule_fields = {"name", "start", "stop", "allday", "location", "user_id", "partner_ids"}
        if schedule_fields.intersection(vals):
            Meeting = self.env["cyan.meeting.minute"]
            for event in self:
                meeting = Meeting.sudo().search([("calendar_event_id", "=", event.id)], limit=1)
                if meeting:
                    meeting.with_env(self.env)._cyan_write_calendar_schedule(
                        event._cyan_meeting_schedule_values(
                            company=meeting.company_id,
                            fallback_organizer=meeting.organizer_id,
                        ),
                    )
        return result

    def unlink(self):
        linked = self.env["cyan.meeting.minute"].sudo().search([("calendar_event_id", "in", self.ids)])
        if linked:
            raise UserError(_("Unlink the meeting minutes before deleting this calendar event."))
        return super().unlink()
