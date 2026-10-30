# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import new_test_user

from .common import LiwanMeetingEngineCase


class TestBypass(LiwanMeetingEngineCase):

    def _approved_meeting(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        meeting.with_user(self.organizer).action_confirm()
        meeting.with_user(self.manager).action_done()
        return meeting, resolution

    def test_default_meeting_id_cannot_create_on_done(self):
        meeting, _resolution = self._approved_meeting()
        with self.assertRaises(UserError):
            self.Resolution.with_user(self.organizer).with_context(
                default_meeting_id=meeting.id,
            ).create({
                "name": "sneak",
                "responsible_id": self.attendee.id,
                "deadline": meeting.meeting_date,
            })

    def test_default_meeting_id_cannot_create_on_private(self):
        meeting = self._create_meeting()
        with self.assertRaises(AccessError):
            self.Resolution.with_user(self.outsider).with_context(
                default_meeting_id=meeting.id,
            ).create({
                "name": "sneak",
                "responsible_id": self.attendee.id,
                "deadline": meeting.meeting_date,
            })

    def test_cannot_reassign_resolution_into_done_meeting(self):
        source = self._create_meeting()
        resolution = self._create_resolution(source)
        target, _other = self._approved_meeting()
        with self.assertRaises(UserError):
            resolution.with_user(self.organizer).write({"meeting_id": target.id})
        with self.assertRaises(UserError):
            resolution.with_user(self.manager).write({"meeting_id": target.id})

    def test_cannot_reopen_resolution_via_in_progress(self):
        _meeting, resolution = self._approved_meeting()
        resolution.with_user(self.attendee).action_done()
        with self.assertRaises(UserError):
            resolution.with_user(self.attendee).write({"state": "in_progress"})
        with self.assertRaises(UserError):
            resolution.with_user(self.attendee).write({"result": "<p>late</p>"})
        with self.assertRaises(UserError):
            resolution.with_user(self.manager).write({
                "state": "open",
                "result": "<p>mixed</p>",
            })

    def test_manager_cannot_unlink_or_archive_locked_meeting(self):
        meeting, resolution = self._approved_meeting()
        with self.assertRaises(UserError):
            meeting.with_user(self.manager).unlink()
        with self.assertRaises(UserError):
            resolution.with_user(self.manager).unlink()
        with self.assertRaises(UserError):
            meeting.with_user(self.manager).write({"active": False})
        self.assertTrue(meeting.exists())

    def test_manager_cannot_delete_reopened_meeting_with_minutes_versions(self):
        """The finalized-version count in unlink runs in the deleting manager's environment:
        a Meeting Manager reads the versions, so a reopened meeting that already produced one
        is still refused and kept."""
        meeting, _resolution = self._approved_meeting()
        meeting.with_user(self.manager).write({"state": "draft"})
        Version = self.env["liwan.meeting.minutes.version"]
        self.assertTrue(Version.with_user(self.manager).search_count([("meeting_id", "=", meeting.id)]))
        with self.assertRaisesRegex(AccessError, "finalized minutes versions"):
            meeting.with_user(self.manager).unlink()
        self.assertTrue(meeting.exists())

    def test_cannot_schedule_calendar_on_locked_meeting(self):
        # Without start/end no calendar event is auto-linked on create (and done needs them), so cancel locks it.
        meeting = self._create_meeting(start_datetime=False, end_datetime=False)
        meeting.with_user(self.manager).action_cancel()
        self.assertEqual(meeting.state, "cancelled")
        self.assertFalse(meeting.calendar_event_id)
        with self.assertRaises(UserError):
            meeting.with_user(self.organizer).action_schedule_calendar_event()

    def test_cannot_subscribe_or_notify_outsider(self):
        meeting = self._create_meeting()
        with self.assertRaises(AccessError):
            meeting.with_user(self.organizer).message_subscribe(
                partner_ids=self.outsider.partner_id.ids,
            )
        with self.assertRaises(AccessError):
            meeting.with_user(self.organizer).message_post(
                body="secret",
                partner_ids=self.outsider.partner_id.ids,
                subtype_xmlid="mail.mt_comment",
            )

    def test_attendee_may_comment_not_edit(self):
        meeting = self._create_meeting()
        meeting.with_user(self.attendee).message_post(
            body="note from attendee",
            subtype_xmlid="mail.mt_comment",
        )
        with self.assertRaises(AccessError):
            meeting.with_user(self.attendee).write({"minutes": "<p>nope</p>"})

    def test_copy_resolution_forbidden_on_locked_parent(self):
        _meeting, resolution = self._approved_meeting()
        with self.assertRaises(UserError):
            resolution.with_user(self.organizer).copy()

    def test_attendee_copy_meeting_is_new_draft(self):
        meeting = self._create_meeting()
        copy = meeting.with_user(self.attendee).copy()
        self.assertEqual(copy.state, "draft")
        self.assertEqual(copy.organizer_id, self.attendee)
        self.assertNotEqual(copy.id, meeting.id)

    def test_outsider_cannot_read_meeting_attachment(self):
        meeting = self._create_meeting()
        attachment = self.env["ir.attachment"].with_user(self.organizer).create({
            "name": "secret.txt",
            "res_model": "liwan.meeting.minute",
            "res_id": meeting.id,
            "raw": b"secret-bytes",
        })
        with self.assertRaises(AccessError):
            attachment.with_user(self.outsider).read(["name", "raw"])

    def test_cannot_post_foreign_attachment_or_spoof_author_parent(self):
        meeting = self._create_meeting()
        other = self._create_meeting(name="Other confidential")
        secret = self.env["ir.attachment"].with_user(self.organizer).create({
            "name": "other.txt",
            "res_model": "liwan.meeting.minute",
            "res_id": other.id,
            "raw": b"other-secret",
        })
        parent = other.with_user(self.organizer).message_post(
            body="private parent",
            subtype_xmlid="mail.mt_comment",
        )
        with self.assertRaises(AccessError):
            meeting.with_user(self.attendee).message_post(
                body="steal",
                attachment_ids=[secret.id],
                subtype_xmlid="mail.mt_comment",
            )
        self.assertEqual(secret.res_id, other.id)
        self.assertEqual(secret.res_model, "liwan.meeting.minute")
        posted = meeting.with_user(self.attendee).message_post(
            body="own note",
            author_id=self.organizer.partner_id.id,
            subtype_xmlid="mail.mt_comment",
        )
        self.assertEqual(posted.author_id, self.attendee.partner_id)
        with self.assertRaises(AccessError):
            meeting.with_user(self.attendee).message_post(
                body="cross thread",
                parent_id=parent.id,
                subtype_xmlid="mail.mt_comment",
            )

    def test_own_unbound_composer_attachment_posts(self):
        meeting = self._create_meeting()
        own = self.env["ir.attachment"].with_user(self.attendee).create({
            "name": "mine.txt",
            "res_model": "mail.compose.message",
            "res_id": 0,
            "raw": b"mine",
        })
        meeting.with_user(self.attendee).message_post(
            body="with file",
            attachment_ids=[own.id],
            subtype_xmlid="mail.mt_comment",
        )
        own.invalidate_recordset()
        self.assertEqual(own.res_model, "liwan.meeting.minute")
        self.assertEqual(own.res_id, meeting.id)

    def test_foreign_unbound_and_cross_company_attachment_rejected(self):
        meeting = self._create_meeting()
        foreign = self.env["ir.attachment"].with_user(self.organizer).create({
            "name": "org-pending.txt",
            "res_model": "mail.compose.message",
            "res_id": 0,
            "raw": b"org",
        })
        with self.assertRaises(AccessError):
            meeting.with_user(self.attendee).message_post(
                body="steal pending",
                attachment_ids=[foreign.id],
                subtype_xmlid="mail.mt_comment",
            )
        self.assertEqual(foreign.res_id, 0)
        meeting_b = self.Meeting.with_user(self.other_user).with_company(self.company_other).create({
            "name": "B co",
            "company_id": self.company_other.id,
            "organizer_id": self.other_user.id,
            "meeting_date": fields.Date.today(),
        })
        other_att = self.env["ir.attachment"].with_user(self.other_user).create({
            "name": "b.txt",
            "res_model": "liwan.meeting.minute",
            "res_id": meeting_b.id,
            "raw": b"b-secret",
        })
        with self.assertRaises(AccessError):
            meeting.with_user(self.organizer).message_post(
                body="cross company",
                attachment_ids=[other_att.id],
                subtype_xmlid="mail.mt_comment",
            )
        self.assertEqual(other_att.res_id, meeting_b.id)

    def test_locked_error_uses_arabic_when_lang_active(self):
        self.env["res.lang"]._activate_lang("ar_001")
        meeting, _resolution = self._approved_meeting()
        with self.assertRaises(UserError) as error:
            meeting.with_user(self.manager).with_context(lang="ar_001").write({
                "minutes": "<p>late</p>",
            })
        self.assertIn("غير قابلة", str(error.exception))

    def test_current_company_not_all_allowed_companies(self):
        dual = new_test_user(
            self.env, login="engine_dual", groups="liwan_core.group_employee",
            company_id=self.company.id,
            company_ids=[self.company.id, self.company_other.id],
        )
        permissions = self.env["liwan.access.permission"].search([("key", "in", ["meetings.read", "meetings.manage"])])
        for company in (self.company, self.company_other):
            role = self.env["liwan.access.role"].with_company(company).create({
                "name_ar": "دور اختبار الشركتين", "company_id": company.id,
                "permission_ids": [(6, 0, permissions.ids)],
            })
            self.env["liwan.access.assignment"].with_company(company).create({
                "user_id": dual.id, "role_id": role.id, "company_id": company.id,
            })
        meeting_b = self.Meeting.with_user(self.other_user).with_company(self.company_other).create({
            "name": "Other co meeting",
            "company_id": self.company_other.id,
            "organizer_id": self.other_user.id,
            "meeting_date": fields.Date.today(),
        })
        hidden = self.Meeting.with_user(dual).with_company(self.company).search(
            [("id", "=", meeting_b.id)],
        )
        self.assertFalse(hidden)
        visible = self.Meeting.with_user(dual).with_company(self.company_other).search(
            [("id", "=", meeting_b.id)],
        )
        self.assertEqual(visible, meeting_b)
