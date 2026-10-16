# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.fields import Command

from .common import WebVueMeetingEngineCase


class TestMeetingSecurity(WebVueMeetingEngineCase):

    def test_outsider_cannot_read_or_write(self):
        meeting = self._create_meeting()
        Meeting = self.Meeting.with_user(self.outsider)
        self.assertFalse(Meeting.search([("id", "=", meeting.id)]))
        with self.assertRaises(AccessError):
            Meeting.browse(meeting.id).read(["name", "minutes"])
        with self.assertRaises(AccessError):
            meeting.with_user(self.outsider).write({"location": "leak"})

    def test_attendee_reads_but_cannot_write(self):
        meeting = self._create_meeting()
        found = self.Meeting.with_user(self.attendee).browse(meeting.id)
        self.assertEqual(found.name, "Ops Review")
        self.assertEqual(found.minutes, "<p>Notes</p>")
        with self.assertRaises(AccessError):
            found.write({"minutes": "<p>hack</p>"})
        with self.assertRaises(AccessError):
            found.action_confirm()

    def test_secretary_edits_draft(self):
        meeting = self._create_meeting()
        meeting.with_user(self.secretary).write({"minutes": "<p>Typed</p>"})
        self.assertEqual(meeting.minutes, "<p>Typed</p>")

    def test_manager_reads_non_participant(self):
        meeting = self._create_meeting()
        found = self.Meeting.with_user(self.manager).browse(meeting.id)
        self.assertEqual(found.name, "Ops Review")
        found.write({"location": "Room 1"})
        self.assertEqual(meeting.location, "Room 1")

    def test_settings_admin_has_no_meeting_scope(self):
        meeting = self._create_meeting()
        Meeting = self.Meeting.with_user(self.settings_admin)
        with self.assertRaises(AccessError):
            Meeting.search([("id", "=", meeting.id)])
        with self.assertRaises(AccessError):
            Meeting.create(self._meeting_vals())

    def test_other_company_manager_isolated(self):
        meeting = self._create_meeting()
        Meeting = self.Meeting.with_user(self.other_user)
        self.assertFalse(Meeting.search([("id", "=", meeting.id)]))

    def test_creator_is_organizer_unless_manager(self):
        meeting = self.Meeting.with_user(self.secretary).create(self._meeting_vals())
        self.assertEqual(meeting.organizer_id, self.secretary)
        managed = self.Meeting.with_user(self.manager).create(self._meeting_vals())
        self.assertEqual(managed.organizer_id, self.organizer)

    def test_create_rejects_non_draft_and_internal(self):
        with self.assertRaises(UserError):
            self.Meeting.with_user(self.organizer).create(
                self._meeting_vals(state="done"),
            )
        with self.assertRaises(AccessError):
            self.Meeting.with_user(self.organizer).create(
                self._meeting_vals(reference="MIN/HACK/1"),
            )

    def test_done_immutable_including_manager_mixed_reopen(self):
        meeting = self._create_meeting()
        meeting.with_user(self.organizer).action_confirm()
        meeting.with_user(self.manager).action_done()
        with self.assertRaises(UserError):
            meeting.with_user(self.manager).write({"minutes": "<p>nope</p>"})
        with self.assertRaises(UserError):
            meeting.with_user(self.manager).write({"state": "draft", "minutes": "<p>bypass</p>"})
        meeting.with_user(self.manager).action_reset_draft()
        self.assertEqual(meeting.state, "draft")
        meeting.with_user(self.organizer).write({"minutes": "<p>after reopen</p>"})

    def test_context_defaults_cannot_seed_state(self):
        meeting = self.Meeting.with_user(self.organizer).with_context(default_state="done").create(
            self._meeting_vals(),
        )
        self.assertEqual(meeting.state, "draft")

    def test_removed_attendee_loses_read(self):
        meeting = self._create_meeting()
        meeting.with_user(self.organizer).write({"attendee_ids": [(5, 0, 0)]})
        self.assertFalse(self.Meeting.with_user(self.attendee).search([("id", "=", meeting.id)]))

    def test_cannot_remove_responsible_participant(self):
        meeting = self._create_meeting()
        self._create_resolution(meeting)
        with self.assertRaises(ValidationError):
            meeting.with_user(self.organizer).write({"attendee_ids": [(5, 0, 0)]})

    def test_copy_resets_state_and_calendar_link(self):
        meeting = self._create_meeting()
        meeting.with_user(self.organizer).action_confirm()
        copy = meeting.with_user(self.organizer).copy()
        self.assertEqual(copy.state, "draft")
        # The copy gets an event of its own: it never shares the original's calendar link.
        self.assertNotEqual(copy.calendar_event_id, meeting.calendar_event_id)
        self.assertNotEqual(copy.reference, meeting.reference)

    def test_batch_unlink_requires_manager(self):
        first = self._create_meeting()
        second = self._create_meeting(name="Second")
        with self.assertRaises(AccessError):
            (first | second).with_user(self.organizer).unlink()
        (first | second).with_user(self.manager).unlink()
        self.assertFalse(first.exists())

    def test_command_create_resolution_denied_for_attendee(self):
        meeting = self._create_meeting()
        with self.assertRaises(AccessError):
            meeting.with_user(self.attendee).write({
                "resolution_ids": [Command.create({
                    "name": "sneak",
                    "responsible_id": self.attendee.id,
                    "deadline": meeting.meeting_date,
                })],
            })
