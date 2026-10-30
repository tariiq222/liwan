# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import new_test_user
from odoo.tools import mute_logger

from .common import LiwanMeetingEngineCase


class TestWorkflow(LiwanMeetingEngineCase):

    def test_approve_then_assignee_completes(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        meeting.with_user(self.secretary).action_confirm()
        self.assertEqual(meeting.state, "confirmed")
        with self.assertRaises(UserError):
            meeting.with_user(self.organizer).action_done()
        meeting.with_user(self.manager).action_done()
        self.assertEqual(meeting.state, "done")
        resolution.with_user(self.attendee).action_start()
        resolution.with_user(self.attendee).write({"result": "<p>Evidence</p>"})
        resolution.with_user(self.attendee).action_done()
        self.assertEqual(resolution.state, "done")
        with self.assertRaises(UserError):
            meeting.with_user(self.organizer).write({"agenda": "<p>late</p>"})

    def test_batch_completion_records_one_version_and_one_event_per_meeting(self):
        start = fields.Datetime.now() + timedelta(days=1)
        meetings = self.Meeting
        for index in range(2):
            meetings |= self._create_meeting(
                name=f"Batch {index}",
                start_datetime=start + timedelta(hours=2 * index),
                end_datetime=start + timedelta(hours=2 * index + 1),
            )
        meetings.with_user(self.organizer).action_confirm()
        meetings.with_user(self.manager).write({"state": "done"})
        self.assertEqual(set(meetings.mapped("state")), {"done"})
        Version, Event = self.env["liwan.meeting.minutes.version"], self.env["liwan.meeting.event"]
        for meeting in meetings:
            self.assertEqual(Version.search([("meeting_id", "=", meeting.id)]).mapped("number"), [1])
            self.assertEqual(Event.search_count([("meeting_id", "=", meeting.id), ("kind", "=", "meeting_completed")]), 1)

    def test_report_denied_to_outsider_and_sanitized(self):
        meeting = self._create_meeting(minutes="<script>alert(1)</script><p>Visible</p>")
        report = self.env.ref("liwan_meetings.action_report_meeting_minutes")
        html, _type = report._render_qweb_html(
            "liwan_meetings.action_report_meeting_minutes", meeting.ids,
        )
        payload = html if isinstance(html, str) else html.decode()
        self.assertNotIn("<script>", payload.lower())
        self.assertIn("Visible", payload)
        with self.assertRaises(AccessError):
            report.with_user(self.outsider)._render_qweb_html(
                "liwan_meetings.action_report_meeting_minutes", meeting.ids,
            )

    def test_chatter_and_attachment_hidden_from_outsider(self):
        meeting = self._create_meeting()
        meeting.with_user(self.organizer).message_post(body="Secret discussion")
        attachment = self.env["ir.attachment"].with_user(self.organizer).create({
            "name": "notes.txt",
            "res_model": "liwan.meeting.minute",
            "res_id": meeting.id,
            "raw": b"secret-bytes",
        })
        messages = self.env["mail.message"].with_user(self.outsider).search([
            ("model", "=", "liwan.meeting.minute"),
            ("res_id", "=", meeting.id),
        ])
        self.assertFalse(messages)
        with self.assertRaises(AccessError):
            attachment.with_user(self.outsider).read(["name", "raw"])

    def test_removed_participant_unsubscribed(self):
        meeting = self._create_meeting()
        partner = self.attendee.partner_id
        meeting.message_subscribe(partner_ids=partner.ids)
        meeting.with_user(self.organizer).write({"attendee_ids": [(5, 0, 0)]})
        self.assertNotIn(partner, meeting.message_partner_ids)

    def test_invalid_state_jump_rejected(self):
        meeting = self._create_meeting()
        with self.assertRaises(UserError):
            meeting.with_user(self.manager).write({"state": "done"})

    @mute_logger("odoo.addons.mail.models.mail_mail")
    def test_portal_user_rejected_as_attendee(self):
        portal = new_test_user(self.env, login="engine_portal", groups="base.group_portal")
        meeting = self._create_meeting()
        with self.assertRaises(ValidationError):
            meeting.with_user(self.organizer).write({"attendee_ids": [(4, portal.id)]})
