# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import WebVueInboxCase


@tagged('post_install', '-at_install', 'webvue')
class TestMaintenance(WebVueInboxCase):

    def run_maintenance(self):
        self.env['webvue.inbox.conversation']._webvue_run_maintenance()

    def test_idle_conversations_close_after_the_configured_hours(self):
        self.settings.auto_close_hours = 72
        idle = self.make_conversation(minutes_ago=73 * 60)
        resolved_idle = self.make_conversation(minutes_ago=100 * 60, state='resolved')
        fresh = self.make_conversation(minutes_ago=60)
        self.run_maintenance()
        self.assertEqual((idle.state, resolved_idle.state, fresh.state), ('closed', 'closed', 'open'))

    def test_zero_hours_never_closes(self):
        self.settings.auto_close_hours = 0
        idle = self.make_conversation(minutes_ago=1000 * 60)
        self.run_maintenance()
        self.assertEqual(idle.state, 'open')

    def test_notes_do_not_count_as_activity(self):
        self.settings.auto_close_hours = 72
        idle = self.make_conversation(minutes_ago=80 * 60)
        self.env['webvue.inbox.message']._webvue_post_note(idle, 'checked')
        self.run_maintenance()
        self.assertEqual(idle.state, 'closed')

    def test_retention_deletes_conversations_messages_attachments_and_orphan_contacts(self):
        self.settings.retention_months = 1
        self.settings.auto_close_hours = 0
        old = self.make_conversation(minutes_ago=40 * 24 * 60)
        recent = self.make_conversation(minutes_ago=24 * 60)
        message = old.message_ids
        attachment = self.env['ir.attachment'].create({
            'name': 'a.txt', 'raw': b'a', 'res_model': 'webvue.inbox.message', 'res_id': message.id,
        })
        contact = old.contact_id
        self.run_maintenance()
        self.assertFalse(old.exists() or message.exists() or attachment.exists() or contact.exists())
        self.assertTrue(recent.exists() and recent.contact_id.exists())

    def test_processed_events_are_deleted_after_seven_days(self):
        Event = self.env['webvue.inbox.event']
        values = {'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id, 'payload': '{}'}
        old = Event.create({**values, 'state': 'done', 'processed_at': fields.Datetime.now() - timedelta(days=8)})
        recent = Event.create({**values, 'state': 'done', 'processed_at': fields.Datetime.now() - timedelta(days=6)})
        pending = Event.create(values)
        self.run_maintenance()
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists() and pending.exists())
