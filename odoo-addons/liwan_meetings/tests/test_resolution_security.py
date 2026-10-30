# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, UserError, ValidationError

from .common import LiwanMeetingEngineCase


class TestResolutionSecurity(LiwanMeetingEngineCase):

    def test_responsible_must_be_participant(self):
        meeting = self._create_meeting()
        with self.assertRaises(ValidationError):
            self._create_resolution(meeting, responsible_id=self.outsider.id)

    def test_assignee_cannot_change_decision_fields(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        with self.assertRaises(AccessError):
            resolution.with_user(self.attendee).write({"deadline": meeting.meeting_date})
        with self.assertRaises(AccessError):
            resolution.with_user(self.attendee).write({"name": "renamed"})
        with self.assertRaises(AccessError):
            resolution.with_user(self.attendee).write({"responsible_id": self.organizer.id})

    def test_assignee_updates_progress_on_approved_meeting(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        meeting.with_user(self.organizer).action_confirm()
        meeting.with_user(self.manager).action_done()
        resolution.with_user(self.attendee).action_start()
        self.assertEqual(resolution.state, "in_progress")
        resolution.with_user(self.attendee).write({
            "state": "done",
            "result": "<p>Done</p>",
        })
        self.assertEqual(resolution.state, "done")

    def test_assignee_cannot_cancel_or_reopen(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        with self.assertRaises(UserError):
            resolution.with_user(self.attendee).action_cancel()
        resolution.with_user(self.organizer).action_done()
        with self.assertRaises(UserError):
            resolution.with_user(self.attendee).action_reopen()
        resolution.with_user(self.manager).action_reopen()
        self.assertEqual(resolution.state, "open")

    def test_cancelled_meeting_blocks_execution(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        meeting.with_user(self.manager).action_cancel()
        with self.assertRaises(UserError):
            resolution.with_user(self.attendee).action_start()

    def test_internal_fields_rejected(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        with self.assertRaises(AccessError):
            resolution.with_user(self.organizer).write({"company_id": self.company_other.id})
        with self.assertRaises(AccessError):
            resolution.with_user(self.organizer).write({"can_edit_decision": True})
        with self.assertRaises(AccessError):
            self.Resolution.with_user(self.organizer).with_context(default_company_id=self.company_other.id).create({
                "meeting_id": meeting.id,
                "name": "x",
                "responsible_id": self.attendee.id,
                "deadline": meeting.meeting_date,
                "company_id": self.company_other.id,
            })

    def test_outsider_cannot_read_resolution(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        Resolution = self.Resolution.with_user(self.outsider)
        self.assertFalse(Resolution.search([("id", "=", resolution.id)]))

    def test_html_result_is_sanitized(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        resolution.with_user(self.attendee).write({
            "result": "<script>alert(1)</script><p>ok</p>",
        })
        self.assertNotIn("script", (resolution.result or "").lower())
        self.assertIn("ok", resolution.result)
