# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import WebVueMeetingEngineCase
from odoo.addons.webvue_meetings.models.meeting_notification_types import (
    readable_active_meeting_ids,
)


@tagged('post_install', '-at_install', 'webvue')
class TestBellAccess(WebVueMeetingEngineCase):
    """The recipient reads their own seeded meeting bell row without a manager grant."""

    def _seed_inbox_row(self, meeting, partner):
        message = self.env['mail.message'].sudo().create({
            'model': 'webvue.meeting.minute',
            'res_id': meeting.id,
            'message_type': 'notification',
            'is_internal': True,
            'webvue_notification': True,
            'webvue_notification_kind': 'meeting_invite',
            'webvue_meeting_id': meeting.id,
            'author_id': meeting.organizer_id.partner_id.id,
            'body': '<p>Invite</p>',
            'partner_ids': [Command.link(partner.id)],
        })
        return self.env['mail.notification'].sudo().create({
            'author_id': meeting.organizer_id.partner_id.id,
            'mail_message_id': message.id,
            'notification_status': 'sent',
            'notification_type': 'inbox',
            'res_partner_id': partner.id,
        })

    def test_recipient_reads_their_meeting_bell_row(self):
        meeting = self._create_meeting()
        row = self._seed_inbox_row(meeting, self.attendee.partner_id)

        self.assertEqual(readable_active_meeting_ids(self.env(user=self.attendee)), [meeting.id])
        bell = self.env['webvue.notify.service'].with_user(self.attendee)._webvue_list(10)
        # Creating the meeting already seeds its own invite, so assert the seeded row is present
        # rather than assuming it is the only one.
        visible = [(item['id'], item['meeting_id']) for item in bell['items']]
        self.assertIn((row.id, meeting.id), visible)
        self.assertTrue(all(meeting_id == meeting.id for _, meeting_id in visible))
        self.assertEqual(bell['total'], len(visible))
