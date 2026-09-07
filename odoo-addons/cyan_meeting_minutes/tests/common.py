# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged("cyan_meeting_minutes")
class CyanMeetingCase(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.company_other = cls.env["res.company"].create({"name": "Cyan Other Co"})
        user_group = "cyan_meeting_minutes.group_meeting_user"
        manager_group = "cyan_meeting_minutes.group_meeting_manager"
        cls.organizer = new_test_user(
            cls.env, login="cyan_org", groups=user_group,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.secretary = new_test_user(
            cls.env, login="cyan_sec", groups=user_group,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.attendee = new_test_user(
            cls.env, login="cyan_att", groups=user_group,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.outsider = new_test_user(
            cls.env, login="cyan_out", groups=user_group,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.manager = new_test_user(
            cls.env, login="cyan_mgr", groups=manager_group,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.settings_admin = new_test_user(
            cls.env, login="cyan_settings", groups="base.group_system",
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.other_user = new_test_user(
            cls.env, login="cyan_other", groups=manager_group,
            company_id=cls.company_other.id, company_ids=[cls.company_other.id],
        )
        cls.event_owner = new_test_user(
            cls.env, login="cyan_event", groups=user_group,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.Meeting = cls.env["cyan.meeting.minute"]
        cls.Resolution = cls.env["cyan.meeting.resolution"]

    def _meeting_vals(self, **extra):
        vals = {
            "name": "Ops Review",
            "organizer_id": self.organizer.id,
            "secretary_id": self.secretary.id,
            "attendee_ids": [(6, 0, [self.attendee.id])],
            "meeting_date": fields.Date.today(),
            "start_datetime": fields.Datetime.now(),
            "end_datetime": fields.Datetime.now(),
            "agenda": "<p>Agenda</p>",
            "minutes": "<p>Notes</p>",
        }
        vals.update(extra)
        return vals

    def _create_meeting(self, user=None, **extra):
        env = self.Meeting.with_user(user or self.organizer)
        return env.create(self._meeting_vals(**extra))

    def _create_resolution(self, meeting, user=None, **extra):
        vals = {
            "meeting_id": meeting.id,
            "name": "Follow up",
            "responsible_id": self.attendee.id,
            "deadline": fields.Date.today(),
        }
        vals.update(extra)
        return self.Resolution.with_user(user or self.organizer).create(vals)
