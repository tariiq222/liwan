# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import LiwanMeetingEngineCase


@tagged('post_install', '-at_install', 'liwan')
class TestFollowerAccess(LiwanMeetingEngineCase):
    """A participant who cannot manage meetings still gets the full follower allow-list."""

    def test_participant_builds_the_manager_follower_allow_list(self):
        manage_group = self.env.ref('liwan_meetings.group_cap_meetings_manage')
        self.assertNotIn(manage_group, self.attendee.group_ids)

        meeting = self._create_meeting(attendee_ids=[Command.set([self.attendee.id])])
        partners = meeting.with_user(self.attendee)._liwan_allowed_follower_partners()

        self.assertIn(self.attendee.partner_id, partners)
        self.assertIn(self.organizer.partner_id, partners)
        self.assertIn(self.secretary.partner_id, partners)
        self.assertIn(self.manager.partner_id, partners)
        self.assertNotIn(self.outsider.partner_id, partners)
