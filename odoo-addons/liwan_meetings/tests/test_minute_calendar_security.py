# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.exceptions import UserError

from .common import LiwanMeetingEngineCase


class TestCalendarSecurity(LiwanMeetingEngineCase):

    def _event_vals(self, user, **extra):
        start = fields.Datetime.now()
        vals = {
            "name": "Calendar Ops",
            "start": start,
            "stop": start + timedelta(hours=1),
            "user_id": user.id,
            "partner_ids": [(6, 0, [user.partner_id.id])],
        }
        vals.update(extra)
        return vals

    def test_event_write_does_not_change_locked_meeting(self):
        meeting = self._create_meeting()
        meeting.with_user(self.organizer).action_schedule_calendar_event()
        event = meeting.calendar_event_id
        original_name = event.name
        meeting.with_user(self.organizer).action_confirm()
        meeting.with_user(self.manager).action_done()
        with self.assertRaises(UserError):
            event.with_user(self.organizer).write({"name": "Hacked event"})
        self.assertEqual(event.name, original_name)
        self.assertEqual(meeting.name, "Ops Review")

    def test_event_owner_cannot_bypass_via_participants(self):
        event = self.env["calendar.event"].with_user(self.event_owner).create(
            self._event_vals(self.event_owner),
        )
        meeting = self._create_meeting()
        meeting.with_user(self.manager)._liwan_link_calendar_event(event)
        meeting.with_user(self.organizer).action_confirm()
        meeting.with_user(self.manager).action_done()
        original = event.name
        with self.assertRaises(UserError):
            event.with_user(self.event_owner).write({
                "name": "owner bypass",
                "user_id": self.event_owner.id,
                "partner_ids": [(6, 0, [self.event_owner.partner_id.id])],
            })
        self.assertEqual(event.name, original)
        self.assertEqual(meeting.organizer_id, self.organizer)

    def test_context_flag_cannot_spoof_calendar_sync(self):
        meeting = self._create_meeting()
        meeting.with_user(self.organizer).action_schedule_calendar_event()
        meeting.with_user(self.organizer).action_confirm()
        meeting.with_user(self.manager).action_done()
        with self.assertRaises(UserError):
            meeting.with_user(self.organizer).with_context(liwan_calendar_sync=True).write({
                "name": "spoofed",
            })

    def test_cannot_delete_event_while_meeting_linked(self):
        meeting = self._create_meeting()
        meeting.with_user(self.organizer).action_schedule_calendar_event()
        event = meeting.calendar_event_id
        with self.assertRaises(UserError):
            event.with_user(self.organizer).unlink()
        self.assertTrue(meeting.exists())

    def test_schedule_does_not_copy_minutes_into_event(self):
        meeting = self._create_meeting(minutes="<p>Confidential minutes</p>")
        meeting.with_user(self.organizer).action_schedule_calendar_event()
        event = meeting.calendar_event_id
        description = event.description or ""
        self.assertNotIn("Confidential minutes", description)
        self.assertEqual(event.privacy, "confidential")
